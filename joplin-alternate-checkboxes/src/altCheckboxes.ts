// Renderer content script: turns "- [<char>] text" list items into list items
// carrying class "alt-checkbox" and a data-task="<char>" attribute, and removes
// the "[<char>] " marker from the visible text. altCheckboxes.css draws the icon.
//
// Only the characters listed in taskTypes.json are handled, so ordinary text
// such as "- [1] footnote" is left alone. "[ ]" and "[x]" stay with Joplin's
// built-in checkbox rule.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const taskTypes: Record<string, { label: string }> = require('./taskTypes.json');

const MARKER = /^\[(.)\](?:[ \t]+|$)/;

// Removes the first `length` characters from the leading text tokens of an
// inline token. Returns false, changing nothing, if those characters are not
// all plain text (for example when "*" was parsed as emphasis).
function stripLeadingText(children: any[], length: number): boolean {
	let remaining = length;
	let count = 0;
	for (const child of children) {
		if (remaining <= 0) break;
		if (child.type !== 'text') return false;
		remaining -= child.content.length;
		count++;
	}
	if (remaining > 0) return false;

	remaining = length;
	for (let i = 0; i < count; i++) {
		const child = children[i];
		const take = Math.min(remaining, child.content.length);
		child.content = child.content.slice(take);
		remaining -= take;
	}
	return true;
}

function altCheckboxRule(state: any) {
	const tokens = state.tokens;
	for (let i = 2; i < tokens.length; i++) {
		const inline = tokens[i];
		if (inline.type !== 'inline' || !inline.children) continue;
		if (tokens[i - 1].type !== 'paragraph_open') continue;

		const item = tokens[i - 2];
		if (item.type !== 'list_item_open') continue;
		// Bullet lists only: ordered list items have markup "." or ")".
		if (item.markup === '.' || item.markup === ')') continue;

		const match = MARKER.exec(inline.content);
		if (!match) continue;
		const char = match[1];
		if (!Object.prototype.hasOwnProperty.call(taskTypes, char)) continue;

		if (!stripLeadingText(inline.children, match[0].length)) continue;

		item.attrJoin('class', 'alt-checkbox');
		item.attrSet('data-task', char);
		item.attrSet('title', taskTypes[char].label);
	}
	return false;
}

export default function() {
	return {
		plugin: function(markdownIt: any) {
			markdownIt.core.ruler.push('alternate_checkboxes', altCheckboxRule);
		},
		assets: function() {
			return [{ name: 'altCheckboxes.css' }];
		},
	};
}
