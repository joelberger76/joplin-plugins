# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository structure

This is a flat collection of independent Joplin desktop plugins, each in its own top-level
directory, each generated from and built with Joplin's official `generator-joplin` scaffold
(Yeoman). There is no shared root `package.json`, workspace tooling, or cross-plugin code —
treat each plugin directory as its own project and `cd` into it before running any command.

- `joplin-cycle-bullet-checkbox/` — editor command that cycles a line through
  plain text → bullet → checkbox → plain text. Uses a CodeMirror 6 content script.
- `joplin-pandoc-docx/` — Tools menu command that exports the current note to
  `.docx` via `pandoc` and opens it in the OS default app.

Each plugin directory is internally structured the same way (this is the generator's standard
layout, not something specific to either plugin):

- `src/index.ts` — plugin entry point (`joplin.plugins.register({ onStart: ... })`)
- `src/manifest.json` — plugin metadata (id, version, name, description); kept in sync with
  `package.json`'s version by `npm run updateVersion`
- `plugin.config.json` — lists any `extraScripts` (e.g. content scripts) that webpack must
  compile separately from `src/index.ts`; paths are relative to `src/`
- `api/` — Joplin's plugin API TypeScript definitions, copied in by the generator; not meant
  to be edited
- `webpack.config.js`, `tsconfig.json` — build config copied from `generator-joplin`;
  webpack.config.js is regenerated/overwritten by `npm run update`, so custom build logic
  should live in a separate file that it includes rather than being edited in place
- `dist/` — compiled output (`index.js`, `manifest.json`, plus any compiled extra scripts)
- `publish/` — the installable `.jpl` archive and its metadata `.json`, produced by `npm run dist`

## Common commands

Run from inside a specific plugin directory (e.g. `joplin-pandoc-docx/`):

```
npm install       # installs deps AND triggers a full rebuild via the `prepare` script
npm run dist      # build only: compiles src -> dist, then packages dist -> publish/*.jpl
npm run updateVersion   # bump the patch version in both package.json and manifest.json
npm run update    # pulls the latest generator-joplin scaffold and merges it in
```

There is no lint or test script in either plugin; `npm run dist` (which runs `tsc`/webpack) is
the correctness check available.

`npm run dist` runs three webpack passes in sequence: compile `src/index.ts` (`buildMain`),
compile any `extraScripts` from `plugin.config.json` (`buildExtraScripts`), then zip `dist/`
into the `.jpl` archive (`createArchive`).

## Installing/testing a plugin in Joplin

Two ways to load a plugin into Joplin desktop, and they behave differently — see each plugin's
own README for specifics (`joplin-pandoc-docx/README.md` documents this in detail):

- **Install from file**: Tools > Options > Plugins > gear icon > "Install from file" > pick
  `publish/<id>.jpl`. Normal load path, no devtools window.
- **Development plugins path**: Tools > Options > Plugins > Advanced Settings > paste the
  plugin folder's full path. Joplin then treats it as `devMode: true` and auto-opens a
  detached DevTools window for it 3 seconds after every launch (no way to disable this — it's
  built into Joplin's `PluginRunner`). Never have the same plugin loaded both ways at once —
  same manifest `id` loaded twice causes conflicts.

Restart Joplin after (re)installing either way.

## Architecture notes specific to each plugin

### joplin-cycle-bullet-checkbox

- `src/index.ts` runs in the plugin's main process. It only registers the content script,
  registers a command (`cycleBulletCheckbox`), and wires up a menu item + toolbar button. The
  command's `execute` does nothing but forward to the *editor's* command of the same name via
  `editor.execCommand` — actual logic lives in the content script.
- `src/contentScript.ts` is injected into the CodeMirror 6 editor (`ContentScriptType.CodeMirrorPlugin`)
  and does the real work: it registers a same-named command inside the editor and cycles every
  line touched by the current selection(s)/cursor(s) through plain → bullet → checkbox → plain.
  It bails out (`if (!codeMirrorWrapper.cm6) return;`) when the legacy CodeMirror 5 editor is
  active, since this plugin only supports CM6.
  It edits only the line's marker text (not indent or content), and re-maps the selection
  through the change itself with forward affinity (`assoc = 1`) so cursors on an insertion
  point land after the new marker rather than before it.
- Because `contentScript.ts` must be compiled to JS and bundled separately from `index.ts`,
  it's listed in `plugin.config.json`'s `extraScripts`.

### joplin-pandoc-docx

- Single-file plugin (`src/index.ts`, no content script). Registers two settings (pandoc path,
  extra pandoc args — parsed with quote-aware whitespace splitting) and one Tools-menu command.
- The command pulls the selected note's fresh title/body via `joplin.data.get` (not the
  possibly-stale fields on `selectedNote()`), writes the body to a temp `.md` file, shells out
  to `pandoc` via `execFile`, then opens the resulting `.docx` with the OS-appropriate opener
  (`open` on macOS, `cmd /c start` on Windows, `xdg-open` on Linux).
- `webpack.config.js` uses `target: 'node'`, which is required here because the plugin shells
  out via `child_process` — without it, webpack tries to bundle `child_process` for a browser
  environment and fails. Keep this in mind if porting logic between plugins.
- Child process PATH is deliberately widened (`/usr/local/bin`, `/opt/homebrew/bin`, etc.)
  because Joplin desktop apps launched from Finder/Dock often don't inherit a full shell PATH,
  so Homebrew-installed `pandoc` can be invisible even though it works in a terminal.
- Uses `joplin.settings.registerSettings({...})` (plural) — the singular `registerSetting()` is
  deprecated and hard-errors on current Joplin versions.
- Known limitation: Joplin-internal resource links (`:/resource_id`) for embedded images and
  inter-note links aren't resolved by pandoc, so notes with embedded images lose them on export.

## My Preferences
  - Writing style
     - Don't use em dashes in any written copy (site content, commit messages, etc.). Use a comma, period, or restructure the sentence instead.
  - Version Control
     - Only commit to the repo when asked.
     - When committing, include untracked files.
     - When committing, if there are unstaged changes predating your session, please include them.
     - When committing, you should not push to origin until I tell you to.
  - I store our shared to-do list in TODO.md. Please create it if it doesn't exist already. To-dos should be deleted once complete, but only after I confirm this is ok.
  - When I add a new plug-in to the repo, update CLAUDE.md to ensure current context.