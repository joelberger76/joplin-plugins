import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { apply } from './applyEdits';
import { parseNote } from '../src/noteParser';
import { planSend, reportSend, runSend, SendApi, sendCandidates, sendEdits, SendLists, SendScope } from '../src/sendPlan';
import { TodoistError } from '../src/todoist';
import { TaskInfo } from '../src/types';

const LISTS: SendLists = {
	projects: ['Inbox', 'Work', 'Home Reno'],
	labels: ['Joel Berger', 'John Smith', 'errand'],
	defaultProject: null,
};

const PROJECT_NAMES = new Map([['work', 'Work'], ['homereno', 'Home Reno']]);

function link(id: string, text = '↗'): string {
	return `[${text}](https://app.todoist.com/app/task/${id})`;
}

// A stand-in for Todoist. Quick add reads `#Project`, `@label`, `p1` and
// "tomorrow" out of the text the way the real one does, and keeps a
// backslash-escaped `#` or `@` in the name. `failing` maps a call, written
// as "quickAdd:<text>", "rename:<id>" or "move:<id>", to the error it throws.
function fakeTodoist(failing: Record<string, Error> = {}) {
	const calls: string[] = [];
	const tasks = new Map<string, TaskInfo>();
	let nextId = 1;

	const check = (call: string) => {
		calls.push(call);
		if (failing[call]) throw failing[call];
	};

	const api: SendApi = {
		quickAdd: async text => {
			check(`quickAdd:${text}`);
			const task: TaskInfo = { id: `t${nextId++}`, content: '', checked: false, priority: 1, due: null, projectId: 'inbox', labels: [] };
			const words: string[] = [];
			for (const word of text.replace(/\\ /g, '\u0000').split(' ')) {
				const plain = word.replace(/\u0000/g, ' ');
				if (plain.startsWith('#')) task.projectId = plain.slice(1).toLowerCase().replace(/ /g, '');
				else if (plain.startsWith('@')) task.labels.push(plain.slice(1));
				else if (plain === 'p1') task.priority = 4;
				else if (plain === 'tomorrow') task.due = { date: '2026-10-13', isRecurring: false };
				else if (plain === 'daily') task.due = { date: '2026-10-12', isRecurring: true };
				else words.push(plain);
			}
			task.content = words.join(' ');
			tasks.set(task.id, task);
			return { ...task };
		},
		renameTask: async (id, content) => {
			check(`rename:${id}`);
			const task = tasks.get(id)!;
			task.content = content;
			return { ...task };
		},
		moveUnder: async (id, parentId) => {
			check(`move:${id}>${parentId}`);
			const task = tasks.get(id)!;
			const parent = tasks.get(parentId);
			task.projectId = parent ? parent.projectId : 'work';
			return { ...task };
		},
	};

	return { api, calls };
}

// Runs a whole Send on a note body, without Joplin or the network.
async function send(body: string, options: { scope?: SendScope; lists?: SendLists; failing?: Record<string, Error>; showDetails?: boolean } = {}) {
	const note = parseNote(body);
	const plan = planSend(note, sendCandidates(note, options.scope ?? null), options.lists ?? LISTS);
	const todoist = fakeTodoist(options.failing);
	const result = await runSend(plan.items, todoist.api);
	const edits = sendEdits(note, result.sent, { showDetails: options.showDetails ?? true, projectNames: PROJECT_NAMES });
	const applied = apply(body, edits);
	return {
		calls: todoist.calls,
		text: applied.text,
		report: reportSend(result.sent, [...plan.problems, ...result.problems], applied.skipped),
	};
}

test('the example of SPEC.md section 4', async () => {
	const result = await send('- [ ] Send the budget #Q4 ##work @@joel tomorrow p1');
	assert.deepEqual(result.calls, [
		'quickAdd:Send the budget \\#Q4 tomorrow p1 #Work @Joel\\ Berger',
		'rename:t1',
	]);
	assert.equal(result.text, `- [ ] Send the budget #Q4 ${link('t1', '↗ p1 · ##Work · @@Joel Berger')}`);
	assert.deepEqual(result.report, { summary: 'Created 1 task.', problems: [] });
});

