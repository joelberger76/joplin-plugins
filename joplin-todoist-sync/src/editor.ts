// CodeMirror 6 content script. It gives the plugin two things it can't get
// any other way (SPEC.md section 9.1, item 4):
//
// - the note text as it is in the editor right now, typing included
// - a way to change that text as one editor transaction, which is safe
//   while the user is typing and is a single undo step
//
// Between reading the text and writing the edits, the plugin talks to
// Todoist, and the user may keep typing. So reading the text opens a
// "session" that records every change made since. Edits are then moved
// through those changes before they are applied (see edits.ts).

import { APPLY_EDITS_COMMAND, ApplyResult, EditorState, GET_STATE_COMMAND } from './editorApi';
import { resolveEdits, TextEdit } from './edits';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CodeMirror is supplied by Joplin at runtime, with no type packages
export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
		plugin: (codeMirrorWrapper: any) => {
			// Only the CodeMirror 6 editor is supported.
			if (!codeMirrorWrapper.cm6) return;

			// Loaded with require() because Joplin supplies these at
			// runtime (they are webpack externals).
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { EditorView } = require('@codemirror/view');
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { ChangeSet } = require('@codemirror/state');

			// The open session: its id and every document change since it
			// was opened, composed into one description.
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a CodeMirror ChangeDesc
			let session: { id: number; changes: any } | null = null;
			let nextSessionId = 1;

			codeMirrorWrapper.addExtension(
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a CodeMirror ViewUpdate
				EditorView.updateListener.of((update: any) => {
					if (session && update.docChanged) {
						session.changes = session.changes.composeDesc(update.changes.desc);
					}
				}),
			);

			codeMirrorWrapper.registerCommand(GET_STATE_COMMAND, (): EditorState => {
				const state = codeMirrorWrapper.editor.state;
				const main = state.selection.main;

				session = { id: nextSessionId++, changes: ChangeSet.empty(state.doc.length).desc };

				return {
					session: session.id,
					body: state.doc.toString(),
					cursorLine: state.doc.lineAt(main.head).number - 1,
					selectionFromLine: state.doc.lineAt(main.from).number - 1,
					selectionToLine: state.doc.lineAt(main.to).number - 1,
					hasSelection: !main.empty,
				};
			});

			codeMirrorWrapper.registerCommand(APPLY_EDITS_COMMAND, (sessionId: number, edits: TextEdit[]): ApplyResult => {
				if (!session || session.id !== sessionId) {
					return { ok: false, applied: 0, skippedGroups: [] };
				}

				const view = codeMirrorWrapper.editor;
				const changes = session.changes;
				session = null;

				const resolved = resolveEdits(edits, {
					mapPos: (pos: number, assoc: number) => changes.mapPos(pos, assoc),
					slice: (from: number, to: number) => view.state.sliceDoc(from, to),
				});

				if (resolved.changes.length) {
					view.dispatch({ changes: resolved.changes, userEvent: 'input.todoistSync' });
				}

				return { ok: true, applied: resolved.changes.length, skippedGroups: resolved.skippedGroups };
			});
		},
	};
};
