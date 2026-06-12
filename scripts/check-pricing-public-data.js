#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const Ajv2020 = require("ajv/dist/2020");

const repoRoot = path.resolve(__dirname, "..");
const publicYamlPath = path.join(repoRoot, "docs/data/pricing/misell_pricing.public.yaml");
const schemaPath = path.join(repoRoot, "docs/data/pricing/misell_pricing.schema.json");
const internalExamplePath = path.join(
  repoRoot,
  "docs/data/pricing/misell_pricing.internal.example.yaml",
);

const forbiddenInternalKeys = new Set([
  "cash_cost_ex_tax",
  "internal_work_cost_ex_tax",
  "risk_cost_ex_tax",
  "management_cost_ex_tax",
  "gross_profit_ex_tax",
  "gross_margin_percent",
  "channel_after_profit",
  "channel_after_profit_ex_tax",
  "agency_commission",
  "agency_commission_percent",
  "agency_fee",
  "agency_fee_percent",
  "partner_commission",
  "supplier_terms",
  "wholesale_terms",
  "dealer_terms",
  "channel_margin",
  "channel_margin_percent",
]);

const expectedPublicPrices = {
  lite: {
    monthly: 49800,
    initial: [580000, 980000, 980000, 1380000],
  },
  standard: {
    monthly: 79800,
    initial: [880000, 1480000, 1330000, 1930000],
  },
  media: {
    monthly: 128000,
    initial: "quote",
  },
};

const handMaintainedPriceDocs = [
  "docs/06_BUSINESS_MODEL_PRICING.md",
  "docs/09_TEST_INTRODUCTION_PLAN.md",
  "docs/14_AI_EXTENSION_PLAN.md",
  "docs/23_MEDIA_KIT_TEMPLATE.md",
  "docs/31_UNIT_ECONOMICS_MODEL.md",
  "docs/32_PARTNER_AGENCY_STRATEGY.md",
  "docs/42_AI_ADDON_SPEC.md",
  "docs/60_TEST_INTRO_PROPOSAL_DECK.md",
  "docs/61_CUSTOMER_PRICING_TABLE.md",
  "docs/62_MISELL_MEDIA_KIT.md",
];

const partnerConditionDocs = [
  "docs/32_PARTNER_AGENCY_STRATEGY.md",
  "docs/62_MISELL_MEDIA_KIT.md",
  "docs/66_EQUIPMENT_AND_PRICE_REFERENCE.md",
];

const skipDirs = new Set([
  ".git",
  "node_modules",
  "test-results",
  "playwright-report",
  "apps/player/data/backups",
]);

const salesClaimRules = [
  {
    name: "sales-or-revenue-guarantee",
    pattern:
      /(売上|収益|広告収益|広告収入|来館者数).{0,36}(保証|必ず|確実|約束|増加)|(保証|必ず|確実|約束).{0,36}(売上|収益|広告収益|広告収入|来館者数)/,
  },
  {
    name: "view-or-impression-guarantee",
    pattern:
      /(視認数|視認者数|表示回数|インプレッション).{0,36}(保証|正確|確実|取得できる)|(保証|正確|確実).{0,36}(視認数|視認者数|表示回数|インプレッション)/,
  },
  {
    name: "ai-individual-identification",
    pattern:
      /(AIカメラ|AI Count|AI Edge|匿名AIカウント|AIカウント).{0,80}(個人識別|個人追跡|顔識別|個人ID|個人単位)|(個人識別|個人追跡|顔識別|個人ID|個人単位).{0,80}(AIカメラ|AI Count|AI Edge|匿名AIカウント|AIカウント)/,
  },
];

const allowedClaimContext =
  /(保証しない|保証しません|保証をしない|保証せず|保証ではなく|保証するものではない|保証されません|保証はしない|過大に約束しない|取得しない|追跡しない|顔識別しない|入れない|ではない|禁止|避ける|やってはいけない|not guaranteed|not guarantee|not included|outside)/i;

const failures = [];

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function rel(filePath) {
  return path.relative(repoRoot, filePath);
}

