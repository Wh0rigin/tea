import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeComparisonReport } from '../src/comparison-report.mjs';

if(process.argv.length!==3) throw new Error('Usage: node scripts/chart-pi.mjs path/to/comparison.json');
const source=path.resolve(process.argv[2]);
const report=JSON.parse(await readFile(source,'utf8'));
const analysis=await writeComparisonReport(report,path.dirname(source));
if(!analysis.validComparison) throw new Error(`Chart withheld: ${analysis.issues.join('; ')}`);
if(!analysis.pairs.some(pair=>pair.tea?.usageComplete||pair.pi?.usageComplete)) throw new Error('Chart withheld: no complete provider token usage');
const script=path.join(path.dirname(fileURLToPath(import.meta.url)),'plot-pi.py');
const child=spawn(process.env.TEA_PYTHON||'python',[script,source],{stdio:'inherit',windowsHide:true});
child.once('error',error=>{process.stderr.write(error.message+'\n');process.exitCode=1;});
child.once('exit',code=>{process.exitCode=code??1;});
