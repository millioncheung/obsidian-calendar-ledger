import type { CalendarDayBlock, VisualizationTagMapping } from './types';
import { parseRangesFromText, type ParsedRange } from './date-utils';

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * 将 inline 内容拆分为单条 item。
 *
 * 去掉前导 `|` 分隔符,按中文分号 `；` 拆分。
 */
export function splitItems(inlineContent: string): string[] {
	let text = inlineContent.trim();
	if (text.startsWith('|') || text.startsWith('｜')) {
		text = text.slice(1).trim();
	}
	return text
		.split('；')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export interface ItemInfo {
	tag: string | null;
	text: string;
	cleanText: string;
	link: string | null;
	range: ParsedRange | null;
}

/**
 * 从单条 item 中提取 tag / text / link / range。
 *
 * @param item      单条内容(如 "#fitness 胸肩"、"#live [[演唱会]] 12-18~12-20")
 * @param yearHint  年份上下文,用于解析短日期范围
 */
export function extractItemInfo(item: string, yearHint: number): ItemInfo {
	const items = extractAllItems(item, yearHint);
	return items.length > 0 ? items[0]! : { tag: null, text: '', cleanText: '', link: null, range: null };
}

const TAG_REGEX = /#([\w\u4e00-\u9fff-]+)/g;

/**
 * 从单条 item 中提取所有标签及其信息。
 *
 * 一条 item 可能包含多个标签（如 "#fitness #outdoor 跑步"）。这些标签
 * 共同描述同一条记录，因此每个标签都关联同一份正文、链接和日期范围。
 */
export function extractAllItems(item: string, yearHint: number): ItemInfo[] {
	const results: ItemInfo[] = [];
	const matches: RegExpExecArray[] = [];
	let m: RegExpExecArray | null;
	while ((m = TAG_REGEX.exec(item)) !== null) {
		matches.push(m);
	}
	TAG_REGEX.lastIndex = 0;

	if (matches.length === 0) return results;

	const text = item.replace(/#[\w\u4e00-\u9fff-]+/g, ' ').replace(/\s+/g, ' ').trim();
	const linkMatch = text.match(/\[\[([^\]]+)\]\]/);
	const link = linkMatch ? (linkMatch[1]!.split('|')[0] ?? linkMatch[1]!) : null;
	const ranges = parseRangesFromText(text, yearHint);
	const range = ranges.length > 0 ? ranges[0]! : null;
	let cleanText = range ? text.replace(range.rawText, '').trim() : text;
	cleanText = cleanText
		.replace(/[；|｜]\s*[；|｜]/g, '；')
		.replace(/^[；|｜]\s*/, '')
		.replace(/\s*[；|｜]$/, '')
		.replace(/\s+/g, ' ')
		.trim();

	const uniqueTags = new Set(matches.map((match) => match[1]!));
	for (const tag of uniqueTags) {
		results.push({ tag, text, cleanText, link, range });
	}

	return results;
}

// ────────────────────────────────────────────────────────────────
// 动态标签扫描
// ────────────────────────────────────────────────────────────────

export interface TagOccurrence {
	tag: string;
	date: string;          // YYYY-MM-DD (source date)
	monthKey: string;      // YYYY-MM
	displayDate: string;   // "06-15" 或 "06-15~06-27"
	text: string;          // tag 后的完整文本(含 range)
	cleanText: string;     // tag 后去 range 的文本
	link: string | null;
	range: ParsedRange | null;
	lineStart: number;
	title: string;
}

/**
 * 扫描所有 dayBlocks,动态收集所有标签及其出现记录。
 */
export function scanAllTags(dayBlocks: CalendarDayBlock[]): Map<string, TagOccurrence[]> {
	const tagMap = new Map<string, TagOccurrence[]>();

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag) continue;

				const occ: TagOccurrence = {
					tag: info.tag,
					date: day.date,
					monthKey: day.date.slice(0, 7),
					displayDate: info.range
						? `${info.range.startDate.slice(5)}~${info.range.endDate.slice(5)}`
						: day.date.slice(5),
					text: info.text,
					cleanText: info.cleanText,
					link: info.link,
					range: info.range,
					lineStart: day.lineStart,
					title: day.title,
				};

				if (!tagMap.has(info.tag)) tagMap.set(info.tag, []);
				tagMap.get(info.tag)!.push(occ);
			}
		}
	}

	return tagMap;
}

export type TagCategory = 'activity' | 'event' | 'monthly' | 'range' | 'simple';

/**
 * 根据 visualizationTagMappings.vizType 判定标签类别。
 *
 * - activity / event / monthly / range: 有 mapping 且 vizType 非 none
 * - simple: 无 mapping (或 none)
 */
export function categorizeTag(
	tag: string,
	mappings: Record<string, VisualizationTagMapping>,
): TagCategory {
	const mapping = mappings[tag];
	if (mapping && mapping.vizType !== 'none') {
		return mapping.vizType;
	}
	return 'simple';
}

// ────────────────────────────────────────────────────────────────
// Activity — 按出现次数统计,支持按月展开 (vizType: activity)
// ────────────────────────────────────────────────────────────────

