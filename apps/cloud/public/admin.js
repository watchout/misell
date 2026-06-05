(function () {
  const state = {
    devices: [],
    summary: null
  };

  const STATUS_LABELS = {
    online: "正常",
    degraded: "注意",
    offline: "未接続",
    critical: "至急対応",
    maintenance: "メンテナンス中",
    retired: "退役済み",
    lost: "紛失"
  };

  const ALERT_LABELS = {
    warning: "注意",
    critical: "重大"
  };

  const els = {
    summary: document.getElementById("summary"),
    devices: document.getElementById("devices"),
    alerts: document.getElementById("alerts"),
    refresh: document.getElementById("refresh")
  };

  els.refresh.addEventListener("click", loadDashboard);
  loadDashboard();
  window.setInterval(loadDashboard, 30000);

  async function loadDashboard() {
    const [summary, devices, alerts] = await Promise.all([
      fetchJson("/api/admin/summary"),
      fetchJson("/api/admin/devices"),
      fetchJson("/api/admin/alerts")
    ]);
    state.summary = summary;
    state.devices = devices.devices || [];
    renderSummary(summary);
    renderDevices(state.devices);
    renderAlerts(alerts.alerts || []);
  }

  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} returned ${res.status}`);
    return res.json();
  }

  function renderSummary(summary) {
    const counts = summary.counts || {};
    const items = [
      ["online", STATUS_LABELS.online, counts.online || 0],
      ["degraded", STATUS_LABELS.degraded, counts.degraded || 0],
      ["offline", STATUS_LABELS.offline, counts.offline || 0],
      ["critical", STATUS_LABELS.critical, counts.critical || 0],
      ["maintenance", STATUS_LABELS.maintenance, counts.maintenance || 0]
    ];
    els.summary.innerHTML = items.map(([key, label, value]) => (
      `<section class="metric metric-${key}">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
      </section>`
    )).join("");
  }

  function renderDevices(devices) {
    if (devices.length === 0) {
      els.devices.innerHTML = `<p class="empty">端末はまだ登録されていません。</p>`;
      return;
    }

    els.devices.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>端末</th>
            <th>店舗</th>
            <th>最終受信</th>
            <th>App</th>
            <th>Release</th>
            <th>Playlist</th>
            <th>空き容量</th>
            <th>メモリ</th>
            <th>再生中</th>
          </tr>
        </thead>
        <tbody>
          ${devices.map(renderDeviceRow).join("")}
        </tbody>
      </table>
    `;
  }

  function renderDeviceRow(device) {
    const status = device.effective_status || device.status;
    return `
      <tr>
        <td><span class="pill pill-${escapeAttr(status)}">${escapeHtml(STATUS_LABELS[status] || status)}</span></td>
        <td>
          <a href="/admin/devices/${encodeURIComponent(device.device_id)}">${escapeHtml(device.device_id)}</a>
          <small>${escapeHtml(device.device_name || "")}</small>
        </td>
        <td>${escapeHtml(device.store_id || "")}<small>${escapeHtml(device.location_id || "")}</small></td>
        <td>${formatTime(device.last_seen)}</td>
        <td>${escapeHtml(device.app_version || "")}</td>
        <td>${escapeHtml(device.release_id || "")}<small>${escapeHtml(device.release_channel || "")}</small></td>
        <td>${escapeHtml(device.playlist_version || "")}</td>
        <td>${formatNumber(device.disk_free_mb)} MB</td>
        <td>${formatNumber(device.memory_used_percent)}%</td>
        <td>${escapeHtml(device.current_item_id || "")}</td>
      </tr>
    `;
  }

  function renderAlerts(alerts) {
    if (alerts.length === 0) {
      els.alerts.innerHTML = `<p class="empty">未対応アラートはありません。</p>`;
      return;
    }

    els.alerts.innerHTML = alerts.map((alert) => `
      <article class="alert alert-${escapeAttr(alert.severity)}">
        <strong>${escapeHtml(ALERT_LABELS[alert.severity] || alert.severity)} / ${escapeHtml(alert.alert_type)}</strong>
        <span>${escapeHtml(alert.device_id)} ${escapeHtml(alert.message)}</span>
        <small>最終検知 ${formatTime(alert.last_seen)}</small>
      </article>
    `).join("");
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ja-JP");
  }

  function formatNumber(value) {
    return value === null || value === undefined ? "" : String(value);
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
