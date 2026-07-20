// Local end-to-end test: builds the Go server, starts it on a private port
// with a throwaway data dir, and runs the full scenario suite against it.
// See run-remote.ts to run the same suite against a real deployment.
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runScenarios, sleep } from './scenarios';

const PORT = 8199;
const HTTP_BASE = `http://127.0.0.1:${PORT}`;
const SERVER_KEY = 'harness-only-key-0123456789abcdef';
const serverDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server');

async function startServer(dataDir: string): Promise<ChildProcess> {
  console.log('building server...');
  execSync('go build -o jodoo-server .', { cwd: serverDir, stdio: 'inherit' });
  const proc = spawn(path.join(serverDir, 'jodoo-server'), {
    cwd: serverDir,
    env: { ...process.env, JODOO_SERVER_KEY: SERVER_KEY, PORT: String(PORT), DATA_DIR: dataDir },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const deadline = Date.now() + 10000;
  for (;;) {
    try {
      const res = await fetch(`${HTTP_BASE}/healthz`);
      if (res.ok) return proc;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline || proc.exitCode != null) {
      proc.kill();
      throw new Error('server did not become healthy');
    }
    await sleep(50);
  }
}

async function main(): Promise<void> {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'jodoo-harness-'));
  const server = await startServer(dataDir);
  try {
    const passed = await runScenarios(HTTP_BASE, SERVER_KEY);
    console.log(`\nPASS - ${passed} checks`);
  } finally {
    server.kill();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(`\nFAIL - ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
