import { retrievalTasks } from './retrieval-code.mjs';

// Self-authored diagnostic fixtures, including explicit directory-local contracts.
const retry = structuredClone(retrievalTasks[1]);
retry.id = 'instructions-nested-retry';
retry.title = 'Nested retry rules';
retry.behaviorAcceptance = retry.acceptance;
retry.files['src/runtime/dispatch/AGENTS.md'] = '# Local contract\nFor recovery.mjs in this directory, every RangeError raised for invalid retry arguments must have the exact message "invalid retry bounds". Preserve all existing files and add regression coverage in a new test file.\n';
retry.solution['src/runtime/dispatch/recovery.mjs'] = retry.solution['src/runtime/dispatch/recovery.mjs'].replace('"bounds"', '"invalid retry bounds"');
retry.acceptance += `\ntest('directory-local error contract',async()=>{const {remainingRetries:r}=await import('./src/index.mjs');for(const args of [[-1],[0,null],[0,{}]])assert.throws(()=>r(...args),{name:'RangeError',message:'invalid retry bounds'});});`;

const pagination = structuredClone(retrievalTasks[2]);
pagination.id = 'instructions-nested-pagination';
pagination.title = 'Pagination with directory rules';
pagination.files['src/AGENTS.md'] = '# Source contract\nBefore editing pagination or API behavior, inspect src/store.mjs and the existing public tests to confirm stored item shape and the store interface. Preserve existing public tests; new regression tests must be separate files. No dependencies.\n';

export const instructionTasks = [structuredClone(retrievalTasks[0]), retry, pagination];
