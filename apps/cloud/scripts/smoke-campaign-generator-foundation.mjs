import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const adminUser = process.env.ADMIN_USER || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "change-me";
const adminAuth = `Basic ${Buffer.from(`${adminUser}:${adminPassword}`).toString("base64")}`;
const runId = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let serverProcess = null;
let tmpDir = "";
let dbPath = "";
let baseUrl = "";

main().catch(async (error) => {
  console.error(error);
  await stopServer();
  process.exit(1);
});

async function main() {
  await startServer();
  try {
    const records = await seedDevices();
    await seedContext(records);
    const beforeContentManifestCount = tableCount("content_manifests");
    const beforePublishHistoryCount = tableCount("publish_history");
    const beforeCreditLedgerCount = optionalTableCount("ai_credit_ledger");

    const selectedProposalResponse = await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-selected`,
      title: "雨の日の館内回遊プロジェクト",
      objective: "雨の日でも館内回遊のきっかけを増やす",
      status: "selected"
    }));
    const selectedProposal = selectedProposalResponse.data.campaign_proposal;
    if (!selectedProposal.campaign_brief_id) throw new Error("selected proposal did not create a campaign brief");

    const projectFromProposal = await admin("POST", "/api/admin/campaign-projects/from-proposal", {
      campaign_proposal_id: selectedProposal.campaign_proposal_id,
      scenes: validScenes()
    });
    assertProject(projectFromProposal.data.campaign_project, "campaign_proposal", records);
    if (projectFromProposal.data.campaign_project.scenes.length !== 3) {
      throw new Error(`project from proposal should have 3 scenes: ${projectFromProposal.text}`);
    }

    const validateSelected = await admin("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/validate`, {});
    if (!validateSelected.data.valid || validateSelected.data.campaign_project.status !== "validated") {
      throw new Error(`selected proposal project did not validate: ${validateSelected.text}`);
    }
    if (validateSelected.data.campaign_project.scenes.some((scene) => scene.status !== "valid")) {
      throw new Error(`validated project contains non-valid scenes: ${validateSelected.text}`);
    }
    const beforeHandoffContentManifestCount = tableCount("content_manifests");
    const beforeHandoffPublishHistoryCount = tableCount("publish_history");
    const playlistHandoffDraft = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/playlist-handoff-draft?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    assertPlaylistHandoffDraft(playlistHandoffDraft.data.playlist_handoff_draft, {
      projectId: projectFromProposal.data.campaign_project.campaign_project_id,
      sceneCount: 3,
      records,
      expectedFirstHeadline: "selected 雨の日の過ごし方",
      expectValid: true
    });
    await expectAdminError("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/playlist-handoff-draft?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");
    if (tableCount("content_manifests") !== beforeHandoffContentManifestCount) {
      throw new Error("playlist handoff draft should not create content_manifest rows");
    }
    if (tableCount("publish_history") !== beforeHandoffPublishHistoryCount) {
      throw new Error("playlist handoff draft should not create publish_history rows");
    }
    const scheduleHandoffDraft = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/schedule-handoff-draft?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    assertScheduleHandoffDraft(scheduleHandoffDraft.data.schedule_handoff_draft, {
      projectId: projectFromProposal.data.campaign_project.campaign_project_id,
      sceneCount: 3,
      records,
      playlistDraft: playlistHandoffDraft.data.playlist_handoff_draft,
      expectValid: true
    });
    await expectAdminError("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/schedule-handoff-draft?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");
    if (tableCount("content_manifests") !== beforeHandoffContentManifestCount) {
      throw new Error("schedule handoff draft should not create content_manifest rows");
    }
    if (tableCount("publish_history") !== beforeHandoffPublishHistoryCount) {
      throw new Error("schedule handoff draft should not create publish_history rows");
    }
    const requestScene = validateSelected.data.campaign_project.scenes[0];
    const sceneBeforeRequests = sceneMutationSnapshot(requestScene);
    for (const requestType of ["scene_regeneration", "copy_regeneration", "qr_cta_regeneration"]) {
      const regeneration = await admin("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${requestScene.campaign_project_scene_id}/regeneration-requests`, {
        request_type: requestType,
        reason: `${requestType} smoke request`
      });
      const request = regeneration.data.regeneration_request;
      if (request.status !== "manual_required" || request.request_type !== requestType) {
        throw new Error(`unexpected regeneration request response: ${regeneration.text}`);
      }
      for (const field of ["no_external_ai", "no_scene_mutation", "no_content_manifest_creation", "no_publish", "no_credit_consumption"]) {
        if (request[field] !== true) throw new Error(`regeneration request missing ${field}: ${regeneration.text}`);
      }
    }
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${requestScene.campaign_project_scene_id}/regeneration-requests`, {
      request_type: "scene_regeneration",
      external_ai_used: true
    }, 400, "external AI");
    const projectAfterRegenerationRequests = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}`);
    const sceneAfterRequests = projectAfterRegenerationRequests.data.campaign_project.scenes.find((scene) => scene.campaign_project_scene_id === requestScene.campaign_project_scene_id);
    if (JSON.stringify(sceneMutationSnapshot(sceneAfterRequests)) !== JSON.stringify(sceneBeforeRequests)) {
      throw new Error(`regeneration request mutated scene content: before=${JSON.stringify(sceneBeforeRequests)} after=${JSON.stringify(sceneMutationSnapshot(sceneAfterRequests))}`);
    }
    for (const requestType of ["scene_regeneration", "copy_regeneration", "qr_cta_regeneration"]) {
      const action = regenerationAction(requestType);
      const event = projectAfterRegenerationRequests.data.campaign_project.events.find((entry) => entry.action === action);
      if (!event) throw new Error(`regeneration request event missing for ${action}`);
      if (event.metadata?.request_type !== requestType || event.metadata?.request_status !== "manual_required") {
        throw new Error(`regeneration event metadata mismatch: ${JSON.stringify(event)}`);
      }
      for (const field of ["no_external_ai", "no_scene_mutation", "no_content_manifest_creation", "no_publish", "no_credit_consumption"]) {
        if (event.metadata?.[field] !== true) throw new Error(`regeneration event missing ${field}: ${JSON.stringify(event)}`);
      }
    }

    const projectFromBrief = await admin("POST", "/api/admin/campaign-projects/from-brief", {
      campaign_brief_id: selectedProposal.campaign_brief_id,
      scenes: [validScenes()[0]]
    });
    assertProject(projectFromBrief.data.campaign_project, "campaign_brief", records);
    db().prepare(`
      UPDATE campaign_project_scenes
      SET screen_group_id = ?
      WHERE campaign_project_id = ?
    `).run(records.otherStoreScreenGroupId, projectFromBrief.data.campaign_project.campaign_project_id);
    const scopeMismatchValidation = await admin("POST", `/api/admin/campaign-projects/${projectFromBrief.data.campaign_project.campaign_project_id}/validate`, {});
    if (scopeMismatchValidation.data.valid) throw new Error("project with scene scope mismatch should fail validation");
    if (!scopeMismatchValidation.data.validation_errors.some((error) => error.code === "scope_mismatch")) {
      throw new Error(`scope mismatch validation error missing: ${scopeMismatchValidation.text}`);
    }

    const freeInputProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "夏休み前のファミリー訴求",
      objective: "平日昼のファミリー利用に向けた案内を整理する",
      target_audience: "平日昼に来店する家族連れ",
      store_context: "駅前店舗。雨の日は滞在時間が長くなりやすい。",
      offer_or_message: "親子で使いやすい個室と軽食メニューを案内する",
      cta: "QRから当日のおすすめを見る",
      success_metrics: ["play_count", "qr_scan_count"],
      constraints: ["保証表現を避ける", "個人情報を入れない"],
      auto_generate_scenes: true
    });
    assertProject(freeInputProject.data.campaign_project, "free_input", records);
    assertGeneratedSceneSet(freeInputProject.data.campaign_project, {
      expectedCount: 3,
      expectedOrders: [1, 2, 3],
      expectedHeadline: "夏休み前のファミリー訴求"
    });
    const validateFree = await admin("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/validate`, {});
    if (!validateFree.data.valid || validateFree.data.campaign_project.status !== "validated") {
      throw new Error(`free input project did not validate: ${validateFree.text}`);
    }
    const generatedCreateEvent = validateFree.data.campaign_project.events.find((event) => event.action === "project.created");
    if (!generatedCreateEvent ||
      generatedCreateEvent.metadata?.generator_type !== "deterministic_template" ||
      generatedCreateEvent.metadata?.generator_version !== "campaign-demo-v1" ||
      generatedCreateEvent.metadata?.scene_count !== 3 ||
      generatedCreateEvent.metadata?.auto_generate_scenes !== true ||
      generatedCreateEvent.metadata?.no_external_ai !== true ||
      generatedCreateEvent.metadata?.no_content_manifest_creation !== true) {
      throw new Error(`auto-generated create event missing guards: ${validateFree.text}`);
    }
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "明示Sceneと自動生成の併用拒否",
      objective: "生成由来の証跡を曖昧にしない",
      target_audience: "運用担当者",
      store_context: "管理画面で編集する",
      offer_or_message: "手入力か自動生成のどちらかを選ぶ",
      cta: "QRから確認",
      scenes: validScenes(),
      auto_generate_scenes: true
    }, 400, "cannot be supplied together");
    const reorderSourceScene = validateFree.data.campaign_project.scenes.find((scene) => scene.scene_order === 2);
    const reorderSwapScene = validateFree.data.campaign_project.scenes.find((scene) => scene.scene_order === 1);
    const reorderUp = await admin("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${reorderSourceScene.campaign_project_scene_id}/reorder`, {
      direction: "up"
    });
    if (reorderUp.data.campaign_project_scene.scene_order !== 1) {
      throw new Error(`scene did not move up: ${reorderUp.text}`);
    }
    if (reorderUp.data.campaign_project.status !== "draft" || reorderUp.data.campaign_project.validation_status !== "draft") {
      throw new Error(`reorder should return project to draft state: ${reorderUp.text}`);
    }
    const reorderUpScenes = reorderUp.data.campaign_project.scenes;
    if (reorderUpScenes.find((scene) => scene.campaign_project_scene_id === reorderSwapScene.campaign_project_scene_id)?.scene_order !== 2) {
      throw new Error(`swap scene did not move down: ${reorderUp.text}`);
    }
    const reorderEvent = reorderUp.data.campaign_project.events.find((event) => event.action === "scene.reordered");
    if (!reorderEvent || reorderEvent.metadata?.direction !== "up" || reorderEvent.metadata?.no_content_manifest_creation !== true) {
      throw new Error(`reorder event missing or unsafe: ${reorderUp.text}`);
    }
    const reorderDown = await admin("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${reorderSourceScene.campaign_project_scene_id}/reorder`, {
      direction: "down"
    });
    if (reorderDown.data.campaign_project_scene.scene_order !== 2) {
      throw new Error(`scene did not move down: ${reorderDown.text}`);
    }
    await expectAdminError("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${reorderSwapScene.campaign_project_scene_id}/reorder`, {
      direction: "up"
    }, 409, "cannot move up");
    const duplicateScene = await admin("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${reorderSourceScene.campaign_project_scene_id}/duplicate`, {});
    if (duplicateScene.data.campaign_project_scene.scene_order <= 3 || duplicateScene.data.campaign_project_scene.status !== "draft") {
      throw new Error(`duplicate scene should be a fresh draft with a new order: ${duplicateScene.text}`);
    }
    if (sceneMutationSnapshot(duplicateScene.data.campaign_project_scene).headline !== sceneMutationSnapshot(reorderSourceScene).headline) {
      throw new Error(`duplicate scene did not copy source content: ${duplicateScene.text}`);
    }
    const projectAfterDuplicate = await admin("GET", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}`);
    const duplicateEvent = projectAfterDuplicate.data.campaign_project.events.find((event) => event.action === "scene.duplicated");
    if (!duplicateEvent || duplicateEvent.metadata?.source_scene_id !== reorderSourceScene.campaign_project_scene_id || duplicateEvent.metadata?.no_publish !== true) {
      throw new Error(`duplicate event missing or unsafe: ${projectAfterDuplicate.text}`);
    }

    const invalidProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "validation failure project",
      objective: "validation failure",
      target_audience: "test audience",
      store_context: "test store context",
      offer_or_message: "test message",
      cta: "QRを見る",
      scenes: [
        {
          scene_order: 1,
          scene_type: "hook",
          headline: "売上が必ず上がるキャンペーン",
          body_text: "担当者 test@example.com に連絡してください",
          visual_direction: "店内写真",
          cta_text: "",
          duration_seconds: 0
        }
      ]
    });
    const invalidValidation = await admin("POST", `/api/admin/campaign-projects/${invalidProject.data.campaign_project.campaign_project_id}/validate`, {});
    if (invalidValidation.data.valid) throw new Error(`invalid project unexpectedly validated: ${invalidValidation.text}`);
    const invalidCodes = new Set(invalidValidation.data.validation_errors.map((error) => error.code));
    for (const code of ["invalid", "missing_cta", "guaranteed_outcome_claim", "direct_pii"]) {
      if (!invalidCodes.has(code)) throw new Error(`expected validation error ${code}, got ${JSON.stringify([...invalidCodes])}`);
    }

    const emptyProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      title: "既存プロジェクトへの初期Scene生成",
      objective: "店内での次の行動を案内する",
      target_audience: "受付後に待っているお客様",
      store_context: "待合スペースに大きな画面がある",
      offer_or_message: "受付後に確認してほしい案内を短く伝える",
      cta: "QRから案内を見る",
      auto_generate_scenes: false
    });
    if (emptyProject.data.campaign_project.scenes.length !== 0) {
      throw new Error(`empty project should not auto-generate scenes: ${emptyProject.text}`);
    }
    const generatedScenes = await admin("POST", `/api/admin/campaign-projects/${emptyProject.data.campaign_project.campaign_project_id}/generate-scenes`, {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId
    });
    if (generatedScenes.data.generator?.generator_type !== "deterministic_template" || generatedScenes.data.generator?.external_ai_used !== false) {
      throw new Error(`generate-scenes response missing deterministic generator metadata: ${generatedScenes.text}`);
    }
    assertGeneratedSceneSet(generatedScenes.data.campaign_project, {
      expectedCount: 3,
      expectedOrders: [1, 2, 3],
      expectedHeadline: "既存プロジェクトへの初期Scene生成"
    });
    const generateEvent = generatedScenes.data.campaign_project.events.find((event) => event.action === "project.scenes.generated");
    if (!generateEvent || generateEvent.metadata?.generator_type !== "deterministic_template" || generateEvent.metadata?.no_external_ai !== true || generateEvent.metadata?.no_publish !== true) {
      throw new Error(`project.scenes.generated event missing guards: ${generatedScenes.text}`);
    }
    const validateGeneratedScenes = await admin("POST", `/api/admin/campaign-projects/${emptyProject.data.campaign_project.campaign_project_id}/validate`, {});
    if (!validateGeneratedScenes.data.valid) throw new Error(`generated scenes should validate: ${validateGeneratedScenes.text}`);
    await expectAdminError("POST", `/api/admin/campaign-projects/${emptyProject.data.campaign_project.campaign_project_id}/generate-scenes`, {}, 409, "already has active scenes");
    await expectAdminError("POST", `/api/admin/campaign-projects/${emptyProject.data.campaign_project.campaign_project_id}/generate-scenes`, {
      tenant_id: records.otherTenantId
    }, 403, "tenant scope");

    const proposedResponse = await admin("POST", "/api/admin/campaign-proposals", proposalInput(records, {
      campaign_proposal_id: `cpr-${runId}-proposed`,
      title: "未採用提案",
      status: "proposed"
    }));
    await expectAdminError("POST", "/api/admin/campaign-projects/from-proposal", {
      campaign_proposal_id: proposedResponse.data.campaign_proposal.campaign_proposal_id,
      scenes: validScenes()
    }, 400, "must be selected");

    const badProjectId = insertBadProjectFixture(records, proposedResponse.data.campaign_proposal.campaign_proposal_id);
    await admin("POST", `/api/admin/campaign-projects/${badProjectId}/scenes`, validScenes()[0]);
    const badProjectValidation = await admin("POST", `/api/admin/campaign-projects/${badProjectId}/validate`, {});
    if (badProjectValidation.data.valid) throw new Error("project with non-selected source proposal should fail validation");
    if (!badProjectValidation.data.validation_errors.some((error) => error.code === "non_selected_proposal")) {
      throw new Error(`non-selected proposal validation error missing: ${badProjectValidation.text}`);
    }

    await expectAdminError("POST", "/api/admin/campaign-projects/from-proposal", {
      tenant_id: records.tenantId,
      store_id: records.otherStoreId,
      screen_group_id: records.screenGroupId,
      campaign_proposal_id: selectedProposal.campaign_proposal_id,
      scenes: validScenes()
    }, 403, "store scope");

    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "外部AI拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      external_ai_used: true
    }, 400, "external AI");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "publish拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      publish: true
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "content manifest拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      content_manifest_id: "content-should-not-exist"
    }, 400, "out of scope");
    await expectAdminError("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.storeId,
      screen_group_id: records.screenGroupId,
      objective: "render拒否",
      target_audience: "test",
      store_context: "test",
      offer_or_message: "test",
      cta: "test",
      render: { mode: "video" }
    }, 400, "out of scope");

    const scopedList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    const scopedIds = scopedList.data.campaign_projects.map((project) => project.campaign_project_id);
    if (!scopedIds.includes(projectFromProposal.data.campaign_project.campaign_project_id) || !scopedIds.includes(freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error(`scoped campaign project list missing expected project: ${JSON.stringify(scopedIds)}`);
    }
    const otherProject = await admin("POST", "/api/admin/campaign-projects/free-input", {
      tenant_id: records.tenantId,
      store_id: records.otherStoreId,
      screen_group_id: records.otherStoreScreenGroupId,
      title: "other store project",
      objective: "other objective",
      target_audience: "other audience",
      store_context: "other context",
      offer_or_message: "other message",
      cta: "other CTA",
      scenes: validScenes("other")
    });
    const scopedListAfterOther = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    const scopedIdsAfterOther = scopedListAfterOther.data.campaign_projects.map((project) => project.campaign_project_id);
    if (scopedIdsAfterOther.includes(otherProject.data.campaign_project.campaign_project_id)) {
      throw new Error(`scoped list leaked other store project: ${JSON.stringify(scopedIdsAfterOther)}`);
    }
    await expectAdminError("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}?tenant_id=${records.otherTenantId}`, null, 403, "tenant scope");

    const sceneToDelete = projectFromProposal.data.campaign_project.scenes.reduce((highest, scene) => (
      scene.scene_order > highest.scene_order ? scene : highest
    ), projectFromProposal.data.campaign_project.scenes[0]);
    const deletedScene = await admin("DELETE", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${sceneToDelete.campaign_project_scene_id}`);
    if (deletedScene.data.campaign_project_scene.status !== "deleted") throw new Error(`scene was not soft deleted: ${deletedScene.text}`);
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${sceneToDelete.campaign_project_scene_id}/regeneration-requests`, {
      request_type: "scene_regeneration",
      reason: "deleted scene should reject"
    }, 400, "deleted");
    const afterSceneDelete = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}`);
    if (afterSceneDelete.data.campaign_project.scenes.some((scene) => scene.campaign_project_scene_id === sceneToDelete.campaign_project_scene_id)) {
      throw new Error("deleted scene should be hidden from project detail by default");
    }
    const handoffAfterSceneDelete = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/playlist-handoff-draft`);
    assertPlaylistHandoffDraft(handoffAfterSceneDelete.data.playlist_handoff_draft, {
      projectId: projectFromProposal.data.campaign_project.campaign_project_id,
      sceneCount: 2,
      records,
      expectedFirstHeadline: "selected 雨の日の過ごし方",
      expectValid: false
    });
    if (handoffAfterSceneDelete.data.playlist_handoff_draft.playlist.items.some((item) => item.source_scene_id === sceneToDelete.campaign_project_scene_id)) {
      throw new Error("playlist handoff draft should exclude deleted scene");
    }
    const scheduleHandoffAfterSceneDelete = await admin("GET", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/schedule-handoff-draft`);
    assertScheduleHandoffDraft(scheduleHandoffAfterSceneDelete.data.schedule_handoff_draft, {
      projectId: projectFromProposal.data.campaign_project.campaign_project_id,
      sceneCount: 2,
      records,
      playlistDraft: handoffAfterSceneDelete.data.playlist_handoff_draft,
      expectValid: false
    });
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${sceneToDelete.campaign_project_scene_id}/reorder`, {
      direction: "up"
    }, 400, "deleted");
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes/${sceneToDelete.campaign_project_scene_id}/duplicate`, {}, 400, "deleted");
    const { scene_order: _ignoredSceneOrder, ...replacementSceneInput } = validScenes("replacement")[0];
    const replacementScene = await admin("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes`, replacementSceneInput);
    if (replacementScene.data.campaign_project_scene.scene_order !== sceneToDelete.scene_order + 1) {
      throw new Error(`replacement scene should not reuse deleted scene_order: ${replacementScene.text}`);
    }
    await expectAdminError("POST", `/api/admin/campaign-projects/${projectFromProposal.data.campaign_project.campaign_project_id}/scenes`, {
      ...replacementSceneInput,
      scene_order: sceneToDelete.scene_order
    }, 409, "cannot be reused");
    const deletedProject = await admin("DELETE", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}`);
    if (deletedProject.data.campaign_project.status !== "deleted" || !deletedProject.data.campaign_project.deleted_at) {
      throw new Error(`project was not soft deleted: ${deletedProject.text}`);
    }
    await expectAdminError("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${freeInputProject.data.campaign_project.scenes[0].campaign_project_scene_id}/regeneration-requests`, {
      request_type: "scene_regeneration",
      reason: "deleted project should reject"
    }, 400, "deleted");
    await expectAdminError("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${freeInputProject.data.campaign_project.scenes[0].campaign_project_scene_id}/reorder`, {
      direction: "down"
    }, 400, "deleted");
    await expectAdminError("POST", `/api/admin/campaign-projects/${freeInputProject.data.campaign_project.campaign_project_id}/scenes/${freeInputProject.data.campaign_project.scenes[0].campaign_project_scene_id}/duplicate`, {}, 400, "deleted");
    const postDeleteList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}`);
    if (postDeleteList.data.campaign_projects.some((project) => project.campaign_project_id === freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error("deleted project should be hidden from default list");
    }
    const deletedList = await admin("GET", `/api/admin/campaign-projects?tenant_id=${records.tenantId}&store_id=${records.storeId}&screen_group_id=${records.screenGroupId}&status=deleted&include_deleted=1`);
    if (!deletedList.data.campaign_projects.some((project) => project.campaign_project_id === freeInputProject.data.campaign_project.campaign_project_id)) {
      throw new Error("deleted project should be visible when status=deleted and include_deleted=1");
    }

    const afterContentManifestCount = tableCount("content_manifests");
    if (afterContentManifestCount !== beforeContentManifestCount) {
      throw new Error(`content_manifest was created unexpectedly: before=${beforeContentManifestCount} after=${afterContentManifestCount}`);
    }
    if (tableCount("publish_history") !== beforePublishHistoryCount) throw new Error("publish history should not be created by campaign generator foundation");
    if (optionalTableCount("ai_credit_ledger") !== beforeCreditLedgerCount) throw new Error("credit ledger should not be touched by campaign generator foundation");
    if (tableCount("campaign_projects") < 5) throw new Error("campaign_projects rows were not created");
    if (tableCount("campaign_project_scenes") < 7) throw new Error("campaign_project_scenes rows were not created");
    if (tableCount("campaign_project_events") < 11) throw new Error("campaign_project_events rows were not created");

    console.log(JSON.stringify({
      ok: true,
      base_url: baseUrl,
      selected_proposal_to_brief_to_project: true,
      existing_brief_to_project: true,
      free_input_to_brief_to_project: true,
      scene_validation_pass_fail: true,
      deterministic_scene_generation_on_create: true,
      deterministic_scene_generation_for_existing_project: true,
      scope_mismatch_validation_fail: true,
      non_selected_proposal_validation_fail: true,
      tenant_store_screen_group_isolation: true,
      soft_delete: true,
      scene_order_no_reuse_after_soft_delete: true,
      scene_reorder_adjacent_swap: true,
      scene_duplicate_draft: true,
      playlist_handoff_draft: true,
      schedule_handoff_draft: true,
      regeneration_request_stub: true,
      regeneration_request_visible_events: true,
      no_external_ai: true,
      no_media_generation: true,
      no_content_manifest_creation: true,
      no_publish: true,
      no_credit_consumption: true
    }, null, 2));
  } finally {
    await stopServer();
  }
}

async function seedDevices() {
  const records = {
    tenantId: `TEN-CGF-${runId}`,
    otherTenantId: `TEN-CGF-OTHER-${runId}`,
    storeId: `STO-CGF-${runId}`,
    otherStoreId: `STO-CGF-OTHER-${runId}`,
    foreignStoreId: `STO-CGF-FOREIGN-${runId}`,
    screenGroupId: `SG-CGF-${runId}`,
    otherStoreScreenGroupId: `SG-CGF-OTHER-STORE-${runId}`,
    foreignScreenGroupId: `SG-CGF-FOREIGN-${runId}`
  };
  await seedDevice(records.tenantId, records.storeId, records.screenGroupId, `DEV-CGF-${runId}`);
  await seedDevice(records.tenantId, records.otherStoreId, records.otherStoreScreenGroupId, `DEV-CGF-OTHER-${runId}`);
  await seedDevice(records.otherTenantId, records.foreignStoreId, records.foreignScreenGroupId, `DEV-CGF-FOREIGN-${runId}`);
  return records;
}

async function seedDevice(tenantId, storeId, screenGroupId, deviceId) {
  await admin("POST", "/api/admin/devices", {
    tenant_id: tenantId,
    tenant_name: `${tenantId} Name`,
    store_id: storeId,
    store_name: `${storeId} Store`,
    location_id: `LOC-${screenGroupId}`,
    location_name: "Main",
    screen_group_id: screenGroupId,
    screen_group_name: `${screenGroupId} Front`,
    device_id: deviceId,
    device_name: `${deviceId} Player`,
    release_channel: "stable"
  });
}

async function seedContext(records) {
  await admin("POST", "/api/admin/customer-context-items", contextInput(records, {
    context_category: "customer_profile",
    source_owner: "customer",
    source_type: "customer_input",
    confidence: "customer_confirmed",
    item_type: "store_profile",
    item_key: "rainy_day",
    value: { audience: "families", condition: "rainy weekday" }
  }));
}

function contextInput(records, overrides = {}) {
  return {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    context_category: "customer_profile",
    visibility_scope: "customer_visible",
    source_owner: "misell_operator",
    source_type: "operator_input",
    confidence: "operator_confirmed",
    item_type: "context_note",
    item_key: "default",
    value: {},
    ...overrides
  };
}

function proposalInput(records, overrides = {}) {
  return {
    tenant_id: records.tenantId,
    store_id: records.storeId,
    screen_group_id: records.screenGroupId,
    proposal_month: "2026-07",
    title: "月次販促提案",
    objective: "来店中の回遊を増やす",
    target_audience: "平日昼の来店客",
    three_screen_outline: [
      { order: 1, copy: "雨の日でも楽しめる館内導線" },
      { order: 2, copy: "おすすめメニューと滞在提案" },
      { order: 3, copy: "QRからクーポンを確認" }
    ],
    qr_flow: "QRから当日のおすすめを見る",
    recommended_time_slots: ["11:00-15:00"],
    expected_effect: "QR反応を見るための検証仮説",
    required_assets: ["store-photo", "menu-photo"],
    status: "proposed",
    ...overrides
  };
}

function validScenes(prefix = "selected") {
  return [
    {
      scene_order: 1,
      scene_type: "hook",
      headline: `${prefix} 雨の日の過ごし方`,
      body_text: "店内でゆっくり過ごせるおすすめ導線を案内します",
      visual_direction: "入口と店内の明るい写真",
      cta_text: "QRからおすすめを見る",
      duration_seconds: 8,
      asset_requirements: ["store-photo"]
    },
    {
      scene_order: 2,
      scene_type: "offer",
      headline: `${prefix} 今日のおすすめ`,
      body_text: "軽食と個室利用の組み合わせを案内します",
      visual_direction: "メニュー写真と客席写真",
      cta_text: "詳しく見る",
      duration_seconds: 10,
      asset_requirements: ["menu-photo"]
    },
    {
      scene_order: 3,
      scene_type: "cta",
      headline: `${prefix} QRで確認`,
      body_text: "来店中に使える案内をスマートフォンで確認できます",
      visual_direction: "QRと短い案内文",
      cta_text: "QRを読み取る",
      duration_seconds: 7,
      asset_requirements: []
    }
  ];
}

function assertProject(project, sourceType, records) {
  if (!project || project.source_type !== sourceType) throw new Error(`unexpected project source_type: ${JSON.stringify(project)}`);
  if (project.tenant_id !== records.tenantId || !project.store_id || !project.screen_group_id) {
    throw new Error(`project scope is invalid: ${JSON.stringify(project)}`);
  }
  for (const field of ["objective", "target_audience", "store_context", "offer_or_message", "cta"]) {
    if (!project[field]) throw new Error(`project missing normalized brief field ${field}: ${JSON.stringify(project)}`);
  }
  if (!project.no_external_ai || !project.no_content_manifest_creation || !project.no_media_generation || !project.no_publish) {
    throw new Error(`project response is missing out-of-scope guards: ${JSON.stringify(project)}`);
  }
}

function assertGeneratedSceneSet(project, options) {
  const scenes = project.scenes || [];
  if (scenes.length !== options.expectedCount) {
    throw new Error(`generated scene count mismatch: expected=${options.expectedCount} project=${JSON.stringify(project)}`);
  }
  const orders = scenes.map((scene) => scene.scene_order).sort((a, b) => a - b);
  if (JSON.stringify(orders) !== JSON.stringify(options.expectedOrders)) {
    throw new Error(`generated scene order mismatch: expected=${JSON.stringify(options.expectedOrders)} got=${JSON.stringify(orders)}`);
  }
  if (scenes[0]?.headline !== options.expectedHeadline) {
    throw new Error(`generated first headline mismatch: expected=${options.expectedHeadline} scene=${JSON.stringify(scenes[0])}`);
  }
  for (const scene of scenes) {
    if (!scene.headline || !scene.body_text || !scene.visual_direction || !scene.cta_text || scene.duration_seconds <= 0) {
      throw new Error(`generated scene missing required fields: ${JSON.stringify(scene)}`);
    }
    if (scene.status !== "draft" || scene.validation_status !== "draft") {
      throw new Error(`generated scene should start as draft: ${JSON.stringify(scene)}`);
    }
  }
}

function assertPlaylistHandoffDraft(draft, options) {
  if (!draft || draft.schema_version !== "campaign-project-playlist-handoff-draft/v1") {
    throw new Error(`playlist handoff draft schema mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.campaign_project_id !== options.projectId) {
    throw new Error(`playlist handoff draft project mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.tenant_id !== options.records.tenantId || draft.store_id !== options.records.storeId || draft.screen_group_id !== options.records.screenGroupId) {
    throw new Error(`playlist handoff draft scope mismatch: ${JSON.stringify(draft)}`);
  }
  for (const field of ["no_external_ai", "no_media_generation", "no_content_manifest_creation", "no_publish", "no_credit_consumption"]) {
    if (draft[field] !== true) throw new Error(`playlist handoff draft missing guard ${field}: ${JSON.stringify(draft)}`);
  }
  if (draft.publish_ready !== false || draft.content_manifest_created !== false) {
    throw new Error(`playlist handoff draft must remain non-publishable: ${JSON.stringify(draft)}`);
  }
  if (!/^[a-f0-9]{64}$/.test(draft.draft_sha256 || "")) {
    throw new Error(`playlist handoff draft sha256 missing: ${JSON.stringify(draft)}`);
  }
  if (draft.validation?.valid !== options.expectValid) {
    throw new Error(`playlist handoff draft validation mismatch: ${JSON.stringify(draft)}`);
  }
  const items = draft.playlist?.items || [];
  if (items.length !== options.sceneCount || draft.playlist?.item_count !== options.sceneCount) {
    throw new Error(`playlist handoff draft item count mismatch: ${JSON.stringify(draft)}`);
  }
  const orders = items.map((item) => item.scene_order);
  if (JSON.stringify(orders) !== JSON.stringify([...orders].sort((a, b) => a - b))) {
    throw new Error(`playlist handoff draft items are not ordered: ${JSON.stringify(items)}`);
  }
  if (items[0]?.center?.headline !== options.expectedFirstHeadline) {
    throw new Error(`playlist handoff draft first scene mismatch: ${JSON.stringify(items[0])}`);
  }
}

function assertScheduleHandoffDraft(draft, options) {
  if (!draft || draft.schema_version !== "campaign-project-schedule-handoff-draft/v1") {
    throw new Error(`schedule handoff draft schema mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.campaign_project_id !== options.projectId) {
    throw new Error(`schedule handoff draft project mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.tenant_id !== options.records.tenantId || draft.store_id !== options.records.storeId || draft.screen_group_id !== options.records.screenGroupId) {
    throw new Error(`schedule handoff draft scope mismatch: ${JSON.stringify(draft)}`);
  }
  for (const field of ["no_external_ai", "no_media_generation", "no_content_manifest_creation", "no_publish", "no_credit_consumption", "no_schedule_activation"]) {
    if (draft[field] !== true) throw new Error(`schedule handoff draft missing guard ${field}: ${JSON.stringify(draft)}`);
  }
  if (draft.schedule_activation_ready !== false || draft.schedule_created !== false || draft.device_policy_updated !== false || draft.content_manifest_created !== false) {
    throw new Error(`schedule handoff draft must remain non-mutating: ${JSON.stringify(draft)}`);
  }
  if (!/^[a-f0-9]{64}$/.test(draft.draft_sha256 || "")) {
    throw new Error(`schedule handoff draft sha256 missing: ${JSON.stringify(draft)}`);
  }
  if (draft.validation?.valid !== options.expectValid) {
    throw new Error(`schedule handoff draft validation mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.playlist_reference?.draft_sha256 !== options.playlistDraft?.draft_sha256) {
    throw new Error(`schedule handoff draft playlist reference mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.playlist_reference?.item_count !== options.sceneCount) {
    throw new Error(`schedule handoff draft playlist item count mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.schedule?.timezone !== "Asia/Tokyo" || draft.schedule?.business_day_start_time !== "00:00") {
    throw new Error(`schedule handoff draft store schedule defaults mismatch: ${JSON.stringify(draft)}`);
  }
  if (draft.schedule?.requires_operator_schedule_input !== true || !Array.isArray(draft.schedule?.time_windows) || draft.schedule.time_windows.length !== 0) {
    throw new Error(`schedule handoff draft should require operator schedule input: ${JSON.stringify(draft)}`);
  }
}

function sceneMutationSnapshot(scene) {
  return {
    scene_order: scene?.scene_order,
    scene_type: scene?.scene_type,
    headline: scene?.headline,
    body_text: scene?.body_text,
    visual_direction: scene?.visual_direction,
    cta_text: scene?.cta_text,
    duration_seconds: scene?.duration_seconds,
    asset_requirements: scene?.asset_requirements,
    status: scene?.status,
    validation_status: scene?.validation_status,
    validation_errors: scene?.validation_errors
  };
}

function regenerationAction(requestType) {
  return {
    scene_regeneration: "scene.regeneration_requested",
    copy_regeneration: "scene.copy_regeneration_requested",
    qr_cta_regeneration: "scene.qr_cta_regeneration_requested"
  }[requestType];
}

function insertBadProjectFixture(records, sourceProposalId) {
  const now = new Date().toISOString();
  const projectId = `cgp-${runId}-bad-source`;
  db().prepare(`
    INSERT INTO campaign_projects (
      campaign_project_id, tenant_id, store_id, screen_group_id,
      campaign_brief_id, source_type, source_proposal_id, source_context_snapshot_id,
      title, objective, target_audience, store_context, offer_or_message, cta,
      success_metrics_json, constraints_json, campaign_brief_json,
      status, validation_status, validation_errors_json,
      created_by_user_id, deleted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, '', 'campaign_proposal', ?, '', ?, ?, ?, ?, ?, ?, '[]', '[]', '{}', 'draft', 'draft', '[]', 'smoke', NULL, ?, ?)
  `).run(
    projectId,
    records.tenantId,
    records.storeId,
    records.screenGroupId,
    sourceProposalId,
    "bad source project",
    "bad source validation",
    "test audience",
    "test context",
    "test message",
    "QRを見る",
    now,
    now
  );
  return projectId;
}

async function startServer() {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "misell-campaign-generator-foundation-"));
  dbPath = path.join(tmpDir, "cloud.sqlite");
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  serverProcess = spawn(process.execPath, ["server.js"], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: String(port),
      HOST: "127.0.0.1",
      DB_PATH: dbPath,
      MISELL_CLOUD_DATA_DIR: tmpDir,
      ADMIN_USER: adminUser,
      ADMIN_PASSWORD: adminPassword,
      REQUIRE_ADMIN_AUTH: "1",
      DEVICE_TOKEN_PEPPER: "smoke-device-pepper",
      MISELL_CUSTOMER_ACCESS_TOKEN_PEPPER: "smoke-customer-pepper"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  serverProcess.stdout.on("data", (chunk) => process.stdout.write(chunk));
  serverProcess.stderr.on("data", (chunk) => process.stderr.write(chunk));
  await waitForServer(port);
}

async function stopServer() {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
    await new Promise((resolve) => serverProcess.once("exit", resolve));
    serverProcess = null;
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
}

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("cloud server did not start");
}

