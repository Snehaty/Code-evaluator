# Feature Plan: Repo Attachment & Commit Visibility

## Status
Design finalized. Ready for implementation.

## Purpose
Lets a developer attach GitHub repos to a project and browse their commits, as the
foundation for the future claim-submission phase. Excludes tech stack, ORM, and UI specs.

## Scope

**In scope:** attaching/removing repos on a project, browsing branches, browsing commits.

**Out of scope** (future docs):
- Commit-to-requirement claim submission and verification invocation
- The LangGraph Evaluator (black-boxed — see README)
- Transparency log

## Core mechanism (recap — see README for full rationale)

No GitHub App, no installation, no service-level credential. Every GitHub call in this
feature is authenticated as the **acting developer's own session-held OAuth token**
(`repo` scope, granted at login per `01-requirement-management.md`). Nothing is cached
except the lightweight attachment record below — repo/branch/commit data is always
fetched live. There is no webhook-driven revocation: there's no installation to emit
webhooks, and no persisted access grant that could go stale.

## Data model

### `project_repos`
| field | type | notes |
|---|---|---|
| id | uuid, PK | |
| project_id | FK → projects.id, not null | |
| github_repo_id | string/int, not null | GitHub's numeric repo ID — stable across renames |
| full_name | string, not null | cached for display only; may go stale after a rename (GitHub's own redirect typically still resolves API calls) — no dedicated refresh mechanism in this phase |
| added_by | FK → developers.id, not null | |
| added_at | timestamp, not null | |

Unique constraint on (`project_id`, `github_repo_id`) — same repo may be attached to
multiple *different* projects, never twice to the same one. No `status`/`removed_at`
field: removal only ever happens inside the undo window (below), so a hard delete is
sufficient — there's nothing worth keeping a tombstone for.

