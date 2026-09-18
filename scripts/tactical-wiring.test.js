// 接线测试：验证 runtime.js 里新加的那条链——读 → 判 → 打 → 回读 → 降级。
// 纯核心测试（tactical-core.test.js）证明"判断对"；这里证明"接线通"，尤其回读失败能真的降级。
// 用法： node tactical-wiring.test.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const runtime = fs.readFileSync(path.join(__dirname, 'runtime.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${detail}`); }
};

console.log('\n=== 静态检查 ===');
const ctx = {console: {info() {}, warn() {}, error() {}}, localStorage: {getItem: () => null, setItem() {}},
  JSON, Math, Object, Array, Map, Set, Number, String, Boolean, Date, isNaN, parseFloat, parseInt};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
try {
  vm.runInContext(runtime + '\n;globalThis.__RT__ = ra2Runtime;', ctx);
  ok('runtime.js 在 vm 里求值成功（无引用错误）', typeof ctx.__RT__ === 'function');
} catch (e) {
  ok('runtime.js 在 vm 里求值成功', false, String(e));
  console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
  process.exit(1);
}

const grabFn = (name) => {
  const i = runtime.indexOf(`function ${name}(`);
  if (i < 0) return null;
  let d = 0, started = false;
  for (let j = i; j < runtime.length; j++) {
    if (runtime[j] === '{') { d++; started = true; }
    else if (runtime[j] === '}') { d--; if (started && d === 0) return runtime.slice(i, j + 1); }
  }
  return null;
};
const want = ['tacRefresh', 'tacDo', 'tacticalTick'];
const fns = want.map(grabFn);
ok(`新函数 ${want.join('/')} 都存在`, fns.every(Boolean), want.filter((_, i) => !fns[i]).join(','));

const coreBlock = runtime.slice(runtime.indexOf('// ===== TACTICAL_CORE_BEGIN'),
                                runtime.indexOf('// ===== TACTICAL_CORE_END'));
