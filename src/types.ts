export interface SingleFileCalendarSettings {
	calendarFilePath: string;
	startYear: number;
	endYear: number;
	weekStartsOn: 'monday' | 'sunday';
	language: 'en' | 'zh';
	dateHeadingFormat: string;
	showWeekNumber: boolean;
	defaultOutlineLevel: 'year' | 'month' | 'week' | 'day';
}

export const DEFAULT_SETTINGS: SingleFileCalendarSettings = {
	calendarFilePath: 'Calendar.md',
	startYear: new Date().getFullYear(),
	endYear: new Date().getFullYear() + 2,
	weekStartsOn: 'monday',
	language: 'en',
	dateHeadingFormat: 'YYYY-MM-DD ddd',
	showWeekNumber: true,
	defaultOutlineLevel: 'month',
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