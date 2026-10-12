import joplin from 'api';
import { ContentScriptType, MenuItemLocation, SettingItemType, ToastType } from 'api/types';
import { APPLY_EDITS_COMMAND, ApplyResult, EditorState, GET_STATE_COMMAND } from './editorApi';
import { TextEdit } from './edits';
import { FetchOptions, FetchPlan, planFetch, planNewBlock } from './fetchPlan';
import { parseNote, QueryBlock } from './noteParser';
import { duplicateLinks, planSync, reportSync, syncEdits, tasksToClose, writableItems } from './syncPlan';
import { HttpFetch, TodoistClient, TodoistError } from './todoist';
import { TaskInfo } from './types';

const SETTINGS_SECTION = 'todoistSync';
const SETTING_TOKEN = 'todoistSyncToken';
const SETTING_DEFAULT_FILTER = 'todoistSyncDefaultFilter';
const SETTING_SHOW_DETAILS = 'todoistSyncShowDetails';

const FETCH_COMMAND = 'todoistSyncFetch';
const SYNC_COMMAND = 'todoistSyncNote';

const NEEDS_MARKDOWN_EDITOR = 'Todoist Sync works in the Markdown editor. Open the note there and try again.';
const NEEDS_TOKEN = 'Set your Todoist API token first, under Options > Todoist Sync.';

let problemDialog: string | null = null;

