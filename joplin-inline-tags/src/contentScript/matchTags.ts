export interface Tag {
	id: string;
	title: string;
}

export interface TagMatch {
	tag: Tag;
	// Where the search text starts in the tag's title
	index: number;
}

// 0: the title starts with the search text
// 1: the search text starts a later word ("work/foo", "my-foo")
// 2: the search text is inside a word
const rankMatch = (title: string, index: number) => {
	if (index === 0) return 0;
	return /[\p{L}\p{N}]/u.test(title[index - 1]) ? 2 : 1;
};

// Case-insensitive match anywhere in the title, best matches first.
export const findMatchingTags = (tags: Tag[], searchText: string): TagMatch[] => {
	const needle = searchText.toLowerCase();

	const matches: (TagMatch & { rank: number })[] = [];
	for (const tag of tags) {
		const index = tag.title.toLowerCase().indexOf(needle);
		if (index < 0) continue;
		matches.push({ tag, index, rank: rankMatch(tag.title, index) });
	}

	matches.sort((a, b) => {
		return a.rank - b.rank || a.tag.title.localeCompare(b.tag.title, undefined, { sensitivity: 'base' });
	});
	return matches;
};

// Joplin treats tag titles as case-insensitive, so "Foo" exists when "foo" does.
export const tagExists = (tags: Tag[], name: string) => {
	const lowerName = name.toLowerCase();
	return tags.some(tag => tag.title.toLowerCase() === lowerName);
};
