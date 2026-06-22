(function () {
  const storeToken = window.MISELL_STORE_TOKEN || "";
  const els = {
    login: document.getElementById("store-login"),
    loginForm: document.getElementById("store-login-form"),
    app: document.getElementById("store-orders-app"),
    refresh: document.getElementById("store-refresh"),
    logout: document.getElementById("store-logout"),
    status: document.getElementById("store-order-status"),
    search: document.getElementById("store-order-search"),
    searchButton: document.getElementById("store-order-search-button"),
    sessionSummary: document.getElementById("store-session-summary"),
    list: document.getElementById("store-orders-list"),
    message: document.getElementById("store-orders-message")
  };

  els.loginForm?.addEventListener("submit", handleLogin);
  els.refresh?.addEventListener("click", loadOrders);
  els.logout?.addEventListener("click", handleLogout);
  els.searchButton?.addEventListener("click", loadOrders);
  els.status?.addEventListener("change", loadOrders);
  els.search?.addEventListener("keydown", (event) => {
    if (event.key === "Enter") loadOrders();
  });

  restoreSession().catch(() => {
    showLogin();
  });

  async function restoreSession() {
    const session = await fetchJson("/api/store/orders/session");
    showApp(session.store, session.session);
    await loadOrders();
  }

  async function handleLogin(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    button.disabled = true;
    button.textContent = "確認中";
    try {
      const result = await fetchJson(`/store/orders/${encodeURIComponent(storeToken)}/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: form.elements.pin.value })
      });
      form.reset();
      showApp(result.store, result.session);
      await loadOrders();
    } catch (error) {
      setMessage(error.message || "PINを確認できませんでした。");
    } finally {
      button.disabled = false;
      button.textContent = "開始";
    }
  }

  async function handleLogout() {
    await fetchJson("/api/store/orders/logout", { method: "POST" }).catch(() => {});
    showLogin();
  }

  async function loadOrders() {
    if (els.app?.hidden) return;
    const params = new URLSearchParams();
    if (els.status?.value) params.set("status", els.status.value);
    if (els.search?.value) params.set("q", els.search.value);
    params.set("limit", "100");
    try {
      const result = await fetchJson(`/api/store/orders?${params.toString()}`);
      renderOrders(result.counter_orders || []);
      setMessage("");
    } catch (error) {
      setMessage(error.message || "受付一覧を取得できませんでした。");
    }
  }

  function renderOrders(orders) {
    if (!els.list) return;
    if (!orders.length) {
      els.list.innerHTML = `<p class="empty">該当する受付はありません。</p>`;
      return;
    }
    els.list.innerHTML = `
      <div class="store-order-grid">
        ${orders.map(renderOrder).join("")}
      </div>
    `;
    els.list.querySelectorAll(".store-order-action").forEach((form) => {
      form.addEventListener("submit", handleOrderAction);
    });
  }

  function renderOrder(order) {
    const itemLabel = (order.items || []).map((item) => `${item.item_name_snapshot} x ${item.quantity}`).join(" / ");
    return `
      <article class="store-order">
        <div class="store-order-head">
          <div>
            <span>受付番号</span>
            <strong>${escapeHtml(order.order_number || "")}</strong>
          </div>
          <span class="update-status update-status-${escapeAttr(statusClass(order.status))}">${escapeHtml(statusLabel(order.status))}</span>
        </div>
        <dl class="store-order-meta">
          <div><dt>確認コード</dt><dd>${escapeHtml(order.verify_code || "")}</dd></div>
          <div><dt>発行</dt><dd>${formatTime(order.issued_at)}</dd></div>
          <div><dt>合計</dt><dd>${formatCurrency(order.total_amount, order.currency)}</dd></div>
        </dl>
        <p>${escapeHtml(itemLabel)}</p>
        <form class="store-order-action" data-order-id="${escapeHtml(order.counter_order_id || "")}" data-status="${escapeHtml(order.status || "")}">
          <input name="verify_code" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="確認コード" aria-label="確認コード">
          <input name="reason" type="text" placeholder="取消理由/メモ" aria-label="取消理由">
          <button type="submit" name="status" value="redeemed"${order.status === "redeemed" ? " disabled" : ""}>引換済み</button>
          <button class="secondary" type="submit" name="status" value="issued"${order.status === "issued" ? " disabled" : ""}>未引換へ戻す</button>
          <button class="danger" type="submit" name="status" value="cancelled"${order.status === "cancelled" ? " disabled" : ""}>取消</button>
        </form>
      </article>
    `;
  }

  async function handleOrderAction(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitter = event.submitter || form.querySelector("button");
    const status = submitter?.value || "redeemed";
    const orderId = form.dataset.orderId;
    const payload = {
      status,
      verify_code: form.elements.verify_code.value,
      reason: form.elements.reason.value
    };
    if (status === "redeemed" && !payload.verify_code) {
      setMessage("引換済みにするには確認コードを入力してください。");
      return;
    }
    submitter.disabled = true;
    try {
      await fetchJson(`/api/store/orders/${encodeURIComponent(orderId)}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      await loadOrders();
    } catch (error) {
      setMessage(error.message || "受付ステータスを更新できませんでした。");
      submitter.disabled = false;
    }
  }

  function showApp(store, session) {
    if (els.login) els.login.hidden = true;
    if (els.app) els.app.hidden = false;
    if (els.sessionSummary) {
      els.sessionSummary.innerHTML = `
        <span>${escapeHtml(store?.store_name || store?.store_id || "")}</span>
        <span>セッション期限 ${formatTime(session?.expires_at)}</span>
      `;
    }
  }

  function showLogin() {
    if (els.login) els.login.hidden = false;
    if (els.app) els.app.hidden = true;
    if (els.list) els.list.innerHTML = "";
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { error: text };
    }
    if (!response.ok) {
      throw new Error(body.error || `${url} returned ${response.status}`);
    }
    return body;
  }

  function setMessage(message) {
    if (els.message) els.message.textContent = message || "";
  }

  function statusLabel(status) {
    return {
      issued: "未引換",
      redeemed: "引換済み",
      expired: "期限切れ",
      cancelled: "取消"
    }[status] || status || "";
  }

  function statusClass(status) {
    if (status === "issued") return "success";
    if (status === "redeemed") return "succeeded";
    if (status === "cancelled" || status === "expired") return "failed";
    return "idle";
  }

  function formatCurrency(amount, currency) {
    if ((currency || "JPY") === "JPY") return `${Number(amount || 0).toLocaleString("ja-JP")}円`;
    return `${Number(amount || 0).toLocaleString("ja-JP")} ${currency || ""}`;
  }

  function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString("ja-JP", { dateStyle: "short", timeStyle: "short" });
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
