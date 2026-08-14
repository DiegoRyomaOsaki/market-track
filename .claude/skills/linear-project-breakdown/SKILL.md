---
name: linear-project-breakdown
description: Break down a feature or project into Linear issues with estimates, dependencies, and labels.
argument-hint: <feature description>
user-invocable: true
---
# Linear Project Breakdown

Break down a feature or project into well-structured Linear issues.

> **Linear MCP:** this project uses the `linear-mt` server exclusively — the
> Linear MCP tools (`list_teams`, `save_issue`, …) are `mcp__linear-mt__*`
> (see CLAUDE.md → Integrations). Never use the `mcp__claude_ai_Linear__*`
> connector registered on this machine: it points at a different account and
> cannot see the Market-Track workspace.

## Steps

1. Understand the feature from `$ARGUMENTS`. If unclear, ask the user for clarification.
2. Research the codebase to understand:

   - Which files/areas will be affected
   - Existing patterns and conventions (read `CLAUDE.md` and relevant docs)
   - Dependencies between components
3. Break the work into issues following this hierarchy:

   - **Epic/Project** — the overall feature
   - **Sub-issues** — individual implementation units
4. For each issue, define:

   - **Title**: Imperative, specific (e.g., "Add pagination to data access layer")
   - **Description**: What to implement, acceptance criteria, relevant file paths
   - **Labels**: `feature`, `bug`, `chore`, `refactor`, `docs`, `test`
   - **Estimate**: Points (1 = trivial, 2 = small, 3 = medium, 5 = large, 8 = very large)
   - **Dependencies**: Which issues block this one
   - **Lifecycle** (only for tickets that produce transitional scaffolding — code a later ticket replaces, deletes, or migrates consumers off of): add a `Lifecycle:` line in the description naming the downstream tickets that finish the work, so a reader of any mid-chain ticket sees the end state without opening the project view.
5. Order issues by dependency — independent foundational work first, UI/integration last.
6. Present the breakdown to the user in this format:

```
# Project: [Feature Name]

## Issues (in implementation order)

### 1. [Title] — [estimate] pts — [label]
**Description:** ...
**Files:** ...
**Blocked by:** none
**Acceptance criteria:**
- [ ] ...

### 2. [Title] — [estimate] pts — [label]
...
```

7. After user approval, create the issues in Linear using the Linear MCP tools:
   - First find the team with `list_teams`
   - Create each issue with `save_issue`
   - Set dependencies/blocking relationships
