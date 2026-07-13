---
name: linear-ticket-start
description: Pick up a Linear ticket, implement it, open a draft PR, run review and comment findings on the PR, apply fixes and comment them, then finalize the PR.
argument-hint: <ticket-id>
user-invocable: true
---

# Linear Ticket Start

End-to-end workflow: fetch a Linear ticket, implement it scoped to the card, open a draft PR, run multi-agent review and comment findings on the PR, apply fixes and comment them on the PR, finalize the PR, and close the loop on Linear.

> **Linear MCP prefix:** the tool names below use `mcp__linear-server__*`. Your
> environment may register the Linear MCP under a different prefix (e.g.
> `mcp__claude_ai_Linear__*`). Use the `Linear MCP prefix:` value from CLAUDE.md's
> Integrations section; substitute it for `mcp__linear-server__` throughout.

## Phase 0 — Fetch & Understand the Ticket

1. Parse the ticket identifier from `$ARGUMENTS`.
   - Accept formats: a ticket ID (e.g., `SCR-123`), a full Linear URL, or a raw UUID.
   - **No argument:** list `Todo` tickets filtered to the project's Linear team (from `CLAUDE.md`), verify each result's `team` field matches, skip any that don't, then ask the user to pick one.
   - **ID provided:** confirm the ticket prefix matches the project's Linear team — if not, stop and tell the user this skill is scoped to that team.

2. **Fetch the ticket** using the `mcp__linear-server__get_issue` MCP tool with `includeRelations: true`.
   - Extract: title, description, acceptance criteria, labels, priority, parent issue, blocking/blocked-by relations, and the suggested git branch name.

3. **Fetch sibling tickets for scope boundaries**:
   - If the ticket has a parent issue, use `mcp__linear-server__list_issues` with `parentId` set to the parent's ID to get all sibling sub-issues.
   - If no parent, use `mcp__linear-server__list_issues` with the same `project` to see neighboring work.
   - Summarize the sibling tickets into a **scope boundary list** — a short description of what each sibling covers, so you know what is OUT of scope for this ticket.

4. **Fetch existing comments** using `mcp__linear-server__list_comments` to check for additional context, discussion, or decisions made on the ticket.

5. **Update ticket status** to "In Progress" using `mcp__linear-server__save_issue` with the ticket's ID and `state: "In Progress"`.

## Phase 1 — Clarify Requirements

6. Review the ticket description and acceptance criteria. Evaluate whether you have enough information to implement. Consider:
   - Are the acceptance criteria specific and testable?
   - Are there ambiguous terms or missing details about behavior?
   - Does the ticket reference UI designs, APIs, or flows you don't understand?
   - Are there edge cases the description doesn't address?

7. If clarification is needed, use `AskUserQuestion` to ask **focused questions** (max 4). Frame questions around implementation decisions, not general understanding. Include the options you've identified where possible.

8. If the ticket is clear, proceed directly to Phase 2.

## Phase 2 — Branch & Plan

9. **Verify the working tree is clean** before branching with `git status` / `git diff --name-only`. If there are uncommitted unrelated changes, surface them and ask the user whether to stash or abort. When stashing, stash the full WIP set together — a file's companion test, snapshot, or sibling may also be modified, and stashing only the named file leaks the rest into the PR.

9a. **Determine the base branch.** Default base is the integration branch. Only branch from another feature or integration branch when the ticket explicitly depends on unmerged work, and verify that branch exists on `origin` first. Never branch from the production branch.

9b. **Create a feature branch** based on the Linear ticket's suggested branch name:
   ```
   git checkout -b <branch-name-from-linear> <base-branch>
   ```
   If no branch name is suggested by Linear, derive one from the ticket ID and title.
   If the ticket has `blockedBy` relations, check whether those branches are already merged into the base branch — if not, branch from the blocking ticket's branch instead.

10. **Research & plan** — Spawn an `eng-plan` agent to:
    - Read relevant docs and `CLAUDE.md` to understand conventions
    - Identify which files to create/modify
    - Design the approach consistent with existing patterns
    - Produce a structured implementation plan

    Provide the agent with:
    - The full ticket title and description
    - The acceptance criteria
    - The **scope boundary list** from Phase 0 (so it stays scoped to THIS ticket)
    - Instruction: "Do NOT plan work that belongs to sibling tickets. Stay strictly within the scope of this ticket."

11. **Present the plan to the user** and wait for approval before proceeding. The plan should include:
    - Goal (from the ticket)
    - Files to create/modify
    - Implementation steps
    - Data model changes (schemas, interfaces, if any)
    - Tests to write
    - What is explicitly OUT of scope (from sibling tickets)

