const path = require("path");
const { normalizeBasePath } = require("./base-path");

// Optional path prefix, e.g. "/ow", for serving the app below the root of a
// shared hostname. Next.js fixes basePath at build time; the container image
// builds with a placeholder that docker/start.mjs replaces when the container
// starts (see base-path.js).
const basePath = normalizeBasePath(process.env.BASE_PATH);

module.exports = {
  reactStrictMode: true,
  basePath,
  // Exposed to client code, which builds the /api URL from it.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Self-contained server.js + traced node_modules, so the container image
  // needs neither pnpm nor the workspace to run.
  output: "standalone",
  // Trace from the workspace root so @acme/shared and hoisted dependencies
  // are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};
