#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const resultDir = process.env.SHIRUBE_RESULT_DIR || ".shirube-rapid-lite";
mkdirSync(resultDir, { recursive: true });

const changedFiles = [
  ...gitLines(["diff", "--name-only", "origin/main...HEAD"]),
  ...gitLines(["ls-files", "--others", "--exclude-standard"]),
]
  .filter(Boolean)
  .filter((file) => !file.startsWith(`${resultDir.replace(/\/+$/u, "")}/`))
  .sort((a, b) => a.localeCompare(b));

writeFileSync(path.join(resultDir, "changed-files.txt"), `${[...new Set(changedFiles)].join("\n")}\n`);

const handoffPath = ".shirube/control-handoff.yaml";
const runtimeHandoff = path.join(resultDir, "control-handoff.runtime.yaml");
if (existsSync(handoffPath)) {
  const head = gitLines(["rev-parse", "HEAD"])[0] || "local-head";
  const handoff = readFileSync(handoffPath, "utf8");
  writeFileSync(runtimeHandoff, `${handoff.replace(/\n*$/u, "\n")}pr_head_sha: "${head}"\n`);
}

writeFileSync(
  path.join(resultDir, "pr-body.md"),
  existsSync(runtimeHandoff) ? `handoff_ref: ${runtimeHandoff}\n` : "",
);

const result = spawnSync(process.execPath, [
  "scripts/shirube/run-rapid-lite-report.mjs",
  "--result-dir",
  resultDir,
  "--changed-files",
  path.join(resultDir, "changed-files.txt"),
  "--pr-body",
  path.join(resultDir, "pr-body.md"),
  "--diff-root",
  ".",
  "--format",
  "json",
], {
  stdio: "inherit",
});

process.exitCode = result.status ?? 1;

function gitLines(args) {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}
