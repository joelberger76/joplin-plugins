import joplin from 'api';
import { MenuItemLocation, SettingItemType } from 'api/types';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SETTINGS_SECTION = 'pandocDocxExport';
const PANDOC_PATH_KEY = 'pandocPath';
const EXTRA_ARGS_KEY = 'extraPandocArgs';

function sanitizeFilename(name: string): string {
	const cleaned = (name || 'untitled').replace(/[\\/:*?"<>|]/g, '_').trim();
	return cleaned.length ? cleaned : 'untitled';
}

// Splits a string of extra pandoc arguments on whitespace, respecting
// single/double quoted segments so paths and titles containing spaces
// can be passed as one argument, e.g.:
//   --reference-doc="/Users/joel/Templates/exec-resume.docx" --toc
function parseExtraArgs(raw: string): string[] {
	if (!raw) return [];
	const args: string[] = [];
	const regex = /"([^"]*)"|'([^']*)'|(\S+)/g;
	let match: RegExpExecArray | null;
	while ((match = regex.exec(raw)) !== null) {
		const value = match[1] !== undefined ? match[1] : match[2] !== undefined ? match[2] : match[3];
		args.push(value);
	}
	return args;
}

// Joplin desktop apps launched from Finder/Dock on macOS (and some Linux
// desktop environments) don't inherit the full shell PATH, so Homebrew-
// installed tools like pandoc are often invisible even though `which pandoc`
// works fine in a terminal. This widens PATH for the child process only.
function extendedEnv(): NodeJS.ProcessEnv {
	const extraDirs = ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/bin'];
	const currentPath = process.env.PATH || '';
	return {
		...process.env,
		PATH: [currentPath, ...extraDirs].filter(Boolean).join(path.delimiter),
	};
}

function runFile(cmd: string, args: string[]): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(cmd, args, { env: extendedEnv() }, (error, _stdout, stderr) => {
			if (error) {
				reject(new Error(stderr && stderr.trim() ? stderr.trim() : error.message));
				return;
			}
			resolve();
		});
	});
}

function openFile(filePath: string): Promise<void> {
	let cmd: string;
	let args: string[];
	if (process.platform === 'darwin') {
		cmd = 'open';
		args = [filePath];
	} else if (process.platform === 'win32') {
		cmd = 'cmd';
		args = ['/c', 'start', '""', filePath];
	} else {
		cmd = 'xdg-open';
		args = [filePath];
	}
	return runFile(cmd, args);
}

joplin.plugins.register({
	onStart: async function () {
		console.info('[pandoc-docx] onStart: begin');

		await joplin.settings.registerSection(SETTINGS_SECTION, {
			label: 'Pandoc DOCX Export',
			iconName: 'fas fa-file-word',
		});
		console.info('[pandoc-docx] onStart: settings section registered');

		await joplin.settings.registerSettings({
			[PANDOC_PATH_KEY]: {
				value: 'pandoc',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Path to the pandoc executable',
				description:
					'Leave as "pandoc" if it is on your PATH. Otherwise set the full path, e.g. /opt/homebrew/bin/pandoc (Apple Silicon) or /usr/local/bin/pandoc (Intel Mac).',
			},
			[EXTRA_ARGS_KEY]: {
				value: '',
				type: SettingItemType.String,
				section: SETTINGS_SECTION,
				public: true,
				label: 'Extra pandoc arguments',
				description:
					'Optional, space-separated pandoc options appended to the conversion command, e.g. --reference-doc="/path/to/template.docx" --toc -V geometry:margin=1in. Quote any value containing spaces.',
			},
		});
		console.info('[pandoc-docx] onStart: setting registered');

		await joplin.commands.register({
			name: 'pandocToDocx',
			label: 'Convert note to DOCX (pandoc)',
			iconName: 'fas fa-file-word',
			execute: async () => {
				const selected = await joplin.workspace.selectedNote();
				if (!selected) {
					await joplin.views.dialogs.showMessageBox('No note is selected.');
					return;
				}

				// Fetch fresh title/body via the data API rather than trusting
				// whatever fields selectedNote() happened to include.
				const note = await joplin.data.get(['notes', selected.id], {
					fields: ['id', 'title', 'body'],
				});

				const pandocPath = (await joplin.settings.value(PANDOC_PATH_KEY)) || 'pandoc';
				const extraArgs = parseExtraArgs((await joplin.settings.value(EXTRA_ARGS_KEY)) || '');
				const safeTitle = sanitizeFilename(note.title);
				const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'joplin-pandoc-'));
				const mdPath = path.join(tmpDir, `${safeTitle}.md`);
				const docxPath = path.join(tmpDir, `${safeTitle}.docx`);

				try {
					fs.writeFileSync(mdPath, note.body || '', 'utf8');
					const pandocArgs = [mdPath, '-o', docxPath, ...extraArgs];
					console.info('[pandoc-docx] running:', pandocPath, pandocArgs.join(' '));
					await runFile(pandocPath, pandocArgs);
				} catch (err) {
					await joplin.views.dialogs.showMessageBox(
						'Pandoc conversion failed:\n\n' +
							err.message +
							'\n\nIf pandoc is not on your PATH, set the full path in ' +
							'Settings > Pandoc DOCX Export.'
					);
					return;
				}

				try {
					await openFile(docxPath);
				} catch (err) {
					await joplin.views.dialogs.showMessageBox(
						'Converted successfully, but the file could not be opened automatically.\n\n' +
							'Saved at: ' +
							docxPath
					);
				}
			},
		});

		console.info('[pandoc-docx] onStart: command registered');

		await joplin.views.menuItems.create('pandocToDocxMenuItem', 'pandocToDocx', MenuItemLocation.Tools);
		console.info('[pandoc-docx] onStart: menu item created, startup complete');
	},
});
