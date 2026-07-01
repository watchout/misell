(function () {
  if (new URLSearchParams(window.location.search).get("editor") !== "1") return;

  const root = document.getElementById("campaign-editor-root") || document.getElementById("campaign-preview-root");
  const title = document.getElementById("campaign-editor-title") || document.getElementById("campaign-preview-title");
  const previewLink = document.getElementById("campaign-editor-preview-link");
  const state = {
    project: null,
    handoffDraft: null,
    scheduleHandoffDraft: null,
    publishPreflights: [],
    publishPreflightDetail: null,
    providers: [],
    generationJobs: [],
    assetProvenance: [],
    proofOfPlayBindings: [],
    proofOfPlayError: "",
    advertiserReport: null,
    advertiserReportError: "",
    cutPlans: [],
    renderManifestsByCutPlanId: {},
    selectedSceneId: "",
    message: ""
  };

  loadEditor().catch((error) => {
    root.innerHTML = `<section class="section"><p class="empty">${escapeHtml(error.message || "読み込みに失敗しました")}</p></section>`;
  });

  async function loadEditor(options = {}) {
    const projectId = projectIdFromPath();
    if (!projectId) throw new Error("project id is required");
    const [response, handoffResponse, scheduleHandoffResponse, publishPreflightResponse, providerResponse, cutPlanResponse] = await Promise.all([
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}`),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/playlist-handoff-draft`),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/schedule-handoff-draft`),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/publish-preflights?limit=8`),
      fetchJson("/api/admin/studio-generation-providers"),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/cut-plans`)
    ]);
    state.project = response.campaign_project;
    state.handoffDraft = handoffResponse.playlist_handoff_draft;
    state.scheduleHandoffDraft = scheduleHandoffResponse.schedule_handoff_draft;
    state.publishPreflights = publishPreflightResponse.studio_publish_preflights || [];
    state.providers = providerResponse.studio_generation_providers || [];
    state.cutPlans = cutPlanResponse.studio_cut_plans || [];
    const statusQuery = projectStatusQuery(state.project);
    const [jobsResponse, provenanceResponse] = await Promise.all([
      fetchJson(`/api/admin/ai-generation-jobs?${statusQuery}`),
      fetchJson(`/api/admin/asset-provenance?${statusQuery}`)
    ]);
    state.generationJobs = jobsResponse.ai_generation_jobs || [];
    state.assetProvenance = provenanceResponse.asset_provenance || [];
    const [measurementEvidence, publishPreflightDetail, renderManifestsByCutPlanId] = await Promise.all([
      loadMeasurementEvidence(state.project),
      loadLatestPublishPreflightDetail(state.publishPreflights),
      loadRenderManifests(state.cutPlans)
    ]);
    state.proofOfPlayBindings = measurementEvidence.proofOfPlayBindings;
    state.proofOfPlayError = measurementEvidence.proofOfPlayError;
    state.advertiserReport = measurementEvidence.advertiserReport;
    state.advertiserReportError = measurementEvidence.advertiserReportError;
    state.publishPreflightDetail = publishPreflightDetail;
    state.renderManifestsByCutPlanId = renderManifestsByCutPlanId;
    const scenes = activeScenes(state.project);
    const previous = options.selectedSceneId || state.selectedSceneId;
    state.selectedSceneId = scenes.some((scene) => scene.campaign_project_scene_id === previous)
      ? previous
      : scenes[0]?.campaign_project_scene_id || "";
    render();
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `${url} returned ${res.status}`);
    }
    return res.json();
  }

  function render() {
    const project = state.project || {};
    const scenes = activeScenes(project);
    const selected = selectedScene(scenes);
    title.textContent = project.title || project.campaign_project_id || "Scene Editor";
    document.body.classList.add("campaign-editor-page");
    if (previewLink) {
      previewLink.href = `/admin/campaign-projects/${encodeURIComponent(project.campaign_project_id || "")}/preview`;
    }
    root.innerHTML = `
      <section class="campaign-editor-summary">
        <div>
          <strong>${escapeHtml(project.title || "")}</strong>
          <small>${escapeHtml(project.campaign_project_id || "")}</small>
          <small>${escapeHtml(project.tenant_id || "")} / ${escapeHtml(project.store_id || "")} / ${escapeHtml(project.screen_group_id || "")}</small>
        </div>
        <div>
          <span class="update-status update-status-${escapeAttr(statusClass(project.validation_status || project.status))}">${escapeHtml(project.status || "")}</span>
          <small>${escapeHtml(project.source_type || "")}</small>
          <small>${escapeHtml(project.updated_at || "")}</small>
        </div>
      </section>
      ${state.message ? `<p class="campaign-editor-status">${escapeHtml(state.message)}</p>` : ""}
      <section class="campaign-editor-workspace">
        <aside class="campaign-editor-scenes" aria-label="Scenes">
          ${scenes.length ? scenes.map((scene) => renderSceneButton(scene, selected)).join("") : `<p class="empty">シーンはまだありません。</p>`}
        </aside>
        <section class="campaign-editor-preview" aria-label="Scene preview">
          ${selected ? renderPreview(project, selected) : `<div class="campaign-editor-stage"><p class="empty">プレビューできるシーンがありません。</p></div>`}
        </section>
        <section class="campaign-editor-panel" aria-label="Scene editor">
          ${selected ? renderEditorForm(project, selected, scenes) : `<p class="empty">編集できるシーンがありません。</p>`}
        </section>
      </section>
      <section class="campaign-editor-events" aria-label="Project events">
        <h2>履歴</h2>
        ${(project.events || []).slice(0, 8).map(renderEvent).join("") || `<p class="empty">履歴なし</p>`}
      </section>
      ${renderProviderStatusPanel(project, state.providers, state.generationJobs, state.assetProvenance)}
      ${renderAdvertiserReportSurface(project, state.proofOfPlayBindings, state.advertiserReport, {
        proofOfPlayError: state.proofOfPlayError,
        advertiserReportError: state.advertiserReportError
      })}
      ${renderHandoffDraft(state.handoffDraft)}
      ${renderScheduleHandoffDraft(state.scheduleHandoffDraft)}
      ${renderCutPlanPanel(project, state.cutPlans, state.renderManifestsByCutPlanId)}
      ${renderPublishPreflightPanel(project, state.publishPreflights, state.publishPreflightDetail)}
    `;
    root.querySelectorAll("[data-editor-scene-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSceneId = button.dataset.editorSceneId || "";
        state.message = "";
        render();
      });
    });
    root.querySelector("[data-editor-validate]")?.addEventListener("click", handleValidateProject);
    root.querySelectorAll("[data-editor-reorder-scene]").forEach((button) => {
      button.addEventListener("click", handleReorderScene);
    });
    root.querySelector("[data-editor-duplicate-scene]")?.addEventListener("click", handleDuplicateScene);
    root.querySelectorAll("[data-editor-regeneration-request]").forEach((button) => {
      button.addEventListener("click", handleRegenerationRequest);
    });
    root.querySelector("[data-editor-copy-handoff]")?.addEventListener("click", handleCopyHandoff);
    root.querySelector("[data-editor-copy-schedule-handoff]")?.addEventListener("click", handleCopyScheduleHandoff);
    root.querySelector("form.campaign-editor-publish-preflight-form")?.addEventListener("submit", handleCreatePublishPreflight);
    root.querySelector("[data-editor-create-cut-plan]")?.addEventListener("click", handleCreateCutPlan);
    root.querySelectorAll("[data-editor-validate-cut-plan]").forEach((button) => {
      button.addEventListener("click", handleValidateCutPlan);
    });
    root.querySelectorAll("[data-editor-create-render-manifest]").forEach((button) => {
      button.addEventListener("click", handleCreateRenderManifest);
    });
    root.querySelectorAll("[data-editor-rerun-render-qa]").forEach((button) => {
      button.addEventListener("click", handleRerunRenderQa);
    });
    root.querySelectorAll("[data-editor-delete-render-manifest]").forEach((button) => {
      button.addEventListener("click", handleDeleteRenderManifest);
    });
    root.querySelectorAll("[data-editor-delete-cut-plan]").forEach((button) => {
      button.addEventListener("click", handleDeleteCutPlan);
    });
    root.querySelector("form.campaign-editor-form")?.addEventListener("submit", handleSaveScene);
  }

  async function loadLatestPublishPreflightDetail(preflights) {
    const latest = Array.isArray(preflights) ? preflights[0] : null;
    const preflightId = latest?.publish_preflight_id || "";
    if (!preflightId) return null;
    const detail = await fetchJson(`/api/admin/studio-publish-preflights/${encodeURIComponent(preflightId)}`);
    return detail.studio_publish_preflight || null;
  }

  async function loadRenderManifests(cutPlans) {
    const entries = await Promise.all((cutPlans || []).map(async (cutPlan) => {
      const cutPlanId = cutPlan.cut_plan_id || "";
      if (!cutPlanId) return ["", []];
      const response = await fetchJson(`/api/admin/studio-cut-plans/${encodeURIComponent(cutPlanId)}/render-manifests`);
      return [cutPlanId, response.studio_render_manifests || []];
    }));
    return Object.fromEntries(entries.filter(([cutPlanId]) => cutPlanId));
  }

  async function loadMeasurementEvidence(project) {
    const projectId = project?.campaign_project_id || "";
    if (!projectId) {
      return { proofOfPlayBindings: [], proofOfPlayError: "", advertiserReport: null, advertiserReportError: "" };
    }
    const proofUrl = `/api/admin/campaign-projects/${encodeURIComponent(projectId)}/proof-of-play-bindings?${projectScopeQuery(project)}`;
    const proofResponse = await fetchJson(proofUrl).then((response) => ({ response })).catch((error) => ({ error }));
    const proofRows = proofResponse.response?.studio_proof_of_play_bindings || [];
    const evidenceForReport = proofRows.find((row) => row.campaign_id) || {};
    const campaignId = project?.measurement?.campaign_id || evidenceForReport.campaign_id || "";
    const advertiserResponse = campaignId
      ? await fetchJson(`/api/admin/reports/advertiser-preview?${advertiserReportQuery(project, campaignId, evidenceForReport)}`).then((response) => ({ response })).catch((error) => ({ error }))
      : { response: null };
    return {
      proofOfPlayBindings: proofRows,
      proofOfPlayError: proofResponse.error?.message || "",
      advertiserReport: advertiserResponse.response?.report || null,
      advertiserReportError: advertiserResponse.error?.message || ""
    };
  }

  function renderSceneButton(scene, selected) {
    const active = selected?.campaign_project_scene_id === scene.campaign_project_scene_id;
    return `
      <button class="${active ? "" : "secondary"}" type="button" data-editor-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        <span>#${escapeHtml(scene.scene_order || "")}</span>
        <strong>${escapeHtml(scene.headline || "")}</strong>
        <small>${escapeHtml(scene.scene_type || "")} / ${escapeHtml(scene.status || "")}</small>
      </button>
    `;
  }

  function renderPreview(project, scene) {
    const wide = scene.scene_type === "wide";
    return `
      <div class="campaign-editor-stage${wide ? " campaign-editor-stage-wide" : ""}" data-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        ${wide ? `
          <section class="campaign-preview-panel campaign-preview-panel-center">
            <span>WIDE</span>
            <h2>${escapeHtml(scene.headline || "")}</h2>
            <p>${escapeHtml(scene.body_text || "")}</p>
            <strong>${escapeHtml(scene.cta_text || project.cta || "")}</strong>
          </section>
        ` : `
          <section class="campaign-preview-panel campaign-preview-panel-left">
            <span>LEFT</span>
            <strong>${escapeHtml(scene.visual_direction || project.store_context || "")}</strong>
            ${assetRequirements(scene).map((item) => `<small>${escapeHtml(item)}</small>`).join("")}
          </section>
          <section class="campaign-preview-panel campaign-preview-panel-center">
            <span>CENTER</span>
            <h2>${escapeHtml(scene.headline || "")}</h2>
            <p>${escapeHtml(scene.body_text || "")}</p>
          </section>
          <section class="campaign-preview-panel campaign-preview-panel-right">
            <span>RIGHT</span>
            <strong>${escapeHtml(scene.cta_text || project.cta || "")}</strong>
            <small>${escapeHtml(String(scene.duration_seconds || 0))}秒</small>
          </section>
        `}
      </div>
    `;
  }

  function renderEditorForm(project, scene, scenes) {
    const errors = scene.validation_errors || [];
    const sceneIndex = scenes.findIndex((entry) => entry.campaign_project_scene_id === scene.campaign_project_scene_id);
    const canMoveUp = sceneIndex > 0;
    const canMoveDown = sceneIndex >= 0 && sceneIndex < scenes.length - 1;
    return `
      <form class="campaign-editor-form" data-project-id="${escapeAttr(project.campaign_project_id)}" data-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        <div class="campaign-editor-form-head">
          <div>
            <strong>Scene #${escapeHtml(scene.scene_order || "")}</strong>
            <small>${escapeHtml(scene.campaign_project_scene_id || "")}</small>
          </div>
          <span class="update-status update-status-${escapeAttr(statusClass(scene.status))}">${escapeHtml(scene.status || "")}</span>
        </div>
        <label>
          順番
          <input name="scene_order" type="number" min="1" step="1" value="${escapeHtml(scene.scene_order || 1)}" required>
        </label>
        <label>
          シーン種別
          <select name="scene_type" required>
            ${sceneTypeOptions(scene.scene_type)}
          </select>
        </label>
        <label>
          見出し
          <input name="headline" type="text" value="${escapeHtml(scene.headline || "")}" required>
        </label>
        <label>
          本文
          <textarea name="body_text" rows="4" required>${escapeHtml(scene.body_text || "")}</textarea>
        </label>
        <label>
          ビジュアル指示
          <textarea name="visual_direction" rows="4" required>${escapeHtml(scene.visual_direction || "")}</textarea>
        </label>
        <label>
          CTA
          <input name="cta_text" type="text" value="${escapeHtml(scene.cta_text || "")}" required>
        </label>
        <label>
          秒数
          <input name="duration_seconds" type="number" min="1" step="1" value="${escapeHtml(scene.duration_seconds || 5)}" required>
        </label>
        <label>
          必要素材
          <textarea name="asset_requirements" rows="3">${escapeHtml(listToText(scene.asset_requirements))}</textarea>
        </label>
        ${errors.length ? `<div class="campaign-project-validation">${errors.map(renderValidationError).join("")}</div>` : ""}
        <section class="campaign-editor-regeneration" aria-label="Regeneration request">
          <strong>再生成リクエスト</strong>
          <label>
            理由
            <textarea name="request_reason" rows="2" placeholder="修正したい観点を記録">${escapeHtml(defaultRegenerationReason(scene))}</textarea>
          </label>
          <div class="campaign-editor-regeneration-actions">
            ${regenerationRequestTypes().map(([requestType, label]) => (
              `<button class="secondary" type="button" data-editor-regeneration-request="${escapeAttr(requestType)}">${escapeHtml(label)}</button>`
            )).join("")}
          </div>
          <small>この操作は依頼履歴だけを記録し、AI生成・scene更新・公開・課金は行いません。</small>
        </section>
        <div class="campaign-editor-actions">
          <button type="submit">保存</button>
          <button class="secondary" type="button" data-editor-reorder-scene="up"${canMoveUp ? "" : " disabled"}>上へ</button>
          <button class="secondary" type="button" data-editor-reorder-scene="down"${canMoveDown ? "" : " disabled"}>下へ</button>
          <button class="secondary" type="button" data-editor-duplicate-scene>複製</button>
          <button class="secondary" type="button" data-editor-validate="${escapeAttr(project.campaign_project_id)}">プロジェクト検証</button>
          <a class="campaign-project-preview-link" href="/admin/campaign-projects/${encodeURIComponent(project.campaign_project_id || "")}/preview" target="_blank" rel="noreferrer">プレビューを開く</a>
        </div>
      </form>
    `;
  }

  async function handleSaveScene(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes/${encodeURIComponent(form.dataset.sceneId || "")}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenePayloadFromForm(form))
      });
      state.message = "シーンを保存しました。";
      await loadEditor({ selectedSceneId: form.dataset.sceneId || "" });
    } catch (error) {
      state.message = error.message || "シーン保存に失敗しました。";
      render();
    }
  }

  async function handleReorderScene(event) {
    const button = event.currentTarget;
    const form = button.closest("form.campaign-editor-form");
    if (!form) return;
    const direction = button.dataset.editorReorderScene || "";
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "移動中";
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes/${encodeURIComponent(form.dataset.sceneId || "")}/reorder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ direction })
      });
      state.message = direction === "up" ? "シーンを上へ移動しました。" : "シーンを下へ移動しました。";
      await loadEditor({ selectedSceneId: form.dataset.sceneId || "" });
    } catch (error) {
      state.message = error.message || "シーンの並び替えに失敗しました。";
      render();
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  async function handleDuplicateScene(event) {
    const button = event.currentTarget;
    const form = button.closest("form.campaign-editor-form");
    if (!form) return;
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "複製中";
    try {
      const result = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes/${encodeURIComponent(form.dataset.sceneId || "")}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      const duplicateId = result.campaign_project_scene?.campaign_project_scene_id || form.dataset.sceneId || "";
      state.message = "シーンを複製しました。";
      await loadEditor({ selectedSceneId: duplicateId });
    } catch (error) {
      state.message = error.message || "シーンの複製に失敗しました。";
      render();
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  async function handleRegenerationRequest(event) {
    const button = event.currentTarget;
    const form = button.closest("form.campaign-editor-form");
    if (!form) return;
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = "記録中";
    try {
      const result = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes/${encodeURIComponent(form.dataset.sceneId || "")}/regeneration-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          request_type: button.dataset.editorRegenerationRequest || "",
          reason: form.elements.request_reason?.value || ""
        })
      });
      state.message = `${regenerationRequestLabel(result.regeneration_request?.request_type)}を記録しました。`;
      await loadEditor({ selectedSceneId: form.dataset.sceneId || "" });
    } catch (error) {
      state.message = error.message || "再生成リクエストの記録に失敗しました。";
      render();
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  async function handleValidateProject(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "検証中";
    try {
      const result = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(button.dataset.editorValidate || "")}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.message = result.valid ? "プロジェクト検証に通りました。" : `検証エラー: ${result.validation_errors?.length || 0}件`;
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    } catch (error) {
      state.message = error.message || "プロジェクト検証に失敗しました。";
      render();
    }
  }

  async function handleCreatePublishPreflight(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    button.disabled = true;
    button.textContent = "dry-run中";
    try {
      const result = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/publish-preflights`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(publishPreflightPayloadFromForm(form))
      });
      const preflight = result.studio_publish_preflight || {};
      const statusText = preflight.status || "created";
      state.message = `publish preflightを記録しました (${statusText})。`;
      state.publishPreflightDetail = preflight;
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    } catch (error) {
      state.message = error.message || "publish preflightに失敗しました。";
      render();
    } finally {
      button.disabled = false;
      button.textContent = "dry-runを実行";
    }
  }

  async function handleCopyHandoff() {
    const textarea = root.querySelector("[data-editor-handoff-json]");
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(textarea.value);
      state.message = "配信下書きをコピーしました。";
    } catch {
      state.message = "配信下書きを選択しました。";
    }
    render();
  }

  async function handleCopyScheduleHandoff() {
    const textarea = root.querySelector("[data-editor-schedule-handoff-json]");
    if (!textarea) return;
    textarea.focus();
    textarea.select();
    try {
      if (!navigator.clipboard) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(textarea.value);
      state.message = "配信スケジュール下書きをコピーしました。";
    } catch {
      state.message = "配信スケジュール下書きを選択しました。";
    }
    render();
  }

  async function handleCreateCutPlan(event) {
    const button = event.currentTarget;
    const projectId = button.dataset.editorCreateCutPlan || "";
    await withButtonState(button, "作成中", async () => {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/cut-plans`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.message = "cut-planを作成しました。";
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "cut-plan作成に失敗しました。");
  }

  async function handleValidateCutPlan(event) {
    const button = event.currentTarget;
    const cutPlanId = button.dataset.editorValidateCutPlan || "";
    await withButtonState(button, "検証中", async () => {
      const result = await fetchJson(`/api/admin/studio-cut-plans/${encodeURIComponent(cutPlanId)}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.message = result.valid ? "cut-plan検証に通りました。" : `cut-plan検証エラー: ${result.validation_errors?.length || 0}件`;
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "cut-plan検証に失敗しました。");
  }

  async function handleCreateRenderManifest(event) {
    const button = event.currentTarget;
    const cutPlanId = button.dataset.editorCreateRenderManifest || "";
    await withButtonState(button, "作成中", async () => {
      await fetchJson(`/api/admin/studio-cut-plans/${encodeURIComponent(cutPlanId)}/render-manifests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_type: "html_preview" })
      });
      state.message = "html_preview render manifestを作成しました。";
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "render manifest作成に失敗しました。");
  }

  async function handleRerunRenderQa(event) {
    const button = event.currentTarget;
    const renderManifestId = button.dataset.editorRerunRenderQa || "";
    await withButtonState(button, "QA中", async () => {
      await fetchJson(`/api/admin/studio-render-manifests/${encodeURIComponent(renderManifestId)}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.message = "render QAを再実行しました。";
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "render QA再実行に失敗しました。");
  }

  async function handleDeleteRenderManifest(event) {
    const button = event.currentTarget;
    const renderManifestId = button.dataset.editorDeleteRenderManifest || "";
    if (!window.confirm("render manifestを削除しますか？")) return;
    await withButtonState(button, "削除中", async () => {
      await fetchJson(`/api/admin/studio-render-manifests/${encodeURIComponent(renderManifestId)}`, {
        method: "DELETE"
      });
      state.message = "render manifestを削除しました。";
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "render manifest削除に失敗しました。");
  }

  async function handleDeleteCutPlan(event) {
    const button = event.currentTarget;
    const cutPlanId = button.dataset.editorDeleteCutPlan || "";
    if (!window.confirm("cut-planを削除しますか？")) return;
    await withButtonState(button, "削除中", async () => {
      await fetchJson(`/api/admin/studio-cut-plans/${encodeURIComponent(cutPlanId)}`, {
        method: "DELETE"
      });
      state.message = "cut-planを削除しました。";
      await loadEditor({ selectedSceneId: state.selectedSceneId });
    }, "cut-plan削除に失敗しました。");
  }

  async function withButtonState(button, pendingText, callback, fallbackMessage) {
    const previousText = button.textContent;
    button.disabled = true;
    button.textContent = pendingText;
    try {
      await callback();
    } catch (error) {
      state.message = error.message || fallbackMessage;
      render();
    } finally {
      button.disabled = false;
      button.textContent = previousText;
    }
  }

  function renderHandoffDraft(draft) {
    if (!draft) return "";
    const draftJson = JSON.stringify(draft, null, 2);
    const statusText = draft.validation?.valid ? "検証済み" : "確認が必要";
    const itemCount = draft.playlist?.item_count || 0;
    return `
      <section class="campaign-editor-handoff" aria-label="Playlist handoff draft">
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>配信下書き</h2>
            <small>operator handoff 用の読み取り専用 JSON です。content_manifestを作成しません。</small>
          </div>
          <span class="update-status update-status-${escapeAttr(draft.validation?.valid ? "success" : "failed")}">${escapeHtml(statusText)}</span>
        </div>
        <div class="campaign-editor-handoff-meta">
          <small>${escapeHtml(draft.schema_version || "")}</small>
          <small>${escapeHtml(String(itemCount))} items</small>
          <small>${escapeHtml(String(draft.draft_sha256 || "").slice(0, 16))}</small>
        </div>
        <textarea data-editor-handoff-json readonly rows="12">${escapeHtml(draftJson)}</textarea>
        <button class="secondary" type="button" data-editor-copy-handoff>JSONをコピー</button>
      </section>
    `;
  }

  function renderScheduleHandoffDraft(draft) {
    if (!draft) return "";
    const draftJson = JSON.stringify(draft, null, 2);
    const statusText = draft.validation?.valid ? "次工程入力待ち" : "確認が必要";
    const timezone = draft.schedule?.timezone || "";
    return `
      <section class="campaign-editor-handoff campaign-editor-schedule-handoff" aria-label="Schedule handoff draft">
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>配信スケジュール下書き</h2>
            <small>operator handoff 用の読み取り専用 JSON です。scheduleを作成せず、device policyも更新しません。</small>
          </div>
          <span class="update-status update-status-${escapeAttr(draft.validation?.valid ? "success" : "failed")}">${escapeHtml(statusText)}</span>
        </div>
        <div class="campaign-editor-handoff-meta">
          <small>${escapeHtml(draft.schema_version || "")}</small>
          <small>${escapeHtml(timezone)} / ${escapeHtml(draft.schedule?.business_day_start_time || "")}</small>
          <small>${escapeHtml(String(draft.draft_sha256 || "").slice(0, 16))}</small>
        </div>
        <textarea data-editor-schedule-handoff-json readonly rows="12">${escapeHtml(draftJson)}</textarea>
        <button class="secondary" type="button" data-editor-copy-schedule-handoff>JSONをコピー</button>
      </section>
    `;
  }

  function renderProviderStatusPanel(project, providers, jobs, provenance) {
    const providerRows = Array.isArray(providers) ? providers : [];
    const jobRows = Array.isArray(jobs) ? jobs : [];
    const provenanceRows = Array.isArray(provenance) ? provenance : [];
    return `
      <section class="campaign-editor-provider-status" aria-label="Provider, job, and provenance status" data-provider-status-panel>
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>Provider / Job / Provenance</h2>
            <small>既存のStudio B1 read APIだけを読む状態確認パネルです。job作成・権利承認・publishは行いません。</small>
          </div>
          <span class="update-status update-status-pending">読み取り専用</span>
        </div>
        <div class="campaign-editor-provider-guards" aria-label="Provider status guard flags">
          ${renderGuardFlag("外部provider呼び出しなし", true)}
          ${renderGuardFlag("secret表示なし", true)}
          ${renderGuardFlag("credit消費なし", true)}
          ${renderGuardFlag("content_manifest作成なし", true)}
          ${renderGuardFlag("publishなし", true)}
        </div>
        <div class="campaign-editor-provider-grid">
          <section class="campaign-editor-provider-card" data-provider-catalog>
            <h3>Provider Catalog</h3>
            ${providerRows.length ? providerRows.map(renderProvider).join("") : `<p class="empty">active providerはありません。</p>`}
          </section>
          <section class="campaign-editor-provider-card" data-generation-jobs>
            <h3>Generation Jobs</h3>
            <small>${escapeHtml(project.campaign_project_id || "")} / ${escapeHtml(String(jobRows.length))} jobs</small>
            ${jobRows.length ? jobRows.map(renderGenerationJob).join("") : `<p class="empty">generation jobはまだありません。</p>`}
          </section>
          <section class="campaign-editor-provider-card" data-asset-provenance>
            <h3>Asset Provenance</h3>
            <small>${escapeHtml(project.campaign_project_id || "")} / ${escapeHtml(String(provenanceRows.length))} assets</small>
            ${provenanceRows.length ? provenanceRows.map(renderAssetProvenance).join("") : `<p class="empty">asset provenanceはまだありません。</p>`}
          </section>
        </div>
        <p class="campaign-editor-provider-note">このパネルにはmutation controlを置きません。jobのcreate/start/complete/fail/delete、asset provenanceのcreate/update/delete、rights approvalは別工程です。</p>
      </section>
    `;
  }

  function renderAdvertiserReportSurface(project, proofRows = [], report = null, errors = {}) {
    const measurement = project?.measurement || {};
    const firstEvidence = proofRows.find((row) => row.campaign_id) || {};
    const campaignId = measurement.campaign_id || firstEvidence.campaign_id || "";
    const playEvidenceCount = proofRows.filter((row) => row.evidence_label === "measured_play_evidence").length;
    const responseEvidenceCount = proofRows.filter((row) => row.evidence_label === "measured_response_only").length;
    const proof = report?.proof_of_play || {};
    const response = report?.response || {};
    const conversion = report?.conversion || {};
    const unavailable = !campaignId;
    return `
      <section class="campaign-editor-handoff campaign-editor-ad-report-surface" aria-label="Internal advertiser report preview" data-advertiser-report-surface>
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>広告レポート内部プレビュー</h2>
            <small>D1/D3の測定証跡を読むだけのoperator向け確認です。外部広告主公開、請求、保証、publishは行いません。</small>
          </div>
          <span class="update-status update-status-${escapeAttr(report ? "success" : "pending")}">${report ? "計測表示" : "接続待ち"}</span>
        </div>
        <div class="campaign-editor-guard-flags" aria-label="Advertiser report surface guard flags">
          <small>read-only</small>
          <small>internal admin only</small>
          <small>no_external_advertiser_access</small>
          <small>no_roi_guarantee</small>
          <small>no_publish</small>
        </div>
        <div class="campaign-editor-ad-report-grid">
          <article>
            <strong>Scope</strong>
            <small>tenant: ${escapeHtml(project.tenant_id || "")}</small>
            <small>store: ${escapeHtml(project.store_id || "")}</small>
            <small>screen group: ${escapeHtml(project.screen_group_id || "")}</small>
            <small>campaign: ${escapeHtml(campaignId || "未接続")}</small>
          </article>
          <article>
            <strong>Proof of Play</strong>
            <b>${escapeHtml(String(proof.play_started_count || 0))}</b>
            <small>started / ${escapeHtml(proof.measurement_label || "measured")}</small>
            <small>D3 play rows: ${escapeHtml(String(playEvidenceCount))}</small>
          </article>
          <article>
            <strong>QR Response</strong>
            <b>${escapeHtml(String(response.qr_scan_count || 0))}</b>
            <small>scans / ${escapeHtml(response.measurement_label || "measured_response_only")}</small>
            <small>D3 response rows: ${escapeHtml(String(responseEvidenceCount))}</small>
          </article>
          <article>
            <strong>Order Evidence</strong>
            <b>${escapeHtml(String(conversion.counter_orders_issued_count || 0))}</b>
            <small>issued / ${escapeHtml(conversion.measurement_label || "measured")}</small>
            <small>ROAS・増分効果は未表示</small>
          </article>
        </div>
        ${unavailable ? `<p class="empty">D1 measurement の campaign_id が未設定です。測定接続後に内部レポートが表示されます。</p>` : ""}
        ${errors.proofOfPlayError ? `<p class="empty">proof-of-play 読み込み失敗: ${escapeHtml(errors.proofOfPlayError)}</p>` : ""}
        ${errors.advertiserReportError ? `<p class="empty">advertiser preview 読み込み失敗: ${escapeHtml(errors.advertiserReportError)}</p>` : ""}
        ${proofRows.length ? `
          <div class="campaign-editor-proof-list">
            ${proofRows.slice(0, 6).map(renderProofOfPlayRow).join("")}
          </div>
        ` : `<p class="empty">proof-of-play binding はまだありません。</p>`}
        <p class="campaign-editor-provider-note">QR反応は measured response evidence です。売上・来店・ROI・ROAS・lift・保証として扱いません。</p>
      </section>
    `;
  }

  function renderPublishPreflightPanel(project, preflights, detail) {
    const rows = Array.isArray(preflights) ? preflights : [];
    const latest = detail || rows[0] || null;
    const transform = latest?.content_manifest_draft_transform || null;
    return `
      <section class="campaign-editor-handoff campaign-editor-publish-preflight" aria-label="Studio publish preflight dry-run">
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>公開前 dry-run</h2>
            <small>既存 C1 API で publish readiness と content_manifest draft transform を記録します。公開・schedule有効化・Player/端末更新は行いません。</small>
          </div>
          <span class="update-status update-status-${escapeAttr(statusClass(latest?.status || "pending"))}">${escapeHtml(latest?.status || "未実行")}</span>
        </div>
        <form class="campaign-editor-publish-preflight-form" data-project-id="${escapeAttr(project.campaign_project_id || "")}">
          <label>
            Render manifest ID
            <input name="render_manifest_id" type="text" placeholder="srm-..." value="${escapeHtml(latest?.render_manifest_id || "")}" required>
          </label>
          <label>
            Content type
            <select name="content_type">
              ${publishPreflightContentTypeOptions(latest?.content_type || "normal")}
            </select>
          </label>
          <label>
            docs/99 verdict
            <select name="docs99_gate_verdict">
              ${docs99GateVerdictOptions(latest?.docs99_gate_verdict || "not_applicable")}
            </select>
          </label>
          <label>
            docs/99 ref
            <input name="docs99_gate_ref" type="text" placeholder="docs/99#..." value="${escapeHtml(latest?.docs99_gate_ref || "")}">
          </label>
          <label class="campaign-editor-preflight-reason">
            実行理由
            <textarea name="request_reason" rows="2" placeholder="operator dry-run note">${escapeHtml(latest?.request_reason || "Studio C1 publish preflight UI dry-run")}</textarea>
          </label>
          <button type="submit">dry-runを実行</button>
        </form>
        ${latest ? renderPublishPreflightResult(latest, transform) : `<p class="empty">まだ preflight はありません。validated project と QA-passed render manifest を指定して dry-run してください。</p>`}
        <div class="campaign-editor-preflight-history">
          <strong>最近の dry-run</strong>
          ${rows.length ? rows.map(renderPublishPreflightRow).join("") : `<small>履歴なし</small>`}
        </div>
      </section>
    `;
  }

  function renderCutPlanPanel(project, cutPlans = [], renderManifestsByCutPlanId = {}) {
    const scenes = activeScenes(project);
    return `
      <section class="campaign-editor-handoff campaign-editor-cut-plan-panel" aria-label="Studio cut plan and render QA">
        <div class="campaign-editor-handoff-head">
          <div>
            <h2>レンダー設計 / QA</h2>
            <small>#210の既存Admin APIを使う事前確認です。content_manifest作成、publish、外部AI、MP4生成は行いません。</small>
          </div>
          <button type="button" data-editor-create-cut-plan="${escapeAttr(project.campaign_project_id || "")}"${scenes.length ? "" : " disabled"}>cut-plan作成</button>
        </div>
        <div class="campaign-editor-guard-flags" aria-label="Cut plan guard flags">
          <small>no_external_ai</small>
          <small>no_media_generation</small>
          <small>no_mp4_export</small>
          <small>no_content_manifest_creation</small>
          <small>no_publish</small>
        </div>
        ${cutPlans.length ? `
          <div class="campaign-editor-cut-plan-list">
            ${cutPlans.map((cutPlan) => renderCutPlanCard(cutPlan, renderManifestsByCutPlanId[cutPlan.cut_plan_id] || [])).join("")}
          </div>
        ` : `<p class="empty">cut-planはまだありません。</p>`}
      </section>
    `;
  }

  function renderPublishPreflightResult(preflight, transform) {
    const checks = Array.isArray(preflight.checks) ? preflight.checks : [];
    const failed = checks.filter((check) => check.result !== "passed");
    return `
      <div class="campaign-editor-preflight-result">
        <div class="campaign-editor-handoff-meta">
          <small>${escapeHtml(preflight.publish_preflight_id || "")}</small>
          <small>${escapeHtml(preflight.content_type || "")} / ${escapeHtml(preflight.publish_mode || "")}</small>
          <small>docs/99: ${escapeHtml(preflight.docs99_gate_verdict || "")}</small>
          <small>draft: ${escapeHtml(transform?.status || "not_loaded")}</small>
          <small>${escapeHtml(String(preflight.render_manifest_output_sha256 || "").slice(0, 16))}</small>
        </div>
        <div class="campaign-editor-preflight-guards">
          ${guardFlags(preflight).map(([label, value]) => `<small>${escapeHtml(label)}: ${value ? "true" : "false"}</small>`).join("")}
        </div>
        ${failed.length ? `
          <div class="campaign-project-validation">
            ${failed.map((check) => `<small>${escapeHtml(check.check_id || "")}: ${escapeHtml(check.reason || "")}</small>`).join("")}
          </div>
        ` : `<small>すべての C1 checks が通過しました。これは dry-run evidence であり publish 承認ではありません。</small>`}
      </div>
    `;
  }

  function renderProvider(provider) {
    const capabilities = Array.isArray(provider.capabilities) ? provider.capabilities : [];
    return `
      <article class="campaign-editor-provider-item">
        <div>
          <strong>${escapeHtml(provider.provider_id || "")}</strong>
          <small>${escapeHtml(provider.display_name || "")}</small>
        </div>
        <span class="update-status update-status-${escapeAttr(statusClass(provider.status))}">${escapeHtml(provider.status || "")}</span>
        <small>${escapeHtml(provider.provider_type || "")}</small>
        <div class="campaign-editor-provider-tags">
          ${capabilities.map((capability) => `<span>${escapeHtml(capability)}</span>`).join("")}
        </div>
        <div class="campaign-editor-provider-guards">
          ${renderGuardFlag("no external", provider.no_external_provider_call)}
          ${renderGuardFlag("no secret", provider.no_secret_material)}
          ${renderGuardFlag("no credit", provider.no_credit_consumption)}
        </div>
      </article>
    `;
  }

  function renderCutPlanCard(cutPlan, renderManifests) {
    const isValidated = cutPlan.status === "validated" && cutPlan.validation_status === "passed";
    const sceneCount = Array.isArray(cutPlan.source_scene_ids) ? cutPlan.source_scene_ids.length : 0;
    return `
      <article class="campaign-editor-cut-plan" data-cut-plan-id="${escapeAttr(cutPlan.cut_plan_id)}">
        <div class="campaign-editor-cut-plan-head">
          <div>
            <strong>${escapeHtml(cutPlan.cut_plan_id || "")}</strong>
            <small>${escapeHtml(cutPlan.cut_plan_version || "")}</small>
          </div>
          <div>
            <span class="update-status update-status-${escapeAttr(statusClass(cutPlan.status))}">${escapeHtml(cutPlan.status || "")}</span>
            <span class="update-status update-status-${escapeAttr(statusClass(cutPlan.validation_status))}">${escapeHtml(cutPlan.validation_status || "")}</span>
          </div>
        </div>
        <div class="campaign-editor-handoff-meta">
          <small>${escapeHtml(cutPlan.layout_template_id || "")}</small>
          <small>${escapeHtml(String(sceneCount))} scenes</small>
          <small>${escapeHtml(cutPlan.measurement_goal || "")}</small>
          <small>${escapeHtml(cutPlan.expected_action || "")}</small>
        </div>
        ${renderGuardFlags(cutPlan)}
        ${cutPlan.validation_errors?.length ? `<div class="campaign-project-validation">${cutPlan.validation_errors.map(renderValidationError).join("")}</div>` : ""}
        <div class="campaign-editor-cut-plan-actions">
          <button class="secondary" type="button" data-editor-validate-cut-plan="${escapeAttr(cutPlan.cut_plan_id)}">cut-plan検証</button>
          <button class="secondary" type="button" data-editor-create-render-manifest="${escapeAttr(cutPlan.cut_plan_id)}"${isValidated ? "" : " disabled"}>render manifest作成</button>
          <button class="danger" type="button" data-editor-delete-cut-plan="${escapeAttr(cutPlan.cut_plan_id)}">cut-plan削除</button>
        </div>
        <div class="campaign-editor-render-manifest-list">
          ${renderManifests.length ? renderManifests.map(renderRenderManifestCard).join("") : `<p class="empty">render manifestはまだありません。</p>`}
        </div>
      </article>
    `;
  }

  function renderRenderManifestCard(manifest) {
    return `
      <article class="campaign-editor-render-manifest" data-render-manifest-id="${escapeAttr(manifest.render_manifest_id)}">
        <div class="campaign-editor-cut-plan-head">
          <div>
            <strong>${escapeHtml(manifest.render_manifest_id || "")}</strong>
            <small>${escapeHtml(manifest.output_type || "")} / ${escapeHtml(manifest.source_of_truth || "")}</small>
          </div>
          <div>
            <span class="update-status update-status-${escapeAttr(statusClass(manifest.status))}">${escapeHtml(manifest.status || "")}</span>
            <span class="update-status update-status-${escapeAttr(statusClass(manifest.qa_status))}">${escapeHtml(manifest.qa_status || "")}</span>
          </div>
        </div>
        <div class="campaign-editor-handoff-meta">
          <small>${escapeHtml(manifest.renderer || "")} ${escapeHtml(manifest.renderer_version || "")}</small>
          <small>${escapeHtml(String(manifest.duration_seconds || 0))}秒</small>
          <small>${escapeHtml(String(manifest.output_sha256 || "").slice(0, 16))}</small>
        </div>
        ${renderGuardFlags(manifest)}
        ${manifest.qa_errors?.length ? `<div class="campaign-project-validation">${manifest.qa_errors.map(renderValidationError).join("")}</div>` : ""}
        <div class="campaign-editor-cut-plan-actions">
          <button class="secondary" type="button" data-editor-rerun-render-qa="${escapeAttr(manifest.render_manifest_id)}">QA再実行</button>
          <button class="danger" type="button" data-editor-delete-render-manifest="${escapeAttr(manifest.render_manifest_id)}">manifest削除</button>
        </div>
      </article>
    `;
  }

  function renderGenerationJob(job) {
    return `
      <article class="campaign-editor-provider-item">
        <div>
          <strong>${escapeHtml(job.ai_generation_job_id || "")}</strong>
          <small>${escapeHtml(job.provider_id || "")} / ${escapeHtml(job.capability || "")}</small>
        </div>
        <span class="update-status update-status-${escapeAttr(statusClass(job.status))}">${escapeHtml(job.status || "")}</span>
        <small>${escapeHtml(job.requested_asset_role || "")} / ${escapeHtml(job.updated_at || "")}</small>
        <div class="campaign-editor-provider-guards">
          ${renderGuardFlag("no external", job.no_external_provider_call)}
          ${renderGuardFlag("no secret", job.no_secret_material)}
          ${renderGuardFlag("no credit", job.no_credit_consumption)}
          ${renderGuardFlag("no manifest", job.no_content_manifest_creation)}
          ${renderGuardFlag("no publish", job.no_publish)}
        </div>
      </article>
    `;
  }

  function renderAssetProvenance(asset) {
    return `
      <article class="campaign-editor-provider-item">
        <div>
          <strong>${escapeHtml(asset.asset_id || asset.asset_provenance_id || "")}</strong>
          <small>${escapeHtml(asset.source_type || "")} / ${escapeHtml(asset.generated_by_provider || "")}</small>
        </div>
        <span class="update-status update-status-${escapeAttr(statusClass(asset.rights_status))}">${escapeHtml(asset.rights_status || "")}</span>
        <small>${escapeHtml(asset.asset_role || "")} / ${escapeHtml(asset.updated_at || "")}</small>
        <div class="campaign-editor-provider-guards">
          ${renderGuardFlag("hash", Boolean(asset.content_sha256))}
          ${renderGuardFlag("no manifest", asset.no_content_manifest_creation)}
          ${renderGuardFlag("no publish", asset.no_publish)}
        </div>
      </article>
    `;
  }

  function renderProofOfPlayRow(row) {
    return `
      <article class="campaign-editor-proof-item">
        <div>
          <strong>${escapeHtml(row.evidence_label || "")}</strong>
          <small>${escapeHtml(row.source_system || "")} / ${escapeHtml(row.source_event_id || "")}</small>
        </div>
        <span class="update-status update-status-${escapeAttr(statusClass(row.validation_status))}">${escapeHtml(row.validation_status || "")}</span>
        <small>${escapeHtml(row.creative_id || "")} / ${escapeHtml(row.ad_slot_id || "")} / ${escapeHtml(row.qr_link_id || "")}</small>
        <small>${escapeHtml(row.source_event_at || "")}</small>
      </article>
    `;
  }

  function renderGuardFlags(entry) {
    const flags = [
      ["no_external_ai", "外部AIなし"],
      ["no_provider_job", "provider jobなし"],
      ["no_media_generation", "メディア生成なし"],
      ["no_mp4_export", "MP4出力なし"],
      ["no_content_manifest_creation", "content_manifestなし"],
      ["no_publish", "publishなし"]
    ];
    return `
      <div class="campaign-editor-guard-flags">
        ${flags.map(([field, label]) => `<small class="${entry[field] === true ? "" : "is-missing"}">${escapeHtml(label)}</small>`).join("")}
      </div>
    `;
  }

  function renderGuardFlag(label, value) {
    return `<small class="${value === true ? "" : "is-missing"}">${escapeHtml(label)}</small>`;
  }

  function renderPublishPreflightRow(preflight) {
    return `
      <small>
        <span>${escapeHtml(preflight.status || "")}</span>
        <span>${escapeHtml(preflight.render_manifest_id || "")}</span>
        <span>${escapeHtml(preflight.content_type || "")}</span>
        <span>${escapeHtml(preflight.created_at || "")}</span>
      </small>
    `;
  }

  function publishPreflightPayloadFromForm(form) {
    return {
      render_manifest_id: form.elements.render_manifest_id.value,
      content_type: form.elements.content_type.value,
      docs99_gate_verdict: form.elements.docs99_gate_verdict.value,
      docs99_gate_ref: form.elements.docs99_gate_ref.value,
      request_reason: form.elements.request_reason.value
    };
  }

  function scenePayloadFromForm(form) {
    return {
      scene_order: Number.parseInt(form.elements.scene_order.value, 10) || 0,
      scene_type: form.elements.scene_type.value,
      headline: form.elements.headline.value,
      body_text: form.elements.body_text.value,
      visual_direction: form.elements.visual_direction.value,
      cta_text: form.elements.cta_text.value,
      duration_seconds: Number.parseInt(form.elements.duration_seconds.value, 10) || 0,
      asset_requirements: listFromText(form.elements.asset_requirements.value)
    };
  }

  function sceneTypeOptions(selected) {
    const options = window.MisellCampaignProjectUi?.sceneTypeOptions || [];
    return options.map(([value, label]) => (
      `<option value="${escapeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )).join("");
  }

  function publishPreflightContentTypeOptions(selected) {
    return [
      ["normal", "通常"],
      ["ad", "広告"],
      ["sponsor", "協賛"],
      ["collaboration", "コラボ"]
    ].map(([value, label]) => (
      `<option value="${escapeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )).join("");
  }

  function docs99GateVerdictOptions(selected) {
    return [
      ["not_applicable", "対象外"],
      ["allow", "許可"],
      ["allow_with_conditions", "条件付き許可"],
      ["human_review_required", "人間レビュー必要"],
      ["block", "ブロック"]
    ].map(([value, label]) => (
      `<option value="${escapeAttr(value)}"${value === selected ? " selected" : ""}>${escapeHtml(label)}</option>`
    )).join("");
  }

  function guardFlags(preflight) {
    return [
      ["dry_run_only", preflight.dry_run_only === true],
      ["no_active_content_manifest_mutation", preflight.no_active_content_manifest_mutation === true],
      ["no_content_manifest_activation", preflight.no_content_manifest_activation === true],
      ["no_publish", preflight.no_publish === true],
      ["no_schedule_activation", preflight.no_schedule_activation === true],
      ["no_player_device_mutation", preflight.no_player_device_mutation === true]
    ];
  }

  function selectedScene(scenes) {
    return scenes.find((scene) => scene.campaign_project_scene_id === state.selectedSceneId) || scenes[0] || null;
  }

  function activeScenes(project) {
    return (project?.scenes || [])
      .filter((scene) => scene.status !== "deleted")
      .sort((a, b) => (Number(a.scene_order || 0) - Number(b.scene_order || 0)));
  }

  function renderEvent(event) {
    const metadata = event.metadata || {};
    const requestType = metadata.request_type ? regenerationRequestLabel(metadata.request_type) : "";
    const requestStatus = metadata.request_status || "";
    const reorder = event.action === "scene.reordered" ? `${metadata.from_order || ""}->${metadata.to_order || ""}` : "";
    const duplicate = event.action === "scene.duplicated" ? `from ${metadata.source_scene_order || ""}` : "";
    return `
      <small>
        ${escapeHtml(event.action || "")}
        ${event.campaign_project_scene_id ? `<span>${escapeHtml(event.campaign_project_scene_id)}</span>` : ""}
        ${requestType ? `<span>${escapeHtml(requestType)}</span>` : ""}
        ${requestStatus ? `<span>${escapeHtml(requestStatus)}</span>` : ""}
        ${reorder ? `<span>${escapeHtml(reorder)}</span>` : ""}
        ${duplicate ? `<span>${escapeHtml(duplicate)}</span>` : ""}
        ${event.actor_id ? `<span>${escapeHtml(event.actor_id)}</span>` : ""}
        <span>${escapeHtml(event.created_at || "")}</span>
      </small>
    `;
  }

  function renderValidationError(error) {
    if (!error || typeof error !== "object") {
      return `<small>${escapeHtml(error || "検証エラーがあります。")}</small>`;
    }
    return `<small>${escapeHtml(error.field || "")} ${escapeHtml(error.code || "")}: ${escapeHtml(error.message || "")}</small>`;
  }

  function assetRequirements(scene) {
    const requirements = Array.isArray(scene.asset_requirements) ? scene.asset_requirements : [];
    return requirements.map((item) => {
      if (typeof item === "string") return item;
      return JSON.stringify(item);
    }).filter(Boolean);
  }

  function defaultRegenerationReason(scene) {
    return `Scene #${scene.scene_order || ""} の改善依頼`;
  }

  function regenerationRequestTypes() {
    return [
      ["scene_regeneration", "Scene再生成"],
      ["copy_regeneration", "コピー再生成"],
      ["qr_cta_regeneration", "QR/CTA再生成"]
    ];
  }

  function regenerationRequestLabel(requestType) {
    const entry = regenerationRequestTypes().find(([value]) => value === requestType);
    return entry ? entry[1] : "再生成リクエスト";
  }

  function listFromText(value) {
    return String(value || "")
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function listToText(value) {
    if (!Array.isArray(value)) return "";
    return value.map((item) => {
      if (typeof item === "string") return item;
      return JSON.stringify(item);
    }).join("\n");
  }

  function statusClass(status) {
    if (["active", "valid", "validated", "passed", "draft_created", "approved", "completed", "asset_review_required"].includes(status)) return "success";
    if (["invalid", "deleted", "failed", "failed_preflight", "failed_terminal", "rejected", "blocked"].includes(status)) return "failed";
    if (status === "human_review_required") return "pending";
    return "pending";
  }

  function projectStatusQuery(project) {
    const params = new URLSearchParams();
    for (const key of ["tenant_id", "store_id", "screen_group_id", "campaign_project_id"]) {
      const value = project?.[key];
      if (value) params.set(key, value);
    }
    params.set("limit", "50");
    return params.toString();
  }

  function projectScopeQuery(project) {
    const params = new URLSearchParams();
    for (const key of ["tenant_id", "store_id", "screen_group_id"]) {
      const value = project?.[key];
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  function advertiserReportQuery(project, campaignId = "", evidence = {}) {
    const params = new URLSearchParams();
    const measurement = project?.measurement || {};
    params.set("tenant_id", project?.tenant_id || "");
    params.set("campaign_id", campaignId || measurement.campaign_id || evidence.campaign_id || "");
    for (const key of ["store_id", "screen_group_id"]) {
      const value = project?.[key];
      if (value) params.set(key, value);
    }
    for (const key of ["ad_slot_id", "creative_id", "qr_link_id"]) {
      const value = measurement[key] || evidence[key];
      if (value) params.set(key, value);
    }
    return params.toString();
  }

  function projectIdFromPath() {
    const match = window.location.pathname.match(/\/admin\/campaign-projects\/([^/]+)\/preview\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    }[char]));
  }

  function escapeAttr(value) {
    return String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "-");
  }
})();
