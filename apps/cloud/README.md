# misell-cloud

Cloud monitoring MVP for Misell signage devices.

## Requirements

- Node.js 20+
- npm

## Local Development

```bash
npm install
npm start
```

URLs:

- Admin: http://localhost:3200/admin
- Health: http://localhost:3200/api/health

## Internal Admin IA

The internal Cloud admin page groups the existing MVP operations into stable
workspaces:

- Overview: health metrics, open alerts, and notification status.
- Studio: campaign proposals and CampaignProject generation/editing entry
  points.
- Commerce: counter-order monitoring.
- Delivery: release manifests, content manifests, and Cloud asset storage.
- Devices: device list, command controls, update status, and log bundles.
- Access: store staff URLs and customer admin URLs.

This IA shell is a static UI grouping layer. It does not change backend routes,
auth/RBAC, customer scope, database schema, Player/device behavior, publish,
content manifests, billing, or external AI/provider execution.

Default admin auth:

- User: `admin`
- Password: `change-me`

Set a real password and token pepper before any shared deployment.

```bash
ADMIN_USER=admin ADMIN_PASSWORD='replace-this' DEVICE_TOKEN_PEPPER='replace-this-too' npm start
```

By default the server binds to `127.0.0.1`. For a hosted environment, set `HOST=0.0.0.0` behind HTTPS.

## Alert Notifications

Webhook notifications are disabled by default. Set a webhook URL to notify external operations tools when alerts open, change, or resolve.

```bash
ALERT_WEBHOOK_URL=https://example.com/misell-alert-webhook
ALERT_WEBHOOK_MIN_SEVERITY=warning
ALERT_WEBHOOK_NOTIFY_RESOLVED=1
ALERT_WEBHOOK_TIMEOUT_MS=5000
```

The payload includes both `text` and `content` for Slack/Discord-style receivers, plus structured `alert` and `cloud` fields.

