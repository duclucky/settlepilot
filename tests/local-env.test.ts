import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {parseEnv} from 'node:util';
import {updateLocalEnv} from '../src/local-env.ts';
test('local setup values survive restart with spaces and hash characters and replace stale duplicate assignments',()=>{
 const root=mkdtempSync(join(tmpdir(),'settlepilot-env-')),file=join(root,'.env');
 try{
  writeFileSync(file,'# keep this comment\nMODEL=old\nUNCHANGED=keep\nMODEL=stale\n');
  const values={MODEL:'owner-model',KEY:'test # credential=literal',CLI:'C:\\Program Files\\Circle\\index.js',QUOTE:"test'quoted"};updateLocalEnv(file,values);
  const parsed=parseEnv(readFileSync(file,'utf8'));for(const [key,value] of Object.entries(values))assert.equal(parsed[key],value);
  assert.equal(parsed.UNCHANGED,'keep');assert.equal(readFileSync(file,'utf8').match(/^MODEL=/gm)?.length,1);
  const before=readFileSync(file,'utf8');assert.throws(()=>updateLocalEnv(file,{KEY:'bad\nINJECTED=1'}),/INVALID_ENV_VALUE/);assert.equal(readFileSync(file,'utf8'),before);
 }finally{rmSync(root,{recursive:true,force:true});}
});