async function admin(method, url, body = null) {
  return request(method, url, body, { authorization: adminAuth });
}

async function expectAdminError(method, url, body, status, messagePart) {
  return expectError(method, url, body, { authorization: adminAuth }, status, messagePart);
}

async function request(method, url, body = null, headers = {}) {
  const result = await rawRequest(method, url, body, headers);
  if (!result.response.ok) {
    throw new Error(`${method} ${url} returned ${result.response.status}: ${result.text}`);
  }
  return result;
}

async function rawRequest(method, url, body = null, headers = {}) {
  const response = await fetch(`${baseUrl}${url}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await response.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  return { response, headers: response.headers, text, data };
}

async function expectError(method, url, body, headers, status, messagePart) {
  const result = await rawRequest(method, url, body, headers);
  if (result.response.status !== status) {
    throw new Error(`expected ${status} from ${method} ${url}, got ${result.response.status}: ${result.text}`);
  }
  if (messagePart && !result.text.includes(messagePart)) {
    throw new Error(`expected error containing ${messagePart}, got: ${result.text}`);
  }
  return result;
}

function tableCount(tableName, where = "1 = 1") {
  return db().prepare(`SELECT COUNT(*) AS count FROM ${tableName} WHERE ${where}`).get().count;
}

function optionalTableCount(tableName) {
  if (!tableExists(tableName)) return 0;
  return tableCount(tableName);
}

function tableExists(tableName) {
  const row = db().prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName);
  return Boolean(row);
}

function db() {
  if (!db.instance) db.instance = new Database(dbPath);
  return db.instance;
}
