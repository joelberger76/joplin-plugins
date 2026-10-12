// The commands the editor script (editor.ts) offers and the shapes they
// use. Kept apart from editor.ts so that index.ts can import them without
// pulling CodeMirror into the main bundle.

export const GET_STATE_COMMAND = 'todoistSyncGetState';
export const APPLY_EDITS_COMMAND = 'todoistSyncApplyEdits';
// Tells the editor script to ask for the display settings again.
export const REFRESH_DISPLAY_COMMAND = 'todoistSyncRefreshDisplay';

// What the editor script sends to index.ts to ask for the display settings,
// and the answer.
export const GET_DISPLAY_MESSAGE = 'getDisplay';

export interface DisplaySettings {
	// The "Collapse query block in editor" setting.
	collapse: boolean;
	// The "Show the filter in the query block chip" setting.
	showFilter: boolean;
}

export interface EditorState {
	// Identifies the session to apply edits against.
	session: number;
	body: string;
	// Zero-based line numbers.
	cursorLine: number;
	selectionFromLine: number;
	selectionToLine: number;
	hasSelection: boolean;
}

export interface ApplyResult {
	// False when the session is gone, for example because another note was
	// opened. Nothing was changed.
	ok: boolean;
	applied: number;
	skippedGroups: string[];
}
