# Inline Tag Style

Makes inline `#tags` stand out while writing, and gets them out of the way while reading.

- **Markdown editor**: every inline tag is shown as a tinted pill.
- **Rendered note**: inline tags are hidden, or shown as plain words where they are part of a sentence.

Requires the CodeMirror 6 Markdown editor (the default since Joplin 3.0).

## What counts as a tag

A `#` at the start of a line or after a space, running up to the next space or punctuation mark, for example `#Project/AIDLC`. This is the same rule the `joplin-tag-sync` skill uses. Two exceptions are left alone because they are nearly always prose: single characters (`Phone #s`) and plain numbers (`see #2`).

Tags are ignored inside YAML front matter, code, link targets, HTML and math.

## Rendered note details

A tag that trails a line is hidden:

| Markdown | Rendered |
| --- | --- |
| `## AIDLC Readout #Project/AIDLC` | AIDLC Readout |
| `- [ ] AIDLC Goal 2 scope #Person/Chris-Koch` | AIDLC Goal 2 scope |

A tag with more of the sentence after it is shown as words: the last segment of the tag, with dashes and underscores as spaces.

| Markdown | Rendered |
| --- | --- |
| `- #Person/Juan-Gutierrez to draft the framework` | Juan Gutierrez to draft the framework |
| `Asked #Person/Kelly-Walter, #Person/Chuck-Zollinger to review` | Asked Kelly Walter, Chuck Zollinger to review |

Other rules:

- Text that starts with a symbol or emoji does not count as more of the sentence, so the tags in `## Year-End Feedback #Performance ⏱️ 08:30-09:00` are hidden. A link whose text starts with a symbol counts the same way, so the tag in `Send the budget #Q4 [↗ p1](https://...)` is hidden too.
- A heading or list item that contains only tags shows them as words, since hiding them would leave an empty heading or a bare bullet.
- A paragraph that contains only tags is hidden entirely, so it leaves no gap.
- A line of only tags inside a longer paragraph is hidden along with its line break.
- A comma between two hidden tags is hidden with them.
- A tag that ends a sentence as its object (`Met with #Person/Juan-Gutierrez`) is hidden like any other trailing tag.

The tags are hidden with CSS rather than removed from the rendered HTML, and the words are CSS generated content. That keeps the tags safe if a note is opened in the Rich Text editor, which saves by converting the rendered HTML back to Markdown.

## Settings

Under Settings > Inline Tag Style:

- **Tag background color** and **Tag text color** set the editor pill's colors. Each takes any CSS color, such as `#59BEC9` or `rgba(89, 190, 201, 0.22)`. Leave one blank to use the default for the current theme. Changes apply as soon as they are saved.

## Customizing further

The rest of the editor pill can be restyled in `userchrome.css`:

```css
.cm-editor .cm-inline-tag {
	border-radius: 3px;
	font-weight: 700;
}
```

Show the raw tags in the rendered note again, in `userstyle.css`:

```css
.inline-tag { display: inline; }
.inline-tag-label::after { content: none; }
p.inline-tags-only { display: block; }
```

For information on how to build the plugin, see [GENERATOR_DOC.md](./GENERATOR_DOC.md).
