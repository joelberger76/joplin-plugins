// Works out what Send does with a note (SPEC.md section 4): which lines
// become tasks, what is sent for each, the edits that link the lines and
// the report. It takes the Todoist calls as a parameter, so it can be
// tested in Node without the network.

import { formatLinkText, occurrenceOf } from './details';
import { lineGroup, lineStarts, TextEdit } from './edits';
import { matchName } from './names';
import { formatTaskLine, LIST_ITEM, ParsedNote, taskUrl, TaskLine } from './noteParser';
import { buildQuickAdd, cleanName, SendTokens, splitTokens } from './sendText';
import { plural } from './text';
import { TodoistError } from './todoist';
import { TaskInfo } from './types';

// Zero-based line numbers, both included.
export interface SendScope {
	fromLine: number;
	toLine: number;
}

export interface SendCandidate {
	line: TaskLine;
	tokens: SendTokens;
}

export interface SendLists {
	// Every project and label name of the account. Either may be empty when
	// no line uses its token.
	projects: string[];
	labels: string[];
	// The exact name of the project for lines without a `##`, or null for
	// the Inbox.
	defaultProject: string | null;
}

export interface SendItem {
	line: TaskLine;
	// The text for the quick add call.
	text: string;
	// The task needs one more call, to take the backslashes out of its name.
	needsRename: boolean;
	// The task this one goes under: one that is already linked, or the one
	// created for another line of this run.
	parent: { taskId: string } | { lineNumber: number } | null;
}

export interface SendPlan {
	items: SendItem[];
	// One line per thing that needs attention.
	problems: string[];
}

// The three Todoist calls Send makes. `TodoistClient` has them.
export interface SendApi {
	quickAdd(text: string): Promise<TaskInfo>;
	renameTask(id: string, content: string): Promise<TaskInfo>;
	moveUnder(id: string, parentId: string): Promise<TaskInfo>;
}

export interface SentLine {
	line: TaskLine;
	// The task as Todoist last returned it.
	task: TaskInfo;
}

export interface SendResult {
	sent: SentLine[];
	problems: string[];
}

export interface SendOptions {
	// The "Show task details in the link" setting.
	showDetails: boolean;
	// Project id to name. The Inbox, and any project not listed, has no name.
	projectNames: Map<string, string>;
}

const PARENT_NOT_SENT = 'Not sent, because the line it is under was not sent';

function listOf(names: string[]): string {
	if (names.length < 2) return names.join('');
	return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// The width of a line's indentation, with a tab reaching the next
// multiple of four.
function indentWidth(line: string): number {
	let width = 0;
	for (const char of line) {
		if (char === ' ') width++;
		else if (char === '\t') width += 4 - (width % 4);
		else break;
	}
	return width;
}

// The list item a line sits directly under: the nearest line above it that
// is indented less. Null when there is none or it is not a list item.
function parentLineOf(lines: string[], lineNumber: number): number | null {
	const width = indentWidth(lines[lineNumber]);
	for (let i = lineNumber - 1; i >= 0 && width > 0; i--) {
		if (lines[i].trim() === '' || indentWidth(lines[i]) >= width) continue;
		return LIST_ITEM.test(lines[i]) ? i : null;
	}
	return null;
}

// The lines Send looks at: unchecked, unlinked task lines with a name,
// within `scope` if there is one.
export function sendCandidates(note: ParsedNote, scope: SendScope | null): SendCandidate[] {
	return note.taskLines
		.filter(line => !line.checked && !line.link && line.name !== '')
		.filter(line => !scope || (line.lineNumber >= scope.fromLine && line.lineNumber <= scope.toLine))
		.map(line => ({ line, tokens: splitTokens(line.name) }));
}

// Resolves one `##` or `@@` token. Returns the exact name, or the reason
// the line can't be sent.
function resolve(mark: string, kind: string, token: string, names: string[]): { name: string } | { reason: string } {
	const found = matchName(token, names);
	if (found.kind === 'match') return { name: found.name };
	const written = `\`${mark}${token}\``;
	if (found.kind === 'ambiguous') return { reason: `Not sent, ${written} matches ${listOf(found.candidates)}` };
	return { reason: `Not sent, no ${kind} matches ${written}` };
}

// Decides what to send for each candidate. Nothing is guessed: a line with
// a token that can't be resolved is left out and reported, and so is every
// line under it.
export function planSend(note: ParsedNote, candidates: SendCandidate[], lists: SendLists): SendPlan {
	const plan: SendPlan = { items: [], problems: [] };
	const taskLines = new Map(note.taskLines.map(line => [line.lineNumber, line] as [number, TaskLine]));
	const planned = new Set<number>();
	const leftOut = new Set<number>();

	for (const { line, tokens } of candidates) {
		const name = tokens.text || line.name;
		const skip = (reason: string) => {
			plan.problems.push(`${reason}: ${name}`);
			leftOut.add(line.lineNumber);
		};

		// A line under a task line becomes its subtask. Under anything
		// else, it is a task of its own.
		let parent: SendItem['parent'] = null;
		const above = parentLineOf(note.lines, line.lineNumber);
		if (above !== null) {
			const aboveLine = taskLines.get(above);
			if (aboveLine && aboveLine.link) parent = { taskId: aboveLine.link.taskId };
			else if (planned.has(above)) parent = { lineNumber: above };
			else if (leftOut.has(above)) {
				skip(PARENT_NOT_SENT);
				continue;
			}
		}

		if (!tokens.text) {
			skip('Not sent, it has no name besides its tokens');
			continue;
		}

		const labels: string[] = [];
		let reason: string | null = null;
		for (const token of tokens.labelTokens) {
			const found = resolve('@@', 'label', token, lists.labels);
			if ('reason' in found) reason = reason ?? found.reason;
			else if (!labels.includes(found.name)) labels.push(found.name);
		}

		let project: string | null = null;
		if (parent) {
			// A subtask lives in its parent's project.
		} else if (tokens.projectTokens.length > 1) {
			reason = reason ?? `Not sent, it names more than one project (${tokens.projectTokens.map(token => `\`##${token}\``).join(', ')})`;
		} else if (tokens.projectTokens.length === 1) {
			const found = resolve('##', 'project', tokens.projectTokens[0], lists.projects);
			if ('reason' in found) reason = reason ?? found.reason;
			else project = found.name;
		} else {
			project = lists.defaultProject;
		}

		if (reason) {
			skip(reason);
			continue;
		}

		if (parent && tokens.projectTokens.length) {
			plan.problems.push(`${tokens.projectTokens.map(token => `\`##${token}\``).join(', ')} ignored, because a subtask goes in its parent's project: ${name}`);
		}

		const quickAdd = buildQuickAdd(tokens.text, project, labels);
		plan.items.push({ line, text: quickAdd.text, needsRename: quickAdd.needsRename, parent });
		planned.add(line.lineNumber);
	}

	return plan;
}

