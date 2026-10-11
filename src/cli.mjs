#!/usr/bin/env node
import path from 'node:path';
import { runTask } from './agent.mjs';
import { loadConfig, ConfigError } from './config.mjs';
import { compareRuns, loadRun, renderComparisonReport, renderRunReport, runReplayBenchmark, RESULT_ROOT } from './benchmark.mjs';
import { renderExecutableReport, runExecutableBenchmark } from './runtime-benchmark.mjs';
import { runInteractive } from './terminal.mjs';

const HELP = `tea — independent terminal coding agent\n\nUsage:\n  tea <task> [--workspace PATH] [--context-strategy baseline|v1-dedup|v1-inventory|v1|v1-inventory-expanded|v1-expanded|v1-inventory-auto|v1-auto] [--initial-file-limit N] [--max-cost-usd USD] [--max-input-tokens N] [--effort low|high|max]\n  tea benchmark run --suite core --mode replay [--strategy baseline|v1-dedup|v1-inventory|v1|v1-inventory-expanded|v1-expanded|v1-inventory-auto|v1-auto] [--initial-file-limit N] [--run-id ID]\n  tea benchmark compare --base-run ID --candidate-run ID\n  tea benchmark report --run ID\n\nExamples (PowerShell):\n  $env:ANTHROPIC_API_KEY = '…'\n  $env:ANTHROPIC_BASE_URL = 'https://cf.api.fan'\n  $env:ANTHROPIC_MODEL = 'glm-5.3-flash'\n  $env:TEA_INPUT_PRICE_USD_PER_MTOK = '...' # current price from your token group\n  $env:TEA_OUTPUT_PRICE_USD_PER_MTOK = '...'\n  tea "Fix the session expiration bug" --max-cost-usd 0.10\n  tea benchmark run --suite core --mode replay --strategy v1 --initial-file-limit 24\n\nLive calls require an API key, a positive hard budget, and provider-specific input/output prices.\nSet TEA_REASONING_EFFORT to low, high, or max for GLM-5.3-Flash.`;

function parseOptions(args) {
  const options = {};
  const positional = [];
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i];
    if (value === '--help' || value === '-h') options.help = true;
    else if (value === '--interactive' || value === '-i') options.interactive = true;
    else if (value === '--demo') { options.demo = true; options.interactive = true; }
    else if (['--max-cost-usd', '--max-input-tokens', '--workspace', '--effort', '--run-id', '--suite', '--mode', '--strategy', '--context-strategy', '--initial-file-limit', '--history-strategy', '--history-keep-recent', '--fixture-variant', '--base-run', '--candidate-run', '--run'].includes(value)) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`Missing value after ${value}`);
      i += 1;
      const key = ({ '--max-cost-usd': 'maxCostUsd', '--max-input-tokens': 'maxInputTokens', '--workspace': 'workspace', '--effort': 'effort', '--run-id': 'runId', '--suite': 'suite', '--mode': 'mode', '--strategy': 'strategy', '--context-strategy': 'contextStrategy', '--initial-file-limit': 'initialFileLimit', '--history-strategy': 'historyStrategy', '--history-keep-recent': 'historyKeepRecent', '--fixture-variant': 'fixtureVariant', '--base-run': 'baseRun', '--candidate-run': 'candidateRun', '--run': 'run' })[value];
      options[key] = next;
    } else if (value.startsWith('-')) throw new Error(`Unknown option: ${value}`);
    else positional.push(value);
  }
  options.positional = positional;
  return options;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h') || (!args.length && !process.stdin.isTTY)) { process.stdout.write(HELP + '\n\nInteractive terminal:\n  tea                         # start a conversation in a terminal\n  tea --interactive [task]     # keep talking after the initial task\n  tea --demo                  # offline interface preview, no API calls\n  /help /status /tools /diff /new /clear /cancel /exit\n  Esc or Ctrl+C stops the current turn; spending is shared across turns.\n\nHistory experiments:\n  tea <task> --history-strategy full|compact-tools [--history-keep-recent 2]\n  tea benchmark memory [--history-keep-recent 2] [--run-id ID]\n\nExecutable fixtures:\n  tea benchmark run --suite runtime-smoke --mode runtime [--strategy baseline|v1] [--history-strategy full|compact-tools] [--fixture-variant solution|extended] [--run-id ID]\n  tea benchmark run --suite runtime-smoke --mode live --max-cost-usd USD\n\nRuntime mode uses scripted tool choices and real code/tests, without network access.\nThe extended variant is an artificial verbose-log stress profile, available only in runtime mode.\nHistory experiments measure serialized input size, not provider tokens or model success.\nLive mode applies --max-cost-usd to the whole suite and requires current provider rates.\n'); return; }
  const group = args[0];
  if (group === 'benchmark') { await benchmarkCommand(args.slice(1)); return; }

  const parsed = parseOptions(args);
  const task = parsed.positional.join(' ').trim();
  const config = loadConfig(parsed);
  if (parsed.interactive || (!task && process.stdin.isTTY)) {
    await runInteractive(config, { demo: parsed.demo, initialTask: task || undefined });
    return;
  }
  if (!task) throw new Error('Provide a task in quotes, or use --interactive in a terminal.');
  const result = await runTask(task, config, { onText: (text) => process.stdout.write(`${text}\n`) });
  process.stdout.write(`\nRun status: ${result.status}\nToken ledger: ${path.relative(process.cwd(), result.runDirectory)}\n`);
  process.stdout.write(`Provider tokens: input=${result.summary.inputTokens}, output=${result.summary.outputTokens}, cached=${result.summary.cachedInputTokens}\n`);
  process.stdout.write(`Heuristic input estimate: ${result.summary.estimatedInputTokens} (diagnostic only)\n`);
  if (result.status !== 'completed') process.exitCode = 2;
}

