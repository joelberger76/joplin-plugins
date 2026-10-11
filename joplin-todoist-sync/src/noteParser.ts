// Reads the parts of a note the plugin cares about: checkbox lines, the
// Todoist link at the end of a linked line, and `todoist` query blocks
// (SPEC.md section 3).

export interface TaskLink {
	// The link text, unescaped. Holds the task details (SPEC.md section 3.3).
	text: string;
	url: string;
	taskId: string;
	// What follows "#" at the end of the URL, or null. A recurring line
	// keeps the date of its occurrence there (SPEC.md section 7).
	occurrence: string | null;
}

export interface TaskLine {
	// Zero-based line number in the note.
	lineNumber: number;
	// The line exactly as written.
	text: string;
	indent: string;
	// "-", "*" or "+".
	bullet: string;
	checked: boolean;
	// The text between the checkbox and the trailing link.
	name: string;
	link: TaskLink | null;
}

export interface QueryBlock {
	// Zero-based line numbers of the opening and closing fence.
	startLine: number;
	endLine: number;
	filter: string | null;
	// The value of the `fetched:` line, or null if the block has never run.
	fetched: string | null;
}

export interface ParsedNote {
	lines: string[];
	taskLines: TaskLine[];
	queryBlocks: QueryBlock[];
}

const FENCE_OPEN = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/;
const TASK_LINE = /^(\s*)([-*+])\s+\[([ xX])\](?:\s+(.*))?$/;
const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s/;

// A Markdown link at the end of the line that points at a Todoist task. The
// link is recognized by its URL alone. The id is the last dash-separated
// part of the path, so a URL copied from the Todoist app, which puts the
// task name in front of the id, works too.
const TRAILING_LINK = /(?:^|\s)\[((?:\\.|[^\]\\])*)\]\((https:\/\/(?:app\.)?todoist\.com\/app\/task\/(?:[A-Za-z0-9_%.~]+-)*([A-Za-z0-9_]+)(?:#([^\s)]*))?)\)\s*$/;

// The occurrence, if given, goes after a "#". Todoist ignores that part of
// the URL, so the link still opens the task.
export function taskUrl(taskId: string, occurrence?: string | null): string {
	return `https://app.todoist.com/app/task/${taskId}${occurrence ? `#${occurrence}` : ''}`;
}

export function escapeLinkText(text: string): string {
	return text.replace(/[\\\[\]]/g, '\\$&');
}

function unescapeLinkText(text: string): string {
	return text.replace(/\\([\\\[\]])/g, '$1');
}

function closesFence(line: string, fence: string): boolean {
	const trimmed = line.trim();
	return trimmed.length >= fence.length
		&& trimmed === fence[0].repeat(trimmed.length);
}

// Returns the task line on `text`, or null if the line is not a bullet with
// a `[ ]` or `[x]` checkbox.
export function parseTaskLine(text: string, lineNumber: number): TaskLine | null {
	const match = TASK_LINE.exec(text);
	if (!match) return null;

	const rest = match[4] ?? '';
	const linkMatch = TRAILING_LINK.exec(rest);

	let name = rest.trim();
	let link: TaskLink | null = null;
	if (linkMatch) {
		name = rest.slice(0, linkMatch.index).trim();
		link = {
			text: unescapeLinkText(linkMatch[1]),
			url: linkMatch[2],
			taskId: linkMatch[3],
			occurrence: linkMatch[4] || null,
		};
	}

	return {
		lineNumber,
		text,
		indent: match[1],
		bullet: match[2],
		checked: match[3] !== ' ',
		name,
		link,
	};
}

// Writes a task line. `link` is null for an unlinked line.
export function formatTaskLine(line: {
	indent: string;
	bullet: string;
	checked: boolean;
	name: string;
	link: { text: string; taskId: string; occurrence?: string | null } | null;
}): string {
	const box = line.checked ? '[x]' : '[ ]';
	const parts = [`${line.indent}${line.bullet} ${box}`];
	if (line.name) parts.push(line.name);
	if (line.link) parts.push(`[${escapeLinkText(line.link.text)}](${taskUrl(line.link.taskId, line.link.occurrence)})`);
	return parts.join(' ');
}

function readBlock(lines: string[], startLine: number, endLine: number): QueryBlock {
	let filter: string | null = null;
	let fetched: string | null = null;

	for (let i = startLine + 1; i < endLine; i++) {
		const match = /^\s*(filter|fetched)\s*:\s*(.*?)\s*$/i.exec(lines[i]);
		if (!match) continue;
		const key = match[1].toLowerCase();
		if (key === 'filter' && filter === null) filter = match[2] || null;
		if (key === 'fetched' && fetched === null) fetched = match[2] || null;
	}

	return { startLine, endLine, filter, fetched };
}

export function parseNote(body: string): ParsedNote {
	const lines = body.split('\n');
	const taskLines: TaskLine[] = [];
	const queryBlocks: QueryBlock[] = [];

	// The fence that opened the code block we are inside, if any.
	let fence: string | null = null;
	let fenceStart = 0;
	let fenceIsQuery = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i].replace(/\r$/, '');

		if (fence !== null) {
			if (closesFence(line, fence)) {
				if (fenceIsQuery) queryBlocks.push(readBlock(lines, fenceStart, i));
				fence = null;
			}
			continue;
		}

		// A backtick fence can't have a backtick later on its line. That
		// rules out inline code that happens to start a line.
		const open = FENCE_OPEN.exec(line);
		if (open && !(open[1][0] === '`' && line.slice(line.indexOf(open[1]) + open[1].length).includes('`'))) {
			fence = open[1];
			fenceStart = i;
			fenceIsQuery = open[2].toLowerCase() === 'todoist';
			continue;
		}

		const taskLine = parseTaskLine(line, i);
		if (taskLine) taskLines.push(taskLine);
	}

	return { lines, taskLines, queryBlocks };
}

// Returns the block's lines with its `fetched:` line set to `timestamp`. The
// line is added before the closing fence if the block has none.
export function withFetched(blockLines: string[], timestamp: string): string[] {
	const result = blockLines.slice();
	for (let i = 1; i < result.length - 1; i++) {
		const match = /^(\s*)fetched\s*:/i.exec(result[i]);
		if (match) {
			result[i] = `${match[1]}fetched: ${timestamp}`;
			return result;
		}
	}
	result.splice(result.length - 1, 0, `fetched: ${timestamp}`);
	return result;
}

export interface InsertPlan {
	// New lines go before this zero-based line number.
	beforeLine: number;
	// Whether a blank line is needed after the new lines, to keep the text
	// that follows from being read as part of the last list item.
	blankAfter: boolean;
}

// Where fetched tasks go: directly below the block, or at the end of the
// list that already follows it (SPEC.md section 5.2).
export function planInsert(lines: string[], block: QueryBlock): InsertPlan {
	const isBlank = (i: number) => i >= lines.length || lines[i].trim() === '';

	let first = block.endLine + 1;
	while (first < lines.length && isBlank(first)) first++;

	if (first < lines.length && LIST_ITEM.test(lines[first])) {
		// Walk to the end of that list: list items and their indented
		// continuation lines, up to the first blank or unindented line.
		let end = first + 1;
		while (end < lines.length && !isBlank(end) && (LIST_ITEM.test(lines[end]) || /^\s/.test(lines[end]))) end++;
		return { beforeLine: end, blankAfter: !isBlank(end) };
	}

	const beforeLine = block.endLine + 1;
	return { beforeLine, blankAfter: !isBlank(beforeLine) };
}