export interface ActivityItem {
	date: string;
	monthKey: string;
	lineStart: number;
	title: string;
}

export interface ActivityStats {
	byMonth: { monthKey: string; count: number; items: ActivityItem[] }[];
	total: number;
	items: ActivityItem[];
}

export function computeActivityStats(dayBlocks: CalendarDayBlock[], tags: string[]): ActivityStats {
	const tagSet = new Set(tags);
	const monthMap = new Map<string, ActivityItem[]>();
	const allItems: ActivityItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));
		const monthKey = day.date.slice(0, 7);

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;

				const fi: ActivityItem = {
					date: day.date,
					monthKey,
					lineStart: day.lineStart,
					title: day.title,
				};
				allItems.push(fi);
				if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
				monthMap.get(monthKey)!.push(fi);
			}
		}
	}

	const byMonth = Array.from(monthMap.entries())
		.map(([monthKey, items]) => ({ monthKey, count: items.length, items }))
		.sort((a, b) => a.monthKey.localeCompare(b.monthKey));

	return { byMonth, total: allItems.length, items: allItems };
}

// ────────────────────────────────────────────────────────────────
// Event — 按出现次数统计,跨日期记录只算 1 次 (vizType: event)
// ────────────────────────────────────────────────────────────────

export interface EventItem {
	date: string;
	displayDate: string;
	name: string;
	lineStart: number;
	title: string;
}

export interface EventStats {
	items: EventItem[];
	total: number;
}

export function computeEventStats(dayBlocks: CalendarDayBlock[], tags: string[]): EventStats {
	const tagSet = new Set(tags);
	const items: EventItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;

				const name = info.link ?? info.cleanText;
				if (!name) continue;

				items.push({
					date: day.date,
					displayDate: info.range
						? `${info.range.startDate.slice(5)}~${info.range.endDate.slice(5)}`
						: day.date.slice(5),
					name,
					lineStart: day.lineStart,
					title: day.title,
				});
			}
		}
	}

	items.sort((a, b) => a.date.localeCompare(b.date));
	return { items, total: items.length };
}

// ────────────────────────────────────────────────────────────────
// Monthly Distribution — 按条目统计 (vizType: monthly)
// ────────────────────────────────────────────────────────────────

export interface MonthlyDistributionItem {
	date: string;
	text: string;
	lineStart: number;
	title: string;
}

export interface MonthlyDistributionStats {
	items: MonthlyDistributionItem[];
	total: number;
}

export function computeMonthlyDistributionStats(dayBlocks: CalendarDayBlock[], tags: string[]): MonthlyDistributionStats {
	const tagSet = new Set(tags);
	const items: MonthlyDistributionItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;

				items.push({
					date: day.date,
					text: info.text,
					lineStart: day.lineStart,
					title: day.title,
				});
			}
		}
	}

	items.sort((a, b) => a.date.localeCompare(b.date));
	return { items, total: items.length };
}

// ────────────────────────────────────────────────────────────────
// Range — 按跨日期事件统计,跨日期只算一次 (vizType: range)
// ────────────────────────────────────────────────────────────────

export interface RangeItem {
	startDate: string;
	endDate: string;
	displayDate: string;
	place: string;
	lineStart: number;
	title: string;
}

export interface RangeStats {
	items: RangeItem[];
	total: number;
}

/**
 * 统计 range 类型 tag 事件。place 为 tag 后的文本,跨日期只算一次。
 */
export function computeRangeStats(dayBlocks: CalendarDayBlock[], tags: string[]): RangeStats {
	const tagSet = new Set(tags);
	const items: RangeItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;
				if (info.range === null) continue;

				const place = info.cleanText || info.tag;

				items.push({
					startDate: info.range.startDate,
					endDate: info.range.endDate,
					displayDate: `${info.range.startDate.slice(5)}~${info.range.endDate.slice(5)}`,
					place,
					lineStart: day.lineStart,
					title: day.title,
				});
			}
		}
	}

	const seen = new Set<string>();
	const deduped = items.filter((it) => {
		const key = `${it.startDate}~${it.endDate}\u0000${it.place}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	deduped.sort((a, b) => a.startDate.localeCompare(b.startDate));
	return { items: deduped, total: deduped.length };
}

// ────────────────────────────────────────────────────────────────
// Monthly Summary
// ────────────────────────────────────────────────────────────────

export interface MonthlySummaryItem {
	monthKey: string;
	counts: Record<string, number>;
}

export function computeMonthlySummary(
	dayBlocks: CalendarDayBlock[],
	tags: string[],
): MonthlySummaryItem[] {
	const map = new Map<string, MonthlySummaryItem>();

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));
		const monthKey = day.date.slice(0, 7);
		if (!map.has(monthKey)) {
			const counts: Record<string, number> = {};
			for (const t of tags) counts[t] = 0;
			map.set(monthKey, { monthKey, counts });
		}
		const entry = map.get(monthKey)!;

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag) continue;
				if (tags.includes(info.tag)) {
					entry.counts[info.tag] = (entry.counts[info.tag] ?? 0) + 1;
				}
			}
		}
	}

	return Array.from(map.values()).sort((a, b) => a.monthKey.localeCompare(b.monthKey));
}
