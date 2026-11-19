/** Standalone entry: `node dist-server/main.js` (built by `pnpm serve`). */
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createHandler } from './handler.js';
import { createNodeListener } from './node-listener.js';
import { createDeps, isLoopbackHost } from './wire.js';

/** Loads the repo-root .env into process.env without overriding real variables. */
function loadDotEnv(): void {
  const candidates = [resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return;
  try {
    const load = (process as unknown as { loadEnvFile?: (p: string) => void }).loadEnvFile;
    if (typeof load === 'function') {
      // loadEnvFile never overrides variables that are already set.
      load.call(process, file);
    }
  } catch {
    // A bad .env must not stop startup; the defaults apply.
  }
}

loadDotEnv();
const env = process.env;
const host = env['HOST'] || '127.0.0.1';
const port = Number(env['PORT'] || 8787);

if (!isLoopbackHost(host) && !env['HANDSET_ACCESS_TOKEN']) {
  console.error('Refusing to start: HOST is not loopback. Set HANDSET_ACCESS_TOKEN or use 127.0.0.1.');
  process.exit(1);
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('Refusing to start: PORT is not a valid port number.');
  process.exit(1);
}

const server = createServer(createNodeListener(createHandler(createDeps(env))));
server.listen(port, host, () => {
  console.log(`phantom-handset listening on http://${host}:${port}`);
});
