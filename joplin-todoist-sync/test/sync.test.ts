import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { apply } from './applyEdits';
import { parseNote } from '../src/noteParser';
import { duplicateLinks, planSync, reportSync, syncEdits, SyncOptions, tasksToClose, writableItems } from '../src/syncPlan';
import { TaskState } from '../src/syncRules';
import { TaskInfo } from '../src/types';

const options: SyncOptions = {
	today: new Date(2026, 9, 11),
	showDetails: true,
	projectNames: new Map([['work', 'Work']]),
};

function task(id: string, content: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
	return { id, content, checked: false, priority: 1, due: null, projectId: 'inbox', labels: [], ...overrides };
}

function link(id: string, text = '↗', occurrence = ''): string {
	return `[${text}](https://app.todoist.com/app/task/${id}${occurrence ? `#${occurrence}` : ''})`;
}

function statesOf(...entries: Array<TaskInfo | string>): Map<string, TaskState> {
	const states = new Map<string, TaskState>();
	for (const entry of entries) {
		if (typeof entry === 'string') states.set(entry, { kind: 'missing' });
		else states.set(entry.id, { kind: 'found', task: entry });
	}
	return states;
}

// Runs a whole Sync on a note body, without Joplin or the network.
// `failing` holds the ids of tasks whose close call fails.
function sync(body: string, states: Map<string, TaskState>, failing: string[] = []) {
	const note = parseNote(body);
	const items = planSync(note, states, options);
	const closes = tasksToClose(items);
	const failed = new Map(closes.filter(id => failing.includes(id)).map(id => [id, 'status 500'] as [string, string]));
	const edits = syncEdits(note, writableItems(items, failed));
	const applied = apply(body, edits);
	return { closes, text: applied.text, report: reportSync(items, failed, applied.skipped), note, items };
}

test('a whole note: every kind of line in one Sync', () => {
	const body = [
		'# Journal',
		`- [ ] Open, nothing to do ${link('a1')}`,
		`- [ ] Done in Todoist ${link('b2')}`,
		`- [x] Done here ${link('c3')}`,
		`  * [ ] Old name ${link('d4', '↗ p3')}`,
		`- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-11')}`,
		`- [x] Water plants ${link('f6', '↗ ↻', '2026-10-10')}`,
		`- [ ] Deleted in Todoist ${link('g7')}`,
		'- [ ] Not linked',
		'```',
		`- [x] In a code block ${link('zz')}`,
		'```',
	].join('\n');

	const result = sync(body, statesOf(
		task('a1', 'Open, nothing to do'),
		task('b2', 'Done in Todoist', { checked: true }),
		task('c3', 'Done here'),
		task('d4', 'New name', { priority: 4, projectId: 'work', labels: ['errand'] }),
		task('e5', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } }),
		task('f6', 'Water plants', { due: { date: '2026-10-17', isRecurring: true } }),
		'g7',
	));

	assert.deepEqual(result.closes, ['c3', 'e5']);
	assert.equal(result.text, [
		'# Journal',
		`- [ ] Open, nothing to do ${link('a1')}`,
		`- [x] Done in Todoist ${link('b2')}`,
		`- [x] Done here ${link('c3')}`,
		`  * [ ] New name ${link('d4', '↗ p1 · ##Work · @@errand')}`,
		'- [x] Take vitamins',
		'- [x] Water plants',
		`- [ ] Deleted in Todoist ${link('g7')}`,
		'- [ ] Not linked',
		'```',
		`- [x] In a code block ${link('zz')}`,
		'```',
	].join('\n'));
	assert.equal(result.report.summary, 'Synced 7 tasks: 2 closed in Todoist, 1 checked off in the note, 1 updated.');
	assert.deepEqual(result.report.problems, [
		'Already completed or rescheduled in Todoist, so the task was left as it is. Link removed: Water plants',
		'Not found in Todoist: Deleted in Todoist',
	]);
});

test('nothing to change', () => {
	const body = `- [ ] One ${link('a1')}\n- [x] Two ${link('b2')}`;
	const result = sync(body, statesOf(task('a1', 'One'), task('b2', 'Two', { checked: true })));
	assert.deepEqual(result.closes, []);
	assert.equal(result.text, body);
	assert.equal(result.report.summary, 'Synced 2 tasks, nothing to change.');
	assert.deepEqual(result.report.problems, []);
});

test('a problem line alone does not say "nothing to change"', () => {
	const body = `- [ ] One ${link('a1')}\n- [x] Water plants ${link('f6', '↗ ↻', '2026-10-10')}`;
	const result = sync(body, statesOf(
		task('a1', 'One'),
		task('f6', 'Water plants', { due: { date: '2026-10-17', isRecurring: true } }),
	));
	assert.deepEqual(result.closes, []);
	assert.equal(result.report.summary, 'Synced 2 tasks.');
	assert.deepEqual(result.report.problems, [
		'Already completed or rescheduled in Todoist, so the task was left as it is. Link removed: Water plants',
	]);
});

