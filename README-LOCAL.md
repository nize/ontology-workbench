# Local Development Setup (No Docker)

This guide explains how to run the Ontology Workbench locally on Windows, macOS, or Linux without using Docker Desktop.

## Prerequisites

1.  **Node.js**: Install Node.js (v18 or later) from [nodejs.org](https://nodejs.org/).
2.  **pnpm**: Install pnpm using `npm install -g pnpm`.

## How it works

The project includes a local development script that:
1.  Builds the shared packages.
2.  Runs the Backend using an **in-memory embedded Graph Database** (simulated Oxigraph). This removes the need for running GraphDB or Fuseki externally.
3.  Runs the Frontend (Next.js).
4.  Does **not** require Redis or Typesense (the current backend implementation does not strictly require them for basic operation).

**Note**: Since the database is in-memory, all data changes will be lost when you stop the server. However, the system loads sample data from `packages/backend/fixtures` on startup.

## Running the Project

1.  Open a terminal in the project root.
2.  Install dependencies:
    ```bash
    pnpm install
    ```
3.  Run the local development script:
    ```bash
    node scripts/local-dev.js
    ```
    Or if you added the script to package.json:
    ```bash
    pnpm local-dev
    ```

## Loading Custom Data (e.g., FIBO)

You can load additional `.ttl` files (like FIBO) into the in-memory database at startup using the `--load` argument.

```bash
# Load a single file
node scripts/local-dev.js --load ./path/to/fibo.ttl

# Load multiple files
node scripts/local-dev.js --load ./fibo-fnd.ttl --load ./fibo-be.ttl
```

If you are using `pnpm local-dev`, you need to pass the arguments after `--`:

```bash
pnpm local-dev -- --load ./path/to/fibo.ttl
```

## Accessing the Application

-   **Frontend**: [http://localhost:3000](http://localhost:3000)
-   **Backend API**: [http://localhost:4000](http://localhost:4000)

## Troubleshooting

-   **Port Conflicts**: Ensure ports 3000 and 4000 are free.
-   **Windows**: If you encounter path issues, ensure you are running in a standard command prompt or PowerShell. The script uses Node.js `spawn` which should handle cross-platform commands.
