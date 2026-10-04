import { lstat, readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { Store } from '../store.ts';
import { ingestSource } from '../ingestion.ts';

export function parseCsv(content:string) {
  const rows:string[][]=[];let row:string[]=[],value='',quoted=false;
  for(let i=0;i<content.length;i++) {
    const c=content[i];
    if(c==='"'){if(quoted&&content[i+1]==='"'){value+='"';i++;}else quoted=!quoted;}
    else if(c===','&&!quoted){row.push(value);value='';}
    else if(c==='\n'&&!quoted){row.push(value.replace(/\r$/,''));rows.push(row);row=[];value='';}
    else value+=c;
  }
  if(quoted)throw new Error('INCOMPLETE_CSV');
  if(value||row.length){row.push(value.replace(/\r$/,''));rows.push(row);}
  const header=rows.shift();if(!header||new Set(header).size!==header.length)throw new Error('INVALID_CSV_HEADER');
  return rows.filter(r=>r.some(Boolean)).map(r=>{if(r.length!==header.length)throw new Error('INVALID_CSV_ROW');const item:Record<string,unknown>=Object.fromEntries(header.map((h,i)=>[h,r[i]]));item.revision=Number(item.revision);if(item.active!==undefined){if(!['true','false'].includes(String(item.active)))throw new Error('INVALID_CSV_BOOLEAN');item.active=item.active==='true';}return item;});
}
export async function syncDirectory(store:Store) {
  const state=store.read();const configured=state.autonomy!.sourceDirectory;
  if(!configured)return {accepted:0,rejected:0};
  const root=await realpath(configured);let accepted=0,rejected=0;
  const files=(await readdir(root)).filter(f=>/\.(json|csv)$/i.test(f));
  if(files.length>100)throw new Error('SOURCE_FILE_LIMIT');
  for(const file of files) {
    const path=resolve(root,file),stat=await lstat(path);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024){rejected++;continue;}
    const actual=await realpath(path),rel=relative(root,actual);
    if(rel.startsWith('..')||isAbsolute(rel)){rejected++;continue;}
    try {
      const content=await readFile(actual,'utf8');
      const after=await lstat(path);if(after.size!==stat.size||after.mtimeMs!==stat.mtimeMs){rejected++;continue;}
      const raw=file.toLowerCase().endsWith('.csv')?{sourceId:'export',records:parseCsv(content)}:JSON.parse(content);
      const result=ingestSource(store,raw,state.autonomy!.sourceAuthority);accepted+=result.accepted;rejected+=result.rejected;
    } catch {rejected++;}
  }
  if(rejected)throw new Error('SOURCE_RECORDS_QUARANTINED');
  return {accepted,rejected};
}
