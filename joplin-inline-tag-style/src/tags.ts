// Shared inline tag matching, used by both the editor and the viewer
// content scripts so they always agree on what counts as a tag.
//
// The pattern mirrors INLINE_TAG in the joplin-tag-sync skill: a "#" at the
// start of the text or after whitespace, running up to the next space or
// punctuation mark. "## Heading" never matches, because the first "#" is
// followed by another "#" and the second one is not preceded by whitespace.
const TAG_PATTERN = /(?<!\S)#([^\s#'",.()\[\]:;!?\\<>]+)/g;

export interface TagRange {
	from: number;
	to: number;
}

// Single characters and plain numbers ("Phone #s", "see #2") are almost
// always prose rather than tags, so they are left alone.
function isTagName(name: string): boolean {
	return name.length > 1 && !/^\d+$/.test(name);
}

// Returns the range of every tag in `text`, "#" included.
//
// `startsAtBoundary` says whether the start of `text` counts as a word
// boundary. It is false when the text is a fragment that directly follows
// other content, e.g. the "#tag" in "**bold**#tag".
export function findTags(text: string, startsAtBoundary = true): TagRange[] {
	const tags: TagRange[] = [];
	TAG_PATTERN.lastIndex = 0;

	let match: RegExpExecArray | null;
	while ((match = TAG_PATTERN.exec(text))) {
		if (match.index === 0 && !startsAtBoundary) continue;
		if (!isTagName(match[1])) continue;
		tags.push({ from: match.index, to: match.index + match[0].length });
	}

	return tags;
}

// Turns a tag into the words shown in its place in the rendered note: the
// last segment of the tag, with dashes and underscores as spaces.
// "#Person/Juan-Gutierrez" becomes "Juan Gutierrez".
export function tagLabel(tag: string): string {
	const name = tag.replace(/^#/, '');
	const lastSegment = name.split('/').filter(Boolean).pop() ?? name;
	return lastSegment.replace(/[-_]+/g, ' ').trim() || name;
}
