#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const command = process.argv[2] || "";
const args = parseArgs(process.argv.slice(3));

try {
  if (command === "write") {
    writeStagingRelease();
  } else if (command === "promote") {
    promoteRelease();
  } else if (command === "resolve") {
    resolveRelease();
  } else {
    throw new Error(`Unknown command: ${command}`);
  }
} catch (error) {
  console.error(error.message || String(error));
  process.exit(1);
}

function writeStagingRelease() {
  const policy = parseJson(process.env.POLICY_JSON || "", {});
  const content = policy.content || {};
  const playlist = content.playlist;
  if (!playlist || !Array.isArray(playlist.items)) {
    throw new Error("content.playlist.items is required");
  }

  const releasesDir = requiredPath(args.releases_dir, "releases-dir");
  const stagingRoot = path.join(releasesDir, ".staging");
  const releaseId = safeReleaseId(args.release_id || makeReleaseId(content));
  const stagingDir = path.join(stagingRoot, `${releaseId}.${process.pid}`);
  assertInside(stagingRoot, stagingDir, "staging dir");

  fs.rmSync(stagingDir, { recursive: true, force: true });
  fs.mkdirSync(stagingDir, { recursive: true, mode: 0o755 });

  const playlistPath = path.join(stagingDir, "playlist.json");
  fs.writeFileSync(playlistPath, `${JSON.stringify(playlist, null, 2)}\n`);

  const manifest = {
    schema_version: 1,
    release_id: releaseId,
    content_id: cleanString(content.content_id),
    playlist_version: cleanString(content.playlist_version || playlist.playlist_version || playlist.version),
    source: cleanString(content.source || "content_manifest"),
    release_channel: cleanString(content.release_channel),
    created_at: new Date().toISOString(),
    playlist_sha256: sha256File(playlistPath),
    playlist_path: "playlist.json",
    assets: normalizeAssets(content.assets)
  };
  const manifestPath = path.join(stagingDir, "manifest.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  print({
    release_id: releaseId,
    staging_dir: stagingDir,
    release_dir: path.join(releasesDir, releaseId),
    playlist_path: playlistPath,
    manifest_path: manifestPath,
    manifest,
    content_id: manifest.content_id,
    playlist_version: manifest.playlist_version,
    playlist_sha256: manifest.playlist_sha256
  });
}

function promoteRelease() {
  const stagingDir = optionalPath(args.staging_dir);
  const releaseDir = requiredPath(args.release_dir, "release-dir");
  const currentLink = requiredPath(args.current_link, "current-link");
  const playlistPath = requiredPath(args.playlist_path, "playlist-path");
  const previousCurrent = capturePathState(currentLink);
  const previousPlaylist = capturePathState(playlistPath);
  let movedStaging = false;

  try {
    if (stagingDir) {
      assertInside(path.dirname(path.dirname(stagingDir)), stagingDir, "staging dir");
      if (fs.existsSync(releaseDir)) {
        throw new Error(`release already exists: ${releaseDir}`);
      }
      fs.mkdirSync(path.dirname(releaseDir), { recursive: true });
      fs.renameSync(stagingDir, releaseDir);
      movedStaging = true;
    }

    const releasePlaylistPath = path.join(releaseDir, "playlist.json");
    if (!fs.existsSync(releasePlaylistPath)) {
      throw new Error(`release playlist is missing: ${releasePlaylistPath}`);
    }
    fs.mkdirSync(path.dirname(currentLink), { recursive: true });
    fs.mkdirSync(path.dirname(playlistPath), { recursive: true });
    atomicSymlink(releaseDir, currentLink, "dir");
    if (process.env.MISELL_RELEASE_BUNDLE_FAIL_AFTER_CURRENT === "1") {
      throw new Error("injected promote failure after current pointer update");
    }
    atomicSymlink(path.join(currentLink, "playlist.json"), playlistPath, "file");

    const manifest = readManifest(releaseDir);
    print({
      release_id: manifest.release_id || path.basename(releaseDir),
      release_dir: releaseDir,
      current_link: currentLink,
      playlist_path: playlistPath,
      content_id: manifest.content_id || "",
      playlist_version: manifest.playlist_version || playlistVersionFor(releasePlaylistPath),
      playlist_sha256: manifest.playlist_sha256 || sha256File(releasePlaylistPath),
      manifest
    });
  } catch (error) {
    restorePathState(currentLink, previousCurrent);
    restorePathState(playlistPath, previousPlaylist);
    if (movedStaging) {
      fs.rmSync(releaseDir, { recursive: true, force: true });
    }
    throw error;
  }
}