// A rejected token or an unreachable server will fail every call, and an
// error that is not Todoist's is not understood. Each ends the run.
function endsRun(error: unknown): boolean {
	if (!(error instanceof TodoistError)) return true;
	return error.status === null || error.status === 401 || error.status === 403;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// Creates the tasks, in the order of the note so that a parent exists
// before its subtasks. It never throws: a task that was created must end
// up linked in the note, so whatever goes wrong is reported instead and
// the lines sent so far are returned.
export async function runSend(items: SendItem[], api: SendApi): Promise<SendResult> {
	const result: SendResult = { sent: [], problems: [] };
	const created = new Map<number, string>();

	for (let i = 0; i < items.length; i++) {
		const item = items[i];
		const name = item.line.name;

		let parentId: string | null = null;
		if (item.parent) {
			parentId = 'taskId' in item.parent ? item.parent.taskId : created.get(item.parent.lineNumber) ?? null;
			if (!parentId) {
				result.problems.push(`${PARENT_NOT_SENT}: ${name}`);
				continue;
			}
		}

		let stop = false;
		let task: TaskInfo;
		try {
			task = await api.quickAdd(item.text);
		} catch (error) {
			result.problems.push(`Not sent (${messageOf(error)}): ${name}`);
			if (endsRun(error)) {
				const rest = items.length - i - 1;
				if (rest) result.problems.push(`${plural(rest, 'more line')} not sent after that.`);
				break;
			}
			continue;
		}

		const sent: SentLine = { line: item.line, task };
		result.sent.push(sent);
		created.set(item.line.lineNumber, task.id);

		const cleaned = cleanName(task.content);
		if (item.needsRename && cleaned !== task.content) {
			try {
				sent.task = await api.renameTask(task.id, cleaned);
			} catch (error) {
				result.problems.push(`Created, but its name in Todoist kept a backslash before "#" or "@" (${messageOf(error)}): ${name}`);
				stop = endsRun(error);
			}
		}

		if (parentId && !stop) {
			try {
				sent.task = await api.moveUnder(task.id, parentId);
			} catch (error) {
				result.problems.push(`Created, but not as a subtask (${messageOf(error)}): ${name}`);
				stop = endsRun(error);
			}
		}

		if (stop) {
			const rest = items.length - i - 1;
			if (rest) result.problems.push(`${plural(rest, 'more line')} not sent after that.`);
			break;
		}
	}

	return result;
}

// One edit per sent line: the name Todoist gave the task, then its link.
// Each depends on its own line only, so a line edited while Todoist was
// answering is skipped by itself.
export function sendEdits(note: ParsedNote, sent: SentLine[], options: SendOptions): TextEdit[] {
	const starts = lineStarts(note.lines);

	return sent.map(({ line, task }) => {
		const text = formatLinkText(task, {
			showDetails: options.showDetails,
			projectName: options.projectNames.get(task.projectId) ?? null,
		});
		const insert = formatTaskLine({ ...line, name: task.content, link: { text, taskId: task.id, occurrence: occurrenceOf(task.due) } });
		const from = starts[line.lineNumber];
		const to = from + line.text.length;
		return { from, to, insert, checkFrom: from, checkTo: to, expected: line.text, group: lineGroup(line) };
	});
}

// What to tell the user (SPEC.md section 6.5). `problems` holds those of
// the plan and of the run. `skippedGroups` is what the editor reported as
// skipped, because the line was edited while Send ran.
export function reportSend(sent: SentLine[], problems: string[], skippedGroups: string[]): { summary: string; problems: string[] } {
	const skipped = new Set(skippedGroups);
	const unlinked = sent
		.filter(({ line }) => skipped.has(lineGroup(line)))
		.map(({ line, task }) => `Created, but its line was edited while sending, so it has no link (${taskUrl(task.id)}): ${line.name}`);

	return {
		summary: `Created ${plural(sent.length, 'task')}.`,
		problems: [...problems, ...unlinked],
	};
}
