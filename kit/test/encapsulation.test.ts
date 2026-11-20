import { createRequire } from 'node:module';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as kit from '../src/index.ts';
import type { ChannelType, Intent, SessionStatus, Store } from '../src/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
const kitRoot = resolve(here, '..');
const srcRoot = join(kitRoot, 'src');
const indexPath = join(srcRoot, 'index.ts');

// Resolution context: apps/oja-ghost consumes the kit through the pnpm workspace symlink
// (node_modules/@ghostline/kit), exactly like a real app. Package self-reference is not
// used because it depends on how the test runner sets up the kit package itself.
const appRequire = createRequire(join(kitRoot, '..', 'apps', 'oja-ghost', 'package.json'));

// Every runtime export, sorted. Adding or removing a public export must edit this list.
const EXPECTED_RUNTIME_EXPORTS = [
  'Agent',
  'BedrockProvider',
  'DEFAULT_NEXT_STEP',
  'DEFAULT_PROCESSOR_COPY',
  'DevLogger',
  'DynamoStore',
  'GSM7_CHARS',
  'IntentSchema',
  'KitError',
  'LIMITS',
  'LlmError',
  'MemoryStore',
  'MessageProcessor',
  'ProductionLogger',
  'RateLimiter',
  'SessionStateMachine',
  'SmsAdapter',
  'StoreError',
  'SystemClock',
  'TestClock',
  'ToolRegistry',
  'UNRECOGNIZED_INTENT',
  'UssdAdapter',
  'WEBHOOK_SECRET_PARAM',
  'WebAdapter',
  'checkRateLimit',
  'createLogger',
  'detectEncoding',
  'formatReply',
  'formatResponse',
  'internalErrorCode',
  'isSubscribed',
  'latestUssdInput',
  'maskPhoneNumber',
  'parseIntent',
  'pureSplit',
  'renderMenuScreen',
  'renderMenuScreens',
  'serializeIntent',
  'sessionTransition',
  'splitMessage',
  'toUserMessage',
  'verifyWebhookSecret',
];

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('public API surface (Req 13.1, 13.2)', () => {
  it('runtime exports equal the expected sorted list', () => {
    expect(Object.keys(kit).sort()).toEqual([...EXPECTED_RUNTIME_EXPORTS].sort());
  });

  it('does not expose internals', () => {
    for (const internal of ['splitByLimit', 'summarizeSegments', 'webPayloadSchema', 'buildClassificationSystemPrompt']) {
      expect(internal in kit).toBe(false);
    }
  });

  it('exported types are usable (typecheck-level)', () => {
    const channel: ChannelType = 'ussd';
    const status: SessionStatus = 'active';
    const intent: Intent = { name: 'help', parameters: {}, rawMessage: 'help' };
    const storeFn = (s: Store): Promise<unknown> => s.read('k');
    expect([channel, status, typeof intent, typeof storeFn]).toEqual(['ussd', 'active', 'object', 'function']);
  });
});

describe('package encapsulation (Req 13.1, 13.2, 13.3)', () => {
  const pkg = JSON.parse(readFileSync(join(kitRoot, 'package.json'), 'utf8')) as {
    exports: Record<string, unknown>;
  };

  it('package.json exports contains exactly "." -> ./src/index.ts', () => {
    expect(Object.keys(pkg.exports)).toEqual(['.']);
    expect(pkg.exports['.']).toBe('./src/index.ts');
  });

  it('the package name resolves to src/index.ts', async () => {
    const resolved = appRequire.resolve('@ghostline/kit');
    // The workspace symlink may resolve to a realpath or to the node_modules path.
    expect(resolved.endsWith(join('src', 'index.ts'))).toBe(true);
    const viaName = (await import(/* @vite-ignore */ resolved)) as Record<string, unknown>;
    expect(Object.keys(viaName).sort()).toEqual(Object.keys(kit).sort());
  });

  it.each([
    '@ghostline/kit/src/format/split',
    '@ghostline/kit/src/format/split.ts',
    '@ghostline/kit/format/split',
    '@ghostline/kit/package.json',
  ])('internal path %s does not resolve', (spec) => {
    expect(() => appRequire.resolve(spec)).toThrow(/not defined by "exports"|Cannot find module/);
  });
});

describe('SDK import boundaries (tech.md)', () => {
  const files = listTsFiles(srcRoot).map((f) => ({
    rel: relative(srcRoot, f).split('\\').join('/'),
    text: readFileSync(f, 'utf8'),
  }));
  const importsFrom = (text: string, prefix: string): boolean =>
    new RegExp(`(?:from\\s+|import\\s*\\(\\s*|import\\s+)['"]${prefix}`).test(text);

  it('only bedrock-provider.ts and dynamo-store.ts import @aws-sdk/', () => {
    const offenders = files
      .filter((f) => importsFrom(f.text, '@aws-sdk/'))
      .map((f) => f.rel)
      .sort();
    expect(offenders).toEqual(['agent/bedrock-provider.ts', 'store/dynamo-store.ts']);
  });

  it('no channels/ or agent/ file except bedrock-provider.ts imports a model SDK', () => {
    const modelSdks = ['@aws-sdk/client-bedrock', '@anthropic-ai/', 'openai', '@google/', '@google-cloud/'];
    const offenders = files
      .filter((f) => (f.rel.startsWith('channels/') || f.rel.startsWith('agent/')) && f.rel !== 'agent/bedrock-provider.ts')
      .filter((f) => modelSdks.some((p) => importsFrom(f.text, p)))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });

  it('index.ts exists and uses no `export *`', () => {
    const text = readFileSync(indexPath, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(/export\s*\*/.test(text)).toBe(false);
  });
});
