import joplin from 'api';
import { ContentScriptType, MenuItemLocation, SettingItemType, ToastType, ToolbarButtonLocation } from 'api/types';
import { hasBlockToFetch, isTemplate, namesIn, sameText } from './autoFetch';
import { sortForNote } from './fetchOrder';
import { APPLY_EDITS_COMMAND, ApplyResult, DisplaySettings, EditorState, GET_DISPLAY_MESSAGE, GET_STATE_COMMAND, REFRESH_DISPLAY_COMMAND } from './editorApi';
import { TextEdit } from './edits';
import { FetchOptions, FetchPlan, planFetch, planNewBlock } from './fetchPlan';
import { matchName } from './names';
import { parseNote, QueryBlock } from './noteParser';
import { planSend, reportSend, runSend, sendCandidates, sendEdits, SendScope } from './sendPlan';
import { duplicateLinks, planSync, reportSync, syncEdits, tasksToClose, writableItems } from './syncPlan';
import { HttpFetch, Project, TodoistClient, TodoistError } from './todoist';
import { TaskInfo } from './types';
import { confirmAll, linkedLines, reportUnlink, unlinkEdits, UnlinkScope } from './unlinkPlan';

const SETTINGS_SECTION = 'todoistSync';
const SETTING_TOKEN = 'todoistSyncToken';
const SETTING_DEFAULT_PROJECT = 'todoistSyncDefaultProject';
const SETTING_DEFAULT_FILTER = 'todoistSyncDefaultFilter';
const SETTING_SHOW_DETAILS = 'todoistSyncShowDetails';
const SETTING_TEMPLATE_NOTEBOOKS = 'todoistSyncTemplateNotebooks';
const SETTING_TEMPLATE_TAGS = 'todoistSyncTemplateTags';
const SETTING_CHIP_FILTER = 'todoistSyncChipFilter';
const SETTING_COLLAPSE_BLOCK = 'todoistSyncCollapseBlock';

const SETTING_BUTTONS = 'todoistSyncButtons';

const EDITOR_SCRIPT = 'todoistSyncEditor';
const VIEWER_SCRIPT = 'todoistSyncViewer';

const SEND_COMMAND = 'todoistSyncSend';
const FETCH_COMMAND = 'todoistSyncFetch';
const SYNC_COMMAND = 'todoistSyncNote';
const REMOVE_LINKS_COMMAND = 'todoistSyncRemoveLinks';

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

const TOAST_MS = 6000;
let lastToast = 0;

