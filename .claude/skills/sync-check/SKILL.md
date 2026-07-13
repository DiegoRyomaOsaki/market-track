---
name: sync-check
description: Compare project claude config against claude-kit, identify generalizable improvements, and open a PR to backport them.
user-invocable: true
---

# Sync Check — Backport Project Improvements to claude-kit

Compare the current project's `.claude/` configuration against the upstream
`claude-kit` repo. Identify new assets, structural improvements, and bug fixes
that should be backported. Produce a report, then on approval create a branch
and PR in the kit repo.

## Prerequisites

- `claude-kit` cloned locally (default: `~/Coding/claude-kit`, override with `$CLAUDE_KIT_DIR`)
- `gh` CLI installed and authenticated (for PR creation)

## Phase 1 — Build Inventories

1. Locate the kit repo:
   ```
   KIT_DIR="${CLAUDE_KIT_DIR:-$HOME/Coding/claude-kit}"
   ```
   Verify `$KIT_DIR/files` exists. If not, stop and tell the user.

2. **Kit inventory.** Read `$KIT_DIR/manifest.md` and scan `$KIT_DIR/files/` to
   build the canonical list of assets:
   - `files/agents/*.md`
   - `files/skills/*/SKILL.md`
   - `files/commands/*.md`
   - `files/rules/*.md`
   - `files/default-workflows.md`
   - `manifest.md`
   - `kick-off` script
   - `README.md`

3. **Project inventory.** Scan the current project:
   - `.claude/agents/*.md`
   - `.claude/skills/*/SKILL.md`
   - `.claude/commands/*.md`
   - `.claude/rules/*.md`
   - `.claude/settings.json`
   - `.claude/README.md`
   - `default-workflows.md` (at repo root)
   - `CLAUDE.md`

4. **Trace references.** Read `CLAUDE.md`, `.claude/README.md`, and
   `default-workflows.md`. Extract every file path they reference. Check if any
   referenced file is NOT in the kit inventory and NOT a project-specific doc
   (e.g., not a PRD, not a data model). These are candidate new assets.

## Phase 2 — Diff and Classify

5. For each asset that exists in BOTH the project and the kit, generate a diff.

6. For each asset that exists ONLY in the project, flag it as a potential new
   asset.

7. **Classify each difference** into one of four categories. Read both versions
   carefully and apply judgment:

   | Category | Definition | Example |
   |----------|-----------|---------|
   | **New asset** | Agent, skill, command, rule, or workflow file that exists in the project but not in the kit | A new `engineer-api-design.md` agent |
   | **Structural improvement** | Better wording, new checklist items, new rules, reorganized sections, or new capabilities that are NOT tied to a specific tech stack | Adding "All UI must follow one component path" to coding practices |
   | **Project-specific adaptation** | References to specific frameworks, libraries, file paths, domain concepts, or tech stack choices | "Next.js App Router", "Bubble API", "shadcn/ui", "`pnpm test`" |
   | **Bug fix** | Incorrect tool names, broken references, factual errors | "Task tool" when it should be "Agent tool" |

   **Classification rules:**
   - If a diff ONLY changes generic language to stack-specific language (e.g.,
     "server-side rendering" → "Server Components"), classify as
     **project-specific adaptation** and skip.
   - If a diff adds genuinely new advice, checklist items, or structural
     improvements AND ALSO includes stack-specific language, classify as
     **structural improvement** — the generalization phase will strip the
     stack-specific parts.
   - If unsure, lean toward **structural improvement** — it's easier to discard
     in review than to miss.
   - Renamed files that follow manifest instructions (e.g.,
     `engineer-framework-conventions.md` → `engineer-nextjs-conventions.md`) are
     **project-specific adaptations**, not new assets.

## Phase 3 — Classify Settings

8. If `.claude/settings.json` exists, compare against the kit's settings
   template (in the adapt skill, Phase 6). Classify each permission:

   **Backportable (add to kit template):**
   - Git, gh CLI, shell utilities, core tool permissions
   - `WebFetch` for universal domains (github.com, npmjs.com, MDN, linear.app)
   - Skill permissions that match kit skills
   - MCP permissions for integrations the kit supports (Linear)
   - Deny rules (universal safety guards)
   - Environment variables / feature flags that are universal

   **Project-specific (skip):**
   - `WebFetch` for stack-specific docs (nextjs.org, react.dev, tailwindcss.com)
   - Package manager / framework CLI permissions (pnpm, next, vitest)
   - MCP permissions for project-specific integrations
   - Any permission that references a project-specific tool or domain

   Only flag permissions that are in the project but NOT in the kit template.

## Phase 4 — Generalize