Test the configured webhook:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  http://localhost:3200/api/admin/alert-notifications/test
```

## Device Commands

Remote device operations use a pull-based command queue. Cloud stores an
allowlisted command, and the device polls, claims, executes, and posts a bounded
result. Cloud never opens inbound SSH to the terminal for these MVP commands.

Command issuance is fail-closed unless the admin process has an explicit role:

```bash
MISELL_CLOUD_ADMIN_ROLE=device_ops
```

Allowed roles are `misell_owner`, `misell_operator`, and `device_ops`. The MVP
command allowlist is:

- `reload_player_content`
- `sync_content_now`
- `collect_logs`
- `restart_player`
- `restart_kiosk`

`restart_device`, arbitrary shell commands, script paths, command arguments, and
maintenance tunnels are intentionally not part of this runtime API. Command
params accept only bounded metadata (`reason`, `label`) and are not expanded
into shell commands. Device results reject raw `stdout`/`stderr` and store only a
bounded summary.

Command hardening settings:

```bash
MISELL_DEVICE_COMMAND_CLAIM_LEASE_SECONDS=300
MISELL_DEVICE_COMMAND_RETENTION_DAYS=90
```

Claimed commands are not requeued automatically. If a device runner crashes or
loses network and does not post a result before the claim lease expires, Cloud
marks the command terminal `stale` and requires an operator to create a fresh
command. This avoids accidental double execution.

Operators with an allowed issuer role can force-cancel a non-terminal command
from the Admin UI or API. Force-cancel writes an audit event with the actor,
reason, previous status, and command scope. Terminal commands are retained for
the configured retention window and then purged; active `queued` / `claimed`
work is never purged by retention.

## AI Campaign Proposal Foundation

The AI campaign proposal foundation is intentionally local and operator-driven
for the first implementation. It stores customer context items, immutable
context snapshots, campaign proposals, proposal action events, proposal run
stubs, and campaign brief stubs.

The first slice is screen-group scoped. Admin proposal seed, operator-created
proposals, context items, context snapshots, proposal generation run stubs, and
campaign brief stubs all require `tenant_id`, `store_id`, `screen_group_id`, and
`proposal_month` where applicable. Store-wide or tenant-wide proposals are left
for a later scope.

Customer context items require explicit classification/source fields:
`context_category`, `visibility_scope`, `source_owner`, `source_type`, and
`confidence`. These fields are enum-validated against the #145 Campaign
Intelligence Context vocabulary so context snapshots remain auditable and
stable:

- `context_category`: `customer_profile`, `internal_notes`, `market_signal`,
  `operation_summary`, `proposal_feedback`, `asset_source`,
  `collaboration_signal`
- `visibility_scope`: `customer_visible`, `operator_internal`,
  `system_internal`, `partner_limited`
- `source_owner`: `customer`, `misell_operator`, `system`, `partner`,
  `external_reference`
- `confidence`: `customer_confirmed`, `operator_confirmed`,
  `operator_observed`, `market_reference`, `system_aggregated`, `inferred`,
  `stale`, `expired`

Campaign proposal status is one of `draft`, `proposed`, `selected`, `held`,
`rejected`, or `expired`. Customer Admin only sees customer-visible proposals;
operator-created proposals default to `proposed`, while `draft` / `expired` are
not returned from the customer proposal API.

This phase does not call an external AI provider, does not create scenes, does
not create `content_manifest` rows, does not publish content, does not add
collaboration preview flows, and does not implement billing or credits.

Customer Admin can view this month's proposals and mark them as `selected`,
`held`, or `rejected`; rejected reason is optional and preserved when supplied.
Selecting a proposal creates only a
`campaign_briefs` stub for the later Campaign Generator phase.

Customer Admin users with `customer_admin` or `customer_editor` can create,
edit, and soft-delete customer-owned context items for a selected
`store_id` / `screen_group_id`. Customer-created context is always
`visibility_scope=customer_visible`, `source_owner=customer`, and
`source_type=customer_input` or `asset_upload`; operator/internal context is not
returned from customer context APIs.

Context source files are stored separately from Cloud delivery assets. The
first upload slice allows only PDF and bitmap image evidence:

- image: `.jpg`, `.jpeg`, `.png`, `.webp`, max 25 MB
- PDF: `.pdf`, max 100 MB
- forbidden for now: `.svg`, `.txt`, Office files, archives, executables

Source files are available through authenticated inline view endpoints only.
No customer/admin download API is exposed in this slice. The stored file path is
not returned in API responses or context snapshots; snapshots include only
source asset IDs, usage notes, processing status, and `external_ai_used=false`.

## Campaign Generator Foundation

The first #146 slice turns normalized CampaignBrief inputs into editable
CampaignProject and Scene draft records. It supports project creation from a
selected campaign proposal, an existing campaign brief, or admin/operator free
input.

For demo-ready operator flow, project creation accepts `auto_generate_scenes`
or `generate_scenes` to create an initial three-scene draft from the normalized
CampaignBrief using a deterministic server-side template. Existing empty
projects can also call `POST /api/admin/campaign-projects/:id/generate-scenes`
to add the same initial draft. This is script-controlled template generation:
it does not call external AI, does not render media, does not create
`content_manifest` rows, and does not publish.

The Cloud admin CampaignProject free-input form also includes a UI-only demo
quick-fill control. It fills a sample CampaignBrief against existing
tenant/store/screen-group options and keeps `auto_generate_scenes` enabled, but
does not create data until the operator submits the existing form. The optional
post-create preview uses the existing authenticated CampaignProject preview
route.

Project status is one of `draft`, `validated`, `archived`, or `deleted`. Scene
status is one of `draft`, `valid`, `invalid`, or `deleted`. Deletes are soft
deletes.

Scene validation is deterministic and rejects missing required scene fields,
`duration_seconds <= 0`, missing CTA text, guaranteed outcome or definitive
performance claims, direct PII in scene text, non-selected proposal sources, and
tenant/store/screen-group scope mismatches.

This foundation slice does not call external AI, does not generate media, does
not render, does not create `content_manifest` rows, and does not publish.

Studio Execution A1 adds the first contract layer after editable Scenes:
`CampaignProject` + active Scenes can create a validated `studio_cut_plan`,
then a deterministic `studio_render_manifest` with executable
`studio_render_qa_results`. The source of truth remains the structured
CampaignProject/Scene/cut-plan/render-state data; MP4 is an export artifact and
is not created in A1.

Admin-only endpoints:

- `GET /api/admin/campaign-projects/:id/cut-plans`
- `POST /api/admin/campaign-projects/:id/cut-plans`
- `GET /api/admin/studio-cut-plans/:cut_plan_id`
- `POST /api/admin/studio-cut-plans/:cut_plan_id/validate`
- `DELETE /api/admin/studio-cut-plans/:cut_plan_id`
- `GET /api/admin/studio-cut-plans/:cut_plan_id/render-manifests`
- `POST /api/admin/studio-cut-plans/:cut_plan_id/render-manifests`
- `GET /api/admin/studio-render-manifests/:render_manifest_id`
- `POST /api/admin/studio-render-manifests/:render_manifest_id/qa`
- `DELETE /api/admin/studio-render-manifests/:render_manifest_id`

A1 refuses external AI/provider jobs, generated media, MP4 export,
`content_manifest` creation, publish, and credit/billing behavior. QA checks are
deterministic and include schema/layout/copy-safety/source-of-truth assertions.
The smoke target is `npm --prefix apps/cloud run smoke:studio-cut-plan-render-contract`.

Studio Execution B1 adds the provider-job foundation only. It persists
`studio_generation_providers`, `ai_generation_jobs`, and `asset_provenance` for
manual uploads and fixture-backed mock provider jobs. The only B1 providers are
`manual_upload` and `mock_provider`; real providers, MCP runtime dependencies,
API keys, webhooks, paid calls, credit mutation, generated final copy, publish,
schedule activation, Player/device mutation, and `content_manifest` creation are
out of scope.

B1 Admin-only endpoints:

- `GET /api/admin/studio-generation-providers`
- `GET /api/admin/ai-generation-jobs`
- `POST /api/admin/ai-generation-jobs`
- `GET /api/admin/ai-generation-jobs/:ai_generation_job_id`
- `POST /api/admin/ai-generation-jobs/:ai_generation_job_id/start`
- `POST /api/admin/ai-generation-jobs/:ai_generation_job_id/complete`
- `POST /api/admin/ai-generation-jobs/:ai_generation_job_id/fail`
- `DELETE /api/admin/ai-generation-jobs/:ai_generation_job_id`
- `GET /api/admin/asset-provenance`
- `POST /api/admin/asset-provenance`
- `GET /api/admin/asset-provenance/:asset_provenance_id`
- `PATCH /api/admin/asset-provenance/:asset_provenance_id`
- `DELETE /api/admin/asset-provenance/:asset_provenance_id`

Generation jobs require a tenant/store/screen-group scope, bounded provider
status lifecycle, idempotency key, zero-cost guard fields, retry/error
classification, and no external provider call evidence. Assets cannot become a
publish candidate until provenance has approved rights review, a compatible
license status, and `commercial_use_allowed=true`; B1 still does not publish.
The smoke target is `npm --prefix apps/cloud run smoke:studio-provider-job-foundation`.

The authenticated Campaign Project Editor also includes a read-only B1 status
panel for operators. It reads the existing provider catalog, generation job, and
asset provenance APIs scoped to the current CampaignProject, and it shows the
no-external-provider, no-secret, no-credit, no-`content_manifest`, and no-publish
guard flags. The panel intentionally has no job mutation, asset provenance
mutation, rights approval, provider call, credit, or publish controls.

Studio Execution C1 adds publish preflight and dry-run
`content_manifest` draft transform evidence only. A validated
`CampaignProject`, valid Scenes, and a QA-passed `studio_render_manifest` can be
checked against deterministic publish readiness rules. The preflight stores
`studio_publish_preflight_results`; the dry-run transform stores
`content_manifest_draft_transforms`. These rows are evidence records, not active
delivery manifests.

C1 Admin-only endpoints:

- `GET /api/admin/campaign-projects/:id/publish-preflights`
- `POST /api/admin/campaign-projects/:id/publish-preflights`
- `GET /api/admin/studio-publish-preflights/:publish_preflight_id`

C1 checks project validation, scene validation, render QA/output hash, tenant /
store / screen-group scope, asset provenance publish-candidate eligibility, and
docs/99 legal/privacy/ad gate linkage for ad, sponsor, and collaboration
content. `block` and `human_review_required` gate verdicts fail closed. C1 does
not create active `content_manifest` rows, activate content, mutate schedules,
publish, mutate Player/device state, call providers, or consume credits. The
smoke target is `npm --prefix apps/cloud run smoke:studio-publish-preflight`.

Scene Editor partial regeneration requests are also event-only stubs. Operators
can request `scene_regeneration`, `copy_regeneration`, or
`qr_cta_regeneration` for a non-deleted scene, and Cloud records a
`campaign_project_events` entry with `manual_required` status and explicit
no-AI / no-credit / no-publish metadata. The request does not mutate scene
content, create provider jobs, create QR links, render media, create
`content_manifest` rows, publish, or consume credits.

The Scene Editor can move a non-deleted scene up or down by swapping adjacent
`scene_order` values in a transaction, and can duplicate a selected scene as a
new draft scene with the next available order. These edit helpers only update
CampaignProject/Scene draft state and `campaign_project_events`; they do not
create delivery manifests, publish content, render media, call AI providers, or
consume credits.

The authenticated CampaignProject preview page includes a read-only run-through
mode. Operators can play, pause, restart, and step through non-deleted scenes in
`scene_order` order using each scene's `duration_seconds`. This is browser-only
preview state and does not mutate campaign data, create delivery manifests,
publish content, render media, call AI providers, or consume credits.

The same preview page also shows a read-only readiness panel derived from the
existing CampaignProject and Scene validation fields. It highlights unvalidated
projects, invalid scenes, missing required scene fields, and invalid durations
for operator review. The panel is browser-only guidance; it does not call
mutation APIs, create `content_manifest` rows, publish content, render media,
call AI providers, or consume credits.

Preview display mode is available on the same authenticated admin preview route
with `?display=1`. It hides operator chrome and shows the current scene in a
full-screen signage-like layout while reusing `scene_order` and
`duration_seconds` for browser-only run-through playback. It is still an
internal preview and does not create an external share URL, mutate data, create
`content_manifest` rows, publish content, render media, call AI providers, or
consume credits.

## macOS Launch Agent

For the Mac mini used over Tailscale:

```bash
scripts/setup-macos-launchagent.sh
scripts/setup-macos-launchagent.sh --apply
```

The script stores secrets in `~/.config/misell-cloud/env` and starts `com.misell.cloud`.

Runtime files are kept outside the Git checkout:

- SQLite DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- LaunchAgent logs: `~/.local/share/misell-cloud/logs/`

For Mac mini operation, keep the app itself as a clean checkout of GitHub `main`, and keep DB/secrets/logs under `~/.config/misell-cloud` and `~/.local/share/misell-cloud`.

Read the admin password locally:

```bash
sed -n 's/^ADMIN_PASSWORD=//p' ~/.config/misell-cloud/env
```

## Scripts

```bash
npm run check
npm run smoke:counter-order-ux
npm run smoke:customer-reporting-access
npm run smoke:ai-campaign-proposals
npm run smoke:campaign-generator-foundation
npm audit --audit-level=moderate
```

## Backup

Create a manual SQLite backup:

```bash
scripts/backup-sqlite.sh
```

The backup job uses SQLite's online backup API through `better-sqlite3`, so it does not depend on an external `sqlite3` binary. Each run writes a timestamped backup and a JSON manifest with `integrity_check`, raw SQLite hash, final artifact hash, size, compression flag, and retention metadata.

Useful options:

```bash
scripts/backup-sqlite.sh --backup-dir /secure/backups --retention-days 30
scripts/backup-sqlite.sh --backup-dir /secure/backups --no-gzip --json
scripts/backup-sqlite.sh --encryption age --age-recipients age1examplepublicrecipient --require-encryption
scripts/backup-sqlite.sh --audit-dir /secure/backup-ops-audit --operator ops --context daily-backup
scripts/backup-sqlite.sh --s3-uri s3://example-bucket/misell-cloud --s3-endpoint-url https://s3.example.com
scripts/backup-sqlite.sh --s3-uri s3://example-bucket/misell-cloud --s3-timeout-ms 300000
```

Install a macOS LaunchAgent for daily backups:

```bash
scripts/setup-macos-backup-launchagent.sh
scripts/setup-macos-backup-launchagent.sh --apply
```

Backups are stored under `~/.local/share/misell-cloud/backups` by default. The default retention is 30 days. Local verified backups are the MVP baseline; commercial deployments should copy encrypted backups to separate storage and run scheduled restore drills.

Backup operations are intentionally CLI / host-ops only for MVP+/paid PoC.
Do not expose backup list, download, delete, decrypt, restore, or artifact URL
operations through the Cloud Admin API/UI or any customer/store/admin web role.
Emergency access should use approved operator access to the host or backup
storage, not a product web surface. If a future PR adds backup web access, it
must first add server-side RBAC and DB-backed audit logs for that surface.

Each backup and restore drill writes structured operation evidence to
`MISELL_CLOUD_BACKUP_OPS_AUDIT_DIR`, defaulting to
`~/.local/share/misell-cloud/backup-ops-audit`. The audit directory is hardened
to `0700`, JSONL files are `0600`, and old audit files are retained for
`MISELL_CLOUD_BACKUP_OPS_AUDIT_RETENTION_DAYS`, defaulting to 400 days. The
backup job records backup creation, manifest write, offsite upload
success/failure/skipped, retention purge count, orphan scan results, and backup
failures. Restore drill records success/failure evidence, manifest presence,
encryption/decrypt status, warning/failure counts, and evidence file name.
This is local ops evidence only; no backup audit table is required while backup
access remains CLI-only.

For paid/product offsite backups, enable client-side encryption before the
backup leaves the host. The approved mode is `age` public-key encryption:

```bash
MISELL_CLOUD_BACKUP_ENCRYPTION=age
MISELL_CLOUD_BACKUP_REQUIRE_ENCRYPTION=1
MISELL_CLOUD_BACKUP_AGE_RECIPIENTS=age1examplepublicrecipient
MISELL_CLOUD_BACKUP_AGE_CLI=age
```

When encryption is enabled, the job writes a `.sqlite(.gz).age` artifact and a
manifest. The plaintext `.sqlite` or `.sqlite.gz` artifact is removed after
encryption succeeds or fails. The manifest records only encryption metadata,
recipient fingerprints, and artifact hashes; it must not contain private keys,
identity file paths, passphrases, or decrypted file paths.

The Cloud backup host should store only public recipient strings. Private age
identity keys are ops/security custody material and must not be stored on the
Cloud host, in Git, in Cloud DB dumps, in backup archives, in manifests, or in
restore drill evidence. Losing the private identity key can make encrypted
backups unrecoverable. Restore/decrypt remains an ops-only process; do not add
customer/admin self-service backup download, decrypt, delete, or restore flows.

For key rotation, configure both old and new recipients during an overlap
period:

```bash
MISELL_CLOUD_BACKUP_AGE_RECIPIENTS=age1oldrecipient,age1newrecipient
```

Create a new encrypted backup, run a restore drill with the new identity, then
retire the old recipient only after the new backup set is proven restorable and
retention requirements for old encrypted backups are understood.

For product operation, keep a second copy outside the VPS or Mac mini. The
script can upload each backup and manifest to S3-compatible storage when the
AWS CLI is installed and these values are set in `~/.config/misell-cloud/env`:

```bash
MISELL_CLOUD_BACKUP_S3_URI=s3://example-bucket/misell-cloud
MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL=https://s3.example.com
MISELL_CLOUD_BACKUP_S3_SSE=AES256
MISELL_CLOUD_BACKUP_S3_TIMEOUT_MS=300000
AWS_ACCESS_KEY_ID=replace-with-access-key
AWS_SECRET_ACCESS_KEY=replace-with-secret-key
AWS_DEFAULT_REGION=ap-northeast-1
```

`MISELL_CLOUD_BACKUP_S3_ENDPOINT_URL` is optional for AWS S3 and required for
many S3-compatible providers. `MISELL_CLOUD_BACKUP_S3_TIMEOUT_MS` defaults to
300000 ms per artifact upload. Use a bucket policy or access key that can write
only to the backup prefix. Do not put broad bucket-admin credentials in the app
or backup job environment. Where practical, use separate read/download
credentials for approved restore drill / DR operators rather than reusing the
normal upload credentials. S3 server-side encryption can remain enabled as
defense-in-depth, but it is not a substitute for client-side `age` encryption.
When backup encryption is enabled, S3 upload sends the encrypted `.age` artifact
and its manifest, not the plaintext SQLite/gzip artifact.

Run a restore drill without mutating the live DB:

```bash
scripts/restore-drill.sh \
  --backup /secure/backups/misell-cloud-YYYYMMDD-HHMMSS-SSS.sqlite.gz \
  --manifest /secure/backups/misell-cloud-YYYYMMDD-HHMMSS-SSS.sqlite.gz.manifest.json \
  --assets-dir /path/to/cloud/assets \
  --operator ops \
  --context monthly-drill \
  --require-manifest
