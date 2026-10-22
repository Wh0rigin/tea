import { parseCommand, assertCommandPolicy, isAllowedCommand } from '../../src/commands.mjs';
import { createHash } from 'node:crypto';

// Trusted runner configuration, never learned from model arguments or AGENTS.
export function createDeepSweApproval({ cliModules = [], baseRef = 'main' } = {}) {
  if (!/^[A-Za-z0-9][\w./-]*$/.test(baseRef) || baseRef.includes('..') || !Array.isArray(cliModules)
    || cliModules.some(x => typeof x !== 'string' || !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*$/.test(x))) throw new TypeError('Invalid benchmark command policy');
  const modules = new Set(cliModules);
  const branch = value => typeof value === 'string' && /^[A-Za-z][\w./-]*$/.test(value) && !value.includes('..');
  const approve = command => {
    const deny = reason => ({ decision: 'deny', source: 'policy', reason });
    let parsed;
    try { parsed = parseCommand(command); assertCommandPolicy(parsed); } catch { return deny('Command syntax or operation is blocked'); }
    if (isAllowedCommand(parsed)) return { decision: 'allow', source: 'policy' };
    const { executable: exe, args } = parsed;
    if (exe === 'go' && (args[0] === 'version' && args.length === 1 || args[0] === 'env' && args.slice(1).every(x => x === '-json' || /^[A-Z][A-Z0-9_]*$/.test(x)))) return { decision: 'allow', source: 'policy' };
    if (['python','python3'].includes(exe) && args[0] === '-m' && modules.has(args[1])) return { decision: 'allow', source: 'policy' };
    if (exe === 'git') {
      const [sub, ...rest] = args;
      if (['switch','checkout'].includes(sub) && rest[0] === (sub === 'switch' ? '-c' : '-b') && branch(rest[1])
        && (rest.length === 2 || rest.length === 3 && [baseRef,'HEAD'].includes(rest[2]))) return { decision: 'allow', source: 'policy' };
      if (sub === 'add' && rest.length && rest.every(x => !x.startsWith('/') && !/^[A-Za-z]:/.test(x) && !x.includes('\\') && !x.split('/').includes('..')
        && x !== '.tea' && !x.startsWith('.tea/') && (!x.startsWith('-') || ['-A','--all','--'].includes(x)))) return { decision: 'allow', source: 'policy' };
      if (sub === 'commit') {
        let message = false, valid = true;
        for (let i = 0; i < rest.length; i++) {
          if (['-s','--signoff','-a','--all'].includes(rest[i])) continue;
          if (['-m','--message'].includes(rest[i]) && rest[i + 1]) { message = true; i++; } else valid = false;
        }
        if (valid && message) return { decision: 'allow', source: 'policy' };
      }
    }
    return deny('Outside the frozen benchmark command policy; use a documented validation or CLI entry');
  };
  Object.defineProperty(approve, 'commandHints', { value: Object.freeze([
    `git switch -c BRANCH ${baseRef}`, ...[...modules].slice(0,3).map(x => `python -m ${x} ARGUMENTS`),
  ]) });
  Object.defineProperty(approve, 'commandPolicyId', { value: createHash('sha256').update(JSON.stringify({baseRef,cliModules:[...modules].sort()})).digest('hex').slice(0,16) });
  return approve;
}
