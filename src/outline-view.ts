import { ItemView, WorkspaceLeaf, type Plugin } from 'obsidian';
import { parseCalendar } from './calendar-parser';
import { navigateToCalendarLine } from './navigator';
import { getTodayStr, isDateOnOrAfter, generateDatesInRange, formatDateTitle, stripRangeText } from './date-utils';
import {
	computeActivityStats,
	computeEventStats,
	computeMonthlyDistributionStats,
	computeRangeStats,
	computeMonthlySummary,
	scanAllTags,
	categorizeTag,
	splitItems,
	type ActivityStats,
	type EventStats,
	type MonthlyDistributionStats,
	type RangeStats,
	type MonthlySummaryItem,
	type TagOccurrence,
	type TagCategory,
} from './stats';
import {
	computeActivityHeatmap,
	computeEventTimeline,
	computeMonthlyDistribution,
	computeRangesByTag,
	collectYears,
	activityIntensity,
	monthAbbr,
	type ActivityHeatmapData,
	type EventTimelineData,
	type MonthlyDistributionData,
	type TagRangeData,
} from './heatmap';
import {
	classifyTagEventType,
} from './types';
import type {
	CalendarDayBlock,
	CalendarRange,
	CalendarLedgerSettings,
} from './types';

export const OUTLINE_VIEW_TYPE = 'calendar-ledger-outline';

type TabType = 'content' | 'upcoming' | 'stats' | 'heatmap' | 'year';

export class CalendarLedgerOutlineView extends ItemView {
	private plugin: Plugin;
	private settings: CalendarLedgerSettings;
	private currentTab: TabType;
	private heatmapYear: number;
	private yearSummaryYear: number;

	// 缓存解析结果，避免重复读取和解析文件
	private cachedDayBlocks: CalendarDayBlock[] = [];
	private cacheInvalidated: boolean = true;
	private renderVersion = 0;

	constructor(leaf: WorkspaceLeaf, plugin: Plugin, settings: CalendarLedgerSettings) {
		super(leaf);
		this.plugin = plugin;
		this.settings = settings;
		this.currentTab = 'content';
		this.heatmapYear = new Date().getFullYear();
		this.yearSummaryYear = new Date().getFullYear();
	}

	getViewType(): string {
		return OUTLINE_VIEW_TYPE;
	}

	getDisplayText(): string {
		return this.plugin.manifest.name;
	}

	getIcon(): string {
		return 'calendar-days';
	}

	async onOpen(): Promise<void> {
		void this.render();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/**
	 * 刷新视图
	 */
	refresh(settings: CalendarLedgerSettings): void {
		this.settings = settings;
		this.cacheInvalidated = true;
		void this.render();
	}

	/**
	 * 重新读取 Calendar.md 并刷新当前 tab。
	 *
	 * 由 vault modify 事件 debounce 后触发，避免每个 Tab 各自重复读取文件。
	 */
	refreshData(): void {
		this.cacheInvalidated = true;
		void this.render();
	}

	/**
	 * 渲染视图
	 */
	private async render(): Promise<void> {
		const renderVersion = ++this.renderVersion;
		const container = this.contentEl;
		container.empty();
		container.addClass('calendar-ledger-outline');

		// 读取并解析 Calendar.md
		const file = this.plugin.app.vault.getFileByPath(this.settings.calendarFilePath);
		if (!file) {
			container.createDiv({
				text: 'Calendar file not found. Use "Generate calendar file" command first.',
				cls: 'calendar-ledger-empty',
			});
			return;
		}

		if (this.cacheInvalidated) {
			const fileContent = await this.plugin.app.vault.read(file);
			if (renderVersion !== this.renderVersion) return;
			const result = parseCalendar(fileContent);
			this.cachedDayBlocks = result.dayBlocks;
			this.cacheInvalidated = false;
		}
		if (renderVersion !== this.renderVersion) return;

		// 顶部工具栏
		const toolbar = container.createDiv({ cls: 'calendar-ledger-toolbar' });

		// Tab 切换按钮
		const tabs: { id: TabType; label: string }[] = [
			{ id: 'content', label: 'Content' },
			{ id: 'upcoming', label: 'Upcoming' },
			{ id: 'stats', label: 'Stats' },
			{ id: 'heatmap', label: 'Heatmap' },
			{ id: 'year', label: 'Year' },
		];
		const tabGroup = toolbar.createDiv({ cls: 'calendar-ledger-tab-group' });
		for (const tab of tabs) {
			const btn = tabGroup.createEl('button', {
				text: tab.label,
				cls: 'calendar-ledger-tab-btn' + (tab.id === this.currentTab ? ' calendar-ledger-tab-active' : ''),
			});
			btn.addEventListener('click', () => {
				this.currentTab = tab.id;
				void this.render();
			});
		}

		// 刷新按钮
		const refreshBtn = toolbar.createEl('button', { text: 'Refresh', cls: 'calendar-ledger-btn' });
		refreshBtn.addEventListener('click', () => {
			this.cacheInvalidated = true;
			void this.render();
		});

		// Content 区
		const content = container.createDiv({ cls: 'calendar-ledger-content' });

		switch (this.currentTab) {
			case 'content':
				this.renderContentTab(content);
				break;
			case 'upcoming':
				this.renderUpcomingTab(content);
				break;
			case 'stats':
				this.renderStatsTab(content);
				break;
			case 'heatmap':
				this.renderHeatmapTab(content);
				break;
			case 'year':
				this.renderYearTab(content);
				break;
		}
	}

	// ==================== Content Tab ====================

	private renderContentTab(container: HTMLElement): void {
		const daysWithContent = this.cachedDayBlocks.filter((b) => b.hasContent);

		if (daysWithContent.length === 0) {
			container.createDiv({ text: 'No content yet.', cls: 'calendar-ledger-empty' });
			return;
		}

		// 按日期分组到月份
		const grouped = this.groupByMonth(daysWithContent);
		const listContainer = container.createDiv({ cls: 'calendar-ledger-list' });

		for (const [monthLabel, days] of Object.entries(grouped)) {
			const monthHeader = listContainer.createDiv({ cls: 'calendar-ledger-list-month' });
			monthHeader.createSpan({ text: monthLabel, cls: 'calendar-ledger-list-month-title' });

			for (const day of days) {
				const row = listContainer.createDiv({ cls: 'calendar-ledger-list-row' });
				row.createSpan({ text: day.title, cls: 'calendar-ledger-list-date' });
				if (day.inlineContent) {
					row.createSpan({ text: day.inlineContent, cls: 'calendar-ledger-list-content' });
				}
				const line = day.lineStart;
				const title = day.title;
				row.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.selectRow(row);
					void this.navigateToLine(line, title);
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
				const key = `${day.date}:${range.startDate}~${range.endDate}:${range.text}`;
				if (isDateOnOrAfter(range.endDate, today) && !seenRanges.has(key)) {
					seenRanges.add(key);
					futureRanges.push({ range, sourceDay: day });
				}
			}
		}

		// 3. 构建排序列表
		interface UpcomingItem {
			sortDate: string;
			render: (listContainer: HTMLElement) => void;
		}
		const items: UpcomingItem[] = [];

		// 单日 item：只排除包含 range 的那一条 item，不排除被 range 覆盖的整天
		for (const day of futureDays) {
			for (const inlineItem of splitItems(day.inlineContent)) {
				const belongsToFutureRange = futureRanges.some(({ range, sourceDay }) =>
					sourceDay.date === day.date && inlineItem.includes(range.text),
				);
				if (belongsToFutureRange) continue;

				items.push({
					sortDate: day.date,
					render: (lc) => {
						const row = lc.createDiv({ cls: 'calendar-ledger-list-row' });
						row.createSpan({ text: day.title, cls: 'calendar-ledger-list-date' });
						row.createSpan({ text: inlineItem, cls: 'calendar-ledger-list-content' });
						const line = day.lineStart;
						const title = day.title;
						row.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							this.selectRow(row);
							void this.navigateToLine(line, title);
						});
					},
				});
			}
		}

