import { nodeFs } from '../../../scripts/truth/batch/io.js';
import { StepLog, terminalOf } from '../../../scripts/truth/batch/steps.js';

// tests/truth/batch/terminal.test.ts's child: a run whose terminal (stdout) is a pipe whose reader has gone. It waits
// for stdin to end — the parent closes its end of stdout first — then opens a StepLog on the default terminal, notes,
// writes the SUMMARY and exits 0. Its files are argv[2] (the .out) and argv[3] (steps.log).

const [outFile, stepsFile] = process.argv.slice(2);
process.stdin.resume();
process.stdin.on('end', () => {
  const log = StepLog.open(nodeFs, { name: 'child', runId: '1', blocks: ['kf'], outFile, stepsFile, terminal: terminalOf() });
  for (let i = 0; i < 50; i++) log.note(`NOTE line ${i}`);
  log.summary(['======== SUMMARY', 'OK child', '======== SUMMARY end (run 1)']);
  process.exitCode = 0;
});
