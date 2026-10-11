// Turns the name of an unlinked checkbox line into the text sent to
// Todoist's quick add (SPEC.md sections 3.5 and 9.1, item 1).

export interface SendTokens {
	// The name with every `##` and `@@` token removed.
	text: string;
	// What was typed after each `##`, with `\ ` turned back into a space.
	projectTokens: string[];
	// What was typed after each `@@`.
	labelTokens: string[];
}

// A token starts at `##` or `@@` after whitespace or at the start of the
// name, and runs to the next space. A backslash before a space keeps it
// going, as in Todoist.
const TOKEN = /(?<!\S)(##|@@)((?:\\ |\S)+)/g;

// Splits a line's name into plain text and its `##` / `@@` tokens.
export function splitTokens(name: string): SendTokens {
	const projectTokens: string[] = [];
	const labelTokens: string[] = [];

	const text = name.replace(TOKEN, (_whole, mark: string, value: string) => {
		const token = value.replace(/\\ /g, ' ');
		if (mark === '##') projectTokens.push(token);
		else labelTokens.push(token);
		return '';
	});

	return {
		text: text.replace(/\s+/g, ' ').trim(),
		projectTokens,
		labelTokens,
	};
}

export interface QuickAddText {
	// The text for the quick add call.
	text: string;
	// True when a `#` or `@` in the name had to be escaped. The backslashes
	// stay in the task name Todoist creates, so the task then needs one
	// update call with `cleanName()` of that name.
	needsRename: boolean;
}

// A `#` or `@` at the start of a word is what quick add reads as a project
// or label.
const SINGLE_MARK = /(?<!\S)([#@])(?=\S)/g;

function escapeName(name: string): string {
	return name.replace(/ /g, '\\ ');
}

// Builds the quick add text. `text` is the name without tokens, and the
// project and label names are exact Todoist names, already matched. A
// single `#` or `@` in the name belongs to Joplin, so it is escaped to
// stop quick add from reading it.
export function buildQuickAdd(text: string, projectName: string | null, labelNames: string[]): QuickAddText {
	const escaped = text.replace(SINGLE_MARK, '\\$1');
	const parts = [escaped];
	if (projectName) parts.push(`#${escapeName(projectName)}`);
	for (const label of labelNames) parts.push(`@${escapeName(label)}`);

	return {
		text: parts.join(' '),
		needsRename: escaped !== text,
	};
}

// Removes the backslashes `buildQuickAdd()` added from the name Todoist
// gave the new task.
export function cleanName(name: string): string {
	return name.replace(/(?<!\S)\\([#@])(?=\S)/g, '$1');
}
