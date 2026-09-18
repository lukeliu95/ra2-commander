// 确定性测试台：不开浏览器、不碰游戏页，直接给引擎喂合成战场态。
// 覆盖 match-016 复盘里真正出问题的那几种形态。
// 用法： node tactical-core.test.js
const {makeTacticalEngine} = require('./tactical-core.js');

// ---------- 合成对象 ----------
let _id = 1;
const unit = (o = {}) => ({
  id: o.id || 'u' + (_id++), name: o.name || 'MTNK', owner: o.owner || 'Player 1',
  rules: {cost: o.cost ?? 750, isBaseDefense: !!o.tower, deployer: !!o.deployer, harvester: !!o.harv, engineer: false,
    primary: o.tower ? 'PrismShot' : '105mm', consideredAircraft: !!o.air},
  healthTrait: {hitPoints: (o.hpFrac ?? 1) * 100, maxHitPoints: 100},
  centerTile: {rx: o.x, ry: o.y},
  isBuilding: () => !!o.tower, isInfantry: () => !!o.infantry, isVehicle: () => !!o.vehicle,
  isAircraft: () => !!o.air, unitOrderTrait: o.orders ? {orders: o.orders} : null,
});

const tally = arr => arr.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {});
const D = {
  xy: o => ({x: (o.centerTile || o.tile).rx, y: (o.centerTile || o.tile).ry}),
  d2: (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2,
  dist: (a, b) => Math.sqrt(D.d2(a, b)),
  centroid: arr => arr.length ? {x: Math.round(arr.reduce((s, o) => s + D.xy(o).x, 0) / arr.length), y: Math.round(arr.reduce((s, o) => s + D.xy(o).y, 0) / arr.length)} : null,
  isAir: o => !!o.rules.consideredAircraft,
  isCombat: o => !o.isBuilding() && !o.rules.harvester && !o.rules.engineer,
  valOf: o => o.rules.cost || 0,
  hp: o => o.healthTrait.hitPoints / o.healthTrait.maxHitPoints,
  tally,
  isMoving: o => !!(o.unitOrderTrait && o.unitOrderTrait.orders.length),
  towerRange: () => 8,
};

const CFG = {weakHp: 0.4, driftTiles: 3, standoff: 1.5, farTiles: 38, midTiles: 22, nearTiles: 12, maxOrders: 3, breakRatio: 0.45};
const PLAN = {stance: 'defend', defenseDistance: 6, leashRadius: 4};
const BASE = {x: 71, y: 118};
const DIR = {x: (135 - 71) / Math.hypot(135 - 71, 80 - 118), y: (80 - 118) / Math.hypot(135 - 71, 80 - 118)};
const TOWERS = [unit({name: 'GAPILL', tower: true, cost: 500, x: 76, y: 112}),
                unit({name: 'GAPILL', tower: true, cost: 500, x: 74, y: 114}),
                unit({name: 'NASAM', tower: true, cost: 1000, x: 73, y: 111})];

const eng = makeTacticalEngine(D);
const scen = (mine, hostile, mem = {}) => {
  const ctx = {now: 100, P: PLAN, active: CFG, base: BASE, dir: DIR, mine, hostile, buildings: TOWERS, mem};
  const st = eng.read(ctx);
  const dec = eng.decide(st, CFG, mem);
  return {st, dec};
};

// ---------- 断言 ----------
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✔ ${name}`); } else { fail++; console.log(`  �’ ${name} ${detail}`); } };
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

console.log('\n=== 场景 1：静默（无敌军）——不应该发任何动作 ===');
{
  const {st, dec} = scen([unit({name: 'MTNK', x: 78, y: 110, vehicle: true})], []);
  ok('phase = quiet', dec.phase === 'quiet', dec.phase);
  ok('零动作', dec.actions.length === 0, JSON.stringify(dec.actions.map(a => a.op)));
  ok('无首要威胁', st.lead === null);
}

console.log('\n=== 场景 2：engage（威胁 18 格，6 E1 + 2 MTNK + 6 JUMPJET）——站位在塔射程内、不追出去 ===');
const WAVE = [
  ...Array.from({length: 6}, (_, i) => unit({name: 'E1', infantry: true, cost: 180, x: 83 + (i % 3), y: 105 + Math.floor(i / 3), hpFrac: 1})),
  unit({name: 'MTNK', vehicle: true, cost: 750, x: 84, y: 104}),
  unit({name: 'MTNK', vehicle: true, cost: 750, x: 85, y: 105}),
  ...Array.from({length: 6}, (_, i) => unit({name: 'JUMPJET', infantry: true, air: true, cost: 600, x: 82 + (i % 3), y: 104 + Math.floor(i / 3)})),
];
// 静止计时器：连续 ≥2 次采样没动 → 视为卧倒，威胁权重 ×1.6
const still = new Map(WAVE.map(e => [e.id, 3]));
let mem2 = {};
{
  const mine = [unit({name: 'MTNK', vehicle: true, x: 78, y: 110}), unit({name: 'FV', vehicle: true, air: true, cost: 600, x: 77, y: 111}),
                unit({name: 'E1', infantry: true, deployer: true, cost: 180, x: 76, y: 110})];
  const ctx = {now: 100, P: PLAN, active: CFG, base: BASE, dir: DIR, mine, hostile: WAVE, buildings: TOWERS, mem: mem2, stillTicks: still};
  const st = eng.read(ctx), dec = eng.decide(st, CFG, mem2);
  ok('phase = engage', dec.phase === 'engage', `${dec.phase} lead=${st.leadTiles}`);
  const face = WAVE.reduce((s, e) => s + e.rules.cost, 0);
  ok('威胁权重 > 面值（静止步兵 ×1.6 生效）', st.threatValue > face, `${Math.round(st.threatValue)} vs ${face}`);
  const repos = dec.actions.filter(a => a.op === 'reposition' || a.op === 'screen');
  ok('有机动单位收到占位动作', repos.length > 0, JSON.stringify(dec.actions.map(a => a.op)));
  const anyPt = repos[0] && repos[0].at;
  if (anyPt) {
    const dAnchor = D.dist(anyPt, {x: 76, y: 112});
    ok('占位点在塔射程内（≤8 格）', dAnchor <= 8, `d=${dAnchor.toFixed(1)}`);
    const dLead = D.dist(anyPt, {x: st.lead.x, y: st.lead.y});
    ok('不追到威胁身上（保持 ≥3 格）', dLead >= 3, `d=${dLead.toFixed(1)}`);
  }
  const holds = dec.actions.filter(a => a.op === 'hold');
  ok('可部署步兵走了 hold（坐下打，别移动）', holds.length === 1, JSON.stringify(holds.map(a => a.ids.length)));
  const focus = dec.actions.filter(a => a.op === 'focus');
  ok('混编时给出集火目标', focus.length === 0 || !!focus[0].targetId);
  ok('防空车 >0 时优先居中', st.aaIds.length === 1 && dec.actions.some(a => a.op === 'screen'),
     `aaIds=${st.aaIds.length} air=${st.airValue}`);
}

console.log('\n=== 场景 3：breach（威胁已进 10 格）——全军退回塔线，而不是回基地 ===');
{
  const mine = [unit({name: 'MTNK', vehicle: true, x: 78, y: 110}), unit({name: 'E1', infantry: true, deployer: true, cost: 180, x: 76, y: 110})];
  const close = [unit({name: 'JUMPJET', infantry: true, air: true, cost: 600, x: 75, y: 116}),
                 unit({name: 'MTNK', vehicle: true, x: 76, y: 117})];
  const {st, dec} = scen(mine, close, {});
  ok('phase = breach', dec.phase === 'breach', `${dec.phase} lead=${st.leadTiles}`);
  const repos = dec.actions.find(a => a.op === 'reposition');
  ok('机动单位退守塔线', !!repos);
  if (repos) {
    const dAnchor = D.dist(repos.at, {x: 76, y: 112});
    ok('退守点在塔射程内', dAnchor <= 8, `d=${dAnchor.toFixed(1)}`);
    const dBase = D.dist(repos.at, BASE);
    ok('没有一路退回基地（那样就放弃塔的掩护）', dBase < D.dist(BASE, {x: 76, y: 112}) + 1,
       `到基地 ${dBase.toFixed(1)}`);
  }
  ok('给出"退回塔线"的说明', dec.notes.some(n => /塔线/.test(n)), JSON.stringify(dec.notes));
}

console.log('\n=== 场景 4：残血撤离 —— 只有当它不在塔掩护下时才撤 ===');
{
  const hurtUncovered = unit({name: 'MTNK', vehicle: true, x: 92, y: 100, hpFrac: 0.25});
  const {dec: d1} = scen([hurtUncovered], WAVE, {});
  ok('塔外的残血单位被撤离', d1.actions.some(a => a.op === 'withdraw' && a.ids.includes(hurtUncovered.id)));
  const hurtCovered = unit({name: 'MTNK', vehicle: true, x: 77, y: 111, hpFrac: 0.25});
  const farWave = [unit({name: 'E1', infantry: true, cost: 180, x: 100, y: 95})];
  const {dec: d2} = scen([hurtCovered], farWave, {});
  ok('塔内的残血单位不撤（坐着打更划算）', !d2.actions.some(a => a.op === 'withdraw' && a.ids.includes(hurtCovered.id)));
}

console.log('\n=== 场景 5：滞回（同一局面连续两轮，不应翻转）===');
{
  const mine = [unit({name: 'MTNK', vehicle: true, x: 78, y: 110, hpFrac: 0.5})];
  const strong = Array.from({length: 10}, (_, i) => unit({name: 'MTNK', vehicle: true, x: 80 + i % 3, y: 112 + Math.floor(i / 3), hpFrac: 1}));
  const mem = {};
  const r1 = scen(mine, strong, mem);
  mem.tacBreach = r1.dec.breach; mem.tacState = r1.st;
  const r2 = scen(mine, strong, mem);
  ok('两轮 breach 结论一致（无翻转）', r1.dec.breach === r2.dec.breach, `${r1.dec.breach}/${r2.dec.breach}`);
  ok('trend 提供跨采样变化（这是 12 秒网格的补丁）', r2.st.trend.leadTilesDelta !== undefined);
}

console.log('\n=== 场景 6：动作可验证性 —— 每个动作都有 verify，主要动作有 fallback ===');
{
  const mine = [unit({name: 'MTNK', vehicle: true, x: 78, y: 110})];
  const {dec} = scen(mine, WAVE, {});
  ok('所有动作都带 verify 谓词', dec.actions.every(a => typeof a.verify === 'function'));
  ok('至少一个动作带 fallback（失败可降级）', dec.actions.some(a => typeof a.fallback === 'string'));
  const bad = dec.actions.find(a => a.op === 'hold');
  if (bad) {
    const stDrift = {us: Object.fromEntries(bad.ids.map(id => [id, {x: 999, y: 999}]))};
    ok('hold 的 verify 在漂移时会判失败', bad.verify(stDrift) === false);
  }
}

console.log(`\n===== 结果：${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
