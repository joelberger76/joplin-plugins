# joplin-todoist-sync: specification

Status: draft 5, 2026-10-12. Build steps 1 to 5 are done. Every Todoist API assumption has been
tested live (section 9.1). A few items remain that can only be checked in the Joplin app
during the build (section 9.3). Section 12 is the build order.

## 1. Goal

Work with Todoist tasks from inside a Joplin note:

- Turn checkbox lines in a note into Todoist tasks (Send).
- Bring Todoist tasks matching a filter into a note as checkbox lines (Fetch).
- Keep completion, task names and the displayed task details in step between linked lines
  and their tasks (Sync).

The main use case is a daily journal note, created from a template, that brings in the day's
tasks when it is first opened.

## 2. Principles

1. **The note text is the only state.** The plugin stores no hidden data. Everything it
   needs (which task a line belongs to, whether a query has run) is written in the note, so
   it travels with the note to every device and can be read and fixed by hand.
2. **The plugin never deletes in Todoist.** It only creates, updates, closes tasks.
3. **A missing line or a missing link means nothing.** Removing either simply ends the
   relationship. The Todoist task is left as it is.
4. **Manual by default.** The one automatic action is the first fetch of a new query block
   (section 5.3).
5. **Never guess.** If a line can't be handled with certainty (ambiguous project, API error,
   line edited mid-sync) it is left untouched and reported.
6. **Current note only.** Every command and the automatic fetch read and change the note
   that is open, and nothing else.

## 3. Note syntax

### 3.1 Checkbox lines

A task line is a bullet list item (`-`, `*` or `+`) with a `[ ]` or `[x]`/`[X]` checkbox.
Numbered lists, alternate checkboxes (`[/]`, `[>]` and so on) and anything inside a code
block are ignored.

### 3.2 Linked lines

A line is linked when it ends with a Markdown link to a Todoist task:

```
- [ ] Call the plumber [↗](https://app.todoist.com/app/task/6XGgm6PHrGgMpCFX)
```

- The task name is the text between the checkbox and that trailing link.
- The link is recognized by its URL, not by its text.
- Deleting the link unlinks the line.

### 3.3 Task details in the link

The link text carries the task's details, so they are visible without being part of the
task name:

```
- [ ] Send the budget #Q4 [↗ p1 · ##Work · @@Joel Berger](https://app.todoist.com/app/task/6XGgm6PHrGgMpCFX)
- [ ] Take vitamins [↗ ↻ · p1](https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr#2026-10-12)
```

| Part | Shown as | Left out when |
|---|---|---|
| Recurring | `↻` | not recurring |
| Priority | `p1`, `p2`, `p3` | p4 (the default) |
| Project | `##Name`, the full project name | Inbox |
| Labels | `@@Name` each, the full label name | none |

- Parts are joined with ` · `. A task with no details has the link text `↗` alone.
- Due dates are not shown.
- Project and labels use the same `##` and `@@` marks as the tokens typed before sending. They show the
  full resolved name, so `@@Joel` typed before sending comes back as `@@Joel Berger`. A
  single `#` or `@` is never written, so nothing here can become a Joplin tag or mention.
- The details are display only. The plugin rewrites them from Todoist on every Send, Fetch
  and Sync. Editing them by hand changes nothing in Todoist and is overwritten.
- A setting turns the details off, leaving `↗` alone.

### 3.3.1 The occurrence in a recurring line's URL

A recurring line also carries the date of the occurrence it stands for. It is not in the
visible text. It sits at the end of the link's URL, after a `#`:

```
https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr#2026-10-12
https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr#2026-10-12T09:30
https://app.todoist.com/app/task/6XGgmFVcrG5RRjVr#2026-10-12T14:00Z
```

- The second form is for a task due at a time of day.
- The third form is for a time in a fixed timezone. It is in UTC, so it reads the same on
  a device in another timezone. Links written before 2026-10-12 have such a time in the
  second form, in local time, and Sync still accepts that on a device in the same
  timezone.
- Todoist ignores that part of the URL, so the link opens the task as usual (checked by
  Joel on 2026-10-11).
- It is written by Fetch or Send and is **pinned**: Sync never refreshes it, because it
  says which occurrence the line stands for (section 7).
- It always includes the year, because a yearly task comes back on the same day and month
  and the two occurrences must not be confused.
