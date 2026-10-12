# TODO

## Where we left off (2026-10-12)

All seven build steps of SPEC.md section 12 are done and accepted by Joel. Step 6 (Display)
and step 7 (Wrap-up) were accepted on 2026-10-12, each after rounds in the app against his
real Todoist account. The "Remove dead Todoist links" command was built and then dropped
at his request.

Not seen in the app: the tag that stays hidden before a Todoist link in the rendered note
(the `joplin-inline-tag-style` change), the dialog for a failed automatic fetch, a command
started while an automatic fetch is running, and the Send failures that only unit tests
cover (Todoist refusing a line, a lost connection, switching notes while sending, editing
a line while it is sent).

No test data is left in Todoist. For any later interactive session, Claude creates a
throwaway project through the Todoist connector and deletes it afterwards.

On another computer: install `publish/com.joelberger.todoist-sync.jpl`, restart Joplin, and
set the API token under Options > Todoist Sync if it did not come across.

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
