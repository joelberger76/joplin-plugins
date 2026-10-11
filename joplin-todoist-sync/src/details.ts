// The task details shown in a linked line's link text, for example
// "↗ Oct 12 · p1 · ##Work · @@Joel Berger" (SPEC.md section 3.3), and the
// reading back of a recurring line's pinned date (SPEC.md section 7).

import { DueMoment, TaskDue, TaskInfo } from './types';

export const LINK_MARK = '↗';
export const RECURRING_MARK = '↻';
const SEPARATOR = ' · ';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

	// A time in a fixed timezone is given in UTC. Show it in local time.
	const local = new Date(Date.UTC(year, month - 1, day, hour, minute));
	return {
		year: local.getFullYear(),
		month: local.getMonth() + 1,
		day: local.getDate(),
		hour: local.getHours(),
		minute: local.getMinutes(),
	};
}

// "Oct 12", "Oct 12 14:00", "Oct 12 2027" or "Oct 12 2027 14:00".
export function formatDue(moment: DueMoment, withYear: boolean): string {
	let text = `${MONTHS[moment.month - 1]} ${moment.day}`;
	if (withYear) text += ` ${moment.year}`;
	if (moment.hour !== null && moment.minute !== null) {
		text += ` ${String(moment.hour).padStart(2, '0')}:${String(moment.minute).padStart(2, '0')}`;
	}
	return text;
}

export interface LinkDate {
	// The date exactly as written in the link, for example "Oct 10 2026".
	text: string;
	// Null when the link gives no year.
	year: number | null;
	month: number;
	day: number;
	hour: number | null;
	minute: number | null;
}

export interface LinkDetails {
	date: LinkDate | null;
	recurring: boolean;
}

const LINK_DATE = /^([A-Z][a-z]{2}) (\d{1,2})(?: (\d{4}))?(?: (\d{1,2}):(\d{2}))?(?= |$)/;

// Reads the date and the recurring mark back out of a link's text.
export function parseLinkText(text: string): LinkDetails {
	let rest = text.trim();
	if (rest.startsWith(LINK_MARK)) rest = rest.slice(LINK_MARK.length).trim();

	const firstPart = rest.split(SEPARATOR)[0].trim();
	const recurring = firstPart.includes(RECURRING_MARK);

	const match = LINK_DATE.exec(firstPart);
	const month = match ? MONTHS.indexOf(match[1]) + 1 : 0;
	if (!match || month === 0) return { date: null, recurring };

	return {
		date: {
			text: match[0],
			year: match[3] === undefined ? null : Number(match[3]),
			month,
			day: Number(match[2]),
			hour: match[4] === undefined ? null : Number(match[4]),
			minute: match[5] === undefined ? null : Number(match[5]),
		},
		recurring,
	};
}

// Whether the date pinned in a link is the task's current due date, that
// is, whether the line still stands for the occurrence Todoist is waiting
// on (SPEC.md section 7, rule 2). A link with no year matches any year.
export function sameOccurrence(linkDate: LinkDate, due: TaskDue): boolean {
	const moment = parseDue(due.date);
	if (!moment) return false;
	return (linkDate.year === null || linkDate.year === moment.year)
		&& linkDate.month === moment.month
		&& linkDate.day === moment.day
		&& linkDate.hour === moment.hour
		&& linkDate.minute === moment.minute;
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
	today: Date;
	// For a recurring task that is already linked: the date text in its
	// current link. It is kept as it is, never refreshed.
	pinnedDateText?: string | null;
}

// Builds the link text for a task.
export function formatLinkText(task: TaskInfo, options: DetailsOptions): string {
	const parts: string[] = [];
	const recurring = !!task.due && task.due.isRecurring;

	let dateText: string | null = null;
	if (recurring && options.pinnedDateText) {
		dateText = options.pinnedDateText;
	} else if (task.due) {
		const moment = parseDue(task.due.date);
		// A recurring line always names the year, because a yearly task
		// comes back on the same day and month.
		if (moment) dateText = formatDue(moment, recurring || moment.year !== options.today.getFullYear());
	}

	// A recurring line keeps its date whatever the setting says, because
	// Sync depends on it.
	if (dateText && (options.showDetails || recurring)) {
		parts.push(recurring ? `${dateText} ${RECURRING_MARK}` : dateText);
	}

	if (options.showDetails) {
		const priority = priorityLabel(task.priority);
		if (priority) parts.push(priority);
		if (options.projectName) parts.push(`##${options.projectName}`);
		for (const label of task.labels) parts.push(`@@${label}`);
	}

	return parts.length ? `${LINK_MARK} ${parts.join(SEPARATOR)}` : LINK_MARK;
}
