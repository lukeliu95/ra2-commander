# 执行层问题 match-009

runtime = `rt-cea4cb56a8`，plan = v007，结果**胜**（7:45）。本局是 v007 的**第 2 局**（第 1 局 match-008 负）。

> **数据来源说明**：本局结束时页面已被关闭（`window.__cmd` 已不存在，CDP `/json/list` 返回 0 个 target），`meta.json`/`log.json`/`snapshots.json` 是从 Chrome profile 的 localStorage LevelDB（`_ra2-bridge/chrome-profile/Default/Local Storage/leveldb/000004.log`）里恢复出来的三份兜底备份。恢复结果与 meta 自述一致（`logCount 229` / `snapshotCount 48`，双双对上），数据完整。**但这意味着 rt-cea4cb56a8 的 localStorage 兜底机制本局第一次真正被使用并验证有效**——建议保留，不要动。

> **主会话并发更新（复盘进行中，12:20 复核）**：本文件写完之后查到 `scripts/runtime.js` 已被主会话改到 **`rt-f897c162d5`**，其中**问题 1、2、3 的核心部分已经修好**，且代码注释里直接引用了 match-009 的证据——
> - **问题 1（siege 判据）已修**：`siege()` 现在用 `const fieldUnits = enemyUnits.filter(o => dist(xy(o), enemyStart()) > 15)` 且判 `fieldUnits.length === 0`（正是本文建议的 `field` 语义），**并且额外加了 T-005 的优势门槛** `advantage = enemyValue === 0 || myValue >= enemyValue * 2`（避免"龟缩对手在兵力持平时也被推出去行军 74 格"的新风险），还加了一条 `[warn] 自动转攻被 T-005 优势门槛挡住：…` 让卡住的反射可见（正是本文建议的第 3 点）。**按新逻辑回放本局：4:32（15 单位/7020 对 ~1900）就应自动转攻，比本局的手动 5:40 早约 1 分钟。**
> - **问题 2（核电站）已修一半**：新增 `const isNuke = b => !!(b.rules.nuclear || /NRCT|NUKE/.test(b.name))`，`siegeRank` 变成 `isNuke(b) ? 6 : …`，核电被排到最后（注释写明"match-009 lost 3 HTNK (2700) in a single tick"）。**本文建议的第 2 点（选中核电前先把 6 格内单位撤开）没有做**——排序修好之后"最后拆"已经能规避绝大部分风险，散开那一步可以低优先级。
> - **问题 3（minerEscort）已修**：新增 `oreNear(r)`，待命点从矿厂建筑坐标改成**离该矿厂最近的矿格**（`spot = oreNear(refPts[i]) || refPts[i]`，找不到矿格时回退），注释引用了"match-009 ran with minerEscort:1 and logged no effect"。**提案里"主动迎击进入矿区的敌人"那一半仍未实现**（现在仍是 AttackMove 到点待命），所以 T-026 依然只能算"部分实现"，下一局要观察它到底拦不拦得住偷矿车的人。
> - **问题 4、5、6、7 尚未修**（`siegeRank` 里 `power` 仍排在 `isBaseDefense` 之前；`C.intel()` 仍无战损累计口径；`me.army.at` 仍是全体质心；`production()` 仍无 buildOrder 兜底）。
> - **注意行号**：本文正文引用的 `runtime.js:xxx` 行号是**被复盘的 rt-cea4cb56a8**（源码见 `matches/match-009/install.js`）的行号；rt-f897c162d5 里这些代码整体下移了约 8–12 行（新增注释与 `oreNear`/`isNuke` 造成）。引用时按函数名（`siege()` / `siegeRank()` / `army()` / `production()` / `C.intel()`）定位，不要按行号。

---

## 1. `siege()` 的"安静"判据用的是"全地图看不到任何一个敌方单位"，对龟缩型对手**结构性地永不触发**（关键，本局必须人工介入才转攻）

