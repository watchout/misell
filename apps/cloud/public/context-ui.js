(function () {
  const CATEGORIES = [
    ["customer_profile", "店舗/ブランド"],
    ["market_signal", "市場/季節"],
    ["operation_summary", "運用/前提"],
    ["proposal_feedback", "提案への反応"],
    ["asset_source", "素材情報"],
    ["collaboration_signal", "協業/地域情報"],
    ["internal_notes", "内部メモ"]
  ];

  function categoryOptions(current, options = {}) {
    const includeInternal = options.includeInternal === true;
    return CATEGORIES
      .filter(([value]) => includeInternal || value !== "internal_notes")
      .map(([value, label]) => `<option value="${escapeHtml(value)}"${value === current ? " selected" : ""}>${escapeHtml(label)}</option>`)
      .join("");
  }

  function categoryLabel(value) {
    const found = CATEGORIES.find(([key]) => key === value);
    return found ? found[1] : value || "";
  }

  function contextText(value) {
    if (!value) return "";
    if (typeof value === "string") return value;
    if (typeof value.text === "string") return value.text;
    return JSON.stringify(value);
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

  window.MisellContextUi = {
    categoryOptions,
    categoryLabel,
    contextText
  };
})();
