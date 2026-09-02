import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

if (process.env.AISTUDIO_ALLOW_LEGACY_WEB_PACKAGE !== "1") {
  throw new Error(
    "Studio Web packaging is historical compatibility only; production release is native Android. " +
      "Set AISTUDIO_ALLOW_LEGACY_WEB_PACKAGE=1 only for explicit legacy reproduction.",
  );
}

const repoRoot = process.cwd();
const distRoot = path.join(repoRoot, "apps", "studio-web", "dist");
const releaseRoot = path.join(repoRoot, "release");

async function walkFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) files.push(...(await walkFiles(root, absolute)));
    else if (entry.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function sourceDate() {
  const epoch = Number.parseInt(process.env.SOURCE_DATE_EPOCH ?? "", 10);
  if (!Number.isFinite(epoch) || epoch < 0) return null;
  return new Date(epoch * 1000).toISOString();
}

await stat(distRoot).catch(() => {
  throw new Error("Legacy Studio Web dist was not found. Run `npm run legacy:web:build` first.");
});

const relativeFiles = await walkFiles(distRoot);
if (relativeFiles.length === 0) throw new Error("Legacy Studio Web dist is empty.");
for (const required of ["index.html", "sw.js"]) {
  if (!relativeFiles.includes(required)) throw new Error(`Legacy compatibility package is missing: ${required}`);
}

const files = [];
let totalBytes = 0;
for (const relativePath of relativeFiles) {
  const bytes = await readFile(path.join(distRoot, relativePath));
  totalBytes += bytes.byteLength;
  files.push({ path: relativePath, bytes: bytes.byteLength, sha256: sha256(bytes) });
}

const manifest = {
  schemaVersion: 2,
  product: "AI Animation Studio",
  artifactType: "legacy-studio-web-compatibility-package",
  productionRelease: false,
  canonicalProductionRuntime: "NATIVE_ANDROID_COMPOSE",
  source: {
    repository: process.env.GITHUB_REPOSITORY ?? null,
    commit: process.env.AISTUDIO_SOURCE_SHA ?? process.env.GITHUB_SHA ?? null,
    sourceDate: sourceDate(),
  },
  build: { node: process.version, fileCount: files.length, totalBytes },
  requiredRuntimeFiles: ["index.html", "sw.js"],
  files,
};

await mkdir(releaseRoot, { recursive: true });
await writeFile(path.join(releaseRoot, "legacy-studio-web-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
await writeFile(
  path.join(releaseRoot, "legacy-studio-web-files.sha256"),
  `${files.map((file) => `${file.sha256}  studio-web/${file.path}`).join("\n")}\n`,
  "utf8",
);
console.log(`Legacy Studio Web compatibility manifest created for ${files.length} files (${totalBytes} bytes).`);
