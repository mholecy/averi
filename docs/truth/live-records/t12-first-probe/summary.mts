// T12: one line per record. node --import tsx summary.mts <harness checkout> <records dir>
const [WT, dir] = process.argv.slice(2);
const { readdirSync, readFileSync } = await import('node:fs');
const { isCut, cutOf } = await import(`${WT}/scripts/truth/live-carousel.ts`);
const { carouselReply, swipesOf } = await import(`${WT}/scripts/truth/replies.ts`);
for (const f of readdirSync(dir).filter((x: string) => x.endsWith('.json')).sort()) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, 'utf8'));
  const ds = j.deviceState === undefined ? '' : `${j.deviceState.before.short}/${j.deviceState.before.strokes}->${j.deviceState.after.short}/${j.deviceState.after.strokes}${j.deviceState.disagree ? ' DISAGREE' : ''}`;
  if (j.first !== undefined) { console.log(`${f}\t${ds}\tflush=${j.flush}\t${j.first.ms}ms ${j.first.reply.slice(0, 90)} || ${j.second.ms}ms ${j.second.reply.slice(0, 60)}\tafter=${JSON.stringify(j.afterFirst)}`); continue; }
  for (const r of j.results) {
    const rep = r.replies[0] ?? '';
    const carousel = r.state?.scrollViews?.carousel !== undefined;
    const cut = carousel ? cutOf(r.state) : undefined;
    const fc = carousel && carouselReply(rep) === 'fully-visible' && isCut(r.state);
    const sw = (r.swipes ?? []).map((s: any) => (s.dropped ? 'D' : s.sentTo ? 's' : '-')).join('');
    const ms = r.ms ?? r.elapsedMs ?? '';
    console.log(`${f}\t${r.id}\t${ds}\tfalse=${fc}\tcut=${cut === undefined ? '' : JSON.stringify(cut)}\tswipes=${swipesOf(rep) ?? '?'}\tlog=${sw}\t${ms}\t${rep.slice(0, 150)}`);
  }
}
