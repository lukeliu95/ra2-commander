#!/usr/bin/env python3
"""一次性补丁：把 tactical-core.js 内联进 runtime.js，并接上闭环仲裁。

为什么用脚本而不是手改：runtime.js 有 1053 行、内部是闭包，多处锚点需要精确插入；
这条补丁可重复执行（幂等），失败会打印原因而不是写出半个文件。
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUNTIME = HERE / "runtime.js"
CORE = HERE / "tactical-core.js"

src = RUNTIME.read_text(encoding="utf-8")
core = CORE.read_text(encoding="utf-8")

def core_block_from(core_text: str) -> str:
    """从 tactical-core.js 生成要内联的块（改 core 之后重跑本脚本即可同步）。"""
    mm = re.search(r"^const DEFAULT_ACTIVE = \{.*?^\};\n(.*?)\n^if \(typeof module", core_text, re.S | re.M)
    hh = re.search(r"^const DEFAULT_ACTIVE = \{.*?^\};\n", core_text, re.S | re.M)
    if not mm or not hh:
        sys.exit("FAIL: 无法从 tactical-core.js 提取引擎主体")
    out = hh.group(0) + mm.group(1)
    out = out.replace("function makeTacticalEngine(D) {", "const makeTacticalEngine = (D) => {", 1)
    out = re.sub(r"\n  return \{read, decide, actions: A, DEFAULT_ACTIVE\};\n\}$",
                 "\n  return {read, decide, actions: A};\n};", out, flags=re.M)
    if "return {read, decide, actions: A};" not in out:
        sys.exit("FAIL: 引擎收尾替换失败")
    return out

# ---------- 0) TAC 实例化块（幂等，两个分支都要保证它存在） ----------
# 第一版把 `const TAC = makeTacticalEngine({...})` 写在了 TACTICAL_CORE 块**内部**，而下面的幂等分支会用最新
# 核心源码整体覆盖那一块 —— 于是实例化被抹掉，TAC 变成未声明。match-017 开局 3 秒就抛 "TAC is not defined"，
# tacticalMode 每个 tick 都异常，把该 tick 后面的 siege/repair/retaliate/rearm 整段跳过。现在它有自己的
# BEGIN/END 标记，并且和核心块分开维护。
# 锚点必须在所有工具函数之后：xy/d2/.../isCombat 都是 const，早了会撞 TDZ。
TAC_ANCHOR = "    const avail = () => new Set(player.production.getAvailableObjects().map(r => r.name));"
TAC_BLOCK = """    // ===== TACTICAL_TAC_BEGIN（由 patch-tactical.py 注入，勿手改此块）=====
    // 实例化战术内核。两个坑，都是 match-017 开局 3 秒内用一条 "TAC is not defined" 换来的：
    //   1. 第一版把这几行写在 TACTICAL_CORE 块**里面**，而 patch 脚本的幂等分支会用最新核心源码整体覆盖那一块，
    //      实例化因此被抹掉；tacRefresh/tacDo/tacRead/tacAct 全都在用 TAC，于是 tacticalMode 每个 tick 抛异常，
    //      把该 tick 后面的 siege/repair/retaliate/rearm 整段跳过。现在它有自己的 BEGIN/END 标记，两边都幂等。
    //   2. 第一版传的是 `towerRange: p => towerRangeAt(p)`，但 towerRangeAt 是 army() 的局部函数，在这里不可见，
    //      真跑起来会换成另一个 "not defined"。改成 start() 作用域内的实现。
    // 位置也有讲究：锚点必须在所有工具函数之后（xy/d2/.../isCombat 都是 const，早了会撞 TDZ）。
    const towerRangeCache = new Map();
    const towerRange = pt => {
      const towers = (C.state ? C.state().buildings : []).filter(o => o.rules.isBaseDefense);
      if (!towers.length) return null;
      const b = towers.reduce((a, t) => d2(xy(t), pt) < d2(xy(a), pt) ? t : a);
      if (towerRangeCache.has(b.name)) return towerRangeCache.get(b.name);
      let r = null;
      try {
        const rules = game.rules.getObject(b.name, 2);
        const w = rules && (rules.primary || rules.elitePrimary) && game.rules.getWeapon(rules.primary || rules.elitePrimary);
        if (w && w.range) r = w.range;
      } catch (e) {}
      towerRangeCache.set(b.name, r);
      return r;
    };
    const TAC = makeTacticalEngine({
      xy, d2, dist, centroid, tally, hp, isAir, isCombat,
      valOf: o => cost(o),
      isMoving: o => !!(o.unitOrderTrait && o.unitOrderTrait.orders && o.unitOrderTrait.orders.length),
      towerRange,
    });
    // ===== TACTICAL_TAC_END =====
