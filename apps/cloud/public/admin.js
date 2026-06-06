(function () {
  const state = {
    devices: [],
    summary: null,
    releaseManifests: [],
    contentManifests: [],
    issuedToken: null
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

  const ADMIN_STATUS_OPTIONS = [
    ["offline", "監視復帰"],
    ["maintenance", "メンテ"],
    ["retired", "退役"],
    ["lost", "紛失"]
  ];

  const RELEASE_CHANNEL_OPTIONS = [
    ["", "維持"],
    ["dev", "dev"],
    ["staging", "staging"],
    ["canary", "canary"],
    ["stable", "stable"],
    ["hold", "hold"]
  ];

  const RELEASE_MANIFEST_CHANNEL_OPTIONS = [
    ["stable", "stable"],
    ["canary", "canary"],
    ["staging", "staging"],
    ["dev", "dev"]
  ];

  const RELEASE_MANIFEST_STATUS_OPTIONS = [
    ["draft", "draft"],
    ["active", "active"],
    ["retired", "retired"]
  ];

  const UPDATE_STATUS_LABELS = {
    idle: "待機",
    pending: "予約済み",
    checking: "確認中",
    updating: "更新中",
    success: "完了",
    failed: "失敗"
  };

  const els = {
    summary: document.getElementById("summary"),
    devices: document.getElementById("devices"),
    alerts: document.getElementById("alerts"),
    notifications: document.getElementById("notifications"),
    releaseManifests: document.getElementById("release-manifests"),
    contentManifests: document.getElementById("content-manifests"),
    logBundles: document.getElementById("log-bundles"),
    tokenResult: document.getElementById("token-result"),
    refresh: document.getElementById("refresh")
  };

  els.refresh.addEventListener("click", loadDashboard);
  loadDashboard();
  window.setInterval(loadDashboard, 30000);

  async function loadDashboard() {
    const [summary, devices, alerts, notifications, releaseManifests, contentManifests, logBundles] = await Promise.all([
      fetchJson("/api/admin/summary"),
      fetchJson("/api/admin/devices"),
      fetchJson("/api/admin/alerts"),
      fetchJson("/api/admin/alert-notifications"),
      fetchJson("/api/admin/release-manifests"),
      fetchJson("/api/admin/content-manifests"),
      fetchJson("/api/admin/device-log-bundles")
    ]);
    state.summary = summary;
    state.devices = devices.devices || [];
    state.releaseManifests = releaseManifests.release_manifests || [];
    state.contentManifests = contentManifests.content_manifests || [];
    renderSummary(summary);
    renderDevices(state.devices);
    renderAlerts(alerts.alerts || []);
    renderNotifications(notifications);
    renderReleaseManifests(state.releaseManifests);
    renderContentManifests(state.contentManifests);
    renderLogBundles(logBundles.log_bundles || []);
    renderTokenResult();
  }

  async function fetchJson(url, options = {}) {
    const res = await fetch(url, options);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `${url} returned ${res.status}`);
    }
    return res.json();
  }

  function renderSummary(summary) {
    const counts = summary.counts || {};
    const items = [
      ["online", STATUS_LABELS.online, counts.online || 0],
      ["degraded", STATUS_LABELS.degraded, counts.degraded || 0],
      ["offline", STATUS_LABELS.offline, counts.offline || 0],
      ["critical", STATUS_LABELS.critical, counts.critical || 0],
      ["maintenance", STATUS_LABELS.maintenance, counts.maintenance || 0],
      ["retired", STATUS_LABELS.retired, counts.retired || 0],
      ["lost", STATUS_LABELS.lost, counts.lost || 0]
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
            <th>Token</th>
            <th>Playlist</th>
            <th>空き容量</th>
            <th>メモリ</th>
            <th>再生中</th>
            <th>更新</th>
            <th>運用</th>
          </tr>
        </thead>
        <tbody>
          ${devices.map(renderDeviceRow).join("")}
        </tbody>
      </table>
    `;
    els.devices.querySelectorAll(".device-action").forEach((form) => {
      form.addEventListener("submit", handleDeviceUpdate);
    });
    els.devices.querySelectorAll(".update-action").forEach((form) => {
      form.addEventListener("submit", handleUpdateRequest);
    });
    els.devices.querySelectorAll(".token-action").forEach((form) => {
      form.addEventListener("submit", handleTokenAction);
    });
  }

  function renderDeviceRow(device) {
    const status = device.effective_status || device.status;
    const selectedStatus = ADMIN_STATUS_OPTIONS.some(([value]) => value === device.status) ? device.status : "offline";
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
        <td>${renderTokenCell(device)}</td>
        <td>${escapeHtml(device.playlist_version || "")}</td>
        <td>${formatNumber(device.disk_free_mb)} MB</td>
        <td>${formatNumber(device.memory_used_percent)}%</td>
        <td>${escapeHtml(device.current_item_id || "")}</td>
        <td>
          <form class="update-action" data-device-id="${escapeHtml(device.device_id)}">
            <span class="update-status update-status-${escapeAttr(device.update_status || "idle")}">
              ${escapeHtml(UPDATE_STATUS_LABELS[device.update_status] || device.update_status || "待機")}
            </span>
            ${device.update_manifest_id ? `<small>manifest ${escapeHtml(device.update_manifest_id)}</small>` : ""}
            <input name="target_update_ref" type="text" value="${escapeHtml(device.target_update_ref || "")}" placeholder="Git ref" aria-label="Git ref">
            <input name="target_release_id" type="text" value="${escapeHtml(device.target_release_id || "")}" placeholder="Release ID" aria-label="Release ID">
            <select name="target_release_channel" aria-label="Release channel">
              ${RELEASE_CHANNEL_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === (device.target_release_channel || "") ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <button type="submit" name="action" value="schedule">予約</button>
            <button type="submit" name="action" value="clear">解除</button>
            <small>${escapeHtml(device.update_error || "")}</small>
          </form>
        </td>
        <td>
          <form class="device-action" data-device-id="${escapeHtml(device.device_id)}">
            <select name="status" aria-label="端末ステータス">
              ${ADMIN_STATUS_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === selectedStatus ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <input name="notes" type="text" value="${escapeHtml(device.notes || "")}" placeholder="運用メモ" aria-label="運用メモ">
            <button type="submit">保存</button>
          </form>
        </td>
      </tr>
    `;
  }

  function renderTokenCell(device) {
    const tokenStatus = device.token_status || "active";
    const tokenStatusLabel = tokenStatus === "revoked" ? "失効済み" : "有効";
    const tokenStatusClass = tokenStatus === "revoked" ? "failed" : "success";
    return `
      <form class="token-action" data-device-id="${escapeHtml(device.device_id)}">
        <span class="update-status update-status-${tokenStatusClass}">${escapeHtml(tokenStatusLabel)}</span>
        <small>世代 ${escapeHtml(device.token_generation || 1)} / 最終使用 ${formatTime(device.token_last_used_at)}</small>
        <input name="reason" type="text" value="" placeholder="理由" aria-label="トークン操作理由">
        <button type="submit" name="action" value="rotate">再発行</button>
        <button class="danger" type="submit" name="action" value="revoke"${tokenStatus === "revoked" ? " disabled" : ""}>失効</button>
        ${device.token_revoked_reason ? `<small>${escapeHtml(device.token_revoked_reason)}</small>` : ""}
      </form>
    `;
  }

  async function handleDeviceUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const deviceId = form.dataset.deviceId;
    const payload = {
      status: form.elements.status.value,
      notes: form.elements.notes.value
    };

    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/devices/${encodeURIComponent(deviceId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "保存に失敗しました。");
      button.disabled = false;
      button.textContent = "保存";
    }
  }

  async function handleUpdateRequest(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter || form.querySelector("button");
    const buttons = form.querySelectorAll("button");
    const deviceId = form.dataset.deviceId;
    const clearTarget = submitter?.value === "clear";
    const payload = {
      target_update_ref: clearTarget ? "" : form.elements.target_update_ref.value,
      target_release_id: clearTarget ? "" : form.elements.target_release_id.value,
      target_release_channel: clearTarget ? "" : form.elements.target_release_channel.value
    };

    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      await fetchJson(`/api/admin/devices/${encodeURIComponent(deviceId)}/update`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "更新予約に失敗しました。");
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
  }

  async function handleTokenAction(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter || form.querySelector("button");
    const buttons = form.querySelectorAll("button");
    const deviceId = form.dataset.deviceId;
    const action = submitter?.value === "revoke" ? "revoke" : "rotate";
    const reason = form.elements.reason.value;
    const confirmed = window.confirm(
      action === "rotate"
        ? `${deviceId} の端末トークンを再発行します。旧トークンは使えなくなります。`
        : `${deviceId} の端末トークンを失効します。端末からの通信は停止します。`
    );
    if (!confirmed) return;

    buttons.forEach((button) => {
      button.disabled = true;
    });
    try {
      const result = await fetchJson(`/api/admin/devices/${encodeURIComponent(deviceId)}/token/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      if (result.device_token) {
        state.issuedToken = {
          device_id: deviceId,
          token: result.device_token,
          issued_at: new Date().toISOString()
        };
      }
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "トークン操作に失敗しました。");
      buttons.forEach((button) => {
        button.disabled = false;
      });
    }
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
        <small>通知 ${escapeHtml(alert.last_notification_status || "未送信")} ${formatTime(alert.last_notification_delivered_at || alert.last_notification_attempted_at)}</small>
      </article>
    `).join("");
  }

  function renderNotifications(data) {
    const config = data.config || {};
    const notifications = data.notifications || [];
    els.notifications.innerHTML = `
      <div class="notification-bar">
        <span class="update-status update-status-${config.webhook_enabled ? "success" : "idle"}">
          ${config.webhook_enabled ? "Webhook有効" : "Webhook未設定"}
        </span>
        <span>最小 ${escapeHtml(config.min_severity || "warning")}</span>
        <span>解決通知 ${config.notify_resolved ? "on" : "off"}</span>
        <button id="test-notification" type="button"${config.webhook_enabled ? "" : " disabled"}>テスト送信</button>
      </div>
      ${notifications.length === 0 ? `<p class="empty">通知履歴はありません。</p>` : `
        <table class="notifications-table">
          <thead>
            <tr>
              <th>時刻</th>
              <th>Event</th>
              <th>Status</th>
              <th>端末</th>
              <th>Alert</th>
            </tr>
          </thead>
          <tbody>
            ${notifications.slice(0, 20).map((notification) => `
              <tr>
                <td>${formatTime(notification.created_at)}</td>
                <td>${escapeHtml(notification.event || "")}</td>
                <td>${escapeHtml(notification.status || "")}<small>${escapeHtml(notification.error || "")}</small></td>
                <td>${escapeHtml(notification.device_id || "")}</td>
                <td>${escapeHtml(notification.alert_type || "")}<small>${escapeHtml(notification.severity || "")}</small></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      `}
    `;
    const testButton = document.getElementById("test-notification");
    if (testButton) {
      testButton.addEventListener("click", handleNotificationTest);
    }
  }

  function renderReleaseManifests(releaseManifests) {
    if (!els.releaseManifests) return;
    els.releaseManifests.innerHTML = `
      <form class="release-manifest-create">
        <input name="manifest_id" type="text" placeholder="Manifest ID" aria-label="Manifest ID">
        <input name="release_id" type="text" placeholder="Release ID" aria-label="Release ID" required>
        <input name="update_ref" type="text" placeholder="Git ref" aria-label="Git ref" required>
        <select name="release_channel" aria-label="Release channel">
          ${RELEASE_MANIFEST_CHANNEL_OPTIONS.map(([value, label]) => (
            `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`
          )).join("")}
        </select>
        <select name="status" aria-label="Manifest status">
          ${RELEASE_MANIFEST_STATUS_OPTIONS.map(([value, label]) => (
            `<option value="${escapeAttr(value)}"${value === "active" ? " selected" : ""}>${escapeHtml(label)}</option>`
          )).join("")}
        </select>
        <input name="app_version" type="text" placeholder="App version" aria-label="App version">
        <input name="notes" type="text" placeholder="Notes" aria-label="Notes">
        <button type="submit">作成</button>
      </form>
      ${releaseManifests.length === 0 ? `<p class="empty">release manifestはまだありません。</p>` : `
        <table class="release-manifests-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Channel</th>
              <th>Manifest</th>
              <th>Release</th>
              <th>Git ref</th>
              <th>Version</th>
              <th>Published</th>
              <th>運用</th>
            </tr>
          </thead>
          <tbody>
            ${releaseManifests.slice(0, 30).map(renderReleaseManifestRow).join("")}
          </tbody>
        </table>
      `}
    `;

    els.releaseManifests.querySelector(".release-manifest-create")?.addEventListener("submit", handleReleaseManifestCreate);
    els.releaseManifests.querySelectorAll(".release-manifest-action").forEach((form) => {
      form.addEventListener("submit", handleReleaseManifestUpdate);
    });
  }

  function renderReleaseManifestRow(manifest) {
    return `
      <tr>
        <td>
          <span class="update-status update-status-${escapeAttr(releaseManifestStatusClass(manifest.status))}">
            ${escapeHtml(manifest.status || "")}
          </span>
        </td>
        <td>${escapeHtml(manifest.release_channel || "")}</td>
        <td>${escapeHtml(manifest.manifest_id || "")}<small>${escapeHtml(manifest.notes || "")}</small></td>
        <td>${escapeHtml(manifest.release_id || "")}</td>
        <td>${escapeHtml(manifest.update_ref || "")}</td>
        <td>${escapeHtml(manifest.app_version || "")}</td>
        <td>${formatTime(manifest.published_at || manifest.updated_at)}</td>
        <td>
          <form class="release-manifest-action" data-manifest-id="${escapeHtml(manifest.manifest_id || "")}">
            <select name="status" aria-label="Manifest status">
              ${RELEASE_MANIFEST_STATUS_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === manifest.status ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <button type="submit">保存</button>
          </form>
        </td>
      </tr>
    `;
  }

  async function handleReleaseManifestCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const payload = {
      manifest_id: form.elements.manifest_id.value,
      release_id: form.elements.release_id.value,
      update_ref: form.elements.update_ref.value,
      release_channel: form.elements.release_channel.value,
      status: form.elements.status.value,
      app_version: form.elements.app_version.value,
      notes: form.elements.notes.value
    };

    button.disabled = true;
    button.textContent = "作成中";
    try {
      await fetchJson("/api/admin/release-manifests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "release manifestの作成に失敗しました。");
      button.disabled = false;
      button.textContent = "作成";
    }
  }

  async function handleReleaseManifestUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const manifestId = form.dataset.manifestId;
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/release-manifests/${encodeURIComponent(manifestId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: form.elements.status.value })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "release manifestの保存に失敗しました。");
      button.disabled = false;
      button.textContent = "保存";
    }
  }

  function renderContentManifests(contentManifests) {
    if (!els.contentManifests) return;
    els.contentManifests.innerHTML = `
      <form class="content-manifest-create">
        <div class="content-manifest-grid">
          <input name="content_id" type="text" placeholder="Content ID" aria-label="Content ID">
          <input name="playlist_version" type="text" value="${escapeAttr(nextPlaylistVersion())}" placeholder="Playlist version" aria-label="Playlist version" required>
          <input name="title" type="text" placeholder="Title" aria-label="Title">
          <select name="release_channel" aria-label="Release channel">
            ${RELEASE_MANIFEST_CHANNEL_OPTIONS.map(([value, label]) => (
              `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`
            )).join("")}
          </select>
          <select name="status" aria-label="Manifest status">
            ${RELEASE_MANIFEST_STATUS_OPTIONS.map(([value, label]) => (
              `<option value="${escapeAttr(value)}"${value === "draft" ? " selected" : ""}>${escapeHtml(label)}</option>`
            )).join("")}
          </select>
          <input name="notes" type="text" placeholder="Notes" aria-label="Notes">
          <button type="submit">作成</button>
        </div>
        <textarea name="playlist_json" spellcheck="false" aria-label="Playlist JSON">${escapeHtml(JSON.stringify(defaultPlaylistTemplate(), null, 2))}</textarea>
      </form>
      ${contentManifests.length === 0 ? `<p class="empty">content manifestはまだありません。</p>` : `
        <table class="content-manifests-table">
          <thead>
            <tr>
              <th>Status</th>
              <th>Channel</th>
              <th>Content</th>
              <th>Playlist</th>
              <th>Items</th>
              <th>Published</th>
              <th>運用</th>
            </tr>
          </thead>
          <tbody>
            ${contentManifests.slice(0, 30).map(renderContentManifestRow).join("")}
          </tbody>
        </table>
      `}
    `;

    els.contentManifests.querySelector(".content-manifest-create")?.addEventListener("submit", handleContentManifestCreate);
    els.contentManifests.querySelectorAll(".content-manifest-action").forEach((form) => {
      form.addEventListener("submit", handleContentManifestUpdate);
    });
  }

  function renderContentManifestRow(manifest) {
    const itemCount = Array.isArray(manifest.playlist?.items) ? manifest.playlist.items.length : "";
    return `
      <tr>
        <td>
          <span class="update-status update-status-${escapeAttr(releaseManifestStatusClass(manifest.status))}">
            ${escapeHtml(manifest.status || "")}
          </span>
        </td>
        <td>${escapeHtml(manifest.release_channel || "")}</td>
        <td>${escapeHtml(manifest.content_id || "")}<small>${escapeHtml(manifest.title || manifest.notes || "")}</small></td>
        <td>${escapeHtml(manifest.playlist_version || "")}</td>
        <td>${formatNumber(itemCount)}</td>
        <td>${formatTime(manifest.published_at || manifest.updated_at)}</td>
        <td>
          <form class="content-manifest-action" data-content-id="${escapeHtml(manifest.content_id || "")}">
            <select name="status" aria-label="Manifest status">
              ${RELEASE_MANIFEST_STATUS_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === manifest.status ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <button type="submit">保存</button>
          </form>
        </td>
      </tr>
    `;
  }

  async function handleContentManifestCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");

    button.disabled = true;
    button.textContent = "作成中";
    try {
      const payload = {
        content_id: form.elements.content_id.value,
        playlist_version: form.elements.playlist_version.value,
        title: form.elements.title.value,
        release_channel: form.elements.release_channel.value,
        status: form.elements.status.value,
        notes: form.elements.notes.value,
        playlist: JSON.parse(form.elements.playlist_json.value)
      };
      await fetchJson("/api/admin/content-manifests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "content manifestの作成に失敗しました。");
      button.disabled = false;
      button.textContent = "作成";
    }
  }

  async function handleContentManifestUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const contentId = form.dataset.contentId;
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/content-manifests/${encodeURIComponent(contentId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: form.elements.status.value })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "content manifestの保存に失敗しました。");
      button.disabled = false;
      button.textContent = "保存";
    }
  }

  function renderLogBundles(logBundles) {
    if (!els.logBundles) return;
    if (logBundles.length === 0) {
      els.logBundles.innerHTML = `<p class="empty">収集済みログはありません。</p>`;
      return;
    }

    els.logBundles.innerHTML = `
      <table class="log-bundles-table">
        <thead>
          <tr>
            <th>受信</th>
            <th>端末</th>
            <th>内容</th>
            <th>件数</th>
            <th>Version</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          ${logBundles.slice(0, 20).map((bundle) => `
            <tr>
              <td>${formatTime(bundle.received_at)}<small>${formatTime(bundle.captured_at)}</small></td>
              <td>${escapeHtml(bundle.device_id || "")}<small>${escapeHtml(bundle.hostname || "")}</small></td>
              <td>${escapeHtml(bundle.label || "")}<small>${escapeHtml(bundle.reason || "")}</small></td>
              <td>${formatNumber(bundle.entry_count)}<small>${formatBytes(bundle.total_bytes)}</small></td>
              <td>${escapeHtml(bundle.release_id || "")}<small>${escapeHtml(bundle.release_channel || "")}</small></td>
              <td><a href="/api/admin/device-log-bundles/${encodeURIComponent(bundle.id)}">JSON</a></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderTokenResult() {
    if (!els.tokenResult) return;
    if (!state.issuedToken) {
      els.tokenResult.hidden = true;
      els.tokenResult.innerHTML = "";
      return;
    }

    els.tokenResult.hidden = false;
    els.tokenResult.innerHTML = `
      <h2>発行済み端末トークン</h2>
      <div class="token-banner">
        <div>
          <strong>${escapeHtml(state.issuedToken.device_id)}</strong>
          <small>${formatTime(state.issuedToken.issued_at)}</small>
        </div>
        <input id="issued-token" class="token-value" type="text" readonly value="${escapeHtml(state.issuedToken.token)}" aria-label="発行済み端末トークン">
        <button id="copy-issued-token" type="button">コピー</button>
        <button id="clear-issued-token" class="secondary" type="button">閉じる</button>
      </div>
    `;

    const tokenInput = document.getElementById("issued-token");
    const copyButton = document.getElementById("copy-issued-token");
    const clearButton = document.getElementById("clear-issued-token");
    copyButton?.addEventListener("click", async () => {
      tokenInput?.select();
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(state.issuedToken.token).catch(() => {});
      }
    });
    clearButton?.addEventListener("click", () => {
      state.issuedToken = null;
      renderTokenResult();
    });
  }

  async function handleNotificationTest(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "送信中";
    try {
      await fetchJson("/api/admin/alert-notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "テスト送信に失敗しました。");
      button.disabled = false;
      button.textContent = "テスト送信";
    }
  }

  function defaultPlaylistTemplate() {
    return {
      version: 1,
      playlist_version: nextPlaylistVersion(),
      updatedAt: new Date().toISOString(),
      items: [
        {
          id: "demo-wide",
          item_id: "demo-wide",
          name: "ワイド デモ",
          enabled: true,
          layout: "wide",
          duration: 12,
          start: "",
          end: "",
          days_of_week: [],
          wide: "/demo/wide.html",
          left: "",
          center: "",
          right: ""
        }
      ]
    };
  }

  function nextPlaylistVersion(date = new Date()) {
    return `pl-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
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

  function formatBytes(value) {
    const bytes = Number(value || 0);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function releaseManifestStatusClass(status) {
    if (status === "active") return "success";
    if (status === "retired") return "idle";
    return "pending";
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
