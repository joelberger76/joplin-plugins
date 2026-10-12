import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { parseNote } from '../src/noteParser';
import { confirmAll, linkedLines, reportUnlink, unlinkEdits } from '../src/unlinkPlan';
import { apply } from './applyEdits';

const BODY = [
	'# Today',
	'- [ ] Plain line',
	'- [ ] Call the plumber [↗](https://app.todoist.com/app/task/aaa)',
	'  - [x] Send the budget #Q4 [↗ p1 · ##Work](https://app.todoist.com/app/task/bbb)',
	'* [ ] Take vitamins [↗ ↻](https://app.todoist.com/app/task/ccc#2026-10-12)',
	'```',
	'- [ ] In code [↗](https://app.todoist.com/app/task/ddd)',
	'```',
].join('\n');

test('linkedLines finds every linked line, or those in the scope', () => {
	const note = parseNote(BODY);
	assert.deepEqual(linkedLines(note, null).map(line => line.lineNumber), [2, 3, 4]);
	assert.deepEqual(linkedLines(note, { fromLine: 3, toLine: 4 }).map(line => line.lineNumber), [3, 4]);
	assert.deepEqual(linkedLines(note, { fromLine: 0, toLine: 1 }), []);
});

test('unlinkEdits leave a plain checkbox, keeping indent, bullet, box and name', () => {
	const note = parseNote(BODY);
	const result = apply(BODY, unlinkEdits(note, linkedLines(note, null)));
	assert.equal(result.text, [
		'# Today',
		'- [ ] Plain line',
		'- [ ] Call the plumber',
		'  - [x] Send the budget #Q4',
		'* [ ] Take vitamins',
		'```',
		'- [ ] In code [↗](https://app.todoist.com/app/task/ddd)',
		'```',
	].join('\n'));
});

test('confirmAll says where', () => {
	const linked = linkedLines(parseNote(BODY), null);
	assert.match(confirmAll(linked, false), /^Remove 3 Todoist links from this note\?/);
	assert.match(confirmAll(linked.slice(0, 1), true), /^Remove 1 Todoist link from the selection\?/);
});

test('reportUnlink counts what was removed and names what was skipped', () => {
	const linked = linkedLines(parseNote(BODY), null);
	assert.deepEqual(reportUnlink(linked, []), { summary: 'Removed 3 links.', problems: [] });
	assert.deepEqual(reportUnlink(linked, ['line@3']), {
		summary: 'Removed 2 links.',
		problems: ['Edited meanwhile, so its link was left: Send the budget #Q4'],
	});
});