- It is written whatever the "Show task details" setting says.

### 3.4 Query blocks

````
```todoist
filter: today | overdue
fetched: 2026-10-10 08:31
```
````

- `filter:` is any Todoist filter query. It is sent to Todoist exactly as
  written, so it uses Todoist's own filter syntax and none of this plugin's:
  - `#Work` is a project, `##Work` is a project with its sub-projects, `@errand` is a label.
    `@@` means nothing in a filter.
  - A name with a space needs a backslash before the space: `@Amy\ Berger`. Names are not
    matched loosely here the way `##` and `@@` tokens are in a task line (section 3.5).
  - Todoist reports a filter it can't read as an error. It does not report an unknown
    project or label, it just returns no tasks.
- A block with no `filter:` line, or an empty one, is run with the default filter from
  the settings. That filter is then written into the block as its `filter:` line, so the
  note says what was fetched and a later change of the setting does not change the block.
  If the setting is empty too, the block is not run and Fetch and Sync report it.
- `fetched:` is written by the plugin after each run. A block without it has never run.
  Deleting the line re-arms the automatic first fetch.
- Other lines are kept as they are and ignored.

### 3.5 Tokens for sending

In an unlinked line, before it is sent:

| Written | Meaning |
|---|---|
| `##Name` | Put the task in this Todoist project |
| `@@Name` | Add this Todoist label (can be repeated) |
| `tomorrow`, `every mon`, `p1` and other Todoist date and priority words | Parsed by Todoist |
| `#tag`, `@name` (single) | Plain text. Never read as project or label. |

The rest of Todoist's quick add syntax is passed through as typed, because the name goes
to quick add: `{friday}` sets a deadline, `!30m` a reminder, and ` // some text` at the end
becomes the task's description. Only `#` and `@` are protected.

`##` and `@@` do not match the inline tag pattern used by `joplin-inline-tag-style` and the
`joplin-tag-sync` skill, so they are never treated as Joplin tags.

A token runs to the next space. For a name with spaces there are three ways to write it,
all equivalent, shown here for a project called `Home Reno`:

| Written | Why it works |
|---|---|
| `##HomeReno` or `##home-reno` | spaces, dashes, underscores and case are ignored |
| `##Home\ Reno` | a backslash before a space keeps the token going, as in Todoist |
| `##Home` | partial match, if no other project matches |

Name matching for `##` and `@@` is done by the plugin against the account's project and
label lists, ignoring case, spaces, dashes and underscores:

1. An exact match wins.
2. Otherwise a single name that starts with the token wins (`@@Joel` matches `Joel Berger`).
3. Otherwise a single name that contains the token wins.
4. If nothing matches, or more than one name matches at the same step, the line is not
   sent and the report lists the candidates. Projects and labels are never created.

## 4. Send

Command: **Send tasks to Todoist**. Called Send in this document.

- **Scope**: the lines touched by the selection if there is one, otherwise the whole note.
- **Candidates**: unchecked, unlinked task lines with a non-empty name. Checked unlinked
  lines are skipped.
- **Project**: the `##` token if present, otherwise the default project setting, otherwise
  the Inbox. A line with more than one `##` is not sent. The default project setting is
  matched like a `##` token (section 3.5). If it matches no project, or more than one,
  nothing is sent and the message says why.
- **Subtasks**: a candidate indented directly under another task line becomes a subtask of
  that line's task, whether the parent is sent in the same run or was already linked. A
  subtask always lives in its parent's project, so a `##` on it is ignored and reported. If
  the parent has no task (plain bullet, checked and unlinked, or outside the selection)
  the child is created as a top-level task. If the parent was meant to be sent in this run
  and was not, the lines under it are not sent either.
- **Failures**: a line that Todoist refuses is reported and the rest are still sent. A
  rejected token or a lost connection ends the run. Whatever was created up to then is
  linked in the note. A task that was created is always linked, also when its rename or its
  move under the parent failed. That failure is reported.
- **Not safe to repeat blindly**: if the note is switched away while tasks are being
  created, their lines can't be linked. The dialog then lists the tasks, because sending
  the lines again would create them a second time.
