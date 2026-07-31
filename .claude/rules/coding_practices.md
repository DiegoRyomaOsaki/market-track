# Coding Practices

These rules apply to all code written or modified in this project. Follow them
for feature work, bug fixes, refactors, and tests.

## Writing Code

**Explicit over clever.** If a line needs extra interpretation, rewrite it.
Code should read directly, not reward decoding.

**Name things honestly.** Components, functions, variables, and types must say
what they are or what they do. Booleans should read like yes/no questions.
Avoid abbreviations unless they are standard in the ecosystem.

**Keep functions short and focused.** A function should do one job. If it
handles multiple concerns, split it. If the signature keeps growing, rethink
the interface before adding more parameters.

**Guard clauses at the top.** Handle invalid cases early so the main path
reads top to bottom. Avoid deep nesting.

**No commented-out code.** Delete it. Git keeps the history.

**Comments explain why.** Use comments for business context, non-obvious
constraints, and intentional tradeoffs. Do not narrate what the code already
says. Do not leave TODO comments in code.

**No issue-tracker IDs in source or comments.** A ticket reference in code
(`PROJ-123`) rots into a dead pointer a future reader can't follow — trackers
change, projects move, tickets get archived or deleted. State the *why* inline
instead of citing a ticket. Commit messages, PR bodies, and migration
filenames may reference tickets — that's provenance in version control, not a
navigable pointer in code. Don't mass-strip existing IDs; drop them when you're
already editing the line.

**Verify before recommending.** When a fix depends on how something behaves —
a platform, a library, existing code — confirm that behavior first. Do not
present a guess as a recommendation.

**Document current behavior, not planned behavior.** Docs and architecture
notes must describe what the code does now. Mark future enhancements
explicitly as "not yet implemented" — writing aspirational behavior as
present-tense fact creates false expectations and potential security
misreadings.

**Duplicate twice, extract on the third use.** Do not create abstractions for
single use cases. Let the pattern repeat before extracting a shared solution.
When you do extract a shared definition, grep the whole repository for every
existing inline copy and migrate them all in the same change — a leftover copy
defeats the single-source-of-truth goal.

**Keep file structure predictable.** Group related code together. Keep exports,
helpers, types, and tests in a consistent order. Use blank lines to separate
logical sections.

**Don't delimit composite keys.** Key a `Map`/`Set` by nesting, not a joined
string — a component can contain the delimiter (including invisible
characters).

## Architecture

**Minimal diff.** Solve the problem with the fewest new files, abstractions,
and moving parts. Every new layer increases maintenance cost.

**Server-first by default.** Prefer server-side rendering, server-side data
fetching, and server-side logic. Add client-side code only when a feature
genuinely requires browser APIs, event handlers, or client-side state.

**Keep client boundaries small.** Do not move an entire page, layout, or large
subtree to the client because one control needs interactivity. Isolate the
interactive piece.

**Keep business logic out of UI.** UI files should assemble the interface, not
own pricing rules, permission logic, workflow branching, or data shaping. Put
domain logic in server utilities, domain modules, or focused helpers.

**One concern, one owner.** If a file already owns a concern, extend it. Do
not create parallel helpers, duplicate utilities, or competing abstractions for
the same job.

**All UI must follow one component path.** Never build reusable UI patterns
directly inside pages. Shared UI lives in the project's shared component
directory. Create it there instead of duplicating markup in page files.

**Extract when the pattern is proven.** Do not create:
- Wrapper layers over framework primitives without a real gap
- Generic helpers before a second clear consumer exists
- Base implementations with only one real use case
- Configuration objects for behavior that will not vary
- Shared utilities for logic used once
- State containers for data that can stay local

**Prefer plain functions over patterns.** If a simple function solves the
problem, use it. Do not introduce factories, strategies, or wrappers to make
simple flows look architectural.

**Shared patterns need one source of truth.** If a card, table, modal, form
section, or status pattern appears more than once, consolidate it into the
shared component layer before a third variation appears.

**Deployments are not atomic.** Old code and new code can run at the same time
during rollout. Make schema and API changes in additive steps first, then
switch reads and writes, then remove the old path.

