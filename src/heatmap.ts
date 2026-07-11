import type { CalendarDayBlock } from './types';
import { splitItems, extractAllItems } from './stats';
import {
	formatDate,
	generateDatesInRange,
	getDaysInMonth,
} from './date-utils';

// ────────────────────────────────────────────────────────────────
// Activity Heatmap — GitHub 风格年度热力图
// ────────────────────────────────────────────────────────────────

export interface ActivityHeatmapCell {
	date: string; // YYYY-MM-DD
	count: number; // 当天匹配 tag 出现次数
	lineStart: number; // 跳转用行号（count=0 时为 0）
	title: string;
	content: string; // 当天匹配的 item 文本（用于 tooltip）
	col: number; // 热力图列号（周）
	row: number; // 热力图行号（星期，0=weekStartsOn）
}

export interface ActivityHeatmapData {
	year: number;
	cells: ActivityHeatmapCell[]; // 全年所有天，按日期序
	total: number;
	maxCount: number;
	activeDays: number;
	weekCount: number; // 网格总列数
}

/**
 * 计算某日期在热力图网格中的 (col, row) 位置。
 *
 * 列 0 从包含 Jan 1 的那一周开始（按 weekStartsOn 对齐），
 * 行 0 = weekStartsOn 那一天。
 */
function getGridPos(
	date: Date,
	weekStartsOn: 'monday' | 'sunday',
): { col: number; row: number } {
	const year = date.getFullYear();
	const jan1 = new Date(year, 0, 1);
	const jan1Day = jan1.getDay(); // 0=Sun ... 6=Sat

	// Jan 1 相对 weekStartsOn 的偏移天数
	const offset = weekStartsOn === 'monday' ? (jan1Day + 6) % 7 : jan1Day;

	// 第 0 列的起始日（包含 Jan 1 那周的 weekStartsOn 当天）
	const weekStart = new Date(year, 0, 1 - offset);

	const daysSinceStart = Math.round(
		(date.getTime() - weekStart.getTime()) / 86400000,
	);
	const col = Math.floor(daysSinceStart / 7);

	const day = date.getDay();
	const row = weekStartsOn === 'monday' ? (day + 6) % 7 : day;

	return { col, row };
}

export function computeActivityHeatmap(
	dayBlocks: CalendarDayBlock[],
	year: number,
	weekStartsOn: 'monday' | 'sunday',
	tags: string[],
): ActivityHeatmapData {
	const tagSet = new Set(tags);
	// 统计当年每天的匹配 tag 次数
	const countMap = new Map<
		string,
		{ count: number; lineStart: number; title: string; content: string }
	>();
	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		if (!day.date.startsWith(String(year))) continue;
		const yearHint = Number(day.date.slice(0, 4));
		let dayCount = 0;
		const contentParts: string[] = [];
		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (info.tag && tagSet.has(info.tag)) {
					dayCount++;
					contentParts.push(item.trim());
				}
			}
		}
		if (dayCount > 0) {
			countMap.set(day.date, {
				count: dayCount,
				lineStart: day.lineStart,
				title: day.title,
				content: contentParts.join(' · '),
			});
		}
	}

	const cells: ActivityHeatmapCell[] = [];
	let total = 0;
	let maxCount = 0;
	let activeDays = 0;
	let weekCount = 0;

	for (let month = 1; month <= 12; month++) {
		const daysInMonth = getDaysInMonth(year, month);
		for (let day = 1; day <= daysInMonth; day++) {
			const dateObj = new Date(year, month - 1, day);
			const dateStr = formatDate(dateObj);
			const entry = countMap.get(dateStr);
			const count = entry?.count ?? 0;
			const { col, row } = getGridPos(dateObj, weekStartsOn);
			if (col + 1 > weekCount) weekCount = col + 1;
			cells.push({
				date: dateStr,
				count,
				lineStart: entry?.lineStart ?? 0,
				title: entry?.title ?? '',
				content: entry?.content ?? '',
				col,
				row,
			});
			total += count;
			if (count > maxCount) maxCount = count;
			if (count > 0) activeDays++;
		}
	}

	return { year, cells, total, maxCount, activeDays, weekCount };
}

