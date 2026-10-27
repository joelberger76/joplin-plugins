# TODO

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
- [ ] Fetch can return more tasks than the Todoist app shows for the same filter. On the API
  (`/tasks/filter`, tested 2026-10-20), `today` also matches a task whose deadline is today
  and that has no due date. `today & no time` and `today & due before: +0 hours` don't match
  it on their own, but the two OR'd together do. So Joel's filter
  `overdue | (today & no time) | (today & due before: +0 hours) & !@blocked` fetched
  "Perform 2026 Year-End calibration" (deadline 2026-10-20, no due date), which the app
  leaves out. Joel left it as it is because he wants reached deadlines shown anyway. If we
  come back to it, this filter does the same on purpose and should match the app (checked on
  the API only):
  `((overdue | (today & no time) | (today & due before: +0 hours) & !@blocked) & !no date) | deadline before: tomorrow`.
  The `!@blocked` placement is intentional. With this filter a blocked task whose deadline has
  passed still shows. Use `| (deadline before: tomorrow & !@blocked)` to hide those too. The
  other option is a plugin-side fix: drop tasks with no due date unless the filter asks for
  them, which needs a fragile guess about the filter.
