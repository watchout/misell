const ADMIN = {
  playlist: { version: 1, playlist_version: "", items: [] },
  assets: [],
  qrs: [],
  device: null,
  status: null,
  validationErrors: [],
  localValidation: [],
  selectedIndex: 0,
  assetFilter: "all",
  dirty: false,
  saving: false,
  activeTab: "playlist",
  lastPromo: null,
  exportingPromo: false,
  lastQr: null,
  operationLog: []
};

const DAY_OPTIONS = [
  ["sun", "日"],
  ["mon", "月"],
  ["tue", "火"],
  ["wed", "水"],
  ["thu", "木"],
  ["fri", "金"],
  ["sat", "土"]
];

const INDUSTRY_DEMO_SCENES = [
  ["anshin-oyado", "wide", "館内ワイド", ["wide"]],
  ["anshin-oyado", "guide", "館内ナビ", ["left", "center", "right"]],
  ["anshin-oyado", "sauna", "サウナ/休憩", ["left", "center", "right"]],
  ["anshin-oyado", "localads", "近隣広告", ["left", "center", "right"]],
  ["anshin-oyado", "qr", "QRサンプル", ["left", "center", "right"]],
  ["balian", "wide", "ホテル 3面ワイド", ["wide"]],
  ["balian", "roomservice", "ルームサービス", ["left", "center", "right"]],
  ["balian", "anniversary", "記念日プラン", ["left", "center", "right"]],
  ["balian", "amenity", "アメニティ", ["left", "center", "right"]],
  ["balian", "reservation", "予約導線QR", ["left", "center", "right"]],
  ["pasela", "wide", "カラオケ 3面ワイド", ["wide"]],
  ["pasela", "food", "フード/ドリンク", ["left", "center", "right"]],
  ["pasela", "collab", "コラボ告知", ["left", "center", "right"]],
  ["pasela", "event", "イベント案内", ["left", "center", "right"]],
  ["pasela", "tour", "回遊導線QR", ["left", "center", "right"]],
  ["vision-center", "wide", "会議室 3面ワイド", ["wide"]],
  ["vision-center", "guide", "会場案内", ["left", "center", "right"]],
  ["vision-center", "streaming", "配信パック", ["left", "center", "right"]],
  ["vision-center", "sponsor", "スポンサー枠", ["left", "center", "right"]],
  ["vision-center", "reception", "受付案内", ["left", "center", "right"]]
];

const $ = (id) => document.getElementById(id);

const els = {
  assetList: $("asset-list"),
  assetCount: $("asset-count"),
  uploadForm: $("upload-form"),
  assetInput: $("asset-input"),
  playlistEditor: $("playlist-editor"),
  itemDetail: $("item-detail"),
  validationErrors: $("validation-errors"),
  jsonEditor: $("json-editor"),
  toast: $("toast"),
  savePlaylist: $("save-playlist"),
  previewPlaylist: $("preview-playlist"),
  backupContent: $("backup-content"),
  reloadPlayer: $("reload-player"),
  stickySaveBar: $("sticky-save-bar"),
  selectedItemStatus: $("selected-item-status"),
  operationLog: $("operation-log-list"),
  promoForm: $("promo-form"),
  promoDraftPrompt: $("promo-draft-prompt"),
  promoDraftResult: $("promo-draft-result"),
  promoProductAsset: $("promo-product-asset"),
  promoStoryboard: $("promo-storyboard"),
  replacePromoButton: $("replace-promo"),
  qrForm: $("qr-form"),
  qrCount: $("qr-count"),
  qrResult: $("qr-result"),
  qrList: $("qr-list"),
  summaryDeviceId: $("summary-device-id"),
  summaryStoreId: $("summary-store-id"),
  summaryPlaylistVersion: $("summary-playlist-version"),
  summaryHealth: $("summary-health"),
  summaryDirty: $("summary-dirty")
};

window.addEventListener("load", initAdmin);
window.addEventListener("beforeunload", (event) => {
  if (!ADMIN.dirty) return;
  event.preventDefault();
  event.returnValue = "";
});

els.savePlaylist.addEventListener("click", savePlaylist);
els.previewPlaylist.addEventListener("click", previewPlaylist);
els.backupContent.addEventListener("click", backupContent);
els.reloadPlayer.addEventListener("click", reloadPlayer);
$("add-three-zone").addEventListener("click", () => addItem("three-zone"));
$("add-wide").addEventListener("click", () => addItem("wide"));
$("apply-json").addEventListener("click", applyJsonEditor);
$("apply-promo-draft").addEventListener("click", generatePromoDraft);

els.uploadForm.addEventListener("submit", uploadAsset);
els.promoForm.addEventListener("submit", generatePromoCuts);
els.qrForm.addEventListener("submit", generateQrCode);
els.promoStoryboard.addEventListener("click", handlePromoStoryboardClick);
els.qrResult.addEventListener("click", handleQrClick);
els.qrList.addEventListener("click", handleQrClick);
els.playlistEditor.addEventListener("click", handlePlaylistClick);
els.itemDetail.addEventListener("input", handleDetailInput);
els.itemDetail.addEventListener("change", handleDetailChange);
els.itemDetail.addEventListener("click", handleDetailClick);
els.assetList.addEventListener("click", handleAssetClick);

document.querySelectorAll("[data-asset-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    ADMIN.assetFilter = button.dataset.assetFilter || "all";
    renderAssets();
  });
});

document.querySelectorAll("[data-admin-tab-target]").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.adminTabTarget || "playlist"));
});

document.querySelectorAll("[data-sticky-save]").forEach((button) => {
  button.addEventListener("click", savePlaylist);
});

document.querySelectorAll("[data-sticky-preview]").forEach((button) => {
  button.addEventListener("click", previewPlaylist);
});

