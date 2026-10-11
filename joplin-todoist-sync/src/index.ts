import joplin from 'api';
import { ContentScriptType, MenuItemLocation, SettingItemType, ToastType } from 'api/types';
import { APPLY_EDITS_COMMAND, ApplyResult, EditorState, GET_STATE_COMMAND } from './editorApi';
import { TextEdit } from './edits';
import { FetchOptions, FetchPlan, planFetch, planNewBlock } from './fetchPlan';
import { parseNote, QueryBlock } from './noteParser';
import { HttpFetch, TodoistClient, TodoistError } from './todoist';
import { TaskInfo } from './types';

const SETTINGS_SECTION = 'todoistSync';
const SETTING_TOKEN = 'todoistSyncToken';
const SETTING_DEFAULT_FILTER = 'todoistSyncDefaultFilter';
const SETTING_SHOW_DETAILS = 'todoistSyncShowDetails';

const FETCH_COMMAND = 'todoistSyncFetch';

// Shown when a command can't run or when something was skipped. It stays
// until dismissed (SPEC.md section 6.5).
async function showProblem(message: string) {
	await joplin.views.dialogs.showMessageBox(message);
}

async function showDone(message: string) {
	await joplin.views.dialogs.showToast({ message, type: ToastType.Success });
}

function pad(value: number): string {
	return String(value).padStart(2, '0');
}