- **现象**：5:12 analyst 的 `[urgent]`、5:40 指挥官的 `plan` 事件都记录了同一件事：4:56–5:19 我方 **20→25 个单位（含载具）**、`attackMinUnits:10` 与 `siegeAutoAttackUnits:14` 都已满足，敌方 `field`（离敌出生点 >15 格的野战部队）**连续约 90 秒为 0**，但 `status.attack=null`、`stance` 始终是 `defend`，自动转攻**一次都没触发**。最后靠指挥官 5:40 手动 `apply({stance:'attack'})`，5:41 才发起 27 单位攻势。
- **影响程度**：**关键**。本局的胜负手就是这次转攻（5:41 出发 → 6:34 拆掉建造厂 → 7:45 取胜）。如果指挥官没有在 5:40 人工补这一脚，自动化流程会让 25 单位/16020 的大军一直停在基地里，同时敌方在憋 V3/核电站/实验室——正是 match-004 的死法。**这个反射现在等于不存在，每一局都要靠人类/agent 手动救，这是一个"自动化系统里必须有人兜底才能赢"的结构性缺陷。**
- **推测原因（已核对代码，确认为判据本身错误，不是阈值问题）**：`siege()`（`runtime.js:529-545`）里
  ```js
  const enemyUnits = S.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
  if (P.stance === 'defend' && !M.alarm) {
    if (enemyUnits.length === 0) { M.noArmySince ??= now; ... }
    else M.noArmySince = null;
  }
  ```
  `S.hostile` 来自 `C.state()` 的 `g.getVisibleHostileObjects(player)`，而 `C.intel()` 的 note 明确写着**"探过的区域永久可见（无战争迷雾）"**。所以只要侦察过一次敌方基地（本局 0:53 就探到了），**敌方缩在家里的 15 个单位会一直算在 `S.hostile` 里**，`enemyUnits.length === 0` 永远不成立 → `M.noArmySince` 永远是 null → 反射永远不会触发。**这不是"阈值调小了/调大了"的问题，改 `siegeQuietSeconds` 或 `siegeAutoAttackUnits` 都没用。**
  **反证（本局数据完整排除了其他解释）**：`siege()` 的另外两个前置条件在本局**全部满足**——(a) `!M.alarm`：3:44「威胁解除」之后到 5:38 之间**一条 alarm 都没有**；(b) `armyUnits.length >= 14` 且含载具：4:32 起我方就有 15 个单位（快照 4:32 我方 15 单位/7020），4:56 起 20 个、5:19 达 25 个。所以唯一卡住它的就是 `enemyUnits.length === 0` 这一条。对比 match-007：那次反射**能**触发（1:07 误触），因为那 5 个 E1 当时还没进入我方侦察过的区域；可见这条判据的触发与否取决于"敌方单位是否可见"，而不是我们想表达的"敌方野战部队是否还在外面"。
- **建议代码改法（指到函数名）**：
  1. **改判据本身（首选）**：`siege()` 里的 `enemyUnits` 改成按 `field` 语义取子集，即只统计"离敌方出生点 >15 格"的敌方单位——这正是 `C.intel()` 里 `enemy.visibleArmy.field` 已经在用的算法（`enArmy.filter(o => dist(xy(o), enemyStart()) > 15)`，`runtime.js:649`），也是 T-024 想表达的语义。改完本局 4:32 就该自动转攻（`field` 已在 4:32 之前归零），比指挥官手动介入早约 1 分钟。
  2. 顺手把 `M.alarm` 的排除条件复核一遍：本局它没挡事，但"龟缩在家 + 被单个单位骚扰"时 `M.alarm` 会周期性为真，可能让已积累的 `noArmySince` 反复清零，建议改用 `M.alarm` 的持续性判断而不是瞬时值。
  3. 升级不通过时**至少要发一条 `warn`**（例如"敌方野战部队已消失 N 秒、我方兵力已达 M，但自动转攻被 X 条件挡住"），让实时角色能看见这个反射卡在哪一步——本局 analyst 只能靠 `status.attack=null` 反推，信息太少。

