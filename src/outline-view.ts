import { ItemView, WorkspaceLeaf, type Plugin } from 'obsidian';
import { parseCalendar } from './calendar-parser';
import { navigateToCalendarLine } from './navigator';
import { getTodayStr, isDateOnOrAfter, generateDatesInRange, formatDateTitle, stripRangeText } from './date-utils';
import type {
	CalendarDayBlock,
	CalendarRange,
	SingleFileCalendarSettings,
} from './types';

export const OUTLINE_VIEW_TYPE = 'single-file-calendar-outline';

type TabType = 'content' | 'upcoming';

export class CalendarOutlineView extends ItemView {
	private plugin: Plugin;
	private settings: SingleFileCalendarSettings;
	private currentTab: TabType;

	// 缓存解析结果，避免重复读取和解析文件
	private cachedDayBlocks: CalendarDayBlock[] = [];
	private cacheInvalidated: boolean = true;

	constructor(leaf: WorkspaceLeaf, plugin: Plugin, settings: SingleFileCalendarSettings) {
		super(leaf);
		this.plugin = plugin;
		this.settings = settings;
		this.currentTab = 'content';
	}

	getViewType(): string {
		return OUTLINE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Single File Calendar';
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/**
	 * 刷新视图
	 */
	refresh(settings: SingleFileCalendarSettings): void {
		this.settings = settings;
		this.cacheInvalidated = true;
		this.render();
	}

	/**
	 * 渲染视图
	 */
	private async render(): Promise<void> {
		console.log('[SFC] render() called, currentTab=', this.currentTab);
		const container = this.contentEl;
		container.empty();
		container.addClass('single-file-calendar-outline');

		// 读取并解析 Calendar.md
		const file = this.plugin.app.vault.getFileByPath(this.settings.calendarFilePath);
		if (!file) {
			container.createDiv({
				text: 'Calendar file not found. Use "Generate calendar file" command first.',
				cls: 'sfc-empty',
			});
			console.log('[SFC] File not found:', this.settings.calendarFilePath);
			return;
		}

		if (this.cacheInvalidated) {
			const fileContent = await this.plugin.app.vault.read(file);
			const result = parseCalendar(fileContent);
			this.cachedDayBlocks = result.dayBlocks;
			this.cacheInvalidated = false;
			console.log('[SFC] Parsed', this.cachedDayBlocks.length, 'day blocks');
		}

		// 顶部工具栏
		const toolbar = container.createDiv({ cls: 'sfc-toolbar' });

		// Tab 切换按钮
		const tabs: { id: TabType; label: string }[] = [
			{ id: 'content', label: 'Content' },
			{ id: 'upcoming', label: 'Upcoming' },
		];
		const tabGroup = toolbar.createDiv({ cls: 'sfc-tab-group' });
		for (const tab of tabs) {
			const btn = tabGroup.createEl('button', {
				text: tab.label,
				cls: 'sfc-tab-btn' + (tab.id === this.currentTab ? ' sfc-tab-active' : ''),
			});
			btn.addEventListener('click', () => {
				this.currentTab = tab.id;
				this.render();
			});
		}

		// 刷新按钮
		const refreshBtn = toolbar.createEl('button', { text: 'Refresh', cls: 'sfc-btn' });
		refreshBtn.addEventListener('click', () => {
			this.cacheInvalidated = true;
			this.render();
		});

		// Content 区
		const content = container.createDiv({ cls: 'sfc-content' });

		switch (this.currentTab) {
			case 'content':
				this.renderContentTab(content);
				break;
			case 'upcoming':
				this.renderUpcomingTab(content);
				break;
		}
	}

	// ==================== Content Tab ====================

	private renderContentTab(container: HTMLElement): void {
		const daysWithContent = this.cachedDayBlocks.filter((b) => b.hasContent);
		console.log('[SFC] Content tab: found', daysWithContent.length, 'days with content');

		if (daysWithContent.length === 0) {
			container.createDiv({ text: 'No content yet.', cls: 'sfc-empty' });
			return;
		}

		// 按日期分组到月份
		const grouped = this.groupByMonth(daysWithContent);
		const listContainer = container.createDiv({ cls: 'sfc-list' });

		for (const [monthLabel, days] of Object.entries(grouped)) {
			const monthHeader = listContainer.createDiv({ cls: 'sfc-list-month' });
			monthHeader.createSpan({ text: monthLabel, cls: 'sfc-list-month-title' });

			for (const day of days) {
				const row = listContainer.createDiv({ cls: 'sfc-list-row' });
				row.createSpan({ text: day.title, cls: 'sfc-list-date' });
				if (day.inlineContent) {
					row.createSpan({ text: day.inlineContent, cls: 'sfc-list-content' });
				}
				const line = day.lineStart;
				const title = day.title;
				row.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.selectRow(row);
					this.navigateToLine(line, title);
				});
			}
		}
	}

	// ==================== Upcoming Tab ====================

	private renderUpcomingTab(container: HTMLElement): void {
		const today = getTodayStr();

		// 1. 未来的单日内容
		const futureDays = this.cachedDayBlocks.filter(
			(b) => b.hasContent && isDateOnOrAfter(b.date, today),
		);

		// 2. 未来跨日期事件（range event），只统计一次
		const seenRanges = new Set<string>();
		const futureRanges: { range: CalendarRange; sourceDay: CalendarDayBlock }[] = [];
		for (const day of this.cachedDayBlocks) {
			if (!day.hasContent) continue;
			for (const range of day.ranges) {
				const key = `${range.startDate}~${range.endDate}`;
				if (isDateOnOrAfter(range.endDate, today) && !seenRanges.has(key)) {
					seenRanges.add(key);
					futureRanges.push({ range, sourceDay: day });
				}
			}
		}

		// 3. 收集所有 range 覆盖的日期，避免与单日 item 重复
		const rangeCoveredDates = new Set<string>();
		for (const fr of futureRanges) {
			const dates = generateDatesInRange(fr.range.startDate, fr.range.endDate);
			for (const d of dates) {
				if (isDateOnOrAfter(d, today)) {
					rangeCoveredDates.add(d);
				}
			}
		}

		// 4. 单日 item：排除被 range 覆盖的
		const nonRangeDays = futureDays.filter((d) => !rangeCoveredDates.has(d.date));

		// 5. 构建排序列表
		interface UpcomingItem {
			sortDate: string;
			render: (listContainer: HTMLElement) => void;
		}
		const items: UpcomingItem[] = [];

		// 单日
		for (const day of nonRangeDays) {
			items.push({
				sortDate: day.date,
				render: (lc) => {
					const row = lc.createDiv({ cls: 'sfc-list-row' });
					row.createSpan({ text: day.title, cls: 'sfc-list-date' });
					if (day.inlineContent) {
						row.createSpan({ text: day.inlineContent, cls: 'sfc-list-content' });
					}
					const line = day.lineStart;
					const title = day.title;
					row.addEventListener('click', (e) => {
						e.stopPropagation();
						e.preventDefault();
						this.selectRow(row);
						this.navigateToLine(line, title);
					});
				},
			});
		}

		// 展开 range
		for (const fr of futureRanges) {
			const { range, sourceDay } = fr;
			const allDates = generateDatesInRange(range.startDate, range.endDate).filter((d) =>
				isDateOnOrAfter(d, today),
			);
			if (allDates.length === 0) continue;

			// 去掉 range 文本后的内容
			const strippedContent = stripRangeText(sourceDay.inlineContent, range.text);

			for (let i = 0; i < allDates.length; i++) {
				const date = allDates[i]!;
				const isFirst = i === 0;
				const title = formatDateTitle(date, this.settings.language);

				items.push({
					sortDate: date,
					render: (lc) => {
						const row = lc.createDiv({ cls: 'sfc-list-row' });
						if (isFirst) {
							row.createSpan({ text: title, cls: 'sfc-list-date' });
							if (strippedContent) {
								row.createSpan({ text: strippedContent, cls: 'sfc-list-content' });
							}
						} else {
							row.createSpan({ text: title, cls: 'sfc-list-date' });
							row.createSpan({ text: '↳', cls: 'sfc-list-content' });
						}
						const srcLine = sourceDay.lineStart;
						const srcTitle = sourceDay.title;
						row.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							this.selectRow(row);
							this.navigateToLine(srcLine, srcTitle);
						});
					},
				});
			}
		}

		items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

		if (items.length === 0) {
			container.createDiv({ text: 'No upcoming items.', cls: 'sfc-empty' });
			return;
		}

		// 6. 按月份分组渲染
		const grouped: Record<string, UpcomingItem[]> = {};
		for (const item of items) {
			const parts = item.sortDate.split('-');
			const label = `${parts[0] ?? ''}-${parts[1] ?? ''}`;
			if (!grouped[label]) grouped[label] = [];
			grouped[label]!.push(item);
		}

		const listContainer = container.createDiv({ cls: 'sfc-list' });
		for (const [monthLabel, monthItems] of Object.entries(grouped)) {
			const monthHeader = listContainer.createDiv({ cls: 'sfc-list-month' });
			monthHeader.createSpan({ text: monthLabel, cls: 'sfc-list-month-title' });

			for (const item of monthItems) {
				item.render(listContainer);
			}
		}
	}

	// ==================== Helpers ====================

	/**
	 * 按月份分组 day blocks
	 */
	private groupByMonth(days: CalendarDayBlock[]): Record<string, CalendarDayBlock[]> {
		const grouped: Record<string, CalendarDayBlock[]> = {};
		for (const day of days) {
			const parts = day.date.split('-');
			const year = parts[0] ?? '';
			const month = parts[1] ?? '';
			const label = `${year}-${month}`;
			if (!grouped[label]) grouped[label] = [];
			grouped[label]!.push(day);
		}
		return grouped;
	}

	/**
	 * 设置当前选中的 row 高亮（类似 Obsidian 文件树的选中态）
	 *
	 * 移除其他 row 的 .is-active，给当前 row 加上。重新渲染 tab 时选中态会重置。
	 */
	private selectRow(row: HTMLElement): void {
		this.contentEl.querySelectorAll('.sfc-list-row.is-active').forEach((el) => {
			el.classList.remove('is-active');
		});
		row.classList.add('is-active');
	}

	/**
	 * 跳转到指定行
	 *
	 * 实际逻辑在 navigator.ts，支持阅读模式 / 源码模式：
	 *   - 阅读模式：data-line 定位 DOM + 文本验证，手动 scrollTop 居中 + 闪烁高亮
	 *   - 源码模式：setCursor 行末 + 手动 scrollTop 居中 + 闪烁高亮
	 *
	 * @param title 日期标题（如 "01-22 Wed"），阅读模式下用于验证 data-line 匹配
	 */
	private async navigateToLine(line: number, title?: string): Promise<void> {
		await navigateToCalendarLine(this.plugin, this.settings.calendarFilePath, line, title);
	}
}