// Container entry point for the frontend image: applies BASE_PATH, then starts
// Next's standalone server.
//
// The image is built with a placeholder base path (see base-path.js). Its
// files are read-only and may be on a read-only root filesystem, so the build
// output that mentions the base path — server.js and .next/ — is copied to a
// writable directory with the placeholder replaced, and everything else
// (node_modules above all) is symlinked from the image. Node resolves modules
// through the symlinks to their real location, so nothing large is copied.
//
// Podman gives a --read-only container a writable /tmp by default; with Docker
// add `--tmpfs /tmp`. OW_RUNTIME_DIR overrides the location.

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { PLACEHOLDER, normalizeBasePath, applyBasePath, fixRoutesManifest } = require("./base-path.js");

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const FRONTEND = join("packages", "frontend");
const RUNTIME_DIR = process.env.OW_RUNTIME_DIR || "/tmp/ontology-workbench";
// The launcher's own files stay behind; they are not part of the app.
const SKIP = new Set(["start.mjs", "base-path.js"]);

function fail(message) {
  console.error(`[ontology-workbench] ${message}`);
  process.exit(1);
}

let basePath;
try {
  basePath = normalizeBasePath(process.env.BASE_PATH);
} catch (error) {
  fail(error.message);
}

// Copies a directory, replacing the placeholder in every file that has it.
function copyWithBasePath(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copyWithBasePath(source, target);
      continue;
    }
    const content = readFileSync(source);
    if (content.includes(PLACEHOLDER)) {
      writeFileSync(target, applyBasePath(content.toString("utf8"), basePath));
    } else {
      copyFileSync(source, target);
    }
  }
}

// Mirrors `from` into `to` by symlinking each entry, except those `handle`
// takes care of itself.
function mirror(from, to, handle) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (handle(entry.name)) continue;
    symlinkSync(join(from, entry.name), join(to, entry.name));
  }
}

try {
  rmSync(RUNTIME_DIR, { recursive: true, force: true });

  mirror(APP_DIR, RUNTIME_DIR, (name) => SKIP.has(name) || name === "packages");
  mirror(join(APP_DIR, "packages"), join(RUNTIME_DIR, "packages"), (name) => name === "frontend");
  mirror(join(APP_DIR, FRONTEND), join(RUNTIME_DIR, FRONTEND), (name) => {
    if (name === ".next") {
      copyWithBasePath(join(APP_DIR, FRONTEND, name), join(RUNTIME_DIR, FRONTEND, name));
      return true;
    }
    if (name === "server.js") {
      const server = readFileSync(join(APP_DIR, FRONTEND, name), "utf8");
      writeFileSync(join(RUNTIME_DIR, FRONTEND, name), applyBasePath(server, basePath));
      return true;
    }
    return false;
  });

  const manifestPath = join(RUNTIME_DIR, FRONTEND, ".next", "routes-manifest.json");
  const manifest = fixRoutesManifest(JSON.parse(readFileSync(manifestPath, "utf8")), basePath);
  writeFileSync(manifestPath, JSON.stringify(manifest));
} catch (error) {
  fail(`could not prepare ${RUNTIME_DIR}: ${error.message}. It must be writable (a --read-only container needs a writable /tmp).`);
}

console.log(`[ontology-workbench] serving under ${basePath || "/"}`);

// server.js changes into its own directory and starts listening.
await import(join(RUNTIME_DIR, FRONTEND, "server.js"));