// "2026-10-11 09:05" in local time, for a block's `fetched:` line.
function timestamp(now: Date): string {
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function plural(count: number, word: string): string {
	return `${count} ${word}${count === 1 ? '' : 's'}`;
}

// Reads the note from the Markdown editor. Returns null when that editor
// is not the one showing the note.
async function readEditor(): Promise<EditorState | null> {
	try {
		const state = await joplin.commands.execute('editor.execCommand', { name: GET_STATE_COMMAND });
		return state && typeof state.body === 'string' ? state : null;
	} catch (error) {
		return null;
	}
}

async function applyEdits(session: number, edits: TextEdit[]): Promise<ApplyResult> {
	return await joplin.commands.execute('editor.execCommand', {
		name: APPLY_EDITS_COMMAND,
		args: [session, edits],
	});
}

async function createClient(): Promise<TodoistClient | null> {
	const token = String(await joplin.settings.value(SETTING_TOKEN) || '').trim();
	if (!token) return null;
	const httpFetch: HttpFetch = (url, init) => fetch(url, init);
	return new TodoistClient(token, httpFetch);
}

async function fetchTasks() {
	const note = await joplin.workspace.selectedNote();
	const editor = await readEditor();
	if (!note || !editor) {
		await showProblem('Todoist Sync works in the Markdown editor. Open the note there and try again.');
		return;
	}

	const client = await createClient();
	if (!client) {
		await showProblem('Set your Todoist API token first, under Options > Todoist Sync.');
		return;
	}

	const parsed = parseNote(editor.body);
	const now = new Date();
	const showDetails = !!(await joplin.settings.value(SETTING_SHOW_DETAILS));
	const problems: string[] = [];

	// Ask Todoist for each block's tasks. A block that fails is reported
	// and left alone, so its `fetched:` line is not written.
	const results: Array<{ block: QueryBlock; tasks: TaskInfo[] }> = [];
	let newBlockTasks: TaskInfo[] | null = null;
	const defaultFilter = String(await joplin.settings.value(SETTING_DEFAULT_FILTER) || '').trim();

	try {
		if (parsed.queryBlocks.length) {
			for (const block of parsed.queryBlocks) {
				if (!block.filter) {
					problems.push(`The query block on line ${block.startLine + 1} has no "filter:" line.`);
					continue;
				}
				try {
					results.push({ block, tasks: await client.getTasksByFilter(block.filter) });
				} catch (error) {
					// A bad filter only spoils its own block. Anything
					// else (token, connection) stops the whole run.
					if (error instanceof TodoistError && error.status === 400) problems.push(error.message);
					else throw error;
				}
			}
		} else {
			if (!defaultFilter) {
				await showProblem('This note has no todoist query block, and no default filter is set under Options > Todoist Sync.');
				return;
			}
			newBlockTasks = await client.getTasksByFilter(defaultFilter);
		}

		// Task details show the project by name, and tasks only carry its id.
		const projectNames = new Map<string, string>();
		const anyTasks = results.some(result => result.tasks.length) || !!(newBlockTasks && newBlockTasks.length);
		if (showDetails && anyTasks) {
			for (const project of await client.getProjects()) {
				if (!project.isInbox) projectNames.set(project.id, project.name);
			}
		}

		const options: FetchOptions = { today: now, timestamp: timestamp(now), showDetails, projectNames };
		const plan: FetchPlan = newBlockTasks
			? planNewBlock(parsed, editor.cursorLine, defaultFilter, newBlockTasks, options)
			: planFetch(parsed, results, options);

		if (plan.edits.length) {
			// The note may have been switched while Todoist was answering.
			const current = await joplin.workspace.selectedNote();
			if (!current || current.id !== note.id) {
				await showProblem('The note was changed while fetching, so nothing was written. Run Fetch again.');
				return;
			}

			const applied = await applyEdits(editor.session, plan.edits);
			if (!applied || !applied.ok) {
				await showProblem('The editor changed while fetching, so nothing was written. Run Fetch again.');
				return;
			}
			if (applied.skippedGroups.length) {
				problems.push('Part of the note was edited while fetching, so some tasks were not written. Run Fetch again.');
			}
		}

		const summary = [`Fetched ${plural(plan.added, 'task')}`];
		const leftOut: string[] = [];
		if (plan.alreadyLinked) leftOut.push(`${plan.alreadyLinked} already in the note`);
		if (plan.notDue) leftOut.push(`${plan.notDue} recurring not due yet`);
		if (leftOut.length) summary.push(`(${leftOut.join(', ')})`);

		if (problems.length) await showProblem(`${summary.join(' ')}.\n\n${problems.join('\n')}`);
		else await showDone(`${summary.join(' ')}.`);
	} catch (error) {
		const message = error instanceof TodoistError ? error.message : `Something went wrong while fetching: ${error && error.message ? error.message : error}`;
		await showProblem(message);
	}
}

joplin.plugins.register({
	onStart: async function() {
		await joplin.settings.registerSection(SETTINGS_SECTION, {
			label: 'Todoist Sync',
			iconName: 'fas fa-check-double',
		});

		await joplin.settings.registerSettings({
			[SETTING_TOKEN]: {
				value: '',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				secure: true,
				label: 'Todoist API token',
				description: 'From Todoist: Settings > Integrations > Developer. Joplin stores it encrypted, with the key in the system keychain.',
			},
			[SETTING_DEFAULT_FILTER]: {
				value: 'today | overdue',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Default filter for a new query block',
				description: 'Any Todoist filter query. Used when Fetch is run in a note that has no todoist query block.',
			},
			[SETTING_SHOW_DETAILS]: {
				value: true,
				type: SettingItemType.Bool,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Show task details in the link',
				description: 'A recurring mark, priority, project and labels after the link arrow.',
			},
		});

		// Loads editor.ts (compiled to editor.js) into the CodeMirror 6
		// editor. It reads and changes the note text for the commands below.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'todoistSyncEditor',
			'./editor.js',
		);

		await joplin.commands.register({
			name: FETCH_COMMAND,
			label: 'Fetch tasks from Todoist',
			iconName: 'fas fa-cloud-download-alt',
			enabledCondition: 'markdownEditorPaneVisible && oneNoteSelected',
			execute: fetchTasks,
		});

		await joplin.views.menus.create(
			'todoistSyncMenu',
			'Todoist Sync',
			[{ commandName: FETCH_COMMAND }],
			MenuItemLocation.Tools,
		);
	},
});
