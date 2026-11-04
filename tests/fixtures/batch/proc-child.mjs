import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// The small processes tests/truth/batch/bounded-proc.test.ts and abort-proc.test.ts start through the batch module's
// process seam. Plain JavaScript, no imports of the repo: each starts in a few tens of milliseconds. The mode is
// argv[2]; pids and markers go through files the test names, never through ps or pgrep (the sandbox blocks them).

const [mode, ...rest] = process.argv.slice(2);
const forever = () => setInterval(() => {}, 1 << 30);
/** A grandchild in this process's group (not detached) that ignores SIGTERM and waits for ever. */
const stubborn = () => spawn(process.execPath, [import.meta.filename, 'stubborn'], { stdio: 'inherit' });

switch (mode) {
  case 'tree': {
    // <pidfile>: this process and its stubborn grandchild, both waiting for ever; their pids as "<child> <grandchild>".
    const g = stubborn();
    writeFileSync(rest[0], `${process.pid} ${g.pid}`);
    forever();
    break;
  }
  case 'stubborn':
    process.on('SIGTERM', () => {});
    forever();
    break;
  case 'leave': {
    // <pidfile>: exits at once, its stubborn grandchild holding the stdout and stderr it inherited.
    const g = stubborn();
    writeFileSync(rest[0], String(g.pid));
    g.unref();
    process.exit(0);
    break;
  }
  case 'echo':
    // <out> [<err> [<code>]]
    process.stdout.write(rest[0] ?? '');
    process.stderr.write(rest[1] ?? '');
    process.exitCode = Number(rest[2] ?? 0);
    break;
  case 'stdin': {
    // How many bytes stdin held before it ended: 0 for /dev/null.
    let n = 0;
    process.stdin.on('data', (d) => (n += d.length));
    process.stdin.on('end', () => process.stdout.write(`stdin ${n}`));
    break;
  }
  case 'slow':
    // <started> <done> <ms>: a restore that takes <ms>; it writes its pid to <started> at once and "done" to <done> at the end.
    writeFileSync(rest[0], String(process.pid));
    setTimeout(() => writeFileSync(rest[1], 'done'), Number(rest[2]));
    break;
  case 'sleep':
    // <pidfile> <ms>: a probe that waits.
    writeFileSync(rest[0], String(process.pid));
    setTimeout(() => {}, Number(rest[1]));
    break;
  default:
    process.stderr.write(`proc-child: unknown mode ${mode}\n`);
    process.exitCode = 2;
}
