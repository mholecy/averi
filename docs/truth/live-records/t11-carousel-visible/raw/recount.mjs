import fs from 'fs';
const E='docs/truth/live-records/t11-carousel-visible/';
const walk=(d,p='')=>fs.readdirSync(E+d).filter(f=>f.endsWith('.json')&&f.startsWith(p)).map(f=>E+d+'/'+f);
const all=[...walk('ab-c899-head'),...walk('group'),...walk('fix-drop'),...walk('fix-drop-more')];
let sent=0,stk=0,zero=[];const bk={};
for(const f of all){for(const c of JSON.parse(fs.readFileSync(f)).results){if(!c.swipes||!c.state)continue;if(!/d62|d68|d59b|e2/.test(c.id))continue;const st=(c.state.strokes||[]).filter(x=>x.view==='carousel');const a=c.preDrag?st.slice(1):st;const s=c.swipes.filter(x=>!x.dropped);sent+=s.length;stk+=a.length;
 for(let i=0;i<Math.max(a.length,s.length);i++){const dr=s[i]?Math.abs(s[i].from.x-s[i].to.x):null;const d=a[i]?Math.abs(a[i].to-a[i].from):null;const b=dr==null?'?':dr<60?'<60':dr<100?'60-99':dr<200?'100-199':'200+';(bk[b]??={n:0,z:0}).n++;if(d!=null&&d<=1){bk[b].z++;zero.push(f.split('/').slice(-1)[0]+' '+c.id+' #'+(i+1)+' drawn '+dr+' @'+a[i].from)}}}}
console.log({files:all.length,sent,stk,bk});console.log(zero.join('\n'));
const cad=(files,id)=>{const g=[];for(const f of files)for(const c of JSON.parse(fs.readFileSync(f)).results){if(c.id!==id)continue;const st=(c.state.strokes||[]).filter(x=>x.view==='carousel');for(let i=2;i<st.length;i++)g.push(st[i].at-st[i-1].at)};g.sort((a,b)=>a-b);return{n:g.length,med:g[g.length>>1]?.toFixed(2),p10:g[g.length/10|0]?.toFixed(2),p90:g[g.length*.9|0]?.toFixed(2)}};
const T7=['1','2','3'].map(i=>'docs/truth/live-records/android-carousel-t7a-'+i+'.json');
console.log('cadence T7a',cad(T7,'lv-d62-control'),'ab head',cad(walk('ab-c899-head','head'),'lv-d62-control'),'ab c899',cad(walk('ab-c899-head','c899'),'lv-d62-control'),'group',cad(walk('group','head'),'lv-d62-control'));
let u={};for(const f of T7)for(const c of JSON.parse(fs.readFileSync(f)).results){if(!/d62-control|d68-launch|d59b-recycler/.test(c.id))continue;const k=/without swiping further/.test(c.replies[0])?'unaim':'other';(u[c.id]??={unaim:0,other:0})[k]++}console.log('t7a unaim',u);
// raw
for(const f of fs.readdirSync(E+'raw').filter(x=>x.endsWith('.jsonl'))){let n=0,s=0,mn=1e9,mx=0,zz=0;for(const l of fs.readFileSync(E+'raw/'+f,'utf8').trim().split('\n')){for(const x of JSON.parse(l).strokes){n++;if(x.carry<=94)s++;mn=Math.min(mn,x.carry);mx=Math.max(mx,x.carry);if(x.carry===0)zz++}}console.log(f,{n,short:s,mn,mx,zz})}
// time of sixth read budget: reply 'tree reads took'
const reads=[];for(const f of walk('ab-c899-head'))for(const c of JSON.parse(fs.readFileSync(f)).results){const m=/(\d+) tree reads took (\d+)ms, the last (\d+)ms/.exec(c.replies[0]);if(m)reads.push(+m[2]/+m[1])}reads.sort((a,b)=>a-b);console.log('avg read ms med',reads[reads.length>>1]?.toFixed(0),reads.length);
const fish=(a,b,c,d)=>{const f=n=>{let r=0;for(let i=2;i<=n;i++)r+=Math.log(i);return r};const p=(a,b,c,d)=>Math.exp(f(a+b)+f(c+d)+f(a+c)+f(b+d)-f(a)-f(b)-f(c)-f(d)-f(a+b+c+d));const p0=p(a,b,c,d);let s=0;const r1=a+b,c1=a+c,n=a+b+c+d;for(let x=Math.max(0,c1-(n-r1));x<=Math.min(r1,c1);x++){const q=p(x,r1-x,c1-x,n-r1-c1+x);if(q<=p0*(1+1e-9))s+=q}return s};
console.log('fisher 2/8 vs 0/41',fish(2,6,0,41).toFixed(4),' 10/16 vs 9/16',fish(10,6,9,7).toFixed(3));
