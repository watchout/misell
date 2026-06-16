#!/usr/bin/env node
"use strict";

const assert = require("assert");
const test = require("node:test");

const {
  ACTIONS,
  ROLES,
  authorizeTenantAction,
  buildManifestContract,
  evaluateEmergencyPublish,
  evaluatePublishApproval,
  getActionDecision,
  mapLegacyScreenGroupToDisplayWall,
  normalizeRole,
  resolveTenantScope
} = require("../../apps/cloud/lib/studio-phase1-contract");

test("legacy store roles normalize to canonical customer roles", () => {
  assert.equal(normalizeRole("store_admin"), ROLES.CUSTOMER_ADMIN);
  assert.equal(normalizeRole("store_viewer"), ROLES.CUSTOMER_VIEWER);
  assert.equal(normalizeRole("customer_editor"), ROLES.CUSTOMER_EDITOR);
});

test("RBAC action matrix blocks viewer publish and allows operator approval", () => {
  assert.equal(getActionDecision("customer_viewer", ACTIONS.NORMAL_SELF_PUBLISH).allowed, false);
  assert.equal(getActionDecision("customer_editor", ACTIONS.NORMAL_SELF_PUBLISH).scope, "tenant");
  assert.equal(getActionDecision("misell_operator", ACTIONS.AD_APPROVAL_DECISION).allowed, true);
  assert.equal(getActionDecision("advertiser", ACTIONS.ASSET_UPLOAD_DELETE).scope, "own ad asset");
});

test("tenant scope is derived from membership and fails closed for cross-tenant requests", () => {
  const allowed = resolveTenantScope({ role: "customer_admin", tenant_ids: ["tenant-a"] }, "tenant-a");
  assert.equal(allowed.ok, true);
  assert.deepEqual(allowed.tenant_ids, ["tenant-a"]);

  const blocked = resolveTenantScope({ role: "customer_admin", tenant_ids: ["tenant-a"] }, "tenant-b");
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "cross_tenant_denied");

  const operator = resolveTenantScope({ role: "misell_operator" }, "tenant-b");
  assert.equal(operator.ok, true);
  assert.equal(operator.scope, "all");
});

test("tenant isolation covers read, write, publish, approval, device, and report-style access", () => {
  const actor = { role: "customer_admin", tenant_ids: ["tenant-a"] };
  const actionCases = [
    ACTIONS.PREVIEW,
    ACTIONS.ASSET_UPLOAD_DELETE,
    ACTIONS.NORMAL_SELF_PUBLISH,
    ACTIONS.AD_APPROVAL_REQUEST,
    ACTIONS.DEVICE_STATUS_OPS,
    ACTIONS.ALL_TENANT_VISIBILITY
  ];

  for (const action of actionCases) {
    const result = authorizeTenantAction(actor, action, "tenant-b");
    assert.equal(result.ok, false, `${action} must fail closed across tenants`);
  }
});

test("legacy three-device screen group maps deterministically to display wall screens", () => {
  const mapped = mapLegacyScreenGroupToDisplayWall(
    {
      tenant_id: "tenant-a",
      store_id: "store-a",
      screen_group_id: "wall-a"
    },
    [
      { device_id: "device-center", display_order: 2 },
      { device_id: "device-right", display_order: 3 },
      { device_id: "device-left", display_order: 1 }
    ]
  );

  assert.equal(mapped.display_wall_id, "wall-a");
  assert.deepEqual(mapped.screens.map((screen) => screen.position), ["left", "center", "right"]);
  assert.deepEqual(mapped.screens.map((screen) => screen.device_id), ["device-left", "device-center", "device-right"]);
});

test("legacy migration fixture refuses to guess missing screen order", () => {
  assert.throws(
    () => mapLegacyScreenGroupToDisplayWall(
      { tenant_id: "tenant-a", store_id: "store-a", screen_group_id: "wall-a" },
      [{ device_id: "a" }, { device_id: "b" }, { device_id: "c" }]
    ),
    /explicit fixture metadata/
  );
});

test("manifest contract includes scope, version, and stable content hash", () => {
  const manifest = buildManifestContract({
    tenant_id: "tenant-a",
    site_id: "store-a",
    display_wall_id: "wall-a",
    manifest_schema_version: 1,
    manifest_version: 12,
    playlist: [{ id: "item-a", asset_id: "asset-a" }],
    assets: [{ asset_id: "asset-a", sha256: "abc" }]
  });

  assert.equal(manifest.tenant_id, "tenant-a");
  assert.equal(manifest.site_id, "store-a");
  assert.equal(manifest.display_wall_id, "wall-a");
  assert.equal(manifest.manifest_version, 12);
  assert.match(manifest.content_hash, /^[a-f0-9]{64}$/);
});

test("ad/media approval guard fails closed", () => {
  const subject = {
    tenant_id: "tenant-a",
    site_id: "site-a",
    display_wall_id: "wall-a",
    subject_type: "asset",
    subject_id: "asset-a",
    subject_hash: "hash-a",
    content_hash: "content-hash-a"
  };

  assert.equal(evaluatePublishApproval({
    content_type: "normal",
    ...subject,
    approvals: [{ ...subject, content_type: "normal", approval_status: "not_required" }]
  }).allowed, true);

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    approvals: []
  }).allowed, false);

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    approvals: [{ ...subject, content_type: "ad", approval_status: "pending" }]
  }).allowed, false);

  assert.equal(evaluatePublishApproval({
    content_type: "sponsor",
    ...subject,
    approvals: [{ ...subject, content_type: "sponsor", subject_hash: "changed", approval_status: "approved" }]
  }).reason, "approval_hash_mismatch");

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    approvals: [{ ...subject, content_type: "ad", tenant_id: "tenant-b", approval_status: "approved" }]
  }).reason, "approval_tenant_mismatch");

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    approvals: [{ ...subject, content_type: "ad", content_hash: "changed", approval_status: "approved" }]
  }).reason, "approval_content_hash_mismatch");

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    now: new Date("2026-06-16T00:00:00.000Z"),
    approvals: [{ ...subject, content_type: "ad", approval_status: "approved", expires_at: "2026-06-15T00:00:00.000Z" }]
  }).reason, "approval_expired");

  assert.equal(evaluatePublishApproval({
    content_type: "ad",
    ...subject,
    approvals: [{ ...subject, content_type: "ad", approval_status: "approved" }]
  }).allowed, true);
});

test("emergency publish path is operator-only and requires actor evidence", () => {
  assert.equal(evaluateEmergencyPublish({
    actor_role: "customer_admin",
    actor_id: "user-a",
    timestamp: "2026-06-16T00:00:00.000Z",
    audit_reason: "test"
  }).allowed, false);

  assert.equal(evaluateEmergencyPublish({
    actor_role: "misell_operator",
    actor_id: "operator-a",
    timestamp: "2026-06-16T00:00:00.000Z",
    audit_reason: ""
  }).reason, "audit_reason_required");

  assert.equal(evaluateEmergencyPublish({
    actor_role: "misell_operator",
    actor_id: "",
    timestamp: "2026-06-16T00:00:00.000Z",
    audit_reason: "safety override"
  }).reason, "actor_id_required");

  assert.equal(evaluateEmergencyPublish({
    actor_role: "misell_operator",
    actor_id: "operator-a",
    timestamp: "",
    audit_reason: "safety override"
  }).reason, "timestamp_required");

  assert.equal(evaluateEmergencyPublish({
    actor_role: "misell_operator",
    actor_id: "operator-a",
    timestamp: "2026-06-16T00:00:00.000Z",
    audit_reason: "safety override"
  }).allowed, true);
});
