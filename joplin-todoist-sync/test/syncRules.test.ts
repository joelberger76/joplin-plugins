import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseTaskLine } from '../src/noteParser';
import { decideSync, isFetchable, rewriteLine, syncLineOf, TaskState } from '../src/syncRules';
import { TaskInfo } from '../src/types';

const ID = '6XGgm6PHrGgMpCFX';
const URL = `https://app.todoist.com/app/task/${ID}`;

function day(month: number, date: number): Date {
	return new Date(2026, month - 1, date);
}

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
	return { id: ID, content: 'Take vitamins', checked: false, priority: 1, due: null, projectId: 'p1', labels: [], ...overrides };
}

function recurring(date: string, overrides: Partial<TaskInfo> = {}): TaskInfo {
	return task({ due: { date, isRecurring: true }, ...overrides });
}

// Runs Sync's decision for one line and returns it with the line as it
// would be rewritten.
function sync(lineText: string, state: TaskInfo | 'missing', today: Date) {
	const line = parseTaskLine(lineText, 0)!;
	const taskState: TaskState = state === 'missing' ? { kind: 'missing' } : { kind: 'found', task: state };
	const decision = decideSync(syncLineOf(line), taskState, today);
	const text = rewriteLine(line, decision, state === 'missing' ? null : state, { showDetails: true, projectName: null, today });
	return { decision, text, stillLinked: parseTaskLine(text, 0)!.link !== null };
}

// SPEC.md section 6.1

test('6.1 unchecked box, open task: nothing', () => {
	const line = `- [ ] Take vitamins [↗](${URL})`;
	const result = sync(line, task(), day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.decision.checkBox, false);
	assert.equal(result.text, line);
});

test('6.1 unchecked box, completed task: box is checked', () => {
	const result = sync(`- [ ] Take vitamins [↗](${URL})`, task({ checked: true }), day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.text, `- [x] Take vitamins [↗](${URL})`);
});

test('6.1 checked box, open task: task is closed', () => {
	const result = sync(`- [x] Take vitamins [↗](${URL})`, task(), day(10, 11));
	assert.equal(result.decision.closeTask, true);
	assert.equal(result.stillLinked, true);
});

test('6.1 checked box, completed task: nothing', () => {
	const line = `- [x] Take vitamins [↗](${URL})`;
	const result = sync(line, task({ checked: true }), day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.text, line);
});

// SPEC.md sections 6.2 and 3.3

test('6.2 the line takes the name and details from Todoist', () => {
	const result = sync(
		`  - [ ] Old name #tag [↗ Oct 12](${URL})`,
		task({ content: 'New name', priority: 4, due: { date: '2026-10-14', isRecurring: false }, labels: ['errand'] }),
		day(10, 11),
	);
	assert.equal(result.text, `  - [ ] New name [↗ Oct 14 · p1 · @@errand](${URL})`);
});

// SPEC.md section 6.3

test('6.3 a missing task is reported and the line is left alone', () => {
	const line = `- [x] Take vitamins [↗ Oct 10](${URL})`;
	const result = sync(line, 'missing', day(10, 11));
	assert.equal(result.decision.notice, 'missing');
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.text, line);
});

// SPEC.md section 7.1. The scenario numbers match the spec.

test('7.1 #1 daily task, checked, synced the same day: one close, link removed, nothing to do the next day', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`, recurring('2026-10-10'), day(10, 10));
	assert.equal(result.decision.closeTask, true);
	assert.equal(result.text, '- [x] Take vitamins');
	// The line is no longer linked, so the next Sync never looks at it.
	assert.equal(result.stillLinked, false);
});

test('7.1 #2 unchecked, task still due on the line date: no change', () => {
	const line = `- [ ] Take vitamins [↗ Oct 10 2026 ↻](${URL})`;
	const result = sync(line, recurring('2026-10-10'), day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.decision.checkBox, false);
	assert.equal(result.text, line);
});

test('7.1 #3 unchecked, completed elsewhere: box stays unchecked and the date stays pinned (known gap)', () => {
	const line = `- [ ] Take vitamins [↗ Oct 10 2026 ↻](${URL})`;
	const result = sync(line, recurring('2026-10-11'), day(10, 11));
	assert.equal(result.decision.checkBox, false);
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.text, line);
});

test('7.1 #4 across midnight: completed on the phone, ticked the next day: no close', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`, recurring('2026-10-11'), day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.decision.notice, 'movedOn');
	assert.equal(result.text, '- [x] Take vitamins');
});

