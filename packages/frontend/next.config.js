const path = require("path");

// Optional path prefix, e.g. "/ow", for serving the app below the root of a
// shared hostname. Next.js fixes basePath at build time, so a different prefix
// needs a different build (see the BASE_PATH build argument in the Dockerfile).
const basePath = process.env.BASE_PATH || "";
if (basePath && !/^\/[A-Za-z0-9._~-]+(\/[A-Za-z0-9._~-]+)*$/.test(basePath)) {
  throw new Error(
    `BASE_PATH must start with "/" and must not end with "/", e.g. "/ow" (got "${basePath}")`
  );
}

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
