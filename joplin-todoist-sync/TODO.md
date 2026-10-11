# TODO

## Where we left off (2026-10-11)

Build step 3 (Sync) is built. The interactive session of SPEC.md section 7.1 is in
progress, against the `SyncTest` project in Todoist (id `6hjW697Jx7qFfPV4`) and a test note
in Joplin with a `filter: #SyncTest` query block. Joel ticks boxes and runs Sync in Joplin.
Claude does the Todoist side through the Todoist connector and checks the result there.

On another computer: install `publish/com.joelberger.todoist-sync.jpl`, restart Joplin, and
set the API token under Options > Todoist Sync if it did not come across.

Section 6.1 has not been tried yet (the four "ST plain" tasks: A tick in Joplin, B complete
in Todoist, C rename and change priority in Todoist, D delete in Todoist).

| Scenario | Status |
|---|---|
| 1 | Passed. "ST daily 1" closed once, now due Oct 12, second Sync did nothing. |
| 2 | Passed. "ST daily 2" unchecked, still due Oct 11. |
| 3 | Passed. "ST daily 3" completed in Todoist, box stayed unchecked. |
| 4 and 5 | **Next.** Claude completed "ST daily 4" in Todoist (now due Oct 12). Joel still has to tick it and run Sync. Expected: a dialog naming it as already moved on, link removed, task still due Oct 12. |
| 6 | To do. Paste the weekly line below, run Sync: one close, task moves to Oct 24. |
| 7 | To do. Tick "ST overdue 7" (line date Oct 6): one close. |
| 8 | To do. Joel postpones "ST daily 8" in Todoist by hand, then ticks it: link removed, no close. |
| 9 | To do. Needs the same line in two notes. |
| 10 | To do. Paste the twice-a-day line below: link removed, no close. |
| 11 | To do. Delete `#2026-10-11` from the "ST daily 11" link, tick it: one close while it is due today or earlier. |
| 12 | To do. Complete "ST ending 12" in Todoist so its recurrence ends, then Sync: box is checked. |
| 13 | Passed. Fetch left out the weekly and the twice-a-day task (12 of 14 fetched). |
| 14 | To do. Run Fetch again: nothing is added. |
| 15 | Belongs to build step 5 (automatic first fetch). |

Lines to paste by hand, for the two tasks Fetch holds back. The dates assume Oct 11. On a
later day, check the tasks' due dates first.

```
- [x] ST weekly 6 [↗](https://app.todoist.com/app/task/6hjW6CVjfrgQv57W#2026-10-17)
- [x] ST twice a day 10 [↗](https://app.todoist.com/app/task/6hjW6CWWXm4PMPP4#2026-10-11T21:00)
```

Changed during the session, at Joel's request: Sync refuses a note that links one task on
more than one line, "already moved on" is named in the dialog, Sync first fetches a query
block that has never run, and the Fetch toast gives only the number of tasks added.

## During the build

- [ ] Add a command that removes the Todoist links from the current note, leaving plain
  checkbox lines (Joel, 2026-10-11). Different from "Remove dead Todoist links" (SPEC.md
  section 6.4), which only unlinks lines whose task no longer exists. Decide whether it
  covers the whole note or the selection, and add it to SPEC.md.

- [ ] Test the recurring task rules together, interactively, against the real Todoist
  account (SPEC.md section 7.1, build step 3). Run the scenarios one at a time. Joel reviews
  each result in Joplin and in Todoist before moving on, and signs off before Sync is
  accepted.

- [ ] Add keyboard shortcuts for the commands, and toolbar buttons with icons (build step
  7). Decide with Joel which keys and which commands get a button.

- [ ] Delete the `SyncTest` project in Todoist, with its tasks, and the Joplin test note,
  once the interactive session is finished. Claude created the project on 2026-10-11 for
  that session.

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
