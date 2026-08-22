import joplin from 'api';
import { ContentScriptType, MenuItemLocation, ToolbarButtonLocation, ToastType } from 'api/types';

const contentScriptId = 'copyHeadingLinkContentScript';
const commandName = 'copyHeadingLink';

joplin.plugins.register({
	onStart: async function() {
		// Loads contentScript.ts (compiled to contentScript.js) into the
		// CodeMirror 6 editor.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			contentScriptId,
			'./contentScript.js',
		);

		await joplin.commands.register({
			name: commandName,
			label: 'Copy heading link',
			iconName: 'fas fa-link',
			enabledCondition: 'markdownEditorPaneVisible',
			execute: async () => {
				// Runs inside the editor, via the CM6 command registered by
				// contentScript.ts, which finds the heading at/above the
				// cursor and returns its text plus its renderer-matching
				// anchor slug.
				const result: { headingText: string; slug: string } | null = await joplin.commands.execute('editor.execCommand', {
					name: commandName,
				});

				if (!result) {
					await joplin.views.dialogs.showToast({
						message: 'No heading found above the cursor',
						type: ToastType.Error,
					});
					return;
				}

				// Fetched fresh rather than trusting a possibly-stale
				// selectedNote(), since the title can change mid-session.
				const selectedNote = await joplin.workspace.selectedNote();
				if (!selectedNote) return;
				const note = await joplin.data.get(['notes', selectedNote.id], { fields: ['id', 'title'] });

				const link = `[${note.title} # ${result.headingText}](:/${note.id}#${result.slug})`;
				await joplin.clipboard.writeText(link);

				await joplin.views.dialogs.showToast({
					message: 'Copied heading link to clipboard',
					type: ToastType.Success,
				});
			},
		});

		await joplin.views.menuItems.create(
			'copyHeadingLinkMenuItem',
			commandName,
			MenuItemLocation.Edit,
			{ accelerator: 'CmdOrCtrl+Shift+L' },
		);

		await joplin.views.toolbarButtons.create(
			'copyHeadingLinkToolbarButton',
			commandName,
			ToolbarButtonLocation.EditorToolbar,
		);
	},
});