// Joplin keeps the last toast and shows it again whenever its main screen
// comes back, for example when Options is closed. So once a toast has had
// its time, it is replaced with an empty one, which Joplin does not show.
async function showDone(message: string) {
	const toast = ++lastToast;
	await joplin.views.dialogs.showToast({ message, type: ToastType.Success, duration: TOAST_MS });
	setTimeout(() => {
		if (toast !== lastToast) return;
		void joplin.views.dialogs.showToast({ message: '', duration: 0 }).catch(() => undefined);
	}, TOAST_MS + 500);
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
function projectNamesOf(projects: Project[]): Map<string, string> {
	const names = new Map<string, string>();
	for (const project of projects) {
		if (!project.isInbox) names.set(project.id, project.name);
	}
	return names;
}

async function projectNamesFrom(client: TodoistClient): Promise<Map<string, string>> {
	return projectNamesOf(await client.getProjects());
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

// Nothing is shown for null: the command was cancelled.
async function showOutcome(outcome: Outcome | null) {
	if (!outcome) return;
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

// The commands and the automatic fetch run one at a time, in the order
// they were asked for. Each reads the note and writes it later, and the
// editor script follows only one such session.
let lastJob: Promise<void> = Promise.resolve();

function inTurn(job: () => Promise<void>): Promise<void> {
	const done = lastJob.then(job);
	lastJob = done.catch(() => undefined);
	return done;
}

// Runs a command and shows what it returns, or why it stopped.
async function run(doing: string, command: () => Promise<Outcome | null>) {
	await inTurn(async () => {
		try {
			await showOutcome(await command());
		} catch (error) {
			await showProblem(error instanceof Stop ? error.message : errorMessage(error, doing));
		}
	});
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
	const results: Array<{ block: QueryBlock; tasks: TaskInfo[]; filter?: string }> = [];
	let newBlockTasks: TaskInfo[] | null = null;
	const defaultFilter = String(await joplin.settings.value(SETTING_DEFAULT_FILTER) || '').trim();
	const blocks = onlyNeverRun ? parsed.queryBlocks.filter(block => block.fetched === null) : parsed.queryBlocks;

	if (parsed.queryBlocks.length || onlyNeverRun) {
		for (const block of blocks) {
			// A block with no filter is run with the default one, which
			// is then written into it.
			const filter = block.filter || defaultFilter;
			if (!filter) {
				problems.push(`The query block on line ${block.startLine + 1} has no "filter:" line, and no default filter is set under Options > Todoist Sync.`);
				continue;
			}
			try {
				const tasks = await client.getTasksByFilter(filter);
				results.push(block.filter ? { block, tasks } : { block, tasks, filter });
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

	// The tasks are written in the order Todoist shows them, which takes
	// the project list, and the sections when a task is in one.
	const fetched = [...results.map(result => result.tasks), newBlockTasks ?? []];
	const anyTasks = fetched.some(tasks => tasks.length);
	const projects = anyTasks ? await client.getProjects() : [];
	const inSection = fetched.some(tasks => tasks.some(task => task.sectionId));
	const sectionOrder = inSection ? await client.getSectionOrder() : new Map<string, number>();
	for (const result of results) result.tasks = sortForNote(result.tasks, projects, sectionOrder);
	if (newBlockTasks) newBlockTasks = sortForNote(newBlockTasks, projects, sectionOrder);
	const projectNames = showDetails ? projectNamesOf(projects) : new Map<string, string>();

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

// The project for sent lines that name none: the exact name of the one
// the setting refers to, or null for the Inbox. The setting is matched
// like a `##` token, and nothing is sent if it can't be.
function defaultProjectOf(setting: string, projects: Project[]): string | null {
	if (!setting) return null;
	const found = matchName(setting, projects.map(project => project.name));
	if (found.kind === 'none') throw new Stop(`Nothing was sent. The default project "${setting}", set under Options > Todoist Sync, matches no Todoist project.`);
	if (found.kind === 'ambiguous') throw new Stop(`Nothing was sent. The default project "${setting}", set under Options > Todoist Sync, matches more than one Todoist project: ${found.candidates.join(', ')}.`);
	const inbox = projects.find(project => project.isInbox);
	return inbox && inbox.name === found.name ? null : found.name;
}

// Creates tasks from the unlinked checkbox lines of the note, or of the
// selection, and links the lines to them.
async function sendLines(noteId: string, editor: EditorState, client: TodoistClient): Promise<Outcome> {
	const parsed = parseNote(editor.body);
	const scope: SendScope | null = editor.hasSelection
		? { fromLine: editor.selectionFromLine, toLine: editor.selectionToLine }
		: null;

	const candidates = sendCandidates(parsed, scope);
	if (!candidates.length) {
		return { summary: 'Nothing to send.', problems: [] };
	}

	// The lists are only asked for when something needs them.
	const showDetails = !!(await joplin.settings.value(SETTING_SHOW_DETAILS));
	const defaultSetting = String(await joplin.settings.value(SETTING_DEFAULT_PROJECT) || '').trim();
	const usesProjects = candidates.some(candidate => candidate.tokens.projectTokens.length);
	const usesLabels = candidates.some(candidate => candidate.tokens.labelTokens.length);
	const projects = showDetails || defaultSetting || usesProjects ? await client.getProjects() : [];
	const labels = usesLabels ? await client.getLabels() : [];

	const plan = planSend(parsed, candidates, {
		projects: projects.map(project => project.name),
		labels,
		defaultProject: defaultProjectOf(defaultSetting, projects),
	});
	if (!plan.items.length) return reportSend([], plan.problems, []);

	// Checked before anything is created.
	if (!(await stillOn(noteId))) throw new Stop('The note was changed while sending, so nothing was sent. Run Send again.');

	const result = await runSend(plan.items, client);
	const problems = [...plan.problems, ...result.problems];
	if (!result.sent.length) return reportSend([], problems, []);

	const edits = sendEdits(parsed, result.sent, { showDetails, projectNames: projectNamesOf(projects) });
	const applied = (await stillOn(noteId)) ? await applyEdits(editor.session, edits) : null;
	if (!applied || !applied.ok) {
		// Unlike Fetch and Sync, running Send again is not safe here.
		const names = result.sent.map(sent => sent.task.content).join('\n');
		throw new Stop(`${plural(result.sent.length, 'task')} created in Todoist, but the note changed while sending, so the lines were not linked. Sending them again would create the tasks a second time.\n\nCreated:\n${names}${problems.length ? `\n\n${problems.join('\n')}` : ''}`);
	}

	return reportSend(result.sent, problems, applied.skippedGroups);
}

async function sendCheckboxes() {
	await run('sending', async () => {
		const { noteId, editor, client } = await start();
		return await sendLines(noteId, editor, client);
	});
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

// Asks before links are removed. True for OK.
async function confirmed(message: string): Promise<boolean> {
	return (await joplin.views.dialogs.showMessageBox(message)) === 0;
}

// Removes every Todoist link in the selection, or in the note when nothing
// is selected (SPEC.md section 6.4). Todoist is not asked anything, so it
// needs no token.
async function removeLinks() {
	await run('removing links', async () => {
		const note = await joplin.workspace.selectedNote();
		const editor = await readEditor();
		if (!note || !editor) throw new Stop(NEEDS_MARKDOWN_EDITOR);

		const parsed = parseNote(editor.body);
		const scope: UnlinkScope | null = editor.hasSelection
			? { fromLine: editor.selectionFromLine, toLine: editor.selectionToLine }
			: null;
		const lines = linkedLines(parsed, scope);
		if (!lines.length) return { summary: 'No Todoist links to remove.', problems: [] };
		if (!(await confirmed(confirmAll(lines, !!scope)))) return null;

		const applied = (await stillOn(note.id)) ? await applyEdits(editor.session, unlinkEdits(parsed, lines)) : null;
		if (!applied || !applied.ok) throw new Stop('The note was changed meanwhile, so no link was removed. Run the command again.');
		return reportUnlink(lines, applied.skippedGroups);
	});
}

// How long the automatic fetch waits for the editor to show a note that
// was just opened: this many tries, this far apart.
const EDITOR_TRIES = 20;
const EDITOR_WAIT_MS = 250;
// How long a note has to stay selected before it counts as opened, so
// that moving through the note list with the arrow keys fetches nothing.
const SETTLE_MS = 400;

function wait(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

// The titles of the note's notebook and of every notebook above it.
async function notebooksAbove(folderId: string): Promise<string[]> {
	const titles: string[] = [];
	const seen = new Set<string>();
	let id = folderId;
	while (id && !seen.has(id)) {
		seen.add(id);
		const folder = await joplin.data.get(['folders', id], { fields: ['id', 'title', 'parent_id'] });
		titles.push(String(folder.title ?? ''));
		id = folder.parent_id;
	}
	return titles;
}

async function tagsOf(noteId: string): Promise<string[]> {
	const titles: string[] = [];
	for (let page = 1; ; page++) {
		const result = await joplin.data.get(['notes', noteId, 'tags'], { fields: ['id', 'title'], page });
		for (const tag of result.items) titles.push(String(tag.title ?? ''));
		if (!result.has_more) return titles;
	}
}

// Fetches the query blocks of the open note that have never run (SPEC.md
// section 5.3). It stays quiet when there is nothing for it to do or the
// note can't be fetched into right now. The block then waits for the next
// time the note is opened, or for a manual Fetch.
async function fetchOnOpen() {
	const note = await joplin.workspace.selectedNote();
	const defaultFilter = String(await joplin.settings.value(SETTING_DEFAULT_FILTER) || '').trim();
	if (!note || !hasBlockToFetch(String(note.body ?? ''), defaultFilter)) return;

	const client = await createClient();
	if (!client) return;

	const templateNotebooks = String(await joplin.settings.value(SETTING_TEMPLATE_NOTEBOOKS) || '');
	const templateTags = String(await joplin.settings.value(SETTING_TEMPLATE_TAGS) || '');
	if (isTemplate(await notebooksAbove(note.parent_id), await tagsOf(note.id), templateNotebooks, templateTags)) return;

	// The editor may not be showing the note yet, or may be the Rich Text
	// editor. Wait until the Markdown editor holds this note's text.
	let editor: EditorState | null = null;
	for (let i = 0; i < EDITOR_TRIES; i++) {
		if (!(await stillOn(note.id))) return;
		const state = await readEditor();
		if (state && sameText(state.body, String(note.body ?? ''))) {
			editor = state;
			break;
		}
		await wait(EDITOR_WAIT_MS);
	}
	if (!editor) return;

	try {
		await showOutcome(await fetchInto(note.id, editor, client, true));
	} catch (error) {
		// The note was changed or left meanwhile. Nothing was written.
		if (error instanceof Stop) return;
		await showProblem(`The automatic fetch of this note failed. It will be tried again the next time the note is opened.\n\n${errorMessage(error, 'fetching')}`);
	}
}

let lastOpen = 0;

// Called when a note is selected, and once when the plugin starts.
async function noteOpened() {
	const open = ++lastOpen;
	await wait(SETTLE_MS);
	if (open !== lastOpen) return;

	await inTurn(async () => {
		try {
			await fetchOnOpen();
		} catch (error) {
			console.error('Todoist Sync: the automatic fetch failed', error);
		}
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
			[SETTING_DEFAULT_PROJECT]: {
				value: '',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Default project for sent tasks',
				description: 'The Todoist project for a sent line that has no ##Project. Leave empty for the Inbox.',
			},
			[SETTING_DEFAULT_FILTER]: {
				value: 'today | overdue',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Default filter for a new query block',
				description: 'Any Todoist filter query. Used for a todoist query block that has no "filter:" line, and when Fetch is run in a note that has no query block.',
			},
			[SETTING_TEMPLATE_NOTEBOOKS]: {
				value: 'Templates',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Template notebooks (no automatic fetch)',
				description: 'A new query block is fetched when its note is opened, except in these notebooks and their sub-notebooks. Separate several names with commas.',
			},
			[SETTING_TEMPLATE_TAGS]: {
				value: 'template',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Template tag (no automatic fetch)',
				description: 'Notes with this tag are not fetched automatically either. Separate several tags with commas.',
			},
			[SETTING_COLLAPSE_BLOCK]: {
				value: true,
				type: SettingItemType.Bool,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Collapse query block in editor',
				description: 'Shows a todoist query block as a one-line chip in the Markdown editor. The block opens when the cursor is in it, or when the chip is clicked.',
			},
			[SETTING_CHIP_FILTER]: {
				value: false,
				type: SettingItemType.Bool,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Show the filter in the query block chip',
				description: 'For example "Todoist: today | overdue" instead of "Todoist".',
			},
			[SETTING_SHOW_DETAILS]: {
				value: true,
				type: SettingItemType.Bool,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Show task details in the link',
				description: 'A recurring mark, priority, project and labels after the link arrow.',
			},
			[SETTING_BUTTONS]: {
				value: 'Sync',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Toolbar buttons',
				description: 'The commands that get a button on the editor toolbar: any of Send, Fetch and Sync, separated by commas. Leave empty for none. Restart Joplin to see a change.',
			},
		});

		// Loads editor.ts (compiled to editor.js) into the CodeMirror 6
		// editor. It reads and changes the note text for the commands below,
		// and collapses query blocks.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			EDITOR_SCRIPT,
			'./editor.js',
		);

		// The editor script can't read settings itself, so it asks for
		// them when it loads.
		await joplin.contentScripts.onMessage(EDITOR_SCRIPT, async (message: { name: string }): Promise<DisplaySettings | null> => {
			if (message?.name !== GET_DISPLAY_MESSAGE) return null;
			return {
				collapse: !!(await joplin.settings.value(SETTING_COLLAPSE_BLOCK)),
				showFilter: !!(await joplin.settings.value(SETTING_CHIP_FILTER)),
			};
		});

		// Applies a change of those settings straight away, by telling the
		// open editor to ask again.
		await joplin.settings.onChange(async (event) => {
			if (!event.keys.includes(SETTING_COLLAPSE_BLOCK) && !event.keys.includes(SETTING_CHIP_FILTER)) return;
			try {
				await joplin.commands.execute('editor.execCommand', { name: REFRESH_DISPLAY_COMMAND });
			} catch (error) {
				// No Markdown editor is open. The next one asks when it loads.
			}
		});

		// Loads viewer.ts (compiled to viewer.js) into the Markdown
		// renderer, where it hides query blocks.
		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			VIEWER_SCRIPT,
			'./viewer.js',
		);

		await joplin.commands.register({
			name: SEND_COMMAND,
			label: 'Send tasks to Todoist',
			iconName: 'fas fa-cloud-upload-alt',
			enabledCondition: 'markdownEditorPaneVisible && oneNoteSelected',
			execute: sendCheckboxes,
		});

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

		await joplin.commands.register({
			name: REMOVE_LINKS_COMMAND,
			label: 'Remove Todoist links',
			iconName: 'fas fa-unlink',
			enabledCondition: 'markdownEditorPaneVisible && oneNoteSelected',
			execute: removeLinks,
		});

		// No separator in here: Joplin builds every item of a plugin's
		// submenu from its command, and one without a command breaks the
		// whole menu bar.
		await joplin.views.menus.create(
			'todoistSyncMenu',
			'Todoist Sync',
			[
				{ commandName: SEND_COMMAND, accelerator: 'CmdOrCtrl+Alt+Shift+T' },
				{ commandName: FETCH_COMMAND, accelerator: 'CmdOrCtrl+Alt+Shift+F' },
				{ commandName: SYNC_COMMAND, accelerator: 'CmdOrCtrl+Alt+Shift+S' },
				{ commandName: REMOVE_LINKS_COMMAND },
			],
			MenuItemLocation.Tools,
		);

		// A toolbar button for each command the setting names, in that
		// order. Joplin has no way to take a button away again, so a
		// change of the setting shows after a restart.
		const buttons: Record<string, [string, string]> = {
			send: ['todoistSyncSendButton', SEND_COMMAND],
			fetch: ['todoistSyncFetchButton', FETCH_COMMAND],
			sync: ['todoistSyncSyncButton', SYNC_COMMAND],
		};
		const wanted = namesIn(String(await joplin.settings.value(SETTING_BUTTONS) || ''));
		for (const name of new Set(wanted)) {
			if (!buttons[name]) continue;
			await joplin.views.toolbarButtons.create(buttons[name][0], buttons[name][1], ToolbarButtonLocation.EditorToolbar);
		}

		// The automatic first fetch (SPEC.md section 5.3).
		await joplin.workspace.onNoteSelectionChange(() => {
			void noteOpened();
		});
		void noteOpened();
	},
});