		// 展开 range
		for (const fr of futureRanges) {
			const { range, sourceDay } = fr;
			const allDates = generateDatesInRange(range.startDate, range.endDate).filter((d) =>
				isDateOnOrAfter(d, today),
			);
			if (allDates.length === 0) continue;

			// 去掉 range 文本后的内容。只处理包含 range 的那一条 item，避免混入同一天其他事项。
			const sourceItem = this.findInlineItemContainingRange(sourceDay.inlineContent, range.text);
			const strippedContent = stripRangeText(sourceItem, range.text);

			for (let i = 0; i < allDates.length; i++) {
				const date = allDates[i]!;
				const isFirst = i === 0;
				const title = formatDateTitle(date, this.settings.language);

				items.push({
					sortDate: date,
					render: (lc) => {
						const row = lc.createDiv({ cls: 'calendar-ledger-list-row' });
						if (isFirst) {
							row.createSpan({ text: title, cls: 'calendar-ledger-list-date' });
							if (strippedContent) {
								row.createSpan({ text: strippedContent, cls: 'calendar-ledger-list-content' });
							}
						} else {
							row.createSpan({ text: title, cls: 'calendar-ledger-list-date' });
							row.createSpan({ text: '↳', cls: 'calendar-ledger-list-content' });
						}
						const srcLine = sourceDay.lineStart;
						const srcTitle = sourceDay.title;
						row.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							this.selectRow(row);
							void this.navigateToLine(srcLine, srcTitle);
						});
					},
				});
			}
		}

		items.sort((a, b) => a.sortDate.localeCompare(b.sortDate));

		if (items.length === 0) {
			container.createDiv({ text: 'No upcoming items.', cls: 'calendar-ledger-empty' });
			return;
		}

		// 6. 按月份分组渲染
		const grouped: Record<string, UpcomingItem[]> = {};
		for (const item of items) {
			const parts = item.sortDate.split('-');
			const label = `${parts[0] ?? ''}-${parts[1] ?? ''}`;
			if (!grouped[label]) grouped[label] = [];
			grouped[label].push(item);
		}

		const listContainer = container.createDiv({ cls: 'calendar-ledger-list' });
		for (const [monthLabel, monthItems] of Object.entries(grouped)) {
			const monthHeader = listContainer.createDiv({ cls: 'calendar-ledger-list-month' });
			monthHeader.createSpan({ text: monthLabel, cls: 'calendar-ledger-list-month-title' });

			for (const item of monthItems) {
				item.render(listContainer);
			}
		}
	}

	private findInlineItemContainingRange(inlineContent: string, rangeText: string): string {
		return splitItems(inlineContent).find((item) => item.includes(rangeText)) ?? inlineContent;
	}

	// ==================== Stats Tab ====================

	private renderStatsTab(container: HTMLElement): void {
		const blocks = this.cachedDayBlocks;
		const tagMap = scanAllTags(blocks);
		const enabledTags = new Set(this.settings.enabledStatsTags ?? []);
		const mappings = this.settings.visualizationTagMappings;

		// 按类别优先级排序,同类内按标签名字母序
		const categoryPriority: Record<TagCategory, number> = {
			activity: 0,
			event: 1,
			monthly: 2,
			range: 3,
			simple: 4,
		};

		const sortedTags = Array.from(tagMap.entries())
			.filter(([tag]) => enabledTags.has(tag))
			.sort((a, b) => {
				const catA = categorizeTag(a[0], mappings);
				const catB = categorizeTag(b[0], mappings);
				if (catA !== catB) return categoryPriority[catA] - categoryPriority[catB];
				return a[0].localeCompare(b[0]);
			});

		for (const [tag, occurrences] of sortedTags) {
			const category = categorizeTag(tag, mappings);
			const displayName = mappings[tag]?.displayName ?? tag;
			switch (category) {
				case 'activity':
					this.renderActivitySection(container, displayName, computeActivityStats(blocks, [tag]), tag);
					break;
				case 'event':
					this.renderEventSection(container, displayName, computeEventStats(blocks, [tag]), tag);
					break;
				case 'monthly':
					this.renderMonthlyDistributionSection(container, displayName, computeMonthlyDistributionStats(blocks, [tag]), tag);
					break;
				case 'range':
					this.renderRangeSection(container, displayName, computeRangeStats(blocks, [tag]), tag);
					break;
				case 'simple':
					this.renderGenericTagSection(container, tag, occurrences);
					break;
			}
		}

		// Monthly Summary 在最后 — 列从 enabledStatsTags 动态生成
		const summaryColumns = this.getEnabledExistingTags(tagMap, enabledTags);
		this.renderMonthlySummarySection(container, computeMonthlySummary(blocks, summaryColumns), summaryColumns);
	}

	/**
	 * 创建可折叠的 Stats section。
	 *
	 * 所有 Stats 模块统一使用此 helper:标题左对齐(带 ▸/▾ 三角),次数右对齐,
	 * 默认收起。返回 body 容器,调用方在 body 中填充明细。
	 */
	private createCollapsibleSection(
		container: HTMLElement,
		title: string,
		countText: string,
		defaultExpanded: boolean = false,
		stateKey?: string,
	): HTMLElement {
		const section = container.createDiv({ cls: 'calendar-ledger-stats-section' });
		const header = section.createDiv({ cls: 'calendar-ledger-stats-header is-collapsible' });
		header.createSpan({ text: title, cls: 'calendar-ledger-stats-title' });
		if (countText) {
			header.createSpan({ text: countText, cls: 'calendar-ledger-stats-total' });
		}
		const body = section.createDiv({ cls: 'calendar-ledger-stats-section-body' });
		const expanded = this.getCollapsibleExpanded(stateKey, defaultExpanded);
		body.style.display = expanded ? 'block' : 'none';
		if (expanded) header.classList.add('is-expanded');
		header.addEventListener('click', () => {
			const isExpanded = body.style.display !== 'none';
			const nextExpanded = !isExpanded;
			body.style.display = nextExpanded ? 'block' : 'none';
			header.classList.toggle('is-expanded', nextExpanded);
			this.setCollapsibleExpanded(stateKey, nextExpanded);
		});
		return body;
	}

	/**
	 * 在 body 中创建可折叠的月份行,展开后显示日期列表。
	 */
	private createCollapsibleMonthRow(
		body: HTMLElement,
		monthKey: string,
		count: number,
		stateKey?: string,
	): HTMLElement {
		const monthRow = body.createDiv({ cls: 'calendar-ledger-stats-month-row' });
		monthRow.createSpan({ text: monthKey, cls: 'calendar-ledger-stats-month-key' });
		monthRow.createSpan({ text: `${count} 次`, cls: 'calendar-ledger-stats-month-count' });

		const dayList = body.createDiv({ cls: 'calendar-ledger-stats-day-list' });
		const expanded = this.getCollapsibleExpanded(stateKey, false);
		dayList.style.display = expanded ? 'block' : 'none';
		monthRow.classList.toggle('is-expanded', expanded);
		monthRow.addEventListener('click', () => {
			const isExpanded = dayList.style.display !== 'none';
			const nextExpanded = !isExpanded;
			dayList.style.display = nextExpanded ? 'block' : 'none';
			monthRow.classList.toggle('is-expanded', nextExpanded);
			this.setCollapsibleExpanded(stateKey, nextExpanded);
		});
		return dayList;
	}

	private getCollapsibleExpanded(stateKey: string | undefined, defaultExpanded: boolean): boolean {
		if (!stateKey) return defaultExpanded;
		const saved = this.settings.sidebarUiState?.collapsibleSections?.[stateKey];
		return typeof saved === 'boolean' ? saved : defaultExpanded;
	}

	private setCollapsibleExpanded(stateKey: string | undefined, expanded: boolean): void {
		if (!stateKey) return;
		if (!this.settings.sidebarUiState) {
			this.settings.sidebarUiState = { collapsibleSections: {} };
		}
		if (!this.settings.sidebarUiState.collapsibleSections) {
			this.settings.sidebarUiState.collapsibleSections = {};
		}
		this.settings.sidebarUiState.collapsibleSections[stateKey] = expanded;
		void (this.plugin as Plugin & { saveSettings?: () => Promise<void> }).saveSettings?.();
	}

	/**
	 * 渲染通用标签 section(location / simple)。
	 * 保留 tag 原始大小写,展开后直接显示所有条目(按日期排序)。
	 */
	private renderGenericTagSection(
		container: HTMLElement,
		tag: string,
		occurrences: TagOccurrence[],
	): void {
		const body = this.createCollapsibleSection(container, tag, `${occurrences.length} 次`, false, `stats:simple:${tag}`);

		if (occurrences.length === 0) {
			body.createDiv({ text: 'No records.', cls: 'calendar-ledger-empty' });
			return;
		}

		for (const occ of [...occurrences].sort((a, b) => a.date.localeCompare(b.date))) {
			const row = body.createDiv({ cls: 'calendar-ledger-stats-item' });
			row.createSpan({ text: occ.displayDate, cls: 'calendar-ledger-stats-item-date' });
			if (occ.cleanText) {
				row.createSpan({ text: occ.cleanText, cls: 'calendar-ledger-stats-item-text' });
			}
			const line = occ.lineStart;
			const title = occ.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
	}

	private renderActivitySection(container: HTMLElement, displayName: string, stats: ActivityStats, tag: string): void {
		const body = this.createCollapsibleSection(container, displayName, `${stats.total} 次`, false, `stats:activity:${tag}`);

		if (stats.byMonth.length === 0) {
			body.createDiv({ text: `No ${displayName} records.`, cls: 'calendar-ledger-empty' });
			return;
		}

		for (const month of stats.byMonth) {
			const dayList = this.createCollapsibleMonthRow(body, month.monthKey, month.count, `stats:activity:${tag}:month:${month.monthKey}`);
			for (const item of month.items) {
				const dayRow = dayList.createDiv({ cls: 'calendar-ledger-stats-item' });
				dayRow.createSpan({ text: item.date.slice(5), cls: 'calendar-ledger-stats-item-date' });
				const line = item.lineStart;
				const title = item.title;
				dayRow.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.selectRow(dayRow);
					void this.navigateToLine(line, title);
				});
			}
		}
	}

	private renderEventSection(container: HTMLElement, displayName: string, stats: EventStats, tag: string): void {
		const body = this.createCollapsibleSection(container, displayName, `${stats.total} 场`, false, `stats:event:${tag}`);

		if (stats.items.length === 0) {
			body.createDiv({ text: `No ${displayName} records.`, cls: 'calendar-ledger-empty' });
			return;
		}

		for (const item of stats.items) {
			const row = body.createDiv({ cls: 'calendar-ledger-stats-item' });
			row.createSpan({ text: item.displayDate, cls: 'calendar-ledger-stats-item-date' });
			row.createSpan({ text: item.name, cls: 'calendar-ledger-stats-item-text' });
			const line = item.lineStart;
			const title = item.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
	}

	private renderMonthlyDistributionSection(container: HTMLElement, displayName: string, stats: MonthlyDistributionStats, tag: string): void {
		const body = this.createCollapsibleSection(container, displayName, `${stats.total} 段`, false, `stats:monthly:${tag}`);

		if (stats.items.length === 0) {
			body.createDiv({ text: `No ${displayName} records.`, cls: 'calendar-ledger-empty' });
			return;
		}

		for (const item of stats.items) {
			const row = body.createDiv({ cls: 'calendar-ledger-stats-item' });
			row.createSpan({ text: item.date.slice(5), cls: 'calendar-ledger-stats-item-date' });
			row.createSpan({ text: item.text, cls: 'calendar-ledger-stats-item-text' });
			const line = item.lineStart;
			const title = item.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
	}

	private renderRangeSection(container: HTMLElement, displayName: string, stats: RangeStats, tag: string): void {
		const body = this.createCollapsibleSection(container, displayName, `${stats.total} 次`, false, `stats:range:${tag}`);

		if (stats.items.length === 0) {
			body.createDiv({ text: `No ${displayName} records.`, cls: 'calendar-ledger-empty' });
			return;
		}

		for (const item of stats.items) {
			const row = body.createDiv({ cls: 'calendar-ledger-stats-item' });
			row.createSpan({ text: item.displayDate, cls: 'calendar-ledger-stats-item-date' });
			row.createSpan({ text: item.place, cls: 'calendar-ledger-stats-item-text' });
			const line = item.lineStart;
			const title = item.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
	}

	private renderMonthlySummarySection(
		container: HTMLElement,
		items: MonthlySummaryItem[],
		columns: string[],
	): void {
		const body = this.createCollapsibleSection(container, 'Monthly Summary', '', false, 'stats:monthly-summary');

		if (items.length === 0 || columns.length === 0) {
			body.createDiv({ text: 'No records.', cls: 'calendar-ledger-empty' });
			return;
		}

		const tableWrap = body.createDiv({ cls: 'calendar-ledger-table-scroll' });
		const table = tableWrap.createEl('table', { cls: 'calendar-ledger-stats-table' });
		const thead = table.createEl('thead');
		const headRow = thead.createEl('tr');
		headRow.createEl('th', { text: 'Month' });
		for (const tag of columns) {
			headRow.createEl('th', { text: tag.charAt(0).toUpperCase() + tag.slice(1) });
		}

		const tbody = table.createEl('tbody');
		for (const item of items) {
			const tr = tbody.createEl('tr');
			tr.createEl('td', { text: item.monthKey });
			for (const tag of columns) {
				tr.createEl('td', { text: String(item.counts[tag] ?? 0) });
			}
		}
	}

	// ==================== Heatmap Tab ====================

	private renderHeatmapTab(container: HTMLElement): void {
		const blocks = this.cachedDayBlocks;

		// 年份选择器
		const years = collectYears(blocks);
		if (!years.includes(this.heatmapYear)) {
			this.heatmapYear = years[0] ?? new Date().getFullYear();
		}

		const subtoolbar = container.createDiv({ cls: 'calendar-ledger-subtoolbar calendar-ledger-heatmap-toolbar' });
		subtoolbar.createSpan({ text: 'Year', cls: 'calendar-ledger-heatmap-year-label' });
		const select = subtoolbar.createEl('select', { cls: 'calendar-ledger-heatmap-year-select' });
		for (const y of years) {
			const opt = select.createEl('option', { text: String(y), value: String(y) });
			if (y === this.heatmapYear) opt.selected = true;
		}
		select.addEventListener('change', () => {
			this.heatmapYear = Number(select.value);
			void this.render();
		});

		const year = this.heatmapYear;

		// 从 visualizationTagMappings 派生各模块的 tag 列表（含 displayName）
		const mappings = this.settings.visualizationTagMappings;
		const activityEntries = Object.entries(mappings)
			.filter(([, m]) => m.vizType === 'activity')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		const eventEntries = Object.entries(mappings)
			.filter(([, m]) => m.vizType === 'event')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		const monthlyEntries = Object.entries(mappings)
			.filter(([, m]) => m.vizType === 'monthly')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		const rangeMappings = Object.entries(mappings)
			.filter(([, m]) => m.vizType === 'range')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));

		// 1. Activity Heatmap
		if (activityEntries.length > 0) {
			const data = computeActivityHeatmap(
				blocks, year, this.settings.weekStartsOn, activityEntries.map((e) => e.tag),
			);
			this.renderHeatmapSection(
				container,
				data,
				this.vizSectionTitle(activityEntries, 'Heatmap', 'Activity Heatmap'),
				`heatmap:activity:${activityEntries.map((e) => e.tag).join(',')}`,
			);
		}

		// 2. Event Timeline
		if (eventEntries.length > 0) {
			const data = computeEventTimeline(blocks, year, eventEntries.map((e) => e.tag));
			this.renderTimelineSection(
				container,
				data,
				this.vizSectionTitle(eventEntries, 'Timeline', 'Event Timeline'),
				`heatmap:event:${eventEntries.map((e) => e.tag).join(',')}`,
			);
		}

		// 3. Monthly Distribution
		if (monthlyEntries.length > 0) {
			const data = computeMonthlyDistribution(blocks, year, monthlyEntries.map((e) => e.tag));
			this.renderDistributionSection(
				container,
				data,
				this.vizSectionTitle(monthlyEntries, 'Distribution', 'Monthly Distribution'),
				`heatmap:monthly:${monthlyEntries.map((e) => e.tag).join(',')}`,
			);
		}

		// 4. Range View — 每个映射为 range 的 tag 一个独立 section
		for (const mapping of rangeMappings) {
			const tagRangeData = computeRangesByTag(blocks, year, mapping.tag);
			this.renderTagRangeSection(container, tagRangeData, mapping.displayName, `heatmap:range:${mapping.tag}`);
		}
	}

	// ---------- Activity Heatmap ----------

	private vizSectionTitle(
		entries: { tag: string; displayName: string }[],
		suffix: string,
		generic: string,
	): string {
		if (entries.length === 1) {
			return `${entries[0]!.displayName} ${suffix}`;
		}
		return generic;
	}

	private renderHeatmapSection(
		container: HTMLElement,
		data: ActivityHeatmapData,
		title: string,
		stateKey: string,
	): void {
		const body = this.createCollapsibleSection(
			container,
			title,
			`${data.total} 次 · ${data.activeDays} 天`,
			true,
			stateKey,
		);

		const summary = body.createDiv({ cls: 'calendar-ledger-heatmap-summary' });
		summary.createSpan({ text: `${data.year}`, cls: 'calendar-ledger-heatmap-year-tag' });
		summary.createSpan({
			text: `Total ${data.total} · Active ${data.activeDays} days`,
			cls: 'calendar-ledger-heatmap-summary-text',
		});

		if (data.total === 0) {
			body.createDiv({ text: 'No activity records this year.', cls: 'calendar-ledger-empty' });
			return;
		}

		// 网格容器（横向可滚动）
		const wrap = body.createDiv({ cls: 'calendar-ledger-heatmap-wrap' });
		const grid = wrap.createDiv({ cls: 'calendar-ledger-heatmap-grid' });

		// 按列号计算月份归属
		const colMonth: number[] = [];
		for (const cell of data.cells) {
			colMonth[cell.col] = Number(cell.date.slice(5, 7));
		}
		// 标记月份起始列
		const monthStartCols = new Set<number>();
		let lastM = -1;
		for (let c = 0; c < data.weekCount; c++) {
			const m = colMonth[c] ?? lastM;
			if (m !== lastM && m != null) {
				monthStartCols.add(c);
				lastM = m;
			}
		}

		// 月份标签行
		const monthLabelRow = grid.createDiv({ cls: 'calendar-ledger-heatmap-month-labels' });
		monthLabelRow.createDiv({ cls: 'calendar-ledger-heatmap-dow-spacer' });
		const monthsRow = monthLabelRow.createDiv({ cls: 'calendar-ledger-heatmap-months' });
		const monthCells = monthsRow.createDiv({ cls: 'calendar-ledger-heatmap-months-inner' });
		let lastMonth = -1;
		for (let c = 0; c < data.weekCount; c++) {
			const m = colMonth[c] ?? lastMonth;
			const label = monthCells.createEl('span', { cls: 'calendar-ledger-heatmap-month-label' });
			if (m !== lastMonth && m != null) {
				label.textContent = monthAbbr(`0000-${String(m).padStart(2, '0')}`);
				lastMonth = m;
			}
		}

		// 网格主体：7 行 × N 列
		const gridBody = grid.createDiv({ cls: 'calendar-ledger-heatmap-body' });

		// 星期标签列
		const dowLabels = this.settings.weekStartsOn === 'monday'
			? ['Mon', '', 'Wed', '', 'Fri', '', 'Sun']
			: ['Sun', '', 'Tue', '', 'Thu', '', 'Sat'];
		const dowCol = gridBody.createDiv({ cls: 'calendar-ledger-heatmap-dow' });
		for (const d of dowLabels) {
			dowCol.createDiv({ text: d, cls: 'calendar-ledger-heatmap-dow-label' });
		}

		// 单元格区域
		const cellsArea = gridBody.createDiv({ cls: 'calendar-ledger-heatmap-cells' });
		// 构建二维数组（weekCount 列 × 7 行）
		const grid2d: (ActivityHeatmapData['cells'][number] | null)[][] = [];
		for (let c = 0; c < data.weekCount; c++) {
			grid2d.push([null, null, null, null, null, null, null]);
		}
		for (const cell of data.cells) {
			if (cell.col >= 0 && cell.col < data.weekCount) {
				grid2d[cell.col]![cell.row] = cell;
			}
		}
		for (let c = 0; c < data.weekCount; c++) {
			const col = cellsArea.createDiv({ cls: 'calendar-ledger-heatmap-col' });
			if (monthStartCols.has(c)) {
				col.addClass('calendar-ledger-month-start');
			}
			for (let r = 0; r < 7; r++) {
				const cell = grid2d[c]![r];
				const cellEl = col.createDiv({ cls: 'calendar-ledger-heatmap-cell' });
				const intensity = cell ? activityIntensity(cell.count, data.maxCount) : 0;
				cellEl.addClass(`calendar-ledger-heat-level-${intensity}`);
				if (cell) {
					// tooltip：完整日期 + 内容
					const weekday = new Date(cell.date + 'T00:00:00').toLocaleDateString('en', { weekday: 'short' });
					const parts: string[] = [`${cell.date} ${weekday}`];
					if (cell.count > 0) {
						parts.push(`${cell.count} activity${cell.count > 1 ? 'ies' : ''}`);
						if (cell.content) parts.push(cell.content);
					}
					cellEl.setAttribute('title', parts.join('\n'));
					if (cell.count > 0) {
						cellEl.addEventListener('click', (e) => {
							e.stopPropagation();
							e.preventDefault();
							void this.navigateToLine(cell.lineStart, cell.title);
						});
						cellEl.addClass('calendar-ledger-heatmap-cell-clickable');
					}
				}
			}
		}

		// 图例
		const legend = body.createDiv({ cls: 'calendar-ledger-heatmap-legend' });
		legend.createSpan({ text: 'Less', cls: 'calendar-ledger-heatmap-legend-text' });
		const legendCells = legend.createDiv({ cls: 'calendar-ledger-heatmap-legend-cells' });
		for (let i = 0; i <= 4; i++) {
			legendCells.createDiv({ cls: `calendar-ledger-heatmap-cell calendar-ledger-heat-level-${i}` });
		}
		legend.createSpan({ text: 'More', cls: 'calendar-ledger-heatmap-legend-text' });
	}

	// ---------- Live Timeline ----------

	private renderTimelineSection(
		container: HTMLElement,
		data: EventTimelineData,
		title: string,
		stateKey: string,
	): void {
		const body = this.createCollapsibleSection(
			container,
			title,
			`${data.total} 场`,
			true,
			stateKey,
		);

		if (data.total === 0) {
			body.createDiv({ text: 'No records this year.', cls: 'calendar-ledger-empty' });
			return;
		}

		for (const month of data.byMonth) {
			const monthRow = body.createDiv({ cls: 'calendar-ledger-timeline-month' });
			monthRow.createSpan({
				text: monthAbbr(month.monthKey),
				cls: 'calendar-ledger-timeline-month-label',
			});
			const itemsEl = monthRow.createDiv({ cls: 'calendar-ledger-timeline-items' });
			for (const item of month.items) {
				const itemEl = itemsEl.createDiv({ cls: 'calendar-ledger-timeline-item' });
				const marker = itemEl.createDiv({ cls: 'calendar-ledger-timeline-marker' });
				marker.addClass(item.isRange ? 'calendar-ledger-timeline-range' : 'calendar-ledger-timeline-dot');
				const info = itemEl.createDiv({ cls: 'calendar-ledger-timeline-info' });
				info.createSpan({ text: item.name, cls: 'calendar-ledger-timeline-name' });
				const dateText = item.isRange
					? `${item.startDate.slice(5)}~${item.endDate.slice(5)}`
					: item.startDate.slice(5);
				info.createSpan({ text: dateText, cls: 'calendar-ledger-timeline-date' });
				if (item.isRange) {
					info.createSpan({
						text: `${item.duration}d`,
						cls: 'calendar-ledger-timeline-duration',
					});
				}
				const line = item.lineStart;
				const title = item.title;
				itemEl.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.selectRow(itemEl);
					void this.navigateToLine(line, title);
				});
			}
		}
	}

	// ---------- Monthly Distribution ----------

	private renderDistributionSection(
		container: HTMLElement,
		data: MonthlyDistributionData,
		title: string,
		stateKey: string,
	): void {
		const body = this.createCollapsibleSection(
			container,
			title,
			`${data.total} 段`,
			true,
			stateKey,
		);

		if (data.total === 0) {
			body.createDiv({ text: 'No records this year.', cls: 'calendar-ledger-empty' });
			return;
		}

		// 柱状图
		const chart = body.createDiv({ cls: 'calendar-ledger-bar-chart' });
		const barsRow = chart.createDiv({ cls: 'calendar-ledger-bar-row' });
		for (const m of data.byMonth) {
			const barCol = barsRow.createDiv({ cls: 'calendar-ledger-bar-col' });
			const barWrap = barCol.createDiv({ cls: 'calendar-ledger-bar-wrap' });
			const heightPct = data.maxCount > 0 ? (m.count / data.maxCount) * 100 : 0;
			const bar = barWrap.createDiv({ cls: 'calendar-ledger-bar' });
			bar.style.height = `${heightPct}%`;
			if (m.count > 0) {
				bar.setAttribute('title', `${monthAbbr(m.monthKey)}: ${m.count}`);
				bar.addEventListener('click', (e) => {
					e.stopPropagation();
					e.preventDefault();
					this.toggleMonthlyDistributionDetail(body, m);
				});
			} else {
				bar.addClass('calendar-ledger-bar-empty');
			}
			barCol.createDiv({
				text: monthAbbr(m.monthKey),
				cls: 'calendar-ledger-bar-label',
			});
		}

		// 明细容器（点击柱子展开）
		const detail = body.createDiv({ cls: 'calendar-ledger-bar-detail' });
		detail.addClass('is-hidden');
	}

	/**
	 * 切换某月 distribution 明细显示。
	 */
	private toggleMonthlyDistributionDetail(
		container: HTMLElement,
		month: MonthlyDistributionData['byMonth'][number],
	): void {
		const detail = container.querySelector<HTMLElement>('.calendar-ledger-bar-detail');
		if (!detail) return;
		const existing = detail.querySelector('.calendar-ledger-bar-detail-month');
		if (existing && (existing as HTMLElement).dataset.monthKey === month.monthKey) {
			detail.addClass('is-hidden');
			detail.empty();
			return;
		}
		detail.empty();
		const monthWrap = detail.createDiv({ cls: 'calendar-ledger-bar-detail-month' });
		monthWrap.dataset.monthKey = month.monthKey;
		monthWrap.createDiv({
			text: `${monthAbbr(month.monthKey)} · ${month.count} 段`,
			cls: 'calendar-ledger-bar-detail-header',
		});
		for (const item of month.items) {
			const row = monthWrap.createDiv({ cls: 'calendar-ledger-stats-item' });
			row.createSpan({ text: item.date.slice(5), cls: 'calendar-ledger-stats-item-date' });
			row.createSpan({ text: item.text, cls: 'calendar-ledger-stats-item-text' });
			const line = item.lineStart;
			const title = item.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
		detail.removeClass('is-hidden');
	}

	// ---------- Tag Range View ----------

	private renderTagRangeSection(
		container: HTMLElement,
		data: TagRangeData,
		displayName: string,
		stateKey: string,
	): void {
		const name = displayName || data.tag;
		const body = this.createCollapsibleSection(
			container,
			`${name} Range`,
			`${data.total} 次 · ${data.totalDays} 天`,
			true,
			stateKey,
		);

		if (data.total === 0) {
			body.createDiv({
				text: `No range records for #${data.tag} this year.`,
				cls: 'calendar-ledger-empty',
			});
			return;
		}

		for (const item of data.items) {
			const row = body.createDiv({ cls: 'calendar-ledger-range-row' });
			const dateCol = row.createDiv({ cls: 'calendar-ledger-range-date' });
			dateCol.createSpan({
				text: `${item.startDate.slice(5)}~${item.endDate.slice(5)}`,
			});
			const barCol = row.createDiv({ cls: 'calendar-ledger-range-bar-col' });
			const bar = barCol.createDiv({ cls: 'calendar-ledger-range-bar' });
			// 条长严格按 duration 占该组 maxDuration 的比例
			const widthPct = data.maxDuration > 0
				? (item.duration / data.maxDuration) * 100
				: 100;
			bar.style.width = `${widthPct}%`;
			bar.createSpan({ text: item.name, cls: 'calendar-ledger-range-place' });
			row.createSpan({ text: `${item.duration}d`, cls: 'calendar-ledger-range-duration' });

			const line = item.lineStart;
			const title = item.title;
			row.addEventListener('click', (e) => {
				e.stopPropagation();
				e.preventDefault();
				this.selectRow(row);
				void this.navigateToLine(line, title);
			});
		}
	}

	// ==================== Year Tab ====================

	private renderYearTab(container: HTMLElement): void {
		const blocks = this.cachedDayBlocks;

		// 年份选择器
		const years = collectYears(blocks);
		if (!years.includes(this.yearSummaryYear)) {
			this.yearSummaryYear = years[0] ?? new Date().getFullYear();
		}

		const subtoolbar = container.createDiv({ cls: 'calendar-ledger-subtoolbar calendar-ledger-year-toolbar' });
		subtoolbar.createSpan({ text: 'Year', cls: 'calendar-ledger-year-label' });
		const select = subtoolbar.createEl('select', { cls: 'calendar-ledger-year-select' });
		for (const y of years) {
			const opt = select.createEl('option', { text: String(y), value: String(y) });
			if (y === this.yearSummaryYear) opt.selected = true;
		}
		select.addEventListener('change', () => {
			this.yearSummaryYear = Number(select.value);
			void this.render();
		});

		const year = this.yearSummaryYear;
		const yearBlocks = blocks.filter((b) => b.date.startsWith(String(year)));

		if (yearBlocks.filter((b) => b.hasContent).length === 0) {
			container.createDiv({ text: `No content in ${year}.`, cls: 'calendar-ledger-empty' });
			return;
		}

		this.renderYearSummaryCards(container, yearBlocks, year);
		this.renderYearTimeline(container, yearBlocks, year);
		this.renderYearDataOverview(container, yearBlocks, year);
	}

	private createYearSection(container: HTMLElement, title: string): HTMLElement {
		const section = container.createDiv({ cls: 'calendar-ledger-year-section' });
		section.createDiv({ text: title, cls: 'calendar-ledger-year-section-title' });
		return section.createDiv({ cls: 'calendar-ledger-year-section-body' });
	}

	private renderYearSummaryCards(container: HTMLElement, yearBlocks: CalendarDayBlock[], year: number): void {
		const body = this.createYearSection(container, 'Summary Cards');

		const yc = this.settings.yearSummaryCards;
		const tagSettings = yc.tags ?? {};
		const mappings = this.settings.visualizationTagMappings;

		// 统一获取所有 tag 的 occurrence 计数（保留 Calendar.md 原始大小写）
		const tagMap = scanAllTags(yearBlocks);

		const cardData: { value: string; label: string }[] = [];

		// 固定通用项：Recorded Days
		if (yc.showRecordedDays) {
			const daysWithContent = yearBlocks.filter((b) => b.hasContent).length;
			cardData.push({ value: String(daysWithContent), label: 'Recorded Days' });
		}

		// 动态项：遍历 scanAllTags 结果（当年出现的 tag），按 event-type 驱动
		// count: 所有 event type（showCount=true 时生成）
		// days: 仅 range event（showDays=true 时生成，计算去重日期区间长度）
		for (const [tag, occurrences] of tagMap.entries()) {
			const eventType = classifyTagEventType(tag, mappings);
			const settings = tagSettings[tag] ?? { showCount: true, showDays: false };
			const displayName = mappings[tag]?.displayName ?? tag;

			if (settings.showCount) {
				cardData.push({ value: String(occurrences.length), label: displayName });
			}

				if (eventType === 'range' && settings.showDays) {
					const data = computeRangesByTag(this.cachedDayBlocks, year, tag);
					cardData.push({ value: String(data.totalDays), label: `${displayName} Days` });
				}
		}

		if (cardData.length === 0) {
			body.createDiv({ text: 'No cards enabled. Enable cards in Settings.', cls: 'calendar-ledger-empty' });
			return;
		}

		const cardsEl = body.createDiv({ cls: 'calendar-ledger-year-cards' });
		for (const c of cardData) {
			const card = cardsEl.createDiv({ cls: 'calendar-ledger-year-card' });
			card.createDiv({ text: c.value, cls: 'calendar-ledger-year-card-value' });
			card.createDiv({ text: c.label, cls: 'calendar-ledger-year-card-label' });
		}
	}

	private renderYearTimeline(container: HTMLElement, yearBlocks: CalendarDayBlock[], year: number): void {
		const body = this.createYearSection(container, 'Year Timeline');

		interface YearTimelineEvent {
			sortDate: string;
			monthKey: string;
			dateLabel: string;
			text: string;
			tagLabel: string;
			lineStart: number;
			title: string;
		}

		const events: YearTimelineEvent[] = [];

		// Event-type tags (live / ...) — iterate over all event-mapped tags
		const eventMappings = Object.entries(this.settings.visualizationTagMappings)
			.filter(([, m]) => m.vizType === 'event')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		for (const mapping of eventMappings) {
			for (const it of computeEventStats(yearBlocks, [mapping.tag]).items) {
				events.push({
					sortDate: it.date,
					monthKey: it.date.slice(0, 7),
					dateLabel: it.displayDate,
					text: it.name,
					tagLabel: mapping.displayName,
					lineStart: it.lineStart,
					title: it.title,
				});
			}
		}

		// Monthly-type tags (flight / ...) — iterate over all monthly-mapped tags
		const monthlyMappings = Object.entries(this.settings.visualizationTagMappings)
			.filter(([, m]) => m.vizType === 'monthly')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		for (const mapping of monthlyMappings) {
			for (const it of computeMonthlyDistributionStats(yearBlocks, [mapping.tag]).items) {
				events.push({
					sortDate: it.date,
					monthKey: it.date.slice(0, 7),
					dateLabel: it.date.slice(5),
					text: it.text,
					tagLabel: mapping.displayName,
					lineStart: it.lineStart,
					title: it.title,
				});
			}
		}

		// Range events from visualizationTagMappings (travel / I-go / She-come / ...)
		// 传全量 blocks，computeRangesByTag 内部按 startDate 年份过滤
		const rangeMappings = Object.entries(this.settings.visualizationTagMappings)
			.filter(([, m]) => m.vizType === 'range')
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		for (const mapping of rangeMappings) {
			const data = computeRangesByTag(this.cachedDayBlocks, year, mapping.tag);
			for (const it of data.items) {
				events.push({
					sortDate: it.startDate,
					monthKey: it.startDate.slice(0, 7),
					dateLabel: `${it.startDate.slice(5)}~${it.endDate.slice(5)}`,
					text: `${it.name} (${it.duration}d)`,
					tagLabel: mapping.displayName,
					lineStart: it.lineStart,
					title: it.title,
				});
			}
		}

		if (events.length === 0) {
			body.createDiv({ text: 'No events.', cls: 'calendar-ledger-empty' });
			return;
		}

		// Group by month
		const byMonth = new Map<string, YearTimelineEvent[]>();
		for (const ev of events) {
			if (!byMonth.has(ev.monthKey)) byMonth.set(ev.monthKey, []);
			byMonth.get(ev.monthKey)!.push(ev);
		}
		const monthKeys = Array.from(byMonth.keys()).sort((a, b) => a.localeCompare(b));

		const timeline = body.createDiv({ cls: 'calendar-ledger-year-timeline' });
		for (const mk of monthKeys) {
			const evs = byMonth.get(mk)!.sort((a, b) => a.sortDate.localeCompare(b.sortDate));
			const monthBlock = timeline.createDiv({ cls: 'calendar-ledger-year-month' });
			monthBlock.createDiv({ text: monthAbbr(mk), cls: 'calendar-ledger-year-month-title' });
			for (const ev of evs) {
				const row = monthBlock.createDiv({ cls: 'calendar-ledger-year-event' });
				row.createSpan({ text: ev.dateLabel, cls: 'calendar-ledger-year-event-date' });
				row.createSpan({ text: ev.tagLabel, cls: 'calendar-ledger-year-event-tag' });
				row.createSpan({ text: ev.text, cls: 'calendar-ledger-year-event-text' });
				row.addEventListener('click', (e) => {
					e.stopPropagation();
					this.selectRow(row);
					void this.navigateToLine(ev.lineStart, ev.title);
				});
			}
		}
	}

	private renderYearDataOverview(container: HTMLElement, yearBlocks: CalendarDayBlock[], year: number): void {
		const body = this.createYearSection(container, 'Year Data Overview');
		const enabledTags = new Set(this.settings.enabledStatsTags ?? []);
		const tagMap = scanAllTags(yearBlocks);

		// Monthly Summary table — 列从 enabledStatsTags 动态生成
		const summaryColumns = this.getEnabledExistingTags(tagMap, enabledTags);
		const monthlyItems = computeMonthlySummary(yearBlocks, summaryColumns);
		if (monthlyItems.length === 0 || summaryColumns.length === 0) {
			body.createDiv({ text: 'No summary data.', cls: 'calendar-ledger-empty' });
		} else {
			const tableWrap = body.createDiv({ cls: 'calendar-ledger-table-scroll' });
			const table = tableWrap.createEl('table', { cls: 'calendar-ledger-stats-table calendar-ledger-year-overview-table' });
			const thead = table.createEl('thead');
			const headRow = thead.createEl('tr');
			headRow.createEl('th', { text: 'Month' });
			for (const tag of summaryColumns) {
				headRow.createEl('th', { text: tag.charAt(0).toUpperCase() + tag.slice(1) });
			}
			headRow.createEl('th', { text: 'Total' });

			const tbody = table.createEl('tbody');
			for (const item of monthlyItems) {
				const tr = tbody.createEl('tr');
				tr.createEl('td', { text: monthAbbr(item.monthKey) });
				let rowTotal = 0;
				for (const tag of summaryColumns) {
					const c = item.counts[tag] ?? 0;
					rowTotal += c;
					tr.createEl('td', { text: String(c) });
				}
				tr.createEl('td', { text: String(rowTotal) });
			}
		}

		// Range Events — 所有配置的 range 标签（travel / I-go / She-come），
		// 独立于 enabledStatsTags，确保 I-go / She-come 在 Data Overview 中单独显示
		const rangeMappings = Object.entries(this.settings.visualizationTagMappings)
			.filter(([tag, m]) => m.vizType === 'range' && enabledTags.has(tag))
			.map(([tag, m]) => ({ tag, displayName: m.displayName ?? tag }));
		if (rangeMappings.length > 0) {
			body.createDiv({ text: 'Range Events', cls: 'calendar-ledger-year-subtitle' });
			const rtableWrap = body.createDiv({ cls: 'calendar-ledger-table-scroll' });
			const rtable = rtableWrap.createEl('table', { cls: 'calendar-ledger-stats-table calendar-ledger-year-overview-table' });
			const rthead = rtable.createEl('thead');
			const rheadRow = rthead.createEl('tr');
			rheadRow.createEl('th', { text: 'Tag' });
			rheadRow.createEl('th', { text: 'Events' });
			rheadRow.createEl('th', { text: 'Days' });
			const rtbody = rtable.createEl('tbody');
			for (const mapping of rangeMappings) {
				const data = computeRangesByTag(this.cachedDayBlocks, year, mapping.tag);
				const eventCount = data.items.length;
				const tr = rtbody.createEl('tr');
				tr.createEl('td', { text: mapping.displayName });
				tr.createEl('td', { text: String(eventCount) });
				tr.createEl('td', { text: String(data.totalDays) });
			}
		}

		// Tag totals list — 仅显示 enabledStatsTags 中的标签
		const tagTotals: { tag: string; count: number }[] = [];
		for (const [tag, occs] of tagMap.entries()) {
			if (!enabledTags.has(tag)) continue;
			if (occs.length === 0) continue;
			tagTotals.push({ tag, count: occs.length });
		}
		tagTotals.sort((a, b) => b.count - a.count);

		if (tagTotals.length > 0) {
			const list = body.createDiv({ cls: 'calendar-ledger-year-tag-totals' });
			for (const t of tagTotals) {
				const item = list.createDiv({ cls: 'calendar-ledger-year-tag-total' });
				item.createSpan({ text: `#${t.tag}`, cls: 'calendar-ledger-year-tag-total-name' });
				item.createSpan({ text: String(t.count), cls: 'calendar-ledger-year-tag-total-count' });
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
			grouped[label].push(day);
		}
		return grouped;
	}

	private getEnabledExistingTags(
		tagMap: Map<string, TagOccurrence[]>,
		enabledTags: Set<string>,
	): string[] {
		return Array.from(tagMap.keys())
			.filter((tag) => enabledTags.has(tag))
			.sort((a, b) => a.localeCompare(b));
	}

	/**
	 * 设置当前选中的 row 高亮（类似 Obsidian 文件树的选中态）
	 *
	 * 移除其他 row 的 .is-active，给当前 row 加上。重新渲染 tab 时选中态会重置。
	 */
	private selectRow(row: HTMLElement): void {
		this.contentEl.querySelectorAll('.is-active').forEach((el) => {
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
