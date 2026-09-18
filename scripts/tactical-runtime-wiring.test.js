#!/usr/bin/env node
// Static wiring guard for the inlined tactical core in runtime.js.
//
// Why this exists: match-017 started with tacticalMode enabled and threw
// "TAC is not defined" every three seconds. The pure-logic suite passed (22/22)
// and the harness suite passed (18/18), because both build their own engine via
// the factory — neither of them ever looks at how runtime.js is wired. The
// inlined core had shipped without its `const TAC = makeTacticalEngine({...})`
// line, and the two mistakes that caused it are both statically detectable:
//
//   1. The instantiation was written *inside* the TACTICAL_CORE block, so the
//      patch script's idempotent branch (which replaces that whole block with
//      the latest core source) silently deleted it.
//   2. It passed `towerRange: p => towerRangeAt(p)`, but towerRangeAt is a
//      local of army() and is not in scope where the engine is constructed.
//
// So this file asserts the three properties the page actually needs: the
// instantiation exists exactly once, it sits outside the core block, and every
// identifier it receives is declared before it (the deps are consts, so being
// early is a TDZ error, not a warning).

const fs = require('node:fs');
const path = require('node:path');

const RUNTIME = path.join(__dirname, 'runtime.js');
const src = fs.readFileSync(RUNTIME, 'utf8');
const lines = src.split('\n');

let pass = 0;
const failures = [];
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { failures.push(name + (detail ? ' — ' + detail : '')); console.log('  ✘ ' + name + (detail ? ' — ' + detail : '')); }
};
const lineOf = (needle, from = 0) => {
  for (let i = from; i < lines.length; i++) if (lines[i].includes(needle)) return i;
  return -1;
};
const countOf = needle => lines.filter(l => l.includes(needle)).length;

console.log('== tactical runtime wiring ==');

// --- 1. the instantiation exists, exactly once, and is its own idempotent block
const inst = lineOf('const TAC = makeTacticalEngine(');
ok('TAC is instantiated', inst >= 0);
ok('TAC is instantiated exactly once', countOf('const TAC = makeTacticalEngine(') === 1,
   'found ' + countOf('const TAC = makeTacticalEngine('));
ok('the TAC block is unique', countOf('TACTICAL_TAC_BEGIN') === 1 && countOf('TACTICAL_TAC_END') === 1);

// --- 2. it must live outside the TACTICAL_CORE block, or a core resync deletes it
const coreBegin = lineOf('TACTICAL_CORE_BEGIN');
const coreEnd = lineOf('TACTICAL_CORE_END');
ok('TAC is not inside the TACTICAL_CORE block', inst > coreEnd,
   'instantiation at line ' + (inst + 1) + ', core block ends at ' + (coreEnd + 1));

// --- 3. every consumer must come after it (a use before init cannot work)
const consumers = [];
lines.forEach((l, i) => { if (/\bTAC\.(read|decide|actions)\b/.test(l)) consumers.push(i); });
ok('there are consumers of TAC', consumers.length > 0);
ok('every TAC consumer is after the instantiation', consumers.every(i => i > inst),
   'first consumer line ' + (consumers[0] + 1));

// --- 4. every dependency handed to the factory must already be declared (TDZ guard)
const call = src.slice(src.indexOf('const TAC = makeTacticalEngine('));
const argBlock = call.slice(call.indexOf('{') + 1, call.indexOf('});'));
const parts = argBlock.split('\n').map(s => s.trim()).filter(Boolean).join(' ').split(',');
const bareDeps = [];        // shorthand `xy,` — must resolve to an earlier const/function
const keyedDeps = [];       // `valOf: o => ...` — self-contained, nothing to resolve
for (const raw of parts) {
  const t = raw.trim();
  if (!t) continue;
  const keyed = t.match(/^([A-Za-z_$][\w$]*)\s*:\s*(.+)$/);
  if (keyed) { keyedDeps.push(keyed[1]); continue; }
  const bare = t.match(/^([A-Za-z_$][\w$]*)$/);
  if (bare) bareDeps.push(bare[1]);
}
ok('the factory receives dependencies', bareDeps.length + keyedDeps.length >= 5,
   'bare=[' + bareDeps.join(',') + '] keyed=[' + keyedDeps.join(',') + ']');
ok('the factory receives the geometry helpers', ['xy', 'd2', 'dist'].every(n => bareDeps.includes(n)),
   bareDeps.join(','));

const missing = [];
const late = [];
for (const name of bareDeps) {
  const decl = lineOf('const ' + name + ' =');
  const fnDecl = lineOf('function ' + name + '(');
  const at = decl >= 0 ? decl : fnDecl;
  if (at < 0) missing.push(name);
  else if (at > inst) late.push(name + '(line ' + (at + 1) + ')');
}
ok('every dependency is declared in scope', missing.length === 0, 'missing: ' + missing.join(','));
ok('every dependency is declared before the factory call', late.length === 0, 'late (TDZ): ' + late.join(','));

// --- 5. no reference to the army()-local helper that caused the second bug.
// Comments are stripped first: the block deliberately quotes the old broken line while explaining it.
const codeOnly = src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
ok('towerRange does not reach for army() locals', !/towerRange:\s*p\s*=>\s*towerRangeAt\(/.test(codeOnly));
ok('towerRange is provided to the factory', keyedDeps.includes('towerRange') || bareDeps.includes('towerRange'));

console.log('\n===== 结果：' + pass + ' 通过 / ' + failures.length + ' 失败 =====');
if (failures.length) process.exit(1);
