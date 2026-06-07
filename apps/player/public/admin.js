const ADMIN = {
  playlist: { version: 1, items: [] },
  assets: [],
  validationErrors: [],
  lastPromo: null
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

const assetListEl = document.getElementById("asset-list");
const assetCountEl = document.getElementById("asset-count");
const uploadForm = document.getElementById("upload-form");
const assetInput = document.getElementById("asset-input");
const promoForm = document.getElementById("promo-form");
const promoProductAsset = document.getElementById("promo-product-asset");
const promoStoryboard = document.getElementById("promo-storyboard");
const replacePromoButton = document.getElementById("replace-promo");
const playlistEditor = document.getElementById("playlist-editor");
const validationErrorsEl = document.getElementById("validation-errors");
const jsonEditor = document.getElementById("json-editor");
const toastEl = document.getElementById("toast");

document.getElementById("save-playlist").addEventListener("click", savePlaylist);
document.getElementById("preview-playlist").addEventListener("click", previewPlaylist);
document.getElementById("backup-content").addEventListener("click", backupContent);
document.getElementById("reload-player").addEventListener("click", reloadPlayer);
document.getElementById("add-three-zone").addEventListener("click", () => addItem("three-zone"));
document.getElementById("add-wide").addEventListener("click", () => addItem("wide"));
document.getElementById("apply-json").addEventListener("click", applyJsonEditor);

uploadForm.addEventListener("submit", uploadAsset);
promoForm.addEventListener("submit", generatePromoCuts);
playlistEditor.addEventListener("input", handlePlaylistInput);
playlistEditor.addEventListener("change", handlePlaylistChange);
playlistEditor.addEventListener("click", handlePlaylistClick);
assetListEl.addEventListener("click", handleAssetClick);

window.addEventListener("load", initAdmin);

async function initAdmin() {
  try {
    await Promise.all([loadAssets(), loadPlaylist()]);
    renderAll();
  } catch (error) {
    showToast(error.message, true);
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

function renderAll() {
  renderAssets();
  renderPromoAssetOptions();
  renderPromoStoryboard();
  renderValidationErrors();
  renderPlaylist();
  renderJson();
}

function renderValidationErrors() {
  if (!ADMIN.validationErrors.length) {
    validationErrorsEl.hidden = true;
    validationErrorsEl.replaceChildren();
    return;
  }

  validationErrorsEl.hidden = false;
  validationErrorsEl.innerHTML = `
    <strong>Validation errors</strong>
    <ul>
      ${ADMIN.validationErrors.map((error) => `<li>${escapeHtml(error)}</li>`).join("")}
    </ul>
  `;
}

function renderAssets() {
  assetCountEl.textContent = String(ADMIN.assets.length);

  if (ADMIN.assets.length === 0) {
    assetListEl.innerHTML = `
      <tr>
        <td colspan="4" class="empty-cell">素材はまだありません</td>
      </tr>
    `;
    return;
  }

  assetListEl.innerHTML = ADMIN.assets.map((asset) => `
    <tr>
      <td>${renderAssetThumb(asset)}</td>
      <td>
        <code>${escapeHtml(asset.path)}</code>
        <div class="muted">${escapeHtml(asset.name)}</div>
      </td>
      <td>${formatBytes(asset.size)}</td>
      <td class="table-actions">
        <button class="button tiny secondary" type="button" data-copy-path="${escapeAttr(asset.path)}">コピー</button>
        <button class="button tiny danger" type="button" data-delete-asset="${escapeAttr(asset.path)}">削除</button>
      </td>
    </tr>
  `).join("");
}

function renderAssetThumb(asset) {
  if (asset.type === "image") {
    return `<img class="asset-thumb" src="${escapeAttr(asset.path)}" alt="">`;
  }
  return `<video class="asset-thumb" src="${escapeAttr(asset.path)}" muted playsinline preload="metadata"></video>`;
}

function renderPromoAssetOptions() {
  const currentValue = promoProductAsset.value;
  const options = [
    ["/demo/wide.html", "Demo wide"],
    ["/demo/left.html", "Demo left"],
    ["/demo/center.html", "Demo center"],
    ["/demo/right.html", "Demo right"],
    ...ADMIN.assets.map((asset) => [asset.path, asset.path])
  ];
  promoProductAsset.innerHTML = options.map(([value, label]) => (
    `<option value="${escapeAttr(value)}"${value === currentValue ? " selected" : ""}>${escapeHtml(label)}</option>`
  )).join("");
  if (currentValue && options.some(([value]) => value === currentValue)) {
    promoProductAsset.value = currentValue;
  }
}

function renderPromoStoryboard() {
  const promo = ADMIN.lastPromo;
  if (!promo) {
    promoStoryboard.hidden = true;
    promoStoryboard.replaceChildren();
    replacePromoButton.disabled = true;
    return;
  }

  replacePromoButton.disabled = false;
  promoStoryboard.hidden = false;
  promoStoryboard.innerHTML = `
    <h3>${escapeHtml(promo.product_name)} / ${escapeHtml(promo.pattern)}</h3>
    <ul class="promo-cut-list">
      ${(promo.storyboard || []).map((cut) => `
        <li>
          <strong>${escapeHtml(cut.name || cut.item_id)}</strong>
          <span>${escapeHtml(cut.layout)} / ${escapeHtml(cut.duration)}秒 / ${escapeHtml(screenSummary(cut.screens))}</span>
        </li>
      `).join("")}
    </ul>
  `;
}

function renderPlaylist() {
  if (!ADMIN.playlist.items?.length) {
    playlistEditor.innerHTML = `<div class="empty-editor">playlist item がありません</div>`;
    return;
  }

  playlistEditor.innerHTML = ADMIN.playlist.items.map((item, index) => `
    <article class="playlist-item" data-index="${index}">
      <header class="playlist-item-header">
        <div class="item-title">
          <input class="check-input" type="checkbox" data-field="enabled" ${item.enabled !== false ? "checked" : ""} aria-label="enabled">
          <input class="name-input" type="text" data-field="name" value="${escapeAttr(item.name || "")}" aria-label="name">
        </div>
        <div class="item-actions">
          <button class="icon-button" type="button" data-move="up" title="上へ">↑</button>
          <button class="icon-button" type="button" data-move="down" title="下へ">↓</button>
          <button class="button tiny secondary" type="button" data-duplicate>複製</button>
          <button class="button tiny danger" type="button" data-delete>削除</button>
        </div>
      </header>

      <div class="item-grid">
        <label>
          <span>レイアウト</span>
          <select data-field="layout">
            <option value="three-zone" ${item.layout !== "wide" ? "selected" : ""}>three-zone</option>
            <option value="wide" ${item.layout === "wide" ? "selected" : ""}>wide</option>
          </select>
        </label>
        <label>
          <span>表示秒数</span>
          <input type="number" min="1" max="300" data-field="duration" value="${escapeAttr(item.duration || 10)}">
        </label>
        <label>
          <span>開始時刻</span>
          <input type="time" data-field="start" value="${escapeAttr(item.start || "")}">
        </label>
        <label>
          <span>終了時刻</span>
          <input type="time" data-field="end" value="${escapeAttr(item.end || "")}">
        </label>
      </div>

      ${renderDayControls(item)}
      ${renderSourceControls(item, index)}
      ${renderMiniPreview(item)}
    </article>
  `).join("");
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

function renderSourceControls(item, index) {
  const fields = item.layout === "wide" ? ["wide"] : ["left", "center", "right"];
  return `
    <div class="source-grid">
      ${fields.map((field) => `
        <label>
          <span>${field}</span>
          <input type="text" data-field="${field}" value="${escapeAttr(item[field] || "")}" placeholder="/assets/images/example.jpg, /demo/left.html, or /generated/promos/...html">
          <select data-source-picker="${field}">
            <option value="">素材から選択</option>
            ${demoOptions(field)}
            ${ADMIN.assets.map((asset) => `<option value="${escapeAttr(asset.path)}">${escapeHtml(asset.path)}</option>`).join("")}
          </select>
        </label>
      `).join("")}
    </div>
  `;
}

function demoOptions(field) {
  const options = [
    ["/demo/left.html", "Demo left"],
    ["/demo/center.html", "Demo center"],
    ["/demo/right.html", "Demo right"],
    ["/demo/wide.html", "Demo wide"]
  ];

  return options
    .filter(([value]) => field === "wide" ? value.includes("wide") : !value.includes("wide"))
    .map(([value, label]) => `<option value="${value}">${label}</option>`)
    .join("");
}

function renderMiniPreview(item) {
  const fields = item.layout === "wide" ? ["wide"] : ["left", "center", "right"];
  return `
    <div class="mini-preview ${item.layout === "wide" ? "mini-wide" : ""}">
      ${fields.map((field) => `<div>${sourceLabel(item[field], field)}</div>`).join("")}
    </div>
  `;
}

function sourceLabel(source, fallback) {
  const value = source || fallback;
  const file = value.split("/").filter(Boolean).pop() || value;
  return escapeHtml(file);
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

function renderJson() {
  jsonEditor.value = JSON.stringify(ADMIN.playlist, null, 2);
}

function handlePlaylistInput(event) {
  const target = event.target;
  if (!target.matches("[data-field]")) return;
  const item = getItemFromTarget(target);
  if (!item) return;

  const field = target.dataset.field;
  if (target.type === "checkbox") {
    item[field] = target.checked;
  } else if (target.type === "number") {
    item[field] = clampInt(Number.parseInt(target.value, 10) || 1, 1, 300);
  } else {
    item[field] = target.value;
  }
  ADMIN.validationErrors = [];
  renderValidationErrors();
  renderJson();
}

function handlePlaylistChange(event) {
  const target = event.target;

  if (target.matches("[data-day]")) {
    const item = getItemFromTarget(target);
    if (!item) return;
    const day = target.dataset.day;
    const selected = new Set(Array.isArray(item.days_of_week) ? item.days_of_week : []);
    if (target.checked) {
      selected.add(day);
    } else {
      selected.delete(day);
    }
    item.days_of_week = DAY_OPTIONS.map(([value]) => value).filter((value) => selected.has(value));
    renderJson();
    return;
  }

  if (target.matches("[data-field]")) {
    handlePlaylistInput(event);
    if (target.dataset.field === "layout") {
      renderPlaylist();
      renderJson();
    }
    return;
  }

  if (target.matches("[data-source-picker]") && target.value) {
    const item = getItemFromTarget(target);
    if (!item) return;
    item[target.dataset.sourcePicker] = target.value;
    renderPlaylist();
    renderJson();
  }
}

function handlePlaylistClick(event) {
  const target = event.target;
  const itemEl = target.closest(".playlist-item");
  if (!itemEl) return;
  const index = Number(itemEl.dataset.index);

  if (target.matches("[data-delete]")) {
    ADMIN.playlist.items.splice(index, 1);
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
    renderAll();
    return;
  }

  if (target.matches("[data-move]")) {
    const direction = target.dataset.move === "up" ? -1 : 1;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= ADMIN.playlist.items.length) return;
    const [item] = ADMIN.playlist.items.splice(index, 1);
    ADMIN.playlist.items.splice(nextIndex, 0, item);
    renderAll();
  }
}

async function handleAssetClick(event) {
  const copyPath = event.target.dataset.copyPath;
  const deletePath = event.target.dataset.deleteAsset;

  if (copyPath) {
    await navigator.clipboard?.writeText(copyPath);
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
      showToast(await errorMessage(response), true);
      return;
    }
    await loadAssets();
    renderAll();
    showToast("素材を削除しました。削除前バックアップを作成済みです。");
  }
}

async function uploadAsset(event) {
  event.preventDefault();
  const file = assetInput.files?.[0];
  if (!file) {
    showToast("アップロードするファイルを選んでください", true);
    return;
  }

  const formData = new FormData();
  formData.append("asset", file);
  const response = await fetch("/api/assets/upload", { method: "POST", body: formData });

  if (!response.ok) {
    showToast(await errorMessage(response), true);
    return;
  }

  assetInput.value = "";
  await loadAssets();
  renderAll();
  showToast("素材をアップロードしました。バックアップも作成済みです。");
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

  button.disabled = true;
  const buttonLabel = button.textContent;
  button.textContent = "生成中";
  try {
    const response = await fetch("/api/promo-campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      showToast(await errorMessage(response), true);
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
    ADMIN.validationErrors = [];
    renderAll();
    const actionLabel = isReplace ? "置換" : "追加";
    showToast(`${items.length}件のPRカットをplaylistへ${actionLabel}しました`);
  } catch (error) {
    showToast(error.message || "PRカットの生成に失敗しました", true);
  } finally {
    button.disabled = false;
    button.textContent = buttonLabel;
    renderPromoStoryboard();
  }
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
    renderAll();
    showToast(`playlistを保存しました: ${ADMIN.playlist.playlist_version}`);
  } catch (error) {
    showToast(error.message, true);
  }
}

async function previewPlaylist() {
  try {
    normalizePlaylistForSave({ preview: true });
    localStorage.setItem("misell_preview_playlist", JSON.stringify(ADMIN.playlist));
    window.open("/player?preview=1&local_preview=1", "_blank", "noopener,noreferrer");
    showToast("未保存playlistをプレビューへ送信しました");
  } catch (error) {
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
    showToast(await errorMessage(response), true);
    return;
  }
  const payload = await response.json();
  showToast(`バックアップを作成しました: ${payload.backup?.name || ""}`);
}

async function reloadPlayer() {
  const response = await fetch("/api/reload", { method: "POST" });
  showToast(response.ok ? "プレイヤーへ再読み込みを送信しました" : await errorMessage(response), !response.ok);
}

function addItem(layout) {
  const id = `item-${Date.now()}`;
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
  renderAll();
}

function applyJsonEditor() {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    if (!Array.isArray(parsed.items)) throw new Error("items array is required");
    ADMIN.playlist = parsed;
    ADMIN.validationErrors = [];
    renderAll();
    showToast("JSONを反映しました。保存ボタンで確定します。");
  } catch (error) {
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
      duration: clampInt(Number.parseInt(item.duration, 10) || 10, 1, 300),
      days_of_week: Array.isArray(item.days_of_week)
        ? DAY_OPTIONS.map(([value]) => value).filter((value) => item.days_of_week.includes(value))
        : []
    };
  });
  renderJson();
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

function getItemFromTarget(target) {
  const itemEl = target.closest(".playlist-item");
  if (!itemEl) return null;
  return ADMIN.playlist.items[Number(itemEl.dataset.index)];
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
  renderValidationErrors();
  showToast(ADMIN.validationErrors[0], true);
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.dataset.state = isError ? "error" : "ok";
  toastEl.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toastEl.classList.remove("show"), 3200);
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
