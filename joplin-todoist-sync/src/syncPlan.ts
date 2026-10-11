// Works out what Sync does to a note (SPEC.md sections 6 and 7). Pure: it
// takes the note text and what Todoist said about each linked task, and
// returns the tasks to close, the edits and the report.

import { lineStarts, TextEdit } from './edits';
import { ParsedNote, TaskLine } from './noteParser';
import { decideSync, rewriteLine, SyncDecision, syncLineOf, TaskState } from './syncRules';
import { TaskInfo } from './types';

export interface SyncOptions {
	today: Date;
	// The "Show task details in the link" setting.
	showDetails: boolean;
	// Project id to name. The Inbox, and any project not listed, has no name.
	projectNames: Map<string, string>;
}

// One linked line and what Sync decided for it.
export interface SyncItem {
	line: TaskLine;
	taskId: string;
	// Null when Todoist has no such task.
	task: TaskInfo | null;
	decision: SyncDecision;
	// The line's text once the decision has been carried out.
	newText: string;
}

export interface SyncReport {
	// One sentence for the toast, or for the top of the dialog.
	summary: string;
	// One line per thing that needs attention. Empty when nothing does.
	problems: string[];
}

function groupOf(line: TaskLine): string {
	return `line@${line.lineNumber}`;
}

// Decides every linked line of the note. `states` comes from
// `TodoistClient.getTaskStates()`. A line whose task is not in it is left out.
export function planSync(note: ParsedNote, states: Map<string, TaskState>, options: SyncOptions): SyncItem[] {
	const items: SyncItem[] = [];

	for (const line of note.taskLines) {
		if (!line.link) continue;
		const state = states.get(line.link.taskId);
		if (!state) continue;

		const task = state.kind === 'found' ? state.task : null;
		const decision = decideSync(syncLineOf(line), state, options.today);
		const newText = rewriteLine(line, decision, task, {
			showDetails: options.showDetails,
			projectName: task ? options.projectNames.get(task.projectId) ?? null : null,
		});
		items.push({ line, taskId: line.link.taskId, task, decision, newText });
	}

	return items;
}

// One message per task that is linked on more than one line of the note.
// Sync refuses to run on such a note: two checked lines for one task would
// ask for two closes, and closing a recurring task twice also completes
// its next occurrence.
export function duplicateLinks(note: ParsedNote): string[] {
	const byTask = new Map<string, TaskLine[]>();
	for (const line of note.taskLines) {
		if (!line.link) continue;
		const lines = byTask.get(line.link.taskId) ?? [];
		lines.push(line);
		byTask.set(line.link.taskId, lines);
	}

	const messages: string[] = [];
	for (const lines of byTask.values()) {
		if (lines.length < 2) continue;
		const numbers = lines.map(line => line.lineNumber + 1);
		const last = numbers.pop();
		messages.push(`Linked on lines ${numbers.join(', ')} and ${last}: ${lines[0].name || '(no name)'}`);
	}
	return messages;
}

// The tasks to close, each once. `duplicateLinks()` already keeps a task
// from being linked twice. This is a second guard against closing a
// recurring task twice.
export function tasksToClose(items: SyncItem[]): string[] {
	const ids = new Set<string>();
	for (const item of items) {
		if (item.decision.closeTask) ids.add(item.taskId);
	}
	return Array.from(ids);
}

// The items that can be written into the note: all of them, except the
// lines waiting on a close that failed. Those stay exactly as they are.
export function writableItems(items: SyncItem[], failedCloses: Map<string, string>): SyncItem[] {
	return items.filter(item => !(item.decision.closeTask && failedCloses.has(item.taskId)));
}

// One edit per line whose text changes. Each depends on its own line only,
// so a line edited while Todoist was answering is skipped by itself.
export function syncEdits(note: ParsedNote, items: SyncItem[]): TextEdit[] {
	const starts = lineStarts(note.lines);
	const edits: TextEdit[] = [];

	for (const item of items) {
		const line = item.line;
		if (item.newText === line.text) continue;
		const from = starts[line.lineNumber];
		const to = from + line.text.length;
		edits.push({ from, to, insert: item.newText, checkFrom: from, checkTo: to, expected: line.text, group: groupOf(line) });
	}

	return edits;
}

function count(amount: number, one: string, many: string): string {
	return `${amount} ${amount === 1 ? one : many}`;
}

// What to tell the user (SPEC.md section 6.5).
// - `failedCloses`: task id to the error message, for close calls that failed
// - `skippedGroups`: what the editor reported as skipped, because the line
//   was edited while Sync ran
export function reportSync(items: SyncItem[], failedCloses: Map<string, string>, skippedGroups: string[]): SyncReport {
	const skipped = new Set(skippedGroups);
	const problems: string[] = [];
	const closed = new Set<string>();
	let checked = 0;
	let updated = 0;

	for (const item of items) {
		const name = item.line.name || '(no name)';
		const decision = item.decision;

		if (decision.notice === 'missing') {
			problems.push(`Not found in Todoist: ${name}`);
			continue;
		}
		if (decision.closeTask) {
			const error = failedCloses.get(item.taskId);
			if (error) {
				problems.push(`Could not close in Todoist, line left as it was: ${name} (${error})`);
				continue;
			}
			closed.add(item.taskId);
		}
		if (item.newText !== item.line.text && skipped.has(groupOf(item.line))) {
			problems.push(`Edited while syncing, so the line was not updated: ${name}`);
			continue;
		}

		if (decision.notice === 'movedOn') problems.push(`Already moved on in Todoist, so nothing was closed and the link was removed: ${name}`);
		else if (decision.checkBox) checked++;
		else if (decision.refresh && item.newText !== item.line.text) updated++;
	}

	const parts: string[] = [];
	if (closed.size) parts.push(`${closed.size} closed in Todoist`);
	if (checked) parts.push(`${checked} checked off in the note`);
	if (updated) parts.push(`${updated} updated`);

	const total = count(items.length, 'task', 'tasks');
	const summary = parts.length ? `Synced ${total}: ${parts.join(', ')}.` : `Synced ${total}, nothing to change.`;
	return { summary, problems };
}