async function initAdmin() {
  addOperation("管理画面を読み込み中です");
  try {
    await Promise.all([
      loadDevice(),
      loadStatus(),
      loadAssets(),
      loadPlaylist(),
      loadQrs()
    ]);
    ADMIN.selectedIndex = normalizeSelectedIndex(ADMIN.selectedIndex);
    ADMIN.dirty = false;
    validateLocalPlaylist();
    renderAll();
    addOperation("管理画面の読み込みが完了しました");
  } catch (error) {
    addOperation(error.message || "管理画面の読み込みに失敗しました", true);
    showToast(error.message || "管理画面の読み込みに失敗しました", true);
    renderShellState();
  }
}

async function loadDevice() {
  const response = await fetch(`/api/device?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("device情報を読み込めません");
  ADMIN.device = await response.json();
}

async function loadStatus() {
  try {
    const response = await fetch(`/api/status?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`status HTTP ${response.status}`);
    ADMIN.status = await response.json();
  } catch (error) {
    ADMIN.status = { ok: false, last_error: error.message || "status unavailable" };
  }
}

async function loadPlaylist() {
  const response = await fetch(`/api/playlist?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("playlistを読み込めません");
  const payload = await response.json();
  if (payload && payload.ok === false) {
    ADMIN.validationErrors = payload.errors || ["playlist validation error"];
    ADMIN.playlist = payload.raw_playlist || { playlist_version: "", items: [] };
    return;
  }
  ADMIN.playlist = payload.playlist || payload;
  ADMIN.validationErrors = [];
}

async function loadAssets() {
  const response = await fetch(`/api/assets?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("素材一覧を読み込めません");
  const data = await response.json();
  ADMIN.assets = data.assets || [];
}

async function loadQrs() {
  const response = await fetch(`/api/qrs?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("QR一覧を読み込めません");
  const data = await response.json();
  ADMIN.qrs = data.qrs || [];
}

function renderAll() {
  renderShellState();
  renderAssets();
  renderPromoAssetOptions();
  renderPromoStoryboard();
  renderQrResult();
  renderQrList();
  renderValidationErrors();
  renderPlaylist();
  renderDetail();
  renderJson();
  renderOperationLog();
}

function renderShellState() {
  const device = ADMIN.device || {};
  const status = ADMIN.status || {};
  els.summaryDeviceId.textContent = device.device_id || status.device_id || "unknown";
  els.summaryStoreId.textContent = device.store_id || status.store_id || "unknown";
  els.summaryPlaylistVersion.textContent = ADMIN.playlist.playlist_version || status.playlist_version || "未設定";
  els.summaryHealth.textContent = status.ok === false ? "要確認" : "正常";
  els.summaryHealth.dataset.state = status.ok === false ? "warn" : "ok";
  els.summaryDirty.textContent = ADMIN.dirty ? "未保存あり" : "保存済み";
  els.summaryDirty.dataset.state = ADMIN.dirty ? "dirty" : "ok";
  els.savePlaylist.disabled = !ADMIN.dirty || ADMIN.saving;
  els.savePlaylist.textContent = ADMIN.saving ? "保存中" : "保存";
  els.stickySaveBar.hidden = !ADMIN.dirty;
  document.body.dataset.adminTab = ADMIN.activeTab;

  document.querySelectorAll("[data-admin-tab-target]").forEach((button) => {
    const active = button.dataset.adminTabTarget === ADMIN.activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-current", active ? "page" : "false");
  });
}

function renderValidationErrors() {
  const errors = [
    ...ADMIN.validationErrors.map((message) => ({ message, source: "server" })),
    ...ADMIN.localValidation
  ];
  if (errors.length === 0) {
    els.validationErrors.hidden = true;
    els.validationErrors.replaceChildren();
    return;
  }

  els.validationErrors.hidden = false;
  els.validationErrors.innerHTML = `
    <strong>Validation errors</strong>
    <ul>
      ${errors.map((error) => `<li>${escapeHtml(error.message || error)}</li>`).join("")}
    </ul>
  `;
}

function renderAssets() {
  const assets = filteredAssets();
  els.assetCount.textContent = String(ADMIN.assets.length);

  document.querySelectorAll("[data-asset-filter]").forEach((button) => {
    const active = button.dataset.assetFilter === ADMIN.assetFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  });

  if (assets.length === 0) {
    els.assetList.innerHTML = `
      <tr>
        <td colspan="5" class="empty-cell">${ADMIN.assets.length === 0 ? "素材はまだありません" : "条件に合う素材がありません"}</td>
      </tr>
    `;
    return;
  }

  els.assetList.innerHTML = assets.map((asset) => {
    const usages = findAssetUsages(asset.path);
    return `
      <tr>
        <td>${renderAssetThumb(asset)}</td>
        <td>
          <code>${escapeHtml(asset.path)}</code>
          <div class="muted">${escapeHtml(asset.name)}</div>
        </td>
        <td>${formatBytes(asset.size)}</td>
        <td>${usages.length}</td>
        <td class="table-actions">
          <button class="button tiny secondary" type="button" data-copy-path="${escapeAttr(asset.path)}">コピー</button>
          <button class="button tiny danger" type="button" data-delete-asset="${escapeAttr(asset.path)}">削除</button>
        </td>
      </tr>
    `;
  }).join("");
}

function filteredAssets() {
  if (ADMIN.assetFilter === "image") return ADMIN.assets.filter((asset) => asset.type === "image");
  if (ADMIN.assetFilter === "video") return ADMIN.assets.filter((asset) => asset.type === "video");
  return ADMIN.assets;
}

function renderAssetThumb(asset) {
  if (asset.type === "image") {
    return `<img class="asset-thumb" src="${escapeAttr(asset.path)}" alt="">`;
  }
  return `<video class="asset-thumb" src="${escapeAttr(asset.path)}" muted playsinline preload="metadata"></video>`;
}

function renderPlaylist() {
  const items = ADMIN.playlist.items || [];
  if (items.length === 0) {
    els.playlistEditor.innerHTML = `<div class="empty-editor">playlist item がありません</div>`;
    return;
  }

  els.playlistEditor.innerHTML = items.map((item, index) => {
    const itemErrors = itemValidationErrors(index);
    const active = index === ADMIN.selectedIndex;
    const status = itemErrors.length > 0 ? "要修正" : "OK";
    return `
      <article class="playlist-item playlist-row${active ? " is-selected" : ""}" data-index="${index}">
        <button class="playlist-select" type="button" data-select-item="${index}" aria-pressed="${active ? "true" : "false"}">
          <span class="row-order">${index + 1}</span>
          <span class="row-main">
            <strong>${escapeHtml(item.name || item.item_id || `Item ${index + 1}`)}</strong>
            <span>${escapeHtml(item.layout || "three-zone")} / ${escapeHtml(item.duration || 10)}秒 / ${scheduleLabel(item)}</span>
          </span>
          <span class="status-pill" data-state="${itemErrors.length > 0 ? "warn" : "ok"}">${status}</span>
        </button>
        <div class="item-actions">
          <button class="button tiny secondary" type="button" data-move="up">上へ</button>
          <button class="button tiny secondary" type="button" data-move="down">下へ</button>
          <button class="button tiny secondary" type="button" data-duplicate>複製</button>
          <button class="button tiny danger" type="button" data-delete>削除</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderDetail() {
  const item = selectedItem();
  if (!item) {
    els.selectedItemStatus.textContent = "未選択";
    els.selectedItemStatus.dataset.state = "warn";
    els.itemDetail.innerHTML = `<div class="empty-editor">配信順から item を選択してください</div>`;
    return;
  }

  const errors = itemValidationErrors(ADMIN.selectedIndex);
  els.selectedItemStatus.textContent = errors.length > 0 ? "要修正" : "OK";
  els.selectedItemStatus.dataset.state = errors.length > 0 ? "warn" : "ok";
  const fields = item.layout === "wide" ? ["wide"] : ["left", "center", "right"];

  els.itemDetail.innerHTML = `
    <div class="detail-form" data-index="${ADMIN.selectedIndex}">
      <label>
        <span>Enabled</span>
        <select data-detail-field="enabled">
          <option value="true" ${item.enabled !== false ? "selected" : ""}>有効</option>
          <option value="false" ${item.enabled === false ? "selected" : ""}>無効</option>
        </select>
      </label>
      <label>
        <span>名称</span>
        <input type="text" data-detail-field="name" value="${escapeAttr(item.name || "")}" maxlength="120">
      </label>
      <label>
        <span>レイアウト</span>
        <select data-detail-field="layout">
          <option value="three-zone" ${item.layout !== "wide" ? "selected" : ""}>3ゾーン</option>
          <option value="wide" ${item.layout === "wide" ? "selected" : ""}>ワイド</option>
        </select>
      </label>
      <label>
        <span>表示秒数</span>
        <input type="number" min="1" max="300" data-detail-field="duration" value="${escapeAttr(item.duration || 10)}" aria-describedby="detail-errors">
      </label>
      <label>
        <span>開始時刻</span>
        <input type="time" data-detail-field="start" value="${escapeAttr(item.start || "")}">
      </label>
      <label>
        <span>終了時刻</span>
        <input type="time" data-detail-field="end" value="${escapeAttr(item.end || "")}">
      </label>
      ${renderDayControls(item)}
      <div class="source-grid detail-source-grid">
        ${fields.map((field) => renderSourceControl(item, field)).join("")}
      </div>
      ${renderMiniPreview(item)}
      <div id="detail-errors" class="detail-errors" ${errors.length === 0 ? "hidden" : ""}>
        ${errors.length > 0 ? `<strong>修正してください</strong><ul>${errors.map((error) => `<li>${escapeHtml(error.message)}</li>`).join("")}</ul>` : ""}
      </div>
    </div>
  `;
}

function renderDayControls(item) {
  const selectedDays = Array.isArray(item.days_of_week) ? item.days_of_week : [];
  return `
    <fieldset class="day-grid">
      <legend>曜日</legend>
      ${DAY_OPTIONS.map(([value, label]) => `
        <label>
          <input type="checkbox" data-day="${escapeAttr(value)}"${selectedDays.includes(value) ? " checked" : ""}>
          <span>${escapeHtml(label)}</span>
        </label>
      `).join("")}
      <small>未選択の場合は毎日表示</small>
    </fieldset>
  `;
}

function renderSourceControl(item, field) {
  const errors = itemValidationErrors(ADMIN.selectedIndex)
    .filter((error) => error.field === field);
  return `
    <label>
      <span>${escapeHtml(field)}</span>
      <input type="text" data-detail-field="${field}" value="${escapeAttr(item[field] || "")}" placeholder="/assets/images/example.jpg" aria-invalid="${errors.length > 0 ? "true" : "false"}" aria-describedby="detail-errors">
      <select data-source-picker="${field}">
        <option value="">素材から選択</option>
        ${demoOptions(field)}
        ${ADMIN.assets.map((asset) => `<option value="${escapeAttr(asset.path)}">${escapeHtml(asset.path)}</option>`).join("")}
      </select>
    </label>
  `;
}

function demoOptions(field) {
  return demoSourceOptions(field)
    .map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`)
    .join("");
}

function allDemoSourceOptions() {
  const seen = new Set();
  const options = ["wide", "left", "center", "right"].flatMap(demoSourceOptions);
  return options.filter(([value]) => {
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function demoSourceOptions(field) {
  const options = [
    ["/demo/left.html", "Demo left"],
    ["/demo/center.html", "Demo center"],
    ["/demo/right.html", "Demo right"],
    ["/demo/wide.html", "Demo wide"]
  ];

  const industryOptions = INDUSTRY_DEMO_SCENES
    .filter(([, , , zones]) => zones.includes(field))
    .map(([industry, scene, label]) => [
      `/demo/industry.html?industry=${industry}&scene=${scene}&zone=${field}`,
      `${label} ${field}`
    ]);

  return [
    ...options.filter(([value]) => field === "wide" ? value.includes("wide") : !value.includes("wide")),
    ...industryOptions
  ];
}

function renderMiniPreview(item) {
  const fields = item.layout === "wide" ? ["wide"] : ["left", "center", "right"];
  return `
    <div class="mini-preview ${item.layout === "wide" ? "mini-wide" : ""}">
      ${fields.map((field) => `<div><span>${escapeHtml(field)}</span><strong>${sourceLabel(item[field], "未設定")}</strong></div>`).join("")}
    </div>
  `;
}

function renderJson() {
  els.jsonEditor.value = JSON.stringify(ADMIN.playlist, null, 2);
}

function renderOperationLog() {
  if (ADMIN.operationLog.length === 0) {
    els.operationLog.innerHTML = `<li class="muted">操作はまだありません</li>`;
    return;
  }
  els.operationLog.innerHTML = ADMIN.operationLog.map((entry) => `
    <li data-state="${entry.error ? "error" : "ok"}">
      <time>${escapeHtml(entry.time)}</time>
      <span>${escapeHtml(entry.message)}</span>
    </li>
  `).join("");
}

function renderPromoAssetOptions() {
  const currentValue = els.promoProductAsset.value;
  const options = [
    ...allDemoSourceOptions(),
    ...ADMIN.assets.map((asset) => [asset.path, asset.path])
  ];
  els.promoProductAsset.innerHTML = options.map(([value, label]) => (
    `<option value="${escapeAttr(value)}"${value === currentValue ? " selected" : ""}>${escapeHtml(label)}</option>`
  )).join("");
  if (currentValue && options.some(([value]) => value === currentValue)) {
    els.promoProductAsset.value = currentValue;
  }
}

function renderPromoStoryboard() {
  const promo = ADMIN.lastPromo;
  if (!promo) {
    els.promoStoryboard.hidden = true;
    els.promoStoryboard.replaceChildren();
    els.replacePromoButton.disabled = true;
    return;
  }

  els.replacePromoButton.disabled = false;
  els.promoStoryboard.hidden = false;
  els.promoStoryboard.innerHTML = `
    <h3>${escapeHtml(promo.product_name)} / ${escapeHtml(promo.pattern)}</h3>
    <ul class="promo-cut-list">
      ${(promo.storyboard || []).map((cut) => `
        <li>
          <strong>${escapeHtml(cut.name || cut.item_id)}</strong>
          <span>${escapeHtml(cut.layout)} / ${escapeHtml(cut.duration)}秒 / ${escapeHtml(screenSummary(cut.screens))}</span>
        </li>
      `).join("")}
    </ul>
    <div class="promo-export">
      <label>
        <span>動画出力</span>
        <select data-promo-export-preset>
          <option value="preview">確認用 WebM 1280x720</option>
          <option value="full">3面 WebM 5760x1080</option>
        </select>
      </label>
      <button class="button secondary" type="button" data-export-promo ${ADMIN.exportingPromo ? "disabled" : ""}>
        ${ADMIN.exportingPromo ? "書き出し中" : "WebM書き出し"}
      </button>
      <a class="button secondary" data-promo-download href="${escapeAttr(promo.export?.output || "#")}" download ${promo.export?.output ? "" : "hidden"}>
        ダウンロード
      </a>
      ${promo.export ? `<span>${escapeHtml(promo.export.preset)} / ${escapeHtml(formatBytes(promo.export.size))}</span>` : ""}
    </div>
  `;
}

function renderPromoDraftResult(result) {
  if (!result) {
    els.promoDraftResult.hidden = true;
    els.promoDraftResult.replaceChildren();
    return;
  }

  const draft = result.draft || {};
  const fields = [
    ["商品名", draft.product_name],
    ["価格", draft.price],
    ["特典", draft.offer],
    ["CTA", draft.cta],
    ["特徴", [draft.feature_1, draft.feature_2, draft.feature_3].filter(Boolean).join(" / ")]
  ].filter(([, value]) => value);
  const missing = result.missing_fields || [];

  els.promoDraftResult.hidden = false;
  els.promoDraftResult.innerHTML = `
    <strong>反映済み</strong>
    ${fields.length > 0 ? `<span>${fields.map(([label, value]) => `${escapeHtml(label)}: ${escapeHtml(value)}`).join(" / ")}</span>` : ""}
    ${missing.length > 0 ? `<span>要確認: ${missing.map((field) => escapeHtml(field)).join(", ")}</span>` : ""}
  `;
}

function renderQrResult() {
  const qr = ADMIN.lastQr;
  if (!qr) {
    els.qrResult.hidden = true;
    els.qrResult.replaceChildren();
    return;
  }

  els.qrResult.hidden = false;
  els.qrResult.innerHTML = `
    <div class="qr-result-grid">
      <img class="qr-preview" src="${escapeAttr(qr.image_path)}" alt="">
      <div class="qr-meta">
        <h3>${escapeHtml(qr.label || qr.qr_id)}</h3>
        <dl>
          <div>
            <dt>Campaign</dt>
            <dd><code>${escapeHtml(qr.campaign_id)}</code></dd>
          </div>
          <div>
            <dt>QR ID</dt>
            <dd><code>${escapeHtml(qr.qr_id)}</code></dd>
          </div>
          <div>
            <dt>LP URL</dt>
            <dd><code>${escapeHtml(qr.lp_url)}</code></dd>
          </div>
          <div>
            <dt>Image</dt>
            <dd><code>${escapeHtml(qr.image_path)}</code></dd>
          </div>
        </dl>
        <div class="qr-actions">
          <a class="button secondary" href="${escapeAttr(qr.image_path)}" download>PNG</a>
          <button class="button secondary" type="button" data-copy-qr-path="${escapeAttr(qr.image_path)}">画像パスコピー</button>
          <button class="button secondary" type="button" data-copy-qr-id="${escapeAttr(qr.qr_id)}">QR IDコピー</button>
        </div>
      </div>
    </div>
  `;
}

function renderQrList() {
  els.qrCount.textContent = String(ADMIN.qrs.length);

  if (ADMIN.qrs.length === 0) {
    els.qrList.innerHTML = `
      <tr>
        <td colspan="4" class="empty-cell">QRはまだありません</td>
      </tr>
    `;
    return;
  }

  els.qrList.innerHTML = ADMIN.qrs.map((qr) => `
    <tr>
      <td>
        <img class="qr-thumb" src="${escapeAttr(qr.image_path)}" alt="">
        <code>${escapeHtml(qr.qr_id)}</code>
      </td>
      <td>
        <strong>${escapeHtml(qr.label || qr.campaign_id)}</strong>
        <div class="muted">${escapeHtml(qr.campaign_id)}</div>
      </td>
      <td><code>${escapeHtml(qr.lp_url)}</code></td>
      <td class="table-actions">
        <a class="button tiny secondary" href="${escapeAttr(qr.image_path)}" download>PNG</a>
        <button class="button tiny secondary" type="button" data-copy-qr-path="${escapeAttr(qr.image_path)}">コピー</button>
      </td>
    </tr>
  `).join("");
}

function handlePlaylistClick(event) {
  const target = event.target;
  const row = target.closest("[data-index]");
  if (!row) return;
  const index = Number(row.dataset.index);

  if (target.closest("[data-select-item]")) {
    ADMIN.selectedIndex = index;
    setActiveTab("detail");
    renderAll();
    return;
  }

  if (target.matches("[data-delete]")) {
    const item = ADMIN.playlist.items[index];
    if (!window.confirm(`${item.name || item.item_id || "item"} を削除しますか？`)) return;
    ADMIN.playlist.items.splice(index, 1);
    ADMIN.selectedIndex = normalizeSelectedIndex(Math.min(index, ADMIN.playlist.items.length - 1));
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
    return;
  }

  if (target.matches("[data-duplicate]")) {
    const id = `item-${Date.now()}`;
    const copy = {
      ...ADMIN.playlist.items[index],
      id,
      item_id: id,
      name: `${ADMIN.playlist.items[index].name || "Item"} copy`
    };
    ADMIN.playlist.items.splice(index + 1, 0, copy);
    ADMIN.selectedIndex = index + 1;
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
    return;
  }

  if (target.matches("[data-move]")) {
    const direction = target.dataset.move === "up" ? -1 : 1;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ADMIN.playlist.items.length) return;
    const [item] = ADMIN.playlist.items.splice(index, 1);
    ADMIN.playlist.items.splice(nextIndex, 0, item);
    ADMIN.selectedIndex = nextIndex;
    setDirty(true);
    renderAll();
  }
}

function handleDetailInput(event) {
  const target = event.target;
  if (!target.matches("[data-detail-field]")) return;
  const item = selectedItem();
  if (!item) return;
  updateItemField(item, target.dataset.detailField, target);
  setDirty(true);
  validateLocalPlaylist();
  renderJson();
  renderValidationErrors();
  renderShellState();
}

function handleDetailChange(event) {
  const target = event.target;
  const item = selectedItem();
  if (!item) return;

  if (target.matches("[data-day]")) {
    const day = target.dataset.day;
    const selected = new Set(Array.isArray(item.days_of_week) ? item.days_of_week : []);
    if (target.checked) selected.add(day);
    else selected.delete(day);
    item.days_of_week = DAY_OPTIONS.map(([value]) => value).filter((value) => selected.has(value));
    setDirty(true);
    renderAll();
    return;
  }

  if (target.matches("[data-source-picker]") && target.value) {
    item[target.dataset.sourcePicker] = target.value;
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
    return;
  }

  if (target.matches("[data-detail-field]")) {
    updateItemField(item, target.dataset.detailField, target);
    normalizeLayoutFields(item);
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
  }
}

function handleDetailClick(event) {
  if (!event.target.matches("[data-use-selected-asset]")) return;
  const item = selectedItem();
  if (!item) return;
  item[event.target.dataset.useSelectedAsset] = event.target.dataset.assetPath || "";
  setDirty(true);
  validateLocalPlaylist();
  renderAll();
}

function updateItemField(item, field, target) {
  if (field === "enabled") {
    item.enabled = target.value !== "false";
    return;
  }
  if (field === "duration") {
    item.duration = clampInt(Number.parseInt(target.value, 10) || 1, 1, 300);
    return;
  }
  item[field] = target.value;
}

async function handleAssetClick(event) {
  const copyPath = event.target.dataset.copyPath;
  const deletePath = event.target.dataset.deleteAsset;

  if (copyPath) {
    await navigator.clipboard?.writeText(copyPath);
    addOperation("素材パスをコピーしました");
    showToast("素材パスをコピーしました");
    return;
  }

  if (deletePath) {
    const usages = findAssetUsages(deletePath);
    const usageLabel = usages.length > 0
      ? `\n\nこの素材は ${usages.length} 件のplaylist itemで使用中です:\n${usages.slice(0, 6).join("\n")}\n\n削除すると該当枠は表示できなくなります。`
      : "";
    if (!window.confirm(`${deletePath} を削除しますか？${usageLabel}`)) return;
    const response = await fetch(`/api/assets?path=${encodeURIComponent(deletePath)}`, { method: "DELETE" });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }
    await loadAssets();
    validateLocalPlaylist();
    renderAll();
    addOperation("素材を削除しました。削除前バックアップを作成済みです。");
    showToast("素材を削除しました。削除前バックアップを作成済みです。");
  }
}

async function handleQrClick(event) {
  const button = event.target.closest("[data-copy-qr-path], [data-copy-qr-id]");
  if (!button) return;

  const value = button.dataset.copyQrPath || button.dataset.copyQrId || "";
  if (!value) return;
  await navigator.clipboard?.writeText(value);
  showToast(button.dataset.copyQrId ? "QR IDをコピーしました" : "QR画像パスをコピーしました");
}

async function uploadAsset(event) {
  event.preventDefault();
  const file = els.assetInput.files?.[0];
  if (!file) {
    addOperation("アップロードするファイルが選択されていません", true);
    showToast("アップロードするファイルを選んでください", true);
    return;
  }

  const formData = new FormData();
  formData.append("asset", file);
  const button = event.currentTarget.querySelector("button[type='submit']");
  withButtonState(button, "アップロード中", true);
  try {
    const response = await fetch("/api/assets/upload", { method: "POST", body: formData });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }

    els.assetInput.value = "";
    await loadAssets();
    renderAll();
    addOperation("素材をアップロードしました。バックアップも作成済みです。");
    showToast("素材をアップロードしました。バックアップも作成済みです。");
  } finally {
    withButtonState(button, "アップロード", false);
  }
}

async function generateQrCode(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type='submit']");
  const payload = {
    campaign_id: form.elements.campaign_id.value,
    qr_id: form.elements.qr_id.value,
    label: form.elements.label.value,
    lp_url: form.elements.lp_url.value
  };

  withButtonState(button, "発行中", true);
  try {
    const response = await fetch("/api/qrs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }

    const data = await response.json();
    ADMIN.lastQr = data.qr;
    await loadQrs();
    renderQrResult();
    renderQrList();
    addOperation("QRを発行しました。バックアップも作成済みです。");
    showToast("QRを発行しました。バックアップも作成済みです。");
  } catch (error) {
    addOperation(error.message || "QRの発行に失敗しました", true);
    showToast(error.message || "QRの発行に失敗しました", true);
  } finally {
    withButtonState(button, "QR発行", false);
  }
}

async function generatePromoCuts(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = event.submitter || form.querySelector("button[type='submit']");
  const isReplace = button?.value === "replace" && ADMIN.lastPromo;
  const payload = {
    pattern: form.elements.pattern.value,
    product_name: form.elements.product_name.value,
    product_asset: form.elements.product_asset.value,
    price: form.elements.price.value,
    offer: form.elements.offer.value,
    cta: form.elements.cta.value,
    feature_1: form.elements.feature_1.value,
    feature_2: form.elements.feature_2.value,
    feature_3: form.elements.feature_3.value,
    duration_per_cut: Number.parseInt(form.elements.duration_per_cut.value, 10) || 5,
    campaign_id: form.elements.campaign_id.value
  };
  if (isReplace) {
    payload.promo_id = ADMIN.lastPromo.id;
    payload.campaign_id = payload.campaign_id || ADMIN.lastPromo.campaign_id;
  }

  withButtonState(button, "生成中", true);
  try {
    const response = await fetch("/api/promo-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }

    const data = await response.json();
    const promo = data.promo;
    const items = promo.playlist_items || [];
    if (isReplace) {
      ADMIN.playlist.items = removePromoItems(ADMIN.playlist.items || [], ADMIN.lastPromo);
    }
    ADMIN.playlist.items = [...(ADMIN.playlist.items || []), ...items];
    ADMIN.lastPromo = promo;
    ADMIN.selectedIndex = Math.max(0, ADMIN.playlist.items.length - items.length);
    ADMIN.validationErrors = [];
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
    const actionLabel = isReplace ? "置換" : "追加";
    addOperation(`${items.length}件のPRカットをplaylistへ${actionLabel}しました`);
    showToast(`${items.length}件のPRカットをplaylistへ${actionLabel}しました`);
  } catch (error) {
    addOperation(error.message || "PRカットの生成に失敗しました", true);
    showToast(error.message || "PRカットの生成に失敗しました", true);
  } finally {
    withButtonState(button, isReplace ? "再生成して置換" : "カット追加", false);
    renderPromoStoryboard();
  }
}

async function generatePromoDraft() {
  const prompt = els.promoDraftPrompt.value.trim();
  if (!prompt) {
    showToast("下書きに使う自然文を入力してください", true);
    return;
  }

  const button = $("apply-promo-draft");
  withButtonState(button, "解析中", true);
  try {
    const response = await fetch("/api/promo-drafts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt })
    });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }

    const data = await response.json();
    applyPromoDraft(data.draft || {});
    renderPromoDraftResult(data);
    showToast("下書きをフォームに反映しました。内容を確認してから生成してください。");
  } catch (error) {
    addOperation(error.message || "PR下書きの生成に失敗しました", true);
    showToast(error.message || "PR下書きの生成に失敗しました", true);
  } finally {
    withButtonState(button, "下書き反映", false);
  }
}

function applyPromoDraft(draft) {
  const assign = (name, value) => {
    if (value === undefined || value === null || value === "") return;
    if (!els.promoForm.elements[name]) return;
    els.promoForm.elements[name].value = value;
  };

  assign("pattern", draft.pattern);
  assign("product_name", draft.product_name);
  assign("price", draft.price);
  assign("offer", draft.offer);
  assign("cta", draft.cta);
  assign("feature_1", draft.feature_1);
  assign("feature_2", draft.feature_2);
  assign("feature_3", draft.feature_3);
  assign("duration_per_cut", draft.duration_per_cut);
}

async function handlePromoStoryboardClick(event) {
  const button = event.target.closest("[data-export-promo]");
  if (!button) return;
  await exportPromoVideo(button);
}

async function exportPromoVideo(button) {
  const promo = ADMIN.lastPromo;
  if (!promo) {
    showToast("先にPRカットを生成してください", true);
    return;
  }

  const items = currentPromoItems(promo);
  if (items.length === 0) {
    showToast("書き出すPRカットがplaylistにありません", true);
    return;
  }

  const preset = els.promoStoryboard.querySelector("[data-promo-export-preset]")?.value || "preview";
  ADMIN.exportingPromo = true;
  renderPromoStoryboard();
  try {
    const response = await fetch(`/api/promo-campaigns/${encodeURIComponent(promo.id)}/export`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preset, items })
    });
    if (!response.ok) {
      const message = await errorMessage(response);
      addOperation(message, true);
      showToast(message, true);
      return;
    }

    const data = await response.json();
    ADMIN.lastPromo = { ...promo, export: data.export };
    renderPromoStoryboard();
    addOperation("WebM動画を書き出しました");
    showToast("WebM動画を書き出しました");
  } catch (error) {
    addOperation(error.message || "WebM動画の書き出しに失敗しました", true);
    showToast(error.message || "WebM動画の書き出しに失敗しました", true);
  } finally {
    ADMIN.exportingPromo = false;
    renderPromoStoryboard();
  }
}

function currentPromoItems(promo) {
  const itemIds = new Set((promo.playlist_items || []).map((item) => item.item_id || item.id).filter(Boolean));
  const generatedPrefix = `/generated/promos/${promo.id}/`;
  const items = (ADMIN.playlist.items || []).filter((item) => (
    item.enabled !== false && (
      itemIds.has(item.item_id || item.id) ||
      ["left", "center", "right", "wide"].some((field) => String(item[field] || "").startsWith(generatedPrefix))
    )
  ));
  return items.length > 0 ? items : (promo.playlist_items || []);
}

function removePromoItems(items, promo) {
  const itemIds = new Set((promo.playlist_items || []).map((item) => item.item_id || item.id).filter(Boolean));
  const generatedPrefix = `/generated/promos/${promo.id}/`;
  return items.filter((item) => {
    if (itemIds.has(item.item_id || item.id)) return false;
    return !["left", "center", "right", "wide"].some((field) => String(item[field] || "").startsWith(generatedPrefix));
  });
}

async function savePlaylist() {
  ADMIN.saving = true;
  renderShellState();
  try {
    normalizePlaylistForSave();
    const response = await fetch("/api/playlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN.playlist)
    });

    if (!response.ok) {
      await handleValidationResponse(response);
      return;
    }

    const payload = await response.json();
    ADMIN.playlist = payload.playlist || payload;
    ADMIN.validationErrors = [];
    ADMIN.selectedIndex = normalizeSelectedIndex(ADMIN.selectedIndex);
    setDirty(false);
    await loadStatus();
    validateLocalPlaylist();
    renderAll();
    addOperation(`playlistを保存しました: ${ADMIN.playlist.playlist_version}`);
    showToast(`playlistを保存しました: ${ADMIN.playlist.playlist_version}`);
  } catch (error) {
    addOperation(error.message, true);
    showToast(error.message, true);
  } finally {
    ADMIN.saving = false;
    renderShellState();
  }
}

async function previewPlaylist() {
  try {
    normalizePlaylistForSave({ preview: true });
    localStorage.setItem("misell_preview_playlist", JSON.stringify(ADMIN.playlist));
    window.open("/player?preview=1&local_preview=1", "_blank", "noopener,noreferrer");
    addOperation("未保存playlistをプレビューへ送信しました");
    showToast("未保存playlistをプレビューへ送信しました");
  } catch (error) {
    addOperation(error.message, true);
    showToast(error.message, true);
  }
}

async function backupContent() {
  const response = await fetch("/api/content-backups", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual-admin" })
  });
  if (!response.ok) {
    const message = await errorMessage(response);
    addOperation(message, true);
    showToast(message, true);
    return;
  }
  const payload = await response.json();
  addOperation(`バックアップを作成しました: ${payload.backup?.name || ""}`);
  showToast(`バックアップを作成しました: ${payload.backup?.name || ""}`);
}

async function reloadPlayer() {
  const response = await fetch("/api/reload", { method: "POST" });
  const message = response.ok ? "プレイヤーへ再読み込みを送信しました" : await errorMessage(response);
  addOperation(message, !response.ok);
  showToast(message, !response.ok);
}

function addItem(layout) {
  const id = `item-${Date.now()}`;
  ADMIN.playlist.items = ADMIN.playlist.items || [];
  ADMIN.playlist.items.push({
    id,
    item_id: id,
    name: layout === "wide" ? "新規ワイド" : "新規3ゾーン",
    enabled: true,
    layout,
    duration: 10,
    start: "",
    end: "",
    days_of_week: [],
    left: layout === "three-zone" ? "/demo/left.html" : "",
    center: layout === "three-zone" ? "/demo/center.html" : "",
    right: layout === "three-zone" ? "/demo/right.html" : "",
    wide: layout === "wide" ? "/demo/wide.html" : ""
  });
  ADMIN.selectedIndex = ADMIN.playlist.items.length - 1;
  setDirty(true);
  validateLocalPlaylist();
  renderAll();
}

function applyJsonEditor() {
  try {
    const parsed = JSON.parse(els.jsonEditor.value);
    if (!Array.isArray(parsed.items)) throw new Error("items array is required");
    if (!window.confirm("JSON editor の内容で現在のフォーム状態を置き換えますか？")) return;
    ADMIN.playlist = parsed;
    ADMIN.validationErrors = [];
    ADMIN.selectedIndex = normalizeSelectedIndex(0);
    setDirty(true);
    validateLocalPlaylist();
    renderAll();
    showToast("JSONを反映しました。保存ボタンで確定します。");
  } catch (error) {
    addOperation(`JSONエラー: ${error.message}`, true);
    showToast(`JSONエラー: ${error.message}`, true);
  }
}

function normalizePlaylistForSave(options = {}) {
  if (!ADMIN.playlist || !Array.isArray(ADMIN.playlist.items)) {
    throw new Error("playlist items are required");
  }
  const now = new Date();
  ADMIN.playlist.version = Number(ADMIN.playlist.version || 1);
  ADMIN.playlist.updatedAt = now.toISOString();
  if (!options.preview) {
    ADMIN.playlist.playlist_version = nextPlaylistVersion(now);
  } else {
    ADMIN.playlist.playlist_version = ADMIN.playlist.playlist_version || nextPlaylistVersion(now);
  }
  ADMIN.playlist.items = ADMIN.playlist.items.map((item, index) => {
    const id = item.item_id || item.id || `item-${now.getTime()}-${index + 1}`;
    return {
      ...item,
      id,
      item_id: id,
      enabled: item.enabled !== false,
      layout: item.layout === "wide" ? "wide" : "three-zone",
      duration: clampInt(Number.parseInt(item.duration, 10) || 10, 1, 300),
      days_of_week: Array.isArray(item.days_of_week)
        ? DAY_OPTIONS.map(([value]) => value).filter((value) => item.days_of_week.includes(value))
        : []
    };
  });
  validateLocalPlaylist();
  renderJson();
}

function validateLocalPlaylist() {
  const errors = [];
  const seen = new Set();
  const items = ADMIN.playlist.items || [];
  items.forEach((item, index) => {
    const label = `#${index + 1} ${item.name || item.item_id || "item"}`;
    const id = item.item_id || item.id || "";
    if (!id) errors.push({ index, field: "item_id", message: `${label}: item_id が必要です` });
    if (id && seen.has(id)) errors.push({ index, field: "item_id", message: `${label}: item_id が重複しています` });
    if (id) seen.add(id);
    if (item.layout !== "wide" && item.layout !== "three-zone") {
      errors.push({ index, field: "layout", message: `${label}: layout は 3ゾーン または ワイドです` });
    }
    const duration = Number.parseInt(item.duration, 10);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 300) {
      errors.push({ index, field: "duration", message: `${label}: 表示秒数は 1-300 秒です` });
    }
    if (item.enabled !== false) {
      const required = item.layout === "wide" ? ["wide"] : ["left", "center", "right"];
      for (const field of required) {
        if (!String(item[field] || "").trim()) {
          errors.push({ index, field, message: `${label}: ${field} の素材が必要です` });
        }
      }
    }
  });
  ADMIN.localValidation = errors;
  return errors;
}

