(function () {
  const query = new URLSearchParams(window.location.search);
  if (query.get("editor") === "1") return;

  const root = document.getElementById("campaign-preview-root");
  const title = document.getElementById("campaign-preview-title");
  const isDisplayMode = query.get("display") === "1";
  const REQUIRED_SCENE_FIELDS = Object.freeze([
    ["scene_type", "種別"],
    ["headline", "見出し"],
    ["body_text", "本文"],
    ["visual_direction", "ビジュアル指示"],
    ["cta_text", "CTA"]
  ]);
  const state = {
    project: null,
    selectedSceneId: "",
    isPlaying: false,
    timerId: null
  };

  loadPreview().catch((error) => {
    root.innerHTML = `<section class="section"><p class="empty">${escapeHtml(error.message || "読み込みに失敗しました")}</p></section>`;
  });

  async function loadPreview() {
    const projectId = projectIdFromPath();
    if (!projectId) throw new Error("project id is required");
    const response = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(projectId)}`);
    state.project = response.campaign_project;
    const scenes = activeScenes(state.project);
    state.selectedSceneId = scenes[0]?.campaign_project_scene_id || "";
    state.isPlaying = isDisplayMode && scenes.length > 1;
    document.body.classList.toggle("campaign-preview-display-mode", isDisplayMode);
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
    const project = state.project;
    const scenes = activeScenes(project);
    const selected = scenes.find((scene) => scene.campaign_project_scene_id === state.selectedSceneId) || scenes[0] || null;
    const selectedIndex = selected ? scenes.findIndex((scene) => scene.campaign_project_scene_id === selected.campaign_project_scene_id) : -1;
    const totalDuration = scenes.reduce((sum, scene) => sum + sceneDurationSeconds(scene), 0);
    const readiness = deriveReadiness(project, scenes);
    title.textContent = project.title || project.campaign_project_id || "Campaign Preview";
    if (isDisplayMode) {
      root.innerHTML = `
        <section class="campaign-preview-display" aria-label="Campaign display preview">
          ${selected ? renderDisplayScene(project, selected, selectedIndex, scenes.length) : `<p class="empty">プレビューできるシーンがありません。</p>`}
        </section>
      `;
      schedulePlaybackTimer();
      return;
    }
    root.innerHTML = `
      <section class="campaign-preview-summary">
        <div>
          <strong>${escapeHtml(project.title || "")}</strong>
          <small>${escapeHtml(project.campaign_project_id || "")}</small>
          <small>${escapeHtml(project.tenant_id || "")} / ${escapeHtml(project.store_id || "")} / ${escapeHtml(project.screen_group_id || "")}</small>
        </div>
        <div>
          <span class="update-status update-status-${escapeAttr(project.validation_status === "valid" ? "success" : project.validation_status === "invalid" ? "failed" : "pending")}">${escapeHtml(project.status || "")}</span>
          <small>${escapeHtml(project.source_type || "")}</small>
          <small>${escapeHtml(String(scenes.length))} scenes / ${escapeHtml(String(totalDuration))}秒</small>
        </div>
      </section>
      <section class="campaign-preview-controls" aria-label="Run-through preview controls">
        <div>
          <strong>${escapeHtml(selected ? `${selectedIndex + 1} / ${scenes.length}` : "0 / 0")}</strong>
          <small>${escapeHtml(state.isPlaying ? "通し再生中" : "停止中")}</small>
        </div>
        <div class="campaign-preview-control-buttons">
          <button type="button" data-preview-play${state.isPlaying || !selected ? " disabled" : ""}>再生</button>
          <button class="secondary" type="button" data-preview-pause${state.isPlaying ? "" : " disabled"}>一時停止</button>
          <button class="secondary" type="button" data-preview-restart${selected ? "" : " disabled"}>最初から</button>
          <button class="secondary" type="button" data-preview-next${selected ? "" : " disabled"}>次へ</button>
          <a class="campaign-project-preview-link" href="${escapeHtml(displayPreviewHref(project))}" target="_blank" rel="noreferrer" data-preview-display-mode>表示モード</a>
        </div>
      </section>
      ${renderReadinessPanel(readiness)}
      <section class="campaign-preview-workspace">
        <nav class="campaign-preview-scenes" aria-label="Scenes">
          ${scenes.length ? scenes.map((scene) => renderSceneButton(scene, selected)).join("") : `<p class="empty">シーンはまだありません。</p>`}
        </nav>
        ${selected ? renderSelectedScene(project, selected) : `<div class="campaign-preview-stage"><p class="empty">プレビューできるシーンがありません。</p></div>`}
      </section>
      <section class="campaign-preview-scene-list">
        ${scenes.map(renderSceneSummary).join("")}
      </section>
    `;
    root.querySelectorAll("[data-preview-scene-id]").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedSceneId = button.dataset.previewSceneId || "";
        stopPlaybackTimer();
        render();
      });
    });
    root.querySelector("[data-preview-play]")?.addEventListener("click", startPlayback);
    root.querySelector("[data-preview-pause]")?.addEventListener("click", pausePlayback);
    root.querySelector("[data-preview-restart]")?.addEventListener("click", restartPlayback);
    root.querySelector("[data-preview-next]")?.addEventListener("click", () => {
      stopPlaybackTimer();
      selectNextScene({ wrap: true });
      render();
    });
    schedulePlaybackTimer();
  }

  function renderSceneButton(scene, selected) {
    const active = selected?.campaign_project_scene_id === scene.campaign_project_scene_id;
    return `
      <button class="${active ? "" : "secondary"}" type="button" data-preview-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        ${escapeHtml(String(scene.scene_order || ""))}. ${escapeHtml(scene.scene_type || "")}
      </button>
    `;
  }

  function renderReadinessPanel(readiness) {
    const statusText = readiness.ready ? "公開前確認 OK" : "確認が必要";
    const statusClass = readiness.ready ? "success" : "failed";
    return `
      <section class="campaign-preview-readiness" aria-label="Preview validation readiness">
        <div class="campaign-preview-readiness-heading">
          <div>
            <strong>公開前確認</strong>
            <small>既存の検証結果とシーン入力から表示する読み取り専用チェックです。</small>
          </div>
          <span class="update-status update-status-${escapeAttr(statusClass)}">${escapeHtml(statusText)}</span>
        </div>
        ${readiness.ready ? `
          <p class="campaign-preview-readiness-ok">すべての非削除シーンが検証済みです。配信作成はまだ行われていません。</p>
        ` : `
          <ul class="campaign-preview-readiness-list">
            ${readiness.items.map((item) => `<li><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.message)}</span></li>`).join("")}
          </ul>
        `}
      </section>
    `;
  }

  function deriveReadiness(project, scenes) {
    const items = [];
    if (!scenes.length) {
      items.push({ label: "シーン", message: "非削除シーンがありません。" });
    }
    const projectErrors = Array.isArray(project?.validation_errors) ? project.validation_errors : [];
    if (project?.status !== "validated" || project?.validation_status !== "valid") {
      items.push({ label: "プロジェクト", message: "プロジェクト検証が未完了です。" });
    }
    for (const error of projectErrors) {
      items.push({ label: errorLabel("プロジェクト", error), message: errorMessage(error) });
    }
    for (const scene of scenes) {
      for (const issue of sceneReadinessIssues(scene)) {
        items.push(issue);
      }
    }
    return { ready: items.length === 0, items };
  }

  function sceneReadinessIssues(scene) {
    const label = `Scene ${scene.scene_order || ""}`;
    const issues = [];
    if (scene.status !== "valid" || scene.validation_status !== "valid") {
      issues.push({ label, message: "シーン検証が未完了または無効です。" });
    }
    for (const [field, fieldLabel] of REQUIRED_SCENE_FIELDS) {
      if (!String(scene[field] ?? "").trim()) {
        issues.push({ label, message: `${fieldLabel}が未入力です。` });
      }
    }
    if (!Number.isSafeInteger(Number(scene.duration_seconds)) || Number(scene.duration_seconds) <= 0) {
      issues.push({ label, message: "秒数は1秒以上が必要です。" });
    }
    const errors = Array.isArray(scene.validation_errors) ? scene.validation_errors : [];
    for (const error of errors) {
      issues.push({ label: errorLabel(label, error), message: errorMessage(error) });
    }
    return issues;
  }

  function errorLabel(fallback, error) {
    const field = error && typeof error === "object" ? error.field || error.code || "" : "";
    return field ? `${fallback} / ${field}` : fallback;
  }

  function errorMessage(error) {
    if (!error || typeof error !== "object") return String(error || "検証エラーがあります。");
    return error.message || error.code || "検証エラーがあります。";
  }

  function renderSelectedScene(project, scene) {
    return `
      <div class="campaign-preview-stage" data-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
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
      </div>
    `;
  }

  function renderDisplayScene(project, scene, selectedIndex, sceneCount) {
    return `
      <div class="campaign-preview-stage campaign-preview-display-stage" data-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
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
      </div>
      <div class="campaign-preview-display-overlay">
        <strong>${escapeHtml(project.title || "")}</strong>
        <span>${escapeHtml(String(selectedIndex + 1))} / ${escapeHtml(String(sceneCount))}</span>
      </div>
    `;
  }

  function renderSceneSummary(scene) {
    return `
      <article class="campaign-preview-scene-summary">
        <strong>${escapeHtml(scene.scene_order || "")}. ${escapeHtml(scene.headline || "")}</strong>
        <small>${escapeHtml(scene.scene_type || "")} / ${escapeHtml(scene.status || "")} / ${escapeHtml(scene.duration_seconds || "")}秒</small>
      </article>
    `;
  }

  function startPlayback() {
    const scenes = activeScenes(state.project);
    if (!scenes.length) return;
    if (!state.selectedSceneId) state.selectedSceneId = scenes[0].campaign_project_scene_id;
    state.isPlaying = true;
    render();
  }

  function pausePlayback() {
    state.isPlaying = false;
    stopPlaybackTimer();
    render();
  }

  function restartPlayback() {
    const scenes = activeScenes(state.project);
    state.selectedSceneId = scenes[0]?.campaign_project_scene_id || "";
    state.isPlaying = true;
    render();
  }

  function schedulePlaybackTimer() {
    stopPlaybackTimer();
    if (!state.isPlaying) return;
    const scene = activeScenes(state.project).find((entry) => entry.campaign_project_scene_id === state.selectedSceneId);
    if (!scene) return;
    state.timerId = window.setTimeout(() => {
      selectNextScene({ wrap: true });
      render();
    }, sceneDurationSeconds(scene) * 1000);
  }

  function stopPlaybackTimer() {
    if (!state.timerId) return;
    window.clearTimeout(state.timerId);
    state.timerId = null;
  }

  function selectNextScene({ wrap = false } = {}) {
    const scenes = activeScenes(state.project);
    if (!scenes.length) {
      state.selectedSceneId = "";
      state.isPlaying = false;
      return;
    }
    const index = scenes.findIndex((scene) => scene.campaign_project_scene_id === state.selectedSceneId);
    const nextIndex = index + 1;
    if (nextIndex < scenes.length) {
      state.selectedSceneId = scenes[nextIndex].campaign_project_scene_id;
      return;
    }
    if (wrap) {
      state.selectedSceneId = scenes[0].campaign_project_scene_id;
      return;
    }
    state.isPlaying = false;
  }

  function sceneDurationSeconds(scene) {
    const seconds = Number.parseInt(scene?.duration_seconds, 10);
    return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : 1;
  }

  function activeScenes(project) {
    return (project?.scenes || [])
      .filter((scene) => scene.status !== "deleted")
      .sort((a, b) => (Number(a.scene_order || 0) - Number(b.scene_order || 0)));
  }

  function assetRequirements(scene) {
    const requirements = Array.isArray(scene.asset_requirements) ? scene.asset_requirements : [];
    return requirements.map((item) => {
      if (typeof item === "string") return item;
      return JSON.stringify(item);
    }).filter(Boolean);
  }

  function projectIdFromPath() {
    const match = window.location.pathname.match(/\/admin\/campaign-projects\/([^/]+)\/preview\/?$/);
    return match ? decodeURIComponent(match[1]) : "";
  }

  function displayPreviewHref(project) {
    return `/admin/campaign-projects/${encodeURIComponent(project?.campaign_project_id || projectIdFromPath())}/preview?display=1`;
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
