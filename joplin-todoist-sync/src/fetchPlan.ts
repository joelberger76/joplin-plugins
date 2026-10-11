// Works out what Fetch writes into the note (SPEC.md section 5). Pure: it
// takes the note text and the tasks Todoist returned, and returns edits.

import { formatLinkText, occurrenceOf } from './details';
import { lineStarts, TextEdit } from './edits';
import { formatTaskLine, ParsedNote, planInsert, QueryBlock } from './noteParser';
import { isFetchable } from './syncRules';
import { TaskInfo } from './types';

export interface FetchOptions {
	today: Date;
	// The local date and time for the `fetched:` line.
	timestamp: string;
	// The "Show task details in the link" setting.
	showDetails: boolean;
	// Project id to name. The Inbox, and any project not listed, has no name.
	projectNames: Map<string, string>;
}

export interface FetchPlan {
	edits: TextEdit[];
	// Tasks written into the note.
	added: number;
	// Matching tasks left out because the note already links them.
	alreadyLinked: number;
	// Recurring tasks left out because they are not due yet.
	notDue: number;
}

function taskLineFor(task: TaskInfo, options: FetchOptions): string {
	const text = formatLinkText(task, {
		showDetails: options.showDetails,
		projectName: options.projectNames.get(task.projectId) ?? null,
	});
	return formatTaskLine({ indent: '', bullet: '-', checked: false, name: task.content, link: { text, taskId: task.id, occurrence: occurrenceOf(task.due) } });
}

// Picks the tasks to write and counts the ones left out. `linked` is the
// set of task ids already in the note, and is added to.
function choose(tasks: TaskInfo[], linked: Set<string>, options: FetchOptions, plan: FetchPlan): string[] {
	const lines: string[] = [];
	for (const task of tasks) {
		if (linked.has(task.id)) {
			plan.alreadyLinked++;
		} else if (!isFetchable(task, options.today)) {
			plan.notDue++;
		} else {
			linked.add(task.id);
			lines.push(taskLineFor(task, options));
			plan.added++;
		}
	}
	return lines;
}

function linkedIds(note: ParsedNote): Set<string> {
	const ids = new Set<string>();
	for (const line of note.taskLines) {
		if (line.link) ids.add(line.link.taskId);
	}
	return ids;
}

// Plans a fetch into the query blocks of a note. `results` holds the tasks
// for each block that was run, in any order. Blocks not listed are left
// alone.
export function planFetch(note: ParsedNote, results: Array<{ block: QueryBlock; tasks: TaskInfo[] }>, options: FetchOptions): FetchPlan {
	const plan: FetchPlan = { edits: [], added: 0, alreadyLinked: 0, notDue: 0 };
	const lines = note.lines;
	const starts = lineStarts(lines);
	const linked = linkedIds(note);
	const lineRange = (i: number) => ({ checkFrom: starts[i], checkTo: starts[i] + lines[i].length, expected: lines[i] });

	const ordered = results.slice().sort((a, b) => a.block.startLine - b.block.startLine);

	for (const { block, tasks } of ordered) {
		const group = `block@${block.startLine}`;
		const newLines = choose(tasks, linked, options, plan);

		// The `fetched:` line: replace it, or add one before the closing fence.
		let fetchedLine = -1;
		for (let i = block.startLine + 1; i < block.endLine; i++) {
			if (/^\s*fetched\s*:/i.test(lines[i])) {
				fetchedLine = i;
				break;
			}
		}
		if (fetchedLine >= 0) {
			const indent = /^\s*/.exec(lines[fetchedLine])![0];
			plan.edits.push({
				from: starts[fetchedLine],
				to: starts[fetchedLine] + lines[fetchedLine].length,
				insert: `${indent}fetched: ${options.timestamp}`,
				...lineRange(fetchedLine),
				group,
			});
		} else {
			plan.edits.push({
				from: starts[block.endLine],
				to: starts[block.endLine],
				insert: `fetched: ${options.timestamp}\n`,
				...lineRange(block.endLine),
				group,
			});
		}

		if (!newLines.length) continue;

		// The task lines go below the block or at the end of the list
		// that follows it. The edit depends on the line above them.
		const where = planInsert(lines, block);
		const above = where.beforeLine - 1;
		if (where.beforeLine < lines.length) {
			plan.edits.push({
				from: starts[where.beforeLine],
				to: starts[where.beforeLine],
				insert: `${newLines.join('\n')}\n${where.blankAfter ? '\n' : ''}`,
				...lineRange(above),
				group,
			});
		} else {
			const end = starts[lines.length];
			plan.edits.push({
				from: end,
				to: end,
				insert: `\n${newLines.join('\n')}`,
				...lineRange(above),
				group,
			});
		}
	}

	return plan;
}

// Plans a fetch into a note with no query block: a new block is written at
// the cursor, already marked as fetched, with its tasks below it.
export function planNewBlock(note: ParsedNote, cursorLine: number, filter: string, tasks: TaskInfo[], options: FetchOptions): FetchPlan {
	const plan: FetchPlan = { edits: [], added: 0, alreadyLinked: 0, notDue: 0 };
	const lines = note.lines;
	const starts = lineStarts(lines);
	const at = Math.min(Math.max(cursorLine, 0), lines.length - 1);

	const text = [
		'```todoist',
		`filter: ${filter}`,
		`fetched: ${options.timestamp}`,
		'```',
		...choose(tasks, linkedIds(note), options, plan),
	].join('\n');

	const check = { checkFrom: starts[at], checkTo: starts[at] + lines[at].length, expected: lines[at] };
	const group = 'newBlock';

	if (lines[at].trim() === '') {
		// On an empty line: the block takes its place. The empty line is
		// only kept, below the block, to separate it from text that follows.
		const textFollows = at + 1 < lines.length && lines[at + 1].trim() !== '';
		plan.edits.push({ from: starts[at], to: starts[at], insert: textFollows ? `${text}\n` : text, ...check, group });
	} else if (at + 1 < lines.length) {
		// Otherwise it goes below the cursor's line, after a blank line.
		const blankAfter = lines[at + 1].trim() !== '';
		plan.edits.push({ from: starts[at + 1], to: starts[at + 1], insert: `\n${text}\n${blankAfter ? '\n' : ''}`, ...check, group });
	} else {
		const end = starts[lines.length];
		plan.edits.push({ from: end, to: end, insert: `\n\n${text}`, ...check, group });
	}

	return plan;
}
