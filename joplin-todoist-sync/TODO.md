# TODO

## During the build

- [ ] Test the recurring task rules together, interactively, against the real Todoist
  account (SPEC.md section 7.1, build step 3). Run the scenarios one at a time. Joel reviews
  each result in Joplin and in Todoist before moving on, and signs off before Sync is
  accepted.

- [ ] Add keyboard shortcuts for the commands, and toolbar buttons with icons (build step
  7). Decide with Joel which keys and which commands get a button.

## v2

- [ ] Picker for ambiguous `##` and `@@` names. When a token matches more than one project
  or label (for example `@@Joel` with labels Joel Berger and Joel Ferber), ask which one was
  meant and carry on, instead of skipping the line and reporting it. v1 skips and reports
  (SPEC.md sections 3.5 and 4).
- [ ] Style the task details in the link (SPEC.md section 3.3) as pills or chips in the
  Markdown editor and the rendered note, instead of plain link text. Joel is not happy with
  how `##Project` and `@@Label` read as plain text (2026-10-11), so this should replace
  those marks with something nicer on screen while the note text stays as it is. For example a colored
  priority flag, a date chip that turns red when overdue, and project and label pills like
  the ones in `joplin-inline-tag-style`. Display only: the note text stays as it is.
- [ ] Tick the box in Joplin when a recurring task is completed in Todoist (the known gap in
  SPEC.md section 7). Todoist's `completed_count` goes up by one on completion and
  `postponed_count` on postponing (tested 2026-10-11), so the two can be told apart. It
  needs the count at fetch time kept per line, and a decision on where to keep it without
  cluttering the link text.
