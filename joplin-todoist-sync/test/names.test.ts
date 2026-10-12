import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { matchName } from '../src/names';
import { buildQuickAdd, cleanName, splitTokens } from '../src/sendText';

const LABELS = ['Joel Berger', 'Joel Ferber', 'errand', 'waiting_for'];
const PROJECTS = ['Inbox', 'Work', 'Home Reno', '📝 Templates', 'Workshop'];

test('an exact match wins over longer names', () => {
	assert.deepEqual(matchName('work', PROJECTS), { kind: 'match', name: 'Work' });
	assert.deepEqual(matchName('Joel', [...LABELS, 'Joel']), { kind: 'match', name: 'Joel' });
});

test('case, spaces, dashes and underscores are ignored', () => {
	for (const token of ['HomeReno', 'home-reno', 'Home Reno', 'home_reno']) {
		assert.deepEqual(matchName(token, PROJECTS), { kind: 'match', name: 'Home Reno' }, token);
	}
	assert.deepEqual(matchName('waitingfor', LABELS), { kind: 'match', name: 'waiting_for' });
});

test('a single name that starts with the token wins', () => {
	assert.deepEqual(matchName('Home', PROJECTS), { kind: 'match', name: 'Home Reno' });
	assert.deepEqual(matchName('err', LABELS), { kind: 'match', name: 'errand' });
});

test('then a single name that contains the token', () => {
	assert.deepEqual(matchName('Ferber', LABELS), { kind: 'match', name: 'Joel Ferber' });
	assert.deepEqual(matchName('templates', PROJECTS), { kind: 'match', name: '📝 Templates' });
});

test('more than one match at a step is ambiguous, never a guess', () => {
	assert.deepEqual(matchName('Joel', LABELS), { kind: 'ambiguous', candidates: ['Joel Berger', 'Joel Ferber'] });
	// Both names contain "ber" and neither starts with it.
	assert.deepEqual(matchName('ber', LABELS), { kind: 'ambiguous', candidates: ['Joel Berger', 'Joel Ferber'] });
});

test('two projects with the same name are ambiguous too', () => {
	assert.deepEqual(matchName('Admin', ['Admin', 'Work', 'Admin']), { kind: 'ambiguous', candidates: ['Admin', 'Admin'] });
	assert.deepEqual(matchName('adm', ['Admin', 'Work', 'Admin']), { kind: 'ambiguous', candidates: ['Admin', 'Admin'] });
});

test('no match, and an empty token', () => {
	assert.deepEqual(matchName('nothing', LABELS), { kind: 'none' });
	assert.deepEqual(matchName('--', LABELS), { kind: 'none' });
});

test('splits tokens out of a name', () => {
	assert.deepEqual(splitTokens('Send the budget #Q4 ##work @@joel tomorrow p1'), {
		text: 'Send the budget #Q4 tomorrow p1',
		projectTokens: ['work'],
		labelTokens: ['joel'],
	});
});

test('a backslash before a space keeps a token going', () => {
	assert.deepEqual(splitTokens('My task ##Home\\ Reno @@Joel\\ Berger @@errand'), {
		text: 'My task',
		projectTokens: ['Home Reno'],
		labelTokens: ['Joel Berger', 'errand'],
	});
});

test('single marks and marks inside a word are not tokens', () => {
	const name = 'Email a@@b about C## and #tag @joel';
	assert.deepEqual(splitTokens(name), { text: name, projectTokens: [], labelTokens: [] });
});

test('a plain name needs one call', () => {
	assert.deepEqual(buildQuickAdd('Call the plumber tomorrow p1', null, []), {
		text: 'Call the plumber tomorrow p1',
		needsRename: false,
	});
});

test('project and labels are passed in Todoist syntax with spaces escaped', () => {
	assert.deepEqual(buildQuickAdd('Send the budget tomorrow', 'Home Reno', ['Joel Berger', 'errand']), {
		text: 'Send the budget tomorrow #Home\\ Reno @Joel\\ Berger @errand',
		needsRename: false,
	});
});

test('a single # or @ is escaped, and the name is cleaned afterwards', () => {
	const built = buildQuickAdd('Send #Q4 numbers to @joel re C# tomorrow', 'Work', []);
	assert.equal(built.text, 'Send \\#Q4 numbers to \\@joel re C# tomorrow #Work');
	assert.equal(built.needsRename, true);
	// Todoist strips "tomorrow" and "#Work" and keeps the escaped words.
	assert.equal(cleanName('Send \\#Q4 numbers to \\@joel re C#'), 'Send #Q4 numbers to @joel re C#');
});