function itemValidationErrors(index) {
  return ADMIN.localValidation.filter((error) => error.index === index);
}

function normalizeLayoutFields(item) {
  if (item.layout === "wide") {
    item.wide = item.wide || item.center || item.left || "/demo/wide.html";
    item.left = "";
    item.center = "";
    item.right = "";
    return;
  }
  item.left = item.left || "/demo/left.html";
  item.center = item.center || "/demo/center.html";
  item.right = item.right || "/demo/right.html";
  item.wide = "";
}

function selectedItem() {
  return (ADMIN.playlist.items || [])[ADMIN.selectedIndex] || null;
}

function normalizeSelectedIndex(index) {
  const count = (ADMIN.playlist.items || []).length;
  if (count === 0) return 0;
  return clampInt(Number(index) || 0, 0, count - 1);
}

function setDirty(value) {
  ADMIN.dirty = Boolean(value);
  renderShellState();
}

function setActiveTab(tab) {
  ADMIN.activeTab = ["assets", "playlist", "detail", "json"].includes(tab) ? tab : "playlist";
  renderShellState();
}

function addOperation(message, error = false) {
  ADMIN.operationLog.unshift({
    time: new Date().toLocaleTimeString("ja-JP", { hour12: false }),
    message,
    error
  });
  ADMIN.operationLog = ADMIN.operationLog.slice(0, 8);
  renderOperationLog();
}

