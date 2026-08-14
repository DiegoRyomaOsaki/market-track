---
name: reconcile-linear
description: Cross-reference merged PRs against Linear ticket statuses and mark stale "In Review" / "In Progress" tickets as Done.
argument-hint: [--dry-run]
user-invocable: true
---
# Reconcile Linear Tickets

Find merged PRs whose Linear tickets are still open and close them.

Read `CLAUDE.md` (Integrations + Git Workflow sections) for the project's Linear team key and issue prefix, and its base/integration branch. In this project: team key `Market-Track`, ticket prefix `MAR`, base branch `dev`. The examples below use `TEAM` / `TEAM-NNN` as placeholders — substitute the real values. The Linear MCP tools are `mcp__linear-mt__*` exclusively; never use the `mcp__claude_ai_Linear__*` connector registered on this machine (different account, cannot see the Market-Track workspace).

## When to use

Run this after a batch of PRs merges — Linear's GitHub integration auto-closes tickets only when the PR body contains a plain `Closes TEAM-NNN` line. Any PR that merged without that line (polish PRs, retrospectives, old branches) leaves the ticket stuck in "In Review" or "In Progress".

## Steps

### 1. Collect merged PR branches

```bash
gh pr list --state merged --limit 50 --json number,title,headRefName
```

Extract every ticket ID from `headRefName` and `title`. A branch like `alex/team-328-allow-editing` yields `TEAM-328`; a title like `TEAM-47: Virtualize the grid` yields `TEAM-47`. Collect a deduplicated set.

### 2. Collect open PR branches

```bash
gh pr list --state open --json number,headRefName
```

Record the ticket IDs that still have open PRs — these must NOT be closed.

### 3. Query Linear for non-Done tickets

Call `mcp__linear-server__list_issues` twice in parallel:

- `team: "TEAM"`, `state: "In Review"`
- `team: "TEAM"`, `state: "In Progress"`

### 4. Find the stale set

Cross-reference:

- A ticket is **stale** when:
  - Its ID appears in the merged-PR set **and**
  - It appears in the open Linear results (In Review or In Progress) **and**
  - Its ID does **not** appear in the open-PR set
- A ticket is **correctly open** when it has an open PR — leave it alone.
- A ticket with no PR trace at all — leave it alone (may be actively worked on a local branch).

### 5. Report findings

Print a table:

```
STALE (will mark Done):
  TEAM-328  In Review  Merged in PR #385
  TEAM-45   In Review  Merged in PR #377

OPEN (no action — PR still open):
  TEAM-330  In Review  PR #388 open
  TEAM-44   In Review  PR #378 open

NO TRACE (no action — branch not found in PR list):
  TEAM-329  In Progress  (active local branch)
```

If `$ARGUMENTS` contains `--dry-run`, stop here and do not update anything.

### 6. Confirm and close

Ask the user to confirm before updating:

```
Mark N tickets as Done? (yes / no)
```

On confirmation, call `mcp__linear-server__save_issue` for each stale ticket:
- `id: "TEAM-NNN"`
- `state: "Done"`

Run all updates in parallel.

### 7. Report results

Print which tickets were updated and which failed (if any).

## Notes

- Always target the project's configured team. Never operate on a different team.
- Never close a ticket that has an open PR — the merge hasn't happened yet.
- Never close tickets that have no PR trace — they may be mid-implementation on a local branch.
- The `gh pr list --state merged --limit 50` window covers the last ~50 PRs. For older reconciliation, the user should pass explicit ticket IDs via `/reconcile-linear TEAM-X TEAM-Y` — in that case, skip steps 1–2 and go straight to step 3 with just those IDs (no open-PR guard needed since the user is asserting they are merged).
