import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { formatLinkText, isDueByToday, parseDue, parseLinkText, priorityLabel, sameOccurrence } from '../src/details';
import { TaskInfo } from '../src/types';

const TODAY = new Date(2026, 9, 11);

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
	return { id: 't1', content: 'Thing', checked: false, priority: 1, due: null, projectId: 'p1', labels: [], ...overrides };
}

const options = { showDetails: true, projectName: null as string | null, today: TODAY };

test('priority runs backwards in the API', () => {
	assert.equal(priorityLabel(4), 'p1');
	assert.equal(priorityLabel(3), 'p2');
	assert.equal(priorityLabel(2), 'p3');
	assert.equal(priorityLabel(1), null);
});

test('parses whole-day, floating and fixed-timezone due dates', () => {
	assert.deepEqual(parseDue('2026-10-12'), { year: 2026, month: 10, day: 12, hour: null, minute: null });
	assert.deepEqual(parseDue('2026-10-12T14:00:00'), { year: 2026, month: 10, day: 12, hour: 14, minute: 0 });

	const local = new Date(Date.UTC(2026, 9, 12, 14, 0));
	assert.deepEqual(parseDue('2026-10-12T14:00:00Z'), {
		year: local.getFullYear(), month: local.getMonth() + 1, day: local.getDate(), hour: local.getHours(), minute: local.getMinutes(),
	});
	assert.equal(parseDue('tomorrow'), null);
});

test('a task with no details is just the mark', () => {
	assert.equal(formatLinkText(task(), options), '↗');
});

test('formats every part in order', () => {
	const text = formatLinkText(
		task({ priority: 4, due: { date: '2026-10-12', isRecurring: false }, labels: ['Joel Berger', 'errand'] }),
		{ ...options, projectName: 'Work' },
	);
	assert.equal(text, '↗ Oct 12 · p1 · ##Work · @@Joel Berger · @@errand');
});

test('shows a time, and the year when it is not this year', () => {
	assert.equal(formatLinkText(task({ due: { date: '2026-10-12T14:00:00', isRecurring: false } }), options), '↗ Oct 12 14:00');
	assert.equal(formatLinkText(task({ due: { date: '2027-01-05', isRecurring: false } }), options), '↗ Jan 5 2027');
});

test('a recurring task always shows its year and the mark', () => {
	assert.equal(formatLinkText(task({ due: { date: '2026-10-12', isRecurring: true } }), options), '↗ Oct 12 2026 ↻');
});

test('with details off, only a recurring task keeps its date', () => {
	const off = { ...options, showDetails: false, projectName: 'Work' };
	assert.equal(formatLinkText(task({ priority: 4, due: { date: '2026-10-12', isRecurring: false } }), off), '↗');
	assert.equal(formatLinkText(task({ priority: 4, due: { date: '2026-10-12', isRecurring: true } }), off), '↗ Oct 12 2026 ↻');
});

test('a pinned date is kept, not refreshed', () => {
	const moved = task({ priority: 3, due: { date: '2026-10-13', isRecurring: true } });
	assert.equal(formatLinkText(moved, { ...options, pinnedDateText: 'Oct 10 2026' }), '↗ Oct 10 2026 ↻ · p2');
	// A pinned date means nothing for a task that is not recurring.
	const plain = task({ due: { date: '2026-10-13', isRecurring: false } });
	assert.equal(formatLinkText(plain, { ...options, pinnedDateText: 'Oct 10 2026' }), '↗ Oct 13');
});

test('reads the date and the recurring mark back from link text', () => {
	assert.deepEqual(parseLinkText('↗'), { date: null, recurring: false });
	assert.deepEqual(parseLinkText('↗ p1 · ##Work'), { date: null, recurring: false });

	const pinned = parseLinkText('↗ Oct 10 2026 ↻ · p1 · ##Work');
	assert.equal(pinned.recurring, true);
	assert.deepEqual(pinned.date, { text: 'Oct 10 2026', year: 2026, month: 10, day: 10, hour: null, minute: null });

	const timed = parseLinkText('↗ Oct 10 2026 09:00 ↻');
	assert.deepEqual(timed.date, { text: 'Oct 10 2026 09:00', year: 2026, month: 10, day: 10, hour: 9, minute: 0 });

	const noYear = parseLinkText('↗ Oct 12 14:00 · p2');
	assert.deepEqual(noYear.date, { text: 'Oct 12 14:00', year: null, month: 10, day: 12, hour: 14, minute: 0 });
	assert.equal(noYear.recurring, false);
});

test('what the plugin writes, it can read back', () => {
	const due = { date: '2026-10-12T09:30:00', isRecurring: true };
	const text = formatLinkText(task({ due, priority: 4, labels: ['a'] }), { ...options, projectName: 'Work' });
	const read = parseLinkText(text);
	assert.equal(read.recurring, true);
	assert.equal(sameOccurrence(read.date!, due), true);
});

test('same occurrence compares date, time and year', () => {
	const date = parseLinkText('↗ Oct 10 2026 ↻').date!;
	assert.equal(sameOccurrence(date, { date: '2026-10-10', isRecurring: true }), true);
	assert.equal(sameOccurrence(date, { date: '2026-10-11', isRecurring: true }), false);
	// A yearly task comes back on the same day and month.
	assert.equal(sameOccurrence(date, { date: '2027-10-10', isRecurring: true }), false);
	// A whole-day line is not the same as a timed occurrence.
	assert.equal(sameOccurrence(date, { date: '2026-10-10T09:00:00', isRecurring: true }), false);

	const morning = parseLinkText('↗ Oct 10 2026 09:00 ↻').date!;
	assert.equal(sameOccurrence(morning, { date: '2026-10-10T09:00:00', isRecurring: true }), true);
	assert.equal(sameOccurrence(morning, { date: '2026-10-10T21:00:00', isRecurring: true }), false);
});

test('due today or earlier', () => {
	assert.equal(isDueByToday(null, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-10', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-11', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-11T23:30:00', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-12', isRecurring: true }, TODAY), false);
	assert.equal(isDueByToday({ date: '2027-01-01', isRecurring: true }, TODAY), false);
});