## Error Handling

**Every error has a name and an outcome.** Define what failed, what triggered
it, where it is handled, and what the user or operator sees.

**Isolate compensating transactions.** When rolling back a side effect after a
failure (e.g., deleting a newly created record because a subsequent step
failed), wrap the compensating call in its own try/catch. A failure in the
rollback must not mask the original error or change the status code returned to
the caller.

**Every flow covers four paths.** Account for the happy path, invalid input,
empty result, and upstream failure.

**Destructive reconciliation must distinguish confirmed-gone from unreachable.**
A sweeper that deletes, soft-deletes, or deactivates rows based on an upstream
check must treat "upstream returned 404" (act) and "upstream errored / timed
out / 5xx'd" (log and skip) as different outcomes. An upstream outage must
never trigger a mass destructive action on local state.

**Fail visibly.** Do not swallow failures. Surface them through logs,
monitoring, or user-facing error states.

**Validate at the boundary.** Validate request bodies, query params, route
params, webhooks, file uploads, and third-party payloads where they enter the
system. Once validated, internal code can rely on that contract.

**Validate string IDs before URL construction.** Any caller-supplied string
used in a URL path segment or query parameter — IDs, slugs, codes — must
pass a format check before interpolation. Return a typed error; do not let an
invalid string reach the HTTP layer.

**Handle UI states explicitly.** Every screen should define loading, empty,
error, and success states. Do not ship happy-path-only UI.

## Security

**Treat all external input as untrusted.** Validate type, shape, and allowed
values before using or persisting any input.

**Keep secrets on the server.** Do not expose private keys, tokens, or
privileged configuration through client code or public environment variables.

**Never use fallback values for startup secrets.** If a security-critical
environment variable is missing, throw at module load time — do not substitute
a development default. A fallback secret that reaches production is a silent
auth bypass.

**Infrastructure-client error messages are not safe for verbatim user-visible
output.** Errors from database drivers, HTTP/API clients, and cache clients may
concatenate response-body content into their `.message` — cap at ≤200 chars (or
redact) before printing to stdout, returning in an HTTP response body, or
showing as UI text. Logging at warn/error level stays fine; the log pipeline is
operator-only.

**Authorize on the server.** UI checks improve experience, not security.
Protected reads and writes must enforce authorization server-side.

**Scope data access.** Queries must respect the current user, tenant, account,
or request context. Unscoped lookups are a common authorization bug.

**Do not weaken security to fix a config suspicion.** Confirm the
configuration state before changing auth or validation code.

**Sanitize before rendering.** Do not render raw user-generated HTML. Any use
of raw HTML requires explicit sanitization and review.

**Use safe persistence patterns.** Parameterized queries and safe ORM or query
builder patterns are required. Do not concatenate untrusted input into queries.

**Use secure randomness for security-sensitive values.** Tokens, session IDs,
invite codes, and reset links must use crypto-grade randomness.

## Testing

**TDD for business logic and critical flows.** Write tests first, then
implementation. Start with the smallest failing test that proves the behavior.

**Test behavior, not implementation.** Assert outcomes and user-visible
effects. Do not lock tests to internal call order, private helpers, or
refactor-sensitive details.

**Keep tests lean.** Do not overbuild setup, fixtures, or mocks. Cover one
concept per test.

**Do not duplicate coverage across test files.** If a test file already exists
for a module, add to it. Do not create a parallel test file for the same
concern.

**Test critical paths first.** Prioritize permissions, workflow branching,
data mutations, money movement, and external integrations.

**Derived-value SQL ships with a `test:db` test.** A new view, trigger, or RPC
that computes a derived field (KPI, quiebre, semáforo, aggregate) is verified
against a seeded database — testing only the TS helper that shapes its output
leaves the actual computation uncovered.

**Test failure cases.** Cover invalid input, missing data, permission denial,
duplicate submissions, and upstream service failure.

**Keep tests fast and deterministic.** No network calls in unit tests. No
sleep-based timing. No order-dependent setup.

**Test names should explain behavior.** A reader should understand the system
behavior from the test name alone.