## 2. 拆掉敌方核电站（NANRCT）会引发核爆，现有代码没有任何"接近核电站时散开"的处理（关键，一次损失 3 辆犀牛）

- **现象**：7:25 同一时间戳下三条事件连续出现——`[kill] 摧毁敌方建筑 NANRCT`、`[loss] 我方损失 {"HTNK":3}`、`[siege] 附近出现敌军，暂停拆建筑，先打部队`。我方一次损失 3 辆犀牛（3×900 = **2700**），是本局**单次最大战损**，也是整局 11 辆犀牛损失里最集中的一笔。此后 7:26 又击杀敌方 5 个 E2，7:27 继续拆 NARADR。
- **影响程度**：中等偏关键。没有改变胜负（此时敌方建造厂 6:34 已被拆、野战部队 6:04 就归零了），但 2700 是我方防守阶段全部战损（2720）的等价规模——**在真正的攻坚阶段，一次核爆就等于打光一次防守战的本钱**。如果它发生在势均力敌的局里，3 辆坦克的缺口足以让攻势停下来（`retreatRatio 0.35` 按 17820×0.35=6237 算，2700 占 43% 的撤退预算）。
- **推测原因**：核电站被摧毁时会在原地产生范围伤害（RA2 原生机制，`NANRCT` 是苏军核电建筑）。运行时代码里**没有任何地方认识"核电站"这个特殊建筑**：`siegeRank()`（`runtime.js:528`）只按 `constructionYard / rules.power>0 / isBaseDefense / 正则 / refinery` 分类，`NANRCT` 因为 `rules.power > 0` 被归为 **rank 1（仅次于建造厂）**，也就是**被优先攻击的第二类目标**——结果我们会在最不可能散开、正在集火贴身拆楼的时刻，站在这座"炸弹"旁边把它打爆。本局实际顺序也印证了这一点：6:34 拆 NACNST（rank 0）→ 之后立刻去拆核电/电厂（rank 1）。
- **建议代码改法（指到函数名）**：
  1. 在 `siegeRank()` 里识别核电站（`b.rules.nuclear` / `name` 含 `NRCT`），把它排到**最后**（rank 5 之后），理由：它既是 rank 1 的电力目标、又是范围伤害源，早拆只会用自己的坦克换。拆到它时敌方已经没气了，放最后没有任何代价。
  2. 在 `siege()` 选目标那一段（`runtime.js:553-563`）加一条前置检查：如果 `candidates` 里选中/即将选中核电站，**先把 `group` 里离它 6 格以内的单位撤开**（`orderThrottled(units, ORD.Move, 远离方向, 'nuke-pull', 4)`），等散开后再下 `ORD.Attack`。
  3. 更通用的做法（推荐，能覆盖将来其他"自爆型"建筑）：在 `obj`/`rules` 层面标一个 `explosiveOnDeath` 标志，`siege()` 统一按它做散开处理，而不是只硬编码 `NANRCT`。

## 3. `minerEscort` 的实现与 T-026 提案不一致：护卫是站在**矿厂建筑**旁边，不是待在**矿区/矿格**（中等，本局零可观测效果）

