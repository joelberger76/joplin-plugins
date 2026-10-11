import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatTaskLine, parseNote, parseTaskLine, planInsert, withFetched } from '../src/noteParser';

const URL = 'https://app.todoist.com/app/task/6XGgm6PHrGgMpCFX';

test('reads plain, checked and linked task lines', () => {
	const open = parseTaskLine('- [ ] Call the plumber', 0)!;
	assert.equal(open.checked, false);
	assert.equal(open.name, 'Call the plumber');
	assert.equal(open.link, null);

	const done = parseTaskLine('  * [X] Done thing', 3)!;
	assert.equal(done.checked, true);
	assert.equal(done.indent, '  ');
	assert.equal(done.bullet, '*');
	assert.equal(done.lineNumber, 3);

	const linked = parseTaskLine(`- [ ] Call the plumber [↗ Oct 12 · p1](${URL})`, 0)!;
	assert.equal(linked.name, 'Call the plumber');
	assert.deepEqual(linked.link, { text: '↗ Oct 12 · p1', url: URL, taskId: '6XGgm6PHrGgMpCFX', occurrence: null });
});

test('ignores lines that are not task lines', () => {
	for (const text of ['Call the plumber', '- Call the plumber', '1. [ ] Numbered', '- [/] Alternate', '- [ ]No space', '- [x]']) {
		const line = parseTaskLine(text, 0);
		if (text === '- [x]') assert.equal(line!.name, '');
		else assert.equal(line, null, text);
	}
});

test('keeps a single #tag and other links in the name', () => {
	const line = parseTaskLine(`- [ ] Send the budget #Q4 see [docs](https://example.com) [↗](${URL})`, 0)!;
	assert.equal(line.name, 'Send the budget #Q4 see [docs](https://example.com)');
	assert.equal(line.link!.taskId, '6XGgm6PHrGgMpCFX');
});

test('a Todoist link that is not at the end does not link the line', () => {
	const line = parseTaskLine(`- [ ] See [this](${URL}) first`, 0)!;
	assert.equal(line.link, null);
});

test('reads the id from a URL copied out of the Todoist app', () => {
	const line = parseTaskLine('- [ ] Thing [x](https://app.todoist.com/app/task/call-the-plumber-6XGgm6PHrGgMpCFX)', 0)!;
	assert.equal(line.link!.taskId, '6XGgm6PHrGgMpCFX');
});

test('reads and writes the occurrence at the end of the URL', () => {
	const line = parseTaskLine(`- [ ] Take vitamins [↗ ↻](${URL}#2026-10-12T09:30)`, 0)!;
	assert.equal(line.link!.taskId, '6XGgm6PHrGgMpCFX');
	assert.equal(line.link!.occurrence, '2026-10-12T09:30');
	assert.equal(line.name, 'Take vitamins');

	const text = formatTaskLine({ indent: '', bullet: '-', checked: false, name: 'Take vitamins', link: { text: '↗ ↻', taskId: 'abc123', occurrence: '2026-10-12' } });
	assert.equal(text, '- [ ] Take vitamins [↗ ↻](https://app.todoist.com/app/task/abc123#2026-10-12)');
	assert.equal(parseTaskLine(text, 0)!.link!.occurrence, '2026-10-12');
});

test('link text with brackets survives a round trip', () => {
	const text = formatTaskLine({ indent: '\t', bullet: '-', checked: true, name: 'Thing', link: { text: '↗ ##A [b]', taskId: 'abc123' } });
	assert.equal(text, '\t- [x] Thing [↗ ##A \\[b\\]](https://app.todoist.com/app/task/abc123)');
	assert.equal(parseTaskLine(text, 0)!.link!.text, '↗ ##A [b]');
});

test('formats an unlinked line', () => {
	assert.equal(formatTaskLine({ indent: '', bullet: '-', checked: false, name: 'Thing', link: null }), '- [ ] Thing');
});

test('skips checkboxes inside code blocks and finds query blocks', () => {
	const note = parseNote([
		'# Journal',
		'```todoist',
		'filter: today | overdue',
		'```',
		'- [ ] Real task',
		'~~~',
		'- [ ] In a code block',
		'~~~',
		'```js',
		'- [ ] Also code',
		'```',
		'- [x] Another real task',
	].join('\n'));

	assert.deepEqual(note.taskLines.map(line => line.name), ['Real task', 'Another real task']);
	assert.deepEqual(note.queryBlocks, [{ startLine: 1, endLine: 3, filter: 'today | overdue', fetched: null }]);
});

test('reads the fetched line of a block that has run', () => {
	const note = parseNote('```todoist\nfilter: #Work & today\nfetched: 2026-10-10 08:31\n```');
	assert.equal(note.queryBlocks[0].filter, '#Work & today');
	assert.equal(note.queryBlocks[0].fetched, '2026-10-10 08:31');
});

test('inline code at the start of a line does not open a code block', () => {
	const note = parseNote('```not a fence``` text\n- [ ] Real task');
	assert.equal(note.taskLines.length, 1);
});

test('an unclosed query block is not a query block', () => {
	const note = parseNote('```todoist\nfilter: today\n- [ ] Not a task');
	assert.equal(note.queryBlocks.length, 0);
	assert.equal(note.taskLines.length, 0);
});

test('sets and replaces the fetched line', () => {
	assert.deepEqual(
		withFetched(['```todoist', 'filter: today', '```'], '2026-10-11 09:00'),
		['```todoist', 'filter: today', 'fetched: 2026-10-11 09:00', '```'],
	);
	assert.deepEqual(
		withFetched(['```todoist', 'filter: today', 'fetched: 2026-10-10 08:31', '```'], '2026-10-11 09:00'),
		['```todoist', 'filter: today', 'fetched: 2026-10-11 09:00', '```'],
	);
});

test('plans where fetched tasks go', () => {
	const plan = (body: string) => {
		const note = parseNote(body);
		return planInsert(note.lines, note.queryBlocks[0]);
	};
	const block = '```todoist\nfilter: today\n```';

	// Nothing after the block.
	assert.deepEqual(plan(block), { beforeLine: 3, blankAfter: false });
	// Text right after the block.
	assert.deepEqual(plan(`${block}\nSome text`), { beforeLine: 3, blankAfter: true });
	// A list right after the block: append to it.
	assert.deepEqual(plan(`${block}\n- [ ] One\n- [ ] Two\n\nText`), { beforeLine: 5, blankAfter: false });
	// A list after a blank line, with an indented child.
	assert.deepEqual(plan(`${block}\n\n- [ ] One\n  - [ ] Child\nText`), { beforeLine: 6, blankAfter: true });
	// A heading after a blank line: stay right below the block.
	assert.deepEqual(plan(`${block}\n\n## Notes`), { beforeLine: 3, blankAfter: false });
});
