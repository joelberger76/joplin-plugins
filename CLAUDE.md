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
- `joplin-copy-heading-link/` — editor command that copies a Markdown link to
  the heading at/above the cursor. A fork of hieuthi's Copy Anchor Link
  plugin, done from the editor instead of the rendered preview so nothing
  gets injected into notes.
- `joplin-inline-tag-style/`: shows inline `#tags` as pills in the Markdown editor and, in
  the rendered note, hides them or shows them as plain words. Uses a CodeMirror 6 content
  script and a markdown-it content script.
- `joplin-inline-tags/`: typing `#` in the Markdown editor opens an autocomplete of Joplin
  tags and attaches the chosen one to the note. A fork of Roman Musin's Inline Tags plugin
  with case-insensitive, match-anywhere autocomplete.
- `joplin-alternate-checkboxes/`: renders Obsidian Minimal-style alternate checkboxes
  (`- [/]`, `- [>]`, `- [!]` and so on) as colored icons in the rendered note and the Markdown
  editor. Uses a markdown-it content script, a CodeMirror 6 content script and generated icon
  styles.
- `joplin-todoist-sync/`: in progress. Sends checkboxes in the current note to Todoist,
  fetches Todoist tasks into the note from a `todoist` query block, and syncs completion,
  names and details for linked lines. Built step by step from `SPEC.md` in its directory.

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

There is no lint or test script in most plugins; `npm run dist` (which runs `tsc`/webpack) is
the correctness check available. The exception is `joplin-alternate-checkboxes/`, which adds
`npm test` and `npm run icons` (see its architecture notes).

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

### joplin-copy-heading-link

- Fork of [hieuthi/joplin-plugin-copy-anchor-link](https://github.com/hieuthi/joplin-plugin-copy-anchor-link),
  which injects clickable link icons next to every heading in the rendered note preview. This
  fork drops that entirely (no injected preview content, so nothing extra rides along when
  pasting into Outlook) in favor of an editor command + toolbar button + `Cmd/Ctrl+Shift+L`
  that works from the cursor position instead.
- `src/index.ts` registers the CM6 content script and the `copyHeadingLink` command. The
  command forwards to the editor via `editor.execCommand`, gets back `{ headingText, slug }`
  from the content script, fetches the note's fresh id/title via `joplin.data.get` (not the
  possibly-stale `selectedNote()` fields), builds `[Note Title # Heading](:/noteId#slug)`, and
  writes it to the clipboard — matching the original plugin's default "GF" link style.
