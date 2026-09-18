// ra2-commander tactical core: 查打一体（recon-strike loop）的纯逻辑部分。
// 由 runtime.js 以 `tacticalCore` 注入运行期依赖（打包时 inline 展开）。
// 设计约束（来自 match-016 复盘）：
//   1) 执行层已经每 0.8s 跑一次 army()，但只有 31 条手写 if-then；本模块把"判断"从规则里拆出来，
//      让主 agent 或反射两条路都能读同一份战场态、下同一组动作。
//   2) 情报快照是 12 秒网格，而决定性交火只有 9 秒 —— 所以动作必须闭环：下达后回读、失败即降级重试。
//   3) 动作不得覆盖彼此：同一单位同一轮只受一条指令；宏逻辑（army/siege）被抑制窗口让位。
const DEFAULT_ACTIVE = {
  // 单位状态判定阈值
  weakHp: 0.4,          // 血量低于此值 → 优先撤离/后置
  driftTiles: 3,        // 执行 Hold 后漂移超过此格 → 判定指令失效，重下
  minGapToThreat: 4,    // 占位点与首要威胁的最小间距：宁可在塔射程内沿，也不跟它贴身换血
  // 交火几何
  standoff: 1.5,        // 站在"塔射程 - 1.5 格"处，避免质心取整把单位卡到射程外
  minTowerGap: 0,       // 留白，便于以后按阵营调
  // 威胁分档（以"首要威胁到我方基地的距离"计）
  farTiles: 38, midTiles: 22, nearTiles: 12,
  // 压制窗口：下达动作后抑制宏逻辑的秒数
  suppressSec: 4,
  // 每次刷新最多下几条动作
  maxOrders: 3,
  // 撤退阈值：我方部队价值 / 交出时的价值
  breakRatio: 0.45,
};

