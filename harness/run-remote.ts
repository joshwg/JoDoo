// Runs the same scenario suite as run.ts, but against a real, already
// running server (e.g. your production deployment behind its TLS proxy).
//
//   JODOO_SERVER_URL=https://jodoo.example.com JODOO_SERVER_KEY=... npm run test:remote
//
// Anything not provided via the environment is prompted for interactively.
// The suite only ever touches the share it creates itself, so it is safe to
// run against a server holding real shares; the test share is abandoned
// afterwards and ages out with the server's 30-day retention sweep.
import * as readline from 'node:readline/promises';
import { runScenarios } from './scenarios';

async function main(): Promise<void> {
  let url = (process.env.JODOO_SERVER_URL ?? '').trim();
  let key = (process.env.JODOO_SERVER_KEY ?? '').trim();

  if (!url || !key) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    if (!url) url = (await rl.question('Server URL (e.g. https://jodoo.example.com): ')).trim();
    if (!key) key = (await rl.question('Server key: ')).trim();
    rl.close();
  }
  if (!url || !key) throw new Error('both a server URL and a server key are required');
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  url = url.replace(/\/+$/, '');

  let health: Response;
  try {
    health = await fetch(`${url}/healthz`);
  } catch (err) {
    throw new Error(`cannot reach ${url}: ${err instanceof Error ? err.message : err}`);
  }
  if (!health.ok) throw new Error(`server at ${url} is not healthy (HTTP ${health.status})`);
  console.log(`server at ${url} is healthy (${(await health.text()).trim()})`);

  const passed = await runScenarios(url, key);
  console.log(`\nPASS - ${passed} checks against ${url}`);
}

main().catch((err) => {
  console.error(`\nFAIL - ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
