const ENGLISH_WEEKDAYS: string[] = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHINESE_WEEKDAYS: string[] = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const ENGLISH_MONTH_ABBR: string[] = [
	'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
	'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/**
 * 格式化日期为 YYYY-MM-DD
 */
export function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * 获取星期缩写
 */
export function getWeekdayName(date: Date, language: 'en' | 'zh'): string {
	const day = date.getDay();
	const arr = language === 'zh' ? CHINESE_WEEKDAYS : ENGLISH_WEEKDAYS;
	return arr[day] ?? '';
}

/**
 * 获取月份英文缩写（Jan/Feb/.../Dec）
 */
export function getMonthAbbr(date: Date): string {
	return ENGLISH_MONTH_ABBR[date.getMonth()] ?? '';
}

/**
 * 获取月份天数
 */
export function getDaysInMonth(year: number, month: number): number {
	return new Date(year, month, 0).getDate();
}

/**
 * 计算 ISO week number
 */
export function getWeekNumber(date: Date): number {
	const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
	const dayNum = d.getUTCDay() || 7;
	d.setUTCDate(d.getUTCDate() + 4 - dayNum);
	const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
	return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/**
 * 生成指定年份范围的日期列表
 */
export function generateDateRange(startYear: number, endYear: number): Date[] {
	const dates: Date[] = [];
	for (let year = startYear; year <= endYear; year++) {
		for (let month = 1; month <= 12; month++) {
			const daysInMonth = getDaysInMonth(year, month);
			for (let day = 1; day <= daysInMonth; day++) {
				dates.push(new Date(year, month - 1, day));
			}
		}
	}
	return dates;
}

/**
 * 解析 YYYY-MM-DD / YYYY-M-D / YYYY-MM-D / YYYY-M-DD 字符串为 Date
 */
export function parseDate(dateStr: string): Date | null {
	const match = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
	if (!match) return null;
	const [_, y, m, d] = match;
	const date = new Date(Number(y), Number(m) - 1, Number(d));
	if (isNaN(date.getTime())) return null;
	return date;
}

/**
 * 将灵活格式的日期字符串 normalize 为 YYYY-MM-DD
 * 支持 YYYY-M-D / YYYY-MM-D / YYYY-M-DD / YYYY-MM-DD
 * 无效日期返回 null
 */
export function normalizeDate(dateStr: string): string | null {
	const date = parseDate(dateStr);
	if (!date) return null;
	return formatDate(date);
}

/**
 * 判断日期是否在今天之后
 */
export function isFutureDate(dateStr: string): boolean {
	const date = parseDate(dateStr);
	if (!date) return false;
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	return date > today;
}

/**
 * 获取今天的日期字符串
 */
export function getTodayStr(): string {
	return formatDate(new Date());
}

/**
 * 日期范围解析结果
 */
export interface ParsedRange {
	startDate: string;   // YYYY-MM-DD
	endDate: string;     // YYYY-MM-DD
	rawText: string;     // 原始匹配文本
}

/**
 * 从文本中解析日期范围。
 *
 * 支持的格式：
 *   06-15~06-27         跨月范围（同一年内）
 *   6.15~6.27           点分隔
 *   2026-06-15~2026-06-27  完整日期范围
 *   06-15 ~ 06-27       带空格
 *
 * 返回解析结果数组，按在文本中出现的顺序排列。
 *
 * @param text      待解析的文本（如 inline 内容）
 * @param yearHint  年份上下文，用于补全不带年份的日期（如 MM-DD）
 */
export function parseRangesFromText(text: string, yearHint: number): ParsedRange[] {
	const results: ParsedRange[] = [];

	// 匹配完整日期范围：YYYY-MM-DD ~ YYYY-MM-DD
	const fullRangeRegex = /(\d{4}-\d{1,2}-\d{1,2})\s*[~～]\s*(\d{4}-\d{1,2}-\d{1,2})/g;
	let match: RegExpExecArray | null;
	while ((match = fullRangeRegex.exec(text)) !== null) {
		const start = normalizeDate(match[1]!);
		const end = normalizeDate(match[2]!);
		if (start && end) {
			results.push({ startDate: start, endDate: end, rawText: match[0] });
		}
	}

	// 匹配短日期范围：MM-DD ~ MM-DD 或 M.D ~ M.D
	const shortRangeRegex = /(\d{1,2})[.-](\d{1,2})\s*[~～]\s*(\d{1,2})[.-](\d{1,2})/g;
	while ((match = shortRangeRegex.exec(text)) !== null) {
		const rawText = match[0];
		// 检查是否已被完整日期范围覆盖（避免重复）
		const rawStart = match.index;
		const rawEnd = rawStart + rawText.length;
		const alreadyCovered = results.some(
			(r) => {
				const idx = text.indexOf(r.rawText);
				return idx !== -1 && rawStart >= idx && rawEnd <= idx + r.rawText.length;
			},
		);
		if (alreadyCovered) continue;

		const startMonth = parseInt(match[1]!, 10);
		const startDay = parseInt(match[2]!, 10);
		const endMonth = parseInt(match[3]!, 10);
		const endDay = parseInt(match[4]!, 10);

		// 确定年份：如果 endMonth < startMonth，说明跨年，end 年份 +1
		const startYear = yearHint;
		const endYear = endMonth < startMonth ? yearHint + 1 : yearHint;

		const startStr = formatDate(new Date(startYear, startMonth - 1, startDay));
		const endStr = formatDate(new Date(endYear, endMonth - 1, endDay));

		// 验证日期有效性
		if (startStr && endStr && !isNaN(new Date(startStr).getTime()) && !isNaN(new Date(endStr).getTime())) {
			results.push({ startDate: startStr, endDate: endStr, rawText });
		}
	}

	return results;
}

/**
 * 判断日期是否在指定日期之后（含当天）
 */
export function isDateOnOrAfter(dateStr: string, referenceStr: string): boolean {
	const date = parseDate(dateStr);
	const ref = parseDate(referenceStr);
	if (!date || !ref) return false;
	date.setHours(0, 0, 0, 0);
	ref.setHours(0, 0, 0, 0);
	return date >= ref;
}

/**
 * 判断日期是否在指定日期之前
 */
export function isDateBefore(dateStr: string, referenceStr: string): boolean {
	const date = parseDate(dateStr);
	const ref = parseDate(referenceStr);
	if (!date || !ref) return false;
	date.setHours(0, 0, 0, 0);
	ref.setHours(0, 0, 0, 0);
	return date < ref;
}

/**
 * 判断某个日期是否在某个日期范围内（含起止日期）
 */
export function isDateInRange(dateStr: string, startDate: string, endDate: string): boolean {
	return isDateOnOrAfter(dateStr, startDate) && isDateOnOrAfter(endDate, dateStr);
}

/**
 * 生成日期范围内的所有日期（含起止日期）
 */
export function generateDatesInRange(startDate: string, endDate: string): string[] {
	const start = parseDate(startDate);
	const end = parseDate(endDate);
	if (!start || !end) return [];
	const dates: string[] = [];
	const current = new Date(start);
	while (current <= end) {
		dates.push(formatDate(current));
		current.setDate(current.getDate() + 1);
	}
	return dates;
}

/**
 * 根据日期字符串生成标题（如 "11-05 Thu"）
 */
export function formatDateTitle(dateStr: string, language: 'en' | 'zh'): string {
	const date = parseDate(dateStr);
	if (!date) return dateStr;
	const mm = String(date.getMonth() + 1).padStart(2, '0');
	const dd = String(date.getDate()).padStart(2, '0');
	const weekday = getWeekdayName(date, language);
	return `${mm}-${dd} ${weekday}`;
}

/**
 * 从内容中移除日期范围文本，并清理多余的分隔符
 * 例如："#travel 11-05~11-08；#live" → "#travel；#live"
 */
export function stripRangeText(content: string, rangeText: string): string {
	let result = content.replace(rangeText, '');
	// 清理残留的分隔符和多余空格
	result = result.replace(/[；｜]\s*[；｜]/g, '；');  // 双分隔符合并
	result = result.replace(/^[；｜]\s*/, '');            // 开头分隔符
	result = result.replace(/\s*[；｜]$/, '');            // 结尾分隔符
	result = result.replace(/\s+/g, ' ');                 // 多余空格
	return result.trim();
}