**Pin security-contract values in tests.** Response headers, CSP directives,
CORS origins, cookie flags, env-schema constraints — a regression here is
silent and high-blast-radius. One assertion per value.

## Type Safety

**No untyped escape hatches without justification.** Prefer precise types,
narrowed unions, and explicit result shapes.

**Types have one owner.** Shared domain, request, and response types must come
from a single source. Do not redefine the same contract in multiple files.

**Runtime validation is required at boundaries.** The type system does not
validate external input at runtime. Validate request payloads, params,
webhooks, and third-party data before use.

**Return stable shapes.** API endpoints and shared fetch helpers should return
predictable success and error shapes. Do not return ad hoc payloads.

**Map typed unions exhaustively.** When mapping every value of an enum or union
to a derived value, use a construct the type system checks for completeness
(e.g., a mapped record requiring each key) rather than a `switch` with a runtime
`default` fallback. A default fallback silently swallows drift when the enum
grows — a new value lands at the fallback in production and only surfaces by
accident. If a `switch` is unavoidable, narrow first then assert-never in the
default to preserve the compile-time check.

**Do not pass raw data source shapes into UI by default.** Shape data for the
consumer intentionally. UI should receive the fields it needs, not the full
record by habit.

## Performance

**Fetch data on the server when possible.** Do not load primary page data on
the client if the same work can happen server-side.

**Do not over-fetch.** Request only the fields required for the current view.
Avoid duplicate requests and client-side waterfalls.

**Keep state local.** Do not move temporary UI state into global context or
shared stores without a clear multi-screen need.

**Do not store derived state.** Compute values from props, fetched data, or
existing state when possible instead of syncing duplicate state.

**Optimize after measuring.** Do not add memoization or caching without
evidence from profiling or observed regressions.

**Lazy-load expensive code.** Large libraries, editors, charts, and optional
UI should not inflate the default bundle.

**Protect the request path.** Slow or unreliable side effects should move out
of the user-critical path when the product allows it.

**Awaited outbound network calls in the request path need an application-layer
timeout.** SDK defaults are often 30s+; a hung connection blocks the response
and burns the function budget. Race the call against an explicit deadline (e.g.
`Promise.race([sdkCall(), timeoutRejection(10_000)])`). Detaching to background
work is only safe outside serverless — in a serverless runtime, function exit
kills the background task.

**Bound fan-out reads.** Cap concurrency (e.g. a `pLimit`-style limiter) and
result size on cross-entity reads that issue many sub-requests; keep them off
hot paths.

**Prefer declarative prefetched navigation over imperative navigation.** A
framework's link primitive typically prefetches the destination on
hover/viewport and transitions in its loading state instantly. Use imperative
(programmatic) navigation only when logic must run first (guards, validation) —
then give immediate on-screen feedback (a pending/transition state) and
prefetch the destination on hover/focus. A bare programmatic navigation with
neither shows nothing until the destination commits — a dead window users read
as an ignored click and re-click.

**Delete dead code.** Unused modules, legacy helpers, and abandoned branches
hurt performance and raise maintenance cost.

## Accessibility

**Interactive UI must be keyboard accessible.** Every interactive element must
work without a mouse.

**Use semantic HTML through components.** Buttons should be buttons. Links
should be links. Do not fake semantics with click handlers on generic elements.

**Forms need complete states.** Inputs need labels, validation feedback, and
clear error handling. Focus should move intentionally after major actions or
validation failures.

**Custom controls require accessible behavior.** If a custom dropdown, modal,
popover, or tab system is introduced, it must support keyboard navigation,
focus management, and accessible naming.

**Never convey meaning by color or icon alone.** Status, direction, or state
shown by a colored dot, arrow glyph, or badge needs a text or `sr-only`
equivalent (WCAG 1.4.1) — an `aria-hidden` trend arrow leaves a screen reader
the number but not whether it rose or fell.

## Observability

**New codepaths need instrumentation.** Add logs, metrics, and traces where
they help explain important flows, side effects, and failures.

**Log with intent.** Error for failures that need attention. Warn for degraded
states. Info for meaningful business events. Debug for local troubleshooting.

