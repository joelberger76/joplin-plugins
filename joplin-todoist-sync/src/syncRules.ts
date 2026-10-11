// What Sync does with one linked line (SPEC.md sections 6 and 7). This is
// a pure decision: it calls nothing and changes nothing.

import { formatLinkText, isDueByToday, LinkDetails, parseLinkText, sameOccurrence } from './details';
import { formatTaskLine, TaskLine } from './noteParser';
import { TaskInfo } from './types';

// What Todoist said about a linked line's task.
export type TaskState =
	| { kind: 'found'; task: TaskInfo }
	// 404: deleted, or not this account's task. The two can't be told apart.
	| { kind: 'missing' };

export interface SyncLine {
	checked: boolean;
	// The date and recurring mark read from the line's link text.
	details: LinkDetails;
}

export interface SyncDecision {
	// Close the task in Todoist.
	closeTask: boolean;
	// Tick the box in the note.
	checkBox: boolean;
	// Remove the trailing link, leaving a plain checkbox line.
	removeLink: boolean;
	// Rewrite the line's name and details from Todoist.
	refresh: boolean;
	// Something for the report:
	// "missing": Todoist has no such task.
	// "movedOn": a checked recurring line whose task had already moved to
	// another occurrence, so nothing was closed.
	notice: 'missing' | 'movedOn' | null;
}

const NOTHING: SyncDecision = {
	closeTask: false,
	checkBox: false,
	removeLink: false,
	refresh: false,
	notice: null,
};

// Whether Fetch may bring this task into a note. A recurring task is only
// fetched once it is due (SPEC.md section 7, rule 1).
export function isFetchable(task: TaskInfo, today: Date): boolean {
	if (!task.due || !task.due.isRecurring) return true;
	return isDueByToday(task.due, today);
}

export function decideSync(line: SyncLine, state: TaskState, today: Date): SyncDecision {
	// A missing task is reported and the line is left exactly as it is,
	// because a wrong API token makes every task look missing.
	if (state.kind === 'missing') return { ...NOTHING, notice: 'missing' };

	const task = state.task;

	// Completed in Todoist. This also covers a recurring task whose
	// recurrence has ended.
	if (task.checked) return { ...NOTHING, checkBox: !line.checked, refresh: true };

	const recurring = !!task.due && task.due.isRecurring;

	if (!recurring) return { ...NOTHING, closeTask: line.checked, refresh: true };

	// An unchecked recurring line is never ticked by Sync. A later due date
	// could mean "completed" or "postponed" (the known gap).
	if (!line.checked) return { ...NOTHING, refresh: true };

	// A checked recurring line stands for the occurrence whose date is in
	// its link. It closes the task only if Todoist is still waiting on that
	// occurrence. With no readable date, fall back to "due today or
	// earlier". Either way the line is finished, so the link goes.
	const stillWaiting = line.details.date
		? sameOccurrence(line.details.date, task.due!)
		: isDueByToday(task.due, today);

	return {
		...NOTHING,
		closeTask: stillWaiting,
		removeLink: true,
		notice: stillWaiting ? null : 'movedOn',
	};
}

// Reads what `decideSync()` needs from a linked line.
export function syncLineOf(line: TaskLine): SyncLine {
	return {
		checked: line.checked,
		details: parseLinkText(line.link ? line.link.text : ''),
	};
}

export interface RewriteOptions {
	showDetails: boolean;
	// The task's project name, or null for the Inbox.
	projectName: string | null;
	today: Date;
}

// The text a linked line should have once `decision` has been carried out.
// Returns the line unchanged when there is nothing to write.
export function rewriteLine(line: TaskLine, decision: SyncDecision, task: TaskInfo | null, options: RewriteOptions): string {
	if (!line.link) return line.text;
	const checked = line.checked || decision.checkBox;

	if (decision.removeLink) {
		return formatTaskLine({ ...line, checked, link: null });
	}

	if (decision.refresh && task) {
		const pinned = parseLinkText(line.link.text).date;
		const text = formatLinkText(task, { ...options, pinnedDateText: pinned ? pinned.text : null });
		return formatTaskLine({ ...line, checked, name: task.content, link: { text, taskId: line.link.taskId } });
	}

	return checked === line.checked ? line.text : formatTaskLine({ ...line, checked, link: { text: line.link.text, taskId: line.link.taskId } });
}