test('only unchecked, unlinked lines with a name are sent', async () => {
	const body = [
		'# Journal',
		'- [ ] Plain task',
		'- [x] Done already',
		`- [ ] Linked already ${link('zz')}`,
		'- [ ]',
		'- A bullet',
		'1. [ ] Numbered',
		'- [/] Alternate',
		'```',
		'- [ ] In a code block',
		'```',
		'  * [ ] Indented under nothing',
	].join('\n');

	const result = await send(body);
	assert.deepEqual(result.calls, ['quickAdd:Plain task', 'quickAdd:Indented under nothing']);
	assert.equal(result.text, body
		.replace('- [ ] Plain task', `- [ ] Plain task ${link('t1')}`)
		.replace('* [ ] Indented under nothing', `* [ ] Indented under nothing ${link('t2')}`));
	assert.equal(result.report.summary, 'Created 2 tasks.');
});

test('a line with no single # or @ needs no second call', async () => {
	const result = await send('- [ ] Email joel@example.com about C# ##work');
	assert.deepEqual(result.calls, ['quickAdd:Email joel@example.com about C# #Work']);
});

test('a selection limits what is sent', async () => {
	const body = ['- [ ] One', '- [ ] Two', '- [ ] Three'].join('\n');
	const result = await send(body, { scope: { fromLine: 1, toLine: 1 } });
	assert.deepEqual(result.calls, ['quickAdd:Two']);
	assert.equal(result.text, ['- [ ] One', `- [ ] Two ${link('t1')}`, '- [ ] Three'].join('\n'));
});

test('the default project is used when the line names none', async () => {
	const lists = { ...LISTS, defaultProject: 'Home Reno' };
	const result = await send(['- [ ] Buy paint', '- [ ] File report ##work'].join('\n'), { lists });
	assert.deepEqual(result.calls, ['quickAdd:Buy paint #Home\\ Reno', 'quickAdd:File report #Work']);
	assert.equal(result.text, [
		`- [ ] Buy paint ${link('t1', '↗ ##Home Reno')}`,
		`- [ ] File report ${link('t2', '↗ ##Work')}`,
	].join('\n'));
});

test('a token that matches nothing or too much keeps the line from being sent', async () => {
	const body = ['- [ ] Email Jo @@Jo', '- [ ] Plan trip ##Garden', '- [ ] Two homes ##work ##home', '- [ ] ##work', '- [ ] Fine @@errand'].join('\n');
	const result = await send(body);
	assert.deepEqual(result.calls, ['quickAdd:Fine @errand']);
	assert.equal(result.text, body.replace('- [ ] Fine @@errand', `- [ ] Fine ${link('t1', '↗ @@errand')}`));
	assert.deepEqual(result.report, {
		summary: 'Created 1 task.',
		problems: [
			'Not sent, `@@Jo` matches Joel Berger and John Smith: Email Jo',
			'Not sent, no project matches `##Garden`: Plan trip',
			'Not sent, it names more than one project (`##work`, `##home`): Two homes',
			'Not sent, it has no name besides its tokens: ##work',
		],
	});
});

test('a repeated label is sent once', async () => {
	const result = await send('- [ ] Call @@errand @@Errand @@john');
	assert.deepEqual(result.calls, ['quickAdd:Call @errand @John\\ Smith']);
});

