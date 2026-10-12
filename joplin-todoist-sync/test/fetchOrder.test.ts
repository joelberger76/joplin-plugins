import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { projectRanks, sortForNote } from '../src/fetchOrder';
import { TaskInfo } from '../src/types';

const PROJECTS = [
	{ id: 'home', isInbox: false, parentId: null, order: 2 },
	{ id: 'work', isInbox: false, parentId: null, order: 1 },
	{ id: 'inbox', isInbox: true, parentId: null, order: 9 },
	{ id: 'work-q4', isInbox: false, parentId: 'work', order: 1 },
];

function task(id: string, projectId: string, order: number, more: Partial<TaskInfo> = {}): TaskInfo {
	return { id, content: id, checked: false, priority: 1, due: null, projectId, labels: [], order, ...more };
}

const idsOf = (tasks: TaskInfo[]) => tasks.map(item => item.id);

test('projects rank as the sidebar lists them: Inbox, then each with its sub-projects', () => {
	const ranks = projectRanks(PROJECTS);
	const order = PROJECTS.map(project => project.id).sort((a, b) => ranks.get(a)! - ranks.get(b)!);
	assert.deepEqual(order, ['inbox', 'work', 'work-q4', 'home']);
});

test('tasks are grouped by project, then ordered as arranged in the project', () => {
	const sorted = sortForNote([
		task('h2', 'home', 2),
		task('w2', 'work', 2),
		task('i1', 'inbox', 1),
		task('q1', 'work-q4', 1),
		task('h1', 'home', 1),
		task('w1', 'work', 1),
	], PROJECTS, new Map());
	assert.deepEqual(idsOf(sorted), ['i1', 'w1', 'w2', 'q1', 'h1', 'h2']);
});

test('tasks outside a section come first, then each section in turn', () => {
	const sections = new Map([['later', 2], ['now', 1]]);
	const sorted = sortForNote([
		task('later-1', 'work', 1, { sectionId: 'later' }),
		task('now-2', 'work', 2, { sectionId: 'now' }),
		task('loose', 'work', 5),
		task('now-1', 'work', 1, { sectionId: 'now' }),
	], PROJECTS, sections);
	assert.deepEqual(idsOf(sorted), ['loose', 'now-1', 'now-2', 'later-1']);
});

test('a subtask follows its parent, and is a task of its own when the parent was not fetched', () => {
	const sorted = sortForNote([
		task('b', 'work', 2),
		task('a-2', 'work', 2, { parentId: 'a' }),
		task('orphan', 'work', 1, { parentId: 'not-fetched' }),
		task('a', 'work', 1),
		task('a-1', 'work', 1, { parentId: 'a' }),
		task('a-1-x', 'work', 1, { parentId: 'a-1' }),
	], PROJECTS, new Map());
	assert.deepEqual(idsOf(sorted), ['orphan', 'a', 'a-1', 'a-1-x', 'a-2', 'b']);
});

test('ties, unknown projects and tasks with no order keep the order they came in', () => {
	const plain = (id: string, projectId: string): TaskInfo => ({ id, content: id, checked: false, priority: 1, due: null, projectId, labels: [] });
	const sorted = sortForNote([plain('x', 'gone'), plain('b', 'work'), plain('y', 'gone'), plain('a', 'work')], PROJECTS, new Map());
	assert.deepEqual(idsOf(sorted), ['b', 'a', 'x', 'y']);
	assert.deepEqual(idsOf(sortForNote([plain('b', 'p'), plain('a', 'p')], [], new Map())), ['b', 'a']);
});

test('nothing is lost when tasks name each other as parent', () => {
	const sorted = sortForNote([task('a', 'work', 1, { parentId: 'b' }), task('b', 'work', 1, { parentId: 'a' })], PROJECTS, new Map());
	assert.deepEqual(idsOf(sorted).sort(), ['a', 'b']);
});
