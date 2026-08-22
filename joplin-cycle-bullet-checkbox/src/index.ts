import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation } from 'api/types';

const contentScriptId = 'cycleBulletCheckboxContentScript';
const commandName = 'cycleBulletCheckbox';

joplin.plugins.register({
	onStart: async function() {
		// Loads contentScript.ts (compiled to contentScript.js) into the
		// CodeMirror 6 editor.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			contentScriptId,
			'./contentScript.js',
		);

		// A command in the main plugin process. Its only job is to forward
		// to the command of the same name registered inside the editor by
		// contentScript.ts, via the built-in editor.execCommand bridge.
		await joplin.commands.register({
			name: commandName,
			label: 'Cycle bullet / checkbox',
			iconName: 'fas fa-tasks',
			enabledCondition: 'markdownEditorPaneVisible',
			execute: async () => {
				await joplin.commands.execute('editor.execCommand', {
					name: commandName,
				});
			},
		});

		await joplin.views.menuItems.create(
			'cycleBulletCheckboxMenuItem',
			commandName,
			MenuItemLocation.Edit,
			{ accelerator: 'CmdOrCtrl+Shift+9' },
		);

		await joplin.views.toolbarButtons.create(
			'cycleBulletCheckboxToolbarButton',
			commandName,
			ToolbarButtonLocation.EditorToolbar,
		);
	},
});
