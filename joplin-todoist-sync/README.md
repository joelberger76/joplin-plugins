# Todoist Sync

Keeps the checkboxes in a Joplin note in step with Todoist.

- **Send**: turn checkbox lines in a note into Todoist tasks.
- **Fetch**: pull the tasks matching a Todoist filter into a note as checkbox lines.
- **Sync**: tick a box in Joplin and the task is completed in Todoist, or the other way round.

Everything the plugin knows is in the note itself, as an ordinary Markdown link at the end of
each line. There is no hidden database, so notes sync between devices as usual.

Desktop only, and it works in the Markdown editor (CodeMirror 6, the default since Joplin
3.0). In the Rich Text editor the commands show a message and change nothing.

## Setup

1. Install `publish/com.joelberger.todoist-sync.jpl`: Tools > Options > Plugins > gear icon >
   "Install from file". Restart Joplin.
2. In Todoist, copy your API token from Settings > Integrations > Developer.
3. Paste it under Options > Todoist Sync > "Todoist API token". Joplin stores it encrypted.

## A linked line

```
- [ ] Send the budget [↗ p1 · ##Work · @@Joel Berger](https://app.todoist.com/app/task/6XGgm6PHrGgMpCFX)
```

- The task name is the text between the checkbox and the link.
- The link opens the task in Todoist. Its text shows the task's details: `↻` for a recurring
  task, the priority unless it is p4, the project unless it is the Inbox, and the labels. The
  "Show task details in the link" setting turns them off, leaving `↗` alone.
- The details are rewritten from Todoist on every Send, Fetch and Sync. Editing them by hand
  changes nothing.
- Deleting the link unlinks the line. The task stays in Todoist.

Only bullet list items with `[ ]` or `[x]` count. Numbered lists, alternate checkboxes such
as `[/]`, and anything inside a code block are ignored.

## Commands

All are under Tools > Todoist Sync and in the command palette. Send, Fetch and Sync have a
keyboard shortcut, which can be changed under Options > Keyboard Shortcuts, and each can
have a button on the editor toolbar (see Settings).

| Command | macOS | Windows and Linux |
|---|---|---|
| Send | Cmd+Option+Shift+T | Ctrl+Alt+Shift+T |
| Fetch | Cmd+Option+Shift+F | Ctrl+Alt+Shift+F |
| Sync | Cmd+Option+Shift+S | Ctrl+Alt+Shift+S |

### Send tasks to Todoist

Creates a task for every unchecked, unlinked checkbox line in the note, or in the selection
if there is one, and links the line.

The line is passed to Todoist's quick add, so dates and priorities work as they do there:

```
- [ ] Call the plumber tomorrow p1
- [ ] Water the plants every mon
```

Two marks are the plugin's own:

| Written | Meaning |
|---|---|
| `##Name` | Put the task in this Todoist project |
| `@@Name` | Add this Todoist label (can be repeated) |

A single `#tag` or `@name` is left as plain text and never becomes a project or a label, so
Joplin tags in a task name are safe.

Names are matched loosely: case, spaces, dashes and underscores are ignored, and a partial
name works when only one project or label fits. So a project called `Home Reno` can be
written `##HomeReno`, `##home-reno`, `##Home\ Reno` or just `##Home`. If nothing fits, or
more than one name does, the line is not sent and the report says why. Projects and labels
are never created.

An indented checkbox under another checkbox becomes its subtask. A line without `##` goes to
the "Default project for sent tasks" setting, or the Inbox when that is empty.

Send is the one command that is not safe to repeat: an unlinked line is sent again.

### Fetch tasks from Todoist

Runs the note's query blocks and adds a linked line for each matching task, directly below
the block or at the end of the list that follows it.

````
```todoist
filter: today | overdue
fetched: 2026-10-10 08:31
```
````

- `filter:` is any Todoist filter, in Todoist's own syntax. There `#Work` is a project,
  `##Work` a project with its sub-projects and `@errand` a label. A name with a space needs
  a backslash: `@Amy\ Berger`.
