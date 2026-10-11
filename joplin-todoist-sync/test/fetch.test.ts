import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { ChangeSet, EditorState } from '@codemirror/state';
import { resolveEdits, TextEdit } from '../src/edits';
import { FetchOptions, planFetch, planNewBlock } from '../src/fetchPlan';
import { parseNote } from '../src/noteParser';
import { TaskInfo } from '../src/types';

const TODAY = new Date(2026, 9, 11);

const options: FetchOptions = {
	today: TODAY,
	timestamp: '2026-10-11 09:00',
	showDetails: true,
	projectNames: new Map([['work', 'Work']]),
};

function task(id: string, content: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
	return { id, content, checked: false, priority: 1, due: null, projectId: 'inbox', labels: [], ...overrides };
}

function link(id: string, text = '↗', occurrence = ''): string {
	return `[${text}](https://app.todoist.com/app/task/${id}${occurrence ? `#${occurrence}` : ''})`;
}

// Applies edits the way the editor script does: through a real CodeMirror
// document, with `typing` (if any) done after the snapshot was taken.
function apply(body: string, edits: TextEdit[], typing?: (state: EditorState) => { from: number; to?: number; insert: string }) {
	let state = EditorState.create({ doc: body });
	let changes = ChangeSet.empty(state.doc.length).desc;

	if (typing) {
		const transaction = state.update({ changes: typing(state) });
		changes = changes.composeDesc(transaction.changes.desc);
		state = transaction.state;
	}

	const resolved = resolveEdits(edits, {
		mapPos: (pos, assoc) => changes.mapPos(pos, assoc),
		slice: (from, to) => state.sliceDoc(from, to),
	});
	return { text: state.update({ changes: resolved.changes }).state.doc.toString(), skipped: resolved.skippedGroups };
}

function fetchInto(body: string, tasks: TaskInfo[]) {
	const note = parseNote(body);
	const plan = planFetch(note, note.queryBlocks.map(block => ({ block, tasks })), options);
	return { plan, ...apply(body, plan.edits) };
}

test('first fetch: writes the fetched line and the tasks below the block', () => {
	const result = fetchInto(
		'# Journal\n\n```todoist\nfilter: today | overdue\n```\n\n## Notes\n',
		[
			task('a1', 'Call the plumber', { priority: 4, due: { date: '2026-10-11', isRecurring: false }, projectId: 'work' }),
			task('b2', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } }),
		],
	);

	assert.equal(result.text, [
		'# Journal',
		'',
		'```todoist',
		'filter: today | overdue',
		'fetched: 2026-10-11 09:00',
		'```',
		`- [ ] Call the plumber ${link('a1', '↗ p1 · ##Work')}`,
		`- [ ] Take vitamins ${link('b2', '↗ ↻', '2026-10-11')}`,
		'',
		'## Notes',
		'',
	].join('\n'));
	assert.equal(result.plan.added, 2);
});

test('fetching again adds only what is new, at the end of the list (7.1 #14)', () => {
	const first = fetchInto('```todoist\nfilter: today\n```\n', [task('a1', 'One'), task('b2', 'Two')]);
	const again = fetchInto(first.text, [task('a1', 'One'), task('b2', 'Two')]);
	assert.equal(again.plan.added, 0);
	assert.equal(again.plan.alreadyLinked, 2);
	assert.equal(again.text, first.text);

	const more = fetchInto(first.text, [task('a1', 'One'), task('c3', 'Three'), task('b2', 'Two')]);
	assert.equal(more.text, [
		'```todoist',
		'filter: today',
		'fetched: 2026-10-11 09:00',
		'```',
		`- [ ] One ${link('a1')}`,
		`- [ ] Two ${link('b2')}`,
		`- [ ] Three ${link('c3')}`,
		'',
	].join('\n'));
});

test('a task linked anywhere in the note is not fetched again', () => {
	const body = `- [x] Done earlier ${link('a1')}\n\n\`\`\`todoist\nfilter: today\n\`\`\``;
	const result = fetchInto(body, [task('a1', 'Done earlier'), task('b2', 'New')]);
	assert.equal(result.plan.added, 1);
	assert.equal(result.plan.alreadyLinked, 1);
	assert.ok(result.text.endsWith(`\`\`\`\n- [ ] New ${link('b2')}`));
});

test('a recurring task that is not due yet is not fetched (7.1 #13)', () => {
	const result = fetchInto('```todoist\nfilter: #Work\n```', [
		task('a1', 'Weekly review', { due: { date: '2026-10-18', isRecurring: true } }),
		task('b2', 'Later, but not recurring', { due: { date: '2026-10-18', isRecurring: false } }),
	]);
	assert.equal(result.plan.added, 1);
	assert.equal(result.plan.notDue, 1);
	assert.ok(!result.text.includes('Weekly review'));
});

test('no results still marks the block as fetched', () => {
	const result = fetchInto('```todoist\nfilter: today\n```', []);
	assert.equal(result.text, '```todoist\nfilter: today\nfetched: 2026-10-11 09:00\n```');
});

test('text right after the block is kept apart from the new list', () => {
	const result = fetchInto('```todoist\nfilter: today\n```\nSome text', [task('a1', 'One')]);
	assert.equal(result.text, `\`\`\`todoist\nfilter: today\nfetched: 2026-10-11 09:00\n\`\`\`\n- [ ] One ${link('a1')}\n\nSome text`);
});

