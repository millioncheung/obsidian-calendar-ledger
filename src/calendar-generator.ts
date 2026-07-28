import { generateDateRange, formatDate, getWeekNumber, getWeekdayName, getMonthAbbr } from './date-utils';
import type { CalendarLedgerSettings } from './types';

interface DateGroup {
	year: number;
	month: number;
	week: string;
	date: Date;
	dateStr: string;
}

/**
 * 生成 Calendar.md 的完整 Markdown 内容
 *
 * 结构：
 *   # Year
 *   ## Mon
 *   ### Wxx
 *   - **MM-DD Ddd**
 *
 * 顶层不再生成 `# Calendar`，年份直接作为 H1。
 * 月份使用英文缩写（Jan/Feb/...），日期行用 MM-DD + 周几（跟随 language）。
 *
 * @param getContent 可选回调，返回某日期已有的子内容行（保留缩进），
 *                   用于在保留内容的前提下重建结构。
 */
export function generateCalendarMarkdown(
	settings: CalendarLedgerSettings,
	getContent?: (dateStr: string) => string[] | undefined,
): string {
	const dates = generateDateRange(settings.startYear, settings.endYear);
	const groups = groupDates(dates, settings);

	const lines: string[] = [];

	let currentYear = -1;
	let currentMonth = -1;
	let currentWeek = '';

	for (const g of groups) {
		if (g.year !== currentYear) {
			currentYear = g.year;
			currentMonth = -1;
			currentWeek = '';
			pushBlankIfNeeded(lines);
			lines.push(`# ${g.year}`);
			lines.push('');
		}

		if (g.month !== currentMonth) {
			currentMonth = g.month;
			currentWeek = '';
			pushBlankIfNeeded(lines);
			lines.push(`## ${getMonthAbbr(g.date)}`);
			lines.push('');
		}

		if (settings.showWeekNumber && g.week !== currentWeek) {
			currentWeek = g.week;
			pushBlankIfNeeded(lines);
			lines.push(`### ${g.week}`);
			lines.push('');
		}

		const weekday = getWeekdayName(g.date, settings.language);
		const dateShort = g.dateStr.slice(5); // MM-DD
		lines.push(`- **${dateShort} ${weekday}**`);

		// 保留已有内容：在 day bullet 后插入该日期的子内容
		if (getContent) {
			const contentLines = getContent(g.dateStr);
			if (contentLines && contentLines.length > 0) {
				for (const line of contentLines) {
					lines.push(line);
				}
			}
		}
	}

	return lines.join('\n');
}

/**
 * 在行数组中按需补一个空行，用于分隔 bullet 区块与后续 heading
 */
function pushBlankIfNeeded(lines: string[]): void {
	if (lines.length > 0 && lines[lines.length - 1] !== '') {
		lines.push('');
	}
}

/**
 * 将日期按 year/month/week 分组
 */
function groupDates(dates: Date[], settings: CalendarLedgerSettings): DateGroup[] {
	return dates.map((date) => {
		const weekNum = getWeekNumber(date);
		const weekLabel = `W${String(weekNum).padStart(2, '0')}`;
		return {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			week: weekLabel,
			date,
			dateStr: formatDate(date),
		};
	});
}

/**
 * 生成指定年份的 Markdown 内容（用于追加）
 *
 * @param getContent 可选回调，返回某日期已有的子内容行。
 */
export function generateYearMarkdown(
	year: number,
	settings: CalendarLedgerSettings,
	getContent?: (dateStr: string) => string[] | undefined,
): string {
	const dates: Date[] = [];
	for (let month = 1; month <= 12; month++) {
		const daysInMonth = new Date(year, month, 0).getDate();
		for (let day = 1; day <= daysInMonth; day++) {
			dates.push(new Date(year, month - 1, day));
		}
	}

	const groups = groupDates(dates, settings);
	const lines: string[] = [`# ${year}`, ''];

	let currentMonth = -1;
	let currentWeek = '';

	for (const g of groups) {
		if (g.month !== currentMonth) {
			currentMonth = g.month;
			currentWeek = '';
			pushBlankIfNeeded(lines);
			lines.push(`## ${getMonthAbbr(g.date)}`);
			lines.push('');
		}

		if (settings.showWeekNumber && g.week !== currentWeek) {
			currentWeek = g.week;
			pushBlankIfNeeded(lines);
			lines.push(`### ${g.week}`);
			lines.push('');
		}

		const weekday = getWeekdayName(g.date, settings.language);
		const dateShort = g.dateStr.slice(5); // MM-DD
		lines.push(`- **${dateShort} ${weekday}**`);

		if (getContent) {
			const contentLines = getContent(g.dateStr);
			if (contentLines && contentLines.length > 0) {
				for (const line of contentLines) {
					lines.push(line);
				}
			}
		}
	}

	return lines.join('\n');
}
