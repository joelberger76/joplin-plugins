// Works out what "Remove Todoist links" does to a note (SPEC.md section
// 6.4). Pure: it takes the note and the selection.

import { lineStarts, TextEdit } from './edits';
import { formatTaskLine, ParsedNote, TaskLine } from './noteParser';

// Zero-based line numbers, both included.
export interface UnlinkScope {
	fromLine: number;
	toLine: number;
}

function groupOf(line: TaskLine): string {
	return `line@${line.lineNumber}`;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function nameOf(line: TaskLine): string {
	return line.name || '(no name)';
}

// The linked lines of the note, within `scope` if there is one.
export function linkedLines(note: ParsedNote, scope: UnlinkScope | null): TaskLine[] {
	return note.taskLines
		.filter(line => line.link)
		.filter(line => !scope || (line.lineNumber >= scope.fromLine && line.lineNumber <= scope.toLine));
}

// What to ask before every link in the note, or in the selection, is removed.
export function confirmAll(lines: TaskLine[], inSelection: boolean): string {
	const where = inSelection ? 'the selection' : 'this note';
	return `Remove ${plural(lines.length, 'Todoist link')} from ${where}? The tasks stay in Todoist, and the lines become plain checkboxes. Sending them again would create the tasks a second time.`;
}

// One edit per line: the line without its link. Each depends on its own
// line only, so a line edited meanwhile is skipped by itself.
export function unlinkEdits(note: ParsedNote, lines: TaskLine[]): TextEdit[] {
	const starts = lineStarts(note.lines);
	return lines.map(line => {
		const from = starts[line.lineNumber];
		const to = from + line.text.length;
		return { from, to, insert: formatTaskLine({ ...line, link: null }), checkFrom: from, checkTo: to, expected: line.text, group: groupOf(line) };
	});
}

// What to tell the user (SPEC.md section 6.5). `skippedGroups` is what the
// editor reported as skipped, because the line was edited meanwhile.
export function reportUnlink(lines: TaskLine[], skippedGroups: string[]): { summary: string; problems: string[] } {
	const skipped = new Set(skippedGroups);
	const kept = lines.filter(line => skipped.has(groupOf(line)));
	return {
		summary: `Removed ${plural(lines.length - kept.length, 'link')}.`,
		problems: kept.map(line => `Edited meanwhile, so its link was left: ${nameOf(line)}`),
	};
}
