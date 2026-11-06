import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Every committed live record is replayed: tests/truth/live-rejudge.test.ts runs a rejudge on it — passes it to
 * `rejudgeInProcess` or `rejudgeCli` by name or by a template (`${n}` a run number), or lists it as a row of an
 * `it.each` table whose own callback passes its first parameter to one of them (`replayed`, below, read off the
 * syntax tree: a commented-out row names nothing) — or it is exempt below, with the reason it cannot be judged by
 * `live.ts --rejudge`. A record a test only reads is not replayed. Without this, a row dropped from
 * live-rejudge.test.ts left a record no test rejudges, and nothing failed (T3's review rounds 1 to 4). What it cannot
 * see, being read off the source and not the run: a helper that names a record but is never called, and an early
 * return at run time that skips the rejudge.
 */

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const RECORDS = `${ROOT}docs/truth/live-records`;

/** A1's keyboard scroll probes (round 7), run from a scratch copy of the harness. */
const KBSCROLL = "round 7's A1 keyboard scroll probe from a scratch copy of the harness: its ids (ks-*) are no live.ts case";
/** A3's scratch driver (round 7), its assert replies alone. */
const HINT_ASSERTS = "round 7's A3 scratch driver's assert replies: no live.ts case id in it";

/** The records no `--rejudge` can judge, each with its reason. (A9's raw typing diagnosis, a9-fill-tail-diag/, and T11's
 * evidence, t11-carousel-visible/, are folders, which this guard does not read.) */
const EXEMPT: Readonly<Record<string, string>> = {
  'android-hint-everywhere-9fa59ae-asserts.json': HINT_ASSERTS,
  'android-hint-everywhere-e726c77-asserts.json': HINT_ASSERTS,
  'android-k7-fully-eyes-direct.jsonl': 'averi driven directly over MCP (k7 with `fully: true`), no run record',
  'ios-idb-held-no-spinner-describe-all-d30-1.json': "batch-3's raw idb describe-all of the held-no-spinner's spinner, no run record",
  'ios-idb-held-no-spinner-describe-all-nested-d30-1.json': "batch-3's raw idb describe-all (nested) of the held-no-spinner's spinner, no run record",
  'ios-wda-kbscroll-r23-1.json': KBSCROLL,
  'ios-wda-kbscroll-r23-2.json': KBSCROLL,
  'ios-wda-kbscroll-r23-ios-stop-1.json': KBSCROLL,
  'ios-wda-kbscroll-r23-ios-stop-2.json': KBSCROLL,
};

const parse = (source: string) => ts.createSourceFile('live-rejudge.test.ts', source, ts.ScriptTarget.Latest, true);

/** The text of a string literal (or a template with no placeholder), else undefined. */
const stringOf = (node: ts.Node | undefined): string | undefined => (node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined);

/** The record a table row names: a bare string, or an array literal's first element. */
const rowRecord = (row: ts.Expression): string | undefined => (ts.isArrayLiteralExpression(row) ? stringOf(row.elements[0]) : stringOf(row))?.split('/').pop();

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A template's records, each placeholder a run number (`${n}`: digits alone), matched on the path's last part. */
const templateOf = (node: ts.TemplateExpression): RegExp =>
  new RegExp(`(?:^|/)${[node.head.text, ...node.templateSpans.map((span) => span.literal.text)].map(escape).join('\\d+')}$`);

/** A call to `rejudgeInProcess` or `rejudgeCli`. */
const isRejudge = (node: ts.Node): node is ts.CallExpression =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text === 'rejudgeInProcess' || node.expression.text === 'rejudgeCli');

/** The names along a call's callee: `it.skip.each(…)(…)` → each, skip, it. */
function calleeNames(expr: ts.Expression): string[] {
  if (ts.isIdentifier(expr)) return [expr.text];
  if (ts.isPropertyAccessExpression(expr)) return [expr.name.text, ...calleeNames(expr.expression)];
  if (ts.isCallExpression(expr)) return calleeNames(expr.expression);
  return [];
}

