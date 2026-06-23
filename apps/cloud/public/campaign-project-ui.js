(function (global) {
  const sceneTypeOptions = Object.freeze([
    Object.freeze(["intro", "導入"]),
    Object.freeze(["offer", "訴求"]),
    Object.freeze(["cta", "CTA"]),
    Object.freeze(["proof", "根拠"]),
    Object.freeze(["reminder", "再告知"]),
    Object.freeze(["wide", "Wide"])
  ]);

  global.MisellCampaignProjectUi = Object.freeze({
    sceneTypeOptions
  });
})(window);
