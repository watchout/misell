const path = require("node:path");

module.exports = {
  testDir: __dirname,
  testMatch: "misell-ui.spec.js",
  timeout: 90000,
  expect: {
    timeout: 10000
  },
  outputDir: path.resolve(__dirname, "../../test-results/playwright"),
  use: {
    browserName: "chromium",
    headless: true,
    actionTimeout: 15000,
    navigationTimeout: 30000,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure"
  },
  workers: 1,
  reporter: process.env.CI
    ? [
        ["list"],
        ["html", { outputFolder: path.resolve(__dirname, "../../playwright-report"), open: "never" }]
      ]
    : [
        ["line"],
        ["html", { outputFolder: path.resolve(__dirname, "../../playwright-report"), open: "never" }]
      ]
};
