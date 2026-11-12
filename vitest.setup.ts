import fc from 'fast-check';

// `pnpm test` uses fast-check's default run count; `pnpm test:pbt` raises it via FC_NUM_RUNS.
const numRuns = Number(process.env.FC_NUM_RUNS ?? 100);
fc.configureGlobal({ numRuns });
