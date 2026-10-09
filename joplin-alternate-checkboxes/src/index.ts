import joplin from 'api';
import { ContentScriptType } from 'api/types';

joplin.plugins.register({
	onStart: async function() {
		// Loads altCheckboxes.ts (compiled to altCheckboxes.js) into the
		// Markdown renderer, where it draws the icons in the rendered note.
		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			'alternateCheckboxes',
			'./altCheckboxes.js',
		);

		// Loads editorCheckboxes.ts (compiled to editorCheckboxes.js) into
		// the CodeMirror 6 editor, where it draws the same icons.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'alternateCheckboxesEditor',
			'./editorCheckboxes.js',
		);
	},
});
