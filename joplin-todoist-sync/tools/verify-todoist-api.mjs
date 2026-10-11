// Checks how the Todoist API behaves in the cases the plugin depends on
// (SPEC.md section 9.1, checks 1 and 2, plus the recurring task basics).
//
// Run it yourself, in your own terminal:
//
//   read -s TODOIST_TOKEN && export TODOIST_TOKEN     (paste the token, press Enter)
//   node tools/verify-todoist-api.mjs
//   unset TODOIST_TOKEN
//
// What it does to your account:
// - creates three projects whose names start with "PluginApiTest", "Plugin
//   Api Test" or "📝 Plugin Api Test", and two labels starting with
//   "plugin_api_test" or "plugin api test"
// - creates about twenty tasks whose names start with "ZZTEST". Most go
//   into the test projects. Some quick add tests land in your Inbox,
//   because that is where quick add puts a task with no project.
// - closes, moves and deletes only the things it created
// - at the end deletes every task, label and project it created
//
// The results go to tools/verify-todoist-api.out.txt, next to this file,
// replacing the previous run. The terminal only shows the section titles.
// The file holds task names, projects, labels, due dates and HTTP statuses.
// It never holds the token or any account details.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.TODOIST_TOKEN;
if (!TOKEN) {
	console.error('Set TODOIST_TOKEN first. See the comment at the top of this file.');
	process.exit(1);
}

const BASE = 'https://api.todoist.com/api/v1';
const PROJECT = 'PluginApiTest';
const LABEL = 'plugin_api_test_label';

const created = { tasks: [], labels: [], projects: [] };

async function api(method, path, body) {
	const response = await fetch(BASE + path, {
		method,
		headers: {
			Authorization: `Bearer ${TOKEN}`,
			...(body ? { 'Content-Type': 'application/json' } : {}),
		},
		body: body ? JSON.stringify(body) : undefined,
	});
	const text = await response.text();
	let json = null;
	try {
		json = text ? JSON.parse(text) : null;
	} catch {
		// Not JSON. The caller gets the raw text.
	}
	return { status: response.status, json, text: json ? undefined : text.slice(0, 200) };
}

// The fields the plugin cares about, and nothing that identifies the account.
function brief(task) {
	if (!task) return null;
	return {
		content: task.content,
		project: task.project_id === undefined ? undefined : projectNames[task.project_id] ?? 'other (Inbox?)',
		labels: task.labels,
		priority: task.priority,
		due: task.due ? { date: task.due.date, string: task.due.string, is_recurring: task.due.is_recurring } : null,
		parent: task.parent_id ? 'has parent' : null,
		checked: task.checked,
		is_deleted: task.is_deleted,
		completed_at: task.completed_at ? 'set' : null,
	};
}

const OUTPUT_FILE = fileURLToPath(new URL('./verify-todoist-api.out.txt', import.meta.url));
const output = [`Run at ${new Date().toISOString()}`];

function show(title, value) {
	console.log(title);
	output.push(`\n### ${title}`, JSON.stringify(value, null, 2));
}

async function quickAdd(text) {
	const result = await api('POST', '/tasks/quick', { text, meta: true });
	const task = result.json;
	if (task?.id) created.tasks.push(task.id);
	return { sent: text, status: result.status, task: brief(task), error: result.text };
}

async function createTask(body) {
	const result = await api('POST', '/tasks', body);
	if (result.json?.id) created.tasks.push(result.json.id);
	return result;
}

async function labelNames() {
	const result = await api('GET', '/labels?limit=200');
	return (result.json?.results ?? []).map(label => ({ id: label.id, name: label.name }));
}

let projectId;
// Test project ids and their names, so results can say where a task landed.
const projectNames = {};

