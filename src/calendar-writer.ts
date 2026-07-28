import { Notice, type Vault } from 'obsidian';
import { parseCalendar } from './calendar-parser';
import { generateCalendarMarkdown } from './calendar-generator';
import { INLINE_SEPARATOR, migrateCalendarContent } from './calendar-migration';
import type { CalendarLedgerSettings } from './types';

/**
 * 创建或覆盖 Calendar.md 文件
 */
export async function createCalendarFile(
	vault: Vault,
	filePath: string,
	content: string,
	forceOverwrite: boolean = false,
): Promise<boolean> {
	const existingFile = vault.getFileByPath(filePath);

	if (existingFile && !forceOverwrite) {
		new Notice('Calendar file already exists. Use overwrite command to replace.');
		return false;
	}

	if (existingFile) {
		await vault.modify(existingFile, content);
	} else {
		// 确保父目录存在
		const parts = filePath.split('/');
		if (parts.length > 1) {
			const folderPath = parts.slice(0, -1).join('/');
			const folder = vault.getFolderByPath(folderPath);
			if (!folder) {
				await vault.createFolder(folderPath);
			}
		}
		await vault.create(filePath, content);
	}

	return true;
}

/**
 * 向指定日期插入一条记录（inline 格式），返回日期行号和标题，失败返回 null
 *
 * 新格式：追加到 day bullet 行末尾，用 ；分隔多条内容
 * - **06-23 Tue** #fitness 胸肩；体检
 *
 * 旧 heading 格式兼容：在 heading 下一行插入 bullet
 *
 * 返回 title 用于跳转时在阅读模式下做文本验证（data-line 在某些渲染场景下
 * 可能跟源码行号不严格对应，用 title 作为 fallback 查找依据更可靠）。
 */
export async function insertItemToDate(
	vault: Vault,
	filePath: string,
	dateStr: string,
	item: string,
): Promise<{ line: number; title: string } | null> {
	const file = vault.getFileByPath(filePath);
	if (!file) {
		new Notice(`Calendar file not found: ${filePath}`);
		return null;
	}

	const content = await vault.read(file);
	const { dayBlockMap } = parseCalendar(content);

	const block = dayBlockMap[dateStr];
	if (!block) {
		new Notice(`Date ${dateStr} not found in calendar.`);
		return null;
	}

	const lines = content.split('\n');
	const dayLine = lines[block.lineStart] ?? '';
	const isBulletFormat = /^\s*-\s+\*\*/.test(dayLine);

	if (isBulletFormat) {
		// 新格式：追加到日期行末尾
		if (block.hasInline) {
			lines[block.lineStart] = dayLine + `；${item}`;
		} else {
			lines[block.lineStart] = dayLine + INLINE_SEPARATOR + item;
		}
	} else {
		// 旧格式 heading：在 heading 下一行插入 bullet
		const bullet = `- ${item}`;
		const insertPos = block.hasContent ? block.lineEnd + 1 : block.lineStart + 1;
		if (block.hasContent) {
			lines.splice(insertPos, 0, bullet);
		} else {
			lines.splice(insertPos, 0, '');
			lines.splice(insertPos + 1, 0, bullet);
		}
	}

	await vault.modify(file, lines.join('\n'));
	return { line: block.lineStart, title: block.title };
}

/**
 * 追加年份到 Calendar.md 末尾
 */
export async function appendYearToCalendar(
	vault: Vault,
	filePath: string,
	yearContent: string,
	year: number,
): Promise<boolean> {
	const file = vault.getFileByPath(filePath);
	if (!file) {
		new Notice(`Calendar file not found: ${filePath}`);
		return false;
	}

	const content = await vault.read(file);

	// 检查年份是否已存在（兼容新旧两种 heading 层级）
	const yearHeadingRegex = new RegExp(`^#{1,2}\\s+${year}\\s*$`, 'm');
	if (yearHeadingRegex.test(content)) {
		new Notice(`Year ${year} already exists in calendar.`);
		return false;
	}

	// 追加到文件末尾
	const newContent = content.trimEnd() + '\n\n' + yearContent;
	await vault.modify(file, newContent);
	return true;
}

