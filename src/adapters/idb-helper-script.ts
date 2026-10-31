/**
 * The idb helper's Python side (D7, docs/adr/0032-a-persistent-idb-helper-runs-the-cli-in-process.md): run as
 * `<idb's python> -c IDB_HELPER_SCRIPT <idb's path>` by IdbHelper (idb-helper.ts). A string, not a `.py` file: the
 * package ships `dist/` alone and tsc copies no `.py` into it.
 *
 * It imports fb-idb's CLI once — the ~90 ms every `idb` process pays before it does anything (D7 measured
 * `idb --help` alone at 91.6 ms, docs/plans/2026-10-30-performance-backlog.md, "### D7 and D24 measured") — then
 * answers one request per line on stdin, `{"id", "argv"}`, by running the CLI's own `gen_main(argv)` (what
 * `idb.cli.main.main` runs) on an event loop of its own, created and closed per request as the CLI's one per process
 * is, with `sys.stdout`/`sys.stderr` and the stream of every logging handler on the root logger (main.py's
 * `basicConfig` puts one on the stderr of import time; `logger.exception` writes the CLI's tracebacks through it)
 * pointed at buffers. The reply, `{"id", "code", "stdout", "stderr"}` (the streams base64), goes out on fd 3 — a pipe
 * of its own, so a stray `print` of a plugin or of the import cannot corrupt the protocol. Before it runs a request it
 * says `{"got": id}` there (D7b): node then knows the line left stdin, and a death before the ack runs an input on the
 * CLI — gen_main never saw it — where a death after it is reported (idb.ts#inputLost). The first line on fd 3 is
 * `{"ready": <pid>}`, written only after the import succeeded: an fb-idb without `gen_main`, or an interpreter that cannot import it, exits
 * before it, and node reads that as a failed start.
 *
 * The import sees what the shebang'd CLI sees (review 2026-10-31, MINOR-5): no `-I`, so `PYTHONPATH` and the user
 * site-packages count as they do for `idb`; and its first statement replaces `sys.path[0]` — `''`, the cwd, under
 * `-c` — with the directory of idb's real path, the entry Python puts there when it runs the script. Only when it IS
 * `''`: under safe-path mode (`PYTHONSAFEPATH`, Python 3.11+) `-c` prepends nothing and neither does the script run,
 * so the path is left as it is — the CLI's exactly (review round 2, NIT-A). `sys` is built in and `os` was imported by
 * `site` before any of this runs, so nothing is looked up on the cwd before it is gone, and nothing from averi's cwd
 * can be imported after.
 *
 * Parity with the CLI (the contract test, tests/adapters/idb-helper-contract.test.ts, runs both against the real
 * fb-idb): `sys.argv[0]` is idb's own path, as the shebang'd script sees it, so argparse names itself `idb` in usage
 * and help; the exit code is the CLI's — `gen_main`'s int, a `SystemExit`'s code (argparse: 2 on a bad argv, 0 after
 * `--help`), masked `& 0xff` as the process status is, a non-int code printed to stderr as code 1, as `sys.exit` does;
 * an exception that escapes `gen_main` is printed as Python would print it, code 1. Each stream is a TextIOWrapper over
 * a BytesIO, in the encoding and error handler of the helper's own stdout/stderr — what the CLI's would have under the
 * same locale (D7b, ADR 0032 NIT-2): a command that writes bytes to `sys.stdout.buffer` (fb-idb's `screenshot -`,
 * `file pull … -`, `video`) runs here as in the CLI, and the reply carries both streams as base64 of their bytes, which
 * node decodes as exec does (stdout a Buffer, stderr utf-8). The HID verbs D7b serves print nothing on stdout; D26b's
 * `screenshot -` prints the PNG there (a few hundred KB, base64 on one fd 3 line). It
 * exits on stdin's EOF — the end node gives it on dispose, and the one the kernel gives it when node dies — so it
 * cannot outlive the server by more than its current request.
 */
export const IDB_HELPER_SCRIPT = String.raw`
import sys, os
if sys.path and sys.path[0] == '':
    sys.path[0] = os.path.dirname(os.path.realpath(sys.argv[1]))
argv0 = sys.argv[1]
import asyncio, base64, io, json, logging, traceback
proto = os.fdopen(3, 'w', encoding='utf-8', buffering=1)
def b64(buf):
    return base64.b64encode(buf.getvalue()).decode('ascii')
def reply(obj):
    proto.write(json.dumps(obj) + '\n')
    proto.flush()
from idb.cli.main import gen_main
sys.argv = [argv0]
reply({'ready': os.getpid()})
real_out, real_err = sys.stdout, sys.stderr
for line in sys.stdin:
    req = json.loads(line)
    reply({'got': req['id']})
    out_b, err_b = io.BytesIO(), io.BytesIO()
    out = io.TextIOWrapper(out_b, encoding=real_out.encoding, errors=real_out.errors, write_through=True)
    err = io.TextIOWrapper(err_b, encoding=real_err.encoding, errors=real_err.errors, write_through=True)
    handlers = [h for h in logging.getLogger().handlers if isinstance(h, logging.StreamHandler)]
    saved = [h.setStream(err) for h in handlers]
    sys.stdout, sys.stderr = out, err
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        code = loop.run_until_complete(gen_main(req['argv']))
    except SystemExit as e:
        code = e.code
    except BaseException:
        traceback.print_exc()
        code = 1
    finally:
        try:
            loop.close()
        except BaseException:
            pass
        asyncio.set_event_loop(None)
        sys.stdout, sys.stderr = real_out, real_err
        for h, s in zip(handlers, saved):
            h.setStream(s)
    if code is None:
        code = 0
    elif isinstance(code, int):
        code = code & 0xff
    else:
        err.write(str(code) + '\n')
        code = 1
    for s in (out, err):
        try:
            s.flush()
        except BaseException:
            pass
    reply({'id': req['id'], 'code': code, 'stdout': b64(out_b), 'stderr': b64(err_b)})
`;