"""


def with_tac_block(text: str) -> str:
    """保证 TAC 实例化块存在且唯一（幂等）。"""
    begin = "    // ===== TACTICAL_TAC_BEGIN"
    end = "    // ===== TACTICAL_TAC_END =====\n"
    if begin in text:
        i = text.index(begin)
        j = text.index(end, i) + len(end)
        return text[:i] + TAC_BLOCK + text[j:]
    if TAC_ANCHOR not in text:
        sys.exit("FAIL: 找不到 TAC 实例化锚点（avail()）")
    return text.replace(TAC_ANCHOR, TAC_ANCHOR + "\n\n" + TAC_BLOCK, 1)


if "TACTICAL_CORE_BEGIN" in src:
    # 已经打过补丁：只把内联块同步成 tactical-core.js 的最新版本（核心逻辑改动后重跑这一步）
    new = core_block_from(core)
    i = src.index("    // ===== TACTICAL_CORE_BEGIN")
    j = src.index("    // ===== TACTICAL_CORE_END")
    block = "    // ===== TACTICAL_CORE_BEGIN（由 patch-tactical.py 内联，勿手改此块）=====\n"
    block += "\n".join(("    " + ln) if ln.strip() else "" for ln in new.split("\n"))
    block += "\n\n"
    RUNTIME.write_text(with_tac_block(src[:i] + block + src[j:]), encoding="utf-8")
    print("synced inline core from tactical-core.js")
    sys.exit(0)

# ---------- 1) 取出纯引擎源码，改名 + 去模块导出 ----------
m = re.search(r"^const DEFAULT_ACTIVE = \{.*?^\};\n(.*?)\n^if \(typeof module", core, re.S | re.M)
if not m:
    sys.exit("FAIL: 无法从 tactical-core.js 提取引擎主体")
body = m.group(1)
head = re.search(r"^const DEFAULT_ACTIVE = \{.*?^\};\n", core, re.S | re.M).group(0)
engine_src = head + body
engine_src = engine_src.replace("function makeTacticalEngine(D) {", "const makeTacticalEngine = (D) => {", 1)
# 收尾：把最后的 "  return {read, decide, actions: A, DEFAULT_ACTIVE};\n}" 换成返回值 + 分号
engine_src = re.sub(r"\n  return \{read, decide, actions: A, DEFAULT_ACTIVE\};\n\}$",
                    "\n  return {read, decide, actions: A};\n};", engine_src, flags=re.M)
if "return {read, decide, actions: A};" not in engine_src:
    sys.exit("FAIL: 引擎收尾替换失败")

# ---------- 2) 内联到 start() 里（闭包内，才能拿到 xy/hp/cost 等工具） ----------
anchor = "    const every = (key, s) => { const now = sec(); if (now - (M.lastTick[key] ?? -1e9) >= s) { M.lastTick[key] = now; return true; } return false; };"
if anchor not in src:
    sys.exit("FAIL: 找不到 every() 锚点")
inline = anchor + "\n\n    // ===== TACTICAL_CORE_BEGIN（由 tools/patch-tactical.py 内联，勿手改此块）=====\n"
inline += "    // 查打一体的纯逻辑：读同一份战场态、给同一组动作。这里只做依赖注入，不含游戏对象操作。\n"
inline += "\n".join(("    " + ln) if ln.strip() else "" for ln in engine_src.split("\n"))
inline += "\n    // ===== TACTICAL_CORE_END =====\n"
src = src.replace(anchor, inline, 1)
# TAC 实例化不写在这里：它必须落在所有工具函数之后（见 with_tac_block 的 TDZ 说明），
# 而且必须独立于核心块，否则幂等分支会在同步核心时把它一起覆盖掉。
src = with_tac_block(src)

# ---------- 3) plan 字段 ----------
src = src.replace(
    "    scout: true, repair: true,\n  };",
    "    scout: true, repair: true,\n"
    "    // 查打一体（recon-strike）——默认关闭，由角色显式开启。开启后允许把『实时判断』交给\n"
    "    // 主 agent 或本地的 tacticalTick 反射，二者读同一份 C.tacState、下同一组动作。\n"
    "    tacticalMode: false, tacticalInterval: 3, tacticalMaxOrders: 3, tacticalSuppressSec: 4, tacticalBreakRatio: 0.45,\n  };",
    1)

# ---------- 4) mem 状态位 ----------
src = src.replace(
    "lastHp: new Map(), retaliating: new Map(), finishing: false};",
    "lastHp: new Map(), retaliating: new Map(), finishing: false,\n"
    "      // 查打一体：上一轮战场态（供 trend 算变化率）、本轮动作账本、宏逻辑抑制窗口、破线滞回位。\n"
    "      tacState: null, tacActions: [], tacAt: 0, tacBreach: false, suppressedUntil: 0, tacVerified: [], tacFailed: 0};",
    1)

# ---------- 5) 三个新成员 + tacticalTick：插在 siege() 定义之前 ----------
tac_fns = r'''
    // ================= 查打一体（recon-strike）=================
    // 起因（match-016 复盘）：执行层每 0.8s 已在做实时判断，但那是 31 条手写 if-then；
    // 而"读战场 → 下动作 → 回读验证"这条链一次都没被闭合过。三个缺口的补法：
    //   (1) 读：C.tacRead() 给结构化战场态（含跨采样 trend），替代在 12 秒网格上手工推演；
    //   (2) 打：C.tacAct() 让 agent 能下 hold/focus/reposition/withdraw/screen，而不是只调阈值；
    //   (3) 验：每个动作自带 verify + fallback，执行后回读，失败即降级并在 log 里留下失败数。
    const tacCfg = () => ({
      weakHp: 0.4, driftTiles: 3, standoff: 1.5, minGapToThreat: 4,
      farTiles: 38, midTiles: 22, nearTiles: 12,
      maxOrders: C.plan.tacticalMaxOrders, breakRatio: C.plan.tacticalBreakRatio,
    });
    const tacRally = S => {
      const base = baseCenter(S.buildings), dir = enemyDir(base);
      return {x: Math.round(base.x + dir.x * (C.plan.defenseDistance + 2)), y: Math.round(base.y + dir.y * (C.plan.defenseDistance + 2))};
    };
    function tacRefresh(S) {
      if (!S) S = C.state();
      const base = baseCenter(S.buildings), dir = enemyDir(base);
      const st = TAC.read({now: sec(), P: C.plan, active: tacCfg(), base, dir,
        mine: S.mine, hostile: S.hostile, buildings: S.buildings, mem: M, stillTicks: M.stillTicks});
      st.ally = {inRange3: 0, spread: 0};
      M.tacState = st;
      M.tacAt = sec();
      // 上一轮动作的回读（闭环的核心）：verify 失败的记一条，并留待降级
      const failed = [];
      for (const a of (M.tacActions || [])) {
        let okGo = true;
        try { okGo = a.verify ? !!a.verify(st) : true; } catch (e) { okGo = true; }
        if (!okGo) failed.push(a);
      }
      if (failed.length) {
        M.tacFailed += failed.length;
        for (const a of failed) {
          if (a.fallback) {
            const fb = TAC.actions[a.fallback];
            if (fb) { const na = fb(a.ids, a.at || st.anchor); na.why = `[降级自 ${a.op}] ` + na.why; tacDo(na); log('reflex', `tac 动作 ${a.op} 回读失败，降级为 ${a.fallback}`); }
          } else {
            log('warn', `tac 动作 ${a.op} 回读失败且无降级路径（${a.ids.length} 个单位）`);
          }
        }
        M.tacVerified = failed.map(a => a.op);
      } else if (M.tacActions && M.tacActions.length) {
        M.tacVerified = M.tacActions.map(a => a.op);
      }
      return st;
    }
    // 真正下发。单写入点：所有动作（agent 来的和反射来的）都必须走这里，便于审计与仲裁。
    function tacDo(a) {
      if (!a || !a.ids || !a.ids.length) return {ok: false, error: '空动作'};
      const objs = a.ids.map(obj).filter(o => o && !o.isDestroyed);
      if (!objs.length) return {ok: false, error: '单位已不存在'};
      M.suppressedUntil = sec() + (C.plan.tacticalSuppressSec ?? 4);
      const p = a.at || null;
      const ids = objs.map(o => o.id);
      switch (a.op) {
        case 'focus': {
          const t = obj(a.targetId);
          if (!t) return {ok: false, error: '目标已不存在'};
          const tx = xy(t);
          my.orderUnits(ids, ORD.Attack, tx.x, tx.y);
          break;
        }
        case 'hold':
        case 'withdraw':
        case 'screen':
        case 'reposition':
        case 'reinforce':
          if (!p) return {ok: false, error: '缺少目标点'};
          my.orderUnits(ids, ORD.AttackMove, p.x, p.y);
          break;
        default:
          return {ok: false, error: '未知动作 ' + a.op};
      }
      for (const id of ids) M.lastOrder.set(id, {k: 'tac:' + a.op + ':' + a.targetId, t: sec()});
      M.tacActions = (a.replace ? [] : (M.tacActions || [])).concat([a]);
      return {ok: true, op: a.op, units: ids.length, at: p, why: a.why};
    }
    // 本地反射：即使没有任何 agent 在线，只要 tacticalMode 开着，这条就以 tacticalInterval 跑。
    function tacticalTick(S) {
      if (!C.plan.tacticalMode) return;
      const st = tacRefresh(S);
      const dec = TAC.decide(st, tacCfg(), M);
      const keep = dec.breach;
      if (keep !== M.tacBreach) {
        log('reflex', `tac 破线判定 ${M.tacBreach} → ${keep}${dec.breachCleared ? '（威胁已缓解，解除）' : ''}`);
        M.tacBreach = keep;
      }
      const acts = dec.actions.slice(0, Math.max(1, C.plan.tacticalMaxOrders));
      if (!acts.length) return;
      M.tacActions = [];
      for (const a of acts) tacDo(a);
      if (every('tacLog', 6)) log('reflex', `tac[${dec.phase}] 威胁 ${Math.round(st.threatValue)} vs 我 ${st.myValue}（比 ${st.ratio}）`
        + `，动作为 ${acts.map(a => a.op).join('+')}${dec.notes.length ? '｜' + dec.notes.join('；') : ''}`);
    }

'''
if "    function siege(S) {" not in src:
    sys.exit("FAIL: 找不到 siege() 锚点")
src = src.replace("    function siege(S) {", tac_fns + "    function siege(S) {", 1)

# ---------- 6) tick 里挂上 ----------
src = src.replace(
    "      if (every('siege', 0.7)) siege(C.state());",
    "      if (C.plan.tacticalMode && every('tactical', C.plan.tacticalInterval ?? 3)) tacticalTick(C.state());\n      if (every('siege', 0.7)) siege(C.state());",
    1)

# ---------- 7) 仲裁：宏逻辑让位于 tac 的抑制窗口 ----------
old_army_head = """    function army(S) {
      const P = C.plan, now = sec();"""
new_army_head = """    function army(S) {
      const P = C.plan, now = sec();
      // 仲裁：tac 刚下过动作 → 本 tick 的宏逻辑不覆盖它（否则 0.8s 后宏指令会把战术判决冲掉）。
      // 唯一的例外是"防线被打穿"这类需要立即全军反应的威胁，仍由下面的报警分支处理。
      const tacHolding = P.tacticalMode && now < (M.suppressedUntil || 0);"""
if old_army_head not in src:
    sys.exit("FAIL: 找不到 army() 头部锚点")
src = src.replace(old_army_head, new_army_head, 1)
src = src.replace(
    "        if (M.defendBroken) orderThrottled(defenders, ORD.Move, base.x, base.y, 'retreat', 2);\n        else orderThrottled(defenders, ORD.AttackMove, pt.x, pt.y, 'def', 3);",
    "        if (M.defendBroken) orderThrottled(defenders, ORD.Move, base.x, base.y, 'retreat', 2);\n        else if (!tacHolding) orderThrottled(defenders, ORD.AttackMove, pt.x, pt.y, 'def', 3);",
    1)

# ---------- 8) 对外接口 C.tacRead / C.tacAct ----------
old_intel = "    C.intel = ({reader = 'commander', maxEvents = 40, detail = false} = {}) => {"
if old_intel not in src:
    sys.exit("FAIL: 找不到 C.intel 锚点")
api = r'''    // ---- 查打一体的对外接口（agent 用它，而不是只调阈值）----
    // 一次调用拿到"看"和"打"两件事：读战场态、给可选动作、并可直接下发。
    // 与 C.intel 的分工：intel 是公平视野的原始事实；tacRead 已经把事实压成"该做什么"。
    C.tacRead = ({execute = false, maxOrders} = {}) => {
      const S = C.state();
      const st = tacRefresh(S);
      const dec = TAC.decide(st, tacCfg(), M);
      const limit = Math.max(1, maxOrders ?? C.plan.tacticalMaxOrders ?? 3);
      const acts = dec.actions.slice(0, limit);
      const issued = [];
      if (execute) { M.tacActions = []; for (const a of acts) issued.push(tacDo(a)); }
      return {
        time: fmt(sec()), stance: C.plan.stance, mode: !!C.plan.tacticalMode,
        phase: dec.phase, breach: dec.breach,
        threat: {value: Math.round(st.threatValue), ratio: st.ratio, lead: st.lead ? {name: st.lead.name, x: st.lead.x, y: st.lead.y, distToBase: st.lead.distToBase, air: st.lead.air} : null,
          byType: st.byType, airValue: st.airValue, heavyValue: st.heavyValue, trend: st.trend},
        mine: {value: st.myValue, count: Object.keys(st.us).length, weak: st.weakIds.length, immobile: st.immobileIds.length, aa: st.aaIds.length},
        line: {anchor: st.anchor, towerRange: st.towerRange, towers: st.towers.length},
        planned: acts.map(a => ({op: a.op, units: a.ids.length, at: a.at || null, target: a.targetId || null, why: a.why, fallback: a.fallback || null})),
        notes: dec.notes,
        issued: execute ? issued : undefined,
        // 上一轮动作的回读结果：这是"闭环"的证据，agent 每轮都该先看它
        lastVerify: {actions: (M.tacActions || []).map(a => a.op), failed: M.tacVerified, totalFailed: M.tacFailed},
        legend: {hold: '据守塔内不追出', focus: '集火指定目标', reposition: '转进到塔内某点', withdraw: '残血后置', screen: '防空车居中占位', reinforce: '逐辆补位'},
      };
    };
    C.tacAct = ({ops}) => {
      if (!ops || !ops.length) return {ok: false, error: '需要 ops'};
      const st = tacRefresh(C.state());
      const out = [];
      M.tacActions = [];
      for (const req of ops) {
        const f = TAC.actions[req.op];
        if (!f) { out.push({ok: false, error: '未知 op ' + req.op}); continue; }
        out.push(tacDo(f(req.ids || [], req.at, req.targetId)));
      }
      return {ok: out.every(r => r.ok), results: out, phase: M.tacState ? M.tacState.leadTiles : null};
    };
'''
src = src.replace(old_intel, api + old_intel, 1)

RUNTIME.write_text(src, encoding="utf-8")
print("patched runtime.js ok")
print("rows:", len(src.split("\n")))