test('a line under a task line becomes its subtask', async () => {
	const body = [
		'- [ ] Parent ##work',
		'    - [ ] Child ##home',
		'        - [ ] Grandchild',
		`- [ ] Linked parent ${link('old')}`,
		'\t- [ ] Under a linked line',
		'- A plain bullet',
		'  - [ ] Under a bullet',
		'- [x] Checked and unlinked',
		'  - [ ] Under a checked line',
	].join('\n');

	const result = await send(body);
	assert.deepEqual(result.calls, [
		'quickAdd:Parent #Work',
		'quickAdd:Child',
		'move:t2>t1',
		'quickAdd:Grandchild',
		'move:t3>t2',
		'quickAdd:Under a linked line',
		'move:t4>old',
		'quickAdd:Under a bullet',
		'quickAdd:Under a checked line',
	]);
	assert.equal(result.text, [
		`- [ ] Parent ${link('t1', '↗ ##Work')}`,
		`    - [ ] Child ${link('t2', '↗ ##Work')}`,
		`        - [ ] Grandchild ${link('t3', '↗ ##Work')}`,
		`- [ ] Linked parent ${link('old')}`,
		`\t- [ ] Under a linked line ${link('t4', '↗ ##Work')}`,
		'- A plain bullet',
		`  - [ ] Under a bullet ${link('t5')}`,
		'- [x] Checked and unlinked',
		`  - [ ] Under a checked line ${link('t6')}`,
	].join('\n'));
	assert.deepEqual(result.report.problems, ['`##home` ignored, because a subtask goes in its parent\'s project: Child']);
});

test('a line under a line that was not sent is not sent either', async () => {
	const body = ['- [ ] Parent ##Garden', '  - [ ] Child', '    - [ ] Grandchild', '- [ ] Other'].join('\n');
	const result = await send(body);
	assert.deepEqual(result.calls, ['quickAdd:Other']);
	assert.deepEqual(result.report.problems, [
		'Not sent, no project matches `##Garden`: Parent',
		'Not sent, because the line it is under was not sent: Child',
		'Not sent, because the line it is under was not sent: Grandchild',
	]);
});

test('a parent outside the selection has no task, so the line is sent by itself', async () => {
	const body = ['- [ ] Parent', '  - [ ] Child'].join('\n');
	const result = await send(body, { scope: { fromLine: 1, toLine: 1 } });
	assert.deepEqual(result.calls, ['quickAdd:Child']);
});

test('a recurring task gets its occurrence, and details can be turned off', async () => {
	const result = await send('- [ ] Take vitamins daily p1', { showDetails: false });
	assert.equal(result.text, '- [ ] Take vitamins [↗](https://app.todoist.com/app/task/t1#2026-10-12)');
});

test('one failed line is reported and the rest are sent', async () => {
	const body = ['- [ ] One', '  - [ ] Under one', '- [ ] Two'].join('\n');
	const result = await send(body, { failing: { 'quickAdd:One': new TodoistError('status 500', 500) } });
	assert.deepEqual(result.calls, ['quickAdd:One', 'quickAdd:Two']);
	assert.equal(result.text, ['- [ ] One', '  - [ ] Under one', `- [ ] Two ${link('t1')}`].join('\n'));
	assert.deepEqual(result.report, {
		summary: 'Created 1 task.',
		problems: ['Not sent (status 500): One', 'Not sent, because the line it is under was not sent: Under one'],
	});
});

test('a rejected token or a lost connection ends the run, keeping what was created', async () => {
	const body = ['- [ ] One', '- [ ] Two', '- [ ] Three', '- [ ] Four'].join('\n');
	const result = await send(body, { failing: { 'quickAdd:Two': new TodoistError('Could not reach Todoist.', null) } });
	assert.deepEqual(result.calls, ['quickAdd:One', 'quickAdd:Two']);
	assert.equal(result.text, [`- [ ] One ${link('t1')}`, '- [ ] Two', '- [ ] Three', '- [ ] Four'].join('\n'));
	assert.deepEqual(result.report.problems, ['Not sent (Could not reach Todoist.): Two', '2 more lines not sent after that.']);
});