test('7.1 #5 completed on the phone and ticked the same day: no close', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`, recurring('2026-10-11'), day(10, 10));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.stillLinked, false);
});

test('7.1 #6 weekly task ticked early: one close, link removed', () => {
	const result = sync(`- [x] Water plants [↗ Oct 17 2026 ↻](${URL})`, recurring('2026-10-17'), day(10, 14));
	assert.equal(result.decision.closeTask, true);
	assert.equal(result.decision.notice, null);
	assert.equal(result.stillLinked, false);
});

test('7.1 #7 five days overdue, checked: one close', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 6 2026 ↻](${URL})`, recurring('2026-10-06'), day(10, 11));
	assert.equal(result.decision.closeTask, true);
	assert.equal(result.stillLinked, false);
});

test('7.1 #8 postponed in Todoist, then ticked: no close, reported as moved on', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`, recurring('2026-10-13'), day(10, 10));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.decision.notice, 'movedOn');
	assert.equal(result.stillLinked, false);
});

test('7.1 #9 the same occurrence checked in two notes: closed once', () => {
	const line = `- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`;
	const noteA = sync(line, recurring('2026-10-10'), day(10, 10));
	assert.equal(noteA.decision.closeTask, true);
	// Todoist has now moved the task to the next day.
	const noteB = sync(line, recurring('2026-10-11'), day(10, 10));
	assert.equal(noteB.decision.closeTask, false);
	assert.equal(noteB.stillLinked, false);
});

test('7.1 #10 twice a day: the morning line does not close the evening occurrence', () => {
	const result = sync(`- [x] Take vitamins [↗ Oct 10 2026 09:00 ↻](${URL})`, recurring('2026-10-10T21:00:00'), day(10, 10));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.stillLinked, false);

	const same = sync(`- [x] Take vitamins [↗ Oct 10 2026 09:00 ↻](${URL})`, recurring('2026-10-10T09:00:00'), day(10, 10));
	assert.equal(same.decision.closeTask, true);
});

test('7.1 #11 date deleted by hand: falls back to due today or earlier', () => {
	const line = `- [x] Take vitamins [↗](${URL})`;
	const dueToday = sync(line, recurring('2026-10-11'), day(10, 11));
	assert.equal(dueToday.decision.closeTask, true);
	assert.equal(dueToday.stillLinked, false);

	const dueTomorrow = sync(line, recurring('2026-10-12'), day(10, 11));
	assert.equal(dueTomorrow.decision.closeTask, false);
	assert.equal(dueTomorrow.stillLinked, false);
});

test('7.1 #12 ended recurrence, completed in Todoist: box is checked', () => {
	const ended = task({ checked: true, due: { date: '2026-10-10', isRecurring: true } });
	const result = sync(`- [ ] Take vitamins [↗ Oct 10 2026 ↻](${URL})`, ended, day(10, 11));
	assert.equal(result.decision.closeTask, false);
	assert.equal(result.text, `- [x] Take vitamins [↗ Oct 10 2026 ↻](${URL})`);
});

test('7 an unchecked recurring line still takes a new name and priority, with its date pinned', () => {
	const result = sync(
		`- [ ] Take vitamins [↗ Oct 10 2026 ↻](${URL})`,
		recurring('2026-10-13', { content: 'Take vitamin D', priority: 3 }),
		day(10, 11),
	);
	assert.equal(result.text, `- [ ] Take vitamin D [↗ Oct 10 2026 ↻ · p2](${URL})`);
});

test('7 a recurring line with no date gets the current one when refreshed', () => {
	const result = sync(`- [ ] Take vitamins [↗](${URL})`, recurring('2026-10-11'), day(10, 11));
	assert.equal(result.text, `- [ ] Take vitamins [↗ Oct 11 2026 ↻](${URL})`);
});

// SPEC.md section 7, rule 1 (scenario 13 uses this)

test('7 rule 1: a recurring task is fetched only when due today or earlier', () => {
	const today = day(10, 11);
	assert.equal(isFetchable(recurring('2026-10-10'), today), true);
	assert.equal(isFetchable(recurring('2026-10-11'), today), true);
	assert.equal(isFetchable(recurring('2026-10-18'), today), false);
	// Tasks that do not recur are always fetched, whatever their date.
	assert.equal(isFetchable(task({ due: { date: '2026-10-18', isRecurring: false } }), today), true);
	assert.equal(isFetchable(task(), today), true);
});
