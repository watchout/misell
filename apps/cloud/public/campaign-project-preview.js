(function () {
  if (new URLSearchParams(window.location.search).get("editor") === "1") return;

  const root = document.getElementById("campaign-preview-root");
  const title = document.getElementById("campaign-preview-title");
  const state = {
    project: null,
    selectedSceneId: ""
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
    title.textContent = project.title || project.campaign_project_id || "Campaign Preview";
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
        </div>
      </section>
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
        render();
      });
    });
  }

  function renderSceneButton(scene, selected) {
    const active = selected?.campaign_project_scene_id === scene.campaign_project_scene_id;
    return `
      <button class="${active ? "" : "secondary"}" type="button" data-preview-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        ${escapeHtml(String(scene.scene_order || ""))}. ${escapeHtml(scene.scene_type || "")}
      </button>
    `;
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

  function renderSceneSummary(scene) {
    return `
      <article class="campaign-preview-scene-summary">
        <strong>${escapeHtml(scene.scene_order || "")}. ${escapeHtml(scene.headline || "")}</strong>
        <small>${escapeHtml(scene.scene_type || "")} / ${escapeHtml(scene.status || "")} / ${escapeHtml(scene.duration_seconds || "")}秒</small>
      </article>
    `;
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
