export type VisualizationType = 'none' | 'activity' | 'event' | 'monthly' | 'range';

export interface VisualizationTagMapping {
	vizType: VisualizationType;
	displayName?: string;
}

/**
 * Event-type classification for tags, derived from VisualizationTagMapping.
 *
 * - 'single-day': mapped to activity / event / monthly — count by occurrence
 * - 'range':      mapped to range — count by occurrence AND by deduplicated day span
 * - 'custom':     unmapped or mapped to 'none' — count by occurrence only
 */
export type TagEventType = 'single-day' | 'range' | 'custom';

export function classifyTagEventType(
	tag: string,
	mappings: Record<string, VisualizationTagMapping>,
): TagEventType {
	const mapping = mappings[tag];
	if (!mapping || mapping.vizType === 'none') return 'custom';
	if (mapping.vizType === 'range') return 'range';
	return 'single-day';
}

export interface YearSummaryTagCardSettings {
	showCount: boolean;
	showDays: boolean;
}

export interface YearSummaryCardSettings {
	showRecordedDays: boolean;
	tags: Record<string, YearSummaryTagCardSettings>;
}

export interface SidebarUiState {
	collapsibleSections: Record<string, boolean>;
}

export interface CalendarLedgerSettings {
	calendarFilePath: string;
	startYear: number;
	endYear: number;
	weekStartsOn: 'monday' | 'sunday';
	language: 'en' | 'zh';
	showWeekNumber: boolean;
	enabledStatsTags: string[];
	visualizationTagMappings: Record<string, VisualizationTagMapping>;
	yearSummaryCards: YearSummaryCardSettings;
	sidebarUiState: SidebarUiState;
}

export const DEFAULT_SETTINGS: CalendarLedgerSettings = {
	calendarFilePath: 'Calendar.md',
	startYear: new Date().getFullYear(),
	endYear: new Date().getFullYear() + 2,
	weekStartsOn: 'monday',
	language: 'en',
	showWeekNumber: true,
	enabledStatsTags: ['fitness', 'live', 'flight', 'travel'],
	visualizationTagMappings: {
		fitness: { vizType: 'activity', displayName: 'fitness' },
		live: { vizType: 'event', displayName: 'live' },
		flight: { vizType: 'monthly', displayName: 'flight' },
		travel: { vizType: 'range', displayName: 'travel' },
		'I-go': { vizType: 'range', displayName: 'I-go' },
		'She-come': { vizType: 'range', displayName: 'She-come' },
	},
	yearSummaryCards: {
		showRecordedDays: true,
		tags: {},
	},
	sidebarUiState: {
		collapsibleSections: {},
	},
};

export interface CalendarDayBlock {
	date: string;           // YYYY-MM-DD（新格式由 year heading 上下文补全）
	title: string;          // day 标题，如 "01-01 Thu" 或 "2026-01-01 Thu"（不含 ** 标记）
	lineStart: number;      // day bullet（或旧格式 H5 heading）所在行
	lineEnd: number;        // 该 day block 的最后一行（含子内容，去除尾部空行）
	content: string;        // day 标记下方缩进的子内容（保留缩进，旧格式二级 bullet）
	hasContent: boolean;    // content 去除空白后是否存在内容
	inlineContent: string;  // day bullet 行 ** 之后的 inline 内容（新格式）
	hasInline: boolean;     // inlineContent 是否有内容
	hasSubBullets: boolean; // 是否有旧格式二级 bullet 子内容
	tags: string[];         // 从 inline 内容中提取的 #tag（不含 # 前缀）
	links: string[];        // 从 inline 内容中提取的 [[link]]（不含 [[]] 标记）
	ranges: CalendarRange[];// 从 inline 内容中解析的日期范围
}

export interface CalendarRange {
	startDate: string;      // YYYY-MM-DD
	endDate: string;        // YYYY-MM-DD
	sourceDate: string;     // 写在哪一天（date 字段）
	text: string;           // 原始文本
	tags: string[];         // 关联标签
	links: string[];        // 关联双链
}

export interface CalendarOutlineNode {
	id: string;
	type: 'year' | 'month' | 'week' | 'day';
	title: string;
	date?: string;          // 仅 day 类型有值
	line: number;
	children: CalendarOutlineNode[];
}

export interface CalendarParseResult {
	outline: CalendarOutlineNode[];
	dayBlocks: CalendarDayBlock[];
	dayBlockMap: Record<string, CalendarDayBlock>;
}