// 接口必须真的挂在 C 上（start() 里），否则 agent 根本调不到——用文本断言，避免为它搭一整套假 game
const apiDeclared = ['C.tacRead = ', 'C.tacAct = ', "every('tactical'"].every(k => runtime.includes(k));
ok('C.tacRead / C.tacAct 已挂到对外接口，且 tick 里挂了 tacticalTick', apiDeclared);
const tickWired = /if \(C\.plan\.tacticalMode && every\('tactical'/.test(runtime);
ok('tacticalTick 只在 tacticalMode 开启时运行（默认零影响）', tickWired);
ok('宏逻辑有抑制窗口（tacHolding 仲裁）', runtime.includes('const tacHolding = P.tacticalMode'));

const orders = [];
const logs = [];
const mkUnit = (o) => ({
  id: o.id, name: o.name, isDestroyed: false,
  rules: {cost: o.cost ?? 750, isBaseDefense: !!o.tower, deployer: !!o.deployer, harvester: false, engineer: false, consideredAircraft: !!o.air},
  healthTrait: {hitPoints: (o.hp ?? 1) * 100, maxHitPoints: 100},
  centerTile: {rx: o.x, ry: o.y},
  isBuilding: () => !!o.tower, isInfantry: () => !!o.infantry, isVehicle: () => !!o.vehicle,
  isAircraft: () => !!o.air, zone: o.air ? 1 : 0, unitOrderTrait: null,
});
const mine = [mkUnit({id: 'm1', name: 'MTNK', vehicle: true, x: 78, y: 110}),
              mkUnit({id: 'm2', name: 'FV', vehicle: true, air: true, cost: 600, x: 77, y: 111}),
              mkUnit({id: 'm3', name: 'E1', infantry: true, deployer: true, cost: 180, x: 76, y: 110})];
const towers = [mkUnit({id: 't1', name: 'GAPILL', tower: true, cost: 500, x: 76, y: 112}),
                mkUnit({id: 't2', name: 'NASAM', tower: true, cost: 1000, x: 73, y: 111})];
const wave = [];
for (let i = 0; i < 6; i++) wave.push(mkUnit({id: 'e' + i, name: 'E1', infantry: true, cost: 180, x: 83 + (i % 3), y: 105 + Math.floor(i / 3)}));
for (let i = 0; i < 4; i++) wave.push(mkUnit({id: 'j' + i, name: 'JUMPJET', infantry: true, air: true, cost: 600, x: 82 + (i % 2), y: 104 + Math.floor(i / 2)}));

const sandbox = {...ctx, __orders: orders, __logs: logs, __mine: mine, __towers: towers, __wave: wave, __now: 100};
sandbox.__objById = new Map((mine.concat(towers, wave)).map(u => [u.id, u]));
sandbox.window = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

const probe = `
(() => {
  const {__orders, __logs, __mine, __towers, __wave} = globalThis;
  const C = {state: () => ({mine: __mine, buildings: __towers, hostile: __wave}),
    plan: {stance: 'defend', defenseDistance: 6, tacticalMode: true, tacticalInterval: 3,
           tacticalMaxOrders: 3, tacticalSuppressSec: 4, tacticalBreakRatio: 0.45}};
  const M = {tacState: null, tacActions: [], tacAt: 0, tacBreach: false, suppressedUntil: 0,
             tacVerified: [], tacFailed: 0, stillTicks: new Map(), lastOrder: new Map()};
  const sec = () => globalThis.__now;
  const log = (kind, msg) => __logs.push(kind + ': ' + msg);
  const every = () => true;
  const my = {orderUnits: (ids, type, x, y) => __orders.push({ids: ids.slice(), type, x, y})};
  const fmt = s => String(s);
  const ORD = {Move: 0, Attack: 2, AttackMove: 4, DeploySelected: 10};
  const baseCenter = () => ({x: 71, y: 118});   // tacRefresh 直接调用这两个
  const enemyDir = () => ({x: 0.86, y: -0.51});
  const towerRangeAt = () => 8;
  const obj = id => globalThis.__objById.get(id) || null;   // tacDo 用它取单位对象
  const dep = {
    xy: o => ({x: (o.centerTile || o.tile).rx, y: (o.centerTile || o.tile).ry}),
    d2: (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2,
    dist: (a, b) => Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2),
    centroid: arr => arr.length ? {x: Math.round(arr.reduce((s, o) => s + (o.centerTile || o.tile).rx, 0) / arr.length),
                                  y: Math.round(arr.reduce((s, o) => s + (o.centerTile || o.tile).ry, 0) / arr.length)} : null,
    tally: arr => arr.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {}),
    hp: o => o.healthTrait.hitPoints / o.healthTrait.maxHitPoints,
    isAir: o => !!(o.rules.consideredAircraft || (o.isAircraft && o.isAircraft()) || o.zone === 1),
    isCombat: o => !o.isBuilding() && !o.rules.harvester && !o.rules.engineer,
    valOf: o => o.rules.cost || 0,
    isMoving: () => false,
    towerRange: () => 8,
  };
  __CORE_BLOCK__
  __TAC_FNS__
  const TAC = makeTacticalEngine(dep);
  const tacCfg = () => ({weakHp: 0.4, driftTiles: 3, standoff: 1.5, minGapToThreat: 4,
    farTiles: 38, midTiles: 22, nearTiles: 12, maxOrders: 3, breakRatio: 0.45});
  return {tacRefresh, tacDo, tacticalTick, C, M};
})()
`;
const src = probe.replace('__CORE_BLOCK__', coreBlock).replace('__TAC_FNS__', fns.join('\n\n'));

console.log('\n=== 闭环：读 → 判 → 打 → 回读失败 → 降级 ===');
let bound = null, err = null;
try { bound = vm.runInContext(src, sandbox); } catch (e) { err = String(e); }
ok('新块可在沙箱里求值（tacRefresh/tacDo/tacticalTick 自洽）', !!bound, err || '');

if (bound) {
  const {tacRefresh, tacticalTick} = bound;
  const S = () => ({mine, buildings: towers, hostile: wave});

  const st = tacRefresh(S());
  ok('tacRefresh 产出战场态', !!st && !!st.lead, st && `leadTiles=${st.leadTiles}`);
  ok('战场态挂到 M.tacState（供 trend 用）', bound.M.tacState === st);
  ok('威胁进入接火档', st.lead && st.lead.distToBase <= 22, st.lead && `d=${st.lead.distToBase}`);

  orders.length = 0;
  tacticalTick(null);
  ok('tacticalTick 下发了真实指令', orders.length > 0, `orders=${orders.length}`);
  ok('指令用 Attack(2)/AttackMove(4)，不是裸 Move', orders.every(o => o.type === 2 || o.type === 4),
     JSON.stringify(orders.map(o => o.type)));
  ok('开了抑制窗口（宏逻辑会让位）', bound.M.suppressedUntil > 100, `until=${bound.M.suppressedUntil}`);
  ok('留下可审计的 tac 日志', logs.some(l => /tac\[/.test(l)), JSON.stringify(logs.slice(0, 1)));

  console.log('\n=== 回读与降级（这次改造的核心：动作必须被验证）===');
  const ledger = bound.M.tacActions;
  ok('动作账本记录了本轮动作', ledger.length > 0, JSON.stringify(ledger.map(a => a.op)));
  const holdAct = ledger.find(a => a.op === 'hold' || a.op === 'reposition');
  ok('存在可漂移验证的动作（hold/reposition）', !!holdAct, JSON.stringify(ledger.map(a => a.op)));

  if (holdAct) {
    for (const u of mine) if (holdAct.ids.includes(u.id) && holdAct.at) u.centerTile = {rx: holdAct.at.x, ry: holdAct.at.y};
    tacRefresh(S());
    ok('单位就位后回读判通过（failed 不增长）', bound.M.tacFailed === 0, `failed=${bound.M.tacFailed}`);

    const before = bound.M.tacFailed;
    for (const u of mine) if (holdAct.ids.includes(u.id)) u.centerTile = {rx: u.centerTile.rx + 9, ry: u.centerTile.ry + 9};
    orders.length = 0;
    tacRefresh(S());
    ok('漂移后回读判失败并计数（闭环真的在工作）', bound.M.tacFailed > before,
       `before=${before} after=${bound.M.tacFailed}`);
    ok('失败后走了降级路径（重下指令或留下降级日志）',
       orders.length > 0 || logs.some(l => /降级|回读失败/.test(l)),
       `orders=${orders.length} logs=${JSON.stringify(logs.filter(l => /降级|回读失败/.test(l)))}`);
  }
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
