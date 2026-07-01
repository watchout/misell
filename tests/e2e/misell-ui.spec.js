const { test, expect } = require("@playwright/test");
const { spawn } = require("node:child_process");
const fsp = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../..");
const outputDir = path.resolve(process.env.MISELL_E2E_OUTPUT_DIR || path.join(repoRoot, "test-results/e2e/misell-ui"));
const screenshotsDir = path.join(outputDir, "screenshots");
const artifactsDir = path.join(outputDir, "artifacts");
const tmpDir = path.join(outputDir, "tmp");
const playerDataDir = path.join(tmpDir, "player-data");
const cloudDataDir = path.join(tmpDir, "cloud-data");
const playerPort = Number(process.env.MISELL_E2E_PLAYER_PORT || 3300);
const cloudPort = Number(process.env.MISELL_E2E_CLOUD_PORT || 3301);
const user = "admin";
const password = "browser-ui-test-password";
const playerBase = `http://127.0.0.1:${playerPort}`;
const cloudBase = `http://127.0.0.1:${cloudPort}`;

const actions = [];
const consoleEvents = [];
const networkEvents = [];
const serverLogs = [];
const failures = [];
const servers = [];

function action(message) {
  actions.push(`${new Date().toISOString()} ${message}`);
}

function recordFailure(message) {
  failures.push(`${new Date().toISOString()} ${message}`);
}

function expectedHttpResponse(response) {
  const method = response.request().method();
  const url = response.url();
  const status = response.status();
  return (
    (status === 401 && method === "GET" && url === `${playerBase}/admin`) ||
    (status === 401 && method === "GET" && url === `${cloudBase}/admin`) ||
    (status === 400 && method === "POST" && url === `${playerBase}/api/assets/upload`) ||
    (status === 413 && method === "POST" && url === `${playerBase}/api/assets/upload`) ||
    (status === 400 && method === "POST" && url === `${cloudBase}/api/admin/assets`) ||
    (status === 400 && method === "PATCH" && url === `${cloudBase}/api/admin/devices/DEV-BROWSER-001/update`)
  );
}

async function ensureDirs() {
  await fsp.mkdir(screenshotsDir, { recursive: true });
  await fsp.mkdir(artifactsDir, { recursive: true });
  await fsp.mkdir(playerDataDir, { recursive: true });
  await fsp.mkdir(cloudDataDir, { recursive: true });
}

async function writeFixtureFiles() {
  const playlist = {
    version: 1,
    playlist_version: "browser-ui-001",
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: "browser-three-zone",
        item_id: "browser-three-zone",
        name: "Browser three-zone",
        enabled: true,
        layout: "three-zone",
        duration: 1,
        start: "",
        end: "",
        days_of_week: [],
        campaign_id: "cmp-browser",
        asset_id: "asset-browser-three",
        priority: 0,
        left: "/demo/left.html",
        center: "/demo/center.html",
        right: "/demo/right.html",
        wide: ""
      },
      {
        id: "browser-wide",
        item_id: "browser-wide",
        name: "Browser wide",
        enabled: true,
        layout: "wide",
        duration: 1,
        start: "",
        end: "",
        days_of_week: [],
        campaign_id: "cmp-browser",
        asset_id: "asset-browser-wide",
        priority: 0,
        left: "",
        center: "",
        right: "",
        wide: "/demo/wide.html"
      }
    ]
  };

  const config = {
    tenant_id: "TEN-BROWSER",
    store_id: "STO-BROWSER",
    location_id: "LOC-BROWSER",
    screen_group_id: "SG-BROWSER",
    device_id: "DEV-BROWSER-001",
    device_name: "browser-ui-local",
    environment: "test",
    release_id: "browser-ui",
    release_channel: "test",
    config_version: "cfg-browser-ui"
  };

  await fsp.writeFile(path.join(playerDataDir, "playlist.json"), `${JSON.stringify(playlist, null, 2)}\n`);
  await fsp.writeFile(path.join(playerDataDir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);

  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lZz9xwAAAABJRU5ErkJggg==",
    "base64"
  );
  await fsp.writeFile(path.join(artifactsDir, "valid-1x1.png"), png);
  await fsp.writeFile(path.join(artifactsDir, "invalid.txt"), "not an allowed upload\n");
  await fsp.writeFile(path.join(artifactsDir, "too-large.png"), Buffer.concat([png, Buffer.alloc(1024 * 1024 + 1)]));
}

function spawnServer(name, cwd, env) {
  const child = spawn("npm", ["start"], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"]
  });
  servers.push(child);
  child.stdout.on("data", (data) => serverLogs.push(`[${name} stdout] ${data.toString().trimEnd()}`));
  child.stderr.on("data", (data) => serverLogs.push(`[${name} stderr] ${data.toString().trimEnd()}`));
  child.on("exit", (code, signal) => serverLogs.push(`[${name} exit] code=${code} signal=${signal}`));
  return child;
}

async function waitForHealth(baseUrl) {
  const deadline = Date.now() + 30000;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${baseUrl}/api/health: ${lastError}`);
}

async function startServers() {
  spawnServer("player", path.join(repoRoot, "apps/player"), {
    PORT: String(playerPort),
    MISELL_DATA_DIR: playerDataDir,
    MISELL_ASSETS_DIR: path.join(tmpDir, "player-assets"),
    MISELL_LOG_DIR: path.join(tmpDir, "player-logs"),
    ADMIN_USER: user,
    ADMIN_PASSWORD: password,
    REQUIRE_ADMIN_AUTH: "1",
    UPLOAD_MAX_MB: "1",
    NODE_ENV: "test"
  });
  spawnServer("cloud", path.join(repoRoot, "apps/cloud"), {
    HOST: "127.0.0.1",
    PORT: String(cloudPort),
    MISELL_CLOUD_DATA_DIR: cloudDataDir,
    DB_PATH: path.join(cloudDataDir, "misell-cloud.sqlite"),
    ADMIN_USER: user,
    ADMIN_PASSWORD: password,
    REQUIRE_ADMIN_AUTH: "1",
    DEVICE_TOKEN_PEPPER: "browser-ui-pepper",
    NODE_ENV: "test"
  });
  await Promise.all([waitForHealth(playerBase), waitForHealth(cloudBase)]);
}

async function stopServers() {
  await Promise.all(servers.map((child) => new Promise((resolve) => {
    if (child.exitCode !== null || child.killed) {
      resolve();
      return;
    }
    child.once("exit", resolve);
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill("SIGKILL");
    }, 3000);
  })));
}

function wirePage(page, name) {
  page.on("console", (msg) => {
    const type = msg.type();
    const text = msg.text();
    consoleEvents.push(`${new Date().toISOString()} [${name}] ${type}: ${text}`);
    const expectedBrowserResourceError =
      /Failed to load resource: the server responded with a status of (400|401|413)/.test(text);
    if (type === "error" && !expectedBrowserResourceError) {
      recordFailure(`[${name}] console error: ${text}`);
    }
  });
  page.on("pageerror", (error) => {
    consoleEvents.push(`${new Date().toISOString()} [${name}] pageerror: ${error.message}`);
    recordFailure(`[${name}] page error: ${error.message}`);
  });
  page.on("requestfailed", (request) => {
    const failure = request.failure();
    networkEvents.push(`${new Date().toISOString()} [${name}] FAILED ${request.method()} ${request.url()} ${failure?.errorText || ""}`);
    const expectedSseAbort = request.url().endsWith("/api/events") && failure?.errorText === "net::ERR_ABORTED";
    if (!expectedSseAbort) {
      recordFailure(`[${name}] request failed: ${request.url()} ${failure?.errorText || ""}`);
    }
  });
  page.on("response", (response) => {
    const status = response.status();
    if (status >= 400) {
      networkEvents.push(`${new Date().toISOString()} [${name}] HTTP ${status} ${response.request().method()} ${response.url()}`);
      if (!expectedHttpResponse(response)) {
        recordFailure(`[${name}] unexpected HTTP ${status}: ${response.request().method()} ${response.url()}`);
      }
    }
  });
}

async function authedRequest(baseUrl, endpoint, options = {}) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`,
    ...(options.headers || {})
  };
  const res = await fetch(`${baseUrl}${endpoint}`, { ...options, headers });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, text, json };
}

