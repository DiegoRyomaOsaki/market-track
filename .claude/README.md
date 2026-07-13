# Market Track — Claude Code Agents & Skills

## Agents

### Cognitive Modes

| Agent | Mode | When to use |
|-------|------|-------------|
| think | Founder / product | Deciding WHAT to build |
| eng-plan | Engineering lead | Deciding HOW to build it |
| eng-review | Staff engineer | Pre-merge code review |

### Engineer Specialists

| Agent | Focus |
|-------|-------|
| engineer-simplifier | Anti-complexity: premature extraction, over-abstraction |
| engineer-clarity | Code clarity: naming, structure, language idioms |
| engineer-dependencies | Dependency control and package bloat |
| engineer-frontend | Next.js 15 + Expo/RN component architecture, TanStack Query/PowerSync state, Tailwind/shadcn styling |
| engineer-data-access | Supabase (PostgREST), Zod validation, RLS scoping, PowerSync sync rules |
| engineer-testing | Vitest (web/packages) + jest-expo (mobile) test strategy |
| engineer-nextjs-conventions | App Router conventions, Server/Client boundaries (apps/web) |
| engineer-expo-conventions | Expo/RN conventions, offline-first data flow, native modules (apps/mobile) |

### Reviewers (run by `/review`)

| Agent | Focus |
|-------|-------|
| reviewer-security | Auth, RLS/multi-tenant isolation, injection, data exposure, field-evidence integrity |
| reviewer-ui | Tailwind/shadcn tokens, accessibility (WCAG), mobile field usability |
| reviewer-tests | Missing tests, quality, and coverage |
| reviewer-performance | Fetching efficiency, sync scope, bundle, photo pipeline, mid-range Android |

## Skills

| Skill | Command | Description |
|-------|---------|-------------|
| plan | `/plan` | Implementation plan after codebase research |
| review | `/review` | Parallel multi-agent code review |
| pull-request-create | `/pull-request-create` | Structured PR (summary, test plan, checklist) |
| retrospective | `/retrospective` | Turn session findings into rule/agent/skill improvements |
| docs-create | `/docs-create` | Create a domain doc by researching the code |
| docs-update | `/docs-update` | Sync an existing doc with code reality |
| linear-ticket-start | `/linear-ticket-start` | Linear ticket end-to-end (implement → PR → review → close) |
| linear-ticket-batch | `/linear-ticket-batch` | Multiple tickets in parallel worktrees |
| linear-project-breakdown | `/linear-project-breakdown` | Break a feature into Linear issues |
| reconcile-linear | `/reconcile-linear` | Close stale Linear tickets whose PRs merged |
| sync-check | `/sync-check` | Backport generalizable improvements to claude-kit |

> Linear skills require the team key in `CLAUDE.md` → `## Integrations`
> (pending: create the "Market Track" team in Linear first).

## Commands

| Command | Description |
|---------|-------------|
| `/ship` | Automated release: merge base → tests → lint → review → commit → PR |
