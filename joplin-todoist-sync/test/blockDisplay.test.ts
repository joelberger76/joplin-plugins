import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { blockRanges, chipLabel, collapsedBlocks, isQueryInfo, renderQueryBlock } from '../src/blockDisplay';

const NOTE = [
	'# Today',
	'',
	'```todoist',
	'filter: today | overdue',
	'fetched: 2026-10-10 08:31',
	'```',
	'- [ ] One',
	'',
	'```js',
	'const a = 1;',
	'```',
	'',
	'~~~Todoist',
	'~~~',
].join('\n');

test('blockRanges covers each query block from its opening fence to the end of its closing one', () => {
	const blocks = blockRanges(NOTE);
	assert.equal(blocks.length, 2);
	assert.equal(NOTE.slice(blocks[0].from, blocks[0].to), '```todoist\nfilter: today | overdue\nfetched: 2026-10-10 08:31\n```');
	assert.equal(blocks[0].filter, 'today | overdue');
	assert.equal(blocks[0].hint, 'Filter: today | overdue\nFetched: 2026-10-10 08:31');
	assert.equal(NOTE.slice(blocks[1].from, blocks[1].to), '~~~Todoist\n~~~');
	assert.equal(blocks[1].filter, null);
	assert.equal(blocks[1].hint, 'Filter: default\nFetched: not yet');
});

test('blockRanges leaves an unclosed block alone', () => {
	assert.deepEqual(blockRanges('```todoist\nfilter: today'), []);
});

test('a block is open while the selection touches it, its two ends included', () => {
	const [block] = blockRanges(NOTE);
	const collapsedAt = (from: number, to = from) => collapsedBlocks([block], [{ from, to }]).length === 1;
	assert.equal(collapsedAt(0), true);
	assert.equal(collapsedAt(block.from - 1), true);
	assert.equal(collapsedAt(block.from), false);
	assert.equal(collapsedAt(block.from + 5), false);
	assert.equal(collapsedAt(block.to), false);
	assert.equal(collapsedAt(block.to + 1), true);
	// A selection that runs across the block.
	assert.equal(collapsedAt(0, NOTE.length), false);
});

test('any of several cursors opens the block', () => {
	const [block] = blockRanges(NOTE);
	assert.equal(collapsedBlocks([block], [{ from: 0, to: 0 }, { from: block.from + 3, to: block.from + 3 }]).length, 0);
});

test('chipLabel', () => {
	assert.equal(chipLabel('#Work & p1', false), 'Todoist');
	assert.equal(chipLabel('#Work & p1', true), 'Todoist: #Work & p1');
	assert.equal(chipLabel(null, true), 'Todoist: default filter');
});

test('isQueryInfo reads the first word of the info string, in any case', () => {
	assert.equal(isQueryInfo('todoist'), true);
	assert.equal(isQueryInfo(' Todoist extra'), true);
	assert.equal(isQueryInfo('todoists'), false);
	assert.equal(isQueryInfo(''), false);
});

test('renderQueryBlock keeps the source for the Rich Text editor, and shows nothing', () => {
	const html = renderQueryBlock('```', 'todoist', 'filter: #Work & "a" <b>\nfetched: 2026-10-10 08:31\n');
	assert.equal(html, '<div class="joplin-editable todoist-query">'
		+ '<pre class="joplin-source" data-joplin-language="todoist" data-joplin-source-open="```todoist&#10;" data-joplin-source-close="&#10;```">'
		+ 'filter: #Work &amp; &quot;a&quot; &lt;b&gt;\nfetched: 2026-10-10 08:31</pre>'
		+ '</div>\n');
});

test('renderQueryBlock keeps the fence as written', () => {
	const html = renderQueryBlock('~~~~', 'Todoist', '');
	assert.match(html, /data-joplin-source-open="~~~~Todoist&#10;" data-joplin-source-close="&#10;~~~~"/);
});
