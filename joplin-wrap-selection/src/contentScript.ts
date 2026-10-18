// CodeMirror 6 content script.
//
// Typing one of the Markdown formatting characters below while text is
// selected wraps the selection in it instead of replacing it, and keeps the
// inner text selected. So typing "*" twice over "word" gives "**word**".
//
// Backticks, brackets and quotes are left alone: Joplin already wraps a
// selection in those when "Auto-pair braces" is on (CodeMirror's
// closeBrackets).

// Loaded with require() rather than import: Joplin provides these at
// runtime (webpack treats them as externals), and their type definitions
// are not installed in this project.
const { EditorView } = require('@codemirror/view');
const { EditorSelection, Prec } = require('@codemirror/state');

const WRAP_CHARS = ['*', '_', '~', '='];

// Returns the transaction that wraps every non-empty range in `char` (and
// types it normally at any bare cursor), or null when no range is selected.
export function wrapSelection(state: any, char: string): any {
	if (!WRAP_CHARS.includes(char)) return null;
	if (state.selection.ranges.every((range: any) => range.empty)) return null;

	return state.update(state.changeByRange((range: any) => {
		if (range.empty) {
			return {
				changes: { from: range.from, insert: char },
				range: EditorSelection.cursor(range.from + char.length),
			};
		}
		return {
			changes: [
				{ from: range.from, insert: char },
				{ from: range.to, insert: char },
			],
			// Both ends move past the opening character. Building the range
			// from anchor and head keeps the selection's direction.
			range: EditorSelection.range(range.anchor + char.length, range.head + char.length),
		};
	}), { scrollIntoView: true, userEvent: 'input.type' });
}

export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (codeMirrorWrapper: any) => {
			// This script only supports the CodeMirror 6 editor. `cm6` is
			// undefined when the legacy CodeMirror 5 editor loads it instead.
			if (!codeMirrorWrapper.cm6) return;

			const handler = EditorView.inputHandler.of((view: any, from: number, to: number, text: string) => {
				// Same guards as CodeMirror's closeBrackets: leave IME
				// composition and read-only notes alone.
				if (view.compositionStarted || view.state.readOnly) return false;

				// Only plain typing over the current selection, not input
				// that replaces some other range (autocorrect, for example).
				const main = view.state.selection.main;
				if (from !== main.from || to !== main.to) return false;

				const transaction = wrapSelection(view.state, text);
				if (!transaction) return false;
				view.dispatch(transaction);
				return true;
			});

			codeMirrorWrapper.addExtension(Prec.high(handler));
		},
	};
};