async function runCommand(command, args = [], options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      env: { ...process.env, ...(options.env || {}) },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeoutMs || 30000);
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

async function expectPreviewStageFitsViewport(page) {
  await page.waitForFunction(() => {
    const stage = document.getElementById("stage");
    if (!stage) return false;
    const rect = stage.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }, null, { timeout: 5000 });

  const geometry = await page.locator("#stage").evaluate((stage) => {
    const rect = stage.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight
    };
  });
  const tolerance = 1;
  const expectedPreviewWidth = Math.max(1, geometry.viewportWidth - 48);
  expect(geometry.left).toBeGreaterThanOrEqual(-tolerance);
  expect(geometry.top).toBeGreaterThanOrEqual(-tolerance);
  expect(geometry.right).toBeLessThanOrEqual(geometry.viewportWidth + tolerance);
  expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewportHeight + tolerance);
  expect(geometry.width).toBeGreaterThanOrEqual(expectedPreviewWidth * 0.94);
  expect(geometry.height).toBeGreaterThan(40);
}

async function seedCloudDevice() {
  action("Seed cloud device through admin API");
  const create = await authedRequest(cloudBase, "/api/admin/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: "TEN-BROWSER",
      tenant_name: "Browser Tenant",
      store_id: "STO-BROWSER",
      store_name: "Browser Store",
      location_id: "LOC-BROWSER",
      location_name: "Browser Location",
      screen_group_id: "SG-BROWSER",
      screen_group_name: "Browser Screen Group",
      device_id: "DEV-BROWSER-001",
      device_name: "browser-ui-device",
      release_channel: "stable",
      notes: "seeded for browser UI evidence"
    })
  });
  expect(create.status, create.text).toBe(201);
  const token = create.json.device_token;
  const heartbeat = await fetch(`${cloudBase}/api/device/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tenant_id: "TEN-BROWSER",
      store_id: "STO-BROWSER",
      location_id: "LOC-BROWSER",
      screen_group_id: "SG-BROWSER",
      device_id: "DEV-BROWSER-001",
      device_name: "browser-ui-device",
      status: "online",
      app_version: "0.1.0",
      release_id: "browser-ui",
      release_channel: "stable",
      playlist_version: "browser-ui-001",
      disk_free_mb: 64000,
      memory_used_percent: 12,
      current_item_id: "browser-three-zone"
    })
  });
  expect(heartbeat.status, await heartbeat.text()).toBe(200);
}

async function createCloudDeviceWithHeartbeat(deviceId, playlistVersion) {
  const create = await authedRequest(cloudBase, "/api/admin/devices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: "TEN-BROWSER",
      tenant_name: "Browser Tenant",
      store_id: "STO-BROWSER",
      store_name: "Browser Store",
      location_id: "LOC-BROWSER",
      location_name: "Browser Location",
      screen_group_id: "SG-BROWSER",
      screen_group_name: "Browser Screen Group",
      device_id: deviceId,
      device_name: deviceId.toLowerCase(),
      release_channel: "stable",
      notes: "seeded for asset sync evidence"
    })
  });
  expect(create.status, create.text).toBe(201);
  const token = create.json.device_token;
  const heartbeat = await fetch(`${cloudBase}/api/device/heartbeat`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      tenant_id: "TEN-BROWSER",
      store_id: "STO-BROWSER",
      location_id: "LOC-BROWSER",
      screen_group_id: "SG-BROWSER",
      device_id: deviceId,
      device_name: deviceId.toLowerCase(),
      status: "online",
      app_version: "0.1.0",
      release_id: "browser-ui",
      release_channel: "stable",
      playlist_version: playlistVersion,
      disk_free_mb: 64000,
      memory_used_percent: 12,
      current_item_id: "asset-sync-seed"
    })
  });
  expect(heartbeat.status, await heartbeat.text()).toBe(200);
  return token;
}

test.beforeAll(async () => {
  await fsp.rm(outputDir, { recursive: true, force: true });
  await ensureDirs();
  await writeFixtureFiles();
  await startServers();
  await seedCloudDevice();
});

test.afterAll(async () => {
  await fsp.mkdir(outputDir, { recursive: true });
  await fsp.writeFile(path.join(outputDir, "actions.log"), `${actions.join("\n")}\n`);
  await fsp.writeFile(path.join(outputDir, "console.log"), `${consoleEvents.join("\n")}\n`);
  await fsp.writeFile(path.join(outputDir, "network.log"), `${networkEvents.join("\n")}\n`);
  await fsp.writeFile(path.join(outputDir, "server.log"), `${serverLogs.join("\n")}\n`);

  const playerAfter = await authedRequest(playerBase, "/api/playlist").catch((error) => ({ error: error.message }));
  const cloudDevices = await authedRequest(cloudBase, "/api/admin/devices").catch((error) => ({ error: error.message }));
  const releaseManifests = await authedRequest(cloudBase, "/api/admin/release-manifests").catch((error) => ({ error: error.message }));
  const contentManifests = await authedRequest(cloudBase, "/api/admin/content-manifests").catch((error) => ({ error: error.message }));
  await fsp.writeFile(path.join(outputDir, "api_after.json"), `${JSON.stringify({
    player_playlist: playerAfter.json || playerAfter,
    cloud_devices: cloudDevices.json || cloudDevices,
    release_manifests: releaseManifests.json || releaseManifests,
    content_manifests: contentManifests.json || contentManifests
  }, null, 2)}\n`);
  await fsp.writeFile(path.join(outputDir, "qa-summary.json"), `${JSON.stringify({
    result: failures.length === 0 ? "PASS" : "FAIL",
    failures,
    output_dir: outputDir,
    generated_at: new Date().toISOString()
  }, null, 2)}\n`);
  await stopServers();
  if (failures.length > 0) {
    throw new Error(`Unexpected browser QA events:\n${failures.join("\n")}`);
  }
});

test("player UI renders preview mode, rotates layouts, and supports local admin operations", async ({ browser }) => {
  const unauth = await browser.newPage();
  wirePage(unauth, "player-unauth");
  action("Check local admin unauthenticated 401");
  const unauthRes = await unauth.goto(`${playerBase}/admin`, { waitUntil: "domcontentloaded" });
  expect(unauthRes.status()).toBe(401);
  await unauth.close();

  const context = await browser.newContext({
    httpCredentials: { username: user, password },
    viewport: { width: 1440, height: 900 }
  });
  const page = await context.newPage();
  wirePage(page, "player");

  action("Open /player?preview=1 and verify three-zone layout");
  await page.goto(`${playerBase}/player?preview=1`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#left-zone")).toBeVisible();
  await expect(page.locator("#center-zone")).toBeVisible();
  await expect(page.locator("#right-zone")).toBeVisible();
  await expect(page.locator("#player-status")).toContainText("Browser three-zone");
  await expectPreviewStageFitsViewport(page);
  await page.screenshot({ path: path.join(screenshotsDir, "player-three-zone-preview.png"), fullPage: true });

  action("Wait for playlist rotation to wide layout");
  await expect(page.locator("#wide-zone")).toBeVisible({ timeout: 4000 });
  await expect(page.locator("#player-status")).toContainText("Browser wide", { timeout: 4000 });
  await expectPreviewStageFitsViewport(page);
  await page.screenshot({ path: path.join(screenshotsDir, "player-wide-preview.png"), fullPage: true });

  action("Open local admin and verify loaded controls");
  await page.goto(`${playerBase}/admin`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("LAN管理画面");
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(2);
  const initialAssetCount = Number.parseInt(await page.locator("#asset-count").innerText(), 10) || 0;
  await page.screenshot({ path: path.join(screenshotsDir, "player-admin-loaded.png"), fullPage: true });

  action("Generate campaign QR through local admin UI");
  await expect(page.locator("#qr-count")).toHaveText("0");
  await page.locator("#qr-campaign-id").fill("browser-qr-campaign");
  await page.locator("#qr-label").fill("Browser QR");
  await page.locator("#qr-lp-url").fill("https://misell.example/browser-qr");
  await page.locator("#qr-form button[type='submit']").click();
  await expect(page.locator("#toast")).toContainText("QRを発行しました", { timeout: 5000 });
  await expect(page.locator("#qr-result")).toContainText("browser-qr-campaign");
  await expect(page.locator("#qr-list")).toContainText("browser-qr-campaign");
  await expect(page.locator("#qr-count")).toHaveText("1");
  const qrImagePath = await page.locator("#qr-result img.qr-preview").getAttribute("src");
  expect(qrImagePath).toMatch(/^\/generated\/qrs\/.+\.png$/);
  const qrImageResponse = await page.request.get(`${playerBase}${qrImagePath}`);
  expect(qrImageResponse.ok()).toBeTruthy();
  expect(qrImageResponse.headers()["content-type"]).toContain("image/png");
  const qrImage = await qrImageResponse.body();
  expect(qrImage.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await fsp.writeFile(path.join(artifactsDir, "campaign-qr.png"), qrImage);
  await page.screenshot({ path: path.join(screenshotsDir, "player-admin-generated-qr.png"), fullPage: true });

  action("Upload valid PNG asset through local admin UI");
  await page.locator("#asset-input").setInputFiles(path.join(artifactsDir, "valid-1x1.png"));
  await page.locator("#upload-form button[type='submit']").click();
  await expect(page.locator("#toast")).toContainText("素材をアップロードしました", { timeout: 5000 });
  await expect(page.locator("#asset-count")).toHaveText(String(initialAssetCount + 1));
  await page.screenshot({ path: path.join(screenshotsDir, "player-admin-uploaded-asset.png"), fullPage: true });
  const uploadedAssetPath = await page.locator("[data-delete-asset]").first().getAttribute("data-delete-asset");
  expect(uploadedAssetPath).toMatch(/^\/assets\/images\/.+valid-1x1\.png$/);

  action("Save playlist using uploaded asset and delete it with usage warning");
  await page.locator("#playlist-editor .playlist-item").nth(0).locator("[data-select-item]").click();
  await page.locator("#item-detail [data-detail-field='left']").fill(uploadedAssetPath);
  await page.locator("#save-playlist").click();
  await expect(page.locator("#toast")).toContainText("playlistを保存しました", { timeout: 5000 });
  let deleteDialogMessage = "";
  page.once("dialog", async (dialog) => {
    deleteDialogMessage = dialog.message();
    await dialog.accept();
  });
  await page.locator(`[data-delete-asset="${uploadedAssetPath}"]`).click();
  expect(deleteDialogMessage).toContain("この素材は 1 件のplaylist itemで使用中です");
  await expect(page.locator("#toast")).toContainText("素材を削除しました", { timeout: 5000 });
  await expect(page.locator("#asset-count")).toHaveText(String(initialAssetCount));
  await page.locator("#playlist-editor .playlist-item").nth(0).locator("[data-select-item]").click();
  await page.locator("#item-detail [data-detail-field='left']").fill("/demo/left.html");
  await page.locator("#save-playlist").click();
  await expect(page.locator("#toast")).toContainText("playlistを保存しました", { timeout: 5000 });

  action("Reject invalid TXT upload through local admin UI");
  await page.locator("#asset-input").setInputFiles(path.join(artifactsDir, "invalid.txt"));
  await page.locator("#upload-form button[type='submit']").click();
  await expect(page.locator("#toast")).toContainText(/Unsupported file type|MIME/, { timeout: 5000 });

  action("Reject oversized PNG upload through local admin UI");
  await page.locator("#asset-input").setInputFiles(path.join(artifactsDir, "too-large.png"));
  await page.locator("#upload-form button[type='submit']").click();
  await expect(page.locator("#toast")).toContainText(/File too large|file size/i, { timeout: 5000 });

  action("Exercise playlist add, duplicate, move, edit, JSON error, and save");
  await page.locator("#add-three-zone").click();
  await page.locator("#add-wide").click();
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(4);
  await page.locator("#playlist-editor .playlist-item").nth(0).locator("[data-duplicate]").click();
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(5);
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("を削除しますか");
    await dialog.accept();
  });
  await page.locator("#playlist-editor .playlist-item").nth(4).locator("[data-delete]").click();
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(4);
  await page.locator("#playlist-editor .playlist-item").nth(1).locator("[data-move='up']").click();
  await page.locator("#playlist-editor .playlist-item").nth(0).locator("[data-select-item]").click();
  await page.locator("#item-detail [data-detail-field='name']").fill("Browser edited item");
  await page.locator("#item-detail [data-detail-field='duration']").fill("2");
  await page.locator(".json-panel").evaluate((element) => {
    element.setAttribute("open", "");
  });
  await page.locator("#json-editor").fill("{");
  await page.locator("#apply-json").click();
  await expect(page.locator("#toast")).toContainText("JSONエラー");

  await page.locator("#add-three-zone").click();
  await page.locator("#save-playlist").click();
  await expect(page.locator("#toast")).toContainText("playlistを保存しました", { timeout: 5000 });
  const validationVisible = await page.locator("#validation-errors").isVisible();
  if (validationVisible) recordFailure("Local admin showed validation errors after save attempt");

  action("Generate product PR cuts from local admin UI");
  await expect(page.locator(".promo-workflow")).toContainText("動画作成手順");
  await expect(page.locator(".promo-workflow")).toContainText("保存とバックアップ");
  await page.locator("#promo-draft-prompt").fill("新商品「ブラウザPR商品」を中央に大きく。価格は980円。特典は今だけ店頭限定。CTAは店頭で今すぐチェック。特徴は3画面訴求、中央商品、右CTA。1カット5秒。中央商品 + 左特徴 + 右CTAで。");
  await page.locator("#apply-promo-draft").click();
  await expect(page.locator("#toast")).toContainText("下書きをフォームに反映しました", { timeout: 5000 });
  await expect(page.locator("#promo-product-name")).toHaveValue("ブラウザPR商品");
  await expect(page.locator("#promo-price")).toHaveValue("980円");
  await expect(page.locator("#promo-offer")).toHaveValue("今だけ店頭限定");
  await expect(page.locator("#promo-feature-1")).toHaveValue("3画面訴求");
  await expect(page.locator("#promo-feature-2")).toHaveValue("中央商品");
  await expect(page.locator("#promo-feature-3")).toHaveValue("右CTA");
  await expect(page.locator("#promo-draft-result")).toContainText("反映済み");
  await page.locator("#generate-promo").click();
  await expect(page.locator("#toast")).toContainText("PRカットをplaylistへ追加しました", { timeout: 5000 });
  await expect(page.locator("#promo-storyboard")).toContainText("ブラウザPR商品");
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(9);
  await expect(page.locator("#json-editor")).toHaveValue(/\/generated\/promos\//);

  action("Regenerate the same product PR and replace existing generated cuts");
  await page.locator("#promo-price").fill("1,280円");
  await page.locator("#replace-promo").click();
  await expect(page.locator("#toast")).toContainText("PRカットをplaylistへ置換しました", { timeout: 5000 });
  await expect(page.locator("#playlist-editor .playlist-item")).toHaveCount(9);
  const playlistAfterPromoReplace = JSON.parse(await page.locator("#json-editor").inputValue());
  const generatedItem = playlistAfterPromoReplace.items.find((item) => String(item.right || item.wide || "").includes("/generated/promos/"));
  expect(generatedItem).toBeTruthy();
  const generatedPath = generatedItem.right || generatedItem.wide;
  const generatedResponse = await page.request.get(`${playerBase}${generatedPath}`);
  expect(generatedResponse.ok()).toBeTruthy();
  expect(await generatedResponse.text()).toContain("1,280円");

  action("Export generated product PR as a WebM video");
  await page.locator("[data-export-promo]").click();
  await expect(page.locator("#toast")).toContainText("WebM動画を書き出しました", { timeout: 90000 });
  const exportedVideoPath = await page.locator("[data-promo-download]").getAttribute("href");
  expect(exportedVideoPath).toMatch(/^\/generated\/exports\/.+\/promo\.webm$/);
  const exportedVideoResponse = await page.request.get(`${playerBase}${exportedVideoPath}`);
  expect(exportedVideoResponse.ok()).toBeTruthy();
  expect(exportedVideoResponse.headers()["content-type"]).toContain("video/webm");
  const exportedVideo = await exportedVideoResponse.body();
  expect(exportedVideo.length).toBeGreaterThan(1024);
  expect(exportedVideo.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  await fsp.writeFile(path.join(artifactsDir, "promo-export.webm"), exportedVideo);

  await page.locator("#save-playlist").click();
  await expect(page.locator("#toast")).toContainText("playlistを保存しました", { timeout: 5000 });
  await page.screenshot({ path: path.join(screenshotsDir, "player-admin-edited.png"), fullPage: true });

  action("Open local preview from admin");
  await page.reload({ waitUntil: "networkidle" });
  const popupPromise = context.waitForEvent("page");
  await page.locator("#preview-playlist").click();
  const preview = await popupPromise;
  wirePage(preview, "player-preview-popup");
  await preview.waitForLoadState("domcontentloaded");
  await expect(preview.locator("#player-status")).toContainText(/Browser|ゾーン|ワイド/, { timeout: 5000 });
  await preview.screenshot({ path: path.join(screenshotsDir, "player-admin-local-preview-popup.png"), fullPage: true });
  await context.close();
});

test("cloud admin UI renders dashboard and supports operational forms", async ({ browser }) => {
  const unauth = await browser.newPage();
  wirePage(unauth, "cloud-unauth");
  action("Check cloud admin unauthenticated 401");
  const unauthRes = await unauth.goto(`${cloudBase}/admin`, { waitUntil: "domcontentloaded" });
  expect(unauthRes.status()).toBe(401);
  await unauth.close();

  const context = await browser.newContext({
    httpCredentials: { username: user, password },
    viewport: { width: 1600, height: 1000 }
  });
  const page = await context.newPage();
  wirePage(page, "cloud");
  const dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    action(`Accept dialog: ${dialog.message()}`);
    await dialog.accept();
  });

  action("Open cloud admin dashboard");
  await page.goto(`${cloudBase}/admin`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Misell 端末監視");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("概要");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("Studio");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("受付・QR");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("配信");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("端末");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toContainText("アクセス");
  await expect(page.locator("#overview")).toContainText("運用状況");
  await expect(page.locator("#studio")).toContainText("提案・キャンペーン生成");
  await expect(page.locator("#commerce")).toContainText("受付・注文");
  await expect(page.locator("#delivery")).toContainText("配信・素材");
  await expect(page.locator("#devices-section")).toContainText("端末・ログ");
  await expect(page.locator("#access")).toContainText("店舗・顧客アクセス");
  await page.getByRole("navigation", { name: "管理メニュー" }).getByRole("link", { name: "Studio" }).click();
  await expect(page).toHaveURL(/#studio$/);
  await expect(page.locator("#devices")).toContainText("DEV-BROWSER-001");
  await expect(page.locator("#summary")).toContainText("正常");
  await page.screenshot({ path: path.join(screenshotsDir, "cloud-admin-dashboard.png"), fullPage: true });

  action("Create campaign generator project through cloud admin UI");
  const selectedProposal = await authedRequest(cloudBase, "/api/admin/campaign-proposals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      campaign_proposal_id: "cpr-browser-selected",
      tenant_id: "TEN-BROWSER",
      store_id: "STO-BROWSER",
      screen_group_id: "SG-BROWSER",
      proposal_month: "2026-07",
      title: "Browser selected proposal",
      objective: "店頭で新しい季節メニューを案内する",
      target_audience: "ランチ利用のお客様",
      three_screen_outline: [
        { order: 1, copy: "季節メニューの写真を大きく見せる" },
        { order: 2, copy: "利用シーンと特徴を短く伝える" },
        { order: 3, copy: "QRコードで詳細確認へ案内する" }
      ],
      qr_flow: "QRコードで詳細を見る",
      expected_effect: "店頭での認知を増やす",
      status: "selected"
    })
  });
  expect(selectedProposal.status, selectedProposal.text).toBe(201);
  await page.locator("#refresh").click();
  await expect(page.locator("#campaign-projects")).toContainText("Browser selected proposal", { timeout: 5000 });
  const freeInputProject = page.locator("#campaign-projects form.campaign-project-free-input");
  await expect(freeInputProject.locator("[data-campaign-project-demo-fill]")).toBeVisible();
  await expect(freeInputProject.locator("input[name='open_preview_after_create']")).toBeVisible();
  await freeInputProject.locator("[data-campaign-project-demo-fill]").click();
  await expect(freeInputProject.locator("input[name='title']")).toHaveValue("雨の日のファミリー訴求");
  await expect(freeInputProject.locator("input[name='objective']")).toHaveValue(/平日昼の来店客/);
  await expect(freeInputProject.locator("textarea[name='store_context']")).toHaveValue(/駅前店舗/);
  await expect(freeInputProject.locator("input[name='auto_generate_scenes']")).toBeChecked();
  await freeInputProject.locator("button[type='submit']").click();
  await expect(page.locator("#campaign-projects")).toContainText("雨の日のファミリー訴求", { timeout: 5000 });
  const demoProjects = await authedRequest(cloudBase, "/api/admin/campaign-projects?tenant_id=TEN-BROWSER&store_id=STO-BROWSER&screen_group_id=SG-BROWSER");
  const demoProject = demoProjects.json.campaign_projects.find((project) => project.title === "雨の日のファミリー訴求");
  expect(demoProject).toBeTruthy();
  const demoProjectDetail = await authedRequest(cloudBase, `/api/admin/campaign-projects/${demoProject.campaign_project_id}`);
  expect(demoProjectDetail.json.campaign_project.scenes).toHaveLength(3);
  const projectFromProposal = page.locator("#campaign-projects form.campaign-project-from-proposal");
  await projectFromProposal.locator("select[name='campaign_proposal_id']").selectOption("cpr-browser-selected");
  await projectFromProposal.locator("input[name='title']").fill("Browser campaign project");
  await projectFromProposal.locator("button[type='submit']").click();
  await expect(page.locator("#campaign-projects")).toContainText("Browser campaign project", { timeout: 5000 });
  await expect(page.locator("#campaign-projects")).toContainText("project.created", { timeout: 5000 });
  let campaignProjects = await authedRequest(cloudBase, "/api/admin/campaign-projects?tenant_id=TEN-BROWSER&store_id=STO-BROWSER&screen_group_id=SG-BROWSER");
  let campaignProject = campaignProjects.json.campaign_projects.find((project) => project.title === "Browser campaign project");
  expect(campaignProject).toBeTruthy();
  const campaignProjectId = campaignProject.campaign_project_id;
  expect(campaignProject.no_external_ai).toBe(true);
  expect(campaignProject.no_content_manifest_creation).toBe(true);
  expect(campaignProject.no_publish).toBe(true);
  const sceneForm = page.locator(`form.campaign-project-scene-update[data-project-id="${campaignProjectId}"]`).first();
  await sceneForm.locator("input[name='headline']").fill("Browser edited scene");
  await sceneForm.locator("input[name='duration_seconds']").fill("1");
  await sceneForm.locator("button[type='submit']").click();
  await expect(page.locator("#campaign-projects")).toContainText("Browser edited scene", { timeout: 5000 });
  await expect(page.locator("#campaign-projects")).toContainText("scene.updated", { timeout: 5000 });
  const draftPreviewPromise = context.waitForEvent("page");
  await page.locator(`[data-campaign-project-preview="${campaignProjectId}"]`).click();
  const draftPreview = await draftPreviewPromise;
  wirePage(draftPreview, "campaign-preview-draft");
  await draftPreview.waitForLoadState("domcontentloaded");
  await expect(draftPreview.locator(".campaign-preview-readiness")).toContainText("確認が必要", { timeout: 5000 });
  await expect(draftPreview.locator(".campaign-preview-readiness")).toContainText("プロジェクト検証が未完了です", { timeout: 5000 });
  await draftPreview.close();
  await page.locator(`button[data-campaign-project-validate="${campaignProjectId}"]`).click();
  await expect(page.locator("#campaign-projects")).toContainText("検証済み", { timeout: 5000 });
  await expect(page.locator("#campaign-projects")).toContainText("project.validated", { timeout: 5000 });
  const campaignProjectDetail = await authedRequest(cloudBase, `/api/admin/campaign-projects/${campaignProjectId}`);
  expect(campaignProjectDetail.status, campaignProjectDetail.text).toBe(200);
  expect(campaignProjectDetail.json.campaign_project.status).toBe("validated");
  expect(campaignProjectDetail.json.campaign_project.scenes.every((scene) => scene.status === "valid")).toBeTruthy();
  expect(campaignProjectDetail.json.campaign_project.events.some((event) => event.action === "project.validated")).toBeTruthy();
  const cutPlanResponse = await authedRequest(cloudBase, `/api/admin/campaign-projects/${campaignProjectId}/cut-plans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenant_id: "TEN-BROWSER",
      store_id: "STO-BROWSER",
      screen_group_id: "SG-BROWSER"
    })
  });
  expect(cutPlanResponse.status, cutPlanResponse.text).toBe(201);
  const cutPlanId = cutPlanResponse.json.studio_cut_plan.cut_plan_id;
  const cutPlanValidation = await authedRequest(cloudBase, `/api/admin/studio-cut-plans/${cutPlanId}/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({})
  });
  expect(cutPlanValidation.status, cutPlanValidation.text).toBe(200);
  expect(cutPlanValidation.json.valid).toBe(true);
  const renderManifestResponse = await authedRequest(cloudBase, `/api/admin/studio-cut-plans/${cutPlanId}/render-manifests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ output_type: "html_preview" })
  });
  expect(renderManifestResponse.status, renderManifestResponse.text).toBe(201);
  const renderManifest = renderManifestResponse.json.studio_render_manifest;
  expect(renderManifest.qa_status).toBe("passed");
  expect(renderManifest.output_sha256).toBeTruthy();
  const campaignPreviewPromise = context.waitForEvent("page");
  await page.locator(`[data-campaign-project-preview="${campaignProjectId}"]`).click();
  const campaignPreview = await campaignPreviewPromise;
  wirePage(campaignPreview, "campaign-preview");
  await campaignPreview.waitForLoadState("domcontentloaded");
  await expect(campaignPreview.locator("h1")).toContainText("Browser campaign project");
  await expect(campaignPreview.locator(".campaign-preview-stage")).toContainText("Browser edited scene");
  await expect(campaignPreview.locator(".campaign-preview-panel")).toHaveCount(3);
  await expect(campaignPreview.locator(".campaign-preview-summary")).toContainText("3 scenes");
  await expect(campaignPreview.locator(".campaign-preview-readiness")).toContainText("公開前確認 OK");
  await expect(campaignPreview.locator(".campaign-preview-readiness")).toContainText("配信作成はまだ行われていません");
  const campaignDisplayPromise = context.waitForEvent("page");
  await campaignPreview.locator("[data-preview-display-mode]").click();
  const campaignDisplay = await campaignDisplayPromise;
  wirePage(campaignDisplay, "campaign-preview-display");
  await campaignDisplay.waitForLoadState("domcontentloaded");
  await expect(campaignDisplay.locator("body")).toHaveClass(/campaign-preview-display-mode/);
  await expect(campaignDisplay.locator(".campaign-preview-display-stage .campaign-preview-panel")).toHaveCount(3);
  await expect(campaignDisplay.locator(".campaign-preview-display-overlay")).toContainText("Browser campaign project", { timeout: 5000 });
  await expect(campaignDisplay.locator("[data-preview-play]")).toHaveCount(0);
  await expect(campaignDisplay.locator(".campaign-preview-readiness")).toHaveCount(0);
  await expect(campaignDisplay.locator(".campaign-preview-scenes")).toHaveCount(0);
  await expect(campaignDisplay.locator(".campaign-preview-display-overlay")).toContainText("2 / 3", { timeout: 3000 });
  await campaignDisplay.screenshot({ path: path.join(screenshotsDir, "cloud-campaign-project-display-preview.png"), fullPage: true });
  await campaignDisplay.close();
  await campaignPreview.locator("[data-preview-play]").click();
  await expect(campaignPreview.locator(".campaign-preview-controls")).toContainText("通し再生中", { timeout: 5000 });
  await expect(campaignPreview.locator(".campaign-preview-controls strong")).toContainText("2 / 3", { timeout: 3000 });
  await campaignPreview.locator("[data-preview-pause]").click();
  await expect(campaignPreview.locator(".campaign-preview-controls")).toContainText("停止中", { timeout: 5000 });
  await campaignPreview.locator("[data-preview-restart]").click();
  await expect(campaignPreview.locator(".campaign-preview-controls strong")).toContainText("1 / 3", { timeout: 5000 });
  await campaignPreview.locator("[data-preview-pause]").click();
  await campaignPreview.locator("[data-preview-next]").click();
  await expect(campaignPreview.locator(".campaign-preview-controls strong")).toContainText("2 / 3", { timeout: 5000 });
  await campaignPreview.screenshot({ path: path.join(screenshotsDir, "cloud-campaign-project-preview.png"), fullPage: true });
  await campaignPreview.close();

  const campaignEditorPromise = context.waitForEvent("page");
  await page.locator(`[data-campaign-project-editor="${campaignProjectId}"]`).click();
  const campaignEditor = await campaignEditorPromise;
  wirePage(campaignEditor, "campaign-editor");
  await campaignEditor.waitForLoadState("domcontentloaded");
  await expect(campaignEditor.locator("h1")).toContainText("Browser campaign project");
  await expect(campaignEditor.locator(".campaign-editor-stage")).toContainText("Browser edited scene");
  const playlistHandoffPanel = campaignEditor.locator(".campaign-editor-handoff").filter({ hasText: "配信下書き" });
  await expect(playlistHandoffPanel).toContainText("配信下書き", { timeout: 5000 });
  await expect(playlistHandoffPanel).toContainText("content_manifestを作成しません");
  const handoffDraftJson = await campaignEditor.locator("[data-editor-handoff-json]").inputValue();
  const handoffDraft = JSON.parse(handoffDraftJson);
  expect(handoffDraft.schema_version).toBe("campaign-project-playlist-handoff-draft/v1");
  expect(handoffDraft.no_content_manifest_creation).toBe(true);
  expect(handoffDraft.no_publish).toBe(true);
  expect(handoffDraft.playlist.items.some((item) => item.center?.headline === "Browser edited scene")).toBeTruthy();
  await expect(campaignEditor.locator(".campaign-editor-schedule-handoff")).toContainText("配信スケジュール下書き", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-schedule-handoff")).toContainText("scheduleを作成せず");
  const scheduleHandoffDraftJson = await campaignEditor.locator("[data-editor-schedule-handoff-json]").inputValue();
  const scheduleHandoffDraft = JSON.parse(scheduleHandoffDraftJson);
  expect(scheduleHandoffDraft.schema_version).toBe("campaign-project-schedule-handoff-draft/v1");
  expect(scheduleHandoffDraft.no_content_manifest_creation).toBe(true);
  expect(scheduleHandoffDraft.no_publish).toBe(true);
  expect(scheduleHandoffDraft.schedule_activation_ready).toBe(false);
  expect(scheduleHandoffDraft.schedule_created).toBe(false);
  expect(scheduleHandoffDraft.playlist_reference.draft_sha256).toBe(handoffDraft.draft_sha256);
  const providerStatusPanel = campaignEditor.locator(".campaign-editor-provider-status");
  await expect(providerStatusPanel).toContainText("Provider / Job / Provenance", { timeout: 5000 });
  await expect(providerStatusPanel).toContainText("読み取り専用");
  await expect(providerStatusPanel).toContainText("manual_upload");
  await expect(providerStatusPanel).toContainText("mock_provider");
  await expect(providerStatusPanel).toContainText("外部provider呼び出しなし");
  await expect(providerStatusPanel).toContainText("content_manifest作成なし");
  await expect(providerStatusPanel).toContainText("publishなし");
  await expect(providerStatusPanel).toContainText("generation jobはまだありません");
  await expect(providerStatusPanel).toContainText("asset provenanceはまだありません");
  await expect(providerStatusPanel.locator("button")).toHaveCount(0);
  await expect(providerStatusPanel.locator("[data-provider-mutation-control]")).toHaveCount(0);
  const preflightPanel = campaignEditor.locator(".campaign-editor-publish-preflight");
  await expect(preflightPanel).toContainText("公開前 dry-run", { timeout: 5000 });
  await expect(preflightPanel).toContainText("公開・schedule有効化・Player/端末更新は行いません");
  await preflightPanel.locator("input[name='render_manifest_id']").fill(renderManifest.render_manifest_id);
  await preflightPanel.locator("select[name='content_type']").selectOption("normal");
  await preflightPanel.locator("select[name='docs99_gate_verdict']").selectOption("not_applicable");
  await preflightPanel.locator("textarea[name='request_reason']").fill("Browser publish preflight dry-run");
  await preflightPanel.locator("button[type='submit']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("publish preflightを記録しました", { timeout: 5000 });
  await expect(preflightPanel).toContainText("passed", { timeout: 5000 });
  await expect(preflightPanel).toContainText("draft_created", { timeout: 5000 });
  await expect(preflightPanel).toContainText("no_publish: true", { timeout: 5000 });
  await expect(preflightPanel.locator("[data-editor-publish-now]")).toHaveCount(0);
  const preflights = await authedRequest(cloudBase, `/api/admin/campaign-projects/${campaignProjectId}/publish-preflights`);
  expect(preflights.status, preflights.text).toBe(200);
  expect(preflights.json.studio_publish_preflights.some((preflight) => preflight.status === "passed" && preflight.render_manifest_id === renderManifest.render_manifest_id)).toBeTruthy();
  const cutPlanPanel = campaignEditor.locator(".campaign-editor-cut-plan-panel");
  await expect(cutPlanPanel).toContainText("レンダー設計 / QA", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("content_manifest作成");
  await expect(cutPlanPanel).toContainText("no_external_ai");
  await cutPlanPanel.locator("[data-editor-create-cut-plan]").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("cut-planを作成しました", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("draft", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("content_manifestなし", { timeout: 5000 });
  await cutPlanPanel.locator("[data-editor-validate-cut-plan]").first().click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("cut-plan検証に通りました", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("validated", { timeout: 5000 });
  await cutPlanPanel.locator("[data-editor-create-render-manifest]").first().click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("render manifestを作成しました", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("html_preview", { timeout: 5000 });
  await expect(cutPlanPanel).toContainText("html_preview_state", { timeout: 5000 });
  await cutPlanPanel.locator("[data-editor-rerun-render-qa]").first().click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("render QAを再実行しました", { timeout: 5000 });
  campaignEditor.on("dialog", (dialog) => dialog.accept());
  await cutPlanPanel.locator("[data-editor-delete-render-manifest]").first().click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("render manifestを削除しました", { timeout: 5000 });
  await cutPlanPanel.locator("[data-editor-delete-cut-plan]").first().click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("cut-planを削除しました", { timeout: 5000 });
  await campaignEditor.locator("form.campaign-editor-form input[name='headline']").fill("Browser editor scene");
  await campaignEditor.locator("form.campaign-editor-form button[type='submit']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("保存しました", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-stage")).toContainText("Browser editor scene", { timeout: 5000 });
  await campaignEditor.locator("[data-editor-validate]").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("検証に通りました", { timeout: 5000 });
  await campaignEditor.locator("form.campaign-editor-form textarea[name='request_reason']").fill("Browser partial regeneration request");
  await campaignEditor.locator("[data-editor-regeneration-request='scene_regeneration']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("記録しました", { timeout: 5000 });
  await campaignEditor.locator("form.campaign-editor-form textarea[name='request_reason']").fill("Browser copy regeneration request");
  await campaignEditor.locator("[data-editor-regeneration-request='copy_regeneration']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("記録しました", { timeout: 5000 });
  await campaignEditor.locator("form.campaign-editor-form textarea[name='request_reason']").fill("Browser QR CTA regeneration request");
  await campaignEditor.locator("[data-editor-regeneration-request='qr_cta_regeneration']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("記録しました", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-events")).toContainText("scene.regeneration_requested", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-events")).toContainText("scene.copy_regeneration_requested", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-events")).toContainText("scene.qr_cta_regeneration_requested", { timeout: 5000 });
  const editorSceneCount = await campaignEditor.locator("[data-editor-scene-id]").count();
  await campaignEditor.locator("[data-editor-duplicate-scene]").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("複製しました", { timeout: 5000 });
  await expect(campaignEditor.locator("[data-editor-scene-id]")).toHaveCount(editorSceneCount + 1);
  await expect(campaignEditor.locator(".campaign-editor-events")).toContainText("scene.duplicated", { timeout: 5000 });
  await campaignEditor.locator("[data-editor-reorder-scene='up']").click();
  await expect(campaignEditor.locator(".campaign-editor-status")).toContainText("上へ移動しました", { timeout: 5000 });
  await expect(campaignEditor.locator(".campaign-editor-events")).toContainText("scene.reordered", { timeout: 5000 });
  const campaignProjectAfterEditor = await authedRequest(cloudBase, `/api/admin/campaign-projects/${campaignProjectId}`);
  expect(campaignProjectAfterEditor.status, campaignProjectAfterEditor.text).toBe(200);
  expect(campaignProjectAfterEditor.json.campaign_project.scenes.some((scene) => scene.headline === "Browser editor scene")).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "scene.regeneration_requested" && event.metadata.request_status === "manual_required")).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "scene.copy_regeneration_requested" && event.metadata.no_external_ai === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "scene.qr_cta_regeneration_requested" && event.metadata.no_credit_consumption === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "scene.duplicated" && event.metadata.no_publish === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "scene.reordered" && event.metadata.no_content_manifest_creation === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "cut_plan.created" && event.metadata.no_publish === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "cut_plan.validated" && event.metadata.no_content_manifest_creation === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "render_manifest.created" && event.metadata.no_media_generation === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "render_manifest.qa_rerun" && event.metadata.no_publish === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "render_manifest.deleted" && event.metadata.no_content_manifest_creation === true)).toBeTruthy();
  expect(campaignProjectAfterEditor.json.campaign_project.events.some((event) => event.action === "cut_plan.deleted" && event.metadata.no_publish === true)).toBeTruthy();
  await campaignEditor.screenshot({ path: path.join(screenshotsDir, "cloud-campaign-project-editor.png"), fullPage: true });
  await campaignEditor.close();

  action("Create and soft-delete free-input campaign project through cloud admin UI");
  const freeProjectForm = page.locator("#campaign-projects form.campaign-project-free-input");
  await freeProjectForm.locator("select[name='tenant_id']").selectOption("TEN-BROWSER");
  await freeProjectForm.locator("select[name='store_id']").selectOption("STO-BROWSER");
  await freeProjectForm.locator("select[name='screen_group_id']").selectOption("SG-BROWSER");
  await freeProjectForm.locator("input[name='title']").fill("Browser free input project");
  await freeProjectForm.locator("input[name='objective']").fill("店内のおすすめをわかりやすく案内する");
  await freeProjectForm.locator("input[name='target_audience']").fill("夕方の来店客");
  await freeProjectForm.locator("textarea[name='store_context']").fill("駅前店舗で短時間の視聴が多い");
  await freeProjectForm.locator("textarea[name='offer_or_message']").fill("今週のおすすめセットを紹介する");
  await freeProjectForm.locator("input[name='cta']").fill("QRコードで詳細を見る");
  await freeProjectForm.locator("textarea[name='success_metrics']").fill("QR scan\n店頭問い合わせ");
  await freeProjectForm.locator("textarea[name='constraints']").fill("価格表記は税込\n写真は店舗素材を使う");
  await freeProjectForm.locator("button[type='submit']").click();
  await expect(page.locator("#campaign-projects")).toContainText("Browser free input project", { timeout: 5000 });
  campaignProjects = await authedRequest(cloudBase, "/api/admin/campaign-projects?tenant_id=TEN-BROWSER&store_id=STO-BROWSER&screen_group_id=SG-BROWSER");
  campaignProject = campaignProjects.json.campaign_projects.find((project) => project.title === "Browser free input project");
  expect(campaignProject).toBeTruthy();
  await page.locator(`button[data-campaign-project-delete="${campaignProject.campaign_project_id}"]`).click();
  await expect(page.locator("#campaign-projects")).not.toContainText("Browser free input project", { timeout: 5000 });

  action("Update device status and notes through dashboard form");
  const deviceForm = page.locator("form.device-action").first();
  await deviceForm.locator("select[name='status']").selectOption("maintenance");
  await deviceForm.locator("input[name='notes']").fill("browser ui updated note");
  await deviceForm.locator("button[type='submit']").click();
  await expect(page.locator("#devices")).toContainText("メンテナンス中", { timeout: 5000 });
  await expect(page.locator("form.device-action").first().locator("input[name='notes']")).toHaveValue("browser ui updated note");
  const deviceAfterNotes = await authedRequest(cloudBase, "/api/admin/devices/DEV-BROWSER-001");
  expect(deviceAfterNotes.json.device.notes).toBe("browser ui updated note");

  action("Schedule and clear update target through dashboard form");
  const updateForm = page.locator("form.update-action").first();
  await updateForm.locator("input[name='target_update_ref']").fill("main");
  await updateForm.locator("input[name='target_release_id']").fill("browser-release");
  await updateForm.locator("select[name='target_release_channel']").selectOption("stable");
  await updateForm.locator("button[value='schedule']").click();
  await expect(page.locator("#devices")).toContainText("予約済み", { timeout: 5000 });
  await page.locator("form.update-action").first().locator("button[value='clear']").click();
  await expect(page.locator("#devices")).toContainText("待機", { timeout: 5000 });

  action("Reject invalid update ref through cloud admin UI");
  await page.locator("form.update-action").first().locator("input[name='target_update_ref']").fill("bad..ref");
  await page.locator("form.update-action").first().locator("button[value='schedule']").click();
  await expect.poll(() => dialogs.some((message) => message.includes("invalid git ref sequence"))).toBe(true);

  action("Rotate token through cloud admin UI");
  const tokenForm = page.locator("form.token-action").first();
  await tokenForm.locator("input[name='reason']").fill("browser ui rotation evidence");
  await tokenForm.locator("button[value='rotate']").click();
  await expect(page.locator("#token-result")).toContainText("DEV-BROWSER-001", { timeout: 5000 });
  const rotatedDevice = await authedRequest(cloudBase, "/api/admin/devices/DEV-BROWSER-001");
  expect(rotatedDevice.json.device.token_generation).toBe(2);
  expect(rotatedDevice.json.device.token_status).toBe("active");

  action("Create release manifest through cloud admin UI");
  const releaseForm = page.locator("form.release-manifest-create");
  await releaseForm.locator("input[name='manifest_id']").fill("browser-release-manifest");
  await releaseForm.locator("input[name='release_id']").fill("browser-release");
  await releaseForm.locator("input[name='update_ref']").fill("main");
  await releaseForm.locator("input[name='app_version']").fill("0.1.0");
  await releaseForm.locator("input[name='notes']").fill("browser UI evidence");
  await releaseForm.locator("button[type='submit']").click();
  await expect(page.locator("#release-manifests")).toContainText("browser-release-manifest", { timeout: 5000 });

  action("Update release manifest status through cloud admin UI");
  const releaseAction = page.locator("form.release-manifest-action", { hasText: "保存" }).first();
  await releaseAction.locator("select[name='status']").selectOption("retired");
  await releaseAction.locator("button[type='submit']").click();
  await expect(page.locator("#release-manifests")).toContainText("retired", { timeout: 5000 });

  action("Create content manifest through cloud admin UI");
  await expect(page.locator("#content-manifests form.content-manifest-create button[type='submit']")).toHaveText("作成");
  await page.waitForTimeout(500);
  await page.locator("#content-manifests form.content-manifest-create input[name='content_id']").fill("browser-content-manifest");
  await page.locator("#content-manifests form.content-manifest-create input[name='playlist_version']").fill("browser-content-001");
  await page.locator("#content-manifests form.content-manifest-create input[name='title']").fill("Browser content");
  await page.locator("#content-manifests form.content-manifest-create input[name='notes']").fill("browser UI content evidence");
  await expect(page.locator("#content-manifests form.content-manifest-create input[name='content_id']")).toHaveValue("browser-content-manifest");
  await expect(page.locator("#content-manifests form.content-manifest-create input[name='playlist_version']")).toHaveValue("browser-content-001");
  await expect(page.locator("#content-manifests form.content-manifest-create input[name='title']")).toHaveValue("Browser content");
  await page.locator("#content-manifests form.content-manifest-create button[type='submit']").click();
  await expect(page.locator("#content-manifests")).toContainText("browser-content-manifest", { timeout: 5000 });

  action("Reject invalid content manifest payload through cloud admin API");
  const invalidContent = await authedRequest(cloudBase, "/api/admin/content-manifests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content_id: "browser-invalid-content",
      playlist_version: "browser-invalid-content",
      release_channel: "stable",
      status: "draft",
      playlist: { version: 1, playlist_version: "browser-invalid-content", items: "not-an-array" }
    })
  });
  expect(invalidContent.status, invalidContent.text).toBe(400);
  expect(invalidContent.text).toContain("playlist.items must be an array");

  action("Update content manifest status through cloud admin UI");
  const contentAction = page.locator("form.content-manifest-action").first();
  await contentAction.locator("select[name='status']").selectOption("active");
  const contentRefreshPromise = page.waitForResponse((response) => (
    response.request().method() === "GET" &&
    response.url() === `${cloudBase}/api/admin/assets` &&
    response.status() === 200
  ));
  await contentAction.locator("button[type='submit']").click();
  await contentRefreshPromise;
  await expect(page.locator("#content-manifests")).toContainText("active", { timeout: 5000 });

  action("Upload cloud asset through cloud admin UI");
  const cloudAssetForm = page.locator("#assets form.asset-upload");
  await cloudAssetForm.locator("input[name='asset_id']").fill("browser-cloud-asset");
  await cloudAssetForm.locator("input[name='label']").fill("Browser cloud asset");
  await cloudAssetForm.locator("input[name='notes']").fill("browser cloud asset evidence");
  await cloudAssetForm.locator("input[name='asset']").setInputFiles(path.join(artifactsDir, "valid-1x1.png"));
  await cloudAssetForm.locator("button[type='submit']").click();
  await expect(page.locator("#assets")).toContainText("browser-cloud-asset", { timeout: 5000 });
  await expect(page.locator("#assets")).toContainText("Browser cloud asset");
  const cloudAssets = await authedRequest(cloudBase, "/api/admin/assets");
  const uploadedAsset = cloudAssets.json.assets.find((asset) => asset.asset_id === "browser-cloud-asset");
  expect(uploadedAsset).toBeTruthy();
  expect(uploadedAsset.type).toBe("image");
  expect(uploadedAsset.mime_type).toBe("image/png");
  expect(uploadedAsset.download_path).toBe("/api/admin/assets/browser-cloud-asset/download");
  const cloudAssetImageResponse = await page.request.get(`${cloudBase}${uploadedAsset.download_path}`);
  expect(cloudAssetImageResponse.ok()).toBeTruthy();
  expect(cloudAssetImageResponse.headers()["content-type"]).toContain("image/png");
  const cloudAssetImage = await cloudAssetImageResponse.body();
  expect(cloudAssetImage.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  await page.screenshot({ path: path.join(screenshotsDir, "cloud-admin-assets.png"), fullPage: true });

  action("Create active content manifest with required cloud asset");
  const cloudAssetTargetPath = "/assets/images/browser-cloud-asset.png";
  const assetContent = await authedRequest(cloudBase, "/api/admin/content-manifests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content_id: "browser-content-with-asset",
      playlist_version: "browser-content-with-asset-001",
      release_channel: "stable",
      status: "active",
      title: "Browser asset content",
      notes: "browser asset sync evidence",
      playlist: {
        version: 1,
        playlist_version: "browser-content-with-asset-001",
        updatedAt: new Date().toISOString(),
        items: [
          {
            id: "browser-cloud-asset-wide",
            item_id: "browser-cloud-asset-wide",
            name: "Browser cloud asset wide",
            enabled: true,
            layout: "wide",
            duration: 2,
            start: "",
            end: "",
            days_of_week: [],
            campaign_id: "cmp-browser-cloud-asset",
            asset_id: "browser-cloud-asset",
            priority: 0,
            left: "",
            center: "",
            right: "",
            wide: cloudAssetTargetPath
          }
        ]
      },
      assets: [
        {
          asset_id: "browser-cloud-asset",
          target_path: cloudAssetTargetPath
        }
      ]
    })
  });
  expect(assetContent.status, assetContent.text).toBe(201);
  expect(assetContent.json.content_manifest.assets).toHaveLength(1);
  expect(assetContent.json.content_manifest.assets[0].target_path).toBe(cloudAssetTargetPath);

  action("Fetch content policy, device asset download, and run sync-assets.sh");
  const assetDeviceToken = await createCloudDeviceWithHeartbeat("DEV-BROWSER-ASSET-001", "browser-ui-old");
  const contentPolicy = await fetch(`${cloudBase}/api/device/content-policy`, {
    headers: { Authorization: `Bearer ${assetDeviceToken}` }
  });
  expect(contentPolicy.status, await contentPolicy.clone().text()).toBe(200);
  const contentPolicyJson = await contentPolicy.json();
  expect(contentPolicyJson.content.required).toBe(true);
  expect(contentPolicyJson.content.assets).toHaveLength(1);
  const policyAsset = contentPolicyJson.content.assets[0];
  expect(policyAsset.asset_id).toBe("browser-cloud-asset");
  expect(policyAsset.download_url).toBe("/api/device/assets/browser-cloud-asset/download");
  expect(policyAsset.sha256).toBe(uploadedAsset.sha256);
  const deviceAssetDownload = await fetch(`${cloudBase}${policyAsset.download_url}`, {
    headers: { Authorization: `Bearer ${assetDeviceToken}` }
  });
  expect(deviceAssetDownload.status, await deviceAssetDownload.clone().text()).toBe(200);
  expect(deviceAssetDownload.headers.get("content-type")).toContain("image/png");
  const deviceAssetBytes = Buffer.from(await deviceAssetDownload.arrayBuffer());
  expect(deviceAssetBytes.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const syncedAssetsDir = path.join(tmpDir, "synced-cloud-assets");
  const assetSync = await runCommand(path.join(repoRoot, "apps/player/scripts/sync-assets.sh"), [], {
    env: {
      MISELL_HOME: path.join(repoRoot, "apps/player"),
      MISELL_ENV_FILE: path.join(tmpDir, "missing-asset-sync-env"),
      MISELL_HEARTBEAT_URL: `${cloudBase}/api/device/heartbeat`,
      MISELL_DEVICE_TOKEN: assetDeviceToken,
      MISELL_ASSETS_DIR: syncedAssetsDir,
      MISELL_ASSET_SYNC_LOCK_FILE: path.join(tmpDir, "asset-sync.lock")
    },
    timeoutMs: 45000
  });
  expect(assetSync.code, `${assetSync.stdout}\n${assetSync.stderr}`).toBe(0);
  const syncedAsset = await fsp.readFile(path.join(syncedAssetsDir, "images", "browser-cloud-asset.png"));
  expect(syncedAsset.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  expect(syncedAsset.equals(deviceAssetBytes)).toBeTruthy();

  const contentResult = await fetch(`${cloudBase}/api/device/content-result`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${assetDeviceToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      status: "success",
      content_id: "browser-content-with-asset",
      playlist_version: "browser-content-with-asset-001",
      message: "browser asset content applied"
    })
  });
  expect(contentResult.status, await contentResult.text()).toBe(201);

  const rollout = await authedRequest(cloudBase, "/api/admin/content-rollouts/browser-content-with-asset");
  expect(rollout.status, rollout.text).toBe(200);
  const assetDeviceRollout = rollout.json.rollout.devices.find((device) => device.device_id === "DEV-BROWSER-ASSET-001");
  expect(assetDeviceRollout).toBeTruthy();
  expect(assetDeviceRollout.rollout_status).toBe("ready");
  expect(assetDeviceRollout.assets_ready).toBe(true);
  expect(assetDeviceRollout.playlist_ready).toBe(true);

  action("Open content rollout visibility and request asset resync");
  await page.locator("#refresh").click();
  await expect(page.locator("#content-manifests")).toContainText("browser-content-with-asset", { timeout: 5000 });
  await page.locator('form.content-manifest-action[data-content-id="browser-content-with-asset"] .content-rollout-open').click();
  await expect(page.locator("#content-rollout")).toContainText("DEV-BROWSER-ASSET-001", { timeout: 5000 });
  await expect(page.locator("#content-rollout")).toContainText("反映済み");
  await page.locator('#content-rollout .content-rollout-retry[data-device-id="DEV-BROWSER-ASSET-001"]').click();
  await expect(page.locator("#content-rollout")).toContainText("同期中", { timeout: 5000 });
  const rolloutAfterRetry = await authedRequest(cloudBase, "/api/admin/content-rollouts/browser-content-with-asset");
  const retriedDeviceRollout = rolloutAfterRetry.json.rollout.devices.find((device) => device.device_id === "DEV-BROWSER-ASSET-001");
  expect(retriedDeviceRollout.rollout_status).toBe("updating");
  expect(retriedDeviceRollout.asset_states[0].status).toBe("checking");

  action("Reject missing cloud asset file through cloud admin API");
  const invalidCloudAsset = await authedRequest(cloudBase, "/api/admin/assets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_id: "browser-invalid-cloud-asset" })
  });
  expect(invalidCloudAsset.status, invalidCloudAsset.text).toBe(400);
  expect(invalidCloudAsset.text).toContain("asset file is required");

  action("Revoke token through cloud admin UI");
  const revokeForm = page.locator('form.token-action[data-device-id="DEV-BROWSER-001"]');
  await expect(revokeForm).toHaveCount(1);
  await revokeForm.locator("input[name='reason']").fill("browser ui revoke evidence");
  await expect(revokeForm.locator("input[name='reason']")).toHaveValue("browser ui revoke evidence");
  const revokeRequestPromise = page.waitForRequest((request) => (
    request.method() === "POST" && request.url() === `${cloudBase}/api/admin/devices/DEV-BROWSER-001/token/revoke`
  ));
  await revokeForm.evaluate((form, reason) => {
    form.elements.reason.value = reason;
    form.querySelector("button[value='revoke']").click();
  }, "browser ui revoke evidence");
  const revokeRequest = await revokeRequestPromise;
  expect(revokeRequest.postData()).toContain("browser ui revoke evidence");
  await expect(page.locator("#devices")).toContainText("失効済み", { timeout: 5000 });
  const revokedDevice = await authedRequest(cloudBase, "/api/admin/devices/DEV-BROWSER-001");
  expect(revokedDevice.json.device.token_status).toBe("revoked");
  expect(revokedDevice.json.device.token_revoked_reason).toBe("browser ui revoke evidence");

  action("Open device detail page");
  await page.locator("#devices a", { hasText: "DEV-BROWSER-001" }).click();
  await expect(page.locator("h1")).toHaveText("DEV-BROWSER-001");
  await expect(page.locator("body")).toContainText("browser-ui-device");
  await page.screenshot({ path: path.join(screenshotsDir, "cloud-admin-device-detail.png"), fullPage: true });
  await context.close();
});

