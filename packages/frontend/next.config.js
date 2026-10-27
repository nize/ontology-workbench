const path = require("path");

module.exports = {
  reactStrictMode: true,
  // Self-contained server.js + traced node_modules, so the container image
  // needs neither pnpm nor the workspace to run.
  output: "standalone",
  // Trace from the workspace root so @acme/shared and hoisted dependencies
  // are included in the standalone output.
  outputFileTracingRoot: path.join(__dirname, "../.."),
};
