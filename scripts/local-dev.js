const { spawn } = require('child_process');
const path = require('path');

// Helper to run a command
function run(command, args, options = {}) {
  const cmdStr = `${command} ${args.join(' ')}`;
  console.log(`> ${cmdStr}`);
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { stdio: 'inherit', shell: true, ...options });
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`Command failed with code ${code}: ${cmdStr}`));
      else resolve();
    });
  });
}

// Helper to run a long-running process
function spawnProcess(name, command, args, options = {}) {
  const cmdStr = `${command} ${args.join(' ')}`;
  console.log(`[${name}] Starting: ${cmdStr}`);
  const proc = spawn(command, args, { stdio: 'pipe', shell: true, ...options });

  proc.stdout.on('data', (data) => {
    process.stdout.write(`[${name}] ${data}`);
  });
  proc.stderr.on('data', (data) => {
    process.stderr.write(`[${name}] ${data}`);
  });

  proc.on('close', (code) => {
    console.log(`[${name}] Exited with code ${code}`);
  });
  return proc;
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const backendDir = path.join(rootDir, 'packages/backend');
  const frontendDir = path.join(rootDir, 'packages/frontend');
  const sharedDir = path.join(rootDir, 'packages/shared');

  // Parse args
  const args = process.argv.slice(2);
  let preloadFiles = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--load' && args[i + 1]) {
      const file = path.resolve(process.cwd(), args[i + 1]);
      preloadFiles.push(file);
      i++;
    }
  }

  try {
    console.log('--- Building Shared Package ---');
    await run('pnpm', ['run', 'build'], { cwd: sharedDir });

    console.log('--- Building Backend Package (Initial) ---');
    await run('pnpm', ['run', 'build'], { cwd: backendDir });

    console.log('--- Starting Services ---');

    // 1. Backend Watcher (TSC)
    // We use 'exec tsc' to use the typescript installed in the package
    spawnProcess('backend-build', 'pnpm', ['exec', 'tsc', '-w', '-p', 'tsconfig.json'], { cwd: backendDir });

    // 2. Backend Server
    // We set BACKEND_SPARQL_DRIVER=oxigraph to use in-memory DB.
    const backendEnv = {
      ...process.env,
      BACKEND_SPARQL_DRIVER: 'oxigraph',
      PORT: '4000'
    };

    if (preloadFiles.length > 0) {
      backendEnv.PRELOAD_TURTLE_FILES = preloadFiles.join(',');
      console.log(`[Config] Preloading files: ${backendEnv.PRELOAD_TURTLE_FILES}`);
    }

    // We use a slight delay or just start it. node --watch will restart if file changes.
    spawnProcess('backend', 'node', ['--watch', 'dist/main.js'], { cwd: backendDir, env: backendEnv });


    // 3. Frontend Server
    const frontendEnv = {
      ...process.env,
      NEXT_PUBLIC_API_BASE: 'http://localhost:3000/api' // Next.js proxies or direct? 
      // Wait, docker-compose says NEXT_PUBLIC_API_BASE: http://localhost:4000
      // But if we run locally, frontend is on 3000, backend on 4000.
      // Browser will hit 4000 directly if we use that URL.
    };
    // Let's stick to what docker-compose had, but localhost.
    frontendEnv.NEXT_PUBLIC_API_BASE = 'http://localhost:4000';

    spawnProcess('frontend', 'pnpm', ['run', 'dev'], { cwd: frontendDir, env: frontendEnv });

  } catch (err) {
    console.error('Error:', err);
    process.exit(1);
  }
}

main();
