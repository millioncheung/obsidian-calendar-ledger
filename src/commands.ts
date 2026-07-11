import { Notice, SuggestModal, type Plugin } from 'obsidian';
import { parseCalendar } from './calendar-parser';
import { generateCalendarMarkdown, generateYearMarkdown } from './calendar-generator';
import { createCalendarFile, insertItemToDate, appendYearToCalendar, migrateToLatestFormat } from './calendar-writer';
import { navigateToCalendarLine } from './navigator';
import { getTodayStr, normalizeDate } from './date-utils';
import { confirmAction } from './confirm-modal';
import type { SingleFileCalendarSettings } from './types';

type PluginWithSettings = Plugin & {
	saveSettings: () => Promise<void>;
};

export function registerCommands(
	plugin: Plugin,
	settings: SingleFileCalendarSettings,
	getSettings: () => SingleFileCalendarSettings,
) {
	// 1. 生成日历
	plugin.addCommand({
		id: 'generate-calendar',
		name: '生成日历文件',
		callback: async () => {
			const s = getSettings();
			const content = generateCalendarMarkdown(s);
			const success = await createCalendarFile(plugin.app.vault, s.calendarFilePath, content);
			if (success) {
				new Notice('日历文件已生成。');
			}
		},
	});

	// 1.5 覆盖日历
	plugin.addCommand({
		id: 'overwrite-calendar',
		name: '覆盖日历文件',
		callback: async () => {
			const s = getSettings();
			const existingFile = plugin.app.vault.getFileByPath(s.calendarFilePath);
			if (existingFile) {
				const confirmed = await confirmAction(
					plugin.app,
					'覆盖日历文件？',
					'这会替换现有的日历文件，文件中的已有记录将会丢失。',
					'覆盖',
				);
				if (!confirmed) return;
			}
			const content = generateCalendarMarkdown(s);
			const success = await createCalendarFile(plugin.app.vault, s.calendarFilePath, content, true);
			if (success) {
				new Notice('日历文件已覆盖。');
			}
		},
	});

	// 2. 追加年份
	plugin.addCommand({
		id: 'append-year',
		name: '追加年份',
		callback: async () => {
			const s = getSettings();
			const year = s.endYear + 1;
			const yearContent = generateYearMarkdown(year, s);
			const success = await appendYearToCalendar(plugin.app.vault, s.calendarFilePath, yearContent, year);
			if (success) {
				s.endYear = year;
				await (plugin as PluginWithSettings).saveSettings();
				new Notice(`已追加 ${year} 年。`);
			}
		},
	});

	// 3. 跳转到今天
	plugin.addCommand({
		id: 'jump-to-today',
		name: '跳转到今天',
		callback: async () => {
			const today = getTodayStr();
			try {
				await jumpToDate(plugin, getSettings(), today);
				new Notice(`已跳转到 ${today}`);
			} catch (error) {
				console.error('Jump to today error:', error);
				new Notice(`跳转到今天失败：${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});

	// 4. 跳转到指定日期
	plugin.addCommand({
		id: 'jump-to-date',
		name: '跳转到指定日期',
		callback: async () => {
			const s = getSettings();
			new DateInputModal(plugin.app, (dateStr) => {
				void jumpToDate(plugin, s, dateStr);
			}).open();
		},
	});

	// 5. 向指定日期插入记录
	plugin.addCommand({
		id: 'add-item-to-date',
		name: '向指定日期添加记录',
		callback: async () => {
			const s = getSettings();
			new DateInputModal(plugin.app, (dateStr) => {
				new ItemInputModal(plugin.app, (item) => {
					void (async () => {
						const result = await insertItemToDate(plugin.app.vault, s.calendarFilePath, dateStr, item);
						if (result !== null) {
							// 等待 vault.modify 后 editor 刷新内容，避免 setCursor 用到旧 lineContent
							await new Promise((r) => window.setTimeout(r, 120));
							await navigateToCalendarLine(plugin, s.calendarFilePath, result.line, result.title);
							new Notice(`已添加记录到 ${dateStr}。`);
						}
					})().catch((error) => console.error('[SFC] Add item error:', error));
				}).open();
			}).open();
		},
	});

	// 6. 向今天插入记录（快捷命令）
	plugin.addCommand({
		id: 'add-item-to-today',
		name: '向今天添加记录',
		callback: async () => {
			const s = getSettings();
			new ItemInputModal(plugin.app, (item) => {
				void (async () => {
					const today = getTodayStr();
					const result = await insertItemToDate(plugin.app.vault, s.calendarFilePath, today, item);
					if (result !== null) {
						await new Promise((r) => window.setTimeout(r, 120));
						await navigateToCalendarLine(plugin, s.calendarFilePath, result.line, result.title);
						new Notice(`已添加记录到今天（${today}）。`);
					}
				})().catch((error) => console.error('[SFC] Add today item error:', error));
			}).open();
		},
	});

	// 7. 迁移到最新格式
	plugin.addCommand({
		id: 'migrate-to-latest-format',
		name: '迁移到最新格式',
		callback: async () => {
			const s = getSettings();
			const count = await migrateToLatestFormat(plugin.app.vault, s.calendarFilePath);
			if (count > 0) {
				new Notice(`已在 ${s.calendarFilePath} 完成 ${count} 处格式修复或迁移。`);
			}
		},
	});
}

/**
 * 跳转到指定日期
 *
 * 解析 Calendar.md 找到目标日期的行号，委托给 navigator 完成跳转。
 * navigator 会保留用户当前模式（阅读 / 源码），并居中 + 闪烁高亮。
 */
async function jumpToDate(plugin: Plugin, settings: SingleFileCalendarSettings, dateStr: string): Promise<void> {
	const file = plugin.app.vault.getFileByPath(settings.calendarFilePath);
	if (!file) {
		new Notice(`找不到日历文件：${settings.calendarFilePath}`);
		return;
	}

	const content = await plugin.app.vault.read(file);
	const { dayBlockMap } = parseCalendar(content);

	const block = dayBlockMap[dateStr];
	if (!block) {
		new Notice(`日历中找不到日期：${dateStr}`);
		return;
	}

	await navigateToCalendarLine(plugin, settings.calendarFilePath, block.lineStart, block.title);
}

/**
 * 日期输入弹窗
 */
class DateInputModal extends SuggestModal<string> {
	private onSubmit: (dateStr: string) => void;

	constructor(app: Plugin['app'], onSubmit: (dateStr: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.setPlaceholder('输入日期，例如 7-30 或 2026-7-30');
	}

	getSuggestions(query: string): string[] {
		// 如果输入看起来像日期，返回建议
		if (query.match(/^(\d{0,4}-?\d{0,2}-?\d{0,2}|\d{0,2}-?\d{0,2})$/)) {
			return [query];
		}
		// 支持 "today" 快捷输入
		if (query.toLowerCase().startsWith('t')) {
			return [getTodayStr()];
		}
		return [];
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value === getTodayStr() ? `今天（${value}）` : value);
	}

	onChooseSuggestion(item: string): void {
		const normalized = normalizeDate(item);
		if (!normalized) {
			new Notice('日期无效。请输入类似 7-30 或 2026-7-30 的有效日期。');
			return;
		}
		this.onSubmit(normalized);
	}
}

/**
 * 内容输入弹窗
 */
class ItemInputModal extends SuggestModal<string> {
	private onSubmit: (item: string) => void;

	constructor(app: Plugin['app'], onSubmit: (item: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
		this.setPlaceholder('输入记录内容');
	}

	getSuggestions(query: string): string[] {
		if (query.length > 0) {
			return [query];
		}
		return [];
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	onChooseSuggestion(item: string): void {
		if (!item.trim()) {
			new Notice('记录内容不能为空。');
			return;
		}
		this.onSubmit(item);
	}
}
