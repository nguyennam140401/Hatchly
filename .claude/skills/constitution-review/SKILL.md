---
name: constitution-review
description: Review current changes, a plan, or a set of files against the project constitution (.specify/memory/constitution.md) — especially tenant isolation, no-duplicate publishing, AI budget gate and module boundaries. Use before finishing an implementation task, when reviewing a plan.md/tasks.md, or when the user asks "does this follow the constitution?".
---

Review the target ($ARGUMENTS, or if empty: recently changed files, or the current feature's
`plan.md`/`tasks.md` when no code changed) against `.specify/memory/constitution.md`.
Read the constitution first; it is the source of truth. Reply in Vietnamese.

Check at minimum, citing the principle number for each finding:

1. **I – Tenant isolation**
   - Account id taken only from the session/job payload, never from request params/body/path.
   - Every new customer table has `account_id NOT NULL`, leads its indexes, and has an RLS policy.
   - Tenant session variable set per transaction (`SET LOCAL` / `set_config(..., true)`), not per connection.
   - Worker handlers re-establish tenant context before touching data.
   - Storage keys under `tenants/{accountId}/`.
   - A cross-tenant access test exists for each new table.
2. **II – Publishing**
   - Unique (post, channel) active attempt.
   - State transitions are conditional updates.
   - "Sent, awaiting response" is persisted before calling the platform.
   - Unknown-outcome errors reconcile and never blindly retry.
   - All 5 steps logged.
   - Platform code lives only in an adapter behind the shared interface.
3. **III – AI Gateway**
   - No direct provider SDK use outside the AI Gateway module.
   - Budget reserved before the call with a single conditional update.
   - Reservation settled/released on success, error and timeout.
   - Cost ledger row written.
   - Integer micro-USD.
   - No USD amounts in customer-facing UI/email.
4. **IV – Module boundaries**
   - No imports of another module's internals.
   - No reads/writes of another module's schema.
   - FKs only within a module or to the accounts table.
5. **V – Background jobs**: long/reliable work goes through pg-boss; handlers are idempotent; large
   files never pass through the API.
6. **VII – Secrets & PII**: platform tokens encrypted, never logged; minimal data sent to external
   providers.
7. **IX – Simplicity**: no new infrastructure (cache, broker, service) or stack change without an ADR.
8. Identifiers are English (see CLAUDE.md); comments/docs are Vietnamese.

Output: a table `| Nguyên tắc | Vị trí (file:line) | Vi phạm | Cách sửa |`, most severe first
(I, II, III before others), then a one-line verdict. If nothing is found, say so plainly and list what was
checked. Do not edit files unless the user asks.