function makeTacticalEngine(D) {
  const {d2, dist, centroid, sideOf, isAir, isCombat, valOf} = D;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const round1 = v => Math.round(v * 10) / 10;
  // 只接受 {x,y} 的质心（D.centroid 吃的是游戏对象，不能混用）
  const centroidOf = pts => pts.length
    ? {x: Math.round(pts.reduce((s, p) => s + p.x, 0) / pts.length), y: Math.round(pts.reduce((s, p) => s + p.y, 0) / pts.length)}
    : null;

  // ---- 动作构造：每个动作都带 verify 谓词与 fallback，闭环在此定义 ----
  // 注意：verify 只能从传入的 st（战场态）取值，绝不引用 read() 的局部变量——否则会静默抛错，
  // 而 tacRefresh 的 try/catch 会把抛错当"通过"，闭环就变成摆设（本仓库第一次跑接线测试时真的踩了）。
  const actCfg = {...DEFAULT_ACTIVE};
  const driftOf = st => (st && st.cfg ? st.cfg.driftTiles : actCfg.driftTiles);
  const A = {
    hold: (ids, at) => ({op: 'hold', ids, at, why: `据守在塔射程内的 (${at.x},${at.y})，不追出防线`,
      verify: (st) => ids.filter(id => { const u = st.us[id]; return u && dist(u, at) > driftOf(st); }).length <= Math.floor(ids.length / 2),
      fallback: 'reposition'}),
    focus: (ids, targetId) => ({op: 'focus', ids, targetId, why: `集火 ${targetId}`,
      verify: (st) => !!st.enemies[targetId],
      fallback: 'hold'}),
    reposition: (ids, at) => ({op: 'reposition', ids, at, why: `转进到 (${at.x},${at.y})`,
      verify: (st) => ids.filter(id => { const u = st.us[id]; return u && dist(u, at) > driftOf(st); }).length <= Math.floor(ids.length / 2),
      fallback: 'hold'}),
    withdraw: (ids, at) => ({op: 'withdraw', ids, at, why: `残血单位撤到 (${at.x},${at.y}) 后方`,
      verify: (st) => ids.some(id => st.us[id] && dist(st.us[id], st.base) <= dist(at, st.base) + 2),
      fallback: null}),
    screen: (ids, at) => ({op: 'screen', ids, at, why: `防空车居中占位 (${at.x},${at.y})，避免贴边被点`,
      verify: (st) => ids.some(id => st.us[id] && dist(st.us[id], at) <= driftOf(st) + 2),
      fallback: 'hold'}),
    reinforce: (ids, at) => ({op: 'reinforce', ids, at, why: `逐辆补进塔线 (${at.x},${at.y})，不等齐`,
      verify: (st) => ids.some(id => st.us[id] && dist(st.us[id], at) <= 6), fallback: null}),
  };

  // ---- 战场态：每次刷新都重建并保留上一轮，供"变化率"判断 ----
  function read(ctx) {
    const now = ctx.now, P = ctx.P, cfg = {...DEFAULT_ACTIVE, ...(ctx.active || {})};
    const mine = ctx.mine.filter(isCombat);
    const enemies = ctx.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
    const towers = ctx.buildings.filter(b => b.rules.isBaseDefense);
    const base = ctx.base;

    const us = {};
    let myValue = 0, weakIds = [], immobile = [], mobile = [], aaIds = [];
    for (const u of mine) {
      const p = D.xy(u), h = D.hp(u), v = valOf(u);
      myValue += v;
      us[u.id] = {id: u.id, name: u.name, x: p.x, y: p.y, hp: round1(h), value: v,
        air: !!isAir(u), immobile: !!u.rules.deployer, moving: D.isMoving(u)};
      if (h < cfg.weakHp) weakIds.push(u.id);
      if (u.rules.deployer) immobile.push(u.id); else mobile.push(u.id);
      if (isAir(u) && u.isVehicle && u.isVehicle()) aaIds.push(u.id);
    }

    const enemyList = [];
    let threatValue = 0, airValue = 0, heavyValue = 0;
    for (const e of enemies) {
      const p = D.xy(e), c = valOf(e), air = !!isAir(e);
      const ti = ctx.stillTicks ? (ctx.stillTicks.get(e.id) || 0) : 0;
      const mult = (e.isInfantry && e.isInfantry() && ti >= 2) ? 1.6 : 1;  // T-022：静止步兵通常是卧倒的
      const w = c * mult, d = Math.round(dist(p, base));
      enemyList.push({id: e.id, name: e.name, x: p.x, y: p.y, value: c, weighted: Math.round(w),
        air, distToBase: d, trench: ti >= 2});
      threatValue += w; if (air) airValue += w; if (c >= 900) heavyValue += w;
    }
    enemyList.sort((a, b) => a.distToBase - b.distToBase);

    // 塔线：锚点取离"首要威胁"最近的塔，射程从 rules 实算
    const tc = centroidOf(enemyList.map(e => ({x: e.x, y: e.y})));
    const anchor = towers.length
      ? towers.map(D.xy).reduce((a, t) => (!a || (tc && d2(t, tc) < d2(a, tc))) ? t : a, null)
      : {x: Math.round(base.x + ctx.dir.x * (P.defenseDistance + 2)), y: Math.round(base.y + ctx.dir.y * (P.defenseDistance + 2))};
    const towerR = D.towerRange ? D.towerRange(anchor) : null;
    const reach = towerR || 8;
    const leadTiles = enemyList.length ? enemyList[0].distToBase : null;

    const st = {
      time: now, stance: P.stance, base, anchor, towerRange: towerR, cfg,
      us, enemies: Object.fromEntries(enemyList.map(e => [e.id, e])), enemyOrder: enemyList.map(e => e.id),
      lead: enemyList[0] || null, leadTiles, myValue, threatValue,
      ratio: myValue > 0 ? round1(threatValue / myValue) : null,
      byType: D.tally(enemyList.map(e => e.name)),
      airValue, heavyValue,
      weakIds, immobileIds: immobile, mobileIds: mobile, aaIds,
      towers: towers.map(b => ({...D.xy(b), name: b.name, hp: round1(D.hp(b))})),
      suppressedUntil: ctx.mem.suppressedUntil || 0,
    };
    // 变化率（cross-sample）：威胁是否在近、我方是否在掉血 —— 12 秒网格最大的坑在这里补
    const prev = ctx.mem.tacState;
    st.trend = {
      leadTilesDelta: (prev && prev.leadTiles != null && leadTiles != null) ? round1(leadTiles - prev.leadTiles) : null,
      threatDelta: prev ? Math.round(threatValue - prev.threatValue) : null,
      myValueDelta: prev ? Math.round(myValue - prev.myValue) : null,
    };
    return st;
  }

  // ---- 判断：分档 + 双阈值（滞回），避免阈值附近抖动 ----
  function decide(st, cfgIn, mem) {
    const cfg = {...DEFAULT_ACTIVE, ...(cfgIn || {})};
    const out = {phase: null, actions: [], notes: [], breach: false};
    const lead = st.lead;
    const ratio = st.ratio;
    const engaged = lead != null && lead.distToBase <= st.anchor ? true : false;

    // 撤退不是"每次都重新判定"：用滞回 —— 破线后要回到 breakRatio 之上才复位
    const wasBreach = !!mem.tacBreach;
    const breach = wasBreach
      ? (ratio != null && ratio > cfg.breakRatio * 0.8)   // 回到高出 20% 才解除
      : (ratio != null && ratio > 1 / cfg.breakRatio && st.myValue < 3000 && st.threatValue > st.myValue);
    out.breach = breach;
    out.breachCleared = wasBreach && !breach;

    if (!lead) { out.phase = 'quiet'; return out; }

    // 档位
    let phase;
    if (lead.distToBase <= cfg.nearTiles) phase = 'breach';
    else if (lead.distToBase <= cfg.midTiles) phase = 'engage';
    else if (lead.distToBase <= cfg.farTiles) phase = 'screen';
    else phase = 'quiet';
    out.phase = phase;

    // 塔内站位：从锚点朝威胁方向外推到塔射程内沿，但不能贴到威胁脸上。
    // 两个上界同时生效（match-016 场景：威胁 18 格时若只按射程外推会站到离敌 2.8 格——
    // 那是"在塔的射程里"却"在敌人的射程里"，等于用坦克换坦克，正是我们要避免的换血）。
    const dirFromAnchor = (() => {
      const dx = lead.x - st.anchor.x, dy = lead.y - st.anchor.y, L = Math.hypot(dx, dy) || 1;
      return {x: dx / L, y: dy / L};
    })();
    const anchorToLead = dist(st.anchor, lead);
    const standTiles = Math.max(2, Math.min((st.towerRange || 8) - cfg.standoff, anchorToLead - cfg.minGapToThreat));
    const holdPt = {
      x: Math.round(st.anchor.x + dirFromAnchor.x * standTiles),
      y: Math.round(st.anchor.y + dirFromAnchor.y * standTiles),
    };
    const backPt = {x: st.base.x, y: st.base.y};

    // 优先级 1：残血先撤（这是"打得过就打、打不过就留人"的最低成本动作）
    const weakOut = st.weakIds.filter(id => {
      const u = st.us[id];
      if (!u) return false;
      // 己方塔线覆盖下、且威胁还在塔射程外 → 不必撤，坐着打更好
      const covered = st.towers.some(t => dist(u, t) <= (st.towerRange || 8));
      return !(covered && lead.distToBase > cfg.midTiles);
    });
    if (weakOut.length && phase !== 'quiet') out.actions.push({...A.withdraw(weakOut, backPt), prio: 1});

    // 优先级 2：破线 → 全军退回塔内（不是回基地），用塔换血
    if (phase === 'breach') {
      const ids = st.mobileIds.filter(id => !weakOut.includes(id));
      if (ids.length) out.actions.push({...A.reposition(ids, holdPt), prio: 2});
      const imm = st.immobileIds.filter(id => !weakOut.includes(id));
      if (imm.length) out.actions.push({...A.hold(imm, holdPt), prio: 2});
      out.notes.push(`威胁已进 ${lead.distToBase} 格：退回塔线 ${st.towerRange || '?'} 射程内据守，不追出`);
      return out;
    }

    // 优先级 3：接火距离 → 防空车居中（贴着边缘会被逐个点掉），步兵据守
    if (phase === 'engage' || phase === 'screen') {
      if (st.aaIds.length && st.airValue > 0) out.actions.push({...A.screen(st.aaIds, holdPt), prio: 3});
      const imm = st.immobileIds.filter(id => !weakOut.includes(id));
      if (imm.length) out.actions.push({...A.hold(imm, holdPt), prio: 3});
      const mob = st.mobileIds.filter(id => !weakOut.includes(id) && !st.aaIds.includes(id));
      if (mob.length) out.actions.push({...A.reposition(mob, holdPt), prio: 3});
    }

    // 优先级 4：集火选择 —— 混合编队先点"能被塔打到的、价值最高的、血量最低的"
    if (phase !== 'quiet' && (st.airValue > 0 || st.heavyValue > 0)) {
      const cand = st.enemyOrder
        .map(id => st.enemies[id])
        .filter(e => e.distToBase <= (st.towerRange || 8) + 10)
        .sort((a, b) => (b.value - a.value) || (a.distToBase - b.distToBase));
      const shooterIds = [...st.mobileIds, ...st.aaIds].filter(id => st.us[id]);
      if (cand.length && shooterIds.length) out.actions.push({...A.focus(shooterIds, cand[0].id), prio: 4, targetName: cand[0].name});
    }

    // 优先级 5：无论哪档，塔线有缺口就逐辆补位（match-012 的"不要等齐"）
    if (st.mobileIds.length === 0 && st.myValue > 900) out.notes.push('我方可动机动力量为 0：只能靠静态防御，建议立刻补塔/补产能');
    return out;
  }

  return {read, decide, actions: A, DEFAULT_ACTIVE};
}

if (typeof module !== 'undefined' && module.exports) module.exports = {makeTacticalEngine, DEFAULT_ACTIVE};
