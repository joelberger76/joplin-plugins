# TODO

## Where we left off (2026-10-11)

Build step 3 (Sync) is accepted. Joel signed off on 2026-10-11, after scenarios 1 to 14 of
SPEC.md section 7.1 and the four cases of section 6.1 all passed against his real Todoist
account. Scenario 15 belongs to build step 5 (automatic first fetch).

Next is build step 4 (Send).

The `SyncTest` project in Todoist is deleted. For the next interactive session, Claude
creates a new test project through the Todoist connector, and Joel makes a test note with a
query block for it. Joel ticks boxes and runs the commands in Joplin. Claude does the
Todoist side and checks the result there.

On another computer: install `publish/com.joelberger.todoist-sync.jpl`, restart Joplin, and
set the API token under Options > Todoist Sync if it did not come across.

## During the build

- [ ] Add a command that removes the Todoist links from the current note, leaving plain
  checkbox lines (Joel, 2026-10-11). Different from "Remove dead Todoist links" (SPEC.md
  section 6.4), which only unlinks lines whose task no longer exists. Decide whether it
  covers the whole note or the selection, and add it to SPEC.md.

- [ ] Add keyboard shortcuts for the commands, and toolbar buttons with icons (build step
  7). Decide with Joel which keys and which commands get a button.

- [ ] Decide how fetched tasks are sorted. Fetch writes them in the order Todoist's filter
  endpoint returns them (SPEC.md section 5.2), which is not the order the project shows in
  Todoist (Joel, 2026-10-11, seen with the `SyncTest` project).

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
