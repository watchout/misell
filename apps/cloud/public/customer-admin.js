(function () {
  const state = {
    session: null,
    stores: [],
    screenGroups: [],
    offers: [],
    orders: [],
    proposals: [],
    contextItems: [],
    report: null
  };

  const els = {
    login: document.getElementById("customer-login"),
    app: document.getElementById("customer-admin-app"),
    loginForm: document.getElementById("customer-login-form"),
    refresh: document.getElementById("customer-refresh"),
    logout: document.getElementById("customer-logout"),
    month: document.getElementById("customer-report-month"),
    storeFilter: document.getElementById("customer-store-filter"),
    screenGroupFilter: document.getElementById("customer-screen-group-filter"),
    summary: document.getElementById("customer-session-summary"),
    kpis: document.getElementById("customer-kpis"),
    proposals: document.getElementById("customer-campaign-proposals"),
    contextItems: document.getElementById("customer-context-items"),
    orders: document.getElementById("customer-orders"),
    storeSettings: document.getElementById("customer-store-settings"),
    offers: document.getElementById("customer-offers"),
    message: document.getElementById("customer-message")
  };

  els.loginForm?.addEventListener("submit", handleLogin);
  els.refresh?.addEventListener("click", loadCustomerDashboard);
  els.logout?.addEventListener("click", handleLogout);
  els.month.value = new Date().toISOString().slice(0, 7);
  els.month?.addEventListener("change", loadCustomerDashboard);
  els.storeFilter?.addEventListener("change", loadCustomerDashboard);
  els.screenGroupFilter?.addEventListener("change", loadCustomerDashboard);

  bootstrap();

  async function bootstrap() {
    const session = await fetchJson("/api/customer/session").catch(() => null);
    if (session?.session) {
      state.session = session.session;
      showApp();
      await loadCustomerDashboard();
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    const button = els.loginForm.querySelector("button");
    button.disabled = true;
    button.textContent = "確認中";
    try {
      const result = await fetchJson(`/customer/admin/${encodeURIComponent(window.MISELL_CUSTOMER_ACCESS_ID || "")}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: els.loginForm.elements.pin.value })
      });
      state.session = result.session;
      els.loginForm.reset();
      showApp();
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "ログインできませんでした。");
      button.disabled = false;
      button.textContent = "開始";
    }
  }

  async function handleLogout() {
    await fetchJson("/api/customer/logout", { method: "POST" }).catch(() => null);
    state.session = null;
    els.app.hidden = true;
    els.login.hidden = false;
  }

  function showApp() {
    els.login.hidden = true;
    els.app.hidden = false;
    populateStoreFilter();
    populateScreenGroupFilter();
  }

  async function loadCustomerDashboard() {
    if (!state.session) return;
    const [stores, screenGroups] = await Promise.all([
      fetchJson("/api/customer/store-settings").catch(() => ({ store_settings: [] })),
      fetchJson("/api/customer/screen-groups").catch(() => ({ screen_groups: [] }))
    ]);
    state.stores = stores.store_settings || [];
    state.screenGroups = screenGroups.screen_groups || [];
    populateStoreFilter();
    populateScreenGroupFilter();
    const storeId = selectedStoreId();
    const screenGroupId = selectedScreenGroupId();
    const params = new URLSearchParams({ month: els.month.value || new Date().toISOString().slice(0, 7) });
    if (storeId) params.set("store_id", storeId);
    const proposalParams = new URLSearchParams(params);
    if (screenGroupId) proposalParams.set("screen_group_id", screenGroupId);
    const proposalRequest = screenGroupId
      ? fetchJson(`/api/customer/campaign-proposals?${proposalParams}`).catch(() => ({ campaign_proposals: [] }))
      : Promise.resolve({ campaign_proposals: [] });
    const contextRequest = screenGroupId
      ? fetchJson(`/api/customer/context-items?${proposalParams}`).catch(() => ({ customer_context_items: [] }))
      : Promise.resolve({ customer_context_items: [] });
    const [report, proposals, contextItems, orders, offers] = await Promise.all([
      fetchJson(`/api/customer/reports/conversion?${params}`),
      proposalRequest,
      contextRequest,
      fetchJson(`/api/customer/counter-orders?${storeId ? `store_id=${encodeURIComponent(storeId)}&` : ""}limit=50`).catch(() => ({ counter_orders: [] })),
      fetchJson("/api/customer/offers")
    ]);
    state.report = report.report;
    state.proposals = proposals.campaign_proposals || [];
    state.contextItems = contextItems.customer_context_items || [];
    state.orders = orders.counter_orders || [];
    state.offers = offers.offers || [];
    renderSession();
    renderKpis();
    renderProposals();
    renderContextItems();
    renderOrders();
    renderStores();
    renderOffers();
  }

  function populateStoreFilter() {
    if (!els.storeFilter) return;
    const current = els.storeFilter.value;
    const allowed = state.stores.length
      ? state.stores
      : (state.session?.store_ids || []).map((store_id) => ({ store_id, store_name: store_id }));
    els.storeFilter.innerHTML = `
      ${allowed.length === 1 ? "" : `<option value="">全店舗</option>`}
      ${allowed.map((store) => `<option value="${escapeAttr(store.store_id)}">${escapeHtml(store.store_name || store.store_id)}</option>`).join("")}
    `;
    if (current && Array.from(els.storeFilter.options).some((option) => option.value === current)) {
      els.storeFilter.value = current;
    } else if (allowed.length === 1) {
      els.storeFilter.value = allowed[0].store_id;
    }
  }

  function selectedStoreId() {
    return els.storeFilter?.value || "";
  }

  function populateScreenGroupFilter() {
    if (!els.screenGroupFilter) return;
    const current = els.screenGroupFilter.value;
    const storeId = selectedStoreId();
    const allowed = (state.screenGroups || []).filter((group) => !storeId || group.store_id === storeId);
    els.screenGroupFilter.innerHTML = `
      ${allowed.length === 1 ? "" : `<option value="">画面グループ</option>`}
      ${allowed.map((group) => `<option value="${escapeAttr(group.screen_group_id)}">${escapeHtml(group.screen_group_name || group.screen_group_id)}</option>`).join("")}
    `;
    if (current && Array.from(els.screenGroupFilter.options).some((option) => option.value === current)) {
      els.screenGroupFilter.value = current;
    } else if (allowed.length === 1) {
      els.screenGroupFilter.value = allowed[0].screen_group_id;
    }
  }

  function selectedScreenGroupId() {
    return els.screenGroupFilter?.value || "";
  }

  function renderSession() {
    const session = state.session || {};
    els.summary.innerHTML = `
      <span>${escapeHtml(session.tenant_name || session.tenant_id || "")}</span>
      <span>${escapeHtml(session.role || "")}</span>
      <span>scope: ${(session.store_ids || []).length ? session.store_ids.map(escapeHtml).join(", ") : "tenant全体"}</span>
    `;
  }

  function renderKpis() {
    const kpis = state.report?.kpis || {};
    const items = [
      ["QR", kpis.qr_scan_count || 0],
      ["受付発行", kpis.counter_orders_issued_count || 0],
      ["引換済み", kpis.counter_orders_redeemed_count || 0],
      ["scan→受付", formatPercent(kpis.scan_to_order_rate)],
      ["受付→引換", formatPercent(kpis.order_to_redeem_rate)],
      ["受付発行額", formatCurrency(kpis.potential_sales_amount)],
      ["引換済み推定額", formatCurrency(kpis.estimated_redeemed_amount)]
    ];
    els.kpis.innerHTML = items.map(([label, value]) => `
      <section class="metric">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </section>
    `).join("");
  }

  function renderProposals() {
    if (!els.proposals) return;
    if (state.proposals.length === 0) {
      els.proposals.innerHTML = `<p class="empty">今月の提案はまだありません。</p>`;
      return;
    }
    els.proposals.innerHTML = state.proposals.map((proposal) => `
      <article class="customer-panel customer-proposal" data-proposal-id="${escapeAttr(proposal.campaign_proposal_id)}">
        <div>
          <strong>${escapeHtml(proposal.title || "")}</strong>
          <span>${escapeHtml(proposal.objective || "")}</span>
          <span>${escapeHtml(proposal.target_audience || "")}</span>
        </div>
        ${renderProposalOutline(proposal)}
        <div>
          <span>QR: ${escapeHtml(proposal.qr_flow || "未設定")}</span>
          <span>狙い: ${escapeHtml(proposal.expected_effect || "未設定")}</span>
          <span>Status: ${escapeHtml(proposal.status || "")}</span>
          ${proposal.campaign_brief_id ? `<span>Brief: ${escapeHtml(proposal.campaign_brief_id)}</span>` : ""}
          ${proposal.rejected_reason ? `<span>却下理由: ${escapeHtml(proposal.rejected_reason)}</span>` : ""}
        </div>
        <form class="customer-proposal-action">
          <input name="rejected_reason" type="text" placeholder="却下理由" aria-label="却下理由" value="${escapeAttr(proposal.rejected_reason || "")}">
          <button name="status" value="selected" type="submit">採用</button>
          <button name="status" value="held" type="submit">保留</button>
          <button name="status" value="rejected" type="submit">却下</button>
        </form>
      </article>
    `).join("");
    els.proposals.querySelectorAll(".customer-proposal-action").forEach((form) => {
      form.addEventListener("submit", handleProposalAction);
    });
  }

  function renderProposalOutline(proposal) {
    const outline = Array.isArray(proposal.three_screen_outline) ? proposal.three_screen_outline : [];
    if (outline.length === 0) return `<p class="empty">3連ラフは未設定です。</p>`;
    return `
      <ol class="proposal-outline">
        ${outline.slice(0, 6).map((item) => `<li>${escapeHtml(item.copy || item.text || item.title || JSON.stringify(item))}</li>`).join("")}
      </ol>
    `;
  }

  async function handleProposalAction(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter;
    const status = submitter?.value || "";
    const proposalId = form.closest(".customer-proposal")?.dataset.proposalId || "";
    const button = submitter || form.querySelector("button");
    button.disabled = true;
    try {
      await fetchJson(`/api/customer/campaign-proposals/${encodeURIComponent(proposalId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          rejected_reason: form.elements.rejected_reason.value
        })
      });
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "提案の更新に失敗しました。");
      button.disabled = false;
    }
  }

  function renderContextItems() {
    if (!els.contextItems) return;
    const canEdit = ["customer_admin", "customer_editor"].includes(state.session?.role);
    const screenGroupId = selectedScreenGroupId();
    els.contextItems.innerHTML = `
      ${canEdit && screenGroupId ? renderContextCreateForm() : ""}
      ${!screenGroupId ? `<p class="empty">画面グループを選択してください。</p>` : ""}
      ${state.contextItems.length === 0 && screenGroupId ? `<p class="empty">店舗文脈はまだありません。</p>` : ""}
      ${state.contextItems.map((item) => renderContextItem(item, canEdit)).join("")}
    `;
    els.contextItems.querySelector(".customer-context-create")?.addEventListener("submit", handleContextCreate);
    els.contextItems.querySelectorAll(".customer-context-edit").forEach((form) => {
      form.addEventListener("submit", handleContextEdit);
    });
    els.contextItems.querySelectorAll(".customer-context-upload").forEach((form) => {
      form.addEventListener("submit", handleContextUpload);
    });
    els.contextItems.querySelectorAll("[data-context-delete]").forEach((button) => {
      button.addEventListener("click", handleContextDelete);
    });
    els.contextItems.querySelectorAll("[data-source-asset-delete]").forEach((button) => {
      button.addEventListener("click", handleSourceAssetDelete);
    });
  }

  function renderContextCreateForm() {
    return `
      <form class="customer-context-create customer-context-form">
        <select name="context_category" aria-label="分類">
          ${contextCategoryOptions("customer_profile")}
        </select>
        <input name="item_key" type="text" placeholder="管理名" aria-label="管理名" required>
        <textarea name="text" rows="3" placeholder="市場情報、店舗の前提、訴求したい内容など" aria-label="文脈内容" required></textarea>
        <button type="submit">追加</button>
      </form>
    `;
  }

  function renderContextItem(item, canEdit) {
    const assets = item.source_assets || [];
    return `
      <article class="customer-panel customer-context-item" data-context-id="${escapeAttr(item.customer_context_item_id)}">
        <strong>${escapeHtml(contextCategoryLabel(item.context_category))} / ${escapeHtml(item.item_key || "")}</strong>
        <span>${escapeHtml(contextText(item.value))}</span>
        <span>Status: ${escapeHtml(item.status || "")}</span>
        ${assets.length ? `
          <div class="customer-context-assets">
            ${assets.map((asset) => `
              <span>
                <a href="${escapeAttr(asset.view_path || "")}" target="_blank" rel="noreferrer">${escapeHtml(asset.original_name || asset.filename || "")}</a>
                <small>${escapeHtml(asset.mime_type || "")} / ${Math.round((asset.size_bytes || 0) / 1024)}KB</small>
                ${canEdit ? `<button class="danger" type="button" data-source-asset-delete="${escapeAttr(asset.customer_context_source_asset_id)}">削除</button>` : ""}
              </span>
            `).join("")}
          </div>
        ` : ""}
        ${canEdit ? `
          <form class="customer-context-edit customer-context-form">
            <select name="context_category" aria-label="分類">
              ${contextCategoryOptions(item.context_category)}
            </select>
            <textarea name="text" rows="3" aria-label="文脈内容">${escapeHtml(contextText(item.value))}</textarea>
            <button type="submit">保存</button>
            <button class="danger" type="button" data-context-delete="${escapeAttr(item.customer_context_item_id)}">削除</button>
          </form>
          <form class="customer-context-upload customer-context-form">
            <input name="source" type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf" aria-label="添付ファイル">
            <input name="usage_notes" type="text" placeholder="利用メモ" aria-label="利用メモ">
            <button type="submit">添付</button>
          </form>
        ` : ""}
      </article>
    `;
  }

  function contextCategoryOptions(current) {
    return window.MisellContextUi?.categoryOptions?.(current, { includeInternal: false }) || "";
  }

  function contextCategoryLabel(value) {
    return window.MisellContextUi?.categoryLabel?.(value) || value || "";
  }

  function contextText(value) {
    return window.MisellContextUi?.contextText?.(value) || "";
  }

  async function handleContextCreate(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await fetchJson("/api/customer/context-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          store_id: selectedStoreId(),
          screen_group_id: selectedScreenGroupId(),
          context_category: form.elements.context_category.value,
          item_type: "customer_note",
          item_key: form.elements.item_key.value,
          value: { text: form.elements.text.value }
        })
      });
      form.reset();
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "店舗文脈の追加に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleContextEdit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const contextId = form.closest(".customer-context-item")?.dataset.contextId || "";
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await fetchJson(`/api/customer/context-items/${encodeURIComponent(contextId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context_category: form.elements.context_category.value,
          value: { text: form.elements.text.value },
          status: "active"
        })
      });
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "店舗文脈の保存に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleContextUpload(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const contextId = form.closest(".customer-context-item")?.dataset.contextId || "";
    const file = form.elements.source.files?.[0];
    if (!file) return;
    const button = form.querySelector("button");
    button.disabled = true;
    const body = new FormData();
    body.append("source", file);
    body.append("usage_notes", form.elements.usage_notes.value || "");
    try {
      await fetchJson(`/api/customer/context-items/${encodeURIComponent(contextId)}/source-assets`, {
        method: "POST",
        body
      });
      form.reset();
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "添付に失敗しました。");
      button.disabled = false;
    }
  }

  async function handleContextDelete(event) {
    const contextId = event.currentTarget.dataset.contextDelete || "";
    event.currentTarget.disabled = true;
    try {
      await fetchJson(`/api/customer/context-items/${encodeURIComponent(contextId)}`, { method: "DELETE" });
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "店舗文脈の削除に失敗しました。");
      event.currentTarget.disabled = false;
    }
  }

  async function handleSourceAssetDelete(event) {
    const assetId = event.currentTarget.dataset.sourceAssetDelete || "";
    event.currentTarget.disabled = true;
    try {
      await fetchJson(`/api/customer/context-source-assets/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "添付ファイルの削除に失敗しました。");
      event.currentTarget.disabled = false;
    }
  }

  function renderOrders() {
    if (state.orders.length === 0) {
      els.orders.innerHTML = `<p class="empty">受付はまだありません。</p>`;
      return;
    }
    els.orders.innerHTML = `
      <table>
        <thead><tr><th>受付</th><th>店舗</th><th>Status</th><th>金額</th><th>発行</th></tr></thead>
        <tbody>
          ${state.orders.map((order) => `
            <tr>
              <td>${escapeHtml(order.order_number || "")}<small>${escapeHtml(order.counter_order_id || "")}</small></td>
              <td>${escapeHtml(order.store_id || "")}</td>
              <td>${escapeHtml(order.status || "")}</td>
              <td>${formatCurrency(order.total_amount, order.currency)}</td>
              <td>${formatTime(order.issued_at)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  }

  function renderStores() {
    if (state.stores.length === 0) {
      els.storeSettings.innerHTML = `<p class="empty">店舗設定はありません。</p>`;
      return;
    }
    els.storeSettings.innerHTML = state.stores.map((store) => `
      <article class="customer-panel">
        <strong>${escapeHtml(store.store_name || store.store_id)}</strong>
        <span>${escapeHtml(store.timezone || "")}</span>
        <span>締め ${escapeHtml(store.order_issue_cutoff_time || "未設定")}</span>
        <span>引換 ${escapeHtml([store.pickup_available_from, store.pickup_available_until].filter(Boolean).join(" - ") || "店舗設定")}</span>
      </article>
    `).join("");
  }

  function renderOffers() {
    if (state.offers.length === 0) {
      els.offers.innerHTML = `<p class="empty">オファーはありません。</p>`;
      return;
    }
    const canEdit = ["customer_admin", "customer_editor"].includes(state.session?.role);
    els.offers.innerHTML = state.offers.map((offer) => {
      const revision = offer.current_revision || {};
      return `
        <article class="customer-panel">
          <strong>${escapeHtml(revision.title || offer.offer_id)}</strong>
          <span>${escapeHtml(offer.store_id || "")}</span>
          <span>${escapeHtml(revision.pickup_location || "")}</span>
          <span>${formatCurrency(revision.total_amount, revision.currency)}</span>
          ${canEdit ? `
            <form class="customer-offer-revision" data-offer-id="${escapeAttr(offer.offer_id)}">
              <input name="title" type="text" value="${escapeAttr(revision.title || "")}" aria-label="タイトル">
              <input name="pickup_location" type="text" value="${escapeAttr(revision.pickup_location || "")}" aria-label="引換場所">
              <input name="pickup_available_from" type="time" value="${escapeAttr(revision.pickup_available_from || "")}" aria-label="引換開始">
              <input name="pickup_available_until" type="time" value="${escapeAttr(revision.pickup_available_until || "")}" aria-label="引換終了">
              <input name="max_orders_per_day" type="number" min="0" value="${escapeAttr(revision.max_orders_per_day || "")}" placeholder="日次上限" aria-label="日次上限">
              <button type="submit">revision保存</button>
            </form>
          ` : ""}
        </article>
      `;
    }).join("");
    els.offers.querySelectorAll(".customer-offer-revision").forEach((form) => {
      form.addEventListener("submit", handleOfferRevision);
    });
  }

  async function handleOfferRevision(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "保存中";
    try {
      await fetchJson(`/api/customer/offers/${encodeURIComponent(form.dataset.offerId)}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "active",
          title: form.elements.title.value,
          pickup_location: form.elements.pickup_location.value,
          pickup_available_from: form.elements.pickup_available_from.value,
          pickup_available_until: form.elements.pickup_available_until.value,
          max_orders_per_day: form.elements.max_orders_per_day.value
        })
      });
      await loadCustomerDashboard();
    } catch (error) {
      setMessage(error.message || "revision保存に失敗しました。");
      button.disabled = false;
      button.textContent = "revision保存";
    }
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${url} returned ${response.status}`);
    return data;
  }

  function setMessage(value) {
    els.message.textContent = value || "";
  }

  function formatCurrency(amount, currency = "JPY") {
    const value = Number.parseInt(amount || 0, 10) || 0;
    return currency === "JPY" ? `${value.toLocaleString("ja-JP")}円` : `${value.toLocaleString("ja-JP")} ${currency}`;
  }

  function formatPercent(value) {
    return `${Math.round((Number(value) || 0) * 1000) / 10}%`;
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ja-JP");
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
    return escapeHtml(value);
  }
})();
