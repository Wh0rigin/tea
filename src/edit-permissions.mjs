import { createHash } from 'node:crypto';
import { ToolFeedbackError } from './tool-feedback.mjs';

export function normalizeEditPermissions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['allow','ask','deny'].includes(k))) throw new TypeError('editPermissions must contain only allow, ask and deny arrays');
  const result = {};
  for (const key of ['allow','ask','deny']) {
    const patterns=value[key]===undefined?[]:value[key];
    if (!Array.isArray(patterns)||patterns.length>32) throw new TypeError('Each editPermissions list must contain at most 32 paths');
    result[key]=Object.freeze(Array.from(patterns,pattern=>{
      if(typeof pattern!=='string'||!pattern.trim()||pattern.length>160||/[\x00-\x1f\x7f:]/.test(pattern))throw new TypeError('Invalid edit permission path');
      let p=pattern.replaceAll('\\','/');while(p.startsWith('./'))p=p.slice(2);
      if(p.startsWith('/')||p.split('/').includes('..'))throw new TypeError('Edit permission paths must stay workspace-relative');
      if(p.endsWith('/'))p+='**';p=p.split('/').filter(s=>s&&s!=='.').join('/');if(!p)throw new TypeError('Empty edit permission path');return p;
    }));
  }
  return Object.freeze(result);
}
// Bounded dynamic programming avoids backtracking-regexp attacks in user patterns.
function segmentMatches(pattern,value) {
  const characters=Array.from(value);
  let row=new Array(characters.length+1).fill(false);row[0]=true;
  for(const c of pattern){const next=new Array(characters.length+1).fill(false);if(c==='*')next[0]=row[0];for(let j=1;j<=characters.length;j++)next[j]=c==='*'?row[j]||next[j-1]:(c==='?'||c===characters[j-1])&&row[j-1];row=next;}
  return row[characters.length];
}

export function editPathMatches(pattern, target, platform=process.platform) {
  if(platform==='win32'){pattern=pattern.toLowerCase();target=target.toLowerCase();}
  const p=pattern.split('/'),v=target.split('/');let row=new Array(v.length+1).fill(false);row[0]=true;
  for(const part of p){const next=new Array(v.length+1).fill(false);if(part==='**')next[0]=row[0];for(let j=1;j<=v.length;j++)next[j]=part==='**'?row[j]||next[j-1]:row[j-1]&&segmentMatches(part,v[j-1]);row=next;}
  return row[v.length];
}
export class EditPermissions {
  constructor(value){this.rules=normalizeEditPermissions(value);this.active=Object.values(this.rules).some(x=>x.length);this.version=createHash('sha256').update(JSON.stringify(this.rules)).digest('hex').slice(0,12);Object.freeze(this);}
  decide(paths){
    for(const decision of ['deny','ask'])for(const rule of this.rules[decision])if(paths.some(p=>editPathMatches(rule,p)))return {decision,rule};
    if(this.rules.allow.length&&!paths.every(p=>this.rules.allow.some(rule=>editPathMatches(rule,p))))return {decision:'deny',rule:'outside configured allow paths'};
    return {decision:'allow'};
  }
}
export async function requestEditApproval(handler,event,signal){
  if(typeof handler!=='function')throw new ToolFeedbackError('EDIT_APPROVAL_UNAVAILABLE','This file edit requires approval. Use an interactive TEA session or supply approveEdit; do not bypass with scripts.');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const abort=()=>{cleanup();reject(signal.reason);};const cleanup=()=>signal?.removeEventListener('abort',abort);
    signal?.addEventListener('abort',abort,{once:true});
    Promise.resolve().then(()=>{signal?.throwIfAborted();return handler(event);}).then(value=>{cleanup();resolve(value===true);},error=>{cleanup();reject(error);});
  });
}
