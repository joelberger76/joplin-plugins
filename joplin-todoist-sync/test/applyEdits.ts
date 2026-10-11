import { ChangeSet, EditorState } from '@codemirror/state';
import { resolveEdits, TextEdit } from '../src/edits';

// Applies edits the way the editor script does: through a real CodeMirror
// document, with `typing` (if any) done after the snapshot was taken.
export function apply(body: string, edits: TextEdit[], typing?: (state: EditorState) => { from: number; to?: number; insert: string }) {
	let state = EditorState.create({ doc: body });
	let changes = ChangeSet.empty(state.doc.length).desc;

	if (typing) {
		const transaction = state.update({ changes: typing(state) });
		changes = changes.composeDesc(transaction.changes.desc);
		state = transaction.state;
	}

	const resolved = resolveEdits(edits, {
		mapPos: (pos, assoc) => changes.mapPos(pos, assoc),
		slice: (from, to) => state.sliceDoc(from, to),
	});
	return { text: state.update({ changes: resolved.changes }).state.doc.toString(), skipped: resolved.skippedGroups };
}
