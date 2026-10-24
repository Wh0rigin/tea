import path from 'node:path';
import os from 'node:os';
import { ToolFeedbackError } from './tool-feedback.mjs';

// A direct-executable grammar, not a shell. Parsing and policy share these argv.
export function parseCommand(command) {
  if (typeof command !== 'string' || !command.trim() || command.includes('\0')) throw new ToolFeedbackError('INPUT_INVALID', 'command must be a non-empty string without NUL bytes');
  if (/[;&<>`\n\r]/.test(command)) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Shell operators and multiline commands are blocked');
  const argv = []; let value = '', quote = '', started = false;
  const text = command.trim();
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    // A quoted pipe is a literal argv character (e.g. Go's -run regex),
    // not a pipeline. Keep unquoted pipes and the other existing guards blocked.
    if (ch === '|' && !quote) throw new ToolFeedbackError('CAPABILITY_DENIED', 'Shell operators and multiline commands are blocked');
    // Preserve path backslashes. Only a run immediately before a double quote
    // is special: pairs yield literal slashes; an odd remainder escapes it.
    if (ch === '\\' && quote !== "'") {
      let end = i; while (text[end] === '\\') end++;
      if (text[end] === '"') {
        const count = end - i; value += '\\'.repeat(Math.floor(count / 2));
        if (count % 2) value += '"'; else quote = quote === '"' ? '' : '"';
        started = true; i = end; continue;
      }
    }
    if (quote) { if (ch === quote) quote = ''; else value += ch; }
    else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/u.test(ch)) { if (started) { argv.push(value); value = ''; started = false; } }
    else { value += ch; started = true; }
  }
  if (quote) throw new ToolFeedbackError('INPUT_INVALID', 'Unclosed command quote; use balanced single or double quotes');
  if (started) argv.push(value);
  if (!argv[0]) throw new ToolFeedbackError('INPUT_INVALID', 'Command executable is empty');
  return { executable: argv[0], args: argv.slice(1) };
}

const baseName = name => name.split(/[\\/]/).at(-1).toLowerCase().replace(/\.(?:exe|cmd|bat)$/i, '');
function gitSubcommand(args) {
  let i = 0;
  while (args[i]?.startsWith('-')) {
    const flag = args[i++];
    if (['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path'].includes(flag)) i++;
  }
  return { name: args[i], args: args.slice(i + 1) };
}
export function assertCommandPolicy(parsed) {
  const name = baseName(parsed.executable), args = parsed.args;
  if (['rm','del','erase','rmdir','format','mkfs','shutdown','remove-item'].includes(name)
    || name === 'reg' && ['add','delete'].includes(args[0]?.toLowerCase())) {
    throw new ToolFeedbackError('CAPABILITY_DENIED', 'Destructive commands are blocked');
  }
  if (name === 'git') {
    const sub = gitSubcommand(args);
    if (['reset','clean','push','restore'].includes(sub.name)
      || ['checkout','switch'].includes(sub.name) && sub.args.some(x => ['-f','--force','--discard-changes','-B','-C','--force-create'].includes(x))) {
      throw new ToolFeedbackError('CAPABILITY_DENIED', 'Destructive commands and Git history mutations are blocked');
    }
  }
  // Explicit interpreter invocations still require approval; retain their
  // conservative destructive-word guard rather than interpreting shell code.
  if (['cmd','powershell','pwsh','sh','bash','zsh'].includes(name)
    && /(?:\brm\b|\bdel\b|\berase\b|\brmdir\b|\bformat\b|\bmkfs\b|\bshutdown\b|\bRemove-Item\b|git\s+(?:reset|clean|push|restore))/i.test(args.join(' '))) {
    throw new ToolFeedbackError('CAPABILITY_DENIED', 'Destructive interpreter commands are blocked');
  }
}

const gitFlags = /^(?:-(?:\d+|[npwsbuv]+)|--(?:short|porcelain(?:=v[12])?|branch|show-current|list|all|remotes|oneline|graph|decorate(?:=\w+)?|no-decorate|no-merges|stat|numstat|shortstat|name-only|name-status|check|patch|raw|cached|staged|no-ext-diff|no-textconv|no-renames|abbrev-ref|verify|show-toplevel|show-prefix|show-cdup|symbolic-full-name|others|exclude-standard|modified|deleted|stage|error-unmatch|color=never|format(?:=.*)?|pretty(?:=.*)?|max-count(?:=\d+)?|unified(?:=\d+)?|untracked-files(?:=(?:all|normal|no))?))$/;
function diagnostic(parsed) {
  if (parsed.executable !== 'git' && parsed.executable !== 'git.exe') return false;
  const [sub, ...args] = parsed.args;
  if (!['status','diff','log','show','rev-parse','ls-files','branch'].includes(sub)) return false;
  if (sub === 'branch' && !(args[0]?.startsWith('-'))) return args.length === 0;
  let valueNext = false;
  for (const arg of args) {
    if (valueNext) { valueNext = false; continue; }
    if (arg === '--') continue;
    if (arg.startsWith('-') && !gitFlags.test(arg)) return false;
    if (['--format','--pretty','--max-count','--unified','--untracked-files'].includes(arg)) valueNext = true;
    // A bare branch argument creates a branch unless --list selected listing.
    if (sub === 'branch' && !arg.startsWith('-') && !args.includes('--list')) return false;
  }
  return !valueNext;
}
function validationEntry(parsed) {
  const { executable: exe, args } = parsed;
  if (!/^(?:node|npm|python|python3|pytest|go)(?:\.exe)?$/.test(exe)) return false;
  const name = exe.replace(/\.exe$/, '');
  if (name === 'node') return args[0] === '--test';
  if (name === 'npm') return args[0] === 'test' || args[0] === 'run' && ['test','lint','check','typecheck'].includes(args[1]);
  if (['python','python3'].includes(name)) return args[0] === '-m' && ['pytest','unittest'].includes(args[1]);
  if (name === 'pytest') return true;
  return ['test','vet','build'].includes(args[0]);
}
export function isAllowedCommand(command) {
  try { const parsed = typeof command === 'string' ? parseCommand(command) : command; assertCommandPolicy(parsed); return validationEntry(parsed) || diagnostic(parsed); }
  catch { return false; }
}
export function isValidationCommand(command) {
  try {
    const parsed = parseCommand(command); assertCommandPolicy(parsed);
    if (!validationEntry(parsed)) return false;
    const name = parsed.executable.replace(/\.exe$/, '');
    const flags = parsed.args;
    if (flags.some(x => /^(?:-h|--help|--version|--list(?:-[a-z-]+)?|--collect-only|--collectonly|--co|--fixtures(?:-per-test)?|--inspect(?:-brk)?|--eval|--print)(?:=|$)/i.test(x))) return false;
    if (name === 'node' && flags.some(x => ['-v','-e','-p'].includes(x))) return false;
    if (name === 'go' && flags.some(x => /^(?:-list|-h|-help)(?:=|$)/.test(x))) return false;
    return true;
  } catch { return false; }
}

export function commandEnvironment(workspace, env = process.env) {
  const result = {};
  for (const key of ['PATH','PATHEXT','SYSTEMROOT','WINDIR','TEMP','TMP','ComSpec']) if (env[key]) result[key] = env[key];
  // Purpose-specific paths, never the inherited environment or user API keys.
  const temp = env.TMPDIR || env.TEMP || env.TMP || os.tmpdir();
  const home = env.HOME || env.USERPROFILE || os.homedir();
  Object.assign(result, { HOME: home, USERPROFILE: env.USERPROFILE || home, TMPDIR: temp,
    GOCACHE: path.join(temp, 'tea-go-cache'), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
  return result;
}

export function windowsNpmArguments(args) {
  // npm's Windows .cmd launcher is the sole CMD bridge. Direct executables
  // do not need these restrictions. Do not use JSON quoting as CMD escaping.
  if (args.some(x => /[%!^()"&|<>\r\n]/.test(x))) throw new ToolFeedbackError('CAPABILITY_DENIED', 'CMD metacharacters are not allowed in Windows npm commands');
  const quote = value => /\s/.test(value) || !value ? `"${value}"` : value;
  return ['/d','/s','/c',['npm', ...args.map(quote)].join(' ')];
}