- **Result**: the line is rewritten as the task name Todoist returned plus the trailing
  link. Tokens, dates and priority words leave the name and reappear, tidied, as the
  details in the link (section 3.3). Indentation is kept. For example

  ```
  - [ ] Send the budget #Q4 ##work @@joel tomorrow p1
  ```

  becomes

  ```
  - [ ] Send the budget #Q4 [↗ p1 · ##Work · @@Joel Berger](https://app.todoist.com/app/task/...)
  ```
- **Report**: a short summary, for example "Created 4 tasks. 1 skipped: `@@Jo` matches Joel
  Berger and John Smith."

## 5. Fetch

Command: **Fetch tasks from Todoist**. Called Fetch in this document.

### 5.1 What is fetched

For each query block in the note, the open tasks matching its filter, except:

- tasks already linked anywhere in the note
- recurring tasks that are not available (section 7)

### 5.2 Where it goes

- Tasks are written as unchecked linked lines, with their details (section 3.3), directly
  below the block. If a list already follows the block, they are appended to the end of it.
- Order is the order Todoist shows (Joel, 2026-10-12). Tasks are grouped by project, in
  the order of the sidebar: the Inbox, then each project followed by its sub-projects.
  Within a project, the tasks outside any section come first, then each section in turn,
  and inside those the order arranged in Todoist. A subtask follows its parent when the
  parent was fetched too. This takes the project list on every fetch that finds a task,
  and the section list when a fetched task is in a section.
- The list is flat, subtasks included.
- **Add-only**: a fetch never removes or reorders existing lines. A line whose task no longer
  matches the filter stays, and Sync keeps it current.
- `fetched:` is set to the local date and time, also when there were no results.
- If the note has no query block, the command inserts one at the cursor with the default
  filter from settings and runs it.
- No blank line is added around the new lines, with one exception: when text follows
  directly, one blank line is put between the list and that text. Without it Markdown
  reads the text as part of the last task.

### 5.3 Automatic first fetch

When a note is opened and it contains a query block with no `fetched:` line, that block is
fetched once, automatically. A block with no filter counts when a default filter is set
(section 3.4).

- Template notes are never fetched automatically. A note is a template when it is inside a
  template notebook (setting, default `Templates`, sub-notebooks included) or carries the
  template tag (setting, default `template`). These are the two ways the Templates plugin
  marks its templates. Manual commands still work there.
- The note must be open in the Markdown editor (section 9.1, item 4).
- If the Todoist request fails, `fetched:` is not written, so the fetch is retried the next
  time the note is opened.
- A block added to a note that is already open (for example by inserting a template into
  it) runs on the next open or on a manual Fetch.
- "Opened" means the note is selected and stays selected for a moment, so moving through
  the note list with the arrow keys fetches nothing. The note that is open when Joplin
  starts counts as opened.
- Either setting can list several names, separated by commas. An empty setting turns that
  check off.
- It is silent when it can't run: no API token is set, the note is a template, or the
  Markdown editor does not show the note's saved text within a few seconds. The block then
  waits for the next open or a manual Fetch.
- It reports like the Fetch command (section 6.5): a toast when it worked, a dialog when a
  filter or the request failed. The dialog says that it came from the automatic fetch.
- Commands and the automatic fetch run one at a time. A command started while the
  automatic fetch is running waits for it.

## 6. Sync

Command: **Sync note with Todoist**. It covers every linked line in the current note, whatever
the selection. It does not create tasks. It does not run query blocks either, with one
exception: a block that has never run (no `fetched:` line) is fetched first, as Fetch would,
and the note is then synced. So Sync on a new note brings its tasks in.

If a task is linked on more than one line of the note, Sync stops before it asks Todoist
anything, changes nothing, and lists those lines. Two checked lines for one recurring task
would otherwise close it twice, which also completes its next occurrence.

### 6.1 Non-recurring tasks

| Box in note | Task in Todoist | Result |
|---|---|---|
| unchecked | open | nothing |
| unchecked | completed | box is checked |
| checked | open | task is closed |
| checked | completed | nothing |

Completion is one-way: once either side is complete, both become complete. To reopen a
task, uncheck the box and reopen the task in Todoist before the next sync.

Todoist completes a task's subtasks along with it. So after a checked parent line is
synced, the next Sync checks the boxes of its subtasks' lines as well.

### 6.2 Names

