---
name: retrospective
description: Review a session's work and propose improvements to docs, skills, agents, and rules to prevent recurring mistakes.
argument-hint: [branch-or-pr-number]
user-invocable: true
---

# Compound System Retrospective

Analyze a completed session's work — the original issues, the fixes applied, and the review findings — then propose concrete improvements to the compound engineering system (docs, skills, agents, rules) so the same classes of mistakes don't recur.

## Phase 0 — Gather the Session Record

1. Determine the scope from `$ARGUMENTS`. Resolve the base branch from CLAUDE.md's
   `Base branch:` line, else `gh repo view --json defaultBranchRef -q
   .defaultBranchRef.name`, else `main`:
   - If a PR number: `gh pr view <number> --json body,commits,files`
   - If a branch: `git log <base>..<branch> --oneline` and `git diff <base>...<branch>`
   - If no argument: use the current branch's commits since diverging from `<base>`

2. Collect:
   - The **original review findings** (from PR body, commit messages, or conversation context)
   - The **fixes applied** (from the diff)
   - Any **review-of-the-fixes findings** (second-pass issues discovered after the initial fix)

## Phase 1 — Classify the Root Causes

3. For each finding that led to a code change, classify its **root cause** into one of:

   | Root Cause | Meaning | Fix Target |
   |---|---|---|
   | **Missing rule** | No rule told the developer to do this correctly | `.claude/rules/` |
   | **Incomplete rule** | A rule exists but doesn't cover this case | `.claude/rules/` |
   | **Missing reviewer check** | A reviewer agent should have caught this but doesn't look for it | `.claude/agents/reviewer-*.md` |
   | **Missing engineer guidance** | An engineer agent should guide this but doesn't mention it | `.claude/agents/engineer-*.md` |
   | **Skill gap** | A skill's workflow is missing a step that would have prevented this | `.claude/skills/` |
   | **Doc gap** | A docs/ file is missing information the developer needed | `docs/` |
   | **CLAUDE.md gap** | The project guide is missing a convention or pattern | `CLAUDE.md` |
   | **One-off mistake** | Human error, not a systemic issue | No change needed |

4. Skip one-off mistakes. Focus only on systemic issues that could recur.

## Phase 2 — Analyze Existing Coverage

5. For each systemic finding, check whether the relevant compound file **already covers it**:

   - Read the specific rule file
   - Read the relevant agent file
   - Read the relevant skill file if the issue is workflow-related
   - Read the relevant docs file if the issue is about architecture knowledge

6. Categorize each as:
   - **Not mentioned at all** — needs to be added
   - **Mentioned but vague** — needs to be made more specific/actionable
   - **Mentioned but buried** — needs to be promoted to higher visibility (e.g., moved to a "Common Pitfalls" section)

## Phase 3 — Draft Improvements

7. For each systemic issue, draft a **specific, minimal change** to the relevant file. Follow these principles:

   - **Rules should be prescriptive, not advisory.** "Always scope queries through current_user" not "Consider scoping queries."
   - **Reviewer agents should have checklists, not essays.** Add a bullet point to the agent's checklist, not a paragraph of explanation.
   - **Skills should have guard steps, not just happy paths.** If a skill missed a step, add the step.
   - **Docs should show the correct pattern with code.** A code example is worth 10 sentences.
   - **CLAUDE.md additions should be one-liners.** It's a quick reference, not a textbook.
   - **Frame every proposal as a project-scoped principle, not a fix description.** Strip the ticket ID, the specific field, the specific component. Ask: "Would this bullet read the same if a different feature had triggered the same class of finding?" If swapping the feature names changes the meaning, generalize the class.
   - **One sentence per bullet, two at most.** Lead with the rule; add only the disambiguating clause a future reviewer needs. No "because X happened in Y" preambles.
   - **Don't bloat CLAUDE.md with what an agent or skill already covers** — edits go in the respective context file.

8. Group the changes by file and present them as a structured proposal:

```
# Retrospective Proposals

## Session Analyzed
[branch/PR, summary of what was done]

## Root Cause Analysis
| Finding | Root Cause | Target File | Current Coverage |
|---|---|---|---|
| ... | ... | ... | ... |

## Proposed Changes

### `.claude/rules/{file}.md`
**Add:** [exact text to add]
**Rationale:** [one sentence why]

### `.claude/agents/{file}.md`
**Add:** [exact text to add]
**Rationale:** [one sentence why]

### `docs/{file}.md`
**Add:** [exact text to add]
**Rationale:** [one sentence why]

## No Change Needed
- [one-off items that don't warrant systemic fixes]
```

## Phase 4 — User Review & Apply

9. Present the proposal to the user. Wait for approval.

10. For approved changes, apply them to the relevant files. Make minimal, surgical edits — do not rewrite entire files.

11. Commit with message: `Retrospective: improve [agents/rules/docs] based on [session summary]`

## Anti-Patterns

- **Don't add rules for things that will never happen again.** If it was truly a one-off, skip it.
- **Don't duplicate CLAUDE.md content into rules.** Rules supplement CLAUDE.md for path-specific context, they don't repeat it.
- **Don't make agents more verbose.** Agents should check more things, not explain more things.
- **Don't add process for process's sake.** If a skill already covers the area and the mistake was just not following the skill, that's a one-off — don't add a redundant step.
- **Don't propose changes you can't verify.** If you're unsure whether a rule would have helped, don't add it.
- **Every proposal must be necessary, long-lived, and succinct.** No nice-to-haves. No temporary decisions. One-liner additions, not paragraphs. Ask: "Would I tell every future developer this forever?" If no, skip it.
