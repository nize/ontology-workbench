// Base path handling shared by next.config.js (build) and docker/start.mjs
// (container start).
//
// Next.js fixes basePath at build time. The container image is built with
// PLACEHOLDER as its base path, and the start script swaps it for the BASE_PATH
// the container is started with, so one published image can serve from / or
// from any prefix.

const PLACEHOLDER = "/__OW_BASE_PATH__";

const VALID = /^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/;

// Returns "" (serve from the root) or a prefix such as "/ow". Throws on values
// Next.js would not accept or that would produce broken URLs.
function normalizeBasePath(value) {
  if (value === undefined || value === "" || value === "/") return "";
  if (!VALID.test(value)) {
    throw new Error(
      `BASE_PATH must start with "/" and must not end with "/", e.g. "/ow" (got "${value}")`
    );
  }
  return value;
}

// Every occurrence of the base path in Next's build output is the placeholder
// string itself, so a plain replacement is enough for file contents.
function applyBasePath(text, basePath) {
  return text.split(PLACEHOLDER).join(basePath);
}

// With a base path, Next adds an internal redirect from "<base>/" to "<base>".
// Served from the root, that would become "/" -> "" and break the home page,
// so it is dropped. Takes and returns the parsed routes-manifest.json, after
// applyBasePath has run on it.
function fixRoutesManifest(manifest, basePath) {
  if (basePath !== "") return manifest;
  return {
    ...manifest,
    redirects: (manifest.redirects || []).filter(
      (r) => !(r.internal && r.basePath === false && r.source === "/" && r.destination === "")
    ),
  };
}

module.exports = { PLACEHOLDER, normalizeBasePath, applyBasePath, fixRoutesManifest };
