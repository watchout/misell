#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");
const fs = require("fs");

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter(Boolean)
  .filter((file) => !file.includes("/node_modules/") && !file.endsWith("package-lock.json"));

const patterns = [
  { name: "GitHub token", re: /gh[pousr]_[A-Za-z0-9_]{20,}/ },
  { name: "AWS access key", re: /AKIA[0-9A-Z]{16}/ },
  { name: "OpenAI key", re: /sk-[A-Za-z0-9_-]{40,}/ },
  { name: "Private key", re: /-----BEGIN (RSA |OPENSSH |EC |DSA |)?PRIVATE KEY-----/ }
];

const errors = [];
for (const file of files) {
  if (!/\.(js|json|md|yml|yaml|html|css|sh|env|example)$/.test(file)) continue;
  const text = fs.readFileSync(file, "utf8");
  for (const pattern of patterns) {
    if (pattern.re.test(text)) errors.push(`${file} may contain ${pattern.name}`);
  }
}

if (errors.length) {
  console.error("Secret scan failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Secret scan passed.");