function findFiles(root, predicate, out = []) {
  if (!fs.existsSync(root)) {
    return out;
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    const relative = rel(fullPath);
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name) || skipDirs.has(relative)) {
        continue;
      }
      findFiles(fullPath, predicate, out);
      continue;
    }
    if (entry.isFile() && predicate(fullPath)) {
      out.push(fullPath);
    }
  }
  return out;
}

function recordFailure(message) {
  failures.push(message);
}

function assertFileExists(filePath) {
  if (!fs.existsSync(filePath)) {
    recordFailure(`Missing required file: ${rel(filePath)}`);
  }
}

function walkObject(value, visitor, trail = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkObject(item, visitor, trail.concat(String(index))));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    visitor(key, child, trail.concat(key));
    walkObject(child, visitor, trail.concat(key));
  }
}

function assertNoForbiddenKeys(data, fileLabel) {
  walkObject(data, (key, _value, trail) => {
    const normalized = key.trim().toLowerCase();
    if (forbiddenInternalKeys.has(normalized)) {
      recordFailure(`${fileLabel} contains forbidden internal key at ${trail.join(".")}`);
    }
  });
}

function assertSourceStatuses(data) {
  const badPaths = [];
  walkObject(data, (key, value, trail) => {
    if (key === "source_status" && value !== "needs_human_approval") {
      badPaths.push(`${trail.join(".")}=${value}`);
    }
  });
  if (data.source_status_default !== "needs_human_approval") {
    badPaths.push(`source_status_default=${data.source_status_default}`);
  }
  if (badPaths.length > 0) {
    recordFailure(`Public pricing source_status must remain needs_human_approval: ${badPaths.join(", ")}`);
  }
}

function assertExpectedPrices(data) {
  const plans = new Map((data.plans || []).map((plan) => [plan.id, plan]));
  for (const [planId, expected] of Object.entries(expectedPublicPrices)) {
    const plan = plans.get(planId);
    if (!plan) {
      recordFailure(`Missing required plan: ${planId}`);
      continue;
    }
    if (plan.monthly_fee?.amount !== expected.monthly) {
      recordFailure(`Unexpected monthly amount for ${planId}: ${plan.monthly_fee?.amount}`);
    }
    if (expected.initial === "quote") {
      if (plan.initial_fee?.kind !== "quote") {
        recordFailure(`Expected quote initial_fee for ${planId}`);
      }
      continue;
    }
    const amounts = (plan.initial_fee?.variants || []).map((variant) => variant.amount);
    if (JSON.stringify(amounts) !== JSON.stringify(expected.initial)) {
      recordFailure(`Unexpected initial variants for ${planId}: ${amounts.join(",")}`);
    }
  }
}

function assertInternalExampleIsDummy() {
  assertFileExists(internalExamplePath);
  if (!fs.existsSync(internalExamplePath)) {
    return;
  }
  const data = YAML.parse(readText(internalExamplePath));
  if (data?.example_only !== true || data?.do_not_copy_real_values_into_public_repo !== true) {
    recordFailure("internal.example.yaml must be marked example_only and do_not_copy_real_values_into_public_repo");
  }
  const text = readText(internalExamplePath);
  for (const key of forbiddenInternalKeys) {
    if (text.includes(`${key}:`)) {
      recordFailure(`internal.example.yaml must not define real internal field ${key}`);
    }
  }
}

function assertNoRealInternalFile() {
  const internalFiles = findFiles(repoRoot, (filePath) => path.basename(filePath) === "misell_pricing.internal.yaml");
  if (internalFiles.length > 0) {
    recordFailure(
      `Real internal pricing YAML must not exist in this public repo: ${internalFiles.map(rel).join(", ")}`,
    );
  }
}

