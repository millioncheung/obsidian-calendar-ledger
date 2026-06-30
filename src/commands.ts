import { Notice, SuggestModal, type Plugin } from 'obsidian';
import { parseCalendar } from './calendar-parser';
import { generateCalendarMarkdown, generateYearMarkdown } from './calendar-generator';
import { createCalendarFile, insertItemToDate, appendYearToCalendar, migrateToLatestFormat } from './calendar-writer';
import { navigateToCalendarLine } from './navigator';
import { getTodayStr, normalizeDate } from './date-utils';
import type { SingleFileCalendarSettings } from './types';

export function registerCommands(
	plugin: Plugin,
	settings: SingleFileCalendarSettings,
	getSettings: () => SingleFileCalendarSettings,
) {
	// 1. 生成日历
	plugin.addCommand({
		id: 'generate-calendar',
		name: 'Generate calendar file',
		callback: async () => {
			const s = getSettings();
			const content = generateCalendarMarkdown(s);
			const success = await createCalendarFile(plugin.app.vault, s.calendarFilePath, content);
			if (success) {
				new Notice('Calendar file generated successfully.');
			}
		},
	});

	// 1.5 覆盖日历
	plugin.addCommand({
		id: 'overwrite-calendar',
		name: 'Overwrite calendar file',
		callback: async () => {
			const s = getSettings();
			const content = generateCalendarMarkdown(s);
			const success = await createCalendarFile(plugin.app.vault, s.calendarFilePath, content, true);
			if (success) {
				new Notice('Calendar file overwritten successfully.');
			}
		},
	});

	// 2. 追加年份
	plugin.addCommand({
		id: 'append-year',
		name: 'Append year',
		callback: async () => {
			const s = getSettings();
			const year = s.endYear + 1;
			const yearContent = generateYearMarkdown(year, s);
			const success = await appendYearToCalendar(plugin.app.vault, s.calendarFilePath, yearContent, year);
			if (success) {
				new Notice(`Year ${year} appended successfully.`);
			}
		},
	});

	// 3. 跳转到今天
	plugin.addCommand({
		id: 'jump-to-today',
		name: 'Jump to today',
		callback: async () => {
			const today = getTodayStr();
			try {
				await jumpToDate(plugin, getSettings(), today);
				new Notice(`Jumped to ${today}`);
			} catch (error) {
				console.error('Jump to today error:', error);
				new Notice(`Jump to today failed: ${error}`);
			}
		},
	});

	// 4. 跳转到指定日期
	plugin.addCommand({
		id: 'jump-to-date',
		name: 'Jump to date',
		callback: async () => {
			const s = getSettings();
			new DateInputModal(plugin.app, async (dateStr) => {
				await jumpToDate(plugin, s, dateStr);
			}).open();
		},
	});

	// 5. 向指定日期插入记录
	plugin.addCommand({
		id: 'add-item-to-date',
		name: 'Add item to date',
		callback: async () => {
			const s = getSettings();
			new DateInputModal(plugin.app, async (dateStr) => {
				new ItemInputModal(plugin.app, async (item) => {
					const result = await insertItemToDate(plugin.app.vault, s.calendarFilePath, dateStr, item);
					if (result !== null) {
						// 等待 vault.modify 后 editor 刷新内容，避免 setCursor 用到旧 lineContent
						await new Promise((r) => setTimeout(r, 120));
						await navigateToCalendarLine(plugin, s.calendarFilePath, result.line, result.title);
						new Notice(`Item added to ${dateStr}.`);
					}
				}).open();
			}).open();
		},
	});

	// 6. 向今天插入记录（快捷命令）
	plugin.addCommand({
		id: 'add-item-to-today',
		name: 'Add item to today',
		callback: async () => {
			const s = getSettings();
			new ItemInputModal(plugin.app, async (item) => {
				const today = getTodayStr();
				const result = await insertItemToDate(plugin.app.vault, s.calendarFilePath, today, item);
				if (result !== null) {
					await new Promise((r) => setTimeout(r, 120));
					await navigateToCalendarLine(plugin, s.calendarFilePath, result.line, result.title);
					new Notice(`Item added to today (${today}).`);
				}
			}).open();
		},
	});

	// 7. 迁移到最新格式
	plugin.addCommand({
		id: 'migrate-to-latest-format',
		name: 'Migrate to latest format',
		callback: async () => {
			const s = getSettings();
			const count = await migrateToLatestFormat(plugin.app.vault, s.calendarFilePath);
			if (count > 0) {
				new Notice(`Migrated ${count} item(s) to latest format.`);
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
		new Notice(`Calendar file not found: ${settings.calendarFilePath}`);
		return;
	}

	const content = await plugin.app.vault.read(file);
	const { dayBlockMap } = parseCalendar(content);

	const block = dayBlockMap[dateStr];
	if (!block) {
		new Notice(`Date ${dateStr} not found in calendar.`);
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
		this.setPlaceholder('Enter date (e.g. 2026-7-30)');
	}

	getSuggestions(query: string): string[] {
		// 如果输入看起来像日期，返回建议
		if (query.match(/^\d{0,4}-?\d{0,2}-?\d{0,2}$/)) {
			return [query];
		}
		// 支持 "today" 快捷输入
		if (query.toLowerCase().startsWith('t')) {
			return [getTodayStr()];
		}
		return [];
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value === getTodayStr() ? `Today (${value})` : value);
	}

	onChooseSuggestion(item: string): void {
		const normalized = normalizeDate(item);
		if (!normalized) {
			new Notice('Invalid date. Please enter a valid date like 2026-7-30.');
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
		this.setPlaceholder('Enter item content');
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
			new Notice('Item content cannot be empty.');
			return;
		}
		this.onSubmit(item);
	}
}