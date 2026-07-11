import type { CalendarDayBlock, CalendarOutlineNode, CalendarParseResult, CalendarRange } from './types';
import { parseRangesFromText } from './date-utils';

const HEADING_REGEX = /^(#{1,6})\s+(.+)$/;
const DATE_PREFIX_REGEX = /^(\d{4}-\d{2}-\d{2})\b/;
// day bullet：- **2026-01-01 Thu**（旧）或 - **01-01 Thu**（新）
// 捕获组 3 为 ** 之后的 inline 内容（新格式）
const DAY_BULLET_REGEX = /^(\s*)-\s+\*\*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\b.*?\*\*\s*(.*)$/;
const FULL_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

interface ParsedItem {
	line: number;
	title: string;
	type: 'year' | 'month' | 'week' | 'day';
	date?: string;
	inlineContent?: string;
	yearContext?: number;  // 当前年份上下文，用于解析短日期范围
}

/**
 * 解析 Calendar.md 内容，提取结构化数据
 *
 * 兼容多种 day 格式：
 * - 新格式（bullet，无年份）：`- **01-01 Thu**`（由 year heading 提供年份上下文）
 * - 旧格式（bullet，含年份）：`- **2026-01-01 Thu**`
 * - 旧格式（heading）：`##### 2026-01-01 Thu`
 *
 * 新格式层级：H1=year / H2=month / H3=week
 * 旧格式层级：H2=year / H3=month / H4=week / H5=day
 */
export function parseCalendar(content: string): CalendarParseResult {
	const lines = content.split('\n');
	const items: ParsedItem[] = [];

	// 追踪当前年份上下文（来自最近的 year heading），用于把新格式
	// day bullet 里的 MM-DD 补全为完整 YYYY-MM-DD 作为 dayBlockMap 的 key
	let currentYear: number | null = null;

	// 单次扫描：收集 year/month/week heading 与 day marker
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? '';

		// 先尝试匹配 heading（year/month/week 以及旧格式 day heading）
		const headingMatch = line.match(HEADING_REGEX);
		if (headingMatch && headingMatch[1] && headingMatch[2]) {
			const level = headingMatch[1].length;
			const title = headingMatch[2];

			// 新格式：H1=year, H2=month, H3=week
			// 旧格式兼容：H2=year, H3=month, H4=week, H5=day
			if (level === 1) {
				const yearNum = Number(title.trim());
				if (/^\d{4}$/.test(title.trim())) {
					currentYear = yearNum;
				}
				items.push({ line: i, title, type: 'year' });
			} else if (level === 2) {
				// H2 在新格式是 month，旧格式是 year。通过标题特征区分：
				// year 标题是纯数字（"2026"）；month 标题是 "YYYY-MM" 或 "MM"
				if (/^\d{4}$/.test(title.trim())) {
					currentYear = Number(title.trim());
					items.push({ line: i, title, type: 'year' });
				} else {
					items.push({ line: i, title, type: 'month' });
				}
			} else if (level === 3) {
				// H3 在新格式是 week（Wxx），旧格式是 month（YYYY-MM）
				if (/^W\d{2}$/i.test(title.trim())) {
					items.push({ line: i, title, type: 'week' });
				} else {
					items.push({ line: i, title, type: 'month' });
				}
			} else if (level === 4) {
				// H4 在旧格式是 week（Wxx）
				if (/^W\d{2}$/i.test(title.trim())) {
					items.push({ line: i, title, type: 'week' });
				}
			} else if (level === 5) {
				// 旧格式 day heading：##### 2026-01-01 Thu
				const dateMatch = title.match(DATE_PREFIX_REGEX);
				if (dateMatch && dateMatch[1]) {
					items.push({ line: i, title, type: 'day', date: dateMatch[1] });
				}
			}
			continue;
		}

		// day bullet：- **2026-01-01 Thu**（旧）或 - **01-01 Thu**（新）
		const bulletMatch = line.match(DAY_BULLET_REGEX);
		if (bulletMatch && bulletMatch[2]) {
			const rawDate = bulletMatch[2];
			let date: string;
			if (FULL_DATE_REGEX.test(rawDate)) {
				// 旧格式完整日期
				date = rawDate;
				currentYear = Number(rawDate.slice(0, 4));
			} else if (currentYear !== null) {
				// 新格式 MM-DD，用当前年份上下文补全
				date = `${currentYear}-${rawDate}`;
			} else {
				// 缺少年份上下文，使用原始文本作为 key（不完整但避免丢数据）
				date = rawDate;
			}
			const title = line.replace(/^\s*-\s+\*\*/, '').replace(/\*\*\s*.*$/, '');
			const inlineContent = (bulletMatch[3] ?? '').trim();
			items.push({
				line: i,
				title,
				type: 'day',
				date,
				inlineContent: inlineContent || undefined,
				yearContext: currentYear ?? undefined,
			});
		}
	}

	// 构建大纲树
	const outline = buildOutline(items);

	// 构建 day blocks
	const dayBlocks = buildDayBlocks(items, lines);

	// 构建 dayBlockMap
	const dayBlockMap: Record<string, CalendarDayBlock> = {};
	for (const block of dayBlocks) {
		dayBlockMap[block.date] = block;
	}

	return { outline, dayBlocks, dayBlockMap };
}

