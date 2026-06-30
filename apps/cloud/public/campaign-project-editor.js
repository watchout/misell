(function () {
  if (new URLSearchParams(window.location.search).get("editor") !== "1") return;

  const root = document.getElementById("campaign-editor-root") || document.getElementById("campaign-preview-root");
  const title = document.getElementById("campaign-editor-title") || document.getElementById("campaign-preview-title");
  const previewLink = document.getElementById("campaign-editor-preview-link");
  const state = {
    project: null,
    handoffDraft: null,
    scheduleHandoffDraft: null,
    providers: [],
    generationJobs: [],
    assetProvenance: [],
    selectedSceneId: "",
    message: ""
  };

  loadEditor().catch((error) => {
    root.innerHTML = `<section class="section"><p class="empty">${escapeHtml(error.message || "読み込みに失敗しました")}</p></section>`;
  });

  async function loadEditor(options = {}) {
    const projectId = projectIdFromPath();
    if (!projectId) throw new Error("project id is required");
    const [response, handoffResponse, scheduleHandoffResponse, providerResponse] = await Promise.all([
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}`),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/playlist-handoff-draft`),
      fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}/schedule-handoff-draft`),
      fetchJson("/api/admin/studio-generation-providers")
    ]);
    state.project = response.campaign_project;
    state.handoffDraft = handoffResponse.playlist_handoff_draft;
    state.scheduleHandoffDraft = scheduleHandoffResponse.schedule_handoff_draft;
    state.providers = providerResponse.studio_generation_providers || [];
    const statusQuery = projectStatusQuery(state.project);
    const [jobsResponse, provenanceResponse] = await Promise.all([
      fetchJson(`/api/admin/ai-generation-jobs?${statusQuery}`),
      fetchJson(`/api/admin/asset-provenance?${statusQuery}`)
    ]);
    state.generationJobs = jobsResponse.ai_generation_jobs || [];
    state.assetProvenance = provenanceResponse.asset_provenance || [];
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
      ${renderHandoffDraft(state.handoffDraft)}
      ${renderScheduleHandoffDraft(state.scheduleHandoffDraft)}
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
    root.querySelector("form.campaign-editor-form")?.addEventListener("submit", handleSaveScene);
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
    const jobCount = jobs.length;
    const provenanceCount = provenance.length;
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
            ${providers.length ? providers.map(renderProvider).join("") : `<p class="empty">active providerはありません。</p>`}
          </section>
          <section class="campaign-editor-provider-card" data-generation-jobs>
            <h3>Generation Jobs</h3>
            <small>${escapeHtml(project.campaign_project_id || "")} / ${escapeHtml(String(jobCount))} jobs</small>
            ${jobs.length ? jobs.map(renderGenerationJob).join("") : `<p class="empty">generation jobはまだありません。</p>`}
          </section>
          <section class="campaign-editor-provider-card" data-asset-provenance>
            <h3>Asset Provenance</h3>
            <small>${escapeHtml(project.campaign_project_id || "")} / ${escapeHtml(String(provenanceCount))} assets</small>
            ${provenance.length ? provenance.map(renderAssetProvenance).join("") : `<p class="empty">asset provenanceはまだありません。</p>`}
          </section>
        </div>
        <p class="campaign-editor-provider-note">このパネルにはmutation controlを置きません。jobのcreate/start/complete/fail/delete、asset provenanceのcreate/update/delete、rights approvalは別工程です。</p>
      </section>
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
        <span class="update-status update-status-${escapeAttr(statusClass(asset.rights_review_status))}">${escapeHtml(asset.rights_review_status || "")}</span>
        <small>${escapeHtml(asset.license_status || "")} / commercial ${escapeHtml(String(Boolean(asset.commercial_use_allowed)))}</small>
        <div class="campaign-editor-provider-guards">
          ${renderGuardFlag("publish candidate", asset.can_enter_publish_candidate)}
          ${renderGuardFlag("no external", asset.no_external_provider_call)}
          ${renderGuardFlag("no secret", asset.no_secret_material)}
          ${renderGuardFlag("no credit", asset.no_credit_consumption)}
          ${renderGuardFlag("no manifest", asset.no_content_manifest_creation)}
          ${renderGuardFlag("no publish", asset.no_publish)}
        </div>
      </article>
    `;
  }

  function renderGuardFlag(label, ok) {
    return `<span class="campaign-editor-guard${ok ? " campaign-editor-guard-ok" : " campaign-editor-guard-warn"}">${escapeHtml(label)}</span>`;
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
    if (["active", "valid", "validated", "approved", "completed", "asset_review_required"].includes(status)) return "success";
    if (["invalid", "deleted", "failed", "failed_terminal", "rejected", "blocked"].includes(status)) return "failed";
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