test('7.1 #1 and #9 run twice: the second Sync has no linked line left and closes nothing', () => {
	const body = `- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-10')}`;
	const first = sync(body, statesOf(task('e5', 'Take vitamins', { due: { date: '2026-10-10', isRecurring: true } })));
	assert.deepEqual(first.closes, ['e5']);
	assert.equal(first.text, '- [x] Take vitamins');

	// Todoist has moved the task on. The line is no longer linked.
	const second = sync(first.text, statesOf(task('e5', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } })));
	assert.deepEqual(second.closes, []);
	assert.equal(second.items.length, 0);
});

test('a task linked on more than one line is found before anything is synced', () => {
	const line = `- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-11')}`;
	const body = [line, `- [ ] One ${link('a1')}`, '', 'Later that day:', line, `  - [ ] Take vitamins again ${link('e5')}`, '```', line, '```'].join('\n');
	assert.deepEqual(duplicateLinks(parseNote(body)), ['Linked on lines 1, 5 and 6: Take vitamins']);
	assert.deepEqual(duplicateLinks(parseNote(`${line}\n- [ ] One ${link('a1')}`)), []);
});

test('even if a task were linked twice, it would be closed once', () => {
	const line = `- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-11')}`;
	const result = sync(`${line}\n${line}`, statesOf(task('e5', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } })));
	assert.deepEqual(result.closes, ['e5']);
});

test('a close that fails leaves its line exactly as it was, and is reported', () => {
	const body = [
		`- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-11')}`,
		`- [x] Old name ${link('c3')}`,
		`- [ ] Done in Todoist ${link('b2')}`,
	].join('\n');
	const result = sync(body, statesOf(
		task('e5', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } }),
		task('c3', 'New name'),
		task('b2', 'Done in Todoist', { checked: true }),
	), ['e5', 'c3']);

	assert.equal(result.text, [
		`- [x] Take vitamins ${link('e5', '↗ ↻', '2026-10-11')}`,
		`- [x] Old name ${link('c3')}`,
		`- [x] Done in Todoist ${link('b2')}`,
	].join('\n'));
	assert.equal(result.report.summary, 'Synced 3 tasks: 1 checked off in the note.');
	assert.equal(result.report.problems.length, 2);
	assert.match(result.report.problems[0], /^Could not close in Todoist, line left as it was: Take vitamins/);
});

test('a line edited while Todoist answers is skipped by itself and reported', () => {
	const body = `- [ ] One ${link('a1')}\n- [ ] Old name ${link('d4')}`;
	const note = parseNote(body);
	const items = planSync(note, statesOf(task('a1', 'One', { checked: true }), task('d4', 'New name')), options);
	const edits = syncEdits(note, items);

	// "Old" is retyped as "Older" on the second line, and a line is added on top.
	const at = body.indexOf('Old name');
	const typed = apply(body, edits, () => ({ from: at, to: at + 3, insert: 'Older' }));
	assert.deepEqual(typed.skipped, ['line@1']);
	assert.equal(typed.text, `- [x] One ${link('a1')}\n- [ ] Older name ${link('d4')}`);

	const report = reportSync(items, new Map(), typed.skipped);
	assert.equal(report.summary, 'Synced 2 tasks: 1 checked off in the note.');
	assert.deepEqual(report.problems, ['Edited while syncing, so the line was not updated: Old name']);

	const above = apply(body, edits, () => ({ from: 0, insert: 'New first line\n' }));
	assert.deepEqual(above.skipped, []);
	assert.equal(above.text, `New first line\n- [x] One ${link('a1')}\n- [ ] New name ${link('d4')}`);
});

test('every task missing: nothing is changed and every line is listed (6.3)', () => {
	const body = `- [ ] One ${link('a1')}\n- [x] Two ${link('b2', '↗ ↻', '2026-10-10')}`;
	const result = sync(body, statesOf('a1', 'b2'));
	assert.deepEqual(result.closes, []);
	assert.equal(result.text, body);
	assert.deepEqual(result.report.problems, ['Not found in Todoist: One', 'Not found in Todoist: Two']);
});

test('the details setting off: the arrow alone, and a recurring line keeps its occurrence', () => {
	const body = `- [ ] One ${link('a1', '↗ p1 · ##Work')}\n- [ ] Take vitamins ${link('e5', '↗ ↻', '2026-10-10')}`;
	const note = parseNote(body);
	const states = statesOf(
		task('a1', 'One', { priority: 4, projectId: 'work' }),
		task('e5', 'Take vitamins', { due: { date: '2026-10-11', isRecurring: true } }),
	);
	const items = planSync(note, states, { ...options, showDetails: false, projectNames: new Map() });
	assert.equal(apply(body, syncEdits(note, items)).text, `- [ ] One ${link('a1')}\n- [ ] Take vitamins ${link('e5', '↗', '2026-10-10')}`);
});
