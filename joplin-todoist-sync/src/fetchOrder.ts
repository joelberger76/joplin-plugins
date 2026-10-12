// Puts fetched tasks in the order Todoist shows them (SPEC.md section 5.2):
// by project as the sidebar lists them, and within a project as its own
// view does. Pure, so it can be tested in Node.

import { TaskInfo } from './types';

export interface OrderProject {
	id: string;
	isInbox: boolean;
	parentId: string | null;
	order: number;
}

// The place of each project in the sidebar: the Inbox, then the others
// with every sub-project right after its parent.
export function projectRanks(projects: OrderProject[]): Map<string, number> {
	const ids = new Set(projects.map(project => project.id));
	const children = new Map<string | null, OrderProject[]>();
	for (const project of projects) {
		const parent = project.parentId && ids.has(project.parentId) ? project.parentId : null;
		const list = children.get(parent) ?? [];
		list.push(project);
		children.set(parent, list);
	}

	const ranks = new Map<string, number>();
	const walk = (parent: string | null) => {
		const list = (children.get(parent) ?? []).slice().sort((a, b) =>
			(a.isInbox ? 0 : 1) - (b.isInbox ? 0 : 1) || a.order - b.order);
		for (const project of list) {
			if (ranks.has(project.id)) continue;
			ranks.set(project.id, ranks.size);
			walk(project.id);
		}
	};
	walk(null);
	return ranks;
}

// The tasks in Todoist's order. Within a project the tasks outside any
// section come first, then each section in turn. A subtask follows its
// parent when the parent is among the tasks. Tasks that tie, or whose
// project or section is not known, keep the order they came in.
export function sortForNote(tasks: TaskInfo[], projects: OrderProject[], sectionOrder: Map<string, number>): TaskInfo[] {
	const ranks = projectRanks(projects);
	const last = Number.MAX_SAFE_INTEGER;
	const position = new Map(tasks.map((task, index) => [task.id, index] as [string, number]));

	const keyOf = (task: TaskInfo) => [
		ranks.get(task.projectId) ?? last,
		task.sectionId ? sectionOrder.get(task.sectionId) ?? last : -1,
		task.order ?? 0,
		position.get(task.id) ?? 0,
	];
	const compare = (a: TaskInfo, b: TaskInfo) => {
		const keyA = keyOf(a);
		const keyB = keyOf(b);
		for (let i = 0; i < keyA.length; i++) {
			if (keyA[i] !== keyB[i]) return keyA[i] - keyB[i];
		}
		return 0;
	};

	const children = new Map<string, TaskInfo[]>();
	const roots: TaskInfo[] = [];
	for (const task of tasks) {
		if (task.parentId && task.parentId !== task.id && position.has(task.parentId)) {
			const list = children.get(task.parentId) ?? [];
			list.push(task);
			children.set(task.parentId, list);
		} else {
			roots.push(task);
		}
	}

	const sorted: TaskInfo[] = [];
	const seen = new Set<string>();
	const add = (list: TaskInfo[]) => {
		for (const task of list.slice().sort(compare)) {
			if (seen.has(task.id)) continue;
			seen.add(task.id);
			sorted.push(task);
			add(children.get(task.id) ?? []);
		}
	};
	add(roots);
	// Tasks that point at each other as parent have no root. They go last.
	for (const task of tasks) {
		if (!seen.has(task.id)) sorted.push(task);
	}
	return sorted;
}
