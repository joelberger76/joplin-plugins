// markdown-it content script.
//
// Takes inline #tags out of the rendered note. A tag that trails a line
// ("AIDLC Readout #Project/AIDLC") is hidden. A tag that is part of a
// sentence ("#Person/Juan-Gutierrez to draft the framework") is shown as
// plain words instead ("Juan Gutierrez to draft the framework").
//
// Either way the tag is wrapped in <span class="inline-tag">, which
// viewerTags.css hides, rather than being removed. That way it survives a
// round trip through the Rich Text editor, and userstyle.css can show it
// again.
//
// Code, link targets and HTML are separate markdown-it tokens (or token
// attributes) rather than text, so tags inside them are skipped for free.
import { findTags, tagLabel } from './tags';

// One piece of a block's inline content, after tags have been split out.
//   tag       an inline #tag
//   separator a comma between two tags
//   space     whitespace
//   break     a line break
//   other     anything else, i.e. content the reader should see
interface Piece {
	kind: 'tag' | 'separator' | 'space' | 'break' | 'other';
	tokens: any[];
	// How the piece is rendered: as is, hidden, or (tags only) as words.
	show: 'asIs' | 'hidden' | 'label';
}

// Text that opens with a symbol or emoji, such as the "⏱️ 08:30-09:00"
// that ends a meeting heading, is metadata rather than a continuation of
// the sentence.
const startsWithSymbol = /^\s*[\p{S}\p{Extended_Pictographic}]/u;

// Returns the number of source lines taken up by YAML front matter, or 0
// if the note has none.
function frontMatterLines(src: string): number {
	const lines = src.split('\n');
	if (lines[0] !== '---') return 0;

	const closing = lines.indexOf('---', 1);
	return closing === -1 ? 0 : closing + 1;
}

function splitChildren(state: any, children: any[]): Piece[] {
	const pieces: Piece[] = [];
	const textToken = (content: string) => {
		const token = new state.Token('text', '', 0);
		token.content = content;
		return token;
	};
	const textPiece = (token: any, afterTag: boolean, beforeTag: boolean): Piece => {
		const text: string = token.content;
		let kind: Piece['kind'] = 'other';
		if (!text.trim()) kind = 'space';
		else if (afterTag && beforeTag && /^\s*,\s*$/.test(text)) kind = 'separator';
		return { kind, tokens: [token], show: 'asIs' };
	};

	// Whether the next text token starts at a word boundary. Text that
	// directly follows other inline content does not, e.g. "**bold**#tag".
	let atBoundary = true;

	for (const child of children) {
		if (child.type === 'softbreak' || child.type === 'hardbreak') {
			pieces.push({ kind: 'break', tokens: [child], show: 'asIs' });
			atBoundary = true;
			continue;
		}

		if (child.type !== 'text') {
			pieces.push({ kind: 'other', tokens: [child], show: 'asIs' });
			atBoundary = false;
			continue;
		}

		const text: string = child.content;
		const tags = findTags(text, atBoundary);
		if (text) atBoundary = /\s$/.test(text);

		if (!tags.length) {
			pieces.push(textPiece(child, false, false));
			continue;
		}

		let position = 0;
		tags.forEach((tag, index) => {
			const before = text.slice(position, tag.from);
			if (before) pieces.push(textPiece(textToken(before), index > 0, true));
			pieces.push({ kind: 'tag', tokens: [textToken(text.slice(tag.from, tag.to))], show: 'hidden' });
			position = tag.to;
		});

		const rest = text.slice(position);
		if (rest) pieces.push(textPiece(textToken(rest), true, false));
	}

	return pieces;
}

// Splits the pieces into lines, leaving out the breaks between them.
function splitLines(pieces: Piece[]): Piece[][] {
	const lines: Piece[][] = [[]];
	for (const piece of pieces) {
		if (piece.kind === 'break') lines.push([]);
		else lines[lines.length - 1].push(piece);
	}
	return lines;
}