/** A call vitest does not run: its callee chain holds `skip` or `todo`, or one of its arguments is `{ …, skip: true }`. */
const isSkipped = (node: ts.CallExpression): boolean =>
  calleeNames(node.expression).some((name) => name === 'skip' || name === 'todo') ||
  node.arguments.some(
    (arg) => ts.isObjectLiteralExpression(arg) && arg.properties.some((p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'skip' && p.initializer.kind === ts.SyntaxKind.TrueKeyword),
  );

/** `expr` without `as const`, `satisfies …` or parentheses around it. */
const unwrapped = (expr: ts.Expression): ts.Expression =>
  ts.isAsExpression(expr) || ts.isSatisfiesExpression(expr) || ts.isParenthesizedExpression(expr) ? unwrapped(expr.expression) : expr;

/** For `it.each(<array>)(<title>, <callback>)`: its table and its callback (that call's own last argument), else undefined. */
function itEach(node: ts.Node): { table: ts.ArrayLiteralExpression; callback: ts.ArrowFunction | ts.FunctionExpression } | undefined {
  if (!ts.isCallExpression(node) || !ts.isCallExpression(node.expression)) return undefined;
  const each = node.expression;
  const callee = each.expression;
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression) || callee.expression.text !== 'it' || callee.name.text !== 'each') return undefined;
  const table = each.arguments[0] === undefined ? undefined : unwrapped(each.arguments[0]);
  const callback = node.arguments[node.arguments.length - 1];
  if (table === undefined || !ts.isArrayLiteralExpression(table) || callback === undefined || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return undefined;
  return { table, callback };
}

/** Whether `callback` passes its first parameter, as the first argument, to a rejudge anywhere in its body. */
function rejudgesItsParameter(callback: ts.ArrowFunction | ts.FunctionExpression): boolean {
  const param = callback.parameters[0]?.name;
  if (param === undefined || !ts.isIdentifier(param)) return false;
  let found = false;
  const visit = (node: ts.Node): void => {
    const first = isRejudge(node) ? node.arguments[0] : undefined;
    if (first !== undefined && ts.isIdentifier(first) && first.text === param.text) found = true;
    else ts.forEachChild(node, visit);
  };
  visit(callback.body);
  return found;
}

/**
 * The records a rejudge runs on in `source` (live-rejudge.test.ts), read off its syntax tree — comments are no nodes:
 * (1) a `rejudgeInProcess`/`rejudgeCli` call's first argument, a string or a template of run numbers; (2) every row of
 * an `it.each` table (a bare string, or an array literal's first element) whose own callback passes its first parameter
 * to one of them. A skipped or todo call (`.skip`, `.todo` on its callee, or `{ skip: true }`) and all it holds name
 * nothing; nor does anything else: a false failure here is a nuisance, a false pass hides a record.
 */
function replayed(source: string): { names: Set<string>; templates: RegExp[] } {
  const names = new Set<string>();
  const templates: RegExp[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isSkipped(node)) return;
    if (isRejudge(node)) {
      const first = node.arguments[0];
      const name = stringOf(first);
      if (name !== undefined) names.add(name.split('/').pop()!);
      else if (first !== undefined && ts.isTemplateExpression(first)) templates.push(templateOf(first));
    }
    const each = itEach(node);
    if (each !== undefined && rejudgesItsParameter(each.callback))
      for (const row of each.table.elements) {
        const name = rowRecord(row);
        if (name !== undefined) names.add(name);
      }
    ts.forEachChild(node, visit);
  };
  visit(parse(source));
  return { names, templates };
}

const replayedBySource = new Map<string, { names: Set<string>; templates: RegExp[] }>();

/** `replayed(source)`, parsed once per source. */
function replayedOnce(source: string): { names: Set<string>; templates: RegExp[] } {
  let found = replayedBySource.get(source);
  if (found === undefined) replayedBySource.set(source, (found = replayed(source)));
  return found;
}

