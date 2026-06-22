# 92. Deterministic Control and Data Policy ADR

Status: Accepted

Date: 2026-06-23

## Context

Misell is adding AI-assisted campaign proposal, context source assets, customer
input, device operations, reporting, and publish handoff features. These areas
touch customer data, uploaded files, deletion behavior, billing/cost boundaries,
and operational actions.

To keep the system auditable and maintainable, implementation must not depend on
LLM judgment for authority decisions, and new code must avoid one-off schemas,
duplicated validation, scattered constants, and hard deletes by default.

This ADR defines engineering policy for new work. Existing code is migrated
incrementally when touched, rather than rewritten in one risky pass.

## Decisions

### 1. Deterministic control, not LLM authority

LLMs may generate drafts, candidates, summaries, labels, copy, or suggested
structured data. LLM output must not be the authority for:

- publish, schedule, content manifest creation, or playlist activation
- billing, credit consumption, quota enforcement, or price decisions
- deletion, restore, rollback, token rotation, device command execution, or
  other operational actions
- RBAC, tenant/store/screen_group authorization, visibility, or data retention
- legal/ad/security approval status

Authority decisions must be made by deterministic code: schemas, validators,
state machines, allowlists, scope guards, explicit approvals, and scripts.

LLM outputs that enter the product must be treated as untrusted input. They must
be validated, normalized, and stored as draft or evidence-bearing records before
any human or system action can use them.

### 2. Soft delete by default

New persistent business tables must use soft delete unless this ADR explicitly
allows otherwise.

Default fields for soft-deletable records:

```text
status
deleted_at
deleted_by
delete_reason
updated_at
```

Recommended status vocabulary:

```text
active | archived | deleted
```

Domain tables may add domain-specific states, but `deleted` must remain a
terminal non-active state when the record is logically removed.

Soft delete must preserve auditability:

- writes must record actor, scope, before/after, and reason when practical
- list APIs must exclude `deleted` by default
- admin/operator APIs may include `deleted` only through explicit filters
- unique constraints must account for deleted records where re-creation is
  expected
- snapshots and historical evidence must not mutate when source records are
  edited or deleted

Hard delete is allowed only for controlled retention/purge flows, such as:

- expired sessions, locks, rate-limit counters, and temporary claims
- queue rows or sync artifacts after retention
- old backup artifacts and restore-drill evidence after retention
- uploaded file bytes after their soft-deleted metadata retention expires
- legally required erasure, implemented as a specific purge path with audit or
  tombstone evidence

Hard delete paths must be explicit, bounded, and auditable.

### 3. Generic DB and code patterns

New schema and code should reuse the canonical Misell vocabulary:

```text
Tenant -> Store -> ScreenGroup -> Device
```

Prefer established patterns over one-off models:

- scope fields: `tenant_id`, `store_id`, `screen_group_id`, `device_id`
- immutable evidence: snapshot rows with stable JSON and hash
- workflow history: event tables rather than overwritten free text
- user action traceability: audit log records
- state changes: explicit state transition helpers
- external side effects: queued jobs with deterministic claim/result handling

Do not create a new domain-specific concept when an existing canonical concept,
contract helper, event pattern, or snapshot pattern fits.

### 4. No duplicated business logic

The same validation, scope check, state transition, file handling, token
handling, audit write, or config parsing logic must not be copied into multiple
routes or scripts.

Required approach:

- shared helper for enum validation and normalization
- shared helper for tenant/store/screen_group scope enforcement
- shared helper for status transitions when a workflow has state
- shared helper for uploaded file allowlist, size, MIME, signature, storage, and
  view headers
- smoke coverage for the shared helper rather than repeating identical route
  tests everywhere

Small presentational duplication is acceptable in UI rendering when extracting a
helper would make the code harder to read. Business rules are not presentational
duplication.

### 5. Variable values live in DB or minimal config

Business-variable values must not be scattered as literals across source files.

Examples that should live in DB-backed settings, env, or a minimal centralized
config/contract helper:

- upload size limits
- allowed upload MIME types and extensions
- retention days
- plan/quota/credit values
- customer-facing labels
- default proposal counts
- feature flags
- timeout values
- business-day and cutoff settings

Source code may contain security invariants and protocol-level closed sets when
changing them is a code review event, for example:

- arbitrary shell execution is forbidden
- device command allowlists
- route guard requirements
- schema version checks
- file signature validation logic
- dangerous MIME/extension deny rules

If a variable value is temporarily code-defined, it must be centralized in one
contract/config module and documented as an interim step. It must not be copied
across routes, scripts, and UI files.

## Application to AI Campaign and Context Source Work

For #145 and follow-up implementation:

- customer-entered context may contain broad information, including store
  assumptions, market information, regional events, competitor notes, seasonal
  plans, materials, PDFs, images, and free-form campaign notes
- customer-created context remains customer-authored and customer-visible:
  `source_owner=customer`, `visibility_scope=customer_visible`
- customer-created records are editable and soft-deletable by that customer
  within tenant/store/screen_group scope
- operator/internal context remains hidden from customer view unless explicitly
  made customer-visible
- context snapshots used by proposals remain immutable even when source context
  or attachments are edited or deleted later
- uploaded context source files use shared upload policy and are not directly
  served from a public directory
- view is allowed through authenticated routes; product UI does not provide a
  download action in the MVP
- external AI/OCR/file scanning SaaS is not used unless a security/privacy gate
  explicitly approves data sharing and retention behavior

Initial upload defaults for context source assets:

```text
customer upload: allowed
image max size: 25 MB
PDF max size: 100 MB
operator/admin override: later, not MVP
allowed extensions: .pdf, .jpg, .jpeg, .png, .webp
initially forbidden: .svg, .html, .docx, .pptx, .zip, executables
```

The MVP must at least validate allowlist, MIME, magic bytes where practical,
size, authenticated scope, random storage names, webroot-outside storage, and
audit evidence. Local malware scanning may be added as optional evidence; it is
not required to block the first internal MVP if it materially delays delivery.

## PR Gate Checklist

New implementation PRs must state how they comply with this ADR when relevant:

- LLM output is draft/evidence only; deterministic code controls state changes
- records that can be removed use soft delete or document a hard-delete
  exception
- scope checks use canonical tenant/store/screen_group/device vocabulary
- validation and config are centralized, not duplicated
- variable values are in DB/env/central config, not scattered literals
- snapshots/history remain immutable
- tests or smoke coverage include the policy-relevant behavior

## Migration Policy

This ADR applies immediately to new work.

Existing code is not rewritten solely to satisfy this ADR. When an existing
module is touched for related work, migrate the affected behavior toward this
policy in the smallest safe step.

Large retrofits should be split into focused follow-up issues rather than mixed
into feature PRs.
