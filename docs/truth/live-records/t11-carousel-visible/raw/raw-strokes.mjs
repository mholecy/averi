// raw stroke transfer, no averi: node raw.mjs <out.jsonl> <rounds> [label]. Pre-drag then 4 × 142-px, 300-ms strokes (lv-d62's first probe) on carousel-recycler-free, each from rest.
import {execFileSync} from 'child_process'; import {appendFileSync} from 'fs';
const [out,rounds,label='']=process.argv.slice(2); const S='emulator-5554'; const P='dev.averi.lab';
const adb=(...a)=>execFileSync('adb',['-s',S,...a],{encoding:'utf8',maxBuffer:1<<24});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const st=()=>JSON.parse(adb('exec-out','run-as',P,'cat','files/lab-state.json'));
const off=()=>st().offsets?.carousel;
const sw=(x1,x2,ms)=>{const t=Date.now();adb('shell','input','swipe',String(x1),'497',String(x2),'497',String(ms));return Date.now()-t};
for(let r=0;r<+rounds;r++){
 adb('shell','am','force-stop',P);adb('shell','run-as',P,'rm','-f','files/lab-state.json');
 adb('shell','am','start','-W','-n',`${P}/.MainActivity`,'--es','cell','carousel-recycler-free');
 await sleep(1500);
 const o0=off()??0; const tp=sw(872,432,1000); await sleep(1200); const o1=off();
 const strokes=[]; let o=o1;
 for(let i=0;i<4;i++){const t=sw(824,682,300); await sleep(1500); const n=off(); strokes.push({carry:n-o,ms:t}); o=n; }
 const row={label,t:new Date().toISOString(),pre:o1-o0,preMs:tp,strokes,load:adb('shell','cat','/proc/loadavg').trim()};
 appendFileSync(out,JSON.stringify(row)+'\n'); console.log(JSON.stringify(row));
}
adb('shell','am','force-stop',P);
