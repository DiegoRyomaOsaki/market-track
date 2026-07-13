---
name: linear-ticket-batch
description: Select and implement multiple Linear tickets in parallel using smart filtering, priority ranking, and dependency checking.
argument-hint: [topic, ticket IDs, or criteria]
user-invocable: true
---

# Linear Ticket Batch

Select multiple tickets intelligently, then implement them in parallel — each via `/linear-ticket-start` in its own worktree.

> **Linear MCP prefix:** the `mcp__linear-server__*` tool names below may be
> registered under a different prefix in your environment (e.g.
> `mcp__claude_ai_Linear__*`). Use the `Linear MCP prefix:` value from CLAUDE.md's
> Integrations section and substitute it throughout.

## Phase 1 — Parse Intent

1. Read `$ARGUMENTS` and classify the input:
   - **Specific IDs**: ticket IDs separated by spaces — skip to Phase 3 (fetch and validate each).
   - **Topic / loose criteria**: `"deal room tickets"`, `"high-priority auth work"`, `"3 recasting bugs"` — proceed to Phase 2.
   - **No argument**: list all `Todo` tickets for the project's Linear team (from `CLAUDE.md`) and proceed to Phase 2 with no topic filter.

2. Extract signals from the input:
   - **Topic keywords**: words that match against ticket titles, descriptions, labels, or project names.
   - **Count hint**: if the user mentioned a number (`"3 tickets"`, `"a few"`), use it as the target batch size. Default: up to 5.
   - **Priority filter**: if the user mentioned priority (`"high-priority"`, `"urgent"`), map to Linear priority values (1=Urgent, 2=High, 3=Normal, 4=Low).

## Phase 2 — Smart Selection

3. **Query Linear** using `mcp__linear-server__list_issues`:
   - `team`: the project's Linear team (from `CLAUDE.md`)
   - `state: "Todo"`
   - If topic keywords exist, use the `query` parameter to search titles/descriptions.
   - If a priority filter was extracted, use the `priority` parameter.
   - If a project or label was mentioned, use `project` or `label` parameters.
   - Request up to 25 candidates (`limit: 25`).

4. **Rank candidates** by priority:
   - Priority 1 (Urgent) first, then 2 (High), then 3 (Normal), then 4 (Low).
   - Within the same priority, prefer tickets updated more recently.

5. **Check for blockers** — for each candidate in rank order, fetch full details with `mcp__linear-server__get_issue` using `includeRelations: true`:
   - If a ticket is **blocked by** an unresolved ticket, exclude it and note why.
   - If a ticket **blocks** other candidates in the batch, keep it but note the dependency.
   - Stop checking once you have enough unblocked candidates to fill the batch size.

5a. **Group the batch into waves** based on in-batch dependencies. If a ticket is blocked by another ticket in the same batch, the two cannot run in parallel — the dependent's worktree branches from the base and is missing the files the blocker introduces.
   - **Wave 1**: tickets with no in-batch blockers — run in parallel.
   - **Wave 2+**: tickets blocked by a prior wave — run only after that wave's PRs merge.

6. **Present the selection** to the user using `AskUserQuestion`:
   - Show a numbered list with: ticket ID, title, priority, labels, and why it was selected.
   - Show any excluded tickets with the reason (blocked, out of scope).
   - Ask the user to confirm, adjust (add/remove tickets), or cancel.

7. If the user adjusts, apply changes and re-validate blockers. Loop until confirmed.

## Phase 3 — Launch Parallel Implementation

8. For each confirmed ticket, **spawn a subagent** using the `Agent` tool:
   - `isolation: "worktree"` — each agent gets its own git worktree
   - `mode: "bypassPermissions"` — worktree agents stall without this
   - `run_in_background: true` — all agents launch in parallel

   The prompt for each agent must be self-contained:
   ```
   Run /linear-ticket-start for ticket [TICKET-ID].

   Context:
   - This ticket is part of a parallel batch. Other tickets being implemented
     simultaneously: [list other ticket IDs and titles].
   - Each ticket runs in its own worktree on its own branch.
   - Do NOT modify files outside the scope of your ticket.
   - All file operations must use absolute paths prefixed with the worktree
     root. Relative paths and parent-repo absolutes silently resolve to the
     parent repo and mutate it instead of the worktree. `pwd` reporting the
     worktree does not bind tool paths; if `git status` in the worktree shows
     clean when you expect a change, the change went to the parent — revert it
     there and re-apply with the worktree-prefixed path.
   - Follow the full /linear-ticket-start workflow including review and PR finalization.
   ```

   Name each agent after its ticket ID so progress can be tracked.

9. **Wait for all agents to complete.** As each agent finishes, note its result.

## Phase 4 — Collect Results & Report

10. For each completed agent, extract:
    - Ticket ID and title
    - PR URL (or "no PR created" if it failed)
    - Final status: success, partial (PR created but issues), or failed
    - Any notable warnings or skipped review items

11. **Present the batch summary** to the user:
    ```
    ## Batch Complete

    | Ticket | Status | PR |
    |--------|--------|----|
    | TICKET-1 | Done | github.com/...#42 |
    | TICKET-2 | Done | github.com/...#43 |
    | TICKET-3 | Failed | Agent stopped during review phase |

    ### Failures
    - TICKET-3: [details of what went wrong]

    Run `/retrospective` to review this session's work.
    ```

12. If any tickets failed, offer to retry them individually.

## Guardrails

- **Max batch size**: default 3. Warn at 4+ tickets; refuse at 6+ and ask the user to split into sequential batches. Each subagent is a full `/linear-ticket-start` run — expensive and resource-intensive.
- **Worktree path binding**: all file operations inside a worktree agent must use absolute paths prefixed with the worktree root. A path that is relative, or absolute into the parent repo, silently mutates the parent instead of the worktree.
- **All tickets must belong to the project's Linear team.** Reject any tickets from other teams.
- **Never auto-select without user confirmation.** Always present the selection and wait for approval.
- **Worktree isolation is mandatory.** Every agent must use `isolation: "worktree"` to prevent file conflicts.
- **Each agent runs the full workflow.** No shortcuts — every ticket gets the complete `/linear-ticket-start` treatment including review and PR finalization.
