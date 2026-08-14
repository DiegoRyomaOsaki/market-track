# Ship: Automated Release Workflow

You are running an automated ship workflow. The user said `/ship` — that means
DO IT. Run straight through and output the PR URL at the end.

## Only stop for:
- On the base branch (abort)
- Merge conflicts that can't be auto-resolved
- Test failures
- Critical review findings that need human judgment

## Never stop for:
- Uncommitted changes (always include them)
- Commit message text (auto-generate from diff)

---

## Step 1: Pre-flight

```bash
BRANCH=$(git branch --show-current)
echo "BRANCH: $BRANCH"
```

Determine the base branch. Prefer the `Base branch:` line in CLAUDE.md's Git
Workflow section; if absent, detect it:

```bash
BASE=$(gh pr view --json baseRefName -q .baseRefName 2>/dev/null \
  || gh repo view --json defaultBranchRef -q .defaultBranchRef.name 2>/dev/null \
  || echo "main")
echo "BASE: $BASE"
```

If `$BRANCH` equals `$BASE`, or is `main` or `master`, abort: "Ship from a
feature branch, not the base branch." (In this repo the base is `dev` — a
`main/master`-only check would happily commit straight onto `dev`.)

```bash
git status
git diff $BASE...HEAD --stat
git log $BASE..HEAD --oneline
```

## Step 2: Merge base branch

Fetch and merge the base branch so tests run against the merged state:

```bash
git fetch origin $BASE && git merge origin/$BASE --no-edit
```

If merge conflicts: try to auto-resolve trivial ones (lockfile, generated
types). If complex or ambiguous, stop and show them.

## Step 3: Run tests

Run the monorepo test suite (Turborepo runs each workspace's tests):

```bash
pnpm turbo run test
```

If tests fail, stop and show the failures.

## Step 4: Lint & type check

```bash
pnpm turbo run lint
pnpm turbo run typecheck
```

Auto-fix mechanical lint issues (`pnpm turbo run lint -- --fix`, `pnpm prettier --write` on touched files). Stage and commit any auto-fixes.

## Step 5: Quick review

Run a lightweight review of the diff — look for critical issues only:
- Unsanitized HTML rendering of user input
- Edge Function / Route Handler request bodies not validated with Zod
- Secrets in client-side code or `NEXT_PUBLIC_*` / `EXPO_PUBLIC_*` env variables (`service_role` key especially)
- New tables in migrations without RLS enabled + tenant policies
- Direct R2 object URLs exposed to the client (must go through short-TTL signed URLs)
- Missing auth/role checks on protected endpoints or route groups
- Network calls added to mobile field flows that must work offline
- Untyped escape hatches (`any`, unchecked `as`) masking real type errors

Auto-fix mechanical issues (unused imports, formatting). If critical issues
need human judgment, stop and ask.

## Step 6: Commit and push

Stage all changes (including any auto-fixes):

```bash
git add -A
```

Generate a commit message from the diff. Format: conventional commits
(`feat:`, `fix:`, `refactor:`, `chore:`). Keep the subject line under 72 chars.

```bash
git commit -m "<generated message>"
git push origin HEAD
```

## Step 7: Create or update PR

```bash
# Check if PR already exists
gh pr view --json url -q .url 2>/dev/null
```

If no PR exists, create one. If the branch name carries a Linear ticket ID
(`mar-N` in `diegopuerto0628/mar-N-...`), append a `Closes MAR-N` line to the
PR body so the ticket auto-closes on merge:

```bash
gh pr create --base $BASE --fill
# then, if the branch matches mar-N:
gh pr edit --body "$(gh pr view --json body -q .body)

Closes MAR-N"
```

If a PR already exists, it's already updated by the push.

Output the PR URL.

## Done

Print a summary:
```
Shipped: <branch> → <base>
PR: <url>
Changes: <N files changed, +X/-Y lines>
Tests: <passed/skipped/failed>
Lint: <clean/auto-fixed N issues>
Type check: <passed/failed>
Auto-fixes: <N applied>
```
