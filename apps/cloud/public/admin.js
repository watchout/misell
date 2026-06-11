(function () {
  const state = {
    devices: [],
    summary: null,
    assets: [],
    releaseManifests: [],
    contentManifests: [],
    contentRollout: null,
    advertisers: [],
    campaigns: [],
    sponsorshipProducts: [],
    campaignPlacements: [],
    campaignAssets: [],
    playlistRules: [],
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

  const ROLLOUT_STATUS_LABELS = {
    ready: "反映済み",
    pending: "未反映",
    updating: "同期中",
    failed: "失敗"
  };

  const ADVERTISER_STATUS_OPTIONS = [
    ["active", "active"],
    ["paused", "paused"],
    ["archived", "archived"]
  ];

  const CAMPAIGN_STATUS_OPTIONS = [
    ["draft", "draft"],
    ["active", "active"],
    ["paused", "paused"],
    ["completed", "completed"],
    ["archived", "archived"]
  ];

  const SPONSORSHIP_PRODUCT_STATUS_OPTIONS = [
    ["active", "active"],
    ["draft", "draft"],
    ["retired", "retired"]
  ];

  const CAMPAIGN_PLACEMENT_STATUS_OPTIONS = [
    ["draft", "draft"],
    ["active", "active"],
    ["paused", "paused"],
    ["retired", "retired"]
  ];

  const CAMPAIGN_ASSET_STATUS_OPTIONS = [
    ["active", "active"],
    ["draft", "draft"],
    ["retired", "retired"]
  ];

  const CAMPAIGN_ASSET_ROLE_OPTIONS = [
    ["main_video", "main video"],
    ["wide_background", "wide background"],
    ["qr_panel", "QR panel"],
    ["logo", "logo"],
    ["still", "still"],
    ["thumbnail", "thumbnail"],
    ["other", "other"]
  ];

  const PLAYLIST_RULE_STATUS_OPTIONS = [
    ["draft", "draft"],
    ["active", "active"],
    ["paused", "paused"],
    ["retired", "retired"]
  ];

  const PLAYLIST_RULE_TYPE_OPTIONS = [
    ["weighted", "weighted"],
    ["manual", "manual"],
    ["time_slot", "time slot"],
    ["exclusive", "exclusive"]
  ];

  const PRICE_MODEL_OPTIONS = [
    ["manual_quote", "手動見積"],
    ["monthly_fixed", "月額固定"],
    ["period_fixed", "期間固定"],
    ["impression_reference", "imp参考"],
    ["free", "無償協賛"]
  ];

  const CAMPAIGN_PLACEMENT_LAYOUT_OPTIONS = [
    ["wide", "3面"],
    ["two-plus-one", "2面+1面"],
    ["left-center", "左+中央"],
    ["center-right", "中央+右"],
    ["three-zone", "3分割"],
    ["single-left", "左単面"],
    ["single-center", "中央単面"],
    ["single-right", "右単面"],
    ["qr-panel", "QR"],
    ["ticker", "ticker"]
  ];

  const els = {
    summary: document.getElementById("summary"),
    devices: document.getElementById("devices"),
    alerts: document.getElementById("alerts"),
    notifications: document.getElementById("notifications"),
    sponsorship: document.getElementById("sponsorship"),
    releaseManifests: document.getElementById("release-manifests"),
    contentManifests: document.getElementById("content-manifests"),
    assets: document.getElementById("assets"),
    logBundles: document.getElementById("log-bundles"),
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
    const [
      summary,
      devices,
      alerts,
      notifications,
      advertisers,
      campaigns,
      sponsorshipProducts,
      campaignPlacements,
      campaignAssets,
      playlistRules,
      releaseManifests,
      contentManifests,
      assets,
      logBundles,
      contentRollout
    ] = await Promise.all([
      fetchJson("/api/admin/summary"),
      fetchJson("/api/admin/devices"),
      fetchJson("/api/admin/alerts"),
      fetchJson("/api/admin/alert-notifications"),
      fetchJson("/api/admin/advertisers"),
      fetchJson("/api/admin/campaigns"),
      fetchJson("/api/admin/sponsorship-products"),
      fetchJson("/api/admin/campaign-placements"),
      fetchJson("/api/admin/campaign-assets"),
      fetchJson("/api/admin/playlist-rules"),
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
    state.assets = assets.assets || [];
    state.advertisers = advertisers.advertisers || [];
    state.campaigns = campaigns.campaigns || [];
    state.sponsorshipProducts = sponsorshipProducts.sponsorship_products || [];
    state.campaignPlacements = campaignPlacements.campaign_placements || [];
    state.campaignAssets = campaignAssets.campaign_assets || [];
    state.playlistRules = playlistRules.playlist_rules || [];
    state.releaseManifests = releaseManifests.release_manifests || [];
    state.contentManifests = contentManifests.content_manifests || [];
    state.contentRollout = contentRollout?.rollout || null;
    renderSummary(summary);
    renderDevices(state.devices);
    renderAlerts(alerts.alerts || []);
    renderNotifications(notifications);
    renderSponsorship();
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

  function renderSponsorship() {
    if (!els.sponsorship) return;
    els.sponsorship.innerHTML = `
      <div class="sponsorship-grid">
        <form class="sponsorship-card advertiser-create">
          <h3>広告主</h3>
          <input name="advertiser_id" type="text" placeholder="Advertiser ID" aria-label="Advertiser ID">
          <input name="advertiser_name" type="text" placeholder="広告主名" aria-label="広告主名" required>
          <input name="agency_name" type="text" placeholder="代理店" aria-label="代理店">
          <input name="contact_email" type="email" placeholder="Email" aria-label="Email">
          <select name="status" aria-label="Advertiser status">
            ${optionTags(ADVERTISER_STATUS_OPTIONS, "active")}
          </select>
          <button type="submit">作成</button>
        </form>
        <form class="sponsorship-card campaign-create">
          <h3>Campaign</h3>
          <input name="campaign_id" type="text" placeholder="Campaign ID" aria-label="Campaign ID">
          <select name="advertiser_id" aria-label="Advertiser">
            <option value="">広告主なし</option>
            ${state.advertisers.map((advertiser) => (
              `<option value="${escapeHtml(advertiser.advertiser_id)}">${escapeHtml(advertiser.advertiser_name || advertiser.advertiser_id)}</option>`
            )).join("")}
          </select>
          <input name="campaign_name" type="text" placeholder="Campaign名" aria-label="Campaign名" required>
          <select name="status" aria-label="Campaign status">
            ${optionTags(CAMPAIGN_STATUS_OPTIONS, "draft")}
          </select>
          <input name="start_date" type="date" aria-label="Start date">
          <input name="end_date" type="date" aria-label="End date">
          <input name="target_store_ids" type="text" placeholder="Store IDs" aria-label="Store IDs">
          <input name="target_time_slots" type="text" placeholder="09:00-18:00" aria-label="Time slots">
          <input name="qr_url" type="url" placeholder="QR URL" aria-label="QR URL">
          <button type="submit">作成</button>
        </form>
        <form class="sponsorship-card sponsorship-product-create">
          <h3>協賛商品</h3>
          <input name="sponsorship_product_id" type="text" placeholder="Product ID" aria-label="Product ID">
          <input name="tenant_id" type="text" value="TEN-LOCAL" placeholder="Tenant ID" aria-label="Tenant ID">
          <input name="store_id" type="text" placeholder="Store ID" aria-label="Store ID">
          <input name="product_name" type="text" placeholder="商品名" aria-label="商品名" required>
          <input name="allowed_layouts" type="text" value="wide,two-plus-one,three-zone,qr-panel" aria-label="Allowed layouts">
          <input name="max_share_percent" type="number" min="1" max="100" value="20" aria-label="Max share percent">
          <input name="default_duration" type="number" min="1" max="300" value="15" aria-label="Default duration">
          <select name="price_model" aria-label="Price model">
            ${optionTags(PRICE_MODEL_OPTIONS, "manual_quote")}
          </select>
          <select name="status" aria-label="Product status">
            ${optionTags(SPONSORSHIP_PRODUCT_STATUS_OPTIONS, "active")}
          </select>
          <button type="submit">作成</button>
        </form>
        <form class="sponsorship-card campaign-placement-create">
          <h3>配置</h3>
          <input name="campaign_placement_id" type="text" placeholder="Placement ID" aria-label="Placement ID">
          <select name="campaign_id" aria-label="Campaign" required>
            <option value="">Campaign</option>
            ${state.campaigns.map((campaign) => (
              `<option value="${escapeHtml(campaign.campaign_id)}">${escapeHtml(campaign.campaign_name || campaign.campaign_id)}</option>`
            )).join("")}
          </select>
          <select name="sponsorship_product_id" aria-label="Sponsorship product" required>
            <option value="">協賛商品</option>
            ${state.sponsorshipProducts.map((product) => (
              `<option value="${escapeHtml(product.sponsorship_product_id)}">${escapeHtml(product.product_name || product.sponsorship_product_id)}</option>`
            )).join("")}
          </select>
          <select name="layout" aria-label="Layout">
            ${optionTags(CAMPAIGN_PLACEMENT_LAYOUT_OPTIONS, "wide")}
          </select>
          <input name="share_percent" type="number" min="1" max="100" value="10" aria-label="Share percent">
          <input name="start_date" type="date" aria-label="Start date">
          <input name="end_date" type="date" aria-label="End date">
          <input name="time_slots" type="text" placeholder="09:00-18:00" aria-label="Time slots">
          <select name="status" aria-label="Placement status">
            ${optionTags(CAMPAIGN_PLACEMENT_STATUS_OPTIONS, "draft")}
          </select>
          <button type="submit">作成</button>
        </form>
        <form class="sponsorship-card campaign-asset-create">
          <h3>Campaign素材</h3>
          <input name="campaign_asset_id" type="text" placeholder="Campaign asset ID" aria-label="Campaign asset ID">
          <select name="campaign_id" aria-label="Campaign" required>
            <option value="">Campaign</option>
            ${state.campaigns.map((campaign) => (
              `<option value="${escapeHtml(campaign.campaign_id)}">${escapeHtml(campaign.campaign_name || campaign.campaign_id)}</option>`
            )).join("")}
          </select>
          <select name="asset_id" aria-label="Cloud asset" required>
            <option value="">Cloud素材</option>
            ${state.assets.map((asset) => (
              `<option value="${escapeHtml(asset.asset_id)}">${escapeHtml(asset.label || asset.asset_id)}</option>`
            )).join("")}
          </select>
          <select name="role" aria-label="Asset role">
            ${optionTags(CAMPAIGN_ASSET_ROLE_OPTIONS, "main_video")}
          </select>
          <input name="label" type="text" placeholder="素材ラベル" aria-label="Campaign asset label">
          <input name="display_order" type="number" min="0" max="1000" value="0" aria-label="Display order">
          <select name="status" aria-label="Campaign asset status">
            ${optionTags(CAMPAIGN_ASSET_STATUS_OPTIONS, "active")}
          </select>
          <button type="submit">作成</button>
        </form>
        <form class="sponsorship-card playlist-rule-create">
          <h3>Playlist rule</h3>
          <input name="playlist_rule_id" type="text" placeholder="Rule ID" aria-label="Playlist rule ID">
          <select name="campaign_placement_id" aria-label="Campaign placement" required>
            <option value="">配置</option>
            ${state.campaignPlacements.map((placement) => (
              `<option value="${escapeHtml(placement.campaign_placement_id)}">${escapeHtml(placement.campaign_placement_id)}</option>`
            )).join("")}
          </select>
          <input name="rule_name" type="text" placeholder="Rule名" aria-label="Rule name" required>
          <select name="rule_type" aria-label="Rule type">
            ${optionTags(PLAYLIST_RULE_TYPE_OPTIONS, "weighted")}
          </select>
          <input name="weight_percent" type="number" min="0" max="100" value="10" aria-label="Weight percent">
          <input name="priority" type="number" min="0" max="100" value="0" aria-label="Priority">
          <select name="status" aria-label="Playlist rule status">
            ${optionTags(PLAYLIST_RULE_STATUS_OPTIONS, "draft")}
          </select>
          <button type="submit">作成</button>
        </form>
      </div>
      <div class="sponsorship-tables">
        ${renderAdvertisersTable()}
        ${renderCampaignsTable()}
        ${renderSponsorshipProductsTable()}
        ${renderCampaignPlacementsTable()}
        ${renderCampaignAssetsTable()}
        ${renderPlaylistRulesTable()}
      </div>
    `;

    els.sponsorship.querySelector(".advertiser-create")?.addEventListener("submit", handleAdvertiserCreate);
    els.sponsorship.querySelector(".campaign-create")?.addEventListener("submit", handleCampaignCreate);
    els.sponsorship.querySelector(".sponsorship-product-create")?.addEventListener("submit", handleSponsorshipProductCreate);
    els.sponsorship.querySelector(".campaign-placement-create")?.addEventListener("submit", handleCampaignPlacementCreate);
    els.sponsorship.querySelector(".campaign-asset-create")?.addEventListener("submit", handleCampaignAssetCreate);
    els.sponsorship.querySelector(".playlist-rule-create")?.addEventListener("submit", handlePlaylistRuleCreate);
    els.sponsorship.querySelectorAll(".advertiser-status-action").forEach((form) => {
      form.addEventListener("submit", handleAdvertiserStatusUpdate);
    });
    els.sponsorship.querySelectorAll(".campaign-status-action").forEach((form) => {
      form.addEventListener("submit", handleCampaignStatusUpdate);
    });
    els.sponsorship.querySelectorAll(".sponsorship-product-status-action").forEach((form) => {
      form.addEventListener("submit", handleSponsorshipProductStatusUpdate);
    });
    els.sponsorship.querySelectorAll(".campaign-placement-status-action").forEach((form) => {
      form.addEventListener("submit", handleCampaignPlacementStatusUpdate);
    });
    els.sponsorship.querySelectorAll(".campaign-asset-status-action").forEach((form) => {
      form.addEventListener("submit", handleCampaignAssetStatusUpdate);
    });
    els.sponsorship.querySelectorAll(".playlist-rule-status-action").forEach((form) => {
      form.addEventListener("submit", handlePlaylistRuleStatusUpdate);
    });
  }

  function renderAdvertisersTable() {
    if (state.advertisers.length === 0) return `<p class="empty">広告主はまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>広告主</th><th>代理店</th><th>連絡先</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.advertisers.slice(0, 20).map((advertiser) => `
            <tr>
              <td>${escapeHtml(advertiser.advertiser_name)}<small>${escapeHtml(advertiser.advertiser_id)}</small></td>
              <td>${escapeHtml(advertiser.agency_name || "")}</td>
              <td>${escapeHtml(advertiser.contact_email || "")}</td>
              <td><span class="update-status update-status-${statusClass(advertiser.status)}">${escapeHtml(advertiser.status)}</span></td>
              <td>
                <form class="sponsorship-status-form advertiser-status-action" data-advertiser-id="${escapeHtml(advertiser.advertiser_id)}">
                  <select name="status" aria-label="Advertiser status">${optionTags(ADVERTISER_STATUS_OPTIONS, advertiser.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderCampaignsTable() {
    if (state.campaigns.length === 0) return `<p class="empty">campaignはまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>Campaign</th><th>広告主</th><th>期間</th><th>対象</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.campaigns.slice(0, 20).map((campaign) => `
            <tr>
              <td>${escapeHtml(campaign.campaign_name)}<small>${escapeHtml(campaign.campaign_id)}</small></td>
              <td>${escapeHtml(campaign.advertiser_name || campaign.advertiser_id || "")}</td>
              <td>${escapeHtml(dateRange(campaign.start_date, campaign.end_date))}</td>
              <td>${escapeHtml((campaign.target_store_ids || []).join(", "))}<small>${escapeHtml((campaign.target_time_slots || []).join(", "))}</small></td>
              <td><span class="update-status update-status-${statusClass(campaign.status)}">${escapeHtml(campaign.status)}</span></td>
              <td>
                <form class="sponsorship-status-form campaign-status-action" data-campaign-id="${escapeHtml(campaign.campaign_id)}">
                  <select name="status" aria-label="Campaign status">${optionTags(CAMPAIGN_STATUS_OPTIONS, campaign.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderSponsorshipProductsTable() {
    if (state.sponsorshipProducts.length === 0) return `<p class="empty">協賛商品はまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>協賛商品</th><th>Tenant/Store</th><th>Layout</th><th>上限</th><th>Price</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.sponsorshipProducts.slice(0, 20).map((product) => `
            <tr>
              <td>${escapeHtml(product.product_name)}<small>${escapeHtml(product.sponsorship_product_id)}</small></td>
              <td>${escapeHtml(product.tenant_id)}<small>${escapeHtml(product.store_id || "")}</small></td>
              <td>${escapeHtml((product.allowed_layouts || []).join(", "))}</td>
              <td>${formatNumber(product.max_share_percent)}%<small>${formatNumber(product.default_duration)}秒</small></td>
              <td>${escapeHtml(product.price_model || "")}</td>
              <td><span class="update-status update-status-${statusClass(product.status)}">${escapeHtml(product.status)}</span></td>
              <td>
                <form class="sponsorship-status-form sponsorship-product-status-action" data-product-id="${escapeHtml(product.sponsorship_product_id)}">
                  <select name="status" aria-label="Product status">${optionTags(SPONSORSHIP_PRODUCT_STATUS_OPTIONS, product.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderCampaignPlacementsTable() {
    if (state.campaignPlacements.length === 0) return `<p class="empty">campaign配置はまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>配置</th><th>Campaign</th><th>協賛商品</th><th>Layout</th><th>期間/時間帯</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.campaignPlacements.slice(0, 20).map((placement) => `
            <tr>
              <td>${escapeHtml(placement.campaign_placement_id)}<small>${escapeHtml(placement.tenant_id)} / ${escapeHtml(placement.store_id || "")}</small></td>
              <td>${escapeHtml(placement.campaign_name || placement.campaign_id)}</td>
              <td>${escapeHtml(placement.product_name || placement.sponsorship_product_id)}</td>
              <td>${escapeHtml(placement.layout)}<small>${formatNumber(placement.share_percent)}%</small></td>
              <td>${escapeHtml(dateRange(placement.start_date, placement.end_date))}<small>${escapeHtml((placement.time_slots || []).join(", "))}</small></td>
              <td><span class="update-status update-status-${statusClass(placement.status)}">${escapeHtml(placement.status)}</span></td>
              <td>
                <form class="sponsorship-status-form campaign-placement-status-action" data-placement-id="${escapeHtml(placement.campaign_placement_id)}">
                  <select name="status" aria-label="Placement status">${optionTags(CAMPAIGN_PLACEMENT_STATUS_OPTIONS, placement.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderCampaignAssetsTable() {
    if (state.campaignAssets.length === 0) return `<p class="empty">campaign素材はまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>Campaign素材</th><th>Campaign</th><th>Cloud素材</th><th>Role</th><th>Order</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.campaignAssets.slice(0, 20).map((asset) => `
            <tr>
              <td>${escapeHtml(asset.label || asset.campaign_asset_id)}<small>${escapeHtml(asset.campaign_asset_id)}</small></td>
              <td>${escapeHtml(asset.campaign_name || asset.campaign_id)}<small>${escapeHtml(asset.advertiser_name || "")}</small></td>
              <td>${escapeHtml(asset.asset_label || asset.asset_id)}<small>${escapeHtml(asset.asset_id || "")}</small></td>
              <td>${escapeHtml(asset.role || "")}</td>
              <td>${formatNumber(asset.display_order)}</td>
              <td><span class="update-status update-status-${statusClass(asset.status)}">${escapeHtml(asset.status)}</span></td>
              <td>
                <form class="sponsorship-status-form campaign-asset-status-action" data-campaign-asset-id="${escapeHtml(asset.campaign_asset_id)}">
                  <select name="status" aria-label="Campaign asset status">${optionTags(CAMPAIGN_ASSET_STATUS_OPTIONS, asset.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderPlaylistRulesTable() {
    if (state.playlistRules.length === 0) return `<p class="empty">playlist ruleはまだ登録されていません。</p>`;
    return `
      <table class="sponsorship-table">
        <thead><tr><th>Rule</th><th>配置</th><th>Campaign/商品</th><th>Type</th><th>Weight</th><th>Status</th><th>運用</th></tr></thead>
        <tbody>
          ${state.playlistRules.slice(0, 20).map((rule) => `
            <tr>
              <td>${escapeHtml(rule.rule_name)}<small>${escapeHtml(rule.playlist_rule_id)}</small></td>
              <td>${escapeHtml(rule.campaign_placement_id)}<small>${escapeHtml(rule.placement_layout || "")}</small></td>
              <td>${escapeHtml(rule.campaign_name || rule.campaign_id)}<small>${escapeHtml(rule.product_name || rule.sponsorship_product_id || "")}</small></td>
              <td>${escapeHtml(rule.rule_type || "")}<small>priority ${formatNumber(rule.priority)}</small></td>
              <td>${formatNumber(rule.weight_percent)}%</td>
              <td><span class="update-status update-status-${statusClass(rule.status)}">${escapeHtml(rule.status)}</span></td>
              <td>
                <form class="sponsorship-status-form playlist-rule-status-action" data-playlist-rule-id="${escapeHtml(rule.playlist_rule_id)}">
                  <select name="status" aria-label="Playlist rule status">${optionTags(PLAYLIST_RULE_STATUS_OPTIONS, rule.status)}</select>
                  <button type="submit">保存</button>
                </form>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  async function handleAdvertiserCreate(event) {
    event.preventDefault();
    await submitJsonForm(event.currentTarget, "/api/admin/advertisers", {
      advertiser_id: event.currentTarget.elements.advertiser_id.value,
      advertiser_name: event.currentTarget.elements.advertiser_name.value,
      agency_name: event.currentTarget.elements.agency_name.value,
      contact_email: event.currentTarget.elements.contact_email.value,
      status: event.currentTarget.elements.status.value
    });
  }

  async function handleCampaignCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, "/api/admin/campaigns", {
      campaign_id: form.elements.campaign_id.value,
      advertiser_id: form.elements.advertiser_id.value,
      campaign_name: form.elements.campaign_name.value,
      status: form.elements.status.value,
      start_date: form.elements.start_date.value,
      end_date: form.elements.end_date.value,
      target_store_ids: form.elements.target_store_ids.value,
      target_time_slots: form.elements.target_time_slots.value,
      qr_url: form.elements.qr_url.value
    });
  }

  async function handleSponsorshipProductCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, "/api/admin/sponsorship-products", {
      sponsorship_product_id: form.elements.sponsorship_product_id.value,
      tenant_id: form.elements.tenant_id.value,
      store_id: form.elements.store_id.value,
      product_name: form.elements.product_name.value,
      allowed_layouts: form.elements.allowed_layouts.value,
      max_share_percent: form.elements.max_share_percent.value,
      default_duration: form.elements.default_duration.value,
      price_model: form.elements.price_model.value,
      status: form.elements.status.value
    });
  }

  async function handleCampaignPlacementCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, "/api/admin/campaign-placements", {
      campaign_placement_id: form.elements.campaign_placement_id.value,
      campaign_id: form.elements.campaign_id.value,
      sponsorship_product_id: form.elements.sponsorship_product_id.value,
      layout: form.elements.layout.value,
      share_percent: form.elements.share_percent.value,
      start_date: form.elements.start_date.value,
      end_date: form.elements.end_date.value,
      time_slots: form.elements.time_slots.value,
      status: form.elements.status.value
    });
  }

  async function handleCampaignAssetCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, "/api/admin/campaign-assets", {
      campaign_asset_id: form.elements.campaign_asset_id.value,
      campaign_id: form.elements.campaign_id.value,
      asset_id: form.elements.asset_id.value,
      role: form.elements.role.value,
      label: form.elements.label.value,
      display_order: form.elements.display_order.value,
      status: form.elements.status.value
    });
  }

  async function handlePlaylistRuleCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, "/api/admin/playlist-rules", {
      playlist_rule_id: form.elements.playlist_rule_id.value,
      campaign_placement_id: form.elements.campaign_placement_id.value,
      rule_name: form.elements.rule_name.value,
      rule_type: form.elements.rule_type.value,
      weight_percent: form.elements.weight_percent.value,
      priority: form.elements.priority.value,
      status: form.elements.status.value
    });
  }

  async function handleAdvertiserStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/advertisers/${encodeURIComponent(form.dataset.advertiserId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function handleCampaignStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/campaigns/${encodeURIComponent(form.dataset.campaignId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function handleSponsorshipProductStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/sponsorship-products/${encodeURIComponent(form.dataset.productId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function handleCampaignPlacementStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/campaign-placements/${encodeURIComponent(form.dataset.placementId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function handleCampaignAssetStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/campaign-assets/${encodeURIComponent(form.dataset.campaignAssetId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function handlePlaylistRuleStatusUpdate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    await submitJsonForm(form, `/api/admin/playlist-rules/${encodeURIComponent(form.dataset.playlistRuleId)}`, {
      status: form.elements.status.value
    }, "PATCH", false);
  }

  async function submitJsonForm(form, url, payload, method = "POST", resetOnSuccess = true) {
    const button = form.querySelector("button[type='submit']");
    const originalText = button?.textContent || "保存";
    if (button) {
      button.disabled = true;
      button.textContent = method === "POST" ? "作成中" : "保存中";
    }
    try {
      await fetchJson(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (resetOnSuccess) form.reset();
      await loadDashboard();
    } catch (error) {
      window.alert(error.message || "保存に失敗しました。");
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
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

  function optionTags(options, selectedValue = "") {
    return options.map(([value, label]) => (
      `<option value="${escapeHtml(value)}"${value === selectedValue ? " selected" : ""}>${escapeHtml(label)}</option>`
    )).join("");
  }

  function statusClass(status) {
    if (status === "active" || status === "completed") return "success";
    if (status === "paused" || status === "draft") return "pending";
    if (status === "retired" || status === "archived") return "idle";
    return "idle";
  }

  function dateRange(start, end) {
    if (start && end) return `${start} - ${end}`;
    return start || end || "";
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

  function rolloutStatusClass(status) {
    if (status === "ready") return "success";
    if (status === "failed") return "failed";
    if (status === "updating") return "pending";
    return "idle";
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