If the name in the line differs from the task's name, the line takes Todoist's name.
Todoist always wins. To rename a task, follow the link and rename it there.

The details in the link (section 3.3) are refreshed the same way, so a priority, project
or label changed in Todoist shows up in the note after the next Sync.

### 6.3 Missing tasks

If Todoist reports that the task does not exist, the line and its link are left as they are
and the line is listed in the report. Sync never removes such a link, because a wrong API
token makes every task look missing.

### 6.4 Remove links

Command: **Remove Todoist links** (Joel, 2026-10-11). It removes the link from every linked
line in the selection, or in the whole note when nothing is selected, the same scope rule
as Send. The lines become plain checkboxes and the tasks stay in Todoist.

- It asks for confirmation first, with the number of links, and warns that sending the
  lines again would create the tasks a second time.
- It asks Todoist nothing, so it works without an API token.
- This is also how a link to a task that no longer exists is cleared (section 6.3). A
  "Remove dead Todoist links" command, which looked those lines up and unlinked them
  after a confirmation, was built and then dropped on 2026-10-12: Joel would not use it.

### 6.5 Reporting

Used by all commands and the automatic fetch:

- **Nothing needs attention**: a brief toast that disappears by itself, for example "Synced
  12 tasks, 2 completed" or "Fetched 5 tasks". Fetch gives only the number of tasks it
  added, not how many matching tasks it left out.
- **Something was skipped or failed**: a dialog that stays until dismissed, with one line per
  problem giving the task name and the reason, for example "Not found in Todoist: Call the
  plumber" or "Not sent, `@@Jo` matches Joel Berger and John Smith: Email Jo".