## Phase 3 — Implement

12. After the user approves the plan, **implement the changes** step by step:
    - Follow the plan from Phase 2
    - Follow conventions from `CLAUDE.md`
    - Write tests alongside implementation
    - Commit logically grouped changes as you go

    For complex tickets, spawn specialized agents as needed:
    - `engineer-data-access` — for data layer design, field mapping, pagination
    - `engineer-frontend` — for UI components, state management, styling
    - `engineer-framework-conventions` — for framework-specific patterns

    Keep implementation strictly scoped. If you notice something that SHOULD be done but belongs to a sibling ticket, note it but do NOT implement it.

## Phase 4 — Test & Lint (Round 1)

13. **Run an early smoke gate scoped to the changed files** — the project's lint command plus the tests covering the changed files only — to fail fast before the full suite. Do NOT run the type checker in this scoped gate: whole-program type checkers cannot be safely scoped to changed files, so the type check runs once in the full validation below.

14. **Run the full test suite** using the project's test command from `CLAUDE.md`.
    - If tests fail, read the failure output, fix the issues, and re-run.
    - Iterate until all tests pass (max 3 fix-and-retry cycles; if still failing after 3, ask the user for guidance).

15. **Run the full linters and type checks** using the project's lint/format/typecheck commands.
    - Stage and commit any auto-fixes.

## Phase 5 — Draft PR

15. **Push the branch** and **create a draft pull request**:
    ```bash
    git push -u origin <branch-name>
    gh pr create --draft --title "[TICKET-ID]: [Title]" --body "$(cat <<'EOF'
    ## Summary
    - [bullet points of what was implemented]

    ## Linear Ticket
    [Link to the Linear ticket]

    Closes TEAM-NNN

    ## Test plan
    - [ ] All existing tests pass
    - [ ] New tests cover acceptance criteria
    - [ ] Linters pass
    - [ ] Type check passes
    EOF
    )"
    ```
    Write the closing keyword as plain text on its own line (`Closes TEAM-NNN`) — do NOT wrap it in bold, a markdown link, or a heading. The tracker only auto-closes on the plain form; decorated forms only link as a reference.

## Phase 6 — Review

16. **Run the `/review` skill** on the current changes to get a comprehensive multi-agent code review.

17. **Triage the review findings**:
    - **Critical / High** items — MUST be fixed before proceeding.
    - **Medium** items — Fix if they are practical and within scope of this ticket.
    - **Low / Informational** items — Note but skip unless trivial to fix.
    - Items that belong to sibling tickets or are unrelated — explicitly skip with a note.

18. **Comment the review findings on the PR** using `gh pr comment`. Structure: Critical/High, Medium, Skipped (with reasoning for skips).

## Phase 7 — Apply Review Feedback

19. For each Critical/High/Medium item, apply the fix using the relevant specialist agent:
    - Security → `reviewer-security`, UI → `reviewer-ui`, Tests → `engineer-testing`
    - Performance → `reviewer-performance`, Conventions → framework conventions agent
    - Clarity → `engineer-clarity`, Complexity → `engineer-simplifier`
    Spawn the specialist as a consultant for non-trivial fixes.

20. **Commit the review fixes** as a separate commit (e.g., "Apply review feedback for [TICKET-ID]").

## Phase 8 — Test & Lint (Round 2)

21. Run tests, linters, and type checks again. Fix any regressions.
22. Push the review fixes.
23. **Comment the applied fixes on the PR** — list each fix referencing the original finding.

## Phase 9 — Finalize PR & Close the Loop

24. **Mark the PR as ready for review**: `gh pr ready`
25. **Update the PR body** with the full implementation summary (changes, files, tests, review findings addressed, out-of-scope items).
26. **Present the summary to the user** with the PR URL.
27. **Comment the summary on the Linear ticket** using Linear MCP tools. If the comment tool is permission-denied, the auto-attached PR on the ticket is an acceptable fallback — record the denial in the final report and continue.
28. **Update ticket status** to "In Review".
29. **Suggest retrospective**: Output "Run `/retrospective` to review this session's work." so the user can run it in the main conversation where findings are actionable.

## Guardrails

- **Scope discipline**: The scope boundary list from Phase 0 is your north star.
- **No gold-plating**: Don't add features beyond what the ticket asks for.
- **Ask, don't assume**: When the ticket is ambiguous, ask the user.
- **Incremental commits**: Commit working states as you go.
- **Test-first mindset**: Write or update tests for every behavior change.
- **Review is not optional**: Always run the review skill, even for small tickets.