```

For encrypted backups, supply the identity file explicitly from an ops-controlled
location:

```bash
scripts/restore-drill.sh \
  --backup /secure/backups/misell-cloud-YYYYMMDD-HHMMSS-SSS.sqlite.gz.age \
  --manifest /secure/backups/misell-cloud-YYYYMMDD-HHMMSS-SSS.sqlite.gz.age.manifest.json \
  --age-identity-file /secure/offhost/age-identity.txt \
  --assets-dir /path/to/cloud/assets \
  --operator ops \
  --context encrypted-monthly-drill
```

The drill decrypts encrypted artifacts only when an identity file is explicitly
provided, then decompresses or copies the artifact into a temporary SQLite file.
It opens the restored SQLite file read-only, runs `PRAGMA integrity_check`,
verifies the backup manifest hashes, checks `cloud_assets` and
`content_manifest_assets` consistency, checks asset file presence/size/sha256
when `--assets-dir` is supplied, and validates report snapshot JSON/hash evidence
plus daily metrics key uniqueness. It writes an auditable JSON result under
`MISELL_CLOUD_RESTORE_DRILL_EVIDENCE_DIR`,
defaulting to `~/.local/share/misell-cloud/restore-drills`, with file mode 0600.
Old restore drill evidence files are retained for
`MISELL_CLOUD_RESTORE_DRILL_EVIDENCE_RETENTION_DAYS`, defaulting to 400 days.

A backup artifact without a manifest is not valid product/commercial readiness
evidence. Use `--require-manifest` or `MISELL_RESTORE_DRILL_REQUIRE_MANIFEST=1`
for product/commercial restore drills so manifest-missing artifacts fail the
drill. Local/manual drills may inspect such artifacts without this flag, but the
evidence will show that the manifest was missing. Orphan artifacts,
manifest-missing artifacts, and orphan manifests are reported by the backup
operation audit scan and follow the normal backup/audit retention policy; they
must not be treated as successful backups.

Recommended cadence:

- MVP/test introduction: run a restore drill after backup configuration changes and before any paid PoC.
- Commercial deployment: run at least monthly, plus after DB migration releases and after backup storage provider changes.
- Failure handling: treat a failed drill as a release/ops blocker, keep the failed evidence JSON, create an incident or maintenance issue, and run a successful drill before relying on that backup set.

## Register a Device

```bash
curl -u admin:change-me \
  -H 'Content-Type: application/json' \
  -d '{
    "tenant_id": "TEN-DEMO",
    "store_id": "STO-DEMO-001",
    "location_id": "LOC-DEMO-001",
    "screen_group_id": "SG-DEMO-001",
    "device_id": "DEV-DEMO-001",
    "device_name": "misell-demo",
    "release_channel": "stable"
  }' \
  http://localhost:3200/api/admin/devices
