// A small client for the Todoist API v1. It takes the `fetch` function as a
// parameter so it can be tested in Node without the network.

import { TaskState } from './syncRules';
import { TaskInfo } from './types';

const BASE = 'https://api.todoist.com/api/v1';
const PAGE_SIZE = 200;
// A guard against a paging loop that never ends: 50 pages is 10,000 items.
const MAX_PAGES = 50;
// How many task ids go into one `ids=` request, and how many single-task
// requests run at the same time.
const IDS_PER_REQUEST = 100;
const LOOKUPS_AT_ONCE = 5;

export interface HttpResponse {
	status: number;
	text(): Promise<string>;
}

export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface Project {
	id: string;
	name: string;
	isInbox: boolean;
	// The project above it, and its position among those with the same
	// parent.
	parentId: string | null;
	order: number;
}

// An error with a message that can be shown to the user as it is.
export class TodoistError extends Error {
	// The HTTP status, or null when Todoist could not be reached at all.
	public status: number | null;

	public constructor(message: string, status: number | null) {
		super(message);
		this.name = 'TodoistError';
		this.status = status;
	}
}

// Reduces a task as the API returns it to what the plugin needs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
export function toTaskInfo(raw: any): TaskInfo {
	return {
		id: String(raw.id),
		content: String(raw.content ?? ''),
		checked: !!raw.checked,
		priority: Number(raw.priority ?? 1),
		due: raw.due && raw.due.date
			? { date: String(raw.due.date), isRecurring: !!raw.due.is_recurring }
			: null,
		projectId: String(raw.project_id ?? ''),
		labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
		sectionId: raw.section_id ? String(raw.section_id) : null,
		parentId: raw.parent_id ? String(raw.parent_id) : null,
		order: Number(raw.child_order ?? raw.order ?? 0),
	};
}

export class TodoistClient {
	private token: string;
	private httpFetch: HttpFetch;

	public constructor(token: string, httpFetch: HttpFetch) {
		this.token = token;
		this.httpFetch = httpFetch;
	}

	// Sends one request and returns the reply, whatever its status. Only a
	// rejected token and an unreachable server are turned into errors here.
	private async send(method: string, path: string, what: string, body?: unknown): Promise<{ status: number; text: string }> {
		let response: HttpResponse;
		try {
			const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
			if (body !== undefined) headers['Content-Type'] = 'application/json';
			response = await this.httpFetch(BASE + path, {
				method,
				headers,
				...(body !== undefined ? { body: JSON.stringify(body) } : {}),
			});
		} catch (error) {
			throw new TodoistError(`Could not reach Todoist (${what}). Check your connection.`, null);
		}

		const text = await response.text();

		if (response.status === 401 || response.status === 403) {
			throw new TodoistError('Todoist rejected the API token. Check it in the Todoist Sync settings.', response.status);
		}
		return { status: response.status, text };
	}

