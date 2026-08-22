// CodeMirror 6 content script.
//
// Cycles each line touched by the cursor/selection through three states:
//   1. plain text        e.g. "buy milk"
//   2. a bullet          e.g. "- buy milk"
//   3. a checkbox        e.g. "- [ ] buy milk"
// ...and back to plain text again.
//
// A checked checkbox ("- [x] buy milk") is treated as the same "checkbox"
// state, so cycling it moves back to plain text rather than requiring an
// extra press to get past the checked mark.

// Computes the change needed to cycle a single line, touching only the
// marker itself (not the indent or the content after it). Keeping the
// change scoped to the marker means the cursor/selection maps through it
// predictably: positions in the untouched content shift by a fixed offset,
// and positions at the edit point can be forced to land after the new
// marker (see the `assoc` used when mapping the selection below), instead
// of CodeMirror's default of leaving them before an insertion.
function computeLineChange(line: { from: number; text: string }): { from: number; to: number; insert: string } | null {
	const text = line.text;
	const indentMatch = text.match(/^(\s*)/);
	const indent = indentMatch ? indentMatch[1] : '';
	const rest = text.slice(indent.length);
	const markerStart = line.from + indent.length;

	// Checkbox (checked or unchecked) -> plain text
	const checkboxMatch = rest.match(/^([-*] \[[ xX]\] )/);
	if (checkboxMatch) {
		return { from: markerStart, to: markerStart + checkboxMatch[1].length, insert: '' };
	}

	// Bullet, but not a checkbox -> checkbox
	const bulletMatch = rest.match(/^([-*] )/);
	if (bulletMatch) {
		return { from: markerStart, to: markerStart + bulletMatch[1].length, insert: '- [ ] ' };
	}

	// Plain text -> bullet
	return { from: markerStart, to: markerStart, insert: '- ' };
}

export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (codeMirrorWrapper: any) => {
			// This script only supports the CodeMirror 6 editor. `cm6` is
			// undefined when the legacy CodeMirror 5 editor loads it instead.
			if (!codeMirrorWrapper.cm6) return;

			codeMirrorWrapper.registerCommand('cycleBulletCheckbox', () => {
				const view = codeMirrorWrapper.editor;
				const state = view.state;

				const changes: { from: number; to: number; insert: string }[] = [];
				const seenLines = new Set<number>();

				// Handles multiple cursors/selections, and multi-line
				// selections, by cycling every line they touch.
				for (const range of state.selection.ranges) {
					const startLine = state.doc.lineAt(range.from).number;
					const endLine = state.doc.lineAt(range.to).number;

					for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
						if (seenLines.has(lineNumber)) continue;
						seenLines.add(lineNumber);

						const line = state.doc.line(lineNumber);
						const change = computeLineChange(line);
						if (change) changes.push(change);
					}
				}

				if (changes.length) {
					// Map the selection through the changes ourselves, with
					// assoc = 1 (forward affinity), so a cursor sitting at
					// the edit point - e.g. on an empty line, where the
					// insertion point and the cursor are the same position -
					// ends up after the new marker rather than before it.
					const changeSet = state.changes(changes);
					view.dispatch({
						changes: changeSet,
						selection: state.selection.map(changeSet, 1),
					});
				}
			});
		},
	};
};
