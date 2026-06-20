const PLAYER = {
  config: null,
  playlist: { items: [] },
  activeItems: [],
  currentIndex: -1,
  currentItem: null,
  timerId: null,
  pollId: null
};

const ZONES = {
  left: document.getElementById("left-zone"),
  center: document.getElementById("center-zone"),
  right: document.getElementById("right-zone"),
  wide: document.getElementById("wide-zone")
};

const statusEl = document.getElementById("player-status");
const preloadBin = document.getElementById("preload-bin");
const PREVIEW_STAGE_WIDTH = 5760;
const PREVIEW_STAGE_HEIGHT = 1080;
const PREVIEW_PADDING = 48;

window.addEventListener("load", () => {
  startPlayer();
});

async function startPlayer() {
  setupPreviewMode();
  await loadConfig();
  await loadPlaylist({ reset: true });
  connectEvents();
  PLAYER.pollId = window.setInterval(() => loadPlaylist({ reset: false }), 30000);
  window.setInterval(updateStatusClock, 1000);
}

async function loadConfig() {
  try {
    const response = await fetch(`/api/config?ts=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`config HTTP ${response.status}`);
    PLAYER.config = await response.json();
  } catch (error) {
    PLAYER.config = null;
  }
}

function setupPreviewMode() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("preview") !== "1") return;
  document.body.classList.add("preview-mode");
  updatePreviewScale();
  window.addEventListener("resize", updatePreviewScale);
}

function updatePreviewScale() {
  const availableWidth = Math.max(1, window.innerWidth - PREVIEW_PADDING);
  const availableHeight = Math.max(1, window.innerHeight - PREVIEW_PADDING);
  const scale = Math.min(1, availableWidth / PREVIEW_STAGE_WIDTH, availableHeight / PREVIEW_STAGE_HEIGHT);
  document.documentElement.style.setProperty("--preview-scale", String(scale));
  document.documentElement.style.setProperty("--preview-frame-width", `${PREVIEW_STAGE_WIDTH * scale}px`);
  document.documentElement.style.setProperty("--preview-frame-height", `${PREVIEW_STAGE_HEIGHT * scale}px`);
}

async function loadPlaylist({ reset }) {
  try {
    const localPreview = loadLocalPreviewPlaylist();
    if (localPreview) {
      PLAYER.playlist = normalizePlaylist(localPreview);
    } else {
      const response = await fetch(`/api/playlist?ts=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`playlist HTTP ${response.status}`);

      const payload = await response.json();
      if (payload && payload.ok === false) {
        throw new Error((payload.errors || []).join("; ") || "playlist validation failed");
      }
      PLAYER.playlist = normalizePlaylist(payload?.playlist || payload);
    }
    PLAYER.activeItems = getActiveItems(PLAYER.playlist.items);

    if (reset || !PLAYER.currentItem || !PLAYER.activeItems.some((item) => item.id === PLAYER.currentItem.id)) {
      PLAYER.currentIndex = -1;
      showNextItem();
    }
  } catch (error) {
    showEmptyState(`playlistを読み込めません: ${error.message}`);
  }
}

function loadLocalPreviewPlaylist() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("local_preview") !== "1") return null;
  try {
    return JSON.parse(localStorage.getItem("misell_preview_playlist") || "");
  } catch {
    return null;
  }
}

function normalizePlaylist(playlist) {
  const items = Array.isArray(playlist) ? playlist : playlist?.items || [];
  return {
    ...playlist,
    playlist_version: playlist?.playlist_version || playlist?.version || "",
    items: items.map((item, index) => ({
      id: item.id || `item-${index + 1}`,
      item_id: item.item_id || item.id || `item-${index + 1}`,
      name: item.name || item.id || `Item ${index + 1}`,
      enabled: item.enabled !== false,
      layout: item.layout === "wide" ? "wide" : "three-zone",
      duration: clamp(Number.parseInt(item.duration, 10) || 10, 1, 300),
      start: item.start || "",
      end: item.end || "",
      days_of_week: normalizeDaysOfWeek(item.days_of_week),
      campaign_id: item.campaign_id || "",
      asset_id: item.asset_id || "",
      left: item.left || "",
      center: item.center || "",
      right: item.right || "",
      wide: item.wide || ""
    }))
  };
}

