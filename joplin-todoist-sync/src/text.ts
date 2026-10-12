// Small text helpers shared by the modules. Nothing here depends on Joplin.

// "1 task", "2 tasks".
export function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Two digits, for dates and times.
export function pad(value: number): string {
	return String(value).padStart(2, '0');
}

// Safe as HTML text and inside a double-quoted attribute.
export function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