function resolveRelease() {
  const releasesDir = requiredPath(args.releases_dir, "releases-dir");
  const currentLink = requiredPath(args.current_link, "current-link");
  const target = cleanString(args.target || "previous");
  let releaseDir = "";

  if (target === "previous") {
    releaseDir = previousReleaseDir(releasesDir, currentLink);
  } else {
    const releaseId = safeReleaseId(target);
    releaseDir = path.join(releasesDir, releaseId);
    assertInside(releasesDir, releaseDir, "release dir");
  }

  if (!fs.existsSync(path.join(releaseDir, "playlist.json"))) {
    throw new Error(`release playlist is missing: ${releaseDir}`);
  }
  const manifest = readManifest(releaseDir);
  print({
    release_id: manifest.release_id || path.basename(releaseDir),
    release_dir: releaseDir,
    playlist_path: path.join(releaseDir, "playlist.json"),
    content_id: manifest.content_id || "",
    playlist_version: manifest.playlist_version || playlistVersionFor(path.join(releaseDir, "playlist.json")),
    playlist_sha256: manifest.playlist_sha256 || sha256File(path.join(releaseDir, "playlist.json")),
    manifest
  });
}

function previousReleaseDir(releasesDir, currentLink) {
  const currentRealpath = realpathOrEmpty(currentLink);
  const entries = fs.existsSync(releasesDir) ? fs.readdirSync(releasesDir, { withFileTypes: true }) : [];
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === ".staging") continue;
    const releaseDir = path.join(releasesDir, entry.name);
    const playlistPath = path.join(releaseDir, "playlist.json");
    if (!fs.existsSync(playlistPath)) continue;
    const releaseRealpath = realpathOrEmpty(releaseDir);
    if (currentRealpath && releaseRealpath === currentRealpath) continue;
    const manifest = readManifest(releaseDir);
    const stat = fs.statSync(releaseDir);
    candidates.push({
      releaseDir,
      createdAt: Date.parse(manifest.created_at || "") || stat.mtimeMs,
      releaseId: manifest.release_id || entry.name
    });
  }
  candidates.sort((left, right) => {
    if (right.createdAt !== left.createdAt) return right.createdAt - left.createdAt;
    return right.releaseId.localeCompare(left.releaseId);
  });
  if (!candidates.length) throw new Error("previous release was not found");
  return candidates[0].releaseDir;
}

function makeReleaseId(content) {
  const raw = [
    cleanString(content.content_id || "content"),
    cleanString(content.playlist_version || "playlist"),
    new Date().toISOString()
  ].join(":");
  const safe = raw.replace(/[^a-zA-Z0-9_.:-]/g, "-").slice(0, 100);
  const digest = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 12);
  return `${safe}-${digest}`;
}

function safeReleaseId(value) {
  const releaseId = cleanString(value);
  if (!/^[a-zA-Z0-9_.:-]{1,160}$/.test(releaseId)) {
    throw new Error("release_id contains unsafe characters");
  }
  return releaseId;
}

function normalizeAssets(value) {
  const assets = Array.isArray(value) ? value : [];
  return assets.map((asset) => ({
    asset_id: cleanString(asset.asset_id || asset.assetId),
    target_path: cleanString(asset.target_path || asset.targetPath),
    sha256: cleanString(asset.sha256),
    size: Number.isSafeInteger(Number(asset.size)) ? Number(asset.size) : 0,
    required: asset.required !== false
  }));
}

function atomicSymlink(target, linkPath, type) {
  const tempLink = `${linkPath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  fs.rmSync(tempLink, { recursive: true, force: true });
  fs.symlinkSync(target, tempLink, type);
  fs.renameSync(tempLink, linkPath);
}

function capturePathState(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isSymbolicLink()) {
      return { exists: true, kind: "non_symlink" };
    }
    const linkTarget = fs.readlinkSync(filePath);
    let linkType = "file";
    try {
      linkType = fs.statSync(filePath).isDirectory() ? "dir" : "file";
    } catch {
      linkType = "file";
    }
    return { exists: true, kind: "symlink", linkTarget, linkType };
  } catch {
    return { exists: false, kind: "absent" };
  }
}

function restorePathState(filePath, state) {
  if (!state || state.kind === "non_symlink") return;
  if (!state.exists) {
    fs.rmSync(filePath, { recursive: true, force: true });
    return;
  }
  atomicSymlink(state.linkTarget, filePath, state.linkType || "file");
}

function readManifest(releaseDir) {
  return parseJson(readFileOrEmpty(path.join(releaseDir, "manifest.json")), {});
}

function playlistVersionFor(playlistPath) {
  const playlist = parseJson(readFileOrEmpty(playlistPath), {});
  return cleanString(playlist.playlist_version || playlist.version);
}

function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function readFileOrEmpty(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function requiredPath(value, label) {
  const resolved = optionalPath(value);
  if (!resolved) throw new Error(`${label} is required`);
  return resolved;
}

function optionalPath(value) {
  const clean = cleanString(value);
  return clean ? path.resolve(clean) : "";
}

function assertInside(parent, child, label) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} is outside its parent directory`);
  }
}

function realpathOrEmpty(filePath) {
  try {
    return fs.realpathSync.native(filePath);
  } catch {
    return "";
  }
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const key = values[index];
    if (!key.startsWith("--")) continue;
    const normalized = key.slice(2).replace(/-/g, "_");
    const next = values[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[normalized] = "1";
    } else {
      parsed[normalized] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function cleanString(value) {
  return String(value ?? "").trim();
}

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