	private failure(reply: { status: number; text: string }, what: string): TodoistError {
		return new TodoistError(`Todoist returned an error (${what}, status ${reply.status}): ${reply.text.slice(0, 200)}`, reply.status);
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
	private parse(reply: { status: number; text: string }, what: string): any {
		try {
			return JSON.parse(reply.text);
		} catch (error) {
			throw new TodoistError(`Todoist sent a reply that could not be read (${what}).`, reply.status);
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
	private async get(path: string, what: string): Promise<any> {
		const reply = await this.send('GET', path, what);
		if (reply.status < 200 || reply.status >= 300) throw this.failure(reply, what);
		return this.parse(reply, what);
	}

	// Sends `body` as JSON and returns the task in the reply.
	private async postForTask(path: string, body: unknown, what: string): Promise<TaskInfo> {
		const reply = await this.send('POST', path, what, body);
		if (reply.status < 200 || reply.status >= 300) throw this.failure(reply, what);
		return toTaskInfo(this.parse(reply, what));
	}

	// Follows `next_cursor` until every page has been read.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
	private async getAll(path: string, what: string): Promise<any[]> {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
		const items: any[] = [];
		let cursor: string | null = null;

		for (let page = 0; page < MAX_PAGES; page++) {
			const separator = path.includes('?') ? '&' : '?';
			const cursorPart: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
			const data = await this.get(`${path}${separator}limit=${PAGE_SIZE}${cursorPart}`, what);
			if (Array.isArray(data.results)) items.push(...data.results);
			cursor = data.next_cursor || null;
			if (!cursor) break;
		}

		return items;
	}

	// The open tasks matching a Todoist filter query.
	public async getTasksByFilter(query: string): Promise<TaskInfo[]> {
		try {
			const raw = await this.getAll(`/tasks/filter?query=${encodeURIComponent(query)}`, 'fetching tasks');
			return raw.map(toTaskInfo);
		} catch (error) {
			if (error instanceof TodoistError && error.status === 400) {
				throw new TodoistError(`Todoist could not read the filter "${query}".`, 400);
			}
			throw error;
		}
	}

	public async getProjects(): Promise<Project[]> {
		const raw = await this.getAll('/projects', 'fetching projects');
		return raw.map(project => ({
			id: String(project.id),
			name: String(project.name ?? ''),
			isInbox: !!project.inbox_project,
			parentId: project.parent_id ? String(project.parent_id) : null,
			order: Number(project.child_order ?? project.order ?? 0),
		}));
	}

	// The place of every section among all sections, by section id.
	// Sections can share a `section_order` (two made through the API both
	// got 1, seen on 2026-10-12), so those keep the order Todoist lists
	// them in.
	public async getSectionOrder(): Promise<Map<string, number>> {
		const raw = await this.getAll('/sections', 'fetching sections');
		const sorted = raw
			.map((section, index) => ({ id: String(section.id), order: Number(section.section_order ?? section.order ?? 0), index }))
			.sort((a, b) => a.order - b.order || a.index - b.index);
		return new Map(sorted.map((section, rank) => [section.id, rank] as [string, number]));
	}

	// The names of the account's labels.
	public async getLabels(): Promise<string[]> {
		const raw = await this.getAll('/labels', 'fetching labels');
		return raw.map(label => String(label.name ?? ''));
	}

	// Creates a task from text in Todoist's quick add syntax, which reads
	// dates, priority, `#project` and `@label` out of it.
	public async quickAdd(text: string): Promise<TaskInfo> {
		return await this.postForTask('/tasks/quick', { text }, 'creating a task');
	}

	// Sets a task's name. Unlike quick add, this leaves `#` and `@` in the
	// name as plain text (SPEC.md section 9.1, item 1).
	public async renameTask(id: string, content: string): Promise<TaskInfo> {
		return await this.postForTask(`/tasks/${encodeURIComponent(id)}`, { content }, 'naming a task');
	}

	// Makes a task a subtask of another. It moves to the parent's project.
	public async moveUnder(id: string, parentId: string): Promise<TaskInfo> {
		return await this.postForTask(`/tasks/${encodeURIComponent(id)}/move`, { parent_id: parentId }, 'moving a task under its parent');
	}

	// One task by id, completed or not. Returns null when Todoist has no
	// such task: it was deleted, it belongs to another account, or the id
	// is not one Todoist can read (400), as with a mistyped link.
	public async getTask(id: string): Promise<TaskInfo | null> {
		const what = 'looking up a task';
		const reply = await this.send('GET', `/tasks/${encodeURIComponent(id)}`, what);
		if (reply.status === 404 || reply.status === 400) return null;
		if (reply.status < 200 || reply.status >= 300) throw this.failure(reply, what);
		return toTaskInfo(this.parse(reply, what));
	}

	// What Todoist knows about each of `ids`. The `ids=` request returns
	// only open tasks, so every id it leaves out is asked for by itself:
	// that finds the completed ones, and the rest are missing (SPEC.md
	// section 9.1, item 2). If Todoist rejects the `ids=` request, which
	// one id it can't read is enough for, all of its ids are asked for one
	// by one, so that only the bad one ends up missing.
	public async getTaskStates(ids: string[]): Promise<Map<string, TaskState>> {
		const states = new Map<string, TaskState>();
		const wanted = Array.from(new Set(ids));

		for (let i = 0; i < wanted.length; i += IDS_PER_REQUEST) {
			const chunk = wanted.slice(i, i + IDS_PER_REQUEST).map(encodeURIComponent).join(',');
			// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
			let found: any[] = [];
			try {
				found = await this.getAll(`/tasks?ids=${chunk}`, 'looking up tasks');
			} catch (error) {
				if (!(error instanceof TodoistError && error.status === 400)) throw error;
			}
			for (const raw of found) {
				const task = toTaskInfo(raw);
				states.set(task.id, { kind: 'found', task });
			}
		}

		const rest = wanted.filter(id => !states.has(id));
		for (let i = 0; i < rest.length; i += LOOKUPS_AT_ONCE) {
			const chunk = rest.slice(i, i + LOOKUPS_AT_ONCE);
			const tasks = await Promise.all(chunk.map(id => this.getTask(id)));
			chunk.forEach((id, index) => {
				const task = tasks[index];
				states.set(id, task ? { kind: 'found', task } : { kind: 'missing' });
			});
		}

		return states;
	}

	// Completes a task. For a recurring task Todoist moves it to its next
	// occurrence instead and leaves it open.
	public async closeTask(id: string): Promise<void> {
		const what = 'closing a task';
		const reply = await this.send('POST', `/tasks/${encodeURIComponent(id)}/close`, what);
		if (reply.status < 200 || reply.status >= 300) throw this.failure(reply, what);
	}
}
