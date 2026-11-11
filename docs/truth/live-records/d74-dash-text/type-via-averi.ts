// D74's averi arm (run.sh step 5): one text typed through IosAdapter#typeText, the argv averi builds (`idb ui text
// --udid U -- <text>`), with the idb helper given — AVERI_IDB_HELPER=off in the environment turns it off, every call
// then the CLI. It prints how the typing went and which path served it (the helper's channel, IDB_HELPER_CALL_START);
// run.sh reads the field back. Run from the repo root:
//   node --import tsx docs/truth/live-records/d74-dash-text/type-via-averi.ts <udid> <text>
import { exec } from '../../../../src/adapters/exec.js';
import { IDB_HELPER_CALL_START, runIdb, type IdbHelperCall } from '../../../../src/adapters/idb.js';
import { IdbHelper, idbHelperDisabled } from '../../../../src/adapters/idb-helper.js';
import { IosAdapter } from '../../../../src/adapters/ios.js';
import { createIosTreeSource } from '../../../../src/adapters/ios-tree-source.js';

const [udid, text] = process.argv.slice(2);
if (udid === undefined || text === undefined) throw new Error('usage: type-via-averi.ts <udid> <text>');

const served: string[] = [];
IDB_HELPER_CALL_START.subscribe((m) => void served.push((m as IdbHelperCall).argv.join(' ')));

const helper = new IdbHelper();
// The helper serves only once it is ready: the first call starts it, and reads go to it from then on.
// A failed read stops the warm-up with one line: node's own dump of it would put this checkout's paths in the log.
if (!idbHelperDisabled()) {
  try {
    for (let i = 0; i < 20 && served.length === 0; i++) {
      await runIdb(exec, udid, ['ui', 'describe-all', '--json'], { helper });
      await new Promise((r) => setTimeout(r, 300));
    }
  } catch (e) {
    console.log(`WARN: warm-up read failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (served.length === 0) console.log('WARN: the helper never served a read; the typing goes to the CLI');
}
served.length = 0;

const adapter = new IosAdapter({ udid, exec, treeSource: createIosTreeSource('idb', udid, { exec, idbHelper: helper }), idbHelper: helper });
try {
  await adapter.typeText(text);
  console.log(`typed ok via ${served.length > 0 ? 'helper' : 'cli'}${served.length > 0 ? ` (${served.join(' | ')})` : ''}`);
} catch (e) {
  console.log(`FAILED via ${served.length > 0 ? 'helper' : 'cli'}: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  await adapter.dispose();
}