- **现象**：本局 `minerEscort: 1`（v007 写进初始 plan），全程 `0` 辆矿车损失，**但也没有任何可观测的效果**——日志里没有任何 escort 相关事件，敌方从未偷袭过矿区（唯一一次 5:34「矿车在防线外被打」的 `[reflex]` 反应是既有的"撤回基地"逻辑，与 escort 无关）。所以这个字段本局是"无害但也无用"，**无法判断它是"起作用了"还是"没被检验"**。
- **影响程度**：低（本局无损失），但**中期待评估**：如果实现不改，这个字段在真的遇到"专打矿车"的对手（苏军/古巴档案里都记录过）时**也不会起作用**，等于永远白开。
- **推测原因（已核对代码，指挥官赛后审计的结论成立）**：`army()` 尾部（`runtime.js:513-524`）的实现是
  ```js
  const refPts = S.buildings.filter(b => b.rules.refinery).map(xy);
  const guardCount = Math.min(P.minerEscort || 0, units.length, refPts.length);
  for (let i = 0; i < guardCount; i++) {
    const u = [...units].sort((a,b) => (b.rules.speed||0)-(a.rules.speed||0))[i];
    const spot = refPts[i];                       // ← 矿厂建筑坐标
    orderThrottled([u], ORD.AttackMove, spot.x, spot.y, 'escort:'+u.id, 8);
  }
  ```
  它把**最快的那 1 个单位 AttackMove 到自己矿厂的坐标**原地待命。而 T-026 提案要求的是"待命在**矿区**（`M.oreTiles` 已有矿格坐标）、检测到矿区附近出现敌人就主动迎击"。**矿厂建筑在我方基地内，矿车是在基地外的矿格上挖矿**——护卫站在矿厂旁边，拦不到任何去野矿打矿车的人。另外 `M.oreTiles` 本局被正常采集了 367 个矿格（0:00 `start` 日志），但只被 `placementCenter` 的扩张逻辑用到（`runtime.js:144-145`），`minerEscort` 完全没碰它。
- **建议代码改法（指到函数名）**：`army()` 里的 escort 分支改为按提案语义：
  1. 待命点用 `M.oreTiles` 里离基地最近的若干矿格（`near = M.oreTiles.filter(t => d2(t, base) < 28*28).sort(...)`，这段逻辑 `placementCenter` 里已有现成的，可以抽成共享函数），而不是 `refPts`。
  2. 从"AttackMove 到点待命"改成"**站岗 + 主动迎击**"：每 tick 检查 `M.oreTiles` 附近 8–10 格内是否有敌方非建筑单位，有就用 `orderThrottled(escorts, ORD.AttackMove, threatPos, 'minerEscort', 3)` 迎击；没有就回到矿区待命点。
  3. 给 escort 分配加一个"不要抢走防守部队唯一/最快的单位"的下限（比如 `units.length >= 6` 才启用，或从最慢的载具里挑而不是从最快的里挑——最快单位通常是 DOG/反装甲载具，站在矿区纯属浪费）。

## 4. 攻城阶段的"暂停拆建筑先打部队"会把坦克牵进残余防御火力圈：敌方野战部队归零后我方仍损失 11 辆犀牛（9900）（中等，非 bug，但性价比极差）

- **现象**：6:04 敌方可见单位归零（`vis.count:0`，家里也是 0），7:45 取胜。**这 1 分 41 秒里我方又损失了 11 辆犀牛（约 9900）**——6:26 一辆、6:34 两辆、6:41、6:46、6:58、**7:25 三辆（核爆）**、7:29 一辆（按 commander_log 的事件序列）。整个防守阶段（2:56–3:41 塔旁接战）我方也只损了 2720，**收尾阶段反而是防守阶段的 3.6 倍**。敌方终局只剩 NAREFN×3 + NADEPT + NATECH，说明这些损失几乎全部来自"残余 NALASR/TESLA 静态防御 + 它临时生产的 E2/工程师"。
- **影响程度**：中等。本局不影响胜负（家已经空了，时间问题），但这是**本局最大的资源浪费**，而且形态上会重复：只要进入收尾，我们就用坦克去换 90 块的动员兵和 500 块的电厂。
- **推测原因**：`siege()`（`runtime.js:549-552`）在攻城集团 12 格内出现任何敌方单位时，会 `return` 掉、把目标切给部队，而部队的接战分支（`army()` 的 `threats` 分支）是**无条件 AttackMove 到迎击点**——这个迎击点由威胁质心决定，可能正好落在残余防御塔的射程里。也就是说"先打部队"这个决定本身没有错，但**打在哪、用什么打**没有约束：坦克会主动贴上去跟杂兵对射，而对方背后还有塔。
- **建议代码改法（指到函数名）**：
  1. `siege()` 的"暂停拆建筑"分支加一条：如果这批敌军背后仍有敌方 `isBaseDefense` 建筑存活且距离很近，**优先继续拆那座塔**（拆塔比追兵更划算，塔是我们伤亡的来源），即把 `siegeRank` 里的 `isBaseDefense` 提到 `power` 之前。
  2. 更彻底一点：`army()` 的 `threats` 分支里，如果当前 `stance==='attack'`（我们在别人家里），迎击点应**截断在我方攻城集团一侧**（类似防守态 `leashRadius` 的镜像做法），不要让对方把我们从建筑群旁边拉走。
  3. 核爆问题见 #2，7:25 那 3 辆占了这 9900 的 27%，两条一起改能省掉相当一部分。

