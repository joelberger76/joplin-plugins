// The task details shown in a linked line's link text, for example
// "↗ p1 · ##Work · @@Joel Berger" (SPEC.md section 3.3), and the
// occurrence date a recurring line carries at the end of its link URL
// (SPEC.md section 7).

import { pad } from './text';
import { DueMoment, TaskDue, TaskInfo } from './types';

export const LINK_MARK = '↗';
export const RECURRING_MARK = '↻';
const SEPARATOR = ' · ';

// Turns a Todoist due date into a local date and, if it has one, a local
// time. Returns null if the text is not a date.
export function parseDue(date: string): DueMoment | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z)?)?$/.exec(date);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (match[4] === undefined) return { year, month, day, hour: null, minute: null };

	const hour = Number(match[4]);
	const minute = Number(match[5]);
	if (!match[6]) return { year, month, day, hour, minute };

	// A time in a fixed timezone is given in UTC. Use local time.
	const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
	return {
		year: local.getFullYear(),
		month: local.getMonth() + 1,
		day: local.getDate(),
		hour: local.getHours(),
		minute: local.getMinutes(),
	};
}

// The occurrence in this device's local time.
function localOccurrenceOf(due: TaskDue): string | null {
	const moment = parseDue(due.date);
	if (!moment) return null;

	let text = `${moment.year}-${pad(moment.month)}-${pad(moment.day)}`;
	if (moment.hour !== null && moment.minute !== null) text += `T${pad(moment.hour)}:${pad(moment.minute)}`;
	return text;
}

// Names one occurrence of a recurring task: "2026-10-12", or
// "2026-10-12T14:00" for a task due at a time of day. A time in a fixed
// timezone is named in UTC, as "2026-10-12T14:00Z", so that it reads the
// same wherever the device is. This is what a recurring line carries after
// the "#" of its link URL. Returns null for a task that does not recur.
export function occurrenceOf(due: TaskDue | null): string | null {
	if (!due || !due.isRecurring) return null;
	const fixed = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?Z$/.exec(due.date);
	return fixed ? `${fixed[1]}Z` : localOccurrenceOf(due);
}

// Whether text read from a link URL is an occurrence this plugin wrote.
export function isOccurrence(text: string | null): text is string {
	return !!text && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}Z?)?$/.test(text);
}

// Whether a line's pinned occurrence is the one the task is waiting on.
// Links written before fixed-timezone times were named in UTC carry them
// in local time, and still match on a device in the same timezone.
export function isCurrentOccurrence(pinned: string, due: TaskDue | null): boolean {
	if (!due || !due.isRecurring) return false;
	return pinned === occurrenceOf(due) || pinned === localOccurrenceOf(due);
}

// Whether a task is due today or earlier, by local date (SPEC.md section
// 7, rule 1). A task with no due date counts as available.
export function isDueByToday(due: TaskDue | null, today: Date): boolean {
	if (!due) return true;
	const moment = parseDue(due.date);
	if (!moment) return true;
	const dueDay = moment.year * 10000 + moment.month * 100 + moment.day;
	const thisDay = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
	return dueDay <= thisDay;
}

// "p1", "p2" or "p3", or null for the default priority. Todoist's API
// value runs backwards: 4 is p1 and 1 is p4.
export function priorityLabel(apiPriority: number): string | null {
	if (apiPriority === 4) return 'p1';
	if (apiPriority === 3) return 'p2';
	if (apiPriority === 2) return 'p3';
	return null;
}

export interface DetailsOptions {
	// The "Show task details in the link" setting.
	showDetails: boolean;
	// The task's project name, or null for the Inbox.
	projectName: string | null;
}

// Builds the link text for a task.
export function formatLinkText(task: TaskInfo, options: DetailsOptions): string {
	if (!options.showDetails) return LINK_MARK;

	const parts: string[] = [];
	if (task.due && task.due.isRecurring) parts.push(RECURRING_MARK);
	const priority = priorityLabel(task.priority);
	if (priority) parts.push(priority);
	if (options.projectName) parts.push(`##${options.projectName}`);
	for (const label of task.labels) parts.push(`@@${label}`);

	return parts.length ? `${LINK_MARK} ${parts.join(SEPARATOR)}` : LINK_MARK;
}