function escapeHtml(text: string): string {
	return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Shown when a command can't run or when something was skipped. It stays
// until dismissed (SPEC.md section 6.5). A dialog of our own, because
// showMessageBox always adds a Cancel button that would do nothing here.
// Joplin sizes a dialog from #joplin-plugin-content, which is 200px wide
// unless given a width itself.
async function showProblem(message: string) {
	const dialogs = joplin.views.dialogs;
	if (!problemDialog) {
		problemDialog = await dialogs.create('todoistSyncProblem');
		await dialogs.setButtons(problemDialog, [{ id: 'ok', title: 'OK' }]);
	}
	const paragraphs = message.split(/\n{2,}/).map(part =>
		`<p style="margin: 0 0 12px">${escapeHtml(part).replace(/\n/g, '<br>')}</p>`);
	await dialogs.setHtml(problemDialog, `<style>#joplin-plugin-content { width: 440px; }</style><div style="font-family: var(--joplin-font-family, sans-serif); font-size: 14px; line-height: 1.45; color: var(--joplin-color); overflow-wrap: anywhere">${paragraphs.join('')}</div>`);
	await dialogs.open(problemDialog);
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

// Task details show the project by name, and tasks only carry its id. The
// Inbox is left out, because it is never shown.
async function projectNamesFrom(client: TodoistClient): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	for (const project of await client.getProjects()) {
		if (!project.isInbox) names.set(project.id, project.name);
	}
	return names;
}

// Whether the note the command started on is still the one that is open.
// It may have been switched while Todoist was answering.
async function stillOn(noteId: string): Promise<boolean> {
	const current = await joplin.workspace.selectedNote();
	return !!current && current.id === noteId;
}

function errorMessage(error: unknown, doing: string): string {
	if (error instanceof TodoistError) return error.message;
	const detail = error instanceof Error ? error.message : String(error);
	return `Something went wrong while ${doing}: ${detail}`;
}

// What a command has to say when it is done (SPEC.md section 6.5).
interface Outcome {
	summary: string;
	// One line per thing that needs attention. Empty when nothing does.
	problems: string[];
}

// Thrown to stop a command with a message for the user.
class Stop extends Error {}

async function showOutcome(outcome: Outcome) {
	if (outcome.problems.length) await showProblem(`${outcome.summary}\n\n${outcome.problems.join('\n')}`);
	else await showDone(outcome.summary);
}

// Everything a command needs before it starts.
async function start(): Promise<{ noteId: string; editor: EditorState; client: TodoistClient }> {
	const note = await joplin.workspace.selectedNote();
	const editor = await readEditor();
	if (!note || !editor) throw new Stop(NEEDS_MARKDOWN_EDITOR);

	const client = await createClient();
	if (!client) throw new Stop(NEEDS_TOKEN);

	return { noteId: note.id, editor, client };
}

// Runs a command and shows what it returns, or why it stopped.
async function run(doing: string, command: () => Promise<Outcome>) {
	try {
		await showOutcome(await command());
	} catch (error) {
		await showProblem(error instanceof Stop ? error.message : errorMessage(error, doing));
	}
}

// Fetches into the note's query blocks. With `onlyNeverRun`, only the
// blocks that have no `fetched:` line are run, and no block is created.
async function fetchInto(noteId: string, editor: EditorState, client: TodoistClient, onlyNeverRun: boolean): Promise<Outcome> {
	const parsed = parseNote(editor.body);
	const now = new Date();
	const showDetails = !!(await joplin.settings.value(SETTING_SHOW_DETAILS));
	const problems: string[] = [];

	// Ask Todoist for each block's tasks. A block that fails is reported
	// and left alone, so its `fetched:` line is not written.
	const results: Array<{ block: QueryBlock; tasks: TaskInfo[] }> = [];
	let newBlockTasks: TaskInfo[] | null = null;
	const defaultFilter = String(await joplin.settings.value(SETTING_DEFAULT_FILTER) || '').trim();
	const blocks = onlyNeverRun ? parsed.queryBlocks.filter(block => block.fetched === null) : parsed.queryBlocks;

	if (parsed.queryBlocks.length || onlyNeverRun) {
		for (const block of blocks) {
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
		if (!defaultFilter) throw new Stop('This note has no todoist query block, and no default filter is set under Options > Todoist Sync.');
		newBlockTasks = await client.getTasksByFilter(defaultFilter);
	}

	const anyTasks = results.some(result => result.tasks.length) || !!(newBlockTasks && newBlockTasks.length);
	const projectNames = showDetails && anyTasks ? await projectNamesFrom(client) : new Map<string, string>();

	const options: FetchOptions = { today: now, timestamp: timestamp(now), showDetails, projectNames };
	const plan: FetchPlan = newBlockTasks
		? planNewBlock(parsed, editor.cursorLine, defaultFilter, newBlockTasks, options)
		: planFetch(parsed, results, options);

	if (plan.edits.length) {
		if (!(await stillOn(noteId))) throw new Stop('The note was changed while fetching, so nothing was written. Run Fetch again.');

		const applied = await applyEdits(editor.session, plan.edits);
		if (!applied || !applied.ok) throw new Stop('The editor changed while fetching, so nothing was written. Run Fetch again.');
		if (applied.skippedGroups.length) {
			problems.push('Part of the note was edited while fetching, so some tasks were not written. Run Fetch again.');
		}
	}

	return { summary: `Fetched ${plural(plan.added, 'task')}.`, problems };
}

// Syncs the linked lines of the note.
async function syncLines(noteId: string, editor: EditorState, client: TodoistClient): Promise<Outcome> {
	const parsed = parseNote(editor.body);
	const ids = parsed.taskLines.filter(line => line.link).map(line => line.link.taskId);
	if (!ids.length) return { summary: 'This note has no lines linked to Todoist.', problems: [] };

	// Checked before Todoist is asked anything.
	const duplicates = duplicateLinks(parsed);
	if (duplicates.length) {
		return {
			summary: 'Nothing was synced, because a task is linked on more than one line. Remove the extra link and run Sync again.',
			problems: duplicates,
		};
	}

	const states = await client.getTaskStates(ids);
	const showDetails = !!(await joplin.settings.value(SETTING_SHOW_DETAILS));
	const anyFound = Array.from(states.values()).some(state => state.kind === 'found');
	const projectNames = showDetails && anyFound ? await projectNamesFrom(client) : new Map<string, string>();

	const items = planSync(parsed, states, { today: new Date(), showDetails, projectNames });
	const toClose = tasksToClose(items);

	// Checked before anything is closed, so that a run on a note that is
	// no longer open changes nothing on either side.
	if ((toClose.length || syncEdits(parsed, items).length) && !(await stillOn(noteId))) {
		throw new Stop('The note was changed while syncing, so nothing was done. Run Sync again.');
	}

	// A close that fails is reported, and its line is left as it is.
	const failedCloses = new Map<string, string>();
	for (const id of toClose) {
		try {
			await client.closeTask(id);
		} catch (error) {
			if (!(error instanceof TodoistError)) throw error;
			failedCloses.set(id, error.message);
		}
	}

	const toWrite = syncEdits(parsed, writableItems(items, failedCloses));
	let skippedGroups: string[] = [];
	if (toWrite.length) {
		const applied = (await stillOn(noteId)) ? await applyEdits(editor.session, toWrite) : null;
		if (!applied || !applied.ok) {
			// Running Sync again is safe: a completed task is not closed
			// twice, and a recurring line whose task has moved on only
			// loses its link.
			const closed = toClose.length - failedCloses.size;
			const done = closed ? `${plural(closed, 'task')} closed in Todoist, but the` : 'The';
			throw new Stop(`${done} note changed while syncing, so it was not updated. Run Sync again.`);
		}
		skippedGroups = applied.skippedGroups;
	}

	return reportSync(items, failedCloses, skippedGroups);
}

async function fetchTasks() {
	await run('fetching', async () => {
		const { noteId, editor, client } = await start();
		return await fetchInto(noteId, editor, client, false);
	});
}

async function syncNote() {
	await run('syncing', async () => {
		const { noteId, editor, client } = await start();

		// A query block that has never run is fetched first (SPEC.md
		// section 6), so Sync on a new note does what was meant.
		const neverRun = parseNote(editor.body).queryBlocks.some(block => block.fetched === null);
		if (!neverRun) return await syncLines(noteId, editor, client);

		const fetched = await fetchInto(noteId, editor, client, true);

		// The fetch has changed the note, so it is read again.
		const after = await readEditor();
		if (!after || !(await stillOn(noteId))) throw new Stop(`${fetched.summary} The note was changed before it could be synced. Run Sync again.`);

		const synced = await syncLines(noteId, after, client);
		return { summary: `${fetched.summary} ${synced.summary}`, problems: [...fetched.problems, ...synced.problems] };
	});
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

		await joplin.commands.register({
			name: SYNC_COMMAND,
			label: 'Sync note with Todoist',
			iconName: 'fas fa-sync',
			enabledCondition: 'markdownEditorPaneVisible && oneNoteSelected',
			execute: syncNote,
		});

		await joplin.views.menus.create(
			'todoistSyncMenu',
			'Todoist Sync',
			[{ commandName: FETCH_COMMAND }, { commandName: SYNC_COMMAND }],
			MenuItemLocation.Tools,
		);
	},
});