function assertHandMaintainedPriceDocsAreRetired() {
  const pricePattern =
    /(?:円|料金|費用|価格|月額).{0,40}([0-9]{1,3},[0-9]{3}(?:,[0-9]{3})?|[0-9]+万|\+\s*[0-9])|([0-9]{1,3},[0-9]{3}(?:,[0-9]{3})?|[0-9]+万|\+\s*[0-9]).{0,40}(?:円|料金|費用|価格|月額)/;
  for (const relativePath of handMaintainedPriceDocs) {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) {
      recordFailure(`Missing expected pricing doc: ${relativePath}`);
      continue;
    }
    const text = readText(filePath);
    const badLines = text
      .split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => pricePattern.test(line));
    if (badLines.length > 0) {
      recordFailure(
        `${relativePath} still has hand-maintained yen/plus price lines: ${badLines
          .slice(0, 5)
          .map(({ number }) => number)
          .join(", ")}`,
      );
    }
  }
}

function assertPartnerConditionsArePrivate() {
  const partnerConditionPattern = /(報酬|手数料|取り分|パートナー条件|代理店).{0,40}[0-9]{1,3}\s*%|[0-9]{1,3}\s*%.{0,40}(報酬|手数料|取り分|パートナー条件|代理店)/;
  for (const relativePath of partnerConditionDocs) {
    const filePath = path.join(repoRoot, relativePath);
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const text = readText(filePath);
    const badLines = text
      .split(/\r?\n/)
      .map((line, index) => ({ line, number: index + 1 }))
      .filter(({ line }) => partnerConditionPattern.test(line));
    if (badLines.length > 0) {
      recordFailure(
        `${relativePath} still has explicit partner economics lines: ${badLines
          .slice(0, 5)
          .map(({ number }) => number)
          .join(", ")}`,
      );
    }
  }
}

function assertSalesClaimsAreSafe() {
  const files = [
    path.join(repoRoot, "README.md"),
    ...findFiles(path.join(repoRoot, "docs"), (filePath) => filePath.endsWith(".md")),
    ...findFiles(path.join(repoRoot, "apps/player/public"), (filePath) => /\.(html|js)$/.test(filePath)),
    ...findFiles(path.join(repoRoot, "apps/cloud/public"), (filePath) => /\.(html|js)$/.test(filePath)),
  ];

  for (const filePath of files) {
    if (!fs.existsSync(filePath)) {
      continue;
    }
    const lines = readText(filePath).split(/\r?\n/);
    lines.forEach((line, index) => {
      for (const rule of salesClaimRules) {
        if (!rule.pattern.test(line)) {
          continue;
        }
        const context = [
          lines[index - 4],
          lines[index - 3],
          lines[index - 2],
          lines[index - 1],
          line,
          lines[index + 1],
          lines[index + 2],
        ]
          .filter(Boolean)
          .join("\n");
        if (allowedClaimContext.test(context)) {
          continue;
        }
        recordFailure(`${rel(filePath)}:${index + 1} matches unsafe sales claim rule ${rule.name}`);
      }
    });
  }
}

function validatePublicYaml() {
  assertFileExists(publicYamlPath);
  assertFileExists(schemaPath);
  if (!fs.existsSync(publicYamlPath) || !fs.existsSync(schemaPath)) {
    return null;
  }

  const publicData = YAML.parse(readText(publicYamlPath));
  const schema = JSON.parse(readText(schemaPath));
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(publicData)) {
    recordFailure(`Public pricing YAML failed schema validation: ${JSON.stringify(validate.errors)}`);
  }

  const forbiddenProbe = JSON.parse(JSON.stringify(publicData));
  forbiddenProbe.plans[0].gross_profit_ex_tax = 1;
  if (validate(forbiddenProbe)) {
    recordFailure("Pricing schema accepted a public plan with a forbidden internal economics field");
  }

  assertNoForbiddenKeys(publicData, "misell_pricing.public.yaml");
  assertSourceStatuses(publicData);
  assertExpectedPrices(publicData);
  return publicData;
}

validatePublicYaml();
assertInternalExampleIsDummy();
assertNoRealInternalFile();
assertHandMaintainedPriceDocsAreRetired();
assertPartnerConditionsArePrivate();
assertSalesClaimsAreSafe();

if (failures.length > 0) {
  console.error("pricing public-data-leak / sales-claim audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("pricing public-data-leak / sales-claim audit passed");