- Nothing is written into the note to report a problem.
- Joplin keeps a plugin's last toast and shows it again when its main screen comes back,
  for example after Options is closed (seen by Joel on 2026-10-12, and confirmed in
  Joplin's `PluginNotification` component). So the plugin replaces each toast with an
  empty one once it has had its six seconds, which Joplin does not show.

## 7. Recurring tasks

This is the part that broke other tools, so it gets its own rules and its own tests.

**The problem.** Completing a recurring task in Todoist does not close it. Todoist moves the
due date to the next occurrence and the task stays open. A tool that treats "open" as "not
done" will uncheck the box again, or close the next occurrence as well.

**Rule 1, for Fetch: availability.** A recurring task is **available** when its due date is
today or earlier, in the device's local date. One that is not available is treated as
"nothing to do right now" (like an OmniFocus defer date) and is never fetched.

**Rule 2, for Sync: a line stands for one occurrence.** A recurring line's link URL ends
with the due date of the occurrence it was created for, for example `#2026-10-10` (section
3.3.1). That date is **pinned**: it is written by Fetch or Send and never refreshed. Sync
compares it with the task's due date in Todoist:

- **Same date**: the occurrence is still waiting. A checked box closes it.
- **Different date**: the task has moved on, because it was completed or rescheduled
  somewhere else. The line no longer stands for anything in Todoist, so the plugin never
  closes the task on its behalf.

No hidden data is involved. The pinned date is part of the link in the note's text.

| Situation | Result |
|---|---|
| Fetch, task available | fetched |
| Fetch, task due after today | not fetched, even if the filter matches |
| Sync, box unchecked, same date | nothing |
| Sync, box unchecked, different date | nothing (known gap, below) |
| Sync, box checked, same date | task is closed once (Todoist advances it), then the link is removed |
| Sync, box checked, different date | link is removed, the task is not closed, and the dialog names the task as already completed or rescheduled in Todoist |
| Sync, recurrence has ended and the task is completed | treated as non-recurring: box is checked |

"Nothing" means the box and the task are left alone. The name, priority, project and labels
are still refreshed as for any linked line. Only the date is pinned.

Details:

- A task due at a time of day is compared by date and time, so a task that recurs several
  times a day is handled the same way.
- A checked box with the same date closes the task even when that date is in the future.
  Ticking Saturday's task on Wednesday means it was done early.
- A recurring line always carries its date, even when the "Show task details" setting is
  off, because Rule 2 depends on it.
- If the date has been removed or mangled by hand, Sync falls back to availability: a
  checked box closes the task only if it is due today or earlier. Either way the link is
  removed.

**Why the link is removed.** Once a checked recurring line has been synced, its occurrence
is finished. Removing the link turns the line into a plain record that the plugin never
touches again.

**Known gap, accepted for v1.** Completing a recurring task in Todoist does not check its
box in Joplin. A different date could mean "completed" or "postponed", and the plugin won't
guess. Todoist does keep a completion counter per task that could tell the two apart, but
using it means remembering a number per line (see `TODO.md`, v2). Non-recurring tasks are
not affected.

### 7.1 Test scenarios (required)

These run as unit tests against the decision logic with a fixed "today".

They are then repeated against a real Todoist account, **interactively with Joel**: the
scenarios are run one at a time in a working session, and Joel reviews the result of each
in both Joplin and Todoist before the next one. Sync is not accepted until he has signed
off on all of them.

"Line Oct 10" means the link URL ends with `#2026-10-10`.

1. Daily task, line Oct 10, checked, synced on Oct 10: exactly one close call, link removed.
   Sync again on Oct 11: no Todoist call for that line.
2. Line Oct 10, unchecked, task not done and still due Oct 10. Sync on Oct 11: no change on
   either side.
3. Line Oct 10, unchecked. Task completed on the phone, now due Oct 11. Sync: box stays
   unchecked, the line still says Oct 10. This is the known gap and the test documents it.
4. **Across midnight.** Line Oct 10. Task completed on the phone on Oct 10, now due Oct 11.
   On Oct 11 the box is ticked and the note synced: link removed, no close call. Today's
   occurrence is untouched.
5. Completed on the phone and ticked in Joplin on the same day: link removed, no close call.
6. Weekly task, line Sat Oct 17, box checked on Wed Oct 14: one close call (done early),
   link removed.
7. Daily task five days overdue, line date equal to the task's due date, checked: exactly
   one close call.
8. Line Oct 10. Task postponed in Todoist to Oct 13, then the box is ticked: link removed,
   no close call, and the dialog names the task as already completed or rescheduled in Todoist.
9. The same occurrence linked and checked in two notes. Sync note A: one close, link
   removed. Sync note B: link removed, no close.
10. Task due twice a day, line `#2026-10-10T09:00`, already moved to 21:00 the same day in
    Todoist,
    box checked: link removed, no close call.
11. Line whose date was deleted by hand, checked. Task due today: one close call. Task due
    tomorrow: no close call. Link removed in both cases.
12. Task with an ended recurrence, completed in Todoist, box unchecked. Sync: box checked.
13. Query `#Work` matches a recurring task due next week. Fetch: not inserted.
14. Fetch the same query twice on the same day: the second fetch adds nothing.
15. Today's journal is created from the template: available recurring tasks appear once,
    each with `↻` and today's or an earlier date in its URL, and the `fetched:` line is
    written.

## 8. Display and settings

### 8.1 Query block display

- **Rendered note**: not shown, and the same in the Rich Text editor. There is no setting
  for it (Joel, 2026-10-12: a chip there has no use). The block's source stays in the HTML
  the way Joplin's own code blocks keep theirs, so the Rich Text editor does not drop it
  on save.
- **Markdown editor**: collapsed to a one-line chip. The raw block shows while the cursor
  or the selection touches it, its first and last character included. Clicking the chip
  puts the cursor at the end of the block's first line. How the arrow keys move past a
  collapsed block is still to be seen in the app.
- The chip reads "Todoist" alone. With the "Show the filter in the query block chip"
  setting on it reads "Todoist: " and the filter, or "Todoist: default filter" for a block
  with no `filter:` line (Joel, 2026-10-12: the plain chip is the default). Resting the
  pointer on the chip shows the filter and when the block was last fetched, on two labelled
  lines ("Filter: ..." and "Fetched: ...").
- A block that is not closed yet is never collapsed.

### 8.2 Settings

| Setting | Default |
|---|---|
| Todoist API token (stored encrypted by Joplin, see 9.1 item 8) | empty |
| Default project for sent tasks | empty (Inbox) |
| Default filter, for a new query block and for a block with no `filter:` line | `today \| overdue` |
| Template notebooks (no automatic fetch) | `Templates` |
| Template tag (no automatic fetch) | `template` |
| Collapse query block in editor | On |
| Show the filter in the query block chip | Off |
| Show task details in the link | On |
| Toolbar buttons | `Sync` |

"Toolbar buttons" lists the commands that get a button on the editor toolbar: any of
Send, Fetch and Sync, separated by commas, in the order the buttons should appear. Empty
means none, and a word that is none of the three is ignored. (Joel, 2026-10-12: which
commands get a button is a setting, and one row instead of three checkboxes.) Joplin
can't take a button away while it runs, so a change shows after a restart.

### 8.3 Commands

Four commands under Tools > Todoist Sync, also available from the command palette:

| Command | Short name here | What it does |
|---|---|---|
| Send tasks to Todoist | Send | Creates tasks from unlinked checkbox lines |
| Fetch tasks from Todoist | Fetch | Adds lines for tasks matching a query block |
| Sync note with Todoist | Sync | Reconciles lines that are already linked, in both directions |
| Remove Todoist links | | Unlinks every linked line in the selection, or in the note |

The submenu is called "Todoist Sync". Each command name says "Todoist" once, so it also
reads well in the command palette, where the submenu name is not shown.

Send and Fetch both add new links, in opposite directions, and each is a deliberate act.
Sync never creates a task, and adds lines only for a query block that has never run, so
it is safe to run on any note at any time. They are kept separate for that reason.

Default keyboard shortcuts, which can be changed under Options > Keyboard Shortcuts:

| Command | macOS | Windows and Linux |
|---|---|---|
| Send | Cmd+Option+Shift+T | Ctrl+Alt+Shift+T |
| Fetch | Cmd+Option+Shift+F | Ctrl+Alt+Shift+F |
| Sync | Cmd+Option+Shift+S | Ctrl+Alt+Shift+S |

Joel chose the letters on 2026-10-12. Shift was added because Joplin already uses
Cmd+Option+S (toggle the sidebar) and Cmd+Option+T (edit tags) on macOS, and Ctrl+Alt+S
and Ctrl+Alt+T on the other systems.

## 9. Technical approach

- Directory `joplin-todoist-sync/`, id `com.joelberger.todoist-sync`, standard
  `generator-joplin` layout like the other plugins.
- `src/index.ts`: settings, commands, the note-open hook for the automatic first fetch, and
  the Todoist client (`fetch` against the Todoist API v1).
- Pure modules with no Joplin or network dependency, so they can be tested in Node with
  `npm test`:
  - note parsing: task lines, trailing links, query blocks, code block skipping
  - sync decisions: given a line, a task and today's date, return the actions (sections 6
    and 7 as a function)
  - `##`/`@@` name matching
