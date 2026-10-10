import { createHash } from 'node:crypto';
import { TokenLedger } from './ledger.mjs';
import { AnthropicMessagesAdapter, ModelError } from './model.mjs';
import { TOOL_DEFINITIONS, WorkspaceTools, dispatchTool } from './tools.mjs';
import { assertLiveConfig } from './config.mjs';

const SYSTEM_PROMPT = `You are tea, an independent coding agent operating only inside the supplied workspace. Inspect before editing. Use exact, narrow patches. Never read secrets or environment files. Never claim success without verification. After any file edit, run the relevant tests and fix failures; preserve all user changes. Use run_shell only for commands that are not on the safe validation allowlist; the terminal may ask the user to approve them. Do not repeat whole files or prior tool output when a short evidence-backed summary is enough. When finished, state the changes and tests actually run.`;

function estimateTextTokens(text) {
  const value = String(text);
  const wideChars = (value.match(/[\u2E80-\u9FFF\uF900-\uFAFF]/g) || []).length;
  return Math.ceil(wideChars * 1.4 + (value.length - wideChars) / 4);
}

export async function runTask(task, config, { onText = () => {} } = {}) {
  assertLiveConfig(config);
  const ledger = new TokenLedger({ workspace: config.workspace, runId: config.runId, model: config.model, storeRaw: config.storeRaw });
  await ledger.init({ workspace: config.workspace, taskSha256: createTaskHash(task), effort: config.effort, runType: 'live' });
  const tools = new WorkspaceTools({ workspace: config.workspace, ledger });
  await tools.init();
  const adapter = new AnthropicMessagesAdapter(config);
  adapter.onRequest = (event) => ledger.request(event).catch((error) => onText(`Warning: ledger write failed: ${error.message}`));
  const files = await tools.listFiles({ maxFiles: 160 });
  const userMessage = `${task}\n\nWorkspace: ${config.workspace}\nInitial text-file listing:\n${files}`;
  const messages = [{ role: 'user', content: userMessage }];
  let pendingValidation = false;
  let validationPassed = false;
  let validationAttempts = 0;
  let changedFiles = [];
  let status = 'running';
  let finalText = '';
  let toolCalls = 0;
  let forcedValidationNudges = 0;

  try {
    while (toolCalls <= config.maxToolCalls) {
      let result;
      try {
        result = await adapter.complete({ system: SYSTEM_PROMPT, messages, tools: TOOL_DEFINITIONS });
      } catch (error) {
        status = 'failed';
        if (error instanceof ModelError) onText(`Agent stopped: ${error.message}`);
        else throw error;
        break;
      }
      const content = Array.isArray(result.content) ? result.content : [];
      const assistantMessage = { role: 'assistant', content };
      messages.push(assistantMessage);
      const textBlocks = content.filter((block) => block.type === 'text').map((block) => block.text || '');
      if (textBlocks.length) { finalText = textBlocks.join('\n'); onText(finalText); }
      const toolUses = content.filter((block) => block.type === 'tool_use');
      if (!toolUses.length) {
        if (result.stop_reason === 'max_tokens') {
          status = 'incomplete';
          onText('\nAgent stopped because the response reached its output-token limit.');
          break;
        }
        if (pendingValidation && forcedValidationNudges < 2 && toolCalls < config.maxToolCalls) {
          forcedValidationNudges += 1;
          messages.push({ role: 'user', content: `You changed files (${changedFiles.join(', ')}) but no relevant test command has passed after the latest edit. Run the appropriate test now. If validation cannot be completed, explain that clearly and do not claim the task is complete.` });
          continue;
        }
        status = pendingValidation ? 'needs_validation' : 'completed';
        break;
      }

      const toolResults = [];
      for (const call of toolUses) {
        toolCalls += 1;
        if (toolCalls > config.maxToolCalls) {
          status = 'tool_limit_reached';
          break;
        }
        const started = Date.now();
        let output;
        let isError = false;
        try {
          output = await dispatchTool(tools, call.name, call.input || {});
          if (call.name === 'apply_patch') {
            pendingValidation = true;
            validationPassed = false;
            const filename = call.input?.path || '(unknown file)';
            if (!changedFiles.includes(filename)) changedFiles.push(filename);
          } else if (call.name === 'run_tests') {
            validationAttempts += 1;
            validationPassed = /^exit=0\b/.test(String(output));
            if (validationPassed) pendingValidation = false;
          }
        } catch (error) {
          isError = true;
          output = error.message;
          if (call.name === 'run_tests') validationAttempts += 1;
        }
        await ledger.tool({ name: call.name, input: call.input, output, elapsedMs: Date.now() - started, error: isError ? output : undefined });
        toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: String(output), is_error: isError });
      }
      messages.push({ role: 'user', content: toolResults });
      if (status === 'tool_limit_reached') break;
    }
    if (status === 'running') status = pendingValidation ? 'needs_validation' : 'tool_limit_reached';
  } catch (error) {
    status = 'failed';
    onText(`Agent error: ${error.message}`);
  }

  const summary = await ledger.finish({ status, prompt: userMessage });
  return { status, text: finalText, summary, toolCalls, changedFiles, validationPassed, validationAttempts, runDirectory: ledger.directory };
}

function createTaskHash(task) {
  return createHash(String(task)).digest('hex');
}