test("critical UIs render on mobile viewport", async ({ browser }) => {
  const context = await browser.newContext({
    httpCredentials: { username: user, password },
    viewport: { width: 390, height: 844 },
    isMobile: true
  });
  const page = await context.newPage();
  wirePage(page, "mobile");

  action("Open mobile player preview");
  await page.goto(`${playerBase}/player?preview=1`, { waitUntil: "domcontentloaded" });
  await expect(page.locator("#player-status")).toContainText(/Browser/);
  await expectPreviewStageFitsViewport(page);
  await page.screenshot({ path: path.join(screenshotsDir, "mobile-player-preview.png"), fullPage: true });

  action("Open mobile local admin");
  await page.goto(`${playerBase}/admin`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("LAN管理画面");
  await expect(page.locator("#playlist-editor .playlist-item").first()).toBeVisible();
  await page.screenshot({ path: path.join(screenshotsDir, "mobile-player-admin.png"), fullPage: true });

  action("Open mobile cloud admin");
  await page.goto(`${cloudBase}/admin`, { waitUntil: "networkidle" });
  await expect(page.locator("h1")).toHaveText("Misell 端末監視");
  await expect(page.getByRole("navigation", { name: "管理メニュー" })).toBeVisible();
  await page.getByRole("navigation", { name: "管理メニュー" }).getByRole("link", { name: "配信" }).click();
  await expect(page).toHaveURL(/#delivery$/);
  await expect(page.locator("#devices")).toContainText("DEV-BROWSER-001");
  await page.screenshot({ path: path.join(screenshotsDir, "mobile-cloud-admin.png"), fullPage: true });
  await context.close();
});