test('a task whose second call fails is still linked', async () => {
	const body = ['- [ ] Parent', '  - [ ] Child #tag', '  - [ ] Other child'].join('\n');
	const result = await send(body, { failing: {
		'rename:t2': new TodoistError('status 500', 500),
		'move:t3>t1': new TodoistError('status 400', 400),
	} });
	assert.equal(result.text, [
		`- [ ] Parent ${link('t1')}`,
		`  - [ ] Child \\#tag ${link('t2')}`,
		`  - [ ] Other child ${link('t3')}`,
	].join('\n'));
	assert.deepEqual(result.report, {
		summary: 'Created 3 tasks.',
		problems: [
			'Created, but its name in Todoist kept a backslash before "#" or "@" (status 500): Child #tag',
			'Created, but not as a subtask (status 400): Other child',
		],
	});
});

test('a line edited while sending is reported with its task', async () => {
	const body = ['- [ ] One', '- [ ] Two'].join('\n');
	const note = parseNote(body);
	const plan = planSend(note, sendCandidates(note, null), LISTS);
	const result = await runSend(plan.items, fakeTodoist().api);
	const edits = sendEdits(note, result.sent, { showDetails: true, projectNames: PROJECT_NAMES });

	const applied = apply(body, edits, () => ({ from: 6, insert: 'Number ' }));
	assert.equal(applied.text, ['- [ ] Number One', `- [ ] Two ${link('t2')}`].join('\n'));
	assert.deepEqual(reportSend(result.sent, [], applied.skipped), {
		summary: 'Created 2 tasks.',
		problems: ['Created, but its line was edited while sending, so it has no link (https://app.todoist.com/app/task/t1): One'],
	});
});

test('text typed at either end of a line while sending leaves it unlinked', async () => {
	const body = ['- [ ] One', '- [ ] Two'].join('\n');
	const note = parseNote(body);
	const result = await runSend(planSend(note, sendCandidates(note, null), LISTS).items, fakeTodoist().api);
	const edits = sendEdits(note, result.sent, { showDetails: true, projectNames: PROJECT_NAMES });

	// A link written here would end up in the middle of the line.
	const atEnd = apply(body, edits, () => ({ from: 9, insert: ' and more' }));
	assert.deepEqual(atEnd.skipped, ['line@0']);
	assert.equal(atEnd.text, ['- [ ] One and more', `- [ ] Two ${link('t2')}`].join('\n'));

	const atNoteEnd = apply(body, edits, () => ({ from: body.length, insert: ' and more' }));
	assert.deepEqual(atNoteEnd.skipped, ['line@1']);

	const atStart = apply(body, edits, () => ({ from: 10, insert: 'x' }));
	assert.deepEqual(atStart.skipped, ['line@1']);
	assert.equal(atStart.text, [`- [ ] One ${link('t1')}`, 'x- [ ] Two'].join('\n'));
});

test('a new line typed after a line while sending does not get in the way', async () => {
	const body = ['- [ ] One', '- [ ] Two'].join('\n');
	const note = parseNote(body);
	const result = await runSend(planSend(note, sendCandidates(note, null), LISTS).items, fakeTodoist().api);
	const edits = sendEdits(note, result.sent, { showDetails: true, projectNames: PROJECT_NAMES });

	const applied = apply(body, edits, () => ({ from: 9, insert: '\n- [ ] Between' }));
	assert.deepEqual(applied.skipped, []);
	assert.equal(applied.text, [`- [ ] One ${link('t1')}`, '- [ ] Between', `- [ ] Two ${link('t2')}`].join('\n'));
});

test('typing elsewhere while sending does not get in the way', async () => {
	const body = ['Intro', '- [ ] One'].join('\n');
	const note = parseNote(body);
	const result = await runSend(planSend(note, sendCandidates(note, null), LISTS).items, fakeTodoist().api);
	const edits = sendEdits(note, result.sent, { showDetails: true, projectNames: PROJECT_NAMES });
	const applied = apply(body, edits, () => ({ from: 0, insert: 'New first line\n' }));
	assert.equal(applied.text, ['New first line', 'Intro', `- [ ] One ${link('t1')}`].join('\n'));
});
