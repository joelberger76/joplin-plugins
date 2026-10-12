import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { hasBlockToFetch, isTemplate, namesIn, sameText } from '../src/autoFetch';

const block = (...lines: string[]) => ['# Journal', '```todoist', ...lines, '```', 'Text'].join('\n');

test('a block with a filter and no fetched line is waiting', () => {
	assert.equal(hasBlockToFetch(block('filter: today | overdue'), ''), true);
});

test('a block that has run, has no filter, or is not a todoist block is not waiting', () => {
	assert.equal(hasBlockToFetch(block('filter: today', 'fetched: 2026-10-12 08:31'), 'today'), false);
	assert.equal(hasBlockToFetch(block('note: no filter here'), ''), false);
	assert.equal(hasBlockToFetch('```\nfilter: today\n```', 'today'), false);
	assert.equal(hasBlockToFetch('No block at all', 'today'), false);
});

test('a block with no filter is waiting only when there is a default filter', () => {
	assert.equal(hasBlockToFetch(block(), 'today | overdue'), true);
	assert.equal(hasBlockToFetch(block('filter:'), 'today | overdue'), true);
	assert.equal(hasBlockToFetch(block(), ''), false);
	assert.equal(hasBlockToFetch(block('fetched: 2026-10-12 08:31'), 'today'), false);
});

test('one waiting block among fetched ones is enough', () => {
	const body = [block('filter: today', 'fetched: 2026-10-12 08:31'), block('filter: #Work')].join('\n');
	assert.equal(hasBlockToFetch(body, ''), true);
});

test('a setting can list several names', () => {
	assert.deepEqual(namesIn(' Templates, Journal Templates ,,'), ['templates', 'journal templates']);
	assert.deepEqual(namesIn(''), []);
});

test('a note in a template notebook, or under one, is a template', () => {
	assert.equal(isTemplate(['Templates'], [], 'Templates', 'template'), true);
	assert.equal(isTemplate(['Daily', 'templates', 'Home'], [], 'Templates', 'template'), true);
	assert.equal(isTemplate(['Journal', 'Home'], [], 'Templates', 'template'), false);
});

test('a note with the template tag is a template', () => {
	assert.equal(isTemplate(['Journal'], ['work', 'Template'], 'Templates', 'template'), true);
	assert.equal(isTemplate(['Journal'], ['work'], 'Templates', 'template'), false);
});

test('an empty setting turns its check off', () => {
	assert.equal(isTemplate(['Templates'], ['template'], '', ''), false);
	assert.equal(isTemplate(['Templates'], [], '', 'template'), false);
});

test('the editor text matches the note apart from line endings', () => {
	assert.equal(sameText('a\nb', 'a\r\nb'), true);
	assert.equal(sameText('a\nb', 'a\nb'), true);
	assert.equal(sameText('a\nb typed', 'a\nb'), false);
});