- `src/contentScript.ts` does the real work: scans the CM6 document for ATX headings
  (`#` through `######`, skipping fenced code blocks so a `#`-prefixed line in a code sample
  isn't mistaken for one), finds the heading at or above the cursor, strips common inline
  Markdown (bold/italic/code/links) to approximate rendered plain text, and computes its anchor
  slug with `@joplin/fork-uslug` — the same slugify package Joplin's own renderer uses via
  `markdown-it-anchor` — so the link resolves to the same id the note preview assigns. Duplicate
  heading text is disambiguated the same way `markdown-it-anchor` does by default (first
  occurrence bare, later ones get `-1`, `-2`, ... appended, skipping slugs already taken by a
  heading whose literal text collides with a computed suffix).
- Known limitations: only ATX headings are recognized (not Setext `===`/`---` underlines), and
  inline Markdown stripping is regex-based, not a full CommonMark parser — see the plugin's own
  README for details.

### joplin-inline-tag-style

- No commands or menus. `src/index.ts` registers two color settings and two content scripts
  (both listed in `plugin.config.json`'s `extraScripts`).
- Pill colors: the editor script can't read settings, so it asks `index.ts` for them with
  `context.postMessage({ name: 'getColors' })` on load and sets them as CSS variables
  (`--inline-tag-background`, `--inline-tag-color`) on the editor's DOM; the base theme reads
  those with a per-theme fallback. On a settings change `index.ts` runs the editor command
  `inlineTagStyleRefreshColors` through `editor.execCommand` to re-fetch them.
- `src/tags.ts` holds the one tag regex, shared by both scripts so the editor and the viewer
  always agree. It deliberately mirrors `INLINE_TAG` in Joel's `joplin-tag-sync` skill (which
  turns inline tags into native Joplin tags), so change the two together. It additionally
  skips single-character and all-digit names ("Phone #s", "#2").
- `src/editorTags.ts` (`ContentScriptType.CodeMirrorPlugin`) is a CM6 `ViewPlugin` that adds a
  `cm-inline-tag` mark decoration to tags in the visible ranges, plus an `EditorView.baseTheme`
  with the default pill style. It skips YAML front matter and uses the Lezer syntax tree to skip
  code, link targets, HTML and math. Decorations are rebuilt when the syntax tree changes, not
  only on doc/viewport changes, because parsing is incremental. `@codemirror/*` is loaded with
  `require()` (webpack externals supplied by Joplin at runtime; no type packages installed).
- `src/viewerTags.ts` (`ContentScriptType.MarkdownItPlugin`) is a core rule run after `inline`
  that wraps tags in `<span class="inline-tag">`; `src/viewerTags.css` (shipped as a content
  script asset, copied to `dist/` by webpack) hides them. Tags are hidden with CSS, never
  removed from the HTML, because the Rich Text editor saves by converting rendered HTML back to
  Markdown and would otherwise delete them from the note.
- A tag is "part of a sentence" when other content follows it on the same line, unless that
  content starts with a symbol or emoji (Joel ends meeting headings with "⏱️ 08:30-09:00").
  A link whose text starts with a symbol counts the same way, so a tag stays hidden before
  the `[↗ p1](...)` link that `joplin-todoist-sync` puts at the end of a line. The rule
  knows nothing about that plugin, it only looks at the link text.
  Such a tag is shown as words: an outer `<span class="inline-tag-label" data-label="...">`
  whose `::after` prints the label (`tagLabel` in `tags.ts`: last `/` segment, dashes and
  underscores to spaces). The label is generated content for the same Rich Text reason.
- Viewer edge cases: a tags-only paragraph is hidden whole (`inline-tags-only`); a tags-only
  line inside a paragraph has its line break hidden too; a comma between two hidden tags is
  hidden; a tags-only heading or list item shows its tags as words.
- The webpack build only exposes each content script's default export, so `findEditorTags`
  can't be reached from `dist/`. To test it, compile `src/` with `tsc` and run it against
  `@codemirror/lang-markdown` in Node.

### joplin-inline-tags

- Fork of [roman-r-m/joplin-inline-tags-plugin](https://github.com/roman-r-m/joplin-inline-tags-plugin)
  at v1.3.0, copied in without its git history. The id is `com.joelberger.inline-tags`, so it
  must not be installed alongside the original (`com.whatever.inline-tags`).
- It keeps upstream's older scaffold (`webpack.config.js`, `api/`, a `@joplin/lib` dev
  dependency), so `npm install` is much heavier than in the other plugins.
- `src/index.ts` answers three messages from the content script: `getTags` (all tags plus
  the `keepText` setting), `setTag` and `newTag`. Unlike upstream, `getTags` includes tags
  already on the selected note, so a tag can be completed again elsewhere in the same note.
  `setTag` for a tag the note already has is a no-op in Joplin.
- `src/contentScript/index.ts` picks `codeMirror6Plugin.ts` or `codeMirror5Plugin.ts`
  depending on the editor. Both get their candidates from `matchTags.ts`, which is the fork's
  only real change: `findMatchingTags` does a case-insensitive substring match and ranks
  prefix matches, then word-start matches, then the rest. `tagExists` decides whether to
  offer "Create new tag".
- The CM6 completion source returns `filter: false` (it does its own filtering), so the
  matched text is only highlighted because it also returns `getMatch`.

### joplin-alternate-checkboxes

- No commands, menus or settings. `src/index.ts` only registers two content scripts (both
  listed in `plugin.config.json`'s `extraScripts`): `src/altCheckboxes.ts` for the rendered
  note and `src/editorCheckboxes.ts` for the editor.
- Only the characters in `src/taskTypes.json` are handled, which is Minimal's set of 20.
  `[ ]` and `[x]` stay with Joplin's built-in checkbox handling. Numbered lists are skipped.
  Both scripts require the marker to be followed by whitespace or the end of the line, so
  keep `MARKER` (viewer) and `AFTER_LIST_MARK` (editor) in step.
- `src/taskTypes.json` is the single source for characters, labels, Lucide icon names and
  colors. `tools/build-css.js` (`npm run icons`) turns it into two committed, generated files:
  `src/altCheckboxes.css` (viewer stylesheet, shipped as a content script asset) and
  `src/taskIcons.json` (label, color and icon per character, bundled into the editor script).
  The icons are SVG data URIs used as CSS masks, so the color comes from
  `--alt-checkbox-color`. `[/]` has no Lucide icon and uses a hand-drawn half-filled box
  defined in `build-css.js`. `lucide-static` is a dev dependency used only by that script.
- `altCheckboxes.ts` (`ContentScriptType.MarkdownItPlugin`) is a core rule pushed after
  `inline`. For a matching bullet list item it removes the marker from the leading text tokens
  and adds `class="alt-checkbox"`, `data-task="<char>"` and a `title` to the `<li>`. It matches
  against the raw `inline.content`, so an escaped bracket (`- \[/] text`) opts out. If the
  marker is not all plain text (for example `*` was parsed as emphasis) the item is left as
  written.
- The viewer icon rule's selector is `ul li.alt-checkbox[data-task]::before` on purpose: it
  has to outrank Joplin's own `ul.joplin-checklist li::before`, which otherwise draws a second
  box on alternate items that share a list with standard checkboxes.
- `editorCheckboxes.ts` (`ContentScriptType.CodeMirrorPlugin`) is a CM6 `ViewPlugin` modelled
  on Joplin's own `replaceCheckboxes.ts` (in `packages/editor/CodeMirror/extensions/rendering/`).
  It walks the Lezer tree for `ListMark` nodes under `BulletList > ListItem`, so code blocks
  are skipped for free, and replaces the list mark plus marker with an icon widget
  (`span.cm-alt-checkbox[data-task]`). Size and offsets copy the built-in checkbox theme so
  both line up in a mixed list. A `[-]` line also gets the `cm-alt-checkbox-canceled` line
  class.
- Reveal rule, copied from Joplin's checkboxes: the raw text shows while the selection
  touches the list mark or marker, except for a bare cursor right before the list mark. A
  cursor elsewhere on the line keeps the icon. Joel first described wanting it per line, so
  this is a candidate to change: switch `selectionTouches` to a same-line check.
- The replace decoration sets `inclusiveStart: true` on purpose. Joplin's `replaceBulletLists`
  replaces the one-character list mark at the same start position; CodeMirror draws whichever
  replacement sorts first, and `inclusiveStart` puts ours first whatever order the extensions
  were added in. Without it a bullet can be drawn next to the icon.
- `tools/test-rule.js` (`npm test`) runs the built `dist/altCheckboxes.js` against plain
  `markdown-it`, so run `npm run dist` first. There is no committed test for the editor
  script. It was checked by bundling `dist/editorCheckboxes.js` with esbuild next to Joplin's
  real `replaceBulletLists` and `replaceCheckboxes` sources and `@codemirror/lang-markdown`
  (GFM), in headless Chromium. When doing that, alias `@codemirror/*` to one build, or the
  script's `require()` pulls a second copy and CodeMirror rejects the extension.
- Known limitations: display only (no click-to-cycle), and the Rich Text editor does not know
  the syntax and may rewrite or drop markers when it saves. Unlike `joplin-inline-tag-style`,
  the viewer removes the marker from the HTML, it does not hide it with CSS.
- Both parts have been installed and looked at in the Joplin app by Joel.

### joplin-todoist-sync

- In progress. `SPEC.md` in the plugin directory is the source of truth for behaviour, and
  its section 12 is the build order with the current status. Read it before changing
  anything. `TODO.md` there holds v2 ideas and things to do during the build.
- Build steps 1 to 6 are done. Step 1 is the logic modules in `src/` (`noteParser.ts`,
  `details.ts`, `names.ts`, `sendText.ts`, `syncRules.ts`, `types.ts`) with no Joplin or
  network dependency. Step 2 is manual Fetch: settings, the Fetch command under
  Tools > Todoist Sync, `todoist.ts` (API client, takes `fetch` as a parameter so tests can fake
  it) and `fetchPlan.ts` (turns tasks into edits).
- Step 3 (Sync) was accepted by Joel on 2026-10-11, after the interactive session of
  SPEC.md section 7.1. The Sync command looks up every linked task
  (`TodoistClient.getTaskStates`), and `syncPlan.ts` turns the per-line decisions of
  `syncRules.ts` into the tasks to close, one edit per changed line and the report. Sync
  refuses to run, before any Todoist call, on a note that links one task on more than one
  line, because closing a recurring task twice would also complete its next occurrence.
  Tasks are closed before the note is written. Sync first fetches any query block that
  has no `fetched:` line, then syncs. A line whose close failed is left as it
  was.
- Step 4 (Send) was accepted by Joel on 2026-10-12. It is `sendPlan.ts`: `sendCandidates` picks the lines, `planSend` resolves
  tokens and parents, `runSend` makes the calls (quick add, then a rename if a single `#`
  or `@` was escaped, then a move for a subtask) and `sendEdits` links the lines.
  `runSend` never throws, because a created task must end up linked in the note. Unlike
  Fetch and Sync, Send is not safe to run twice: an unlinked line is sent again.
- Step 5 (automatic first fetch) was accepted by Joel on 2026-10-12. A query block with
  no `filter:` line runs with the default filter, which `planFetch` then writes into the
  block. The step is `noteOpened` and `fetchOnOpen` in `index.ts`, with
  the pure decisions in `autoFetch.ts`. It runs on `onNoteSelectionChange` and once at
  start, after a short settle delay. It reads the saved note first and only touches the
  editor when a block is waiting, then polls until the editor's text equals the saved
  body, because the editor may still show the previous note when the event fires.
  Commands and the automatic fetch are serialized through `inTurn`, since the editor
  script follows one session at a time.
- Step 6 (Display) was accepted by Joel on 2026-10-12. `blockDisplay.ts` holds the
  pure parts: where the query blocks are, which ones the selection touches, the chip text
  and the HTML for the rendered note, where the block is never shown. `editor.ts` collapses a block to a chip with a block
  replace decoration from a CM6 state field (a view plugin may not replace across lines),
  kept in a `Compartment` that the "Collapse query block in editor" setting turns on and
  off. The script asks `index.ts` for that setting and for "Show the filter in the query
  block chip" with `postMessage`, like `joplin-inline-tag-style` does for its colors.
  `viewer.ts` (markdown-it) overrides the `fence` renderer for `todoist` blocks only. It
  writes Joplin's `joplin-editable` and `joplin-source` structure, so the Rich Text editor
  restores the block from its source on save, and `viewer.css` hides it. Joel chose to
  have no chip and no setting for the rendered note.
- Problems are reported in a plugin dialog with one OK button (`showProblem` in
  `index.ts`), not `showMessageBox`, which always adds a Cancel button. Joplin sizes a
  plugin dialog from `#joplin-plugin-content`, which stays 200px wide unless that element
  itself is given a width, so the dialog's HTML sets it in a `<style>` tag.
- All note changes go through the CM6 content script `src/editor.ts`, never the data API
  (the open editor ignores data API writes while it has unsaved typing). A command first
  runs `todoistSyncGetState`, which returns the live text and opens a session that records
  later document changes. It then sends `TextEdit`s (`edits.ts`) to `todoistSyncApplyEdits`,
  which maps them through those changes and applies them as one transaction. Each edit names
  the text it depends on and a group. A group is skipped whole if any of its text changed.
- `src/editorApi.ts` holds the command names and shapes shared by `index.ts` and
  `editor.ts`. `index.ts` must not import `editor.ts` itself, or webpack tries to bundle
  `@codemirror/*` into the main script and fails.
- `@codemirror/state` is a dev dependency for tests only (`test/fetch.test.ts` applies
  edits through a real CodeMirror document). At runtime Joplin supplies it.
- `npm test` compiles `test/*.test.ts` and the modules they import with
  `tsconfig.test.json` into `build-test/` (git-ignored) and runs them with Node's built-in
  test runner. `test/applyEdits.ts` is a helper shared by the tests, not a test file. The recurring task tests in `test/syncRules.test.ts` are numbered to match
  SPEC.md section 7.1.
- `tools/verify-todoist-api.mjs` checks Todoist API behaviour against a real account. Joel
  runs it himself with `TODOIST_TOKEN` set in his own terminal, and it writes
  `tools/verify-todoist-api.out.txt` (git-ignored) for Claude to read. Never ask for the
  token.
- Interactive tests against Joel's real account use a throwaway Todoist project that Claude
  creates through the Todoist connector and deletes afterwards. Joel works in Joplin, Claude
  does and checks the Todoist side.

## My Preferences
  - Writing style
     - Don't use em dashes in any written copy (site content, commit messages, etc.). Use a comma, period, or restructure the sentence instead.
  - Version Control
     - Only commit to the repo when asked.
     - When committing, include untracked files.
     - When committing, if there are unstaged changes predating your session, please include them.
     - When committing, you should not push to origin until I tell you to.
  - I store our shared to-do list in TODO.md, one per plugin, inside that plugin's directory (for example `joplin-todoist-sync/TODO.md`). A root TODO.md is only for items that apply to the whole repo. Please create it if it doesn't exist already. To-dos should be deleted once complete, but only after I confirm this is ok.
  - When I add a new plug-in to the repo, update CLAUDE.md to ensure current context.