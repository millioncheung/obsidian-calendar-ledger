import { parseCalendar } from './calendar-parser';

export const INLINE_SEPARATOR = ' ｜ ';

const ANY_DAY_LINE_REGEX = /^\s*-\s+\*\*((?:\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\b.*?)\*\*(.*)$/;

export interface CalendarMigrationResult {
	content: string;
	changeCount: number;
}

/** Convert supported legacy calendar structures into the canonical one-line format. */
export function migrateCalendarContent(content: string): CalendarMigrationResult {
	const lines = content.split('\n');
	let changeCount = 0;

	for (let i = 0; i < lines.length; i++) {
		const originalLine = lines[i] ?? '';
		const match = originalLine.match(ANY_DAY_LINE_REGEX);
		if (match?.[1] === undefined) continue;
		let tail = (match[2] ?? '').trim();
		tail = tail.replace(/^(?:[|｜]|[-*+]\s*)+/, '').trim();
		const normalizedLine = `- **${match[1].trim()}**${tail ? INLINE_SEPARATOR + tail : ''}`;
		if (normalizedLine !== originalLine) {
			lines[i] = normalizedLine;
			changeCount++;
		}
	}

	for (let i = lines.length - 1; i > 0; i--) {
		if (!ANY_DAY_LINE_REGEX.test(lines[i] ?? '')) continue;
		const previous = lines[i - 1] ?? '';
		if (previous.trim() && !ANY_DAY_LINE_REGEX.test(previous)) {
			lines.splice(i, 0, '');
			changeCount++;
		}
	}

	const { dayBlocks } = parseCalendar(lines.join('\n'));
	interface MigrationPlan {
		lineStart: number;
		lineIndexesToRemove: number[];
		items: string[];
		hasInline: boolean;
	}
	const plans: MigrationPlan[] = [];
	for (const block of dayBlocks.filter((day) => day.hasSubBullets)) {
		if (!/^\s*-\s+\*\*/.test(lines[block.lineStart] ?? '')) continue;
		const lineIndexesToRemove: number[] = [];
		const items: string[] = [];
		for (let lineIndex = block.lineStart + 1; lineIndex <= block.lineEnd; lineIndex++) {
			const trimmed = (lines[lineIndex] ?? '').trim();
			if (!trimmed) continue;
			const itemText = trimmed.replace(/^[-*+]\s+/, '').replace(/^>\s*/, '').trim();
			if (!itemText) continue;
			lineIndexesToRemove.push(lineIndex);
			items.push(itemText);
		}
		if (items.length > 0) {
			plans.push({ lineStart: block.lineStart, lineIndexesToRemove, items, hasInline: block.hasInline });
		}
	}

	for (let planIndex = plans.length - 1; planIndex >= 0; planIndex--) {
		const plan = plans[planIndex]!;
		const dayLine = lines[plan.lineStart] ?? '';
		lines[plan.lineStart] = plan.hasInline
			? dayLine + '；' + plan.items.join('；')
			: dayLine + INLINE_SEPARATOR + plan.items.join('；');
		for (let removeIndex = plan.lineIndexesToRemove.length - 1; removeIndex >= 0; removeIndex--) {
			lines.splice(plan.lineIndexesToRemove[removeIndex]!, 1);
		}
		changeCount++;
	}

	for (let i = lines.length - 2; i > 0; i--) {
		if ((lines[i] ?? '').trim() !== '') continue;
		let previousIndex = i - 1;
		while (previousIndex >= 0 && (lines[previousIndex] ?? '').trim() === '') previousIndex--;
		let nextIndex = i + 1;
		while (nextIndex < lines.length && (lines[nextIndex] ?? '').trim() === '') nextIndex++;
		if (
			previousIndex >= 0
			&& nextIndex < lines.length
			&& ANY_DAY_LINE_REGEX.test(lines[previousIndex] ?? '')
			&& ANY_DAY_LINE_REGEX.test(lines[nextIndex] ?? '')
		) {
			lines.splice(i, 1);
			changeCount++;
		}
	}

	return { content: lines.join('\n'), changeCount };
}
