import { runContextosBenchmark } from '../src/contextos-benchmark.mjs';
const result = await runContextosBenchmark({ output: process.argv[2], mode: process.argv.includes('--preflight') ? 'preflight' : 'live' });
if (!result.report.complete || !result.report.sourceUnchanged) process.exitCode = 2;
