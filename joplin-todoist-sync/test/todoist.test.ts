import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { HttpFetch, TodoistClient, TodoistError, toTaskInfo } from '../src/todoist';

// A fake `fetch` that answers from a list and records what was asked.
function fake(replies: Array<{ status: number; body: unknown } | Error>) {
	const calls: Array<{ url: string; headers: Record<string, string> }> = [];
	const httpFetch: HttpFetch = async (url, init) => {
		calls.push({ url, headers: init.headers });
		const reply = replies.shift();
		if (!reply) throw new Error('no reply left');
		if (reply instanceof Error) throw reply;
		return { status: reply.status, text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body)) };
	};
	return { httpFetch, calls };
}

const RAW = {
	id: '6XGgm6PHrGgMpCFX', content: 'Call the plumber', checked: false, priority: 4,
	due: { date: '2026-10-11', is_recurring: true, string: 'every day' },
	project_id: 'p1', labels: ['errand'], user_id: '123',
};

test('reduces a raw task to what the plugin needs', () => {
	assert.deepEqual(toTaskInfo(RAW), {
		id: '6XGgm6PHrGgMpCFX', content: 'Call the plumber', checked: false, priority: 4,
		due: { date: '2026-10-11', isRecurring: true }, projectId: 'p1', labels: ['errand'],
	});
	assert.equal(toTaskInfo({ id: 'x', content: 'No date', due: null }).due, null);
});

test('sends the token and the encoded filter', async () => {
	const { httpFetch, calls } = fake([{ status: 200, body: { results: [RAW], next_cursor: null } }]);
	const tasks = await new TodoistClient('secret', httpFetch).getTasksByFilter('today | #Work & @a b');
	assert.equal(tasks.length, 1);
	assert.equal(calls[0].headers.Authorization, 'Bearer secret');
	assert.equal(calls[0].url, 'https://api.todoist.com/api/v1/tasks/filter?query=today%20%7C%20%23Work%20%26%20%40a%20b&limit=200');
});

test('follows the cursor through every page', async () => {
	const { httpFetch, calls } = fake([
		{ status: 200, body: { results: [RAW], next_cursor: 'abc.def' } },
		{ status: 200, body: { results: [{ ...RAW, id: 'second' }], next_cursor: null } },
	]);
	const tasks = await new TodoistClient('secret', httpFetch).getTasksByFilter('today');
	assert.deepEqual(tasks.map(task => task.id), ['6XGgm6PHrGgMpCFX', 'second']);
	assert.ok(calls[1].url.endsWith('&cursor=abc.def'));
});

test('reads projects and marks the Inbox', async () => {
	const { httpFetch } = fake([{ status: 200, body: { results: [
		{ id: 'p0', name: 'Inbox', inbox_project: true },
		{ id: 'p1', name: 'Work' },
	], next_cursor: null } }]);
	assert.deepEqual(await new TodoistClient('secret', httpFetch).getProjects(), [
		{ id: 'p0', name: 'Inbox', isInbox: true },
		{ id: 'p1', name: 'Work', isInbox: false },
	]);
});

test('turns failures into messages that can be shown', async () => {
	const failure = async (reply: { status: number; body: unknown } | Error) => {
		const { httpFetch } = fake([reply]);
		try {
			await new TodoistClient('secret', httpFetch).getTasksByFilter('tody');
		} catch (error) {
			assert.ok(error instanceof TodoistError);
			return error;
		}
		throw new Error('expected a failure');
	};

	const badToken = await failure({ status: 401, body: 'Unauthorized' });
	assert.equal(badToken.status, 401);
	assert.match(badToken.message, /rejected the API token/);

	const badFilter = await failure({ status: 400, body: 'Bad Request' });
	assert.equal(badFilter.status, 400);
	assert.match(badFilter.message, /could not read the filter "tody"/);

	const offline = await failure(new Error('Failed to fetch'));
	assert.equal(offline.status, null);
	assert.match(offline.message, /Could not reach Todoist/);

	const garbage = await failure({ status: 200, body: '<html>' });
	assert.match(garbage.message, /could not be read/);
	// The token never appears in a message.
	for (const error of [badToken, badFilter, offline, garbage]) assert.ok(!error.message.includes('secret'));
});
