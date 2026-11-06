// Label a group's records with the raw state before and after it. node label-group.mjs <dir> <group> <before.jsonl> <after.jsonl>
import {readFileSync,writeFileSync,readdirSync} from 'fs';
const [dir,g,bf,af]=process.argv.slice(2);
const read=f=>{const c=readFileSync(f,'utf8').trim().split('\n').flatMap(l=>JSON.parse(l).strokes.map(s=>s.carry));const short=c.filter(x=>x<=94).length;return{file:f.split('/').pop(),strokes:c.length,short,state:short*4>=c.length?'short':'fast'}};
const before=read(bf),after=read(af),disagree=before.state!==after.state;
const files=readdirSync(dir).filter(f=>f.endsWith('.json')&&(f.startsWith(g+'-')));
if(files.length===0)throw new Error('no records of '+g);
for(const f of files){const p=dir+'/'+f;const j=JSON.parse(readFileSync(p,'utf8'));j.deviceState={before,after,disagree};writeFileSync(p,JSON.stringify(j)+'\n')}
console.log(`group ${g}: ${files.length} records, before ${before.state} ${before.short}/${before.strokes}, after ${after.state} ${after.short}/${after.strokes}${disagree?' DISAGREE':''}`);