```

The response returns `device_token` once. Store it in the terminal env file.

## Manage Device Tokens

Device tokens are stored as hashes. The plain token is shown only when a device is registered or rotated.

Revoke a token immediately:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"reason":"terminal lost"}' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/token/revoke
```

Rotate a token and copy the returned `device_token` into the terminal env file:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"reason":"scheduled rotation"}' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/token/rotate
```

After updating `MISELL_DEVICE_TOKEN` on the terminal, restart the heartbeat timer and player service.

## Device Heartbeat

```bash
curl -H "Authorization: Bearer $DEVICE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d @heartbeat.json \
  http://localhost:3200/api/device/heartbeat
```

Terminal integration:

```bash
MISELL_HEARTBEAT_URL=http://cloud-host:3200/api/device/heartbeat
MISELL_DEVICE_TOKEN=<shown-once-token>
```

Then run on the terminal:

```bash
scripts/emit-heartbeat.sh
```

## Device Log Bundles

Terminals can upload a bounded evidence bundle with recent service status, journal output, and local Misell logs:

```bash
scripts/collect-device-evidence.sh --upload --label incident --reason "kiosk did not start"
```

When `MISELL_HEARTBEAT_URL` ends with `/api/device/heartbeat`, the script derives `MISELL_LOGS_URL` as `/api/device/logs`.

## Store Commerce and QR Foundation

Cloud is the source of truth for store settings, offer definitions, QR links, counter orders, and device event idempotency. Terminals should treat local state as execution/cache state and backfill events with stable `event_id` values.

Store settings are scoped per store and currently include timezone, business day start time, order issue cutoff time, pickup window, currency, and tax included flag. This allows stores with different closing and cutoff times to share the same Cloud schema. Cutoff checks use the store's business-day timeline from `business_day_start_time`, so an after-midnight cutoff such as `02:00` applies to the previous business day.

Offers use immutable revisions. `offers.current_offer_revision_id` points at the active revision, and each `offer_revision` snapshots item names, quantities, prices, tax flags, and order limits. Changing an active offer should create a new revision instead of mutating the published revision.

QR links can resolve to public QR pages or issue counter orders. Counter-order QR links track `offers.current_offer_revision_id` by default, so publishing a new active revision keeps existing displayed QR codes usable. Supplying `offer_revision_id` or `pin_offer_revision` creates an explicitly pinned QR link. Counter orders receive a one-time public `order_token` for lookup and a short `verify_code` for counter redemption. Admin status updates currently support `issued`, `redeemed`, `expired`, and `cancelled`.

Public QR and order routes are unauthenticated by design, but bounded by hash-only rate-limit evidence:

- `GET /q/:qr_token`
- `POST /q/:qr_token/orders`
- `GET /order/:order_token`
- `GET /api/public/orders/:order_token`

Configuration:

```bash
MISELL_PUBLIC_QR_VIEW_LIMIT_PER_MINUTE=120
MISELL_PUBLIC_ORDER_CREATE_LIMIT_PER_MINUTE=8
MISELL_PUBLIC_ORDER_VIEW_LIMIT_PER_MINUTE=120
MISELL_PUBLIC_RATE_LIMIT_WINDOW_SECONDS=60
```

Rejected bursts return HTTP 429 and write `public_rate_limit_events` plus an audit event. The table stores route type, hashed scope, hashed IP, hashed user agent, and window evidence only; raw IP addresses and public tokens are not persisted.

Opening `/order/:order_token` in a browser renders a reusable reception-number card with item name, unit price, quantity, subtotal, total, tax/currency, pickup location/window, and expiry snapshots. The page includes image save/share/copy controls, local previous-order recall, and an iPhone Safari image-preview fallback with long-press save guidance. API clients that do not request `text/html` keep the existing JSON response, and `/api/public/orders/:order_token` returns the same order payload with store profile and resolved receipt snapshot data. Public page actions are recorded in `order_page_events` with a hashed IP and bounded event names.

Store staff redemption uses a separate store-scoped URL and PIN, not the Cloud admin login. Operators create or rotate a store access URL from the Admin UI or:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"pin":"1234","notes":"front counter"}' \
  http://localhost:3200/api/admin/stores/STO-LOCAL/access-token
```

