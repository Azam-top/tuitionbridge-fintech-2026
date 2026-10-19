// Builds the submission package from an explicit ALLOWLIST (never "everything minus a few things").
// Excludes secrets, node_modules, databases, build output, test output and any personal documents.
//   npm run package        -> dist-submission/tuitionbridge-submission-<date>.{tar.gz,zip}
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { checkEvidenceConsistency, gitInfo } from "./lib/provenance";

const STAGE_ROOT = "dist-submission/stage";
const NAME = "tuitionbridge";
const stage = join(STAGE_ROOT, NAME);
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");

const FILES = [
  "README.md", "AI_USAGE.md", "SUBMISSION_CHECKLIST.md", "CLAUDE.md", "package.json", "package-lock.json", "tsconfig.json",
  "vite.config.ts", "vitest.config.ts", "playwright.config.ts", "index.html", ".env.example", ".nvmrc", ".gitignore",
];
const DIRS = ["src", "tests", "e2e", "scripts", "eval", "docs", "artifacts/evidence"];
const EXTRA_FILES = ["artifacts/demo/tuitionbridge-demo-mock.mp4"]; // the 14 MB .webm master is left out on purpose
const EXCLUDE = [/node_modules/, /(^|\/)\.env$/, /\.sqlite/, /(^|\/)dist(\/|$)/, /test-results/, /playwright-report/, /(^|\/)\.git(\/|$)/, /artifacts\/tmp/, /\.vitest/, /passport/i];
const missing: string[] = [];

// ---- provenance: every artifact must trace to ONE clean source commit, and the sources must not have changed since ----
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf8")) as never;
const problems = checkEvidenceConsistency({
  manifest: readJson("artifacts/evidence/manifest.json"), testSummary: readJson("artifacts/evidence/test-summary.json"), evalMock: readJson("artifacts/evidence/eval-mock.json"),
});
if (problems.length && !process.argv.includes("--allow-inconsistent")) {
  console.error("Refusing to package; artifacts are not traceable to one clean source commit:\n- " + problems.join("\n- ") + "\nRe-run the evidence pipeline on a clean tree (see docs/HANDOFF.md).");
  process.exit(1);
}
const git = gitInfo();

rmSync("dist-submission", { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
const copy = (src: string) => {
  if (!existsSync(src)) { missing.push(src); return; }
  cpSync(src, join(stage, src), { recursive: true, filter: (s) => !EXCLUDE.some((r) => r.test(s.replace(/\\/g, "/"))) });
};
[...FILES, ...DIRS, ...EXTRA_FILES].forEach(copy);

writeFileSync(join(stage, "PACKAGE_INFO.json"), JSON.stringify({
  note: "sourceCommit is the commit the tests, evaluation and evidence were produced from. packagedAtCommit may be a later commit that only adds those artifacts and docs.",
  sourceCommit: readJson("artifacts/evidence/manifest.json").sourceCommit, packagedAtCommit: git.head, sourceTreeDirtyAtPackaging: git.dirty,
  generatedAt: new Date().toISOString(), consistencyProblems: problems,
  liveEvaluation: readJson("artifacts/evidence/manifest.json").liveEvaluation, payments: "SIMULATED",
}, null, 2) + "\n");

// ---- secret / personal-data scan over everything staged ----
const PATTERNS: [string, RegExp][] = [
  ["Anthropic-style key", /sk-ant-[A-Za-z0-9_-]{10,}/],
  ["Groq-style key", /gsk_[A-Za-z0-9]{16,}/],
  ["generic sk- key", /\bsk-[A-Za-z0-9]{20,}\b/],
  ["non-empty APP_LLM_API_KEY", /APP_LLM_API_KEY=["']?[A-Za-z0-9_\-]{12,}/],
  ["private key block", /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
];
const hits: string[] = [];
const files: string[] = [];
(function walk(dir: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p); else files.push(p);
  }
})(stage);
for (const f of files) {
  if (/\.(png|mp4|webm|pdf|ico)$/i.test(f)) continue;
  const text = readFileSync(f, "utf8");
  for (const [label, re] of PATTERNS) if (re.test(text)) hits.push(`${label}: ${relative(stage, f)}`);
}
if (hits.length) { console.error("SECRET SCAN FAILED:\n" + hits.join("\n")); process.exit(1); }
if (existsSync(join(stage, ".env"))) { console.error(".env must never be packaged"); process.exit(1); }

// ---- archives ----
const tgz = `dist-submission/tuitionbridge-submission-${today}.tar.gz`;
const zip = `dist-submission/tuitionbridge-submission-${today}.zip`;
execFileSync("tar", ["-czf", tgz, "-C", STAGE_ROOT, NAME]);
execFileSync("python3", ["-c", "import shutil,sys;shutil.make_archive(sys.argv[1],'zip',sys.argv[2],sys.argv[3])", zip.replace(/\.zip$/, ""), STAGE_ROOT, NAME]);
const manifest = files.map((f) => relative(STAGE_ROOT, f)).sort();
writeFileSync("dist-submission/CONTENTS.txt", manifest.join("\n") + "\n");
rmSync(STAGE_ROOT, { recursive: true, force: true });

const mb = (p: string) => (statSync(p).size / 1e6).toFixed(2);
console.log(`Packaged ${files.length} files. Secret scan: clean.`);
console.log(`  ${tgz} (${mb(tgz)} MB)\n  ${zip} (${mb(zip)} MB)\n  dist-submission/CONTENTS.txt`);
if (missing.length) console.log(`NOT FOUND (skipped): ${missing.join(", ")}`);
