// T12: the whole visibility group, base, fix, base. node diffvis.mjs <base-1.json> <fix.json> <base-2.json>
// Caused by the fix: differs base-vs-fix, the two base runs agree, and the fix's reply is on T12's path by its words
// (the checked stop after two held probes). Anything else that differs is listed by name, and not called noise without that evidence.
import {readFileSync} from 'fs';
const T12='2 probe swipes toward it moved nothing';
const load=p=>new Map(JSON.parse(readFileSync(p)).results.map(r=>[r.source+' '+r.id,r.replies]));
const [b1,f,b2]=process.argv.slice(2).map(load);
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const ids=[...new Set([...b1.keys(),...f.keys(),...b2.keys()])];
const out={caused:[],fixOffPath:[],baseVaries:[],missing:[]};let same=0;
for(const k of ids){const [x,y,z]=[b1.get(k),f.get(k),b2.get(k)];
 if(!x||!y||!z){out.missing.push(k);continue}
 const bb=!eq(x,z),bf=!eq(x,y)||!eq(z,y);
 if(!bb&&!bf){same++;continue}
 const text=`${k}\n  base-1: ${x.join(' | ').slice(0,300)}\n  fix   : ${y.join(' | ').slice(0,300)}\n  base-2: ${z.join(' | ').slice(0,300)}`;
 if(bb)out.baseVaries.push(text);else if(y.join(' ').includes(T12))out.caused.push(text);else out.fixOffPath.push(text);}
console.log(`cases ${ids.length}, all three the same ${same}`);
console.log(`\n## Caused by the fix, on T12's path: ${out.caused.length}\n${out.caused.join('\n')}`);
console.log(`\n## Differs base-vs-fix, base runs agree, NOT on T12's path (unexplained, not called noise): ${out.fixOffPath.length}\n${out.fixOffPath.join('\n')}`);
console.log(`\n## Differs base-vs-base (not attributable to the fix): ${out.baseVaries.length}\n${out.baseVaries.join('\n')}`);
console.log(`\n## Missing from a run: ${out.missing.length}\n${out.missing.join('\n')}`);
