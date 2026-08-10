---
name: review
description: Run a comprehensive multi-agent code review covering security, UI, tests, and performance.
argument-hint: [file-or-branch]
user-invocable: true
---

# Multi-Agent Code Review

Run a comprehensive review of the current changes by spawning specialized review agents in parallel.

## Steps

1. First, determine the scope of the review. Resolve the base branch from
   CLAUDE.md's `Base branch:` line, else `gh repo view --json defaultBranchRef -q
   .defaultBranchRef.name`, else `main`:
   - If `$ARGUMENTS` is a file path, review that file
   - If `$ARGUMENTS` is a branch name, review `git diff <base>...$ARGUMENTS`
   - If no arguments, review all uncommitted changes (`git diff` + `git diff --cached` + untracked files)

2. Get the diff to understand what changed:
   ```
   !`git diff --stat HEAD`
   ```

3. Discover which reviewer agents actually exist — `/adapt` deletes the ones that
   don't apply to this stack (e.g. `reviewer-ui` on a backend-only project):
   ```
   !`ls .claude/agents/reviewer-*.md 2>/dev/null`
   ```
   Spawn **one agent per discovered `reviewer-*` file, in parallel** using the
   Agent tool, each with `subagent_type` matching the custom agent. The full kit
   provides:
   - **reviewer-security** — Security vulnerabilities, injection risks, data exposure
   - **reviewer-ui** — Theme compliance, accessibility, responsive design, brand consistency
   - **reviewer-tests** — Missing tests, test quality, coverage gaps
   - **reviewer-performance** — API efficiency, bundle size, caching, slow patterns

   Only spawn the ones present on disk. Never invoke a `subagent_type` whose file
   was deleted — skip its section in the report instead.

4. Each agent receives the same scope (files/diff) and reviews independently. Pass a `name:` for each agent so it's addressable, and bake an investigation budget and required output format into each spawn prompt (e.g. "Spend at most N tool calls, then emit the structured report. Do not stop without it."). Tell them to **emit the report before the budget runs out** — a review that stops mid-investigation delivers nothing, so partial findings beat perfect ones never sent. If a final message lacks the structured report, resume that agent with `SendMessage` — it continues from its transcript with the investigation intact, so it can write the report it already had the material for; re-spawning throws that work away. Do not synthesize missing findings by hand.

4a. **Reviewers must not mutate shared state.** Every spawn prompt forbids schema changes to the local database (no loose DDL — the migrations are the only schema channel, and `test:db` runs against that same database) and forbids discarding uncommitted work (`git checkout`/`stash` over files the reviewer didn't write). To verify a finding, mutate *source* and restore it, or wrap the experiment in `BEGIN; … ROLLBACK;`. After the reviews, confirm the tree and the database are as you left them before trusting any report.

   Mutating a migration takes `supabase db reset` **twice**: once to apply the mutation and once to restore it. Restoring only the file leaves the mutated function live in the database, and everything measured afterwards is fiction. And don't edit code through shell escapes (`python -c "…\b…"`): a `` becomes a literal backspace that leaves the test failing for no visible reason.

5. After all agents complete, synthesize their findings into a unified report.
   Include only the sections for reviewers that actually ran:

```
# Code Review Summary

## Scope
[what was reviewed]

## Security
[findings from reviewer-security]

## UI / Theme
[findings from reviewer-ui]

## Test Coverage
[findings from reviewer-tests]

## Performance
[findings from reviewer-performance]

## Action Items
- [ ] Critical: ...
- [ ] High: ...
- [ ] Medium: ...
```

6. Present the unified report to the user.