## 5. `intel()` 没有对战损/击杀做累计口径，两个实时角色手工核对交换比时都算错了（中等，直接污染了决策依据）

- **现象**：4:01 analyst 发出 `[warn] 防线战果：2:56-3:41 塔旁接战，我方击杀 3 HTNK + 2 HTK + 2 DOG + 约 14 E2（≈5360），只损 1 HTNK + 7 E2 + 2 DOG（≈1930），交换比约 2.8:1`。赛后用 `log.json` 逐条重算同一窗口（2:56–3:41，单价 HTNK 900 / HTK 500 / DOG 200 / E2 90，与 `intel()` 的 `cost()` 一致）：
  - 实际**击杀** = 3 HTNK + 2 HTK + **1 DOG** + **10 E2** = 4800
  - 实际**损失** = **2 HTNK** + 8 E2 + **1 DOG** = 2720
  - 真实交换比 = **1.76:1**，不是 2.8:1（高估 59%）。两个 DOG 数字被对调、我方 HTNK 损失少数了 1 辆、敌方 E2 击杀多数了 4 个。
- **影响程度**：中等。结论方向没变（1.76:1 仍然明显好于档案苏军局的水平），但**量化依据错了 59%**，而指挥官 5:40 的转攻决策、以及本次复盘对 T-017 的升级，都是引用这个数字做出的。手工从 `events` 里逐条累加 kill/loss 消息很容易错（本局两个角色**独立地**犯了同一个错，说明这是接口问题不是个人失误）。
- **推测原因**：`C.intel()` 只给 `events`（滚动窗口，`maxEvents` 默认 40，本局两边都用默认值），**没有给任何累计口径**——没有"本局累计击杀/损失（按单位+价值）"、也没有"最近 N 秒战果"。`C.log` 里虽然有全部 kill/loss 事件，但实时角色读到的是被截断的 events 窗口（`droppedEvents` 字段说明本局确实发生过丢弃），跨窗口累加必然出错。
- **建议代码改法（指到函数名）**：在 `C.intel()`（`runtime.js:645`）的返回里加一个 `tally` 段：
  1. `tally.total = {kill: {comp, value}, loss: {comp, value}}`——直接从 `C.log` 里按 `kind==='kill'|'loss'` 全量累加（配对 `msg` 里的 JSON），与 `record()` 的估价口径一致。
  2. `tally.window(sec)` 或在 `status` 里给一个"交战开始时/结束时的部队价值"，让"某一场交战"的交换比可以直接读，不用猜窗口边界。
  3. 顺手把 `me.army.value` / `enemy.visibleArmy.value` 的估价口径（哪些单位算什么价）写进返回，避免再出现"按 900/90 反推"这种事后考古。

## 6. `intel().me.army.at` 是全体（含留守/落后单位）质心，攻城期间与实际战况严重脱节（低偏中，影响指挥判断）

