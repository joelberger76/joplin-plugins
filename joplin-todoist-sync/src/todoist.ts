// A small client for the Todoist API v1. It takes the `fetch` function as a
// parameter so it can be tested in Node without the network.

import { TaskInfo } from './types';

const BASE = 'https://api.todoist.com/api/v1';
const PAGE_SIZE = 200;
// A guard against a paging loop that never ends: 50 pages is 10,000 items.
const MAX_PAGES = 50;

export interface HttpResponse {
	status: number;
	text(): Promise<string>;
}

export type HttpFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<HttpResponse>;

export interface Project {
	id: string;
	name: string;
	isInbox: boolean;
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
	};
}

export class TodoistClient {
	private token: string;
	private httpFetch: HttpFetch;

	public constructor(token: string, httpFetch: HttpFetch) {
		this.token = token;
		this.httpFetch = httpFetch;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- raw API data
	private async get(path: string, what: string): Promise<any> {
		let response: HttpResponse;
		try {
			response = await this.httpFetch(BASE + path, {
				method: 'GET',
				headers: { Authorization: `Bearer ${this.token}` },
			});
		} catch (error) {
			throw new TodoistError(`Could not reach Todoist (${what}). Check your connection.`, null);
		}

		const text = await response.text();

		if (response.status === 401 || response.status === 403) {
			throw new TodoistError('Todoist rejected the API token. Check it in the Todoist Sync settings.', response.status);
		}
		if (response.status < 200 || response.status >= 300) {
			throw new TodoistError(`Todoist returned an error (${what}, status ${response.status}): ${text.slice(0, 200)}`, response.status);
		}

		try {
			return JSON.parse(text);
		} catch (error) {
			throw new TodoistError(`Todoist sent a reply that could not be read (${what}).`, response.status);
		}
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
		}));
	}
}