async function main() {
	// Setup
	const project = await api('POST', '/projects', { name: PROJECT });
	if (project.status !== 200 || !project.json?.id) {
		show('Could not create the test project, stopping', { status: project.status, error: project.text ?? project.json });
		return;
	}
	projectId = project.json.id;
	created.projects.push(projectId);
	projectNames[projectId] = PROJECT;

	const label = await api('POST', '/labels', { name: LABEL });
	if (label.json?.id) created.labels.push(label.json.id);
	show('Setup', { project: project.status, label: label.status });

	// Check 1: quick add and "#" / "@"
	show('1a. Quick add, dates and priority only', await quickAdd('ZZTEST plain tomorrow p2'));

	const labelsBefore = (await labelNames()).map(l => l.name);
	show('1b. Quick add, "#" and "@" that match nothing', await quickAdd('ZZTEST unknown #zzNoSuchProject9 @zzNoSuchLabel9 tomorrow'));
	const labelsAfter = await labelNames();
	const newLabels = labelsAfter.filter(l => !labelsBefore.includes(l.name));
	for (const l of newLabels) created.labels.push(l.id);
	show('1b. Labels created as a side effect', newLabels.map(l => l.name));

	show('1c. Quick add, "#" and "@" that match the test project and label', await quickAdd(`ZZTEST known #${PROJECT} @${LABEL} tomorrow`));
	show('1d. Quick add, backslash escapes', await quickAdd(`ZZTEST escaped \\#${PROJECT} \\@${LABEL} tomorrow`));
	show('1e. Quick add, "#" and "@" in the middle of the name', await quickAdd(`ZZTEST middle #${PROJECT} more words @${LABEL} end tomorrow`));

	// The plain create endpoint, as a fallback: is content left alone?
	const plain = await createTask({
		content: `ZZTEST create #${PROJECT} @${LABEL} tomorrow p1`,
		project_id: projectId,
		due_string: 'tomorrow',
	});
	show('1f. Create task, content with "#", "@" and date words', { status: plain.status, task: brief(plain.json) });

	// Subtasks: quick add has no parent parameter, so the plugin would move the task.
	const parent = await createTask({ content: 'ZZTEST parent', project_id: projectId });
	const child = await api('POST', '/tasks/quick', { text: 'ZZTEST child tomorrow' });
	if (child.json?.id) created.tasks.push(child.json.id);
	const moved = child.json?.id ? await api('POST', `/tasks/${child.json.id}/move`, { parent_id: parent.json?.id }) : null;
	show('1g. Quick add, then move under a parent', { status: moved?.status, task: brief(moved?.json), error: moved?.text });

	// Check 2: completed tasks
	const done = await createTask({ content: 'ZZTEST to complete', project_id: projectId });
	const doneId = done.json?.id;
	const closed = await api('POST', `/tasks/${doneId}/close`);
	const single = await api('GET', `/tasks/${doneId}`);
	show('2a. Get a completed task by id', { close: closed.status, status: single.status, task: brief(single.json), error: single.text });

	const open = await createTask({ content: 'ZZTEST still open', project_id: projectId });
	const byIds = await api('GET', `/tasks?ids=${doneId},${open.json?.id}`);
	show('2b. Get one completed and one open task with ids=', {
		status: byIds.status,
		returned: (byIds.json?.results ?? []).map(brief),
		keys: byIds.json ? Object.keys(byIds.json) : null,
	});

	const since = new Date(Date.now() - 3600 * 1000).toISOString();
	const until = new Date(Date.now() + 3600 * 1000).toISOString();
	const completed = await api('GET', `/tasks/completed/by_completion_date?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&project_id=${projectId}`);
	show('2c. Completed tasks by completion date', {
		status: completed.status,
		keys: completed.json ? Object.keys(completed.json) : null,
		found: (completed.json?.items ?? completed.json?.results ?? []).map(brief),
		error: completed.text,
	});

	const reopened = await api('POST', `/tasks/${doneId}/reopen`);
	const afterReopen = await api('GET', `/tasks/${doneId}`);
	show('2d. Reopen, then get by id', { reopen: reopened.status, status: afterReopen.status, task: brief(afterReopen.json) });

	// Deleted and unknown tasks: can they be told apart from completed ones?
	const doomed = await createTask({ content: 'ZZTEST to delete', project_id: projectId });
	const deleted = await api('DELETE', `/tasks/${doomed.json?.id}`);
	const afterDelete = await api('GET', `/tasks/${doomed.json?.id}`);
	show('2e. Get a deleted task by id', { delete: deleted.status, status: afterDelete.status, task: brief(afterDelete.json), error: afterDelete.text });

	const unknown = await api('GET', '/tasks/6XGgmFVcrG5RRjVr');
	show('2f. Get a task id that is not yours', { status: unknown.status, task: brief(unknown.json), error: unknown.text });

	// Recurring basics
	const recurring = await createTask({ content: 'ZZTEST recurring', project_id: projectId, due_string: 'every day' });
	const recurringId = recurring.json?.id;
	const closedRecurring = await api('POST', `/tasks/${recurringId}/close`);
	const afterClose = await api('GET', `/tasks/${recurringId}`);
	show('3a. Recurring task, before and after close', {
		before: brief(recurring.json),
		close: closedRecurring.status,
		afterStatus: afterClose.status,
		after: brief(afterClose.json),
	});

	// Filter endpoint
	const filtered = await api('GET', `/tasks/filter?query=${encodeURIComponent('#' + PROJECT)}&limit=200`);
	show('3b. Filter query for the test project', {
		status: filtered.status,
		keys: filtered.json ? Object.keys(filtered.json) : null,
		tasks: (filtered.json?.results ?? []).map(t => `${t.content} | due ${t.due?.date ?? 'none'} | recurring ${t.due?.is_recurring ?? false}`),
	});

	// Does the update call consume "#project" and "@label" in the name, like quick add does?
	const target = await createTask({ content: 'ZZTEST update target', project_id: projectId });
	const targetId = target.json?.id;
	const updated = await api('POST', `/tasks/${targetId}`, { content: `ZZTEST updated #${PROJECT} @${LABEL} @zzNoSuchLabel9` });
	show('4a. Update the name to include "#project", "@label" and an unknown "@"', { status: updated.status, task: brief(updated.json) });
	const escaped = await api('POST', `/tasks/${targetId}`, { content: `ZZTEST updated \\@${LABEL}`, labels: [] });
	show('4b. Update the name with a backslash escape, and clear labels', { status: escaped.status, task: brief(escaped.json) });
	const reread = await api('GET', `/tasks/${targetId}`);
	show('4c. The same task read back', { status: reread.status, task: brief(reread.json) });

	// Can a completed occurrence of a recurring task be told apart from a postponed one?
	const counted = t => (t ? { due: t.due?.date, completed_count: t.completed_count, postponed_count: t.postponed_count, checked: t.checked } : null);
	const rec = await createTask({ content: 'ZZTEST recurring counts', project_id: projectId, due_string: 'every day' });
	const recId = rec.json?.id;
	const atStart = await api('GET', `/tasks/${recId}`);
	await api('POST', `/tasks/${recId}/close`);
	const afterComplete = await api('GET', `/tasks/${recId}`);
	const postponed = await api('POST', `/tasks/${recId}`, { due_string: 'every day starting in 3 days' });
	const afterPostpone = await api('GET', `/tasks/${recId}`);
	show('6a. Recurring task: at start, after completing once, after postponing', {
		atStart: counted(atStart.json),
		afterComplete: counted(afterComplete.json),
		postponeStatus: postponed.status,
		afterPostpone: counted(afterPostpone.json),
	});
	const recSince = new Date(Date.now() - 3600 * 1000).toISOString();
	const recUntil = new Date(Date.now() + 3600 * 1000).toISOString();
	const recDone = await api('GET', `/tasks/completed/by_completion_date?since=${encodeURIComponent(recSince)}&until=${encodeURIComponent(recUntil)}&project_id=${projectId}`);
	show('6b. Does the completed list include the completed occurrence?', {
		status: recDone.status,
		items: (recDone.json?.items ?? []).map(t => ({ content: t.content, sameId: t.id === recId, due: t.due?.date, completed_at: t.completed_at ? 'set' : null, keys: Object.keys(t).filter(k => /id$|^due$|completed/.test(k)) })),
	});

	// Project and label names with spaces or an emoji, passed through quick add.
	// This is how "##Name" would be handed to Todoist once the plugin has
	// resolved it to the exact project name.
	const spaced = await api('POST', '/projects', { name: 'Plugin Api Test Spaces' });
	const emoji = await api('POST', '/projects', { name: '📝 Plugin Api Test Emoji' });
	for (const p of [spaced, emoji]) {
		if (p.json?.id) {
			created.projects.push(p.json.id);
			projectNames[p.json.id] = p.json.name;
		}
	}
	const spacedLabel = await api('POST', '/labels', { name: 'plugin api test spaced label' });
	if (spacedLabel.json?.id) created.labels.push(spacedLabel.json.id);
	show('5a. Setup: projects and a label with spaces', {
		spacedProject: spaced.status,
		emojiProject: emoji.status,
		label: spacedLabel.status,
		labelNameAsStored: spacedLabel.json?.name,
		labelError: spacedLabel.text ?? (spacedLabel.status === 200 ? undefined : spacedLabel.json),
	});

	show('5b. Quick add, project with escaped spaces', await quickAdd('ZZTEST spaces #Plugin\\ Api\\ Test\\ Spaces tomorrow p1'));
	show('5c. Quick add, project with spaces, not escaped', await quickAdd('ZZTEST spaces raw #Plugin Api Test Spaces tomorrow'));
	show('5d. Quick add, emoji project with escaped spaces', await quickAdd('ZZTEST emoji #📝\\ Plugin\\ Api\\ Test\\ Emoji tomorrow'));
	show('5e. Quick add, project name in a different case', await quickAdd('ZZTEST case #pluginapitest tomorrow'));
	show('5f. Quick add, project in the middle, text after it', await quickAdd('ZZTEST mid #Plugin\\ Api\\ Test\\ Spaces call the bank tomorrow'));
	if (spacedLabel.json?.name) {
		const stored = spacedLabel.json.name;
		show('5g. Quick add, the spaced label as stored', await quickAdd(`ZZTEST label @${stored.replace(/ /g, '\\ ')} tomorrow`));
	}

	const future = await api('GET', `/tasks/filter?query=${encodeURIComponent('#' + PROJECT + ' & recurring & !due before: tomorrow')}`);
	show('3c. Filter for recurring tasks due tomorrow or later', (future.json?.results ?? []).map(t => `${t.content} | due ${t.due?.date}`));
}

async function cleanup() {
	const results = { tasks: 0, labels: 0, projects: 0, failed: [] };
	for (const [kind, path] of [['tasks', '/tasks/'], ['labels', '/labels/'], ['projects', '/projects/']]) {
		for (const id of new Set(created[kind])) {
			const result = await api('DELETE', path + id);
			// A task deleted during the test, or along with its parent, is already gone.
			if (result.status >= 200 && result.status < 300 || result.status === 404) results[kind]++;
			else results.failed.push(`${kind} ${result.status}`);
		}
	}
	show('Cleanup', results);
	if (results.failed.length) {
		console.log(`WARNING: some things could not be deleted. Look for "${PROJECT}", "${LABEL}" and tasks starting with "ZZTEST".`);
	}
}

try {
	await main();
} catch (error) {
	show('Stopped on an error', String(error));
} finally {
	await cleanup();
	writeFileSync(OUTPUT_FILE, output.join('\n') + '\n');
	console.log(`\nResults written to ${OUTPUT_FILE}`);
}
