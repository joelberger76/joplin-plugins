import joplin from 'api';
import { ContentScriptType, SettingItemType } from 'api/types';

const editorScriptId = 'inlineTagStyleEditor';
const viewerScriptId = 'inlineTagStyleViewer';

const settingsSection = 'inlineTagStyle';
const backgroundColorKey = 'inlineTagStyle.backgroundColor';
const textColorKey = 'inlineTagStyle.textColor';

// Must match the command registered inside the editor by editorTags.ts.
const refreshColorsCommand = 'inlineTagStyleRefreshColors';

joplin.plugins.register({
	onStart: async function() {
		await joplin.settings.registerSection(settingsSection, {
			label: 'Inline Tag Style',
			iconName: 'fas fa-hashtag',
		});

		const colorHelp = 'Any CSS color, e.g. #59BEC9 or rgba(89, 190, 201, 0.22). Leave blank to use the default.';
		await joplin.settings.registerSettings({
			[backgroundColorKey]: {
				value: '',
				type: SettingItemType.String,
				section: settingsSection,
				public: true,
				label: 'Tag background color',
				description: `Background of a tag in the Markdown editor. ${colorHelp}`,
			},
			[textColorKey]: {
				value: '',
				type: SettingItemType.String,
				section: settingsSection,
				public: true,
				label: 'Tag text color',
				description: `Text of a tag in the Markdown editor. ${colorHelp}`,
			},
		});

		// Loads editorTags.ts (compiled to editorTags.js) into the
		// CodeMirror 6 editor, where it highlights inline #tags.
		await joplin.contentScripts.register(
			ContentScriptType.CodeMirrorPlugin,
			editorScriptId,
			'./editorTags.js',
		);

		// The editor script cannot read settings itself, so it asks for
		// the colors with postMessage when it loads.
		await joplin.contentScripts.onMessage(editorScriptId, async (message: { name: string }) => {
			if (message?.name !== 'getColors') return null;
			return {
				background: await joplin.settings.value(backgroundColorKey),
				text: await joplin.settings.value(textColorKey),
			};
		});

		// Applies a color change straight away, by telling the open editor
		// to ask for the colors again.
		await joplin.settings.onChange(async (event) => {
			if (!event.keys.includes(backgroundColorKey) && !event.keys.includes(textColorKey)) return;
			try {
				await joplin.commands.execute('editor.execCommand', { name: refreshColorsCommand });
			} catch (error) {
				// No Markdown editor is open. The next one to open will
				// pick up the new colors when it loads.
			}
		});

		// Loads viewerTags.ts (compiled to viewerTags.js) into the
		// Markdown renderer, where it hides inline #tags.
		await joplin.contentScripts.register(
			ContentScriptType.MarkdownItPlugin,
			viewerScriptId,
			'./viewerTags.js',
		);
	},
});
