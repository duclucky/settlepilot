import { readFileSync } from 'node:fs';
import { verifyDecisionRecord } from '../src/decision-record.ts';

try {
  const path=process.argv[2];if(!path)throw new Error('FILE_REQUIRED');
  const value=JSON.parse(readFileSync(path,'utf8'));
  if(!verifyDecisionRecord(value.record??value))throw new Error('INTEGRITY_CHECK_FAILED');
  console.log('Decision payload digest matches. This verifies local integrity only; it does not authenticate the author or verify chain settlement. Execution outcomes are outside the decision digest.');
}catch{
  console.error('Unable to verify the decision record. Provide an exported JSON file with a valid payload and matching digest.');
  process.exitCode=1;
}
