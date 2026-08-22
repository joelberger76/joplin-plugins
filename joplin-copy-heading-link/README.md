# Copy Heading Link (Joplin plugin)

Adds a "Copy heading link" command (Edit menu, editor toolbar button, and
`Cmd/Ctrl+Shift+L`). Place the cursor on or under a heading and run it to
copy a Markdown link to that heading to the clipboard, e.g.:

```
[Note Title # Heading Text](:/1234567890abcdef1234567890abcdef#heading-text)
```

Paste that into another note (or anywhere else) to link straight to that
section.

## Why this exists

This is a fork of [hieuthi's Copy Anchor Link
plugin](https://github.com/hieuthi/joplin-plugin-copy-anchor-link), which
adds a row of 🔗 icons next to every heading in the *rendered note preview*
that you click to copy a link. Two problems with that approach prompted
this fork:

- The icons are visible clutter next to every heading.
- Clicking them copies rich HTML (since it's driven by the rendered
  preview), so when pasted into Outlook, the icon glyph and its markup ride
  along with the link.

This plugin instead works entirely from the Markdown editor: no icons are
injected into notes at all, and the clipboard only ever gets a plain
Markdown link (plain text, no HTML), so nothing extra can ride along when
pasted elsewhere.

## How the link is built

The link format matches the original plugin's default "GF" (Global, Full)
style: `[Note Title # Heading Text](:/noteId#slug)`.

The anchor slug is computed with
[`@joplin/fork-uslug`](https://www.npmjs.com/package/@joplin/fork-uslug) —
the same slugify package Joplin's own renderer
(`@joplin/renderer`/`markdown-it-anchor`) uses to assign heading ids in the
note preview — so the generated link resolves to the same place the
preview's anchor would. Duplicate heading text is disambiguated the same
way `markdown-it-anchor` does by default: the first occurrence of a slug is
left bare, and each later occurrence gets `-1`, `-2`, etc. appended.

## Known limitations

- **ATX headings only** (`#` through `######`). Setext-style headings
  (a line of text followed by a line of `===` or `---`) aren't recognized.
- **Inline Markdown in headings** (bold, italic, inline code, links) is
  stripped with regexes to approximate the plain text the renderer would
  show, since this plugin reads the raw Markdown source rather than the
  rendered output. This covers the common cases but isn't a full CommonMark
  inline parser, so unusual formatting may produce a slightly different
  slug than the actual preview.
- Fenced code blocks are tracked so a `#`-prefixed line inside one isn't
  mistaken for a heading, but the fence detection is a regex heuristic, not
  a full parser.

## Installing

There are two ways to load a Joplin plugin. They behave differently in
one important way, described below — pick based on whether you're
actively editing the code.

### Option A: install the .jpl (recommended once you're done editing)

1. Tools > Options > Plugins > gear icon > "Install from file."
2. Pick `publish/com.joelberger.copy-heading-link.jpl` from this folder.
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

## Rebuilding from source

```
npm install
npm run dist
```

`npm install` alone triggers a full rebuild via its `prepare` script, so
after editing source, `npm install` (or `npm run dist` directly if
`node_modules` already exists) is all you need before reinstalling the
`.jpl` or reloading the dev plugin.

## Source layout

- `src/index.ts` — plugin entry point. Registers the content script,
  the `copyHeadingLink` command, the Edit-menu item, and the toolbar
  button. Forwards to the editor's registered command via
  `editor.execCommand`, then takes its result (heading text + slug) and
  the current note's id/title to build the link and write it to the
  clipboard.
- `src/contentScript.ts` — the CodeMirror 6 content script where the real
  work happens: scans the document for ATX headings (skipping fenced code
  blocks), finds the one at or above the cursor, and computes its anchor
  slug via `@joplin/fork-uslug` with the same duplicate-numbering scheme
  `markdown-it-anchor` uses.
- `src/manifest.json` — plugin metadata (id, version, description)
- `api/` — Joplin's plugin API type definitions (for TypeScript; not
  something you need to edit)
- `webpack.config.js`, `tsconfig.json`, `plugin.config.json` — build
  config, copied from Joplin's own current plugin generator