const records = readdirSync(RECORDS).filter((f) => /\.jsonl?$/.test(f));
const isReplayed = (source: string, record: string) => {
  const { names, templates } = replayedOnce(source);
  return names.has(record) || templates.some((t) => t.test(record));
};

/** `source` without the one `it.each` table row (`['<record>', …]` or `'<record>'`) that names `record`, its comma too. */
function withoutRow(source: string, record: string): string {
  const file = parse(source);
  const rows: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    rows.push(...(itEach(node)?.table.elements.filter((row) => rowRecord(row) === record) ?? []));
    ts.forEachChild(node, visit);
  };
  visit(file);
  expect(rows, record).toHaveLength(1);
  const [row] = rows;
  const end = source.slice(row.end).match(/^\s*,/)?.[0].length ?? 0;
  return source.slice(0, row.getStart(file)) + source.slice(row.end + end);
}

describe('every committed live record is replayed by live-rejudge.test.ts, or exempt with a reason', () => {
  const source = readFileSync(`${ROOT}tests/truth/live-rejudge.test.ts`, 'utf8');

  it('each record in docs/truth/live-records is named by a rejudge row or template, or exempt', () => {
    expect(records.filter((r) => !isReplayed(source, r) && EXEMPT[r] === undefined)).toEqual([]);
  });

  it('each exempt record exists, is named by no row, and has a reason', () => {
    for (const [record, why] of Object.entries(EXEMPT)) {
      expect(records, record).toContain(record);
      expect(isReplayed(source, record), record).toBe(false);
      expect(why.length, record).toBeGreaterThan(10);
    }
  });

  it('the rule bites: a row dropped from the source leaves its record unnamed', () => {
    for (const record of ['ios-wda-forms-l7-1.json', 'android-vis-r1023-lv2-3.json', 'android-vis-r1023-lv2-group.json', 'cal7-d928789-1.json']) {
      expect(isReplayed(source, record), record).toBe(true);
      expect(isReplayed(withoutRow(source, record), record), record).toBe(false);
    }
  });

  it('only a rejudge names a record: a template or a row that feeds no rejudge does not; a placeholder is digits alone', () => {
    // The flush probe's field check reads android-vis-r1023-lv2-${n}.json without rejudging it.
    expect(isReplayed('it.each([1, 2])(\'x\', (n) => { readFileSync(`../../docs/truth/live-records/android-vis-r1023-lv2-${n}.json`); });', 'android-vis-r1023-lv2-1.json')).toBe(false);
    expect(isReplayed("it.each([['a-1.json', 1]] as const)('%s', (record) => { readLiveRecord(record); });", 'a-1.json')).toBe(false);
    expect(isReplayed("it.each([['a-1.json', 1]] as const)('%s', async (record, want) => { await rejudgeInProcess(record, 'forms'); });", 'a-1.json')).toBe(true);
    expect(isReplayed("it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });", 'a-1.json')).toBe(true);
    expect(isReplayed("it('x', async () => { await rejudgeCli('a-1.json', 'forms'); });", 'a-1.json')).toBe(true);
    const template = 'it.each([1, 2])(\'x\', async (n) => { await rejudgeInProcess(`lv2-${n}.json`, \'visibility\'); });';
    expect(isReplayed(template, 'lv2-7.json')).toBe(true);
    expect(isReplayed(template, 'lv2-group.json')).toBe(false);
  });

  // T3's review round 3: what a text match took for a row.
  const table = (rows: string) => `it.each([\n${rows}\n] as const)('%s', async (record, want) => {\n  await rejudgeInProcess(record, 'forms');\n});`;
  it('a row commented out names nothing: `//` (b4) or `/* */` (b5); nor a rejudge call commented out', () => {
    const b4 = table("  // ['a-1.json', 'forms', { cases: 1 }],\n  ['b-1.json', 'forms', { cases: 1 }],");
    expect(isReplayed(b4, 'a-1.json')).toBe(false);
    expect(isReplayed(b4, 'b-1.json')).toBe(true);
    const b5 = table("  /* ['a-1.json', 'forms'],\n  ['c-1.json', 'forms'], */\n  ['b-1.json', 'forms'],");
    expect(isReplayed(b5, 'a-1.json')).toBe(false);
    expect(isReplayed(b5, 'c-1.json')).toBe(false);
    expect(isReplayed(b5, 'b-1.json')).toBe(true);
    expect(isReplayed("it('x', async () => {\n  // await rejudgeInProcess('a-1.json', 'forms');\n});", 'a-1.json')).toBe(false);
  });

  it('an expression-body table that feeds no rejudge names nothing, though a rejudging block follows it (d1)', () => {
    const d1 = "it.each([['a-1.json']] as const)('%s', (r) => expect(r).toBeDefined());\nit('x', async (record) => { await rejudgeInProcess(record, 'forms'); });\n" + table("  ['b-1.json', 'forms'],");
    expect(isReplayed(d1, 'a-1.json')).toBe(false);
    expect(isReplayed(d1, 'b-1.json')).toBe(true);
  });

  // T3's review round 4: a skipped or todo call runs no rejudge.
  it.each([
    ['describe.skip (e1)', "describe.skip('d', () => {\n  it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });\n});"],
    ['it.skip (e2)', "it.skip('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });"],
    ['test.skip', "test.skip('x', async () => { await rejudgeCli('a-1.json', 'forms'); });"],
    ['it.skip.each', "it.skip.each([['a-1.json']] as const)('%s', async (record) => { await rejudgeInProcess(record, 'forms'); });"],
    ['describe.skip.each', "describe.skip.each([['a-1.json']] as const)('%s', (record) => {\n  it('x', async () => { await rejudgeInProcess(record, 'forms'); });\n});"],
    ['describe.todo', "describe.todo('d', () => {\n  it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });\n});"],
    ['it.todo', "it.todo('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });"],
    ['{ skip: true } on it', "it('x', { skip: true }, async () => { await rejudgeInProcess('a-1.json', 'forms'); });"],
    ['{ skip: true } on an it.each', "it.each([['a-1.json']] as const)('%s', { timeout: 1, skip: true }, async (record) => { await rejudgeInProcess(record, 'forms'); });"],
    ['{ skip: true } on describe', "describe('d', { skip: true }, () => {\n  it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });\n});"],
  ] as const)('a rejudge under %s names nothing', (_, src) => {
    expect(isReplayed(src, 'a-1.json')).toBe(false);
  });

  it('…while the same calls not skipped do, `{ skip: false }` included', () => {
    expect(isReplayed("describe('d', () => {\n  it('x', async () => { await rejudgeInProcess('a-1.json', 'forms'); });\n});", 'a-1.json')).toBe(true);
    expect(isReplayed("it('x', { skip: false, timeout: 1 }, async () => { await rejudgeInProcess('a-1.json', 'forms'); });", 'a-1.json')).toBe(true);
    expect(isReplayed("it.each([['a-1.json']] as const)('%s', { timeout: 1 }, async (record) => { await rejudgeInProcess(record, 'forms'); });", 'a-1.json')).toBe(true);
  });

  it('a row that names its record by a path names the record (its last part), as a direct call does', () => {
    expect(isReplayed(table("  ['docs/truth/live-records/a-1.json', 'forms'],"), 'a-1.json')).toBe(true);
  });

  it('a row spread over lines, or a bare string row, still names its record (b3)', () => {
    const b3 = table("  [\n    'a-1.json',\n    'forms',\n    { cases: 1 },\n  ],\n  'b-1.json',");
    expect(isReplayed(b3, 'a-1.json')).toBe(true);
    expect(isReplayed(b3, 'b-1.json')).toBe(true);
    expect(isReplayed(withoutRow(b3, 'a-1.json'), 'a-1.json')).toBe(false);
    expect(isReplayed(withoutRow(b3, 'a-1.json'), 'b-1.json')).toBe(true);
  });
});
