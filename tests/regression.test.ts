import assert from 'node:assert/strict';
import { migrateCalendarContent } from '../src/calendar-migration';
import { parseCalendar } from '../src/calendar-parser';
import { parseRangesFromText } from '../src/date-utils';
import { computeRangesByTag } from '../src/heatmap';
import { extractAllItems, splitItems } from '../src/stats';

function test(name: string, run: () => void): void {
	run();
	console.log(`✓ ${name}`);
}

test('migration flattens mixed legacy blocks and removes date gaps', () => {
	const input = [
		'# 2026',
		'',
		'## Jan',
		'',
		'-  **01-01 Thu**',
		'  - #fitness 跑步',
		'普通说明文字',
		'> 引用内容',
		'',
		'- **01-02 Fri**- #live 演出',
	].join('\n');
	const result = migrateCalendarContent(input);
	assert.equal(result.content, [
		'# 2026',
		'',
		'## Jan',
		'',
		'- **01-01 Thu** ｜ #fitness 跑步；普通说明文字；引用内容',
		'- **01-02 Fri** ｜ #live 演出',
	].join('\n'));
	assert.ok(result.changeCount > 0);
});

test('migration is idempotent', () => {
	const canonical = '- **01-01 Thu** ｜ #fitness 跑步\n- **01-02 Fri**';
	assert.deepEqual(migrateCalendarContent(canonical), { content: canonical, changeCount: 0 });
});

test('multiple tags without punctuation share one record payload', () => {
	const infos = extractAllItems('#travel #family 北京 07-20～07-25', 2026);
	assert.deepEqual(infos.map((info) => info.tag), ['travel', 'family']);
	assert.ok(infos.every((info) => info.cleanText === '北京'));
	assert.ok(infos.every((info) => info.range?.startDate === '2026-07-20'));
});

test('Chinese semicolon separates independent records', () => {
	assert.deepEqual(
		splitItems('｜ #travel 北京；#travel 上海'),
		['#travel 北京', '#travel 上海'],
	);
});

test('range parser tolerates a full-width separator inside the end date', () => {
	assert.deepEqual(parseRangesFromText('北京 07-20～07～25', 2026), [{
		startDate: '2026-07-20',
		endDate: '2026-07-25',
		rawText: '07-20～07～25',
	}]);
});

test('overlapping travel ranges count events separately and days once', () => {
	const calendar = [
		'# 2026',
		'## Jan',
		'- **01-01 Thu** ｜ #travel 北京 07-20～07-25；#travel 上海 07-20～07-25',
		'- **01-02 Fri** ｜ #travel 杭州 07-23～07-28',
	].join('\n');
	const { dayBlocks } = parseCalendar(calendar);
	const result = computeRangesByTag(dayBlocks, 2026, 'travel');
	assert.equal(result.total, 3);
	assert.equal(result.totalDays, 9);
	assert.deepEqual(result.items.map((item) => item.name), ['北京', '上海', '杭州']);
});

console.log('All regression tests passed.');
