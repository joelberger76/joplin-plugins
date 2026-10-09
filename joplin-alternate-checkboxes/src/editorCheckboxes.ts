// CodeMirror 6 content script: in the Markdown editor, replaces the
// "- [<char>]" at the start of a bullet list item with the same icon the
// viewer shows.
//
// It follows Joplin's own in-editor checkbox rendering
// (packages/editor/CodeMirror/extensions/rendering/replaceCheckboxes.ts):
// the list mark and the bracket are replaced together, and the raw text is
// shown again while the cursor or selection touches them.

// Loaded with require() rather than import: Joplin provides these at
// runtime (webpack treats them as externals), and their type definitions
// are not installed in this project.
const { Decoration, EditorView, ViewPlugin, WidgetType } = require('@codemirror/view');
const { syntaxTree } = require('@codemirror/language');

// eslint-disable-next-line @typescript-eslint/no-var-requires
const taskIcons: Record<string, { label: string; color: string; icon: string }> = require('./taskIcons.json');

// Text after the list mark: spaces, then the marker, then whitespace or the
// end of the line. Mirrors MARKER in altCheckboxes.ts.
const AFTER_LIST_MARK = /^([ \t]+)\[(.)\](?=[ \t]|$)/;

const iconClassName = 'cm-alt-checkbox';
const canceledLineClassName = 'cm-alt-checkbox-canceled';

export interface EditorMarker {
	// Start of the list mark ("-", "*" or "+").
	from: number;
	// End of the closing bracket.
	to: number;
	char: string;
	// 1 for a top level list item, 2 for an item nested once, and so on.
	depth: number;
}

// Exported so the matching can be checked without a real editor view.
export function findEditorMarkers(state: any, from: number, to: number): EditorMarker[] {
	const found: EditorMarker[] = [];
	let depth = 0;

	syntaxTree(state).iterate({
		from, to,
		enter: (node: any) => {
			if (node.name === 'ListItem') depth++;
			if (node.name !== 'ListMark') return;

			const item = node.node.parent;
			if (item?.name !== 'ListItem' || item.parent?.name !== 'BulletList') return;

			const line = state.doc.lineAt(node.from);
			const match = AFTER_LIST_MARK.exec(state.doc.sliceString(node.to, line.to));
			if (!match) return;
			const char = match[2];
			if (!Object.prototype.hasOwnProperty.call(taskIcons, char)) return;

			found.push({ from: node.from, to: node.to + match[0].length, char, depth });
		},
		leave: (node: any) => {
			if (node.name === 'ListItem') depth--;
		},
	});

	return found;
}

// Same rule as Joplin's checkboxes: show the raw text when the selection
// touches the marker, except for a bare cursor sitting right before it.
function selectionTouches(selection: any, marker: EditorMarker): boolean {
	if (selection.empty && selection.from === marker.from) return false;
	const inMarker = (point: number) => point >= marker.from && point <= marker.to;
	const inSelection = (point: number) => point >= selection.from && point <= selection.to;
	return inMarker(selection.from) || inMarker(selection.to) || inSelection(marker.from) || inSelection(marker.to);
}

class IconWidget extends WidgetType {
	public constructor(private char: string, private depth: number) {
		super();
	}

	public eq(other: IconWidget) {
		return other.char === this.char && other.depth === this.depth;
	}

	public toDOM() {
		const icon = document.createElement('span');
		icon.className = `${iconClassName} ${this.depth <= 1 ? '-depth-1' : ''}`.trim();
		icon.dataset.task = this.char;
		icon.title = taskIcons[this.char].label;
		icon.setAttribute('aria-label', taskIcons[this.char].label);
		icon.setAttribute('role', 'img');
		return icon;
	}

	// Lets a click on the icon place the cursor, which reveals the raw text.
	public ignoreEvent() {
		return false;
	}
}

function buildTheme() {
	// Size and offsets match the built-in checkbox, so both kinds line up
	// in a mixed list.
	const spec: Record<string, Record<string, string>> = {
		[`.${iconClassName}`]: {
			display: 'inline-block',
			width: '1.1em',
			height: '1.1em',
			margin: '4px',
			marginInlineStart: '0',
			verticalAlign: 'middle',
			transform: 'translateY(calc(-0.1em - 1px))',
			backgroundColor: 'var(--alt-checkbox-color, currentColor)',
			'-webkit-mask': 'var(--alt-checkbox-icon) center / contain no-repeat',
			mask: 'var(--alt-checkbox-icon) center / contain no-repeat',
		},
		[`.${iconClassName}.-depth-1`]: {
			marginInlineStart: '4px',
		},
		[`.${canceledLineClassName}`]: {
			textDecoration: 'line-through',
			opacity: '0.6',
		},
	};

	for (const [char, def] of Object.entries(taskIcons)) {
		const value = char.replace(/["\\]/g, '\\$&');
		spec[`.${iconClassName}[data-task="${value}"]`] = {
			'--alt-checkbox-color': def.color,
			'--alt-checkbox-icon': def.icon,
		};
	}

	return EditorView.baseTheme(spec);
}

export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (codeMirrorWrapper: any) => {
			// This script only supports the CodeMirror 6 editor. `cm6` is
			// undefined when the legacy CodeMirror 5 editor loads it instead.
			if (!codeMirrorWrapper.cm6) return;

			const canceledLine = Decoration.line({ class: canceledLineClassName });

			const buildDecorations = (view: any) => {
				const selection = view.state.selection.main;
				const ranges: any[] = [];

				for (const visible of view.visibleRanges) {
					for (const marker of findEditorMarkers(view.state, visible.from, visible.to)) {
						if (marker.char === '-') {
							ranges.push(canceledLine.range(view.state.doc.lineAt(marker.from).from));
						}
						if (selectionTouches(selection, marker)) continue;

						// inclusiveStart sorts this ahead of Joplin's own
						// one-character replacement of the list mark, which
						// starts at the same position. CodeMirror draws
						// whichever comes first, so the bullet is not drawn
						// next to the icon.
						ranges.push(Decoration.replace({
							widget: new IconWidget(marker.char, marker.depth),
							inclusiveStart: true,
						}).range(marker.from, marker.to));
					}
				}

				return Decoration.set(ranges, true);
			};

			const iconRenderer = ViewPlugin.fromClass(
				class {
					public decorations: any;

					public constructor(view: any) {
						this.decorations = buildDecorations(view);
					}

					public update(update: any) {
						// The syntax tree is parsed incrementally, so it can
						// change without the document itself changing.
						const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
						if (update.docChanged || update.viewportChanged || update.selectionSet || treeChanged) {
							this.decorations = buildDecorations(update.view);
						}
					}
				},
				{ decorations: (plugin: any) => plugin.decorations },
			);

			codeMirrorWrapper.addExtension([iconRenderer, buildTheme()]);
		},
	};
};