/**
 * 根据 count 和 maxCount 映射到 0-4 的强度等级。
 * 0 → 无记录；1-4 → 由浅到深。
 */
export function activityIntensity(count: number, maxCount: number): number {
	if (count <= 0) return 0;
	if (maxCount <= 0) return 0;
	if (count >= maxCount) return 4;
	// 按比例分档
	const ratio = count / maxCount;
	if (ratio <= 0.25) return 1;
	if (ratio <= 0.5) return 2;
	if (ratio <= 0.75) return 3;
	return 4;
}

// ────────────────────────────────────────────────────────────────
// Event Timeline — 按月分组的 event 时间分布
// ────────────────────────────────────────────────────────────────

export interface EventTimelineItem {
	date: string; // source date
	startDate: string;
	endDate: string;
	isRange: boolean;
	duration: number; // 天数
	name: string;
	lineStart: number;
	title: string;
}

export interface EventTimelineData {
	year: number;
	byMonth: { monthKey: string; items: EventTimelineItem[] }[];
	total: number;
}

export function computeEventTimeline(
	dayBlocks: CalendarDayBlock[],
	year: number,
	tags: string[],
): EventTimelineData {
	const tagSet = new Set(tags);
	const allItems: EventTimelineItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));
		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;
				const name = info.link ?? info.cleanText;
				if (!name) continue;
				const startDate = info.range?.startDate ?? day.date;
				const endDate = info.range?.endDate ?? day.date;
				const duration = generateDatesInRange(startDate, endDate).length;
				allItems.push({
					date: day.date,
					startDate,
					endDate,
					isRange: info.range !== null,
					duration,
					name,
					lineStart: day.lineStart,
					title: day.title,
				});
			}
		}
	}

	// 筛选与该年相关的（开始日落在该年）
	const yearItems = allItems.filter((it) =>
		it.startDate.startsWith(String(year)),
	);

	// 按开始日的月份分组
	const monthMap = new Map<string, EventTimelineItem[]>();
	for (const it of yearItems) {
		const monthKey = it.startDate.slice(0, 7);
		if (!monthMap.has(monthKey)) monthMap.set(monthKey, []);
		monthMap.get(monthKey)!.push(it);
	}
	const byMonth = Array.from(monthMap.entries())
		.map(([monthKey, items]) => ({
			monthKey,
			items: items.sort((a, b) => a.startDate.localeCompare(b.startDate)),
		}))
		.sort((a, b) => a.monthKey.localeCompare(b.monthKey));

	return { year, byMonth, total: yearItems.length };
}

// ────────────────────────────────────────────────────────────────
// Monthly Distribution — 按月统计匹配 tag 次数
// ────────────────────────────────────────────────────────────────

export interface MonthlyDistributionMonthItem {
	date: string;
	text: string;
	lineStart: number;
	title: string;
}

export interface MonthlyDistributionMonth {
	monthKey: string;
	count: number;
	items: MonthlyDistributionMonthItem[];
}

export interface MonthlyDistributionData {
	year: number;
	byMonth: MonthlyDistributionMonth[];
	total: number;
	maxCount: number;
}

export function computeMonthlyDistribution(
	dayBlocks: CalendarDayBlock[],
	year: number,
	tags: string[],
): MonthlyDistributionData {
	const tagSet = new Set(tags);
	// 预初始化 12 个月，确保无数据的月份也显示
	const monthMap = new Map<string, MonthlyDistributionMonth>();
	for (let m = 1; m <= 12; m++) {
		const monthKey = `${year}-${String(m).padStart(2, '0')}`;
		monthMap.set(monthKey, { monthKey, count: 0, items: [] });
	}

	let total = 0;
	let maxCount = 0;

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		if (!day.date.startsWith(String(year))) continue;
		const yearHint = Number(day.date.slice(0, 4));
		const monthKey = day.date.slice(0, 7);
		const entry = monthMap.get(monthKey);
		if (!entry) continue;

		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (!info.tag || !tagSet.has(info.tag)) continue;
				entry.count++;
				entry.items.push({
					date: day.date,
					text: info.text,
					lineStart: day.lineStart,
					title: day.title,
				});
				total++;
			}
		}
	}

	for (const [, v] of monthMap) {
		if (v.count > maxCount) maxCount = v.count;
	}

	const byMonth = Array.from(monthMap.values()).sort((a, b) =>
		a.monthKey.localeCompare(b.monthKey),
	);

	return { year, byMonth, total, maxCount };
}

