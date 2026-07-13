---
name: plan
description: Create a detailed implementation plan for a feature or task, exploring the codebase first.
argument-hint: <task description>
user-invocable: true
---

# Implementation Planning

Create a detailed, step-by-step implementation plan by first researching the codebase.

## Steps

1. Parse the task from `$ARGUMENTS`.

2. **Research phase** — explore the codebase to understand:
   - Current architecture in the affected area (read `CLAUDE.md` and relevant docs)
   - Existing patterns and conventions
   - Files that will need changes
   - Related tests that exist

3. **Design phase** — determine the approach:
   - Choose patterns consistent with existing code
   - Identify if new modules, endpoints, components, or domain logic is needed
   - Plan data model changes (schemas, interfaces, field mappings)
   - Plan test coverage

4. **Present the plan** in this format:

```
# Plan: [Task Name]

## Goal
[What we're building and why]

## Approach
[High-level design decision and rationale]

## Files to Create
| File | Purpose |
|------|---------|
| path | description |

## Files to Modify
| File | Changes |
|------|---------|
| path | what changes |

## Implementation Steps
1. **[Step name]** — [detail, including which file to edit]
2. ...

## Data Model Changes
- [new schemas, interfaces, field mappings, if any]

## Tests
| Test File | What to Test |
|-----------|-------------|
| path | description |

## Risks
- [potential issues and mitigations]
```

5. Ask the user to approve before any implementation begins.
