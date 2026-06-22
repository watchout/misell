(function () {
  const order = window.MISELL_COUNTER_ORDER || {};
  const orderToken = window.MISELL_ORDER_TOKEN || "";
  const orderUrl = window.MISELL_ORDER_URL || window.location.href;
  const storageKey = "misell:last_counter_order";
  const els = {
    previous: document.getElementById("previous-order"),
    saveImage: document.getElementById("save-order-image"),
    previewImage: document.getElementById("preview-order-image"),
    share: document.getElementById("share-order"),
    copyNumber: document.getElementById("copy-order-number"),
    copyUrl: document.getElementById("copy-order-url"),
    message: document.getElementById("order-message"),
    canvas: document.getElementById("order-card-canvas"),
    imageFallback: document.getElementById("order-image-fallback"),
    imagePreview: document.getElementById("order-image-preview")
  };

  rememberOrder();
  renderPreviousOrder();
  recordEvent("view").catch(() => {});

  els.saveImage?.addEventListener("click", async () => {
    await saveOrderImage();
    await recordEvent("save_image").catch(() => {});
  });
  els.previewImage?.addEventListener("click", async () => {
    await previewOrderImage();
    await recordEvent("preview_image").catch(() => {});
  });
  els.share?.addEventListener("click", async () => {
    await shareOrder();
    await recordEvent("share").catch(() => {});
  });
  els.copyNumber?.addEventListener("click", async () => {
    await copyText(order.order_number || "");
    setMessage("受付番号をコピーしました。");
    await recordEvent("copy_order_number").catch(() => {});
  });
  els.copyUrl?.addEventListener("click", async () => {
    await copyText(orderUrl);
    setMessage("URLをコピーしました。");
    await recordEvent("copy_url").catch(() => {});
  });

  function rememberOrder() {
    try {
      const current = {
        token: orderToken,
        order_number: order.order_number || "",
        verify_code: order.verify_code || "",
        store_name: order.store?.store_name || "",
        status: order.status || "",
        saved_at: new Date().toISOString()
      };
      const existing = JSON.parse(window.localStorage.getItem(storageKey) || "null");
      if (existing?.token && existing.token !== orderToken) {
        window.localStorage.setItem(`${storageKey}:previous`, JSON.stringify(existing));
      }
      window.localStorage.setItem(storageKey, JSON.stringify(current));
    } catch {
      // localStorage can be unavailable in private browsing; the page still works without it.
    }
  }

  function renderPreviousOrder() {
    let previous = null;
    try {
      previous = JSON.parse(window.localStorage.getItem(`${storageKey}:previous`) || "null");
    } catch {
      previous = null;
    }
    if (!previous?.token || previous.token === orderToken || !els.previous) return;
    els.previous.hidden = false;
    els.previous.innerHTML = `
      <span>前回の受付番号</span>
      <strong>${escapeHtml(previous.order_number || "")}</strong>
      <a href="/order/${encodeURIComponent(previous.token)}">表示</a>
    `;
    els.previous.querySelector("a")?.addEventListener("click", () => {
      recordEvent("open_previous_order", { previous_order_token_present: true }).catch(() => {});
    });
  }

  async function saveOrderImage() {
    const blob = await renderOrderCardBlob();
    if (shouldShowImagePreviewFallback()) {
      showImagePreviewFallback(blob, "画像を表示しました。画像を長押しして保存してください。");
      return;
    }
    const url = URL.createObjectURL(blob);
    try {
      const link = document.createElement("a");
      link.href = url;
      link.download = `misell-order-${safeFilePart(order.order_number || "card")}.png`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      setMessage("受付番号カードを画像として保存しました。");
    } catch {
      URL.revokeObjectURL(url);
      showImagePreviewFallback(blob, "画像保存を開始できませんでした。画像を長押しして保存してください。");
    }
  }

  async function previewOrderImage() {
    const blob = await renderOrderCardBlob();
    showImagePreviewFallback(blob, "画像を表示しました。iPhone Safariでは画像を長押しして保存してください。");
  }

  async function shareOrder() {
    const title = `受付番号 ${order.order_number || ""}`;
    const text = `${order.store?.store_name || "店舗"} 受付番号 ${order.order_number || ""} / 確認コード ${order.verify_code || ""}`;
    try {
      const blob = await renderOrderCardBlob();
      const file = new File([blob], `misell-order-${safeFilePart(order.order_number || "card")}.png`, { type: "image/png" });
      if (navigator.canShare?.({ files: [file] }) && navigator.share) {
        await navigator.share({ title, text, url: orderUrl, files: [file] });
        setMessage("受付番号カードを共有しました。");
        return;
      }
    } catch (error) {
      if (shouldShowImagePreviewFallback()) {
        const blob = await renderOrderCardBlob();
        showImagePreviewFallback(blob, "共有を開始できませんでした。画像を長押しして保存してください。");
        return;
      }
    }
    if (shouldShowImagePreviewFallback()) {
      const blob = await renderOrderCardBlob();
      showImagePreviewFallback(blob, "画像を表示しました。画像を長押しして保存、または共有してください。");
      return;
    }
    if (navigator.share) {
      await navigator.share({ title, text, url: orderUrl });
      setMessage("受付番号を共有しました。");
      return;
    }
    await copyText(`${text}\n${orderUrl}`);
    setMessage("共有用テキストをコピーしました。");
  }

  async function renderOrderCardBlob() {
    const canvas = els.canvas;
    if (!canvas) throw new Error("canvas is missing");
    const ctx = canvas.getContext("2d");
    const width = canvas.width;
    const height = canvas.height;
    const receipt = order.receipt_snapshot || {};
    ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(0, 0, width, height);
    roundRect(ctx, 90, 90, width - 180, height - 180, 42, "#ffffff", "#d8dee4");
    ctx.fillStyle = "#135f8c";
    ctx.font = "700 54px system-ui, sans-serif";
    ctx.fillText(order.store?.store_name || "Misell", 150, 190);
    ctx.fillStyle = "#52616f";
    ctx.font = "500 34px system-ui, sans-serif";
    ctx.fillText("受付番号", 150, 330);
    ctx.fillStyle = "#101820";
    ctx.font = "800 140px system-ui, sans-serif";
    ctx.fillText(order.order_number || "", 150, 480);
    ctx.fillStyle = "#135f8c";
    ctx.font = "700 54px system-ui, sans-serif";
    ctx.fillText(`確認コード ${order.verify_code || ""}`, 150, 600);

    ctx.fillStyle = "#52616f";
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.fillText(`引換場所: ${receipt.pickup_location || "店頭"}`, 150, 680);
    ctx.fillText(`引換時間: ${receipt.pickup_window || "店舗営業時間に準じます"}`, 150, 725);
    ctx.fillText(`有効期限: ${formatDate(receipt.valid_until) || "なし"}`, 150, 770);

    ctx.fillStyle = "#1f2933";
    let y = 875;
    for (const item of (order.items || []).slice(0, 6)) {
      ctx.font = "600 34px system-ui, sans-serif";
      drawClampedText(ctx, item.item_name_snapshot || "", 150, y, 590);
      ctx.fillText(`${item.quantity || 1}点`, 790, y);
      ctx.fillText(formatCurrency(item.subtotal_amount, item.currency), 930, y);
      ctx.fillStyle = "#697986";
      ctx.font = "500 28px system-ui, sans-serif";
      ctx.fillText(`単価 ${formatCurrency(item.unit_price_snapshot, item.currency)}`, 150, y + 38);
      ctx.fillStyle = "#1f2933";
      y += 88;
    }
    if ((order.items || []).length > 6) {
      ctx.fillStyle = "#697986";
      ctx.font = "500 28px system-ui, sans-serif";
      ctx.fillText(`他 ${(order.items || []).length - 6} 件`, 150, y);
    }
    ctx.fillStyle = "#52616f";
    ctx.font = "500 34px system-ui, sans-serif";
    ctx.fillText(`合計 ${formatCurrency(order.total_amount, order.currency)} / ${order.tax_included === false ? "税別" : "税込"}`, 150, height - 270);
    ctx.fillText(`発行 ${formatDate(order.issued_at)}`, 150, height - 210);
    ctx.fillText("受け取り時にこの画面または画像を提示してください", 150, height - 150);
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("image export failed"));
      }, "image/png");
    });
  }

  function showImagePreviewFallback(blob, message) {
    if (!els.imageFallback || !els.imagePreview) return;
    const previousUrl = els.imagePreview.dataset.blobUrl;
    if (previousUrl) URL.revokeObjectURL(previousUrl);
    const url = URL.createObjectURL(blob);
    els.imagePreview.src = url;
    els.imagePreview.dataset.blobUrl = url;
    els.imageFallback.hidden = false;
    els.imageFallback.scrollIntoView({ block: "nearest", behavior: "smooth" });
    setMessage(message);
  }

  function shouldShowImagePreviewFallback() {
    return window.MISELL_FORCE_IMAGE_FALLBACK === true || isIphoneSafari() || !("download" in HTMLAnchorElement.prototype);
  }

  function isIphoneSafari() {
    const ua = navigator.userAgent || "";
    return /iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  }

  function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + width, y, x + width, y + height, radius);
    ctx.arcTo(x + width, y + height, x, y + height, radius);
    ctx.arcTo(x, y + height, x, y, radius);
    ctx.arcTo(x, y, x + width, y, radius);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawClampedText(ctx, text, x, y, maxWidth) {
    const value = String(text || "");
    if (ctx.measureText(value).width <= maxWidth) {
      ctx.fillText(value, x, y);
      return;
    }
    let output = value;
    while (output.length > 1 && ctx.measureText(`${output}...`).width > maxWidth) {
      output = output.slice(0, -1);
    }
    ctx.fillText(`${output}...`, x, y);
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "");
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }

  async function recordEvent(eventName, metadata = {}) {
    await fetch(`/api/public/orders/${encodeURIComponent(orderToken)}/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name: eventName, ...metadata })
    });
  }

  function setMessage(message) {
    if (els.message) els.message.textContent = message;
  }

  function formatCurrency(amount, currency) {
    if ((currency || "JPY") === "JPY") return `${Number(amount || 0).toLocaleString("ja-JP")}円`;
    return `${Number(amount || 0).toLocaleString("ja-JP")} ${currency || ""}`;
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value || "";
    return date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
  }

  function safeFilePart(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80) || "card";
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
})();