function getActiveItems(items) {
  return items.filter((item) => {
    if (!item.enabled) return false;
    if (!isInSchedule(item)) return false;
    if (item.layout === "wide") return Boolean(item.wide);
    return Boolean(item.left || item.center || item.right);
  });
}

function isInSchedule(item) {
  const now = new Date();
  if (Array.isArray(item.days_of_week) && item.days_of_week.length > 0) {
    const today = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][now.getDay()];
    if (!item.days_of_week.includes(today)) return false;
  }
  const start = parseScheduleValue(item.start, now);
  const end = parseScheduleValue(item.end, now);

  if (!start && !end) return true;
  if (start?.kind === "absolute" && now < start.date) return false;
  if (end?.kind === "absolute" && now > end.date) return false;

  const startMinutes = start?.kind === "daily" ? start.minutes : null;
  const endMinutes = end?.kind === "daily" ? end.minutes : null;
  if (startMinutes === null && endMinutes === null) return true;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (startMinutes !== null && endMinutes !== null) {
    if (startMinutes <= endMinutes) {
      return nowMinutes >= startMinutes && nowMinutes <= endMinutes;
    }
    return nowMinutes >= startMinutes || nowMinutes <= endMinutes;
  }
  if (startMinutes !== null) return nowMinutes >= startMinutes;
  return nowMinutes <= endMinutes;
}

function normalizeDaysOfWeek(value) {
  if (!Array.isArray(value)) return [];
  const allowed = new Set(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
  return value
    .map((day) => String(day || "").trim().toLowerCase())
    .filter((day, index, days) => allowed.has(day) && days.indexOf(day) === index);
}

function parseScheduleValue(value, now) {
  const text = String(value || "").trim();
  if (!text) return null;

  const dailyMatch = text.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (dailyMatch) {
    const hours = Number(dailyMatch[1]);
    const minutes = Number(dailyMatch[2]);
    if (hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59) {
      return { kind: "daily", minutes: hours * 60 + minutes };
    }
  }

  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return { kind: "absolute", date };
  }

  return null;
}

function showNextItem() {
  window.clearTimeout(PLAYER.timerId);
  PLAYER.activeItems = getActiveItems(PLAYER.playlist.items);

  if (PLAYER.activeItems.length === 0) {
    showEmptyState("現在表示できるplaylist itemがありません");
    PLAYER.timerId = window.setTimeout(showNextItem, 5000);
    return;
  }

  PLAYER.currentIndex = (PLAYER.currentIndex + 1) % PLAYER.activeItems.length;
  const item = PLAYER.activeItems[PLAYER.currentIndex];
  PLAYER.currentItem = item;

  renderItem(item);
  logPlayback(item, "started");
  preloadNextItem();
  PLAYER.timerId = window.setTimeout(showNextItem, item.duration * 1000);
}

function renderItem(item) {
  document.body.dataset.layout = item.layout;
  statusEl.dataset.state = "ok";

  if (item.layout === "wide") {
    ZONES.wide.hidden = false;
    ZONES.left.hidden = true;
    ZONES.center.hidden = true;
    ZONES.right.hidden = true;
    renderContent(ZONES.wide, item.wide, item, "wide");
  } else {
    ZONES.wide.hidden = true;
    ZONES.left.hidden = false;
    ZONES.center.hidden = false;
    ZONES.right.hidden = false;
    renderContent(ZONES.left, item.left, item, "left");
    renderContent(ZONES.center, item.center, item, "center");
    renderContent(ZONES.right, item.right, item, "right");
  }

  updateStatusClock();
}

