(function () {
  const state = {
    devices: [],
    deviceCommands: [],
    summary: null,
    assets: [],
    releaseManifests: [],
    contentManifests: [],
    contentRollout: null,
    storeSettings: [],
    counterOrders: [],
    storeAccessTokens: [],
    customerAccessTokens: [],
    campaignProposals: [],
    campaignProjects: [],
    customerContextItems: [],
    issuedToken: null,
    issuedStoreAccessToken: null,
    issuedCustomerAccessToken: null
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

  const DEVICE_COMMAND_LABELS = {
    reload_player_content: "再読込",
    restart_player: "Player再起動",
    restart_kiosk: "Kiosk再起動",
    collect_logs: "ログ収集",
    sync_content_now: "同期"
  };

  const DEVICE_COMMAND_STATUS_LABELS = {
    queued: "待機",
    claimed: "取得済み",
    running: "実行中",
    succeeded: "完了",
    failed: "失敗",
    cancelled: "取消",
    expired: "期限切れ",
    stale: "応答なし",
    force_cancelled: "強制取消"
  };

  const DEVICE_COMMAND_OPTIONS = [
    ["reload_player_content", DEVICE_COMMAND_LABELS.reload_player_content],
    ["sync_content_now", DEVICE_COMMAND_LABELS.sync_content_now],
    ["collect_logs", DEVICE_COMMAND_LABELS.collect_logs],
    ["restart_player", DEVICE_COMMAND_LABELS.restart_player],
    ["restart_kiosk", DEVICE_COMMAND_LABELS.restart_kiosk]
  ];

  const COUNTER_ORDER_STATUS_LABELS = {
    issued: "未引換",
    redeemed: "引換済み",
    expired: "期限切れ",
    cancelled: "取消"
  };

  const CAMPAIGN_PROJECT_STATUS_LABELS = {
    draft: "下書き",
    validated: "検証済み",
    archived: "アーカイブ",
    deleted: "削除済み"
  };

  const CAMPAIGN_PROJECT_SCENE_STATUS_LABELS = {
    draft: "下書き",
    valid: "有効",
    invalid: "要修正",
    deleted: "削除済み"
  };

  const CAMPAIGN_SCENE_TYPE_OPTIONS = window.MisellCampaignProjectUi?.sceneTypeOptions || [];

  const ROLLOUT_STATUS_LABELS = {
    ready: "反映済み",
    pending: "未反映",
    updating: "同期中",
    failed: "失敗"
  };

  const els = {
    summary: document.getElementById("summary"),
    devices: document.getElementById("devices"),
    alerts: document.getElementById("alerts"),
    notifications: document.getElementById("notifications"),
    releaseManifests: document.getElementById("release-manifests"),
    contentManifests: document.getElementById("content-manifests"),
    assets: document.getElementById("assets"),
    logBundles: document.getElementById("log-bundles"),
    storeAccessTokens: document.getElementById("store-access-tokens"),
    customerAccessTokens: document.getElementById("customer-access-tokens"),
    campaignProposals: document.getElementById("campaign-proposals"),
    campaignProjects: document.getElementById("campaign-projects"),
    counterOrders: document.getElementById("counter-orders"),
    tokenResult: document.getElementById("token-result"),
    refresh: document.getElementById("refresh")
  };

  els.refresh.addEventListener("click", loadDashboard);
  loadDashboard();
  window.setInterval(refreshDashboardIfIdle, 30000);

  function refreshDashboardIfIdle() {
    if (isEditingDashboardForm()) return;
    loadDashboard();
  }

  function isEditingDashboardForm() {
    const activeElement = document.activeElement;
    return Boolean(activeElement?.closest?.("form"));
  }

  async function loadDashboard() {
    const activeRolloutContentId = state.contentRollout?.content_manifest?.content_id || "";
    const [summary, devices, deviceCommands, alerts, notifications, storeSettings, counterOrders, storeAccessTokens, customerAccessTokens, customerContextItems, campaignProposals, campaignProjects, releaseManifests, contentManifests, assets, logBundles, contentRollout] = await Promise.all([
      fetchJson("/api/admin/summary"),
      fetchJson("/api/admin/devices"),
      fetchJson("/api/admin/device-commands?limit=100").catch(() => ({ device_commands: [] })),
      fetchJson("/api/admin/alerts"),
      fetchJson("/api/admin/alert-notifications"),
      fetchJson("/api/admin/store-settings").catch(() => ({ store_settings: [] })),
      fetchJson("/api/admin/counter-orders?limit=100").catch(() => ({ counter_orders: [] })),
      fetchJson("/api/admin/store-access-tokens?limit=100").catch(() => ({ store_access_tokens: [] })),
      fetchJson("/api/admin/customer-access-tokens?limit=100").catch(() => ({ customer_access_tokens: [] })),
      fetchJson("/api/admin/customer-context-items?limit=100&status=active").catch(() => ({ customer_context_items: [] })),
      fetchJson("/api/admin/campaign-proposals?limit=100").catch(() => ({ campaign_proposals: [] })),
      fetchCampaignProjects().catch(() => ({ campaign_projects: [] })),
      fetchJson("/api/admin/release-manifests"),
      fetchJson("/api/admin/content-manifests"),
      fetchJson("/api/admin/assets"),
      fetchJson("/api/admin/device-log-bundles"),
      activeRolloutContentId
        ? fetchJson(`/api/admin/content-rollouts/${encodeURIComponent(activeRolloutContentId)}`).catch(() => null)
        : Promise.resolve(null)
    ]);
    state.summary = summary;
    state.devices = devices.devices || [];
    state.deviceCommands = deviceCommands.device_commands || [];
    state.storeSettings = storeSettings.store_settings || [];
    state.counterOrders = counterOrders.counter_orders || [];
    state.storeAccessTokens = storeAccessTokens.store_access_tokens || [];
    state.customerAccessTokens = customerAccessTokens.customer_access_tokens || [];
    state.customerContextItems = customerContextItems.customer_context_items || [];
    state.campaignProposals = campaignProposals.campaign_proposals || [];
    state.campaignProjects = campaignProjects.campaign_projects || [];
    state.assets = assets.assets || [];
    state.releaseManifests = releaseManifests.release_manifests || [];
    state.contentManifests = contentManifests.content_manifests || [];
    state.contentRollout = contentRollout?.rollout || null;
    renderSummary(summary);
    renderDevices(state.devices);
    renderAlerts(alerts.alerts || []);
    renderNotifications(notifications);
    renderStoreAccessTokens(state.storeAccessTokens);
    renderCustomerAccessTokens(state.customerAccessTokens);
    renderCampaignProposals(state.campaignProposals);
    renderCampaignProjects(state.campaignProjects);
    renderCounterOrders(state.counterOrders);
    renderReleaseManifests(state.releaseManifests);
    renderContentManifests(state.contentManifests);
    renderAssets(state.assets, assets.max_upload_mb);
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

  async function fetchCampaignProjects() {
    const list = await fetchJson("/api/admin/campaign-projects?limit=50");
    const projects = list.campaign_projects || [];
    const detailed = await Promise.all(projects.map(async (project) => {
      if (!project.campaign_project_id) return project;
      try {
        const detail = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(project.campaign_project_id)}`);
        return detail.campaign_project || project;
      } catch {
        return project;
      }
    }));
    return { campaign_projects: detailed };
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
    els.devices.querySelectorAll(".command-action").forEach((form) => {
      form.addEventListener("submit", handleCommandCreate);
    });
    els.devices.querySelectorAll(".command-force-cancel").forEach((button) => {
      button.addEventListener("click", handleCommandForceCancel);
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
          <form class="command-action" data-device-id="${escapeHtml(device.device_id)}">
            <select name="command_type" aria-label="端末コマンド">
              ${DEVICE_COMMAND_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <input name="reason" type="text" value="" placeholder="理由" aria-label="コマンド理由">
            <button type="submit">指示</button>
            ${renderLatestDeviceCommand(device.device_id)}
          </form>
        </td>
      </tr>
    `;
  }

  function renderLatestDeviceCommand(deviceId) {
    const latest = state.deviceCommands.find((command) => command.device_id === deviceId);
    if (!latest) return `<small>指示なし</small>`;
    const label = DEVICE_COMMAND_LABELS[latest.command_type] || latest.command_type || "";
    const statusLabel = DEVICE_COMMAND_STATUS_LABELS[latest.status] || latest.status || "";
    const stamp = latest.completed_at || latest.claimed_at || latest.requested_at;
    const forceCancel = latest.terminal ? "" : `
      <button class="secondary command-force-cancel" type="button" data-command-id="${escapeAttr(latest.device_command_id)}" data-status="${escapeAttr(latest.status || "")}">強制取消</button>
    `;
    return `
      <small>
        ${escapeHtml(label)} /
        <span class="update-status update-status-${escapeAttr(latest.status || "idle")}">${escapeHtml(statusLabel)}</span>
        ${formatTime(stamp)}
        ${latest.claim_stale_at ? ` / 応答期限 ${formatTime(latest.claim_stale_at)}` : ""}
        ${latest.error ? ` / ${escapeHtml(latest.error)}` : ""}
      </small>
      ${forceCancel}
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

  async function handleCommandCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const deviceId = form.dataset.deviceId;
    const commandType = form.elements.command_type.value;
    const reason = form.elements.reason.value;
    const label = DEVICE_COMMAND_LABELS[commandType] || commandType;
    if (!window.confirm(`${deviceId} に ${label} を指示します。`)) return;

    button.disabled = true;
    button.textContent = "送信中";
    try {
      await fetchJson(`/api/admin/devices/${encodeURIComponent(deviceId)}/commands`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command_type: commandType,
          reason,
          ttl_seconds: 300
        })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "端末指示に失敗しました。");
      button.disabled = false;
      button.textContent = "指示";
    }
  }

  async function handleCommandForceCancel(event) {
    const button = event.currentTarget;
    const commandId = button.dataset.commandId;
    if (!commandId) return;
    const reason = window.prompt(`${commandId} を強制取消します。理由を入力してください。`, "operator force-cancel");
    if (reason === null) return;

    button.disabled = true;
    button.textContent = "取消中";
    try {
      await fetchJson(`/api/admin/device-commands/${encodeURIComponent(commandId)}/force-cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "強制取消に失敗しました。");
      button.disabled = false;
      button.textContent = "強制取消";
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
        ${renderContentManifestAssetPicker()}
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
              <th>Assets</th>
              <th>Published</th>
              <th>運用</th>
            </tr>
          </thead>
          <tbody>
            ${contentManifests.slice(0, 30).map(renderContentManifestRow).join("")}
          </tbody>
        </table>
      `}
      ${state.contentRollout ? renderContentRollout(state.contentRollout) : ""}
    `;

    els.contentManifests.querySelector(".content-manifest-create")?.addEventListener("submit", handleContentManifestCreate);
    els.contentManifests.querySelectorAll(".content-manifest-action").forEach((form) => {
      form.addEventListener("submit", handleContentManifestUpdate);
    });
    els.contentManifests.querySelectorAll(".content-rollout-open").forEach((button) => {
      button.addEventListener("click", handleContentRolloutOpen);
    });
    els.contentManifests.querySelectorAll(".content-rollout-retry").forEach((button) => {
      button.addEventListener("click", handleContentRolloutRetry);
    });
  }

  function renderContentManifestRow(manifest) {
    const itemCount = Array.isArray(manifest.playlist?.items) ? manifest.playlist.items.length : "";
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
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
        <td>${formatNumber(assets.length)}<small>${escapeHtml(assets.map((asset) => asset.asset_id).join(", "))}</small></td>
        <td>${formatTime(manifest.published_at || manifest.updated_at)}</td>
        <td>
          <form class="content-manifest-action" data-content-id="${escapeHtml(manifest.content_id || "")}">
            <select name="status" aria-label="Manifest status">
              ${RELEASE_MANIFEST_STATUS_OPTIONS.map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === manifest.status ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <button type="submit">保存</button>
            <button class="secondary content-rollout-open" type="button" data-content-id="${escapeHtml(manifest.content_id || "")}">状況</button>
          </form>
        </td>
      </tr>
    `;
  }

  function renderContentRollout(rollout) {
    const manifest = rollout.content_manifest || {};
    const summary = rollout.summary || {};
    const devices = Array.isArray(rollout.devices) ? rollout.devices : [];
    return `
      <section id="content-rollout" class="content-rollout-panel">
        <div class="content-rollout-header">
          <div>
            <strong>${escapeHtml(manifest.content_id || "")}</strong>
            <small>${escapeHtml(manifest.release_channel || "")} / ${escapeHtml(manifest.playlist_version || "")}</small>
          </div>
          <div class="rollout-summary">
            <span>対象 ${formatNumber(summary.target_devices || 0)}</span>
            <span>反映済み ${formatNumber(summary.ready || 0)}</span>
            <span>同期中 ${formatNumber(summary.updating || 0)}</span>
            <span>未反映 ${formatNumber(summary.pending || 0)}</span>
            <span>失敗 ${formatNumber(summary.failed || 0)}</span>
            <span>素材ready ${formatNumber(summary.assets_ready || 0)}</span>
          </div>
        </div>
        ${devices.length === 0 ? `<p class="empty">対象端末はありません。</p>` : `
          <table class="content-rollout-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>端末</th>
                <th>Playlist</th>
                <th>Assets</th>
                <th>最終状態</th>
                <th>運用</th>
              </tr>
            </thead>
            <tbody>
              ${devices.map((device) => renderContentRolloutDeviceRow(manifest, device)).join("")}
            </tbody>
          </table>
        `}
      </section>
    `;
  }

  function renderContentRolloutDeviceRow(manifest, device) {
    const assetStates = Array.isArray(device.asset_states) ? device.asset_states : [];
    return `
      <tr>
        <td>
          <span class="update-status update-status-${escapeAttr(rolloutStatusClass(device.rollout_status))}">
            ${escapeHtml(ROLLOUT_STATUS_LABELS[device.rollout_status] || device.rollout_status || "")}
          </span>
        </td>
        <td>
          ${escapeHtml(device.device_id || "")}
          <small>${escapeHtml(device.store_id || "")} / ${escapeHtml(device.effective_status || "")}</small>
        </td>
        <td>
          ${device.playlist_ready ? "OK" : "待機"}
          <small>${escapeHtml(device.current_playlist_version || "")} -> ${escapeHtml(device.target_playlist_version || "")}</small>
        </td>
        <td>
          ${device.assets_ready ? "OK" : "待機"}
          ${assetStates.length === 0 ? `<small>必要素材なし</small>` : assetStates.map((asset) => `
            <small>${escapeHtml(asset.asset_id || "")}: ${escapeHtml(asset.status || "")}${asset.ready ? " / ready" : ""}</small>
          `).join("")}
        </td>
        <td>
          ${formatTime(device.last_seen)}
          <small>${escapeHtml(device.last_error || assetStates.find((asset) => asset.message)?.message || "")}</small>
        </td>
        <td>
          <button class="secondary content-rollout-retry" type="button" data-content-id="${escapeHtml(manifest.content_id || "")}" data-device-id="${escapeHtml(device.device_id || "")}">再同期</button>
        </td>
      </tr>
    `;
  }

  function renderContentManifestAssetPicker() {
    if (!state.assets.length) {
      return `<p class="empty">紐づけ可能なCloud素材はまだありません。</p>`;
    }
    return `
      <fieldset class="asset-picker">
        <legend>必要素材</legend>
        ${state.assets.slice(0, 20).map((asset) => `
          <label>
            <input type="checkbox" name="asset_ids" value="${escapeHtml(asset.asset_id || "")}">
            <span>${escapeHtml(asset.asset_id || "")}</span>
            <small>${escapeHtml(asset.type || "")} / ${formatBytes(asset.size)}</small>
          </label>
        `).join("")}
      </fieldset>
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
        playlist: JSON.parse(form.elements.playlist_json.value),
        assets: selectedContentManifestAssets(form)
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

  function selectedContentManifestAssets(form) {
    return Array.from(form.querySelectorAll("input[name='asset_ids']:checked")).map((input) => ({
      asset_id: input.value
    }));
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

  async function handleContentRolloutOpen(event) {
    const button = event.currentTarget;
    const contentId = button.dataset.contentId;
    button.disabled = true;
    button.textContent = "読込中";
    try {
      const result = await fetchJson(`/api/admin/content-rollouts/${encodeURIComponent(contentId)}`);
      state.contentRollout = result.rollout;
      renderContentManifests(state.contentManifests);
    } catch (error) {
      window.alert(error.message || "反映状況の取得に失敗しました。");
      button.disabled = false;
      button.textContent = "状況";
    }
  }

  async function handleContentRolloutRetry(event) {
    const button = event.currentTarget;
    const contentId = button.dataset.contentId;
    const deviceId = button.dataset.deviceId;
    if (!window.confirm(`${deviceId} の素材同期状態を再同期待ちへ戻します。`)) return;
    button.disabled = true;
    button.textContent = "処理中";
    try {
      const result = await fetchJson(`/api/admin/content-rollouts/${encodeURIComponent(contentId)}/devices/${encodeURIComponent(deviceId)}/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.contentRollout = result.rollout;
      renderContentManifests(state.contentManifests);
    } catch (error) {
      window.alert(error.message || "再同期の設定に失敗しました。");
      button.disabled = false;
      button.textContent = "再同期";
    }
  }

  function renderAssets(assets, maxUploadMb) {
    if (!els.assets) return;
    els.assets.innerHTML = `
      <form class="asset-upload">
        <input name="asset_id" type="text" placeholder="Asset ID" aria-label="Asset ID">
        <input name="label" type="text" placeholder="Label" aria-label="Label">
        <input name="notes" type="text" placeholder="Notes" aria-label="Notes">
        <input name="asset" type="file" accept="image/png,image/jpeg,video/mp4,video/webm" aria-label="Cloud asset" required>
        <button type="submit">アップロード</button>
        <small>上限 ${formatNumber(maxUploadMb)} MB / jpg, png, mp4, webm</small>
      </form>
      ${assets.length === 0 ? `<p class="empty">Cloud素材はまだありません。</p>` : `
        <table class="assets-table">
          <thead>
            <tr>
              <th>Type</th>
              <th>Asset</th>
              <th>Size</th>
              <th>SHA-256</th>
              <th>Updated</th>
              <th>運用</th>
            </tr>
          </thead>
          <tbody>
            ${assets.slice(0, 50).map(renderAssetRow).join("")}
          </tbody>
        </table>
      `}
    `;
    els.assets.querySelector(".asset-upload")?.addEventListener("submit", handleAssetUpload);
    els.assets.querySelectorAll(".asset-delete").forEach((button) => {
      button.addEventListener("click", handleAssetDelete);
    });
  }

  function renderAssetRow(asset) {
    return `
      <tr>
        <td><span class="update-status update-status-${asset.type === "video" ? "pending" : "success"}">${escapeHtml(asset.type || "")}</span></td>
        <td>
          ${escapeHtml(asset.asset_id || "")}
          <small>${escapeHtml(asset.label || asset.original_name || "")}</small>
          <small>${escapeHtml(asset.mime_type || "")}</small>
        </td>
        <td>${formatBytes(asset.size)}</td>
        <td><code>${escapeHtml((asset.sha256 || "").slice(0, 16))}</code><small>${escapeHtml(asset.filename || "")}</small></td>
        <td>${formatTime(asset.updated_at || asset.created_at)}</td>
        <td>
          <a href="${escapeHtml(asset.download_path || "#")}">Download</a>
          <button class="danger asset-delete" type="button" data-asset-id="${escapeHtml(asset.asset_id || "")}">削除</button>
        </td>
      </tr>
    `;
  }

  async function handleAssetUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const formData = new FormData(form);
    button.disabled = true;
    button.textContent = "アップロード中";
    try {
      await fetchJson("/api/admin/assets", {
        method: "POST",
        body: formData
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "素材アップロードに失敗しました。");
      button.disabled = false;
      button.textContent = "アップロード";
    }
  }

  async function handleAssetDelete(event) {
    const button = event.currentTarget;
    const assetId = button.dataset.assetId;
    if (!window.confirm(`${assetId} を削除します。`)) return;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/assets/${encodeURIComponent(assetId)}`, {
        method: "DELETE"
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "素材削除に失敗しました。");
      button.disabled = false;
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
    if (!state.issuedToken && !state.issuedStoreAccessToken && !state.issuedCustomerAccessToken) {
      els.tokenResult.hidden = true;
      els.tokenResult.innerHTML = "";
      return;
    }

    els.tokenResult.hidden = false;
    els.tokenResult.innerHTML = `
      <h2>発行済み認証情報</h2>
      ${state.issuedToken ? `
        <div class="token-banner">
          <div>
            <strong>端末 ${escapeHtml(state.issuedToken.device_id)}</strong>
            <small>${formatTime(state.issuedToken.issued_at)}</small>
          </div>
          <input id="issued-token" class="token-value" type="text" readonly value="${escapeHtml(state.issuedToken.token)}" aria-label="発行済み端末トークン">
          <button class="copy-issued-value" type="button" data-target-id="issued-token">コピー</button>
          <button id="clear-issued-token" class="secondary" type="button">閉じる</button>
        </div>
      ` : ""}
      ${state.issuedStoreAccessToken ? `
        <div class="token-banner">
          <div>
            <strong>店舗受付 ${escapeHtml(state.issuedStoreAccessToken.store_id)}</strong>
            <small>${formatTime(state.issuedStoreAccessToken.issued_at)}</small>
          </div>
          <input id="issued-store-url" class="token-value" type="text" readonly value="${escapeHtml(state.issuedStoreAccessToken.url)}" aria-label="発行済み店舗受付URL">
          <button class="copy-issued-value" type="button" data-target-id="issued-store-url">URLコピー</button>
          <button id="clear-issued-store-token" class="secondary" type="button">閉じる</button>
        </div>
      ` : ""}
      ${state.issuedCustomerAccessToken ? `
        <div class="token-banner">
          <div>
            <strong>顧客管理 ${escapeHtml(state.issuedCustomerAccessToken.tenant_id)}</strong>
            <small>${formatTime(state.issuedCustomerAccessToken.issued_at)}</small>
          </div>
          <input id="issued-customer-url" class="token-value" type="text" readonly value="${escapeHtml(state.issuedCustomerAccessToken.url)}" aria-label="発行済み顧客管理URL">
          <button class="copy-issued-value" type="button" data-target-id="issued-customer-url">URLコピー</button>
          <button id="clear-issued-customer-token" class="secondary" type="button">閉じる</button>
        </div>
      ` : ""}
    `;

    els.tokenResult.querySelectorAll(".copy-issued-value").forEach((button) => {
      button.addEventListener("click", async () => {
        const input = document.getElementById(button.dataset.targetId);
        input?.select();
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(input?.value || "").catch(() => {});
        }
      });
    });
    document.getElementById("clear-issued-token")?.addEventListener("click", () => {
      state.issuedToken = null;
      renderTokenResult();
    });
    document.getElementById("clear-issued-store-token")?.addEventListener("click", () => {
      state.issuedStoreAccessToken = null;
      renderTokenResult();
    });
    document.getElementById("clear-issued-customer-token")?.addEventListener("click", () => {
      state.issuedCustomerAccessToken = null;
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

  function renderStoreAccessTokens(tokens) {
    if (!els.storeAccessTokens) return;
    const stores = state.storeSettings || [];
    els.storeAccessTokens.innerHTML = `
      <form class="store-access-create">
        <select name="store_id" aria-label="店舗" required>
          <option value="">店舗を選択</option>
          ${stores.map((store) => (
            `<option value="${escapeHtml(store.store_id || "")}">${escapeHtml(store.store_name || store.store_id || "")}</option>`
          )).join("")}
        </select>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="スタッフPIN" aria-label="スタッフPIN" required>
        <input name="notes" type="text" placeholder="メモ" aria-label="メモ">
        <button type="submit">URL発行</button>
      </form>
      ${tokens.length === 0 ? `<p class="empty">店舗受付URLはまだ発行されていません。</p>` : `
        <table class="store-access-table">
          <thead>
            <tr>
              <th>店舗</th>
              <th>Status</th>
              <th>PIN</th>
              <th>最終利用</th>
              <th>運用</th>
            </tr>
          </thead>
          <tbody>
            ${tokens.slice(0, 50).map(renderStoreAccessTokenRow).join("")}
          </tbody>
        </table>
      `}
    `;
    els.storeAccessTokens.querySelector(".store-access-create")?.addEventListener("submit", handleStoreAccessTokenCreate);
    els.storeAccessTokens.querySelectorAll(".store-access-rotate").forEach((button) => {
      button.addEventListener("click", handleStoreAccessTokenRotate);
    });
    els.storeAccessTokens.querySelectorAll(".store-access-pin-reset").forEach((button) => {
      button.addEventListener("click", handleStoreAccessTokenPinReset);
    });
  }

  function renderStoreAccessTokenRow(token) {
    return `
      <tr>
        <td>${escapeHtml(token.store_name || token.store_id || "")}<small>${escapeHtml(token.store_id || "")}</small></td>
        <td>
          <span class="update-status update-status-${token.status === "active" ? "success" : "failed"}">${escapeHtml(token.status || "")}</span>
          ${token.locked_until ? `<small>lock ${formatTime(token.locked_until)}</small>` : ""}
        </td>
        <td>失敗 ${formatNumber(token.failed_attempts || 0)}<small>更新 ${formatTime(token.pin_rotated_at)}</small></td>
        <td>${formatTime(token.last_used_at)}<small>${escapeHtml(token.notes || "")}</small></td>
        <td>
          <button class="secondary store-access-rotate" type="button" data-token-id="${escapeHtml(token.store_access_token_id || "")}">URL再発行</button>
          <button class="secondary store-access-pin-reset" type="button" data-token-id="${escapeHtml(token.store_access_token_id || "")}">PIN変更</button>
        </td>
      </tr>
    `;
  }

  async function handleStoreAccessTokenCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const storeId = form.elements.store_id.value;
    button.disabled = true;
    button.textContent = "発行中";
    try {
      const result = await fetchJson(`/api/admin/stores/${encodeURIComponent(storeId)}/access-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: form.elements.pin.value,
          notes: form.elements.notes.value
        })
      });
      state.issuedStoreAccessToken = {
        store_id: storeId,
        token: result.store_token,
        url: result.store_orders_url,
        issued_at: new Date().toISOString()
      };
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "店舗受付URLの発行に失敗しました。");
      button.disabled = false;
      button.textContent = "URL発行";
    }
  }

  async function handleStoreAccessTokenRotate(event) {
    const button = event.currentTarget;
    const tokenId = button.dataset.tokenId;
    if (!window.confirm("店舗受付URLを再発行します。旧URLのセッションは失効します。")) return;
    button.disabled = true;
    try {
      const result = await fetchJson(`/api/admin/store-access-tokens/${encodeURIComponent(tokenId)}/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      state.issuedStoreAccessToken = {
        store_id: result.store_access_token?.store_id || "",
        token: result.store_token,
        url: result.store_orders_url,
        issued_at: new Date().toISOString()
      };
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "店舗受付URLの再発行に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleStoreAccessTokenPinReset(event) {
    const button = event.currentTarget;
    const tokenId = button.dataset.tokenId;
    const pin = window.prompt("新しいスタッフPINを4〜12桁の数字で入力してください。");
    if (pin === null) return;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/store-access-tokens/${encodeURIComponent(tokenId)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "PIN変更に失敗しました。");
      button.disabled = false;
    }
  }

  function renderCustomerAccessTokens(tokens) {
    if (!els.customerAccessTokens) return;
    const tenants = uniqueTenantsFromStores(state.storeSettings || []);
    els.customerAccessTokens.innerHTML = `
      <form class="customer-access-create">
        <select name="tenant_id" aria-label="顧客" required>
          <option value="">顧客を選択</option>
          ${tenants.map((tenant) => (
            `<option value="${escapeHtml(tenant.tenant_id || "")}">${escapeHtml(tenant.tenant_name || tenant.tenant_id || "")}</option>`
          )).join("")}
        </select>
        <input name="store_ids" type="text" placeholder="store_id CSV（空ならtenant全体）" aria-label="店舗スコープ">
        <select name="role" aria-label="顧客ロール">
          <option value="customer_viewer">viewer</option>
          <option value="customer_editor">editor</option>
          <option value="customer_admin">admin</option>
        </select>
        <input name="pin" type="password" inputmode="numeric" pattern="[0-9]*" placeholder="顧客PIN" aria-label="顧客PIN" required>
        <input name="notes" type="text" placeholder="メモ" aria-label="メモ">
        <button type="submit">URL発行</button>
      </form>
      ${tokens.length === 0 ? `<p class="empty">顧客管理URLはまだ発行されていません。</p>` : `
        <table class="customer-access-table">
          <thead>
            <tr>
              <th>顧客</th>
              <th>Role</th>
              <th>店舗Scope</th>
              <th>Status</th>
              <th>最終利用</th>
            </tr>
          </thead>
          <tbody>
            ${tokens.slice(0, 50).map(renderCustomerAccessTokenRow).join("")}
          </tbody>
        </table>
      `}
    `;
    els.customerAccessTokens.querySelector(".customer-access-create")?.addEventListener("submit", handleCustomerAccessTokenCreate);
  }

  function renderCustomerAccessTokenRow(token) {
    return `
      <tr>
        <td>${escapeHtml(token.tenant_name || token.tenant_id || "")}<small>${escapeHtml(token.tenant_id || "")}</small></td>
        <td>${escapeHtml(token.role || "")}</td>
        <td>${(token.store_ids || []).length ? (token.store_ids || []).map(escapeHtml).join(", ") : "tenant全体"}</td>
        <td>
          <span class="update-status update-status-${token.status === "active" ? "success" : "failed"}">${escapeHtml(token.status || "")}</span>
          ${token.locked_until ? `<small>lock ${formatTime(token.locked_until)}</small>` : ""}
          <small>PIN更新 ${formatTime(token.pin_rotated_at)}</small>
        </td>
        <td>${formatTime(token.last_used_at)}<small>${escapeHtml(token.notes || "")}</small></td>
      </tr>
    `;
  }

  async function handleCustomerAccessTokenCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const tenantId = form.elements.tenant_id.value;
    button.disabled = true;
    button.textContent = "発行中";
    try {
      const result = await fetchJson(`/api/admin/tenants/${encodeURIComponent(tenantId)}/customer-access-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pin: form.elements.pin.value,
          role: form.elements.role.value,
          store_ids: form.elements.store_ids.value.split(",").map((item) => item.trim()).filter(Boolean),
          notes: form.elements.notes.value
        })
      });
      state.issuedCustomerAccessToken = {
        tenant_id: tenantId,
        url: result.customer_admin_url,
        issued_at: new Date().toISOString()
      };
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "顧客管理URLの発行に失敗しました。");
      button.disabled = false;
      button.textContent = "URL発行";
    }
  }

  function renderCampaignProposals(proposals) {
    if (!els.campaignProposals) return;
    const tenants = uniqueTenantsFromStores(state.storeSettings || []);
    const stores = state.storeSettings || [];
    const screenGroups = uniqueScreenGroupsFromDevices(state.devices || []);
    const currentMonth = new Date().toISOString().slice(0, 7);
    els.campaignProposals.innerHTML = `
      ${renderCustomerContextAdminPanel(tenants, stores, screenGroups)}
      <form class="campaign-proposal-create">
        <select name="tenant_id" aria-label="顧客" required>
          <option value="">顧客</option>
          ${tenants.map((tenant) => `<option value="${escapeHtml(tenant.tenant_id || "")}">${escapeHtml(tenant.tenant_name || tenant.tenant_id || "")}</option>`).join("")}
        </select>
        <select name="store_id" aria-label="店舗" required>
          <option value="">店舗</option>
          ${stores.map((store) => `<option value="${escapeHtml(store.store_id || "")}" data-tenant-id="${escapeHtml(store.tenant_id || "")}">${escapeHtml(store.store_name || store.store_id || "")}</option>`).join("")}
        </select>
        <select name="screen_group_id" aria-label="画面グループ" required>
          <option value="">画面グループ</option>
          ${screenGroups.map((group) => `<option value="${escapeHtml(group.screen_group_id || "")}" data-store-id="${escapeHtml(group.store_id || "")}">${escapeHtml(group.screen_group_name || group.screen_group_id || "")}</option>`).join("")}
        </select>
        <input name="proposal_month" type="month" value="${escapeHtml(currentMonth)}" aria-label="提案月" required>
        <input name="title" type="text" placeholder="提案タイトル" aria-label="提案タイトル" required>
        <input name="objective" type="text" placeholder="狙い" aria-label="狙い">
        <input name="target_audience" type="text" placeholder="想定ターゲット" aria-label="想定ターゲット">
        <textarea name="three_screen_outline" rows="3" placeholder="3連ラフ（1行1画面/1シーン）" aria-label="3連ラフ"></textarea>
        <input name="qr_flow" type="text" placeholder="QR導線案" aria-label="QR導線案">
        <input name="expected_effect" type="text" placeholder="期待する効果" aria-label="期待する効果">
        <button type="submit">提案を追加</button>
      </form>
      ${proposals.length === 0 ? `<p class="empty">AI販促提案はまだありません。</p>` : `
        <table class="campaign-proposal-table">
          <thead>
            <tr>
              <th>提案</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Snapshot / Brief</th>
              <th>履歴</th>
            </tr>
          </thead>
          <tbody>
            ${proposals.slice(0, 50).map(renderCampaignProposalRow).join("")}
          </tbody>
        </table>
      `}
    `;
    els.campaignProposals.querySelector(".admin-context-create")?.addEventListener("submit", handleAdminContextCreate);
    els.campaignProposals.querySelectorAll(".admin-context-upload").forEach((form) => {
      form.addEventListener("submit", handleAdminContextUpload);
    });
    els.campaignProposals.querySelectorAll("[data-admin-context-delete]").forEach((button) => {
      button.addEventListener("click", handleAdminContextDelete);
    });
    els.campaignProposals.querySelectorAll("[data-admin-source-asset-delete]").forEach((button) => {
      button.addEventListener("click", handleAdminSourceAssetDelete);
    });
    els.campaignProposals.querySelector(".campaign-proposal-create")?.addEventListener("submit", handleCampaignProposalCreate);
  }

  function renderCustomerContextAdminPanel(tenants, stores, screenGroups) {
    return `
      <section class="admin-context-panel">
        <form class="admin-context-create campaign-proposal-create">
          <select name="tenant_id" aria-label="顧客" required>
            <option value="">顧客</option>
            ${tenants.map((tenant) => `<option value="${escapeHtml(tenant.tenant_id || "")}">${escapeHtml(tenant.tenant_name || tenant.tenant_id || "")}</option>`).join("")}
          </select>
          <select name="store_id" aria-label="店舗" required>
            <option value="">店舗</option>
            ${stores.map((store) => `<option value="${escapeHtml(store.store_id || "")}" data-tenant-id="${escapeHtml(store.tenant_id || "")}">${escapeHtml(store.store_name || store.store_id || "")}</option>`).join("")}
          </select>
          <select name="screen_group_id" aria-label="画面グループ" required>
            <option value="">画面グループ</option>
            ${screenGroups.map((group) => `<option value="${escapeHtml(group.screen_group_id || "")}" data-store-id="${escapeHtml(group.store_id || "")}">${escapeHtml(group.screen_group_name || group.screen_group_id || "")}</option>`).join("")}
          </select>
          <select name="context_category" aria-label="分類">
            ${contextCategoryOptions("customer_profile")}
          </select>
          <select name="visibility_scope" aria-label="表示範囲">
            <option value="customer_visible">customer_visible</option>
            <option value="operator_internal">operator_internal</option>
          </select>
          <input name="item_key" type="text" placeholder="管理名" aria-label="管理名" required>
          <textarea name="text" rows="3" placeholder="文脈メモ" aria-label="文脈メモ"></textarea>
          <button type="submit">文脈を追加</button>
        </form>
        ${state.customerContextItems.length === 0 ? `<p class="empty">文脈 seed はまだありません。</p>` : `
          <table class="campaign-proposal-table admin-context-table">
            <thead><tr><th>文脈</th><th>Scope</th><th>Source</th><th>添付</th><th>操作</th></tr></thead>
            <tbody>${state.customerContextItems.slice(0, 50).map(renderAdminContextRow).join("")}</tbody>
          </table>
        `}
      </section>
    `;
  }

  function renderAdminContextRow(item) {
    const assets = item.source_assets || [];
    return `
      <tr>
        <td>
          <strong>${escapeHtml(contextCategoryLabel(item.context_category))} / ${escapeHtml(item.item_key || "")}</strong>
          <small>${escapeHtml(contextText(item.value))}</small>
        </td>
        <td>
          ${escapeHtml(item.tenant_id || "")}
          <small>${escapeHtml(item.store_id || "")} / ${escapeHtml(item.screen_group_id || "")}</small>
        </td>
        <td>
          ${escapeHtml(item.visibility_scope || "")}
          <small>${escapeHtml(item.source_owner || "")} / ${escapeHtml(item.source_type || "")}</small>
        </td>
        <td>
          ${assets.length ? assets.map((asset) => `
            <small>
              <a href="${escapeHtml(asset.admin_view_path || "")}" target="_blank" rel="noreferrer">${escapeHtml(asset.original_name || asset.filename || "")}</a>
              <button class="danger asset-delete" type="button" data-admin-source-asset-delete="${escapeAttr(asset.customer_context_source_asset_id)}">削除</button>
            </small>
          `).join("") : `<small>添付なし</small>`}
          <form class="admin-context-upload" data-context-id="${escapeAttr(item.customer_context_item_id)}">
            <input name="source" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" aria-label="添付ファイル">
            <input name="usage_notes" type="text" placeholder="利用メモ" aria-label="利用メモ">
            <button type="submit">添付</button>
          </form>
        </td>
        <td>
          <button class="danger" type="button" data-admin-context-delete="${escapeAttr(item.customer_context_item_id)}">削除</button>
        </td>
      </tr>
    `;
  }

  function renderCampaignProposalRow(proposal) {
    const events = proposal.events || [];
    return `
      <tr>
        <td>
          <strong>${escapeHtml(proposal.title || "")}</strong>
          <small>${escapeHtml(proposal.campaign_proposal_id || "")}</small>
          <small>${escapeHtml(proposal.objective || "")}</small>
        </td>
        <td>
          ${escapeHtml(proposal.proposal_month || "")}
          <small>${escapeHtml(proposal.tenant_id || "")}</small>
          <small>${escapeHtml(proposal.store_id || "")}${proposal.screen_group_id ? ` / ${escapeHtml(proposal.screen_group_id)}` : ""}</small>
        </td>
        <td>
          <span class="update-status update-status-${proposal.status === "rejected" ? "failed" : proposal.status === "selected" ? "success" : "pending"}">${escapeHtml(proposal.status || "")}</span>
          ${proposal.rejected_reason ? `<small>${escapeHtml(proposal.rejected_reason)}</small>` : ""}
        </td>
        <td>
          <small>${escapeHtml((proposal.context_snapshot_sha256 || "").slice(0, 12))}</small>
          <small>${proposal.campaign_brief_id ? `brief ${escapeHtml(proposal.campaign_brief_id)}` : "brief未作成"}</small>
        </td>
        <td>
          ${events.slice(0, 4).map((event) => `<small>${escapeHtml(event.to_status || "")} ${formatTime(event.created_at)}</small>`).join("")}
        </td>
      </tr>
    `;
  }

  function renderCampaignProjects(projects) {
    if (!els.campaignProjects) return;
    const tenants = uniqueTenantsFromStores(state.storeSettings || []);
    const stores = state.storeSettings || [];
    const screenGroups = uniqueScreenGroupsFromDevices(state.devices || []);
    const selectedProposals = (state.campaignProposals || []).filter((proposal) => proposal.status === "selected");
    const selectedBriefs = selectedProposals.filter((proposal) => proposal.campaign_brief_id);
    const proposalDisabled = selectedProposals.length === 0 ? " disabled" : "";
    const briefDisabled = selectedBriefs.length === 0 ? " disabled" : "";
    els.campaignProjects.innerHTML = `
      <div class="campaign-project-create-grid">
        <form class="campaign-project-create campaign-project-from-proposal">
          <select name="campaign_proposal_id" aria-label="選択済み提案"${proposalDisabled} required>
            <option value="">選択済み提案</option>
            ${selectedProposals.map((proposal) => `
              <option value="${escapeAttr(proposal.campaign_proposal_id)}">${escapeHtml(campaignProposalLabel(proposal))}</option>
            `).join("")}
          </select>
          <input name="title" type="text" placeholder="プロジェクト名（空欄なら提案名）" aria-label="プロジェクト名">
          <button type="submit"${proposalDisabled}>提案から作成</button>
        </form>
        <form class="campaign-project-create campaign-project-from-brief">
          <select name="campaign_brief_id" aria-label="CampaignBrief"${briefDisabled} required>
            <option value="">CampaignBrief</option>
            ${selectedBriefs.map((proposal) => `
              <option value="${escapeAttr(proposal.campaign_brief_id)}">${escapeHtml(campaignProposalLabel(proposal))}</option>
            `).join("")}
          </select>
          <input name="title" type="text" placeholder="プロジェクト名（空欄なら提案名）" aria-label="プロジェクト名">
          <button type="submit"${briefDisabled}>Briefから作成</button>
        </form>
        <form class="campaign-project-create campaign-project-free-input">
          <select name="tenant_id" aria-label="顧客" required>
            <option value="">顧客</option>
            ${tenants.map((tenant) => `<option value="${escapeHtml(tenant.tenant_id || "")}">${escapeHtml(tenant.tenant_name || tenant.tenant_id || "")}</option>`).join("")}
          </select>
          <select name="store_id" aria-label="店舗" required>
            <option value="">店舗</option>
            ${stores.map((store) => `<option value="${escapeHtml(store.store_id || "")}" data-tenant-id="${escapeHtml(store.tenant_id || "")}">${escapeHtml(store.store_name || store.store_id || "")}</option>`).join("")}
          </select>
          <select name="screen_group_id" aria-label="画面グループ" required>
            <option value="">画面グループ</option>
            ${screenGroups.map((group) => `<option value="${escapeHtml(group.screen_group_id || "")}" data-store-id="${escapeHtml(group.store_id || "")}">${escapeHtml(group.screen_group_name || group.screen_group_id || "")}</option>`).join("")}
          </select>
          <input name="title" type="text" placeholder="プロジェクト名" aria-label="プロジェクト名" required>
          <input name="objective" type="text" placeholder="目的" aria-label="目的" required>
          <input name="target_audience" type="text" placeholder="対象" aria-label="対象" required>
          <textarea name="store_context" rows="2" placeholder="店舗前提" aria-label="店舗前提" required></textarea>
          <textarea name="offer_or_message" rows="2" placeholder="訴求内容" aria-label="訴求内容" required></textarea>
          <input name="cta" type="text" placeholder="CTA" aria-label="CTA" required>
          <textarea name="success_metrics" rows="2" placeholder="成功指標（1行1項目）" aria-label="成功指標"></textarea>
          <textarea name="constraints" rows="2" placeholder="制約（1行1項目）" aria-label="制約"></textarea>
          <button type="submit">入力から作成</button>
        </form>
      </div>
      ${projects.length === 0 ? `<p class="empty">キャンペーンプロジェクトはまだありません。</p>` : `
        <table class="campaign-project-table">
          <thead>
            <tr>
              <th>Project</th>
              <th>Brief</th>
              <th>Scenes</th>
              <th>履歴</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            ${projects.slice(0, 50).map(renderCampaignProjectRow).join("")}
          </tbody>
        </table>
      `}
    `;
    els.campaignProjects.querySelector(".campaign-project-from-proposal")?.addEventListener("submit", handleCampaignProjectFromProposal);
    els.campaignProjects.querySelector(".campaign-project-from-brief")?.addEventListener("submit", handleCampaignProjectFromBrief);
    els.campaignProjects.querySelector(".campaign-project-free-input")?.addEventListener("submit", handleCampaignProjectFreeInput);
    els.campaignProjects.querySelectorAll("[data-campaign-project-validate]").forEach((button) => {
      button.addEventListener("click", handleCampaignProjectValidate);
    });
    els.campaignProjects.querySelectorAll("[data-campaign-project-delete]").forEach((button) => {
      button.addEventListener("click", handleCampaignProjectDelete);
    });
    els.campaignProjects.querySelectorAll(".campaign-project-scene-create").forEach((form) => {
      form.addEventListener("submit", handleCampaignProjectSceneCreate);
    });
    els.campaignProjects.querySelectorAll(".campaign-project-scene-update").forEach((form) => {
      form.addEventListener("submit", handleCampaignProjectSceneUpdate);
    });
    els.campaignProjects.querySelectorAll("[data-campaign-project-scene-delete]").forEach((button) => {
      button.addEventListener("click", handleCampaignProjectSceneDelete);
    });
  }

  function renderCampaignProjectRow(project) {
    const scenes = project.scenes || [];
    const events = project.events || [];
    const errors = project.validation_errors || [];
    return `
      <tr>
        <td>
          <strong>${escapeHtml(project.title || project.campaign_project_id || "")}</strong>
          <small>${escapeHtml(project.campaign_project_id || "")}</small>
          <span class="update-status update-status-${escapeAttr(campaignProjectStatusClass(project.status))}">${escapeHtml(CAMPAIGN_PROJECT_STATUS_LABELS[project.status] || project.status || "")}</span>
          <small>${escapeHtml(project.tenant_id || "")} / ${escapeHtml(project.store_id || "")} / ${escapeHtml(project.screen_group_id || "")}</small>
        </td>
        <td>
          <small>${escapeHtml(project.source_type || "")}</small>
          <small>${project.source_proposal_id ? `proposal ${escapeHtml(project.source_proposal_id)}` : ""}</small>
          <small>${project.campaign_brief_id ? `brief ${escapeHtml(project.campaign_brief_id)}` : ""}</small>
          <small>${escapeHtml(project.objective || "")}</small>
        </td>
        <td>
          <div class="campaign-project-scenes">
            ${scenes.length === 0 ? `<p class="empty">シーンはまだありません。</p>` : scenes.map((scene) => renderCampaignProjectScene(project, scene)).join("")}
            ${renderCampaignProjectSceneCreateForm(project)}
          </div>
        </td>
        <td>
          ${events.length ? `
            <div class="campaign-project-events">
              ${events.slice(0, 6).map(renderCampaignProjectEvent).join("")}
            </div>
          ` : `<small>履歴なし</small>`}
        </td>
        <td>
          <div class="campaign-project-actions">
            <a class="campaign-project-preview-link" href="/admin/campaign-projects/${encodeURIComponent(project.campaign_project_id || "")}/editor" target="_blank" rel="noreferrer" data-campaign-project-editor="${escapeAttr(project.campaign_project_id)}">編集</a>
            <a class="campaign-project-preview-link" href="/admin/campaign-projects/${encodeURIComponent(project.campaign_project_id || "")}/preview" target="_blank" rel="noreferrer" data-campaign-project-preview="${escapeAttr(project.campaign_project_id)}">プレビュー</a>
            <button class="secondary" type="button" data-campaign-project-validate="${escapeAttr(project.campaign_project_id)}">検証</button>
            <button class="danger" type="button" data-campaign-project-delete="${escapeAttr(project.campaign_project_id)}">削除</button>
          </div>
          ${errors.length ? `<div class="campaign-project-validation">${errors.map(renderValidationError).join("")}</div>` : ""}
        </td>
      </tr>
    `;
  }

  function renderCampaignProjectEvent(event) {
    return `
      <small>
        ${escapeHtml(event.action || "")}
        ${event.campaign_project_scene_id ? `<span>${escapeHtml(event.campaign_project_scene_id)}</span>` : ""}
        ${event.actor_id ? `<span>${escapeHtml(event.actor_id)}</span>` : ""}
        <span>${escapeHtml(formatTime(event.created_at))}</span>
      </small>
    `;
  }

  function renderCampaignProjectScene(project, scene) {
    const errors = scene.validation_errors || [];
    return `
      <form class="campaign-project-scene campaign-project-scene-update" data-project-id="${escapeAttr(project.campaign_project_id)}" data-scene-id="${escapeAttr(scene.campaign_project_scene_id)}">
        <div class="campaign-project-scene-heading">
          <strong>#${escapeHtml(scene.scene_order || "")} ${escapeHtml(scene.headline || "")}</strong>
          <span class="update-status update-status-${escapeAttr(campaignProjectSceneStatusClass(scene.status))}">${escapeHtml(CAMPAIGN_PROJECT_SCENE_STATUS_LABELS[scene.status] || scene.status || "")}</span>
        </div>
        ${renderCampaignProjectSceneFields(scene, { includeOrder: true })}
        ${errors.length ? `<div class="campaign-project-validation">${errors.map(renderValidationError).join("")}</div>` : ""}
        <button type="submit">シーン保存</button>
        <button class="danger" type="button" data-project-id="${escapeAttr(project.campaign_project_id)}" data-campaign-project-scene-delete="${escapeAttr(scene.campaign_project_scene_id)}">シーン削除</button>
      </form>
    `;
  }

  function renderCampaignProjectSceneCreateForm(project) {
    return `
      <form class="campaign-project-scene campaign-project-scene-create" data-project-id="${escapeAttr(project.campaign_project_id)}">
        <div class="campaign-project-scene-heading">
          <strong>シーン追加</strong>
        </div>
        ${renderCampaignProjectSceneFields({
          scene_type: "offer",
          headline: "",
          body_text: "",
          visual_direction: "",
          cta_text: project.cta || "",
          duration_seconds: 5,
          asset_requirements: []
        }, { includeOrder: false })}
        <button type="submit">シーン追加</button>
      </form>
    `;
  }

  function renderCampaignProjectSceneFields(scene, options = {}) {
    return `
      ${options.includeOrder ? `<input name="scene_order" type="number" min="1" step="1" value="${escapeHtml(scene.scene_order || 1)}" aria-label="順番" required>` : ""}
      <select name="scene_type" aria-label="シーン種別" required>
        ${CAMPAIGN_SCENE_TYPE_OPTIONS.map(([value, label]) => (
          `<option value="${escapeAttr(value)}"${value === scene.scene_type ? " selected" : ""}>${escapeHtml(label)}</option>`
        )).join("")}
      </select>
      <input name="headline" type="text" value="${escapeHtml(scene.headline || "")}" placeholder="見出し" aria-label="見出し" required>
      <textarea name="body_text" rows="2" placeholder="本文" aria-label="本文" required>${escapeHtml(scene.body_text || "")}</textarea>
      <textarea name="visual_direction" rows="2" placeholder="ビジュアル指示" aria-label="ビジュアル指示" required>${escapeHtml(scene.visual_direction || "")}</textarea>
      <input name="cta_text" type="text" value="${escapeHtml(scene.cta_text || "")}" placeholder="CTA" aria-label="CTA" required>
      <input name="duration_seconds" type="number" min="1" step="1" value="${escapeHtml(scene.duration_seconds || 5)}" aria-label="秒数" required>
      <textarea name="asset_requirements" rows="2" placeholder="必要素材（1行1項目）" aria-label="必要素材">${escapeHtml(listToText(scene.asset_requirements))}</textarea>
    `;
  }

  function renderValidationError(error) {
    return `<small>${escapeHtml(error.field || "")} ${escapeHtml(error.code || "")}: ${escapeHtml(error.message || "")}</small>`;
  }

  async function handleCampaignProjectFromProposal(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const proposal = campaignProposalById(form.elements.campaign_proposal_id.value);
    if (!proposal) return;
    button.disabled = true;
    button.textContent = "作成中";
    try {
      await fetchJson("/api/admin/campaign-projects/from-proposal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_proposal_id: proposal.campaign_proposal_id,
          title: form.elements.title.value || proposal.title || "",
          scenes: defaultScenesFromProposal(proposal)
        })
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "提案からプロジェクトを作成できませんでした。");
      button.disabled = false;
      button.textContent = "提案から作成";
    }
  }

  async function handleCampaignProjectFromBrief(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const proposal = (state.campaignProposals || []).find((item) => item.campaign_brief_id === form.elements.campaign_brief_id.value);
    if (!proposal) return;
    button.disabled = true;
    button.textContent = "作成中";
    try {
      await fetchJson("/api/admin/campaign-projects/from-brief", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaign_brief_id: proposal.campaign_brief_id,
          title: form.elements.title.value || proposal.title || "",
          scenes: defaultScenesFromProposal(proposal)
        })
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "Briefからプロジェクトを作成できませんでした。");
      button.disabled = false;
      button.textContent = "Briefから作成";
    }
  }

  async function handleCampaignProjectFreeInput(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const brief = {
      objective: form.elements.objective.value,
      target_audience: form.elements.target_audience.value,
      store_context: form.elements.store_context.value,
      offer_or_message: form.elements.offer_or_message.value,
      cta: form.elements.cta.value,
      success_metrics: listFromText(form.elements.success_metrics.value),
      constraints: listFromText(form.elements.constraints.value)
    };
    button.disabled = true;
    button.textContent = "作成中";
    try {
      await fetchJson("/api/admin/campaign-projects/free-input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: form.elements.tenant_id.value,
          store_id: form.elements.store_id.value,
          screen_group_id: form.elements.screen_group_id.value,
          title: form.elements.title.value,
          ...brief,
          scenes: defaultScenesFromBrief({
            title: form.elements.title.value,
            ...brief
          })
        })
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "入力からプロジェクトを作成できませんでした。");
      button.disabled = false;
      button.textContent = "入力から作成";
    }
  }

  async function handleCampaignProjectValidate(event) {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "検証中";
    try {
      const result = await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(button.dataset.campaignProjectValidate || "")}/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({})
      });
      if (!result.valid) {
        window.alert(`検証エラー: ${result.validation_errors?.length || 0}件`);
      }
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "プロジェクト検証に失敗しました。");
      button.disabled = false;
      button.textContent = "検証";
    }
  }

  async function handleCampaignProjectDelete(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(button.dataset.campaignProjectDelete || "")}`, {
        method: "DELETE"
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "プロジェクト削除に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleCampaignProjectSceneCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "追加中";
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenePayloadFromForm(form, { includeOrder: false }))
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "シーン追加に失敗しました。");
      button.disabled = false;
      button.textContent = "シーン追加";
    }
  }

  async function handleCampaignProjectSceneUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(form.dataset.projectId || "")}/scenes/${encodeURIComponent(form.dataset.sceneId || "")}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scenePayloadFromForm(form, { includeOrder: true }))
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "シーン保存に失敗しました。");
      button.disabled = false;
      button.textContent = "シーン保存";
    }
  }

  async function handleCampaignProjectSceneDelete(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/campaign-projects/${encodeURIComponent(button.dataset.projectId || "")}/scenes/${encodeURIComponent(button.dataset.campaignProjectSceneDelete || "")}`, {
        method: "DELETE"
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "シーン削除に失敗しました。");
      button.disabled = false;
    }
  }

  function campaignProposalById(proposalId) {
    return (state.campaignProposals || []).find((proposal) => proposal.campaign_proposal_id === proposalId);
  }

  function campaignProposalLabel(proposal) {
    return `${proposal.proposal_month || ""} ${proposal.title || proposal.campaign_proposal_id || ""} / ${proposal.store_id || ""} / ${proposal.screen_group_id || ""}`.trim();
  }

  function scenePayloadFromForm(form, options = {}) {
    const payload = {
      scene_type: form.elements.scene_type.value,
      headline: form.elements.headline.value,
      body_text: form.elements.body_text.value,
      visual_direction: form.elements.visual_direction.value,
      cta_text: form.elements.cta_text.value,
      duration_seconds: Number.parseInt(form.elements.duration_seconds.value, 10) || 0,
      asset_requirements: listFromText(form.elements.asset_requirements.value)
    };
    if (options.includeOrder && form.elements.scene_order) {
      payload.scene_order = Number.parseInt(form.elements.scene_order.value, 10) || 0;
    }
    return payload;
  }

  function defaultScenesFromProposal(proposal) {
    const outline = outlineTextItems(proposal.three_screen_outline);
    const cta = safeText(proposal.qr_flow || proposal.cta || "QRコードから詳細を確認", 80);
    return [
      {
        scene_order: 1,
        scene_type: "intro",
        headline: safeText(proposal.title || "キャンペーン告知", 80),
        body_text: safeText(proposal.objective || "店舗の今月の案内をわかりやすく伝える", 300),
        visual_direction: safeText(outline[0] || "店舗の雰囲気と対象商品の写真を大きく見せる", 300),
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["operator_selected_image"]
      },
      {
        scene_order: 2,
        scene_type: "offer",
        headline: safeText(proposal.target_audience || "おすすめ情報", 80),
        body_text: safeText(proposal.expected_effect || proposal.objective || "来店中のお客様に見てもらいたい内容を短く伝える", 300),
        visual_direction: safeText(outline[1] || outline[0] || "商品・サービスの利用シーンを中心に配置する", 300),
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["operator_selected_image"]
      },
      {
        scene_order: 3,
        scene_type: "cta",
        headline: "詳しくはこちら",
        body_text: safeText(proposal.qr_flow || "画面のQRコードから詳細を確認できます", 300),
        visual_direction: safeText(outline[2] || "QRコードと短い案内文を読みやすく配置する", 300),
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["qr_code", "operator_selected_image"]
      }
    ];
  }

  function defaultScenesFromBrief(brief) {
    const cta = safeText(brief.cta || "詳しく確認", 80);
    return [
      {
        scene_order: 1,
        scene_type: "intro",
        headline: safeText(brief.title || brief.objective || "キャンペーン告知", 80),
        body_text: safeText(brief.store_context || brief.objective || "店舗の前提を踏まえて案内する", 300),
        visual_direction: "店舗写真または商品写真を中央に配置する",
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["operator_selected_image"]
      },
      {
        scene_order: 2,
        scene_type: "offer",
        headline: safeText(brief.target_audience || "おすすめ", 80),
        body_text: safeText(brief.offer_or_message || brief.objective || "訴求内容を短く表示する", 300),
        visual_direction: "訴求文と対象商品を並べて視認性を優先する",
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["operator_selected_image"]
      },
      {
        scene_order: 3,
        scene_type: "cta",
        headline: "詳しくはこちら",
        body_text: safeText(brief.cta || "次の行動を案内する", 300),
        visual_direction: "CTAとQR配置の余白を確保する",
        cta_text: cta,
        duration_seconds: 5,
        asset_requirements: ["qr_code"]
      }
    ];
  }

  function outlineTextItems(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => {
      if (typeof item === "string") return item;
      return item?.copy || item?.headline || item?.body_text || "";
    }).map((item) => String(item || "").trim()).filter(Boolean);
  }

  function listFromText(value) {
    return String(value || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean);
  }

  function listToText(value) {
    if (!Array.isArray(value)) return "";
    return value.map((item) => {
      if (typeof item === "string") return item;
      return JSON.stringify(item);
    }).join("\n");
  }

  function safeText(value, maxLength) {
    return String(value || "").trim().slice(0, maxLength);
  }

  async function handleCampaignProposalCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "追加中";
    try {
      await fetchJson("/api/admin/campaign-proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: form.elements.tenant_id.value,
          store_id: form.elements.store_id.value,
          screen_group_id: form.elements.screen_group_id.value,
          proposal_month: form.elements.proposal_month.value,
          title: form.elements.title.value,
          objective: form.elements.objective.value,
          target_audience: form.elements.target_audience.value,
          three_screen_outline: outlineFromText(form.elements.three_screen_outline.value),
          qr_flow: form.elements.qr_flow.value,
          expected_effect: form.elements.expected_effect.value,
          status: "proposed"
        })
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "AI販促提案の追加に失敗しました。");
      button.disabled = false;
      button.textContent = "提案を追加";
    }
  }

  async function handleAdminContextCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "追加中";
    try {
      await fetchJson("/api/admin/customer-context-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenant_id: form.elements.tenant_id.value,
          store_id: form.elements.store_id.value,
          screen_group_id: form.elements.screen_group_id.value,
          context_category: form.elements.context_category.value,
          visibility_scope: form.elements.visibility_scope.value,
          source_owner: "misell_operator",
          source_type: "operator_input",
          confidence: "operator_confirmed",
          item_type: "operator_note",
          item_key: form.elements.item_key.value,
          value: { text: form.elements.text.value },
          status: "active"
        })
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "文脈の追加に失敗しました。");
      button.disabled = false;
      button.textContent = "文脈を追加";
    }
  }

  async function handleAdminContextUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.source.files?.[0];
    if (!file) return;
    const button = form.querySelector("button");
    button.disabled = true;
    const body = new FormData();
    body.append("source", file);
    body.append("usage_notes", form.elements.usage_notes.value || "");
    try {
      await fetchJson(`/api/admin/customer-context-items/${encodeURIComponent(form.dataset.contextId)}/source-assets`, {
        method: "POST",
        body
      });
      form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "添付に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleAdminContextDelete(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/customer-context-items/${encodeURIComponent(button.dataset.adminContextDelete || "")}`, {
        method: "DELETE"
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "文脈の削除に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleAdminSourceAssetDelete(event) {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await fetchJson(`/api/admin/customer-context-source-assets/${encodeURIComponent(button.dataset.adminSourceAssetDelete || "")}`, {
        method: "DELETE"
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "添付ファイルの削除に失敗しました。");
      button.disabled = false;
    }
  }

  function contextCategoryOptions(current) {
    return window.MisellContextUi?.categoryOptions?.(current, { includeInternal: true }) || "";
  }

  function contextCategoryLabel(value) {
    return window.MisellContextUi?.categoryLabel?.(value) || value || "";
  }

  function contextText(value) {
    return window.MisellContextUi?.contextText?.(value) || "";
  }

  function outlineFromText(value) {
    return String(value || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((copy, index) => ({
      order: index + 1,
      copy
    }));
  }

  function uniqueTenantsFromStores(stores) {
    const map = new Map();
    for (const store of stores) {
      if (!store.tenant_id || map.has(store.tenant_id)) continue;
      map.set(store.tenant_id, {
        tenant_id: store.tenant_id,
        tenant_name: store.tenant_name || store.tenant_id
      });
    }
    return Array.from(map.values());
  }

  function uniqueScreenGroupsFromDevices(devices) {
    const map = new Map();
    for (const device of devices) {
      if (!device.screen_group_id || map.has(device.screen_group_id)) continue;
      map.set(device.screen_group_id, {
        screen_group_id: device.screen_group_id,
        screen_group_name: device.screen_group_name || device.screen_group_id,
        store_id: device.store_id
      });
    }
    return Array.from(map.values());
  }

  function renderCounterOrders(orders) {
    if (!els.counterOrders) return;
    if (orders.length === 0) {
      els.counterOrders.innerHTML = `<p class="empty">カウンター注文はまだありません。</p>`;
      return;
    }
    els.counterOrders.innerHTML = `
      <table class="counter-orders-table">
        <thead>
          <tr>
            <th>Status</th>
            <th>受付</th>
            <th>店舗</th>
            <th>内容</th>
            <th>合計</th>
            <th>発行</th>
            <th>運用</th>
          </tr>
        </thead>
        <tbody>
          ${orders.slice(0, 100).map(renderCounterOrderRow).join("")}
        </tbody>
      </table>
    `;
    els.counterOrders.querySelectorAll(".counter-order-action").forEach((form) => {
      form.addEventListener("submit", handleCounterOrderStatusUpdate);
    });
  }

  function renderCounterOrderRow(order) {
    const items = Array.isArray(order.items) ? order.items : [];
    return `
      <tr>
        <td>
          <span class="update-status update-status-${escapeAttr(counterOrderStatusClass(order.status))}">
            ${escapeHtml(COUNTER_ORDER_STATUS_LABELS[order.status] || order.status || "")}
          </span>
        </td>
        <td>${escapeHtml(order.order_number || "")}<small>確認 ${escapeHtml(order.verify_code || "")}</small></td>
        <td>${escapeHtml(order.store_id || "")}<small>${escapeHtml(order.business_date || "")}</small></td>
        <td>${escapeHtml(items.map((item) => `${item.item_name_snapshot} x ${item.quantity}`).join(" / "))}</td>
        <td>${formatCurrency(order.total_amount, order.currency)}</td>
        <td>${formatTime(order.issued_at)}</td>
        <td>
          <form class="counter-order-action" data-order-id="${escapeHtml(order.counter_order_id || "")}">
            <select name="status" aria-label="注文ステータス">
              ${Object.entries(COUNTER_ORDER_STATUS_LABELS).map(([value, label]) => (
                `<option value="${escapeAttr(value)}"${value === order.status ? " selected" : ""}>${escapeHtml(label)}</option>`
              )).join("")}
            </select>
            <input name="reason" type="text" placeholder="理由" aria-label="理由">
            <button type="submit">保存</button>
          </form>
        </td>
      </tr>
    `;
  }

  async function handleCounterOrderStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const orderId = form.dataset.orderId;
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/admin/counter-orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: form.elements.status.value,
          reason: form.elements.reason.value
        })
      });
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "カウンター注文の保存に失敗しました。");
      button.disabled = false;
      button.textContent = "保存";
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

  function formatCurrency(amount, currency) {
    const value = Number(amount || 0).toLocaleString("ja-JP");
    return (currency || "JPY") === "JPY" ? `${value}円` : `${value} ${currency || ""}`;
  }

  function releaseManifestStatusClass(status) {
    if (status === "active") return "success";
    if (status === "retired") return "idle";
    return "pending";
  }

  function rolloutStatusClass(status) {
    if (status === "ready") return "success";
    if (status === "failed") return "failed";
    if (status === "updating") return "pending";
    return "idle";
  }

  function counterOrderStatusClass(status) {
    if (status === "issued") return "success";
    if (status === "redeemed") return "succeeded";
    if (status === "cancelled" || status === "expired") return "failed";
    return "idle";
  }

  function campaignProjectStatusClass(status) {
    if (status === "validated") return "success";
    if (status === "deleted") return "failed";
    if (status === "archived") return "idle";
    return "pending";
  }

  function campaignProjectSceneStatusClass(status) {
    if (status === "valid") return "success";
    if (status === "invalid" || status === "deleted") return "failed";
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
