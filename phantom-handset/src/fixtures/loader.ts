import { parseFixture, type Fixture } from './schema';

/** Bundled fixtures work offline. Each file is validated; failures are reported by file name. */
export function loadFixtures(): { fixtures: Fixture[]; errors: string[] } {
  const modules = import.meta.glob('./*.json', { eager: true, import: 'default' }) as Record<string, unknown>;
  const fixtures: Fixture[] = [];
  const errors: string[] = [];
  for (const path of Object.keys(modules).sort()) {
    const name = path.replace(/^\.\//, '');
    const result = parseFixture(modules[path], name);
    if (result.ok) fixtures.push(result.fixture);
    else errors.push(result.error);
  }
  return { fixtures, errors };
}