- `fetched:` is written by the plugin after each run.
- A block with no `filter:` line uses the "Default filter" setting, which is then written
  into the block.
- If the note has no query block, Fetch inserts one at the cursor with the default filter
  and runs it.

New lines are written in the order Todoist shows them: by project, then by section, then
as arranged there, with a subtask after its parent.

Fetch only adds. A task already linked anywhere in the note is not added again, and a line
whose task no longer matches the filter stays where it is.

**Automatic first fetch.** A query block that has never run (no `fetched:` line) is fetched
by itself when its note is opened. This is what makes a daily note template work: put a bare
block in the template, and each new note fills itself in. Delete the `fetched:` line to make
a block run again on the next open. Notes in a template notebook, or with the template tag,
are left alone (both are settings).

**Display.** In the Markdown editor the block collapses to a small "Todoist" chip. It opens
when the cursor is in it or when the chip is clicked, and resting the pointer on it shows
the filter and when it last ran. In the rendered note and the Rich Text editor the block is
not shown.

### Sync note with Todoist

Covers every linked line in the note. It never creates a task.

| Box in note | Task in Todoist | Result |
|---|---|---|
| unchecked | open | nothing |
| unchecked | completed | the box is checked |
| checked | open | the task is closed |
| checked | completed | nothing |

- Completion goes one way: once either side is complete, both become complete. To reopen a
  task, uncheck the box and reopen the task in Todoist before the next sync.
- If the name differs, the line takes Todoist's name. To rename a task, rename it in Todoist.
- A task that Todoist no longer has is reported and its line is left alone.
- A query block that has never run is fetched first.

**Recurring tasks.** Completing a recurring task in Todoist does not close it, it moves it
to its next date. So a recurring line stands for one occurrence, whose date is kept at the
end of the link's URL (`...#2026-10-12`):

- Fetch only brings in a recurring task that is due today or earlier.
- Ticking the box closes that occurrence, and Todoist moves the task on.
- If the task has already moved on in Todoist (completed or rescheduled there), a ticked
  line closes nothing. Its link is removed and the report says so.
- Not handled: a recurring task completed in Todoist does not tick the box in the note.

### Remove Todoist links

Unlinks every linked line in the selection, or in the whole note when nothing is selected.
It asks first. The tasks stay in Todoist. Use it on the lines Sync reports as "Not found in
Todoist" to stop them being reported.

## Reports

When all went well, a short message appears and goes away by itself. When something was
skipped or failed, a dialog lists each line and the reason, and stays until dismissed.
Nothing is written into the note to report a problem.

## Settings

| Setting | Default |
|---|---|
| Todoist API token | empty |
| Default project for sent tasks | empty (Inbox) |
| Default filter for a new query block | `today \| overdue` |
| Template notebooks (no automatic fetch) | `Templates` |
| Template tag (no automatic fetch) | `template` |
| Collapse query block in editor | On |
| Show the filter in the query block chip | Off |
| Show task details in the link | On |
| Toolbar buttons | `Sync` |

"Toolbar buttons" takes any of Send, Fetch and Sync, separated by commas, for example
`Send, Sync`. Leave it empty for no buttons. A change shows after Joplin is restarted.

## Limits

- Due dates, priority, project and labels are shown but can't be changed from the note.
- A task can't be renamed, reopened or deleted from Joplin.
- Indentation changed after Send is not synced, and fetched tasks come in as a flat list.
- If a task is linked on more than one line of a note, Sync stops and lists those lines.
- No background sync. Nothing happens until a command is run or a note with a new query
  block is opened.
- Saved Todoist filters can't be named. Paste the filter's query into the block instead.

## Works with

- `joplin-inline-tags`: its autocomplete stays out of the way after `##` and inside a query
  block.
- `joplin-inline-tag-style`: a `#tag` at the end of a task name stays hidden in the rendered
  note when the Todoist link follows it.

Neither is required.

## Development

`SPEC.md` is the full specification. `npm test` runs the unit tests, and `npm run dist`
builds `publish/com.joelberger.todoist-sync.jpl`.
