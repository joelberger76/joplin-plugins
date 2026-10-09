# Alternate Checkboxes

Renders Obsidian Minimal-style alternate checkboxes as icons, in both the rendered note and the Markdown editor.

```markdown
- [ ] to-do (Joplin built-in)
- [x] done (Joplin built-in)
- [/] incomplete
- [-] canceled
- [>] forwarded
- [!] important
```

## Supported characters

| Syntax | Meaning | Syntax | Meaning |
| ------ | ------- | ------ | ------- |
| `- [/]` | incomplete | `- [i]` | information |
| `- [-]` | canceled | `- [S]` | savings |
| `- [>]` | forwarded | `- [I]` | idea |
| `- [<]` | scheduling | `- [p]` | pros |
| `- [?]` | question | `- [c]` | cons |
| `- [!]` | important | `- [f]` | fire |
| `- [*]` | star | `- [k]` | key |
| `- ["]` | quote | `- [w]` | win |
| `- [l]` | location | `- [u]` | up |
| `- [b]` | bookmark | `- [d]` | down |

Characters are case sensitive. Anything not in the table (`- [1]`, `- [z]`) is left as plain text.

## Install

In Joplin: Settings, Plugins, gear menu, "Install from file", then pick
`publish/com.joelberger.alternate-checkboxes.jpl` and restart Joplin.

## Behaviour and limits

- **Rendered note**: the marker is replaced by its icon.
- **Markdown editor**: the list mark and marker (`- [/]`) are replaced by the same icon, the way Joplin's editor already draws `- [ ]` as a checkbox. The raw text comes back while the cursor or selection touches the marker. A cursor elsewhere on the line leaves the icon in place, which is how the built-in checkboxes behave. Requires the CodeMirror 6 editor (the default since Joplin 3.0).
- Icons are display only. Clicking one in the rendered note does nothing; clicking one in the editor places the cursor there and shows the raw marker.
- Bullet lists only (`-`, `*`, `+`); numbered lists are left alone.
- To show a marker literally, escape the bracket: `- \[/] text`.
- The Rich Text editor does not know this syntax. Editing a note there may rewrite or drop the markers.

## Customising

Edit `src/taskTypes.json` (character, label, [Lucide](https://lucide.dev/icons) icon name, colour), then:

```
npm install
npm run icons   # regenerates src/altCheckboxes.css and src/taskIcons.json
npm run dist    # builds publish/*.jpl
npm test        # checks the rule against markdown-it
```

Colours can also be overridden without rebuilding. For the rendered note, in `userstyle.css`:

```css
li.alt-checkbox[data-task="!"] { --alt-checkbox-color: crimson; }
```

For the editor, in `userchrome.css`:

```css
.cm-editor .cm-alt-checkbox[data-task="!"] { --alt-checkbox-color: crimson; }
```

Icons are from Lucide (ISC licence).

For information on how to build the plugin, see [GENERATOR_DOC.md](./GENERATOR_DOC.md).
