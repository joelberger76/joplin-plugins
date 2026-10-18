# Wrap Selection

In Joplin's Markdown editor, typing `*`, `_`, `~` or `=` while text is selected wraps the selection in that character instead of replacing it, the way Obsidian does. The text stays selected, so typing the character again wraps it again:

- `*` once gives `*italic*`, twice gives `**bold**`
- `~` twice gives `~~strikethrough~~`
- `=` twice gives `==highlight==`
- `_` works like `*`

With several selections, every selected range is wrapped. Typing with no selection works as before.

Backticks, brackets and quotes are not handled here, because Joplin already wraps a selection in those when **Tools > Options > Note > Auto-pair braces, brackets, quotes, etc.** is on.

Requires the CodeMirror 6 Markdown editor (the default since Joplin 3.0). It does nothing in the Rich Text editor.

## Install

Tools > Options > Plugins > gear icon > Install from file, then pick `publish/com.joelberger.wrap-selection.jpl` and restart Joplin.

For building, see [GENERATOR_DOC.md](./GENERATOR_DOC.md).