Staff open `/store/orders/:store_token`, enter the PIN, and can list only that store's orders. Marking an order `redeemed` requires the customer's `verify_code`; `issued` and `cancelled` updates remain store-scoped and audited. Store access tokens and staff sessions are hash-only in the DB. PIN failures lock temporarily using `MISELL_STORE_STAFF_PIN_MAX_ATTEMPTS` and `MISELL_STORE_STAFF_PIN_LOCK_SECONDS`; sessions expire with `MISELL_STORE_STAFF_SESSION_TTL_SECONDS`.

Customer management access is separate from staff access. Operators can issue a tenant-scoped customer URL from the Admin UI or API:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{"role":"customer_viewer","store_ids":["STO-LOCAL"],"pin":"2468"}' \
  http://localhost:3200/api/admin/tenants/TEN-LOCAL/customer-access-token
```

Customers open `/customer/admin/:customer_access_token_id`, enter the PIN, and can only read data inside the server-side tenant/store scope. The URL identifier is not a raw secret; the PIN and session token remain hash-only server-side and are not returned in JSON or HTML bootstrap responses. `customer_viewer` can view KPI reports, counter-order status, store settings, and offers. `customer_editor` / `customer_admin` can create a new `offer_revision` for allowed offers; published order snapshots remain immutable.

Device playlogs should send stable `event_id` values. Legacy payloads without `event_id` are still accepted; Cloud derives a `legacy-*` event id from the device and playback fields. Reposting the same `(tenant_id, device_id, event_id)` returns `duplicate: true` without inserting another row.

## Reporting Read Model and Monthly Snapshots

Cloud can aggregate the existing heartbeat, playlog, QR scan, counter-order, and error-log tables into a store/day reporting read model.

- `POST /api/admin/reports/read-model/rebuild` materializes `report_daily_store_metrics` for a requested month or date range.
- `GET /api/admin/reports/summary` returns the same summary shape from live event tables.
- `GET /api/admin/reports/daily-metrics` returns persisted read-model rows.
- `POST /api/admin/reports/monthly-snapshots` rebuilds the read model for a full month and stores an immutable monthly report payload in `report_snapshots`.
- `GET /api/admin/reports/monthly-snapshots` and `GET /api/admin/reports/monthly-snapshots/:snapshot_id` retrieve saved report snapshots.

Report periods are local business days. Bucketing uses each store's `timezone` and `business_day_start_time`, so after-midnight activity can still count toward the previous business day. Monthly snapshots are keyed by report type, period, tenant, store, campaign, and content scope to avoid accidental duplicate monthly reports.

`metrics_sha256` is calculated from a stable normalized report payload with generation timestamps removed. Replacing a monthly snapshot with the same underlying data keeps the same metrics hash while still updating `generated_at` in the saved payload.

Customer scoped conversion reporting is exposed through:

- `GET /api/customer/reports/conversion`
- `GET /api/customer/counter-orders`
- `GET /api/customer/store-settings`
- `GET /api/customer/offers`

The customer conversion report includes QR scans, issued orders, redeemed orders, `scan_to_order_rate`, `order_to_redeem_rate`, issued amount, and redeemed amount. Amount labels are intentionally `potential_sales_amount` and `estimated_redeemed_amount`; they are not POS-settled sales.

## API

- `GET /api/health`
- `POST /api/admin/devices` with Basic auth
- `GET /api/admin/devices` with Basic auth
- `GET /api/admin/devices/:device_id` with Basic auth
- `GET /api/admin/device-log-bundles` with Basic auth
- `GET /api/admin/device-log-bundles/:id` with Basic auth
- `GET /api/admin/release-manifests` with Basic auth
- `POST /api/admin/release-manifests` with Basic auth
- `PATCH /api/admin/release-manifests/:manifest_id` with Basic auth
- `GET /api/admin/content-manifests` with Basic auth
- `POST /api/admin/content-manifests` with Basic auth
- `PATCH /api/admin/content-manifests/:content_id` with Basic auth
- `GET /api/admin/store-settings` with Basic auth
- `GET /api/admin/stores/:store_id/settings` with Basic auth
- `PUT /api/admin/stores/:store_id/settings` with Basic auth
- `PATCH /api/admin/stores/:store_id/settings` with Basic auth
- `GET /api/admin/store-access-tokens` with Basic auth
- `POST /api/admin/stores/:store_id/access-token` with Basic auth
- `POST /api/admin/store-access-tokens/:store_access_token_id/rotate` with Basic auth
- `POST /api/admin/store-access-tokens/:store_access_token_id/pin` with Basic auth
- `GET /api/admin/items` with Basic auth
- `POST /api/admin/items` with Basic auth
- `PATCH /api/admin/items/:item_id` with Basic auth
- `GET /api/admin/offers` with Basic auth
- `POST /api/admin/offers` with Basic auth
- `GET /api/admin/offers/:offer_id` with Basic auth
- `POST /api/admin/offers/:offer_id/revisions` with Basic auth
- `GET /api/admin/qr-links` with Basic auth
- `POST /api/admin/qr-links` with Basic auth
- `GET /api/admin/counter-orders` with Basic auth
- `POST /api/admin/counter-orders` with Basic auth
- `PATCH /api/admin/counter-orders/:counter_order_id/status` with Basic auth
- `GET /api/admin/reports/summary` with Basic auth
- `GET /api/admin/reports/daily-metrics` with Basic auth
- `POST /api/admin/reports/read-model/rebuild` with Basic auth
- `GET /api/admin/reports/monthly-snapshots` with Basic auth
- `POST /api/admin/reports/monthly-snapshots` with Basic auth
- `GET /api/admin/reports/monthly-snapshots/:snapshot_id` with Basic auth
- `GET /q/:qr_token`
- `POST /q/:qr_token/orders`
- `GET /order/:order_token`
- `GET /api/public/orders/:order_token`
- `POST /api/public/orders/:order_token/events`
- `GET /store/orders/:store_token`
- `POST /store/orders/:store_token/session`
- `GET /api/store/orders/session`
- `POST /api/store/orders/logout`
- `GET /api/store/orders`
- `PATCH /api/store/orders/:counter_order_id/status`
- `PATCH /api/admin/devices/:device_id` with Basic auth
- `PATCH /api/admin/devices/:device_id/update` with Basic auth
- `POST /api/admin/devices/:device_id/token/revoke` with Basic auth
- `POST /api/admin/devices/:device_id/token/rotate` with Basic auth
- `GET /api/admin/alerts` with Basic auth
- `GET /api/admin/alert-notifications` with Basic auth
- `POST /api/admin/alert-notifications/test` with Basic auth
- `POST /api/device/heartbeat` with Bearer device token
- `GET /api/device/update-policy` with Bearer device token
- `POST /api/device/update-result` with Bearer device token
- `GET /api/device/content-policy` with Bearer device token
- `POST /api/device/content-result` with Bearer device token
- `POST /api/device/playlog` with Bearer device token
- `POST /api/device/error` with Bearer device token
- `POST /api/device/logs` with Bearer device token

## Device Updates

Schedule a Git-based MVP update from the admin API:

```bash
curl -u admin:change-me \
  -X PATCH \
  -H 'Content-Type: application/json' \
  -d '{
    "target_update_ref": "origin/main",
    "target_release_id": "rel-20260605-001",
    "target_release_channel": "canary"
  }' \
  http://localhost:3200/api/admin/devices/DEV-DEMO-001/update
