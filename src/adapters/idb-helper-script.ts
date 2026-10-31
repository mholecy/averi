/**
 * The idb helper's Python side (D7, docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md): run as
 * `<idb's python> -I -c IDB_HELPER_SCRIPT <idb's path>` by IdbHelper (idb-helper.ts). A string, not a `.py` file:
 * the package ships `dist/` alone and tsc copies no `.py` into it.
 *
 * It imports fb-idb's CLI once — the ~90 ms every `idb` process pays before it does anything (D7 measured
 * `idb --help` alone at 91.6 ms, docs/plans/2026-10-30-performance-backlog.md, "### D7 and D24 measured") — then
 * answers one request per line on stdin, `{"id", "argv"}`, by running the CLI's own `gen_main(argv)` (what
 * `idb.cli.main.main` runs) on one event loop, with `sys.stdout`/`sys.stderr` and the stream of every logging
 * handler on the root logger (main.py's `basicConfig` puts one on the stderr of import time) pointed at buffers. The
 * reply, `{"id", "code", "stdout", "stderr"}`, goes out on fd 3 — a pipe of its own, so a stray `print` of a plugin or
 * of the import cannot corrupt the protocol. The first line on fd 3 is `{"ready": <pid>}`, written only after the
 * import succeeded: an fb-idb without `gen_main`, or an interpreter that cannot import it, exits before it, and node
 * reads that as a failed start.
 *
 * Parity with the CLI (the contract test, tests/adapters/idb-helper-contract.test.ts, runs both against the real
 * fb-idb): `sys.argv[0]` is idb's own path, as the shebang'd script sees it, so argparse names itself `idb` in usage
 * and help; the exit code is the CLI's — `gen_main`'s int, a `SystemExit`'s code (argparse: 2 on a bad argv, 0 after
 * `--help`), a non-int code printed to stderr as code 1, as `sys.exit` does; an exception that escapes `gen_main` is
 * printed as Python would print it, code 1. It exits on stdin's EOF — the end node gives it on dispose, and the one
 * the kernel gives it when node dies — so it cannot outlive the server by more than its current request.
 */
export const IDB_HELPER_SCRIPT = String.raw`
import sys
argv0 = sys.argv[1] if len(sys.argv) > 1 else 'idb'
import asyncio, io, json, logging, os, traceback
proto = os.fdopen(3, 'w', encoding='utf-8', buffering=1)
def reply(obj):
    proto.write(json.dumps(obj) + '\n')
    proto.flush()
from idb.cli.main import gen_main
sys.argv = [argv0]
loop = asyncio.new_event_loop()
asyncio.set_event_loop(loop)
reply({'ready': os.getpid()})
real_out, real_err = sys.stdout, sys.stderr
for line in sys.stdin:
    req = json.loads(line)
    out, err = io.StringIO(), io.StringIO()
    handlers = [h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler)]
    saved = [h.setStream(err) for h in handlers]
    sys.stdout, sys.stderr = out, err
    try:
        code = loop.run_until_complete(gen_main(req['argv']))
    except SystemExit as e:
        code = e.code
    except BaseException:
        traceback.print_exc()
        code = 1
    finally:
        sys.stdout, sys.stderr = real_out, real_err
        for h, s in zip(handlers, saved):
            h.setStream(s)
    if code is None:
        code = 0
    elif not isinstance(code, int):
        err.write(str(code) + '\n')
        code = 1
    reply({'id': req['id'], 'code': code, 'stdout': out.getvalue(), 'stderr': err.getvalue()})
`;