- Content scripts (listed in `plugin.config.json`): a CodeMirror 6 script that applies the
  plugin's edits as editor transactions and collapses query blocks, and a markdown-it script
  for the rendered block. A block replacement spanning several lines has to come from a
  CodeMirror state field, not a view plugin.
- Edits follow the text they belong to. Todoist calls take time and the note can change
  meanwhile. When a command reads the note, the editor script starts recording every change
  made after that. Each edit names the text it depends on, and is moved through the recorded
  changes before it is applied. If that text no longer reads the same, the edit is skipped
  and reported, together with the other edits of the same block or line.
- Task details need project names, and tasks carry only a project id. So every command
  fetches the project list once per run when details are turned on.
- The pinned date of a recurring line is read back from the link URL and compared with
  the task's due date, including the year and any time of day. Anything else after the `#`
  is treated as no date.
- Todoist's API numbers priority backwards: `p1` is `priority: 4` and the default `p4` is
  `priority: 1` (seen in the live test). The details formatter converts, and has a test.
- Multiple devices: nothing to coordinate, since all state is in the note. The usual Joplin
  caveat applies: if two devices both change a note before Joplin has synced it, Joplin
  makes a conflict copy.

### 9.1 Verification results

Checked on 2026-10-10 by reading the Todoist API v1 definition and the source of Joplin,
the Templates plugin, the Journal plugin and the `joplin-tag-sync` skill. "Open" items
still need a live test.