```

The terminal polls `GET /api/device/update-policy` and reports `updating`, `success`, or `failed` to `POST /api/device/update-result`.

Create an active release manifest to update all terminals on the matching release channel:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "manifest_id": "rel-20260605-canary-001",
    "release_id": "rel-20260605-001",
    "release_channel": "canary",
    "update_ref": "origin/main",
    "status": "active",
    "notes": "canary rollout"
  }' \
  http://localhost:3200/api/admin/release-manifests
```

Per-device update targets take priority over release manifests. Without a per-device target, `GET /api/device/update-policy` returns the active manifest for the device `release_channel` with `source: "release_manifest"` and `target_manifest_id`. Terminals on `hold` do not receive active release manifests.

## Content Manifests

Create an active playlist manifest to update all terminals on the matching release channel:

```bash
curl -u admin:change-me \
  -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    "content_id": "content-20260605-staging-001",
    "playlist_version": "pl-20260605-001",
    "release_channel": "staging",
    "status": "active",
    "title": "staging playlist",
    "playlist": {
      "version": 1,
      "playlist_version": "pl-20260605-001",
      "items": [
        {
          "item_id": "demo-wide",
          "layout": "wide",
          "enabled": true,
          "duration": 12,
          "wide": "/demo/wide.html"
        }
      ]
    }
  }' \
  http://localhost:3200/api/admin/content-manifests
```

The terminal polls `GET /api/device/content-policy` with `scripts/sync-content.sh`. The script writes the returned playlist to the terminal runtime playlist, validates it, and reports the result to `POST /api/device/content-result`.

This MVP content manifest distributes playlist JSON only. Asset file distribution from Cloud storage is a separate next step; playlist sources should currently reference assets already present on the terminal or built-in `/demo/...` sources.

## Data

- Local development DB: `data/misell-cloud.sqlite`
- macOS LaunchAgent DB: `~/.local/share/misell-cloud/data/misell-cloud.sqlite`
- DB files are ignored by Git.

## Schema Migrations

Cloud startup creates the legacy baseline schema and then applies additive migrations recorded in `schema_migrations`.

Operational notes:

- Treat the legacy `CREATE TABLE IF NOT EXISTS` block as the baseline. Future schema changes should be added as new schema migration versions.
- Migrations are additive and do not run automatic down/rollback SQL.
- Reverting app code does not drop tables added by a migration; unused additive tables may remain in SQLite.
- For an emergency rollback that must remove migrated schema or data, restore a verified SQLite backup instead of relying on app startup.
