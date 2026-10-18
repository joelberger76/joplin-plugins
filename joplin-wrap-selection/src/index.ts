import joplin from 'api';
import { ContentScriptType } from 'api/types';

joplin.plugins.register({
	onStart: async function() {
		// Everything happens in the editor: contentScript.ts (compiled to
		// contentScript.js) adds an input handler to CodeMirror 6.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			'wrapSelectionContentScript',
			'./contentScript.js',
		);
	},
});