// Decides, for a block that has other content besides tags, which tags
// are part of a sentence and so are shown as words.
function showSentenceTags(pieces: Piece[]) {
	const breaks = pieces.filter(piece => piece.kind === 'break');

	splitLines(pieces).forEach((line, lineIndex) => {
		line.forEach((piece, index) => {
			if (piece.kind !== 'tag') return;

			// A tag is part of a sentence when more of the sentence
			// follows it on the same line.
			const next = line.slice(index + 1).find(later => later.kind === 'other');
			if (!next) return;

			const token = next.tokens[0];
			if (token.type === 'text' && startsWithSymbol.test(token.content)) return;

			piece.show = 'label';
		});

		// A line left with nothing but hidden tags would show as a blank
		// line, so the line break next to it is hidden too.
		const hasTags = line.some(piece => piece.kind === 'tag');
		const hasContent = line.some(piece => piece.kind === 'other');
		if (hasTags && !hasContent) {
			const lineBreak = breaks[lineIndex] ?? breaks[lineIndex - 1];
			if (lineBreak) lineBreak.show = 'hidden';
		}
	});
}

// A comma between two tags is hidden when both of them are.
function hideSeparators(pieces: Piece[]) {
	pieces.forEach((piece, index) => {
		if (piece.kind !== 'separator') return;
		const bothHidden = pieces[index - 1]?.show === 'hidden' && pieces[index + 1]?.show === 'hidden';
		if (bothHidden) piece.show = 'hidden';
	});
}

function renderPieces(state: any, pieces: Piece[]): any[] {
	const children: any[] = [];

	for (const piece of pieces) {
		if (piece.show === 'asIs') {
			children.push(...piece.tokens);
			continue;
		}

		const open = new state.Token('inline_tag_open', 'span', 1);
		open.attrSet('class', 'inline-tag');
		const hidden = [open, ...piece.tokens, new state.Token('inline_tag_close', 'span', -1)];

		if (piece.show === 'hidden') {
			children.push(...hidden);
			continue;
		}

		const labelOpen = new state.Token('inline_tag_label_open', 'span', 1);
		labelOpen.attrSet('class', 'inline-tag-label');
		labelOpen.attrSet('data-label', tagLabel(piece.tokens[0].content));
		children.push(labelOpen, ...hidden, new state.Token('inline_tag_label_close', 'span', -1));
	}

	return children;
}

function styleTags(state: any) {
	const skipLines = frontMatterLines(state.src);
	const tokens = state.tokens;

	for (let i = 0; i < tokens.length; i++) {
		const token = tokens[i];
		if (token.type !== 'inline' || !token.children) continue;
		if (token.map && token.map[0] < skipLines) continue;

		const pieces = splitChildren(state, token.children);
		const tags = pieces.filter(piece => piece.kind === 'tag');
		if (!tags.length) continue;

		if (pieces.some(piece => piece.kind === 'other')) {
			showSentenceTags(pieces);
		} else {
			// The whole block is nothing but tags.
			const open = tokens[i - 1];
			const isOnlyChildOfListItem = tokens[i - 2]?.type === 'list_item_open' && tokens[i + 2]?.type === 'list_item_close';

			if (open?.type === 'paragraph_open' && !isOnlyChildOfListItem) {
				// Hidden whole, so that it leaves no gap.
				open.attrJoin('class', 'inline-tags-only');
			} else if (open?.type === 'heading_open' || isOnlyChildOfListItem) {
				// Hiding the tags would leave an empty heading or a bare
				// bullet, so they are shown as words instead.
				for (const tag of tags) tag.show = 'label';
			}
		}

		hideSeparators(pieces);
		token.children = renderPieces(state, pieces);
	}
}

export default (_context: { contentScriptId: string; postMessage: any }) => {
	return {
		plugin: (markdownIt: any) => {
			markdownIt.core.ruler.after('inline', 'inline_tag_style', styleTags);
		},
		assets: () => [{ name: 'viewerTags.css' }],
	};
};
