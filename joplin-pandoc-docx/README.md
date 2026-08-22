# Pandoc DOCX Export (Joplin plugin)

Adds Tools > "Convert note to DOCX (pandoc)". It takes the currently open
note, runs its Markdown body through `pandoc`, and opens the resulting
.docx in your default app (Word, etc.) on macOS, Windows, or Linux.

## Requirements

- pandoc installed and on your PATH. On macOS: `brew install pandoc`
- Node.js and npm to build the plugin (see below). A prebuilt `dist/`
  and `publish/*.jpl` are included, so this is only needed if you're
  changing the code.

## Settings (Tools > Options > Pandoc DOCX Export)

- **Path to the pandoc executable** — leave as `pandoc` if it's on your
  PATH, otherwise the full path (e.g. `/opt/homebrew/bin/pandoc`).
- **Extra pandoc arguments** — optional, space-separated pandoc options
  appended to the conversion command, e.g.
  `--reference-doc="/path/to/template.docx" --toc -V geometry:margin=1in`.
  Quote any value containing spaces.

## Installing

There are two ways to load a Joplin plugin. They behave differently in
one important way, described below — pick based on whether you're
actively editing the code.

### Option A: install the .jpl (recommended once you're done editing)

1. Tools > Options > Plugins > gear icon > "Install from file."
2. Pick `publish/com.joel.pandocdocx.jpl` from this folder.
3. Restart Joplin.

### Option B: Development plugins path (for actively editing the code)

1. Tools > Options > Plugins > Advanced Settings.
2. Paste the full path to this project folder into "Development plugins."
3. Restart Joplin.

**Caveat:** Joplin hard-codes a behavior for anything loaded this way —
any plugin loaded via "Development plugins" gets `devMode: true`
internally, and Joplin's `PluginRunner` unconditionally opens a detached
DevTools window for that plugin 3 seconds after every launch. There's no
setting to turn this off; it's intended for active plugin development.
If that gets annoying, switch to Option A. Don't run both at once for
the same plugin — same manifest `id` loaded twice causes conflicts.

## If pandoc isn't found

Joplin desktop apps launched from Finder/Dock (macOS) or a desktop menu
often don't inherit your full shell PATH, so `pandoc` can be invisible to
the plugin even though it works fine in a terminal. The plugin widens
PATH with common install locations (`/usr/local/bin`, `/opt/homebrew/bin`,
etc.) automatically, but if it still can't find pandoc:

1. Run `which pandoc` in a terminal to get the full path.
2. Paste that full path into the "Path to the pandoc executable" setting.

## Known limitations

- **Embedded images and internal note links.** Joplin stores attached
  images/files as internal resources (`![](:/resource_id)`) and links
  between notes the same way (`[title](:/note_id)`). Pandoc can't resolve
  those — they only mean something inside Joplin's own database. Pure-text
  notes convert cleanly; notes with embedded images will lose them.
  Exporting resources to the temp folder and rewriting links to point at
  them is a reasonable next step if you need it.
- **Temp files.** Each conversion writes a `.md`/`.docx` pair into a
  fresh folder under your OS temp directory (`os.tmpdir()`), which on
  macOS is your per-user `$TMPDIR` under `/var/folders/.../T/`. macOS
  cleans these up on its own (by default, files unaccessed for 3 days get
  swept by a daily periodic job), so nothing needs to be deleted manually.
  Folders accumulate one-per-conversion until then.

## Rebuilding from source

```
npm install
npm run dist
```

This is the actual official Joplin plugin build pipeline (copied from
`generator-joplin` in the Joplin monorepo, not hand-rolled), and running
it produces both:

- `dist/index.js` + `dist/manifest.json` — used by the Development
  plugins install path (Option B)
- `publish/com.joel.pandocdocx.jpl` — the installable package for
  Option A, plus `publish/com.joel.pandocdocx.json` (plugin metadata,
  only relevant if you ever publish it)

`npm install` alone triggers a full rebuild via its `prepare` script, so
after editing `src/index.ts`, `npm install` (or `npm run dist` directly if
`node_modules` already exists) is all you need before reinstalling the
`.jpl` or reloading the dev plugin.

Two things worth knowing if you extend `src/index.ts`:

- `target: 'node'` in `webpack.config.js` is what allows using Node's
  `child_process` (to call pandoc) without webpack trying to bundle it for
  a browser environment — a common failure mode for Joplin plugins that
  shell out to external tools.
- `joplin.settings.registerSetting()` (singular) is deprecated and now
  hard-errors on current Joplin versions. Use
  `joplin.settings.registerSettings({ key: {...} })` (plural, takes an
  object of settings) instead, as this plugin already does.

## Source layout

- `src/manifest.json` — plugin metadata (id, version, description)
- `src/index.ts` — all plugin logic
- `api/` — Joplin's plugin API type definitions (for TypeScript; not
  something you need to edit)
- `webpack.config.js`, `tsconfig.json`, `plugin.config.json` — build
  config, copied from Joplin's own current plugin generator
