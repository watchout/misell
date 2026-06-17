#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.includes("/node_modules/"));

const errors = [];
const conflictMarkerPattern = /^(?:<{7}(?: .*)?|={7}|>{7}(?: .*)?)$/m;
for (const file of files) {
  if (!/\.(js|json|md|yml|yaml|html|css|sh)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (conflictMarkerPattern.test(text)) {
    errors.push(`${file} contains merge conflict markers`);
  }
}

if (errors.length) {
  console.error("Repo lint failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Repo lint passed for ${files.length} tracked files.`);