function nextPlaylistVersion(date = new Date()) {
  const stamp = date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `pl-${stamp}`;
}

function findAssetUsages(assetPath) {
  const usages = [];
  const fields = ["left", "center", "right", "wide"];
  for (const item of ADMIN.playlist.items || []) {
    for (const field of fields) {
      if (item[field] === assetPath) {
        usages.push(`${item.name || item.item_id || "item"} / ${field}`);
      }
    }
  }
  return usages;
}

function sourceLabel(source, fallback) {
  const value = source || fallback;
  const file = value.split("/").filter(Boolean).pop() || value;
  return escapeHtml(file);
}

function scheduleLabel(item) {
  const days = Array.isArray(item.days_of_week) && item.days_of_week.length > 0
    ? item.days_of_week.join(",")
    : "毎日";
  const time = item.start || item.end ? `${item.start || "開始なし"}-${item.end || "終了なし"}` : "終日";
  return `${days} / ${time}`;
}

function screenSummary(screens) {
  if (!screens || typeof screens !== "object") return "";
  return Object.entries(screens)
    .map(([screen, source]) => {
      const value = String(source || screen);
      const file = value.split("/").filter(Boolean).pop() || value;
      return `${screen}: ${file}`;
    })
    .join(" / ");
}

async function errorMessage(response) {
  try {
    const data = await response.json();
    return data.error || `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

async function handleValidationResponse(response) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    data = { error: `HTTP ${response.status}` };
  }
  ADMIN.validationErrors = data.errors || [data.error || `HTTP ${response.status}`];
  validateLocalPlaylist();
  renderValidationErrors();
  addOperation(ADMIN.validationErrors[0], true);
  showToast(ADMIN.validationErrors[0], true);
}

function withButtonState(button, label, disabled) {
  if (!button) return;
  button.disabled = disabled;
  button.textContent = label;
}

function showToast(message, isError = false) {
  els.toast.textContent = message;
  els.toast.dataset.state = isError ? "error" : "ok";
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 3200);
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function clampInt(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
