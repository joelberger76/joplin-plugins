import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { pad } from '../src/text';
import { formatLinkText, isCurrentOccurrence, isDueByToday, isOccurrence, occurrenceOf, parseDue, priorityLabel } from '../src/details';
import { TaskInfo } from '../src/types';

const TODAY = new Date(2026, 9, 11);

function task(overrides: Partial<TaskInfo> = {}): TaskInfo {
	return { id: 't1', content: 'Thing', checked: false, priority: 1, due: null, projectId: 'p1', labels: [], ...overrides };
}

const options = { showDetails: true, projectName: null as string | null };

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
		task({ priority: 4, due: { date: '2026-10-12', isRecurring: true }, labels: ['Joel Berger', 'errand'] }),
		{ ...options, projectName: 'Work' },
	);
	assert.equal(text, '↗ ↻ · p1 · ##Work · @@Joel Berger · @@errand');
});

test('no date is shown, recurring or not', () => {
	assert.equal(formatLinkText(task({ due: { date: '2026-10-12T14:00:00', isRecurring: false } }), options), '↗');
	assert.equal(formatLinkText(task({ due: { date: '2026-10-12', isRecurring: true } }), options), '↗ ↻');
});

test('with details off, the link text is just the mark', () => {
	const off = { showDetails: false, projectName: 'Work' };
	assert.equal(formatLinkText(task({ priority: 4, due: { date: '2026-10-12', isRecurring: true }, labels: ['a'] }), off), '↗');
});

test('names the occurrence of a recurring task', () => {
	assert.equal(occurrenceOf({ date: '2026-10-12', isRecurring: true }), '2026-10-12');
	assert.equal(occurrenceOf({ date: '2026-10-05T09:30:00', isRecurring: true }), '2026-10-05T09:30');
	// A yearly task comes back on the same day and month, so the year counts.
	assert.notEqual(occurrenceOf({ date: '2026-10-12', isRecurring: true }), occurrenceOf({ date: '2027-10-12', isRecurring: true }));
	// A whole-day occurrence is not the same as a timed one.
	assert.notEqual(occurrenceOf({ date: '2026-10-12', isRecurring: true }), occurrenceOf({ date: '2026-10-12T09:00:00', isRecurring: true }));
	// Only recurring tasks have one.
	assert.equal(occurrenceOf({ date: '2026-10-12', isRecurring: false }), null);
	assert.equal(occurrenceOf(null), null);
});

test('a time in a fixed timezone is named in UTC, wherever the device is', () => {
	const due = { date: '2026-10-12T14:00:00Z', isRecurring: true };
	assert.equal(occurrenceOf(due), '2026-10-12T14:00Z');
	assert.ok(isOccurrence('2026-10-12T14:00Z'));
	assert.ok(isCurrentOccurrence('2026-10-12T14:00Z', due));
	assert.ok(!isCurrentOccurrence('2026-10-13T14:00Z', due));

	// A link written before that change has the time in local time, and
	// still counts on a device in the same timezone.
	const local = new Date(Date.UTC(2026, 9, 12, 14, 0));
	const old = `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}T${pad(local.getHours())}:${pad(local.getMinutes())}`;
	assert.ok(isCurrentOccurrence(old, due));

	// Whole-day and floating dues are as before.
	assert.ok(isCurrentOccurrence('2026-10-12', { date: '2026-10-12', isRecurring: true }));
	assert.ok(!isCurrentOccurrence('2026-10-12', { date: '2026-10-13', isRecurring: true }));
	assert.ok(!isCurrentOccurrence('2026-10-12', { date: '2026-10-12', isRecurring: false }));
});

test('recognizes an occurrence it wrote', () => {
	assert.equal(isOccurrence('2026-10-12'), true);
	assert.equal(isOccurrence('2026-10-12T09:30'), true);
	assert.equal(isOccurrence(null), false);
	assert.equal(isOccurrence(''), false);
	assert.equal(isOccurrence('comment-123'), false);
	assert.equal(isOccurrence('2026-10-12T09'), false);
});

test('due today or earlier', () => {
	assert.equal(isDueByToday(null, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-10', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-11', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-11T23:30:00', isRecurring: true }, TODAY), true);
	assert.equal(isDueByToday({ date: '2026-10-12', isRecurring: true }, TODAY), false);
	assert.equal(isDueByToday({ date: '2027-01-01', isRecurring: true }, TODAY), false);
});
