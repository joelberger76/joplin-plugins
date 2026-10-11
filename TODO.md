# TODO

Repo-wide items only. Each plugin keeps its own `TODO.md` in its directory.

## Plugin ideas

- [ ] Sticky headings in the Markdown editor, like Nova's sticky scroll: the headings that
  enclose the top visible line stay pinned at the top of the editor, stacked by level, and
  clicking one jumps to it. Approach: a CodeMirror 6 top panel updated on scroll, with a
  heading scan like the one in `joplin-copy-heading-link`. Before building, check whether an
  existing Joplin plugin already does this. Markdown editor first. The rendered note would
  need its own script and can come later.