// ────────────────────────────────────────────────────────────────
// Range View — 按标签分组的跨日期事件
// ────────────────────────────────────────────────────────────────

export interface TagRangeItem {
	startDate: string;
	endDate: string;
	duration: number; // 天数
	name: string; // cleanText || tag
	lineStart: number;
	title: string;
}

export interface TagRangeData {
	year: number;
	tag: string;
	items: TagRangeItem[];
	total: number; // 次
	totalDays: number; // 天
	maxDuration: number;
}

/**
 * 统计指定标签的跨日期事件。
 *
 * 只收集带日期范围（range）的记录，单日事件不计入。
 * name = cleanText（去掉 range 后的文本）|| tag 名。
 * 同一 startDate+endDate 去重，只保留首次出现。
 */
export function computeRangesByTag(
	dayBlocks: CalendarDayBlock[],
	year: number,
	tag: string,
): TagRangeData {
	const items: TagRangeItem[] = [];

	for (const day of dayBlocks) {
		if (!day.hasContent || !day.inlineContent) continue;
		const yearHint = Number(day.date.slice(0, 4));
		for (const item of splitItems(day.inlineContent)) {
			for (const info of extractAllItems(item, yearHint)) {
				if (info.tag !== tag) continue;
				if (info.range === null) continue; // 只统计跨日期事件

				const startDate = info.range.startDate;
				const endDate = info.range.endDate;

				// 只保留开始日落在该年的
				if (!startDate.startsWith(String(year))) continue;

				const name = info.cleanText || tag;
				const duration = generateDatesInRange(startDate, endDate).length;
				items.push({
					startDate,
					endDate,
					duration,
					name,
					lineStart: day.lineStart,
					title: day.title,
				});
			}
		}
	}

	// 去重：只有日期和事件名称都相同才视为同一事件。
	const seen = new Set<string>();
	const deduped = items.filter((it) => {
		const key = `${it.startDate}~${it.endDate}\u0000${it.name}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	deduped.sort((a, b) => a.startDate.localeCompare(b.startDate));

	// 日期跨度按自然日去重，重叠范围不会重复计入年度 Days 卡片。
	const uniqueDates = new Set<string>();
	for (const item of deduped) {
		for (const date of generateDatesInRange(item.startDate, item.endDate)) {
			uniqueDates.add(date);
		}
	}
	const totalDays = uniqueDates.size;
	const maxDuration = deduped.reduce((m, it) => Math.max(m, it.duration), 0);

	return {
		year,
		tag,
		items: deduped,
		total: deduped.length,
		totalDays,
		maxDuration,
	};
}

// ────────────────────────────────────────────────────────────────
// 年份收集 — 供 Heatmap tab 年份选择器使用
// ────────────────────────────────────────────────────────────────

/**
 * 从 dayBlocks 中收集所有出现过的年份（按 content 出现），
 * 始终包含当前年份，按降序返回。
 */
export function collectYears(dayBlocks: CalendarDayBlock[]): number[] {
	const years = new Set<number>();
	for (const day of dayBlocks) {
		if (day.hasContent) {
			const y = Number(day.date.slice(0, 4));
			if (!isNaN(y)) years.add(y);
		}
	}
	years.add(new Date().getFullYear());
	return Array.from(years).sort((a, b) => b - a);
}

// ────────────────────────────────────────────────────────────────
// 月份序号 → 英文缩写
// ────────────────────────────────────────────────────────────────

const MONTH_ABBR = [
	'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
	'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export function monthAbbr(monthKey: string): string {
	// monthKey = "YYYY-MM"
	const m = Number(monthKey.slice(5, 7));
	return MONTH_ABBR[m - 1] ?? monthKey;
}

/**
 * 从 monthKey 提取月份序号 (1-12)。
 */
export function monthIndex(monthKey: string): number {
	return Number(monthKey.slice(5, 7));
}
