// How a `todoist` query block is shown (SPEC.md section 8.1): as a one-line
// chip in the Markdown editor, and not at all in the rendered note.
// Nothing here depends on CodeMirror or markdown-it, so it can be tested in
// Node.

import { parseNote } from './noteParser';

// A query block in the editor, by character offsets: from the start of its
// opening fence line to the end of its closing fence line.
export interface BlockRange {
	from: number;
	to: number;
	filter: string | null;
	// Shown when the pointer rests on the chip.
	hint: string;
}

// The chip's text: "Todoist" alone, or with the filter when the "Show the
// filter in the query block chip" setting is on.
export function chipLabel(filter: string | null, showFilter: boolean): string {
	return showFilter ? `Todoist: ${filter || 'default filter'}` : 'Todoist';
}

// Says what the chip leaves out: the filter, and when it last ran. Two
// lines, each with a label.
export function chipHint(filter: string | null, fetched: string | null): string {
	return `Filter: ${filter || 'default'}\nFetched: ${fetched || 'not yet'}`;
}

// Every query block of the note, in order.
export function blockRanges(body: string): BlockRange[] {
	const parsed = parseNote(body);
	if (!parsed.queryBlocks.length) return [];

	const starts: number[] = [];
	let offset = 0;
	for (const line of parsed.lines) {
		starts.push(offset);
		offset += line.length + 1;
	}

	return parsed.queryBlocks.map(block => ({
		from: starts[block.startLine],
		to: starts[block.endLine] + parsed.lines[block.endLine].length,
		filter: block.filter,
		hint: chipHint(block.filter, block.fetched),
	}));
}

// The blocks to collapse: all but those the selection touches. A cursor at
// either end of a block counts, so the block opens as soon as it is reached.
export function collapsedBlocks(blocks: BlockRange[], selection: Array<{ from: number; to: number }>): BlockRange[] {
	return blocks.filter(block => !selection.some(range => range.from <= block.to && range.to >= block.from));
}

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Whether a fenced code block's info string makes it a query block.
export function isQueryInfo(info: string): boolean {
	return info.trim().split(/\s+/)[0].toLowerCase() === 'todoist';
}

// The HTML for a query block in the rendered note, where it is not shown
// (SPEC.md section 8.1). `markup` is the fence as written, `info` what
// follows it on its line, and `content` the lines between the fences.
//
// The source goes in a "joplin-source" element inside a "joplin-editable"
// one, which is how Joplin's own code blocks keep theirs. The Rich Text
// editor saves a note by converting this HTML back to Markdown, and writes
// that source back. So the block is hidden with CSS and never left out.
export function renderQueryBlock(markup: string, info: string, content: string): string {
	const source = content.replace(/\n$/, '');
	const open = escapeHtml(`${markup}${info.trim()}`);

	return '<div class="joplin-editable todoist-query">'
		+ `<pre class="joplin-source" data-joplin-language="todoist" data-joplin-source-open="${open}&#10;" data-joplin-source-close="&#10;${escapeHtml(markup)}">${escapeHtml(source)}</pre>`
		+ '</div>\n';
}