/**
 * 构建大纲树（year / month / week / day 四级）
 */
function buildOutline(items: ParsedItem[]): CalendarOutlineNode[] {
	const root: CalendarOutlineNode[] = [];
	const stack: CalendarOutlineNode[] = [];

	for (const item of items) {
		const node: CalendarOutlineNode = {
			id: item.title,
			type: item.type,
			title: item.title,
			date: item.date,
			line: item.line,
			children: [],
		};

		// 弹出栈中层级 >= 当前层级的节点
		while (stack.length > 0) {
			const top = stack[stack.length - 1]!;
			if (getTypeLevel(top.type) >= getTypeLevel(item.type)) {
				stack.pop();
			} else {
				break;
			}
		}

		if (stack.length === 0) {
			root.push(node);
		} else {
			stack[stack.length - 1]!.children.push(node);
		}

		stack.push(node);
	}

	return root;
}

/**
 * 构建 day block 数组
 *
 * lineStart：day bullet / heading 所在行
 * lineEnd：到下一个结构项（day / week / month / year）之前的最后一行（去除尾部空行）
 * content：day 标记下方的子 bullet 内容（旧格式，保留缩进）
 * inlineContent：day bullet 行 ** 之后的内容（新格式）
 * hasContent：是否有任何内容（inline 或子 bullet）
 * hasInline / hasSubBullets：分别标记内容来源
 * tags / links / ranges：从 inline 内容中提取
 */
function buildDayBlocks(items: ParsedItem[], lines: string[]): CalendarDayBlock[] {
	const dayBlocks: CalendarDayBlock[] = [];

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		if (item.type !== 'day' || !item.date) continue;

		const lineStart = item.line;

		// 计算 lineEnd：下一个结构项的前一行，或文件末尾
		let lineEnd = lines.length - 1;
		if (i + 1 < items.length) {
			lineEnd = items[i + 1]!.line - 1;
		}

		// 去除尾部空行
		while (lineEnd > lineStart && (lines[lineEnd] ?? '').trim() === '') {
			lineEnd--;
		}

		// 提取子 bullet 内容（lineStart+1 到 lineEnd）
		const contentLines = lines.slice(lineStart + 1, lineEnd + 1);
		const content = contentLines.join('\n');
		const hasSubBullets = content.trim().length > 0;

		// inline 内容（day bullet 行 ** 之后）
		const inlineContent = item.inlineContent ?? '';
		const hasInline = inlineContent.length > 0;

		// 提取 tags（#tag）
		const tags = extractTags(inlineContent);

		// 提取 links（[[link]]）
		const links = extractLinks(inlineContent);

		// 提取 ranges（日期范围）
		const yearHint = item.yearContext ?? new Date().getFullYear();
		const ranges: CalendarRange[] = [];
		for (const inlineItem of splitInlineItems(inlineContent)) {
			const itemRanges = parseRangesFromText(inlineItem, yearHint);
			if (itemRanges.length === 0) continue;
			const itemTags = extractTags(inlineItem);
			const itemLinks = extractLinks(inlineItem);
			for (const r of itemRanges) {
				ranges.push({
					startDate: r.startDate,
					endDate: r.endDate,
					sourceDate: item.date,
					text: r.rawText,
					tags: itemTags,
					links: itemLinks,
				});
			}
		}

		dayBlocks.push({
			date: item.date,
			title: item.title,
			lineStart,
			lineEnd,
			content,
			hasContent: hasSubBullets || hasInline,
			inlineContent,
			hasInline,
			hasSubBullets,
			tags,
			links,
			ranges,
		});
	}

	return dayBlocks;
}

function splitInlineItems(text: string): string[] {
	let normalized = text.trim();
	if (normalized.startsWith('|') || normalized.startsWith('｜')) {
		normalized = normalized.slice(1).trim();
	}
	return normalized
		.split('；')
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
}

/**
 * 从文本中提取 #tag（不含 # 前缀）
 */
function extractTags(text: string): string[] {
	const tags: string[] = [];
	const regex = /#([\w\u4e00-\u9fff-]+)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const tag = match[1]!;
		if (!tags.includes(tag)) {
			tags.push(tag);
		}
	}
	return tags;
}

/**
 * 从文本中提取 [[link]]（不含 [[]] 标记）
 */
function extractLinks(text: string): string[] {
	const links: string[] = [];
	const regex = /\[\[([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(text)) !== null) {
		const link = match[1]!;
		// 取显示名或路径
		const name = link.split('|')[0] ?? link;
		if (!links.includes(name)) {
			links.push(name);
		}
	}
	return links;
}

/**
 * 获取节点类型对应的层级
 */
function getTypeLevel(type: CalendarOutlineNode['type']): number {
	switch (type) {
		case 'year': return 2;
		case 'month': return 3;
		case 'week': return 4;
		case 'day': return 5;
	}
}
