---
name: docs-create
description: Create a new documentation file following the project writing style. Researches the codebase first, then writes focused, BLUF-style docs.
argument-hint: <domain e.g. "authentication" or "data-access">
user-invocable: true
---

# Create Documentation

Write a new `docs/` file for a specific domain by researching the codebase and applying the project writing style.

**Style reference:** `docs/WRITING_STYLE.md` — read this FIRST if it exists. Every decision below flows from it.

## Phase 1 — Scope

1. Parse the domain from `$ARGUMENTS`. If no argument, ask the user what domain to document.

2. Determine the output file path:
   - Domain-specific architecture: `docs/architecture/<domain>.md`
   - Operational runbooks: `docs/runbooks/<name>.md` — follow the runbook template in `.claude/rules/runbooks.md` instead of the generic structure below.
   - Non-architecture docs: `docs/<DOMAIN>.md`
   - If the file already exists, abort and suggest using `/docs-update` instead.

## Phase 2 — Research

3. Read `docs/WRITING_STYLE.md` (if it exists) to internalize the formatting and anti-patterns.

4. Read `CLAUDE.md` to understand what's already documented at the summary level. Do not repeat it.

5. Research the domain thoroughly by reading the actual source code:
   - Data access modules and interfaces
   - Type definitions and validation schemas
   - API endpoints and route handlers
   - Domain modules and business logic
   - UI components and hooks
   - Auth/session flows
   - Config files
   - Existing tests

6. Identify what a developer (or LLM) needs to know to work in this domain:
   - How does it work? (request flow, data flow)
   - What are the key files?
   - What are the patterns and conventions specific to this domain?
   - What are the gotchas?

## Phase 3 — Write

7. Write the doc following this structure:

```markdown
# [Domain Name]

[One sentence: what this domain does.]

## How It Works

[2-5 paragraphs max. Request/data flow with file references. Lead with the happy path.]

## Key Files

| File | Purpose |
|---|---|
| `path/to/file` | One-line description |

## Data Model

[Only if the domain has data types. Show relationships, enums, key fields. Use a compact format.]

## Patterns

[Domain-specific conventions with code examples. Show the correct pattern, not the wrong one.]

## Gotchas

[Things that will trip you up. Each one is a bullet with a concrete example.]
```

8. Apply the writing style rules:
   - BLUF — lead every section with the actionable takeaway
   - No fluff — cut any sentence that doesn't teach something
   - Code examples over prose — show, don't tell
   - Under 100 lines if possible — split if it's getting long
   - No repetition of CLAUDE.md content

## Phase 4 — Integrate

9. After writing the doc, update `CLAUDE.md`'s documentation section to include a pointer to the new file.

10. Check if any `.claude/agents/` files should reference the new doc for domain context.

11. Present the doc to the user for review before committing.
