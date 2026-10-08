// CodeMirror 6 content script.
//
// Adds the "cm-inline-tag" class to every inline #tag in the visible part
// of the note, and ships a default pill style for it. The pill's colors
// come from the plugin's settings, falling back to a default per theme.
//
// Tags are not highlighted inside YAML front matter, code, link targets,
// HTML or math, matching the regions the joplin-tag-sync skill ignores.
import { findTags } from './tags';

// Loaded with require() rather than import: Joplin provides these at
// runtime (webpack treats them as externals), and their type definitions
// are not installed in this project.
const { Decoration, EditorView, ViewPlugin } = require('@codemirror/view');
const { RangeSetBuilder } = require('@codemirror/state');
const { syntaxTree } = require('@codemirror/language');

// Syntax tree nodes a tag is never highlighted inside.
const protectedNodes = new Set([
	'FencedCode', 'CodeBlock', 'InlineCode', 'CodeText', 'CodeInfo',
	'URL', 'Autolink', 'LinkTitle',
	'HTMLTag', 'HTMLBlock', 'Comment', 'CommentBlock', 'ProcessingInstruction', 'ProcessingInstructionBlock',
	'InlineMath', 'BlockMath',
]);

function isProtected(tree: any, pos: number): boolean {
	for (let node = tree.resolveInner(pos, 1); node; node = node.parent) {
		if (protectedNodes.has(node.name)) return true;
	}
	return false;
}

// Returns the offset where YAML front matter ends, or 0 if the note has
// none. Front matter is a "---" on the very first line, closed by another.
function frontMatterEnd(doc: any): number {
	if (doc.line(1).text !== '---') return 0;

	for (let lineNumber = 2; lineNumber <= doc.lines; lineNumber++) {
		const line = doc.line(lineNumber);
		if (line.text === '---') return line.to;
	}
	return 0;
}

// Exported so the matching can be checked without a real editor view.
export function findEditorTags(state: any, from: number, to: number): { from: number; to: number }[] {
	const tree = syntaxTree(state);
	const skipBefore = frontMatterEnd(state.doc);
	const found: { from: number; to: number }[] = [];

	const lastLine = state.doc.lineAt(to).number;
	for (let lineNumber = state.doc.lineAt(from).number; lineNumber <= lastLine; lineNumber++) {
		const line = state.doc.line(lineNumber);
		if (line.to <= skipBefore) continue;

		for (const tag of findTags(line.text)) {
			const tagFrom = line.from + tag.from;
			if (isProtected(tree, tagFrom)) continue;
			found.push({ from: tagFrom, to: line.from + tag.to });
		}
	}

	return found;
}

export default (context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (codeMirrorWrapper: any) => {
			// This script only supports the CodeMirror 6 editor. `cm6` is
			// undefined when the legacy CodeMirror 5 editor loads it instead.
			if (!codeMirrorWrapper.cm6) return;

			const tagMark = Decoration.mark({ class: 'cm-inline-tag' });

			const buildDecorations = (view: any) => {
				const builder = new RangeSetBuilder();
				for (const range of view.visibleRanges) {
					for (const tag of findEditorTags(view.state, range.from, range.to)) {
						builder.add(tag.from, tag.to, tagMark);
					}
				}
				return builder.finish();
			};

			const tagHighlighter = ViewPlugin.fromClass(
				class {
					public decorations: any;

					public constructor(view: any) {
						this.decorations = buildDecorations(view);
					}

					public update(update: any) {
						// The syntax tree is parsed incrementally, so it can
						// change (and move a tag in or out of a code block)
						// without the document itself changing.
						const treeChanged = syntaxTree(update.startState) !== syntaxTree(update.state);
						if (update.docChanged || update.viewportChanged || treeChanged) {
							this.decorations = buildDecorations(update.view);
						}
					}
				},
				{ decorations: (plugin: any) => plugin.decorations },
			);

			// A tinted pill rather than colored text, so a tag stays
			// distinct from the heading colors set in userchrome.css. The
			// CSS variables are set by applyColors below when the matching
			// setting is filled in.
			const tagTheme = EditorView.baseTheme({
				'.cm-inline-tag': {
					borderRadius: '0.6em',
					padding: '0.05em 0.45em',
					fontSize: '0.9em',
					fontWeight: '500',
				},
				'&light .cm-inline-tag': {
					backgroundColor: 'var(--inline-tag-background, rgba(89, 190, 201, 0.22))',
					color: 'var(--inline-tag-color, #13294B)',
				},
				'&dark .cm-inline-tag': {
					backgroundColor: 'var(--inline-tag-background, rgba(89, 190, 201, 0.25))',
					color: 'var(--inline-tag-color, #BFE9EE)',
				},
			});

			codeMirrorWrapper.addExtension([tagHighlighter, tagTheme]);

			// Fetches the colors from the plugin's settings (index.ts) and
			// sets them on the editor. A blank or invalid color clears the
			// variable, which falls back to the theme's default.
			const applyColors = async () => {
				const colors = await context.postMessage({ name: 'getColors' });
				const style = codeMirrorWrapper.editor.dom.style;
				const variables: [string, string][] = [
					['--inline-tag-background', colors?.background],
					['--inline-tag-color', colors?.text],
				];

				for (const [variable, value] of variables) {
					const color = (value ?? '').trim();
					if (color && CSS.supports('color', color)) {
						style.setProperty(variable, color);
					} else {
						style.removeProperty(variable);
					}
				}
			};

			// Run by index.ts whenever a color setting changes.
			codeMirrorWrapper.registerCommand('inlineTagStyleRefreshColors', applyColors);
			void applyColors();
		},
	};
};