1. **Quick add and single `#` / `@`: tested live, resolved.** Results from
   `tools/verify-todoist-api.mjs`:
   - A `#name` or `@name` that matches no project or label stays in the task name as text.
     Nothing is created.
   - One that exactly matches a project or label is consumed: the task is moved or
     labelled and the word is removed from the name. So the collision is real.
   - A backslash (`\#name`, `\@name`) stops quick add from consuming it, but the backslash
     stays in the name.
   - Dates and priority parse correctly in every case. Quick add followed by a move call
     puts a task under a parent.

   Send therefore escapes every single `#` and `@` with a backslash before quick add, then
   sets the name without the backslashes in one update call. Lines with no single `#` or
   `@` need no second call.

   The update call was tested too: it keeps `#project` and `@label` in the name as plain
   text and attaches nothing, so the second call is safe for both. (The plain create
   endpoint does turn an exactly matching `@label` into a label. Send never uses it.)

   `##Name` and `@@Name` need no second call. Once the plugin has resolved the exact name,
   it passes it to quick add in Todoist's own syntax, with spaces escaped
   (`#My\ Project`, `@my\ label`). Tested with spaces, with an emoji in the name, in the
   middle of a line, and in a different case: all filed correctly and left the rest of the
   name intact. An unescaped name with spaces is not recognized, so the escaping is
   required.

   Calls per sent line: one quick add, plus one update if the line has a single `#` or
   `@`, plus one move if it is a subtask. The project and label lists are fetched once per
   Send run, and only when a line uses `##` or `@@`.
2. **Completed tasks: tested live, resolved.**
   - `GET /tasks/{id}` returns a completed task with `checked: true`, despite the
     documentation. A deleted task and a task from another account both return 404 and
     can't be told apart, which is why Sync never removes a link.
   - `GET /tasks?ids=a,b,c` returns only the active ones.

   Sync fetches all linked ids in one `ids=` request, then asks for each missing id
   individually: 200 with `checked: true` means completed, 404 means not found.
   An id Todoist can't read at all (400, not checked against the live API) is handled as
   not found. If the `ids=` request itself is answered with 400, every id in it is asked
   for individually.
   Closing a recurring task advances its due date and leaves it open, as section 7 assumes.
   Completing a recurring task raises its `completed_count` by one, and postponing it
   raises `postponed_count` instead. The completed-tasks list does not include completed
   occurrences of a recurring task. So the two can be told apart, but only by comparing a
   count with an earlier value.
3. **Task URL: confirmed.** The documented format is
   `https://app.todoist.com/app/task/<id>`.
4. **Write path: decided from source.** The Rich Text editor has no way to run a plugin's
   editor command, and it offers no "replace the whole text" command either. The only write
   left there is the data API, which the open editor ignores while it holds unsaved typing
   and then overwrites. So **v1 commands and the automatic fetch require the Markdown
   editor**. In Rich Text a command shows a message and changes nothing, and an unfetched
   block simply waits until the note is next opened in the Markdown editor. All writes go
   through a CodeMirror transaction, which also makes each command a single undo step.
   To confirm in the app while building: detecting which editor is active, and that the
   content script is ready when the note-open hook fires.
5. **Template plugins: confirmed.** Templates and Journal both create the note, write its
   body, then run `openNote`, so the note-open hook fires on a finished note. Templates
   finds its templates in a notebook named `Templates` (its default) or by the tag
   `template`. Journal uses any note, chosen by id, so that note has to live in an excluded
   notebook or carry the excluded tag (section 5.3).
6. **Tag sync skill: confirmed.** Its script skips fenced and inline code, and neither its
   tag pattern nor its mention pattern can match `##Name` or `@@Name`.
7. **Rich Text round trip of the hidden block and the `↗` link: confirmed.** Joel saved a note
   from the Rich Text editor on 2026-10-12, and the block and the links came back unchanged.
8. **Token storage: confirmed on Joel's machine.** A setting marked secure is not written
   to `settings.json`. Joplin encrypts it with Electron's safe storage and keeps the result
   in its database (`key_values` table, key
   `KeychainServiceDriver.secureStore.setting.plugin-com.joelberger.todoist-sync.todoistSyncToken`).
   The encryption key is the macOS Keychain item "Joplin Safe Storage". There is no separate
   Keychain item per setting.

### 9.2 Companion change

`joplin-inline-tags` opens its autocomplete on any `#`. Two things were wanted from it:

- Stop it from triggering when the `#` follows another `#`, so it stays out of the way
  while typing `##Project`. **Done on 2026-10-12**, in both its CodeMirror 6 and
  CodeMirror 5 scripts.