- **现象**：6:04 `army.at=(111,94)`、6:49 `(100,102)`，但同一时间的事件流显示攻城集团已经在 (71,118) 拆掉敌方 NACNST/TESLA/NAPOWR。指挥官记录："无法从 `army.at` 判断攻势进展，只能靠 siege/kill 事件。"
- **影响程度**：低偏中。本局没造成误判（有 siege 事件兜底），但这是**唯一能反映"我的部队在哪"的字段**，在需要判断"要不要回防""攻势是不是卡住了"的时候会直接误导。
- **推测原因**：`C.state()`（`runtime.js:118-121`）的 `mine` 是全部己方单位，`intel()` 的 `me.army.at = centroid(myArmy)`（`runtime.js:666-667`）取的是全体质心，包含基地里的新出厂坦克和落后一大截的 E2。`intel()` 已经在 `enemy.visibleArmy` 上做了 `field`/`atEnemyHome` 的切分，**己方这边没有对应的切分**。
- **建议代码改法（指到函数名）**：`C.intel()` 里给己方也加一个 `field` 子集（复用 `M.armyHist` 已经在算的 `away`/`lead`/`lc` 口径：`dist(xy(o), myBase) > 15`），返回 `me.army.field = {count, value, at}` 和 `me.army.home`；或者直接把 `attack` 分支的 `M.attack.ids` 对应的"攻城分队质心"暴露出来（`status.attack` 已有 `target`，补一个 `centroid` 成本很低）。

## 7. `buildOrder` 跑完后没有任何兜底项，建筑队列长时间空转（低，属结构性缺口）

- **现象**：5:05「建筑队列已空闲 45 秒」、6:05「105 秒」、7:05「166 秒」三条 warn。buildOrder 的 9 项在 4:20 前就跑完，之后**没有任何兜底项**——analyst 4:01 建议的第 2 座 TESLA 从未排产，`defenses.strongDef` 固定在 1。
- **影响程度**：低。本局后期资金长期为 0（快照 5:32/6:02/6:32/7:03 都是 0），就算有兜底项也买不起，实际浪费有限（指挥官估算"不算严重"）。
- **推测原因**：`production()` 的建筑排产完全由 `buildOrder`（按序、不看资金）+ `maxFactories`/`defenses` 目标数驱动，没有"队列空闲超过 N 秒就补一个低优先级防御/矿厂/维修厂"的逻辑。
- **建议代码改法（指到函数名）**：`production()` 里加一条兜底：`buildOrder` 已耗尽、且建筑队列空闲超过 30 秒、且资金 > 某阈值（避免踩 T-013 的"资金 0 排 1500 建筑占死队列"）时，按 `defenses` 目标数或矿厂数补一座；同时**不要**把这东西写进 `buildOrder`（会违反 T-013）。

## 8. 三个 rt-cea4cb56a8 **没有**、但当前 `runtime.js` 已经补上的机制，本局全部无法验证（记录，避免把"未验证"写成"有效"）

- `defendRetreatRatio` / 新增的 `defendMinValue`（`runtime.js:24`、`467-469`）：本局**双方**都没打到阈值——我方防守交战期间部队价值始终在起始值的 85% 以上（3:32 alarm 仍显示"我方剩余部队价值 3060"），`log` 里连一条「防守交战只剩 X%」都没有。**match-008 暴露的"残部基数过小时跳过阈值窗口"缺口本局既没被证伪也没被修复，仍是未验证状态。**
- `strongDef` 的资金门槛绕开（`runtime.js:262-279`，match-008 复盘后新加）：本局用不上——TESLA 在 2:00 就以「资金 2161」正常排产（`credits > 700 && credits >= 750` 两条门槛都过），2:26 落地。**新机制没被检验，但也没有暴露问题。**
- `airSeen` 防空绕资金门槛：**连续第 3 局未触发**（match-007/008/009）。本局敌方苏军 `airSeen` 全程 false（`typesFirstSeen` 里没有 HIND），我方 `NAFLAK` 从头到尾没参与过任何拦截。**这两项（防空绕门槛、防空建筑本身）至今零实战证据。**
