// Shapes shared by the logic modules. Nothing here depends on Joplin or on
// the network, so everything that uses these can be tested in Node.

// A Todoist due date, reduced to what the plugin needs.
export interface TaskDue {
	// As Todoist returns it: "2026-10-12" for a whole day,
	// "2026-10-12T14:00:00" for a floating time, or
	// "2026-10-12T14:00:00Z" for a time in a fixed timezone.
	date: string;
	isRecurring: boolean;
}

// A Todoist task, reduced to what the plugin needs.
export interface TaskInfo {
	id: string;
	// The task name.
	content: string;
	// True when the task is completed.
	checked: boolean;
	// Todoist's API value, which runs backwards: 4 is p1 and 1 is p4.
	priority: number;
	due: TaskDue | null;
	projectId: string;
	labels: string[];
	// Where the task sits in its project, for the order Fetch writes tasks
	// in. Left out by code that does not care about order.
	sectionId?: string | null;
	parentId?: string | null;
	// The task's position among those with the same parent.
	order?: number;
}

// A local calendar date and, for a task due at a time of day, a local time.
export interface DueMoment {
	year: number;
	// 1 to 12.
	month: number;
	day: number;
	hour: number | null;
	minute: number | null;
}
