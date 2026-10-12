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
//
// It also collapses each `todoist` query block to a one-line chip (SPEC.md
// section 8.1). The raw block shows while the selection touches it.

import { BlockRange, blockRanges, chipLabel, collapsedBlocks } from './blockDisplay';
import { APPLY_EDITS_COMMAND, ApplyResult, CLOSE_SESSION_COMMAND, DisplaySettings, EditorState, GET_DISPLAY_MESSAGE, GET_STATE_COMMAND, REFRESH_DISPLAY_COMMAND } from './editorApi';
import { resolveEdits, TextEdit } from './edits';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- CodeMirror is supplied by Joplin at runtime, with no type packages
export default (context: { contentScriptId: string; postMessage: any }) => {
	return {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
		plugin: (codeMirrorWrapper: any) => {
			// Only the CodeMirror 6 editor is supported.
			if (!codeMirrorWrapper.cm6) return;

			// Loaded with require() because Joplin supplies these at
			// runtime (they are webpack externals).
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { Decoration, EditorView, WidgetType } = require('@codemirror/view');
			// eslint-disable-next-line @typescript-eslint/no-var-requires
			const { ChangeSet, Compartment, StateField } = require('@codemirror/state');

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

				// A selection that ends at the very start of a line does not
				// touch that line, as when whole lines are selected.
				const lastLine = state.doc.lineAt(main.to);
				const endsBeforeLine = !main.empty && main.to === lastLine.from && main.to > main.from;

				return {
					session: session.id,
					body: state.doc.toString(),
					cursorLine: state.doc.lineAt(main.head).number - 1,
					selectionFromLine: state.doc.lineAt(main.from).number - 1,
					selectionToLine: lastLine.number - 1 - (endsBeforeLine ? 1 : 0),
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

			// A session that gets no edits is closed, so that its changes
			// are not followed for as long as the editor lives.
			codeMirrorWrapper.registerCommand(CLOSE_SESSION_COMMAND, (sessionId: number) => {
				if (session && session.id === sessionId) session = null;
			});

			// The chip a collapsed query block is shown as.
			class ChipWidget extends WidgetType {
				public constructor(private label: string, private hint: string) {
					super();
				}

				public eq(other: ChipWidget) {
					return other.label === this.label && other.hint === this.hint;
				}

				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a CodeMirror EditorView
				public toDOM(view: any) {
					const line = document.createElement('div');
					line.className = 'cm-todoist-query';
					const chip = document.createElement('span');
					chip.className = 'cm-todoist-chip';
					chip.textContent = this.label;
					chip.title = this.hint;
					line.appendChild(chip);

					// A click opens the block, with the cursor at the end
					// of its first line, which is the filter as a rule.
					line.addEventListener('mousedown', (event: MouseEvent) => {
						event.preventDefault();
						const fence = view.state.doc.lineAt(view.posAtDOM(line));
						const inside = fence.number < view.state.doc.lines ? view.state.doc.line(fence.number + 1).to : fence.to;
						view.dispatch({ selection: { anchor: inside } });
						view.focus();
					});

					return line;
				}

				public ignoreEvent() {
					return true;
				}
			}

			// Whether the chip names the block's filter. A setting.
			let showFilter = false;

			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a CodeMirror EditorState
			const decorate = (blocks: BlockRange[], state: any) => {
				return Decoration.set(collapsedBlocks(blocks, state.selection.ranges).map(block =>
					Decoration.replace({ widget: new ChipWidget(chipLabel(block.filter, showFilter), block.hint), block: true }).range(block.from, block.to)));
			};

			// A replacement that spans several lines has to come from a
			// state field, a view plugin is not allowed to make one. The
			// blocks are found again only when the text changes, and the
			// chips are worked out again when the selection moves too.
			const collapseField = StateField.define({
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- a CodeMirror EditorState
				create: (state: any) => {
					const blocks = blockRanges(state.doc.toString());
					return { blocks, decorations: decorate(blocks, state) };
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the field's value and a CodeMirror Transaction
				update: (value: any, transaction: any) => {
					if (!transaction.docChanged && !transaction.selection) return value;
					const blocks = transaction.docChanged ? blockRanges(transaction.state.doc.toString()) : value.blocks;
					return { blocks, decorations: decorate(blocks, transaction.state) };
				},
				// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the field itself
				provide: (field: any) => EditorView.decorations.from(field, (value: any) => value.decorations),
			});

			const chipTheme = EditorView.baseTheme({
				'.cm-todoist-query': {
					padding: '0.15em 0',
					cursor: 'pointer',
				},
				'.cm-todoist-chip': {
					display: 'inline-block',
					borderRadius: '0.6em',
					padding: '0.05em 0.6em',
					fontSize: '0.85em',
				},
				'&light .cm-todoist-chip': {
					backgroundColor: 'rgba(0, 0, 0, 0.08)',
					color: 'rgba(0, 0, 0, 0.65)',
				},
				'&dark .cm-todoist-chip': {
					backgroundColor: 'rgba(255, 255, 255, 0.12)',
					color: 'rgba(255, 255, 255, 0.7)',
				},
			});

			// Collapsing is on until the setting says otherwise, so the
			// usual case shows no raw block while the answer is on its way.
			const collapse = new Compartment();
			codeMirrorWrapper.addExtension([collapse.of(collapseField), chipTheme]);

			// The editor script can't read settings, so it asks index.ts.
			const applyDisplay = async () => {
				const display: DisplaySettings | null = await context.postMessage({ name: GET_DISPLAY_MESSAGE });
				const on = !display || display.collapse !== false;
				showFilter = !!display && display.showFilter === true;
				// Taking the field out and putting it back makes it draw
				// its chips again, with the new text.
				codeMirrorWrapper.editor.dispatch({ effects: collapse.reconfigure([]) });
				if (on) codeMirrorWrapper.editor.dispatch({ effects: collapse.reconfigure(collapseField) });
			};

			codeMirrorWrapper.registerCommand(REFRESH_DISPLAY_COMMAND, () => {
				void applyDisplay();
			});
			void applyDisplay();
		},
	};
};