9. For each item classified as **new asset** or **structural improvement**:

   a. Read the project version carefully.

   b. Identify all project-specific references:
      - Framework names (Next.js, Django, Rails, etc.)
      - Library names (shadcn/ui, TanStack Query, Prisma, etc.)
      - File paths specific to the project's structure
      - Domain terms (Bubble API, Deal Room, line items, etc.)
      - CLI commands (pnpm, cargo, etc.)
      - Type system specifics (TypeScript `any`, Python type hints, etc.)

   c. Replace each project-specific reference with the generic equivalent used
      in the kit's existing files. Match the kit's voice and abstraction level:
      - "Server Components" → "server-side rendering" or "server-first approach"
      - "`useEffect`" → remove or generalize to "client-side lifecycle"
      - "Route Handlers in `app/api/`" → "API endpoints"
      - "`NEXT_PUBLIC_*`" → "public environment variables" or "client-exposed env"
      - "Zod schemas" → "validation schemas"
      - "TypeScript `any`" → "untyped escape hatches"
      - "pnpm test" → "the project's test command"
      - "`useState`" → "local component state"
      - "shadcn/ui" → "the project's component library"

   d. For **new agents**: write adaptation notes that tell `/adapt` how to
      contextualize the file for different stacks. Follow the format in
      `manifest.md`.

   e. For **new skills**: skills should be stack-agnostic by design (they read
      `CLAUDE.md` at runtime). If the skill contains stack-specific references,
      replace them with generic language or `CLAUDE.md` pointers.

   f. For **structural improvements to existing files**: produce a minimal diff
      that adds only the new content, in generic form. Do not restructure or
      rewrite surrounding content. Match the kit's voice: terse, directive,
      one-liner steps. Do not expand concise instructions into multi-line bash
      templates or verbose paragraphs.

## Phase 5 — Report

10. Present a structured report to the user:

```
# Sync Check Report

## Source
Project: [project name from CLAUDE.md or directory name]
Kit: [kit path]

## New Assets to Backport
| File | Type | Description | Manifest action |
|------|------|-------------|-----------------|
| [filename] | agent/skill/etc | [what it does] | copy/adapt |

[For each new asset, show the generalized version in a collapsed section]

## Structural Improvements
| File | Change | Why |
|------|--------|-----|
| [filename] | [what changed] | [why it's generalizable] |

[For each improvement, show the before/after diff of the generic version]

## Settings Additions
| Permission | Category |
|------------|----------|
| [new permission] | [allow/deny] |

## Bug Fixes
| File | Issue | Fix |
|------|-------|-----|
| [filename] | [what's wrong] | [correction] |

[Note which bugs need fixing in the current project too]

## Identical (No Changes)
- [list files that were compared and found identical]

## Skipped (Project-Specific)
- [filename] — [lines changed] examined. [what the diffs actually contain — e.g., "all changes swap generic terms for stack-specific equivalents, no new rules or checklist items"]. Kit version is [correct/better/equivalent].

## Kit Files Affected
- [list every file in claude-kit that would be created or modified]

## Manifest Updates
[Show new rows to add to manifest.md]

## kick-off Updates
[Show new lines needed in the kick-off script, if any]

Approve to create PR? (y/n)
```

11. Wait for user approval before proceeding. If the user wants to adjust
    specific items, modify the plan accordingly.

## Phase 6 — Execute

12. On approval, apply changes to `claude-kit`:

    a. Create a branch:
    ```bash
    cd "$KIT_DIR"
    git checkout -b sync/[project-name]-[YYYY-MM-DD]
    ```

    b. Apply all approved changes:
    - Write new asset files to `files/`
    - Edit existing files with structural improvements
    - Update `manifest.md` with new rows
    - Update `kick-off` script if new asset directories are needed
    - Update `README.md` if new skills or agents were added

    c. Commit with a clear message describing what was backported and from which
       project.

    d. Push and create a PR:
    ```bash
    gh pr create --title "sync: backport improvements from [project]" \
      --body "[the report from Phase 5, formatted as PR body]"
    ```

    e. Return the PR URL to the user.

13. **Bug fixes in current project.** For each bug fix identified, ask the user:
    "Fix [description] in this project too? (y/n)"
    On approval, apply the fix to the current project's file.

## Classification Guidance

When in doubt about classification, apply these tiebreakers:

- **Is the change useful in a Python/Go/Ruby project too?** → structural improvement
- **Does it mention a specific library by name?** → project-specific (unless adding it generically)
- **Is it a new checklist item that applies to any codebase?** → structural improvement
- **Is it rewording that's clearer regardless of stack?** → structural improvement
- **Is it a file rename matching manifest instructions?** → project-specific adaptation
- **Is it a new section that only makes sense with a specific framework?** → project-specific
