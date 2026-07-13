---
name: docs-update
description: Update an existing documentation file to reflect current codebase state. Diffs reality against docs and patches the gaps.
argument-hint: <file-path e.g. "docs/MODELS.md" or "docs/architecture/authentication.md">
user-invocable: true
---

# Update Documentation

Bring an existing `docs/` file in sync with the current codebase.

**Style reference:** `docs/WRITING_STYLE.md` — read this FIRST if it exists.

## Phase 1 — Scope

1. Parse the file path from `$ARGUMENTS`. If no argument, list all `docs/**/*.md` files and ask the user which one to update.

2. Read the target file. If it doesn't exist, abort and suggest using `/docs-create` instead.

## Phase 2 — Audit

3. Read `docs/WRITING_STYLE.md` (if it exists) to internalize formatting and anti-patterns.

4. Read the target doc fully. Note:
   - Claims about file paths, class names, or patterns
   - Code examples shown
   - Sections that feel stale or vague

5. Verify every factual claim against the actual codebase:
   - Do the referenced files still exist? At the stated paths?
   - Do the code examples match current implementations?
   - Are described patterns still in use?
   - Are there new files, models, or flows the doc doesn't cover?

6. Produce a diff summary:
   - **Stale** — statements that are now wrong (file moved, class renamed, pattern changed)
   - **Missing** — things the doc should cover but doesn't (new models, new flows, new conventions)
   - **Redundant** — content that duplicates CLAUDE.md or another doc
   - **Style violations** — fluff, hedging, walls of text, missing code examples

## Phase 3 — Patch

7. For each finding, make the minimal edit:
   - Stale → correct the fact
   - Missing → add a section or bullets (follow existing structure)
   - Redundant → remove and add a pointer if needed
   - Style → rewrite to match writing style guide

8. Do NOT rewrite the entire file unless >50% is stale. Prefer surgical edits that preserve the author's structure.

9. If the file is over 100 lines after updates, consider splitting into focused sub-files.

## Phase 4 — Verify

10. Check that any `.claude/rules/` files referencing this doc still have correct pointers.

11. Check that `CLAUDE.md` references are still accurate.

12. Present the changes to the user for review before committing.
