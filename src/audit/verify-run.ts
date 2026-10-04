import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ArcReader } from '../adapters/arc.ts';
import type { State } from '../domain.ts';

if (existsSync('.env')) loadEnvFile('.env');
const latest=z.object({outputDir:z.string()}).parse(JSON.parse(readFileSync('data/stress-50/latest.json','utf8')));
const outputDir=resolve(process.argv[2]??latest.outputDir);
const db=new DatabaseSync(resolve(outputDir,'stress.db'),{readOnly:true});
const state=JSON.parse((db.prepare('SELECT body FROM state WHERE id=1').get() as {body:string}).body) as State;
db.close();
const arc=new ArcReader(process.env.ARC_TESTNET_RPC_URL);
const intents=state.intents.filter(intent=>intent.status==='SETTLED'&&intent.hash);
const results=[] as {intentId:string;runId:string;hash:string;amountUnits:string;recipient:string;verified:boolean;error?:string}[];
for (const intent of intents) {
  try {
    await arc.verifyAgentTransfer(intent.hash!,intent);
    results.push({intentId:intent.id,runId:intent.runId,hash:intent.hash!,amountUnits:intent.amount,recipient:intent.recipient,verified:true});
  } catch {
    results.push({intentId:intent.id,runId:intent.runId,hash:intent.hash!,amountUnits:intent.amount,recipient:intent.recipient,verified:false,error:'ARC_RECEIPT_VERIFICATION_FAILED'});
  }
}
const hashes=results.map(result=>result.hash.toLowerCase());
const report={verifiedAt:new Date().toISOString(),chainId:5042002,outputDir,settledIntents:intents.length,verifiedReceipts:results.filter(result=>result.verified).length,uniqueHashes:new Set(hashes).size,allVerified:results.every(result=>result.verified)&&new Set(hashes).size===hashes.length,results};
writeFileSync(resolve(outputDir,'receipt-verification.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({settledIntents:report.settledIntents,verifiedReceipts:report.verifiedReceipts,uniqueHashes:report.uniqueHashes,allVerified:report.allVerified,artifact:resolve(outputDir,'receipt-verification.json')},null,2));
if (!report.allVerified) process.exitCode=1;