test('two blocks: a task goes under the first block that matches it', () => {
	const body = '```todoist\nfilter: today\n```\n\n```todoist\nfilter: #Work\n```';
	const note = parseNote(body);
	const plan = planFetch(note, [
		{ block: note.queryBlocks[1], tasks: [task('a1', 'One'), task('b2', 'Two')] },
		{ block: note.queryBlocks[0], tasks: [task('a1', 'One')] },
	], options);
	const text = apply(body, plan.edits).text;
	assert.equal(text, [
		'```todoist', 'filter: today', 'fetched: 2026-10-11 09:00', '```',
		`- [ ] One ${link('a1')}`,
		'',
		'```todoist', 'filter: #Work', 'fetched: 2026-10-11 09:00', '```',
		`- [ ] Two ${link('b2')}`,
	].join('\n'));
});

test('a block that was not run is left alone', () => {
	const body = '```todoist\nfilter: today\n```\n\n```todoist\n```';
	const note = parseNote(body);
	const plan = planFetch(note, [{ block: note.queryBlocks[0], tasks: [] }], options);
	assert.ok(apply(body, plan.edits).text.endsWith('\n\n```todoist\n```'));
});

test('typing elsewhere while Todoist answers does not disturb the fetch', () => {
	const body = 'Intro\n\n```todoist\nfilter: today\n```\n\nOutro';
	const note = parseNote(body);
	const plan = planFetch(note, [{ block: note.queryBlocks[0], tasks: [task('a1', 'One')] }], options);

	// Two new lines typed at the top of the note.
	const result = apply(body, plan.edits, () => ({ from: 0, insert: 'New first line\nand another\n' }));
	assert.deepEqual(result.skipped, []);
	assert.equal(result.text, [
		'New first line', 'and another', 'Intro', '',
		'```todoist', 'filter: today', 'fetched: 2026-10-11 09:00', '```',
		`- [ ] One ${link('a1')}`,
		'', 'Outro',
	].join('\n'));
});

test('editing the block itself while Todoist answers skips that block whole', () => {
	const body = '```todoist\nfilter: today\n```\nText';
	const note = parseNote(body);
	const plan = planFetch(note, [{ block: note.queryBlocks[0], tasks: [task('a1', 'One')] }], options);

	// The closing fence is turned into something else.
	const fence = body.indexOf('```\nText');
	const result = apply(body, plan.edits, () => ({ from: fence, to: fence + 3, insert: '~~~' }));
	assert.deepEqual(result.skipped, ['block@0']);
	assert.equal(result.text, '```todoist\nfilter: today\n~~~\nText');
});

test('no block in the note: a new one is written at the cursor', () => {
	const tasks = [task('a1', 'One')];

	// Cursor on an empty line, with text right below it: the empty line
	// stays, to keep the text apart from the list.
	const onEmpty = 'Intro\n\nOutro';
	const first = planNewBlock(parseNote(onEmpty), 1, 'today | overdue', tasks, options);
	assert.equal(apply(onEmpty, first.edits).text, [
		'Intro',
		'```todoist', 'filter: today | overdue', 'fetched: 2026-10-11 09:00', '```',
		`- [ ] One ${link('a1')}`,
		'', 'Outro',
	].join('\n'));

	// Cursor on an empty line with nothing, or another empty line, below
	// it: no blank line is added.
	for (const body of ['Intro\n', 'Intro\n\n\nOutro']) {
		const plan = planNewBlock(parseNote(body), 1, 'today', tasks, options);
		const block = `\`\`\`todoist\nfilter: today\nfetched: 2026-10-11 09:00\n\`\`\`\n- [ ] One ${link('a1')}`;
		assert.equal(apply(body, plan.edits).text, body === 'Intro\n' ? `Intro\n${block}` : `Intro\n${block}\n\nOutro`);
	}

	// Cursor on a line with text: the block goes below it.
	const onText = 'Intro\nOutro';
	const second = planNewBlock(parseNote(onText), 0, 'today', tasks, options);
	assert.equal(apply(onText, second.edits).text, [
		'Intro', '',
		'```todoist', 'filter: today', 'fetched: 2026-10-11 09:00', '```',
		`- [ ] One ${link('a1')}`,
		'', 'Outro',
	].join('\n'));

	// Cursor on the last line.
	const third = planNewBlock(parseNote('Intro'), 0, 'today', tasks, options);
	assert.equal(apply('Intro', third.edits).text, `Intro\n\n\`\`\`todoist\nfilter: today\nfetched: 2026-10-11 09:00\n\`\`\`\n- [ ] One ${link('a1')}`);

	// An empty note.
	const fourth = planNewBlock(parseNote(''), 0, 'today', [], options);
	assert.equal(apply('', fourth.edits).text, '```todoist\nfilter: today\nfetched: 2026-10-11 09:00\n```');
});

test('what Fetch writes, the parser reads back as linked lines and a fetched block', () => {
	const result = fetchInto('```todoist\nfilter: today\n```', [task('a1', 'One [draft]', { labels: ['a b'] })]);
	const note = parseNote(result.text);
	assert.equal(note.queryBlocks[0].fetched, '2026-10-11 09:00');
	assert.equal(note.taskLines.length, 1);
	assert.equal(note.taskLines[0].name, 'One [draft]');
	assert.equal(note.taskLines[0].link!.taskId, 'a1');
	assert.equal(note.taskLines[0].link!.text, '↗ @@a b');
});
