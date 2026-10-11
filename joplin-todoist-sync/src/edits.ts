// Edits to the note text, worked out from a snapshot of the note and
// applied later by the editor script (SPEC.md section 9).
//
// Todoist calls take time, and the note can change while they run. So each
// edit names the stretch of text it depends on. The editor follows that
// text through whatever was typed in the meantime, and applies the edit
// only if it still reads the same.

export interface TextEdit {
	// The range to replace, as offsets into the snapshot. Equal for an
	// insertion.
	from: number;
	to: number;
	insert: string;
	// The text this edit depends on, and where it was in the snapshot.
	checkFrom: number;
	checkTo: number;
	expected: string;
	// Edits that share a group are applied together or not at all.
	group: string;
}

export interface ResolvedEdits {
	changes: Array<{ from: number; to: number; insert: string }>;
	// The groups that were left out because their text had changed.
	skippedGroups: string[];
}

// What the editor script needs from CodeMirror to place an edit: where a
// snapshot position is now, and the current text.
export interface Mapper {
	mapPos(pos: number, assoc: number): number;
	slice(from: number, to: number): string;
}

// Moves the edits from snapshot positions to current ones, dropping every
// group in which some edit's text no longer reads as expected.
export function resolveEdits(edits: TextEdit[], mapper: Mapper): ResolvedEdits {
	const resolved: Array<{ from: number; to: number; insert: string; group: string }> = [];
	const skipped = new Set<string>();

	for (const edit of edits) {
		const checkFrom = mapper.mapPos(edit.checkFrom, 1);
		const checkTo = mapper.mapPos(edit.checkTo, -1);
		if (checkFrom > checkTo || mapper.slice(checkFrom, checkTo) !== edit.expected) {
			skipped.add(edit.group);
			continue;
		}

		// An insertion goes before anything typed at the same spot.
		const from = mapper.mapPos(edit.from, edit.from === edit.to ? -1 : 1);
		const to = edit.from === edit.to ? from : mapper.mapPos(edit.to, -1);
		if (from > to) {
			skipped.add(edit.group);
			continue;
		}

		resolved.push({ from, to, insert: edit.insert, group: edit.group });
	}

	return {
		changes: resolved
			.filter(edit => !skipped.has(edit.group))
			.map(({ from, to, insert }) => ({ from, to, insert })),
		skippedGroups: Array.from(skipped),
	};
}

// The offset at which each line of `lines` starts, plus one more entry for
// the end of the text.
export function lineStarts(lines: string[]): number[] {
	const starts: number[] = [];
	let offset = 0;
	for (const line of lines) {
		starts.push(offset);
		offset += line.length + 1;
	}
	starts.push(Math.max(0, offset - 1));
	return starts;
}