**Log useful context.** Include identifiers, state transitions, and failure
reasoning that help diagnose issues without exposing secrets or sensitive data.

**Log error messages as strings, not raw Error objects.** Runtime errors from
infrastructure clients (database drivers, cache clients, API SDKs) can embed
credentials in their `.message` strings. Extract the message defensively (e.g.
`err instanceof Error ? err.message : String(err)`) for the error field in
structured logs.

**Instrument writes and integrations.** Mutations, background work, third-party
calls, and permission failures should leave enough signal to trace what
happened.

## Dependency Control

**Prefer built-ins before packages.** Reach for the framework, standard
library, and existing project utilities before adding a new dependency.

**New dependencies need a reason.** Every package must solve a real gap, clear
a maintenance bar, and justify its bundle and security cost.

**Remove unused dependencies quickly.** Dead packages create security risk and
make the codebase harder to understand.

## Agent-Specific Rules

**Follow the existing pattern first.** Before introducing a new file,
abstraction, or structure, check how the surrounding code solves the same
problem and continue that pattern.

**Parallel implementations.** Do not create parallel implementations if a
module or file already owns the concern — extend it instead of creating a
second path.

**Do not widen scope.** Solve the requested problem only. Avoid incidental
refactors unless they are required to make the change correct.

**Do not invent abstractions.** New layers require repeated need, not
preference.

**Leave the touched area cleaner.** Every change should improve clarity,
remove dead code, or reduce duplication in the area it modifies.

## Review Discipline

After implementation, run `/review` **once**. Fix only Critical and High
findings. Medium and Low findings are tracked for the next PR — they do not
block shipping. Do not run `/review` more than twice on the same branch.
Diminishing returns set in after the second pass and the review loop becomes
counterproductive.

## TypeScript

**Strict mode everywhere.** All workspaces compile with `strict: true`. No
`any`, no unchecked `as` casts, no `@ts-ignore` without a comment explaining
the constraint.

**Generated DB types are the source of truth.** Database row types come from
the Supabase-generated types in `packages/db`. Domain types and Zod schemas
live in `packages/shared`. Apps import from those packages — never redefine a
row or domain shape locally.

**Zod at every boundary.** Edge Function bodies, webhook payloads, push
notification payloads, deep link params, and sync-uploaded rows are parsed
with Zod before use.

## Next.js (apps/web)

**Server Components by default.** Add `"use client"` only for event handlers,
browser APIs, Realtime subscriptions, or client-only libraries (MapLibre).
Keep the client boundary at the leaf component, not the page.

**One app, three audiences.** Role-based route groups (`/admin`,
`/supervisor`, `/cliente`) share the codebase. Role enforcement lives in
middleware + RLS — never only in conditional rendering.

**Fetch on the server with the server Supabase client.** TanStack Query is for
client-side interactivity and Realtime-driven views, not primary page data.

## React Native / Expo (apps/mobile)

**Offline-first is non-negotiable.** Field flows (check-in, levantamiento,
check-out) read and write the local PowerSync SQLite replica. A direct network
call in a field flow is a bug, even if it works in the office.

**Photos take the side channel.** Binaries go to the local disk queue and
upload to R2 with retries; only metadata (url, hash, geo, capture time)
travels through the sync engine.

**Capture-time integrity.** Watermarks, timestamps, and coordinates are
recorded at the moment of capture, never reconstructed at upload time.

**Respect the hardware.** Mid-range Android is the target. Compress images
before persisting, keep lists virtualized, avoid continuous high-accuracy GPS
outside check-in/check-out.

## Supabase / Postgres

**RLS is the security model.** Every business table carries `tenant_id`,
enables RLS in the migration that creates it, and gets policies per role.
The `service_role` key never appears in client-reachable code.

**Migrations are the only schema channel.** Schema changes go through
`supabase/migrations` — never applied by hand to a live database.

**Derived fields have one computer.** Quiebre, días-para-vencer, semáforo
color, and KPI aggregates are computed in views, triggers, or Edge Functions —
never duplicated in app code.