- Stop it from triggering inside a code block. **Already the case**: its CodeMirror 6
  script skips `FencedCode` and `CodeBlock`, and its CodeMirror 5 script skips fences.
  Joel saw it stay closed inside a `todoist` block on 2026-10-12. A query block's filter uses `#Project`, and
  accepting a suggestion there would attach a Joplin tag to the note. This is the only way
  a filter can create a tag: `joplin-inline-tag-style` and the `joplin-tag-sync` skill both
  skip code blocks already.

### 9.3 To check in the Joplin app during the build

1. Detecting which editor is active, and that the editor script is ready when the note-open
   hook fires (from 9.1 item 4).
2. The hidden query block and the link with its details survive a Rich Text save (from 9.1
   item 7).
3. How `joplin-inline-tag-style` shows a tag at the end of a task name now that a link
   follows it. **Settled on 2026-10-12.** That plugin hides a trailing tag but shows it as
   a word when other content follows, unless that content starts with a symbol or emoji.
   It only looked at text, not inside a link, so `Send the budget #Q4 [↗ p1](...)` rendered
   as "Send the budget Q4 ↗ p1". It now treats a link whose text starts with a symbol the
   same way, and the tag stays hidden. The rule is general and the two plugins do not
   depend on each other.

## 10. Open questions

None at the moment.

Decided: v1 is desktop only. To keep a later mobile build possible, the plugin's own code
uses only `fetch` and the Joplin plugin API, with no Node modules (`fs`, `child_process`).
The generator's standard `webpack.config.js` is used unchanged.

## 11. Non-goals for v1

- Editing due dates, priority, project or labels from the note after Send (they are
  shown, section 3.3, but read only)
- Styling the task details as pills or chips (planned for v2, see `TODO.md`)
- Renaming a task from Joplin
- Reopening a task from Joplin alone
- Creating projects or labels
- A picker for ambiguous `##` and `@@` names (planned for v2, see `TODO.md`)
- Deleting tasks
- Syncing indentation changes after Send, or fetching tasks as a nested list
- Alternate checkboxes
- Joplin mobile
- Running commands from the Rich Text editor
- Background or scheduled sync
- Saved Todoist filters (paste the filter's query into the block instead)

## 12. Build order

Each step ends with something that can be run or installed and tried. A step is not started
until the one before it is accepted.

1. **Logic and tests, no Joplin. Done.** Scaffold the plugin. Write the pure modules: note
   parsing, the details formatter, `##`/`@@` matching, and the sync decision function.
   `npm test` covers them, including scenarios 1 to 12 of section 7.1.
2. **Fetch, manual. Done.** Settings (token, default filter), the Todoist client, the editor
   script that applies edits, and the Fetch command. This is the first version to install,
   and it settles check 1 of section 9.3.
3. **Sync. Done.** Completion, names, details, missing tasks and the recurring rules, with the
   reporting from section 6.5. Ends with the interactive session described in section 7.1:
   the recurring scenarios against the real account, run together with Joel, who reviews
   each result. Joel signed off on 2026-10-11, with scenarios 1 to 14 and the
   cases of section 6.1 passed. Scenario 15 is tested with step 5.
4. **Send. Done.** Tokens, escaping, subtasks, default project. Joel accepted it on
   2026-10-12, after five rounds in the app against a throwaway Todoist project.
5. **Automatic first fetch. Done.** The note-open hook and the template exclusions, and
   the default filter for a block that has none (section 3.4). Joel accepted it on
   2026-10-12, after three rounds in the app that included the Templates and Journal
   plugins and scenario 15 of section 7.1.
6. **Display. Done.** The collapsed query block in the editor and the hidden block in the
   rendered note. Joel accepted it on 2026-10-12, after trying it in the app. Checks 2
   and 3 of section 9.3 are settled: the block and the links survive a Rich Text save,
   and the finding of check 3 is an open item in `TODO.md`.
7. **Wrap-up. Done.** Remove links (section 6.4), keyboard shortcuts and toolbar buttons
   (section 8), the order of fetched tasks (section 5.2), the companion change to
   `joplin-inline-tags`, the fix for the replayed toast, a README, and the plugin's entry
   in the repo's `CLAUDE.md`. Joel accepted it on 2026-10-12, after six rounds in the app
   against a throwaway Todoist project.
