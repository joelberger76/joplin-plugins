// CodeMirror 6 content script.
//
// Finds the heading at or above the cursor and returns its plain-text
// content plus the anchor slug Joplin's own renderer would assign it, so
// the main process (index.ts) can build a Markdown link to it.
//
// The slug is computed with @joplin/fork-uslug, the same slugify package
// Joplin's renderer (@joplin/renderer) uses for markdown-it-anchor, so the
// id matches what the note preview actually assigns to the heading. Headings
// are scanned in document order and deduplicated the same way
// markdown-it-anchor does by default: the first occurrence of a slug is
// left bare, and each later occurrence gets "-1", "-2", etc. appended,
// skipping any suffix already taken by another heading's own text.
//
// Only ATX headings ("#" through "######") are recognized; Setext-style
// ("Heading\n===") headings are not. Common inline Markdown (bold, italic,
// inline code, links) is stripped from heading text before slugifying, to
// approximate the plain text markdown-it would render, but this is not a
// full CommonMark inline parser.
const uslug = require('@joplin/fork-uslug') as (input: string) => string;

interface HeadingInfo {
	line: number;
	text: string;
}

function stripInlineMarkdown(text: string): string {
	return text
		.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/\*([^*]+)\*/g, '$1')
		.replace(/_([^_]+)_/g, '$1')
		.replace(/~~([^~]+)~~/g, '$1')
		.replace(/\s+/g, ' ')
		.trim();
}

// Collects every ATX heading in the document, in order, skipping lines
// inside fenced code blocks so a "#" comment in a code sample isn't
// mistaken for a heading.
function collectHeadings(doc: { lines: number; line: (n: number) => { text: string } }): HeadingInfo[] {
	const headings: HeadingInfo[] = [];
	let fenceMarker = '';

	for (let lineNumber = 1; lineNumber <= doc.lines; lineNumber++) {
		const lineText = doc.line(lineNumber).text;

		const fenceMatch = lineText.match(/^ {0,3}(`{3,}|~{3,})/);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (!fenceMarker) {
				fenceMarker = marker;
			} else if (marker[0] === fenceMarker[0] && marker.length >= fenceMarker.length) {
				fenceMarker = '';
			}
			continue;
		}
		if (fenceMarker) continue;

		const headingMatch = lineText.match(/^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/);
		if (!headingMatch) continue;

		const rawContent = (headingMatch[2] || '').replace(/(?:^|[ \t])#+[ \t]*$/, '');
		headings.push({ line: lineNumber, text: stripInlineMarkdown(rawContent) });
	}

	return headings;
}

// Assigns each heading its final anchor slug, replicating markdown-it-anchor's
// default duplicate-handling: first occurrence of a slug is left bare, later
// occurrences get "-1", "-2", ... appended until a free slug is found.
function assignSlugs(headings: HeadingInfo[]): string[] {
	const used = new Set<string>();
	const slugs: string[] = [];

	for (const heading of headings) {
		const base = uslug(heading.text);
		let slug = base;
		if (used.has(slug)) {
			let i = 1;
			slug = `${base}-${i}`;
			while (used.has(slug)) {
				i++;
				slug = `${base}-${i}`;
			}
		}
		used.add(slug);
		slugs.push(slug);
	}

	return slugs;
}

export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (codeMirrorWrapper: any) => {
			// This script only supports the CodeMirror 6 editor. `cm6` is
			// undefined when the legacy CodeMirror 5 editor loads it instead.
			if (!codeMirrorWrapper.cm6) return;

			codeMirrorWrapper.registerCommand('copyHeadingLink', (): { headingText: string; slug: string } | null => {
				const view = codeMirrorWrapper.editor;
				const state = view.state;
				const doc = state.doc;
				const cursorLine = doc.lineAt(state.selection.main.head).number;

				const headings = collectHeadings(doc);

				let targetIndex = -1;
				for (let i = 0; i < headings.length; i++) {
					if (headings[i].line <= cursorLine) targetIndex = i;
					else break;
				}
				if (targetIndex === -1) return null;

				const slugs = assignSlugs(headings);
				return { headingText: headings[targetIndex].text, slug: slugs[targetIndex] };
			});
		},
	};
};
