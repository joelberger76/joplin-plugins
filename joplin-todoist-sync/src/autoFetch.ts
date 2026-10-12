// The decisions behind the automatic first fetch (SPEC.md section 5.3):
// whether a note has a query block waiting for it, and whether the note is
// a template, which is never fetched automatically.

import { parseNote } from './noteParser';

// Whether the note has a query block that has never run and can be: no
// `fetched:` line, and a filter of its own or the default one.
export function hasBlockToFetch(body: string, defaultFilter: string): boolean {
	return parseNote(body).queryBlocks.some(block => block.fetched === null && !!(block.filter || defaultFilter));
}

// The names in a setting that lists several, separated by commas.
export function namesIn(setting: string): string[] {
	return setting.split(',').map(name => name.trim().toLowerCase()).filter(name => name !== '');
}

// A note is a template when its notebook, or any notebook above it, is a
// template notebook, or when it carries the template tag. These are the
// two ways the Templates plugin marks its templates. Case is ignored.
// - `notebooks`: the titles of the note's notebook and of every notebook above it
// - `tags`: the titles of the note's tags
export function isTemplate(notebooks: string[], tags: string[], templateNotebooks: string, templateTags: string): boolean {
	const has = (titles: string[], wanted: string[]) => titles.some(title => wanted.includes(title.trim().toLowerCase()));
	return has(notebooks, namesIn(templateNotebooks)) || has(tags, namesIn(templateTags));
}

// Whether the editor shows this text. Only the line endings may differ,
// because the editor always uses "\n".
export function sameText(editorBody: string, noteBody: string): boolean {
	return editorBody === noteBody.replace(/\r\n?/g, '\n');
}