function renderContent(container, source, item, zone) {
  container.replaceChildren();
  const src = String(source || "").trim();

  if (!src) {
    container.appendChild(createPlaceholder(`${zone} 未設定`, item.name));
    return;
  }

  const kind = detectSourceKind(src);
  let element;

  if (kind === "image") {
    element = document.createElement("img");
    element.src = src;
    element.alt = item.name;
    element.loading = "eager";
    element.decoding = "async";
  } else if (kind === "video") {
    element = document.createElement("video");
    element.src = src;
    element.autoplay = true;
    element.muted = true;
    element.loop = true;
    element.playsInline = true;
    element.preload = "auto";
    element.controls = false;
  } else {
    element = document.createElement("iframe");
    element.src = src;
    element.title = `${item.name} ${zone}`;
    element.loading = "eager";
    element.referrerPolicy = "no-referrer";
  }

  element.className = "media-fill";
  element.addEventListener("error", () => {
    container.replaceChildren(createPlaceholder("素材を表示できません", src));
    logPlayback(item, `error:${zone}`);
  });
  container.appendChild(element);
}

function createPlaceholder(title, detail) {
  const wrapper = document.createElement("div");
  wrapper.className = "missing-media";
  wrapper.innerHTML = `
    <p>${escapeHtml(title)}</p>
    <strong>${escapeHtml(detail || "misell-player")}</strong>
  `;
  return wrapper;
}

function showEmptyState(message) {
  document.body.dataset.layout = "empty";
  for (const zone of Object.values(ZONES)) {
    zone.hidden = true;
    zone.replaceChildren();
  }
  ZONES.wide.hidden = false;
  ZONES.wide.replaceChildren(createPlaceholder("待機中", message));
  statusEl.dataset.state = "warn";
  statusEl.textContent = message;
}

function preloadNextItem() {
  preloadBin.replaceChildren();
  if (PLAYER.activeItems.length < 2) return;

  const nextIndex = (PLAYER.currentIndex + 1) % PLAYER.activeItems.length;
  const nextItem = PLAYER.activeItems[nextIndex];
  const sources = nextItem.layout === "wide"
    ? [nextItem.wide]
    : [nextItem.left, nextItem.center, nextItem.right];

  for (const source of sources.filter(Boolean)) {
    const kind = detectSourceKind(source);
    if (kind !== "image" && kind !== "video") continue;

    const element = document.createElement(kind === "image" ? "img" : "video");
    element.src = source;
    if (kind === "video") {
      element.preload = "metadata";
      element.muted = true;
    }
    preloadBin.appendChild(element);
  }
}

function detectSourceKind(source) {
  const clean = String(source || "").split("?")[0].toLowerCase();
  if (/\.(jpg|jpeg|png|webp|gif)$/.test(clean)) return "image";
  if (/\.(mp4|webm|mov|m4v)$/.test(clean)) return "video";
  return "html";
}

function updateStatusClock() {
  if (!PLAYER.currentItem) return;
  const now = new Date();
  statusEl.textContent = `${now.toLocaleTimeString("ja-JP", { hour12: false })}  ${PLAYER.currentItem.name}  ${PLAYER.currentItem.layout}`;
}

function connectEvents() {
  if (!window.EventSource) return;

  const events = new EventSource("/api/events");
  events.addEventListener("reload", () => {
    loadPlaylist({ reset: true });
  });
  events.addEventListener("error", () => {
    statusEl.dataset.state = "warn";
  });
}

function logPlayback(item, result) {
  const timestamp = new Date().toISOString();
  const playbackId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const assetPaths = item.layout === "wide"
    ? [item.wide].filter(Boolean)
    : [item.left, item.center, item.right].filter(Boolean);
  const payload = {
    event_id: `play-${playbackId}`,
    event_type: "playback",
    timestamp,
    playback_id: playbackId,
    playlist_version: PLAYER.playlist.playlist_version || PLAYER.playlist.version || "",
    playlist_item_id: item.item_id || item.id,
    item_id: item.item_id || item.id,
    itemId: item.id,
    itemName: item.name,
    campaign_id: item.campaign_id || "",
    asset_id: item.asset_id || "",
    layout: item.layout,
    asset_paths: assetPaths,
    asset: assetPaths.join(","),
    duration: item.duration,
    result
  };

  const body = JSON.stringify(payload);
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/log/play", new Blob([body], { type: "application/json" }));
    return;
  }

  fetch("/api/log/play", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true
  }).catch(() => {});
}

function clamp(value, min, max) {
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