async function benchmarkCommand(args) {
  const subcommand = args[0];
  const parsed = parseOptions(args.slice(1));
  if (subcommand === 'run') {
    const mode = parsed.mode || 'replay';
    if (['runtime', 'live'].includes(mode)) {
      const config = mode === 'live' ? loadConfig(parsed) : undefined;
      const result = await runExecutableBenchmark({ mode, suite: parsed.suite || 'runtime-smoke', strategy: parsed.strategy || 'v1',
        initialFileLimit: parsed.initialFileLimit === undefined ? undefined : Number(parsed.initialFileLimit), runId: parsed.runId,
        historyStrategy: parsed.historyStrategy, historyKeepRecent: parsed.historyKeepRecent, fixtureVariant: parsed.fixtureVariant,
        config, onProgress: (text) => process.stdout.write(`${text}\n`) });
      process.stdout.write(`Executable run saved: ${result.outputDir}\n${renderExecutableReport(result.run)}`);
      if (result.run.totals.acceptedTasks !== result.run.totals.taskCount) process.exitCode = 2;
      return;
    }
    if (mode !== 'replay') throw new Error('Benchmark mode must be replay, runtime, or live.');
    const result = await runReplayBenchmark({ suite: parsed.suite || 'core', strategy: parsed.strategy || 'baseline', initialFileLimit: parsed.initialFileLimit === undefined ? undefined : Number(parsed.initialFileLimit), runId: parsed.runId });
    process.stdout.write(`Replay run saved: ${result.outputDir}\n`);
    process.stdout.write(renderRunReport(result.run));
    return;
  }
  if (subcommand === 'compare') {
    if (!parsed.baseRun || !parsed.candidateRun) throw new Error('Use --base-run ID --candidate-run ID (or paths to run.json files).');
    const result = await compareRuns(parsed.baseRun, parsed.candidateRun);
    const outputDir = path.join(RESULT_ROOT, `compare-${Date.now()}`);
    await import('node:fs/promises').then(({ mkdir, writeFile }) => mkdir(outputDir, { recursive: true }).then(() => writeFile(path.join(outputDir, 'comparison.json'), `${JSON.stringify(result, null, 2)}\n`, 'utf8')).then(() => writeFile(path.join(outputDir, 'report.md'), renderComparisonReport(result), 'utf8')));
    process.stdout.write(`Comparison saved: ${outputDir}\n${renderComparisonReport(result)}`);
    return;
  }
  if (subcommand === 'memory') {
    const { renderMemoryReport, runMemoryBenchmark } = await import('./memory-benchmark.mjs');
    const result = await runMemoryBenchmark({ runId: parsed.runId, keepRecentRounds: parsed.historyKeepRecent === undefined ? undefined : Number(parsed.historyKeepRecent) });
    process.stdout.write(`Memory experiment saved: ${result.outputDir}\n${renderMemoryReport(result.run)}`);
    return;
  }
  if (subcommand === 'report') {
    if (!parsed.run) throw new Error('Use --run ID.');
    const run = await loadRun(parsed.run);
    if (run.mode === 'offline-memory-replay') {
      const { renderMemoryReport } = await import('./memory-benchmark.mjs');
      process.stdout.write(renderMemoryReport(run));
      return;
    }
    process.stdout.write(['offline-runtime', 'live-fixture'].includes(run.mode) ? renderExecutableReport(run) : renderRunReport(run));
    return;
  }
  throw new Error('Unknown benchmark command. Use run, memory, compare, or report.');
}

main().catch((error) => {
  const message = error instanceof ConfigError ? error.message : error.message;
  process.stderr.write(`tea: ${message}\n`);
  if (process.argv.includes('--help') || process.argv.includes('-h')) process.stdout.write(HELP);
  process.exitCode = 1;
});
