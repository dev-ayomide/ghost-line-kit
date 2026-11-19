import { resolve } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';

const repoRoot = resolve(__dirname, '..');

/** Dev only: serves /api through the same node listener as `pnpm serve`. */
function handsetApi(mode: string): Plugin {
  return {
    name: 'handset-api',
    apply: 'serve',
    configureServer(server) {
      let listener: ((req: IncomingMessage, res: ServerResponse) => void) | undefined;
      server.middlewares.use('/api', (req, res, next) => {
        void (async () => {
          try {
            if (!listener) {
              const env = { ...loadEnv(mode, repoRoot, ''), ...process.env };
              const wire = await server.ssrLoadModule('/server/wire.ts');
              const handler = await server.ssrLoadModule('/server/handler.ts');
              const nodeListener = await server.ssrLoadModule('/server/node-listener.ts');
              const deps = (wire['createDeps'] as (e: Record<string, string | undefined>) => unknown)(env);
              const handle = (handler['createHandler'] as (d: unknown) => unknown)(deps);
              listener = (nodeListener['createNodeListener'] as (h: unknown) => typeof listener)(handle);
            }
            // Connect strips the mount path; the handler expects the full /api path.
            req.url = `/api${req.url ?? ''}`;
            listener!(req, res);
          } catch {
            if (!res.headersSent) {
              res.statusCode = 500;
              res.setHeader('content-type', 'application/json; charset=utf-8');
              res.end(JSON.stringify({ error: { code: 'INTERNAL', message: 'Something went wrong. Try again.' } }));
            } else next();
          }
        })();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [react(), handsetApi(mode)],
  // Default envPrefix (VITE_) is kept on purpose: HANDSET_* must never reach the client.
  // Bundle the linked kit's TypeScript. The kit's static @aws-sdk imports are bundled too:
  // marking them external fails at runtime, because pnpm links them only under kit/node_modules
  // and phantom-handset must not take a new dependency on them.
  ssr: { noExternal: ['@ghostline/kit'] },
}));