/**
 * 迁移到最新格式：
 * 1. 旧二级 bullet 子内容 → inline ` ｜ ` 分隔
 * 2. 旧 inline 空格分隔 → ` ｜ ` 分隔
 *
 * 示例：
 * - **06-23 Tue**
 *   - #fitness 胸肩
 *   - 体检
 * 或
 * - **06-23 Tue** #fitness 胸肩
 * 统一转换为：
 * - **06-23 Tue** ｜ #fitness 胸肩；体检
 */
export async function migrateToLatestFormat(
	vault: Vault,
	filePath: string,
): Promise<number> {
	const file = vault.getFileByPath(filePath);
	if (!file) {
		new Notice(`Calendar file not found: ${filePath}`);
		return 0;
	}

	const content = await vault.read(file);
	const result = migrateCalendarContent(content);
	if (result.changeCount === 0) {
		new Notice(`已是最新格式，无需迁移：${filePath}`);
	} else {
		await vault.modify(file, result.content);
	}

	return result.changeCount;
}

/**
 * 按当前设置重建 Calendar 文件结构，同时保留每个日期已有的子内容。
 *
 * 用于切换 showWeekNumber 等影响结构的设置后，自动更新已存在的文档。
 *
 * 重建范围会覆盖 settings.startYear / endYear 以及现有文件中的所有年份，
 * 避免切换结构设置时丢失旧年份记录。若文件不存在则静默跳过。
 */
export async function restructureCalendar(
	vault: Vault,
	filePath: string,
	settings: CalendarLedgerSettings,
): Promise<boolean> {
	const file = vault.getFileByPath(filePath);
	if (!file) {
		return false;
	}

	const content = await vault.read(file);
	const { dayBlockMap } = parseCalendar(content);
	const existingYears = Object.keys(dayBlockMap)
		.map((dateStr) => Number(dateStr.slice(0, 4)))
		.filter((year) => !isNaN(year));
	const safeSettings: CalendarLedgerSettings = {
		...settings,
		startYear: existingYears.length > 0
			? Math.min(settings.startYear, ...existingYears)
			: settings.startYear,
		endYear: existingYears.length > 0
			? Math.max(settings.endYear, ...existingYears)
			: settings.endYear,
	};

	// 收集 inline 内容，重建后追加回 day bullet 行
	const inlineMap: Record<string, string> = {};
	for (const [dateStr, block] of Object.entries(dayBlockMap)) {
		if (block.hasInline) {
			inlineMap[dateStr] = block.inlineContent;
		}
	}

	// 归一化子 bullet 内容行
	const getContent = (dateStr: string): string[] | undefined => {
		const block = dayBlockMap[dateStr];
		if (!block || !block.hasSubBullets) return undefined;
		return block.content.split('\n').map((line) => {
			if (line.trim() === '') return '';
			if (/^\s/.test(line)) return line;
			return '\t' + line;
		});
	};

	let newContent = generateCalendarMarkdown(safeSettings, getContent);

	// 将 inline 内容追加回 day bullet 行
	if (Object.keys(inlineMap).length > 0) {
		const newLines = newContent.split('\n');
		const { dayBlockMap: newMap } = parseCalendar(newContent);
		// 从下往上处理，避免行号偏移
		const entries = Object.entries(newMap)
			.filter(([_, b]) => inlineMap[b.date])
			.sort((a, b) => b[1].lineStart - a[1].lineStart);
		for (const [, block] of entries) {
			const inline = inlineMap[block.date];
			if (inline) {
				newLines[block.lineStart] = newLines[block.lineStart] + INLINE_SEPARATOR + inline;
			}
		}
		newContent = newLines.join('\n');
	}

	await vault.modify(file, newContent);
	return true;
}
