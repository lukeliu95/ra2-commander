> **修复状态（主会话审核后，runtime rt-da351a1d3c，提交 55c56ae）**
> - #1 迎击没有距离上限：已修复。新增 `leashRadius`，迎击点截断在防御塔旁，防线外被打的矿车撤回基地。
> - #2 改方案取消不了在建项：已修复。新增 `reconcileQueues()`，通过 `unqueueFromProduction` 取消。
> - #3 V3 导弹被当成空军：已修复。过滤弹体，显式写 0 时反射不再覆盖。
> - #4 ETA 偏晚：已修复。情报新增 `enemy.lead`（前锋数量、距离、速度、到防线的 ETA）。
> - #6 国家专属雷达名：已修复。角色可以对应多个候选建筑名；建造顺序里的项目 60 秒不可造时记 warn。
> - #5 GGI 不部署、#7 迷雾记忆对象：暂未修复。部署是开关式操作，状态不明时反复切换风险更大；#7 需要先验证。
> - 冒烟测试（苏军开局，约 1:25）：无报错；改方案 1 秒后取消了进度 8% 的战车工厂；1:08 警报的迎击点从 (117,87) 截断到 (123,85)；前锋 ETA 输出正常。

# match-003 执行层问题（runtime rt-ec0ae8a0f9）

按对胜负的影响从大到小排列。函数名都指 `scripts/runtime.js`。日志里没有 `error`、`warn` 事件，也没有长时间无事件的空档。以下问题来自事件时间线、快照和两位实时角色的记录。

## 1. 迎击反射没有距离上限，把全军拉出碉堡范围（影响：高，本局主要败因之一）
- **现象**
  - 4:26 敌方 1 辆 HTK 在 (102,99) 打我方矿车，触发警报；全军向 (99–103,96–101) 攻击移动（4:41 快照部队在 (98,101)，离碉堡 (75,115) 约 27 格）。4:26–4:55 杀敌 7 E2 + 2 HTK（约 1630），我方损失 2 MTNK、1 FV、8 E1（3540）和 2 矿车，部队 2790→180。
  - 6:31 敌方 2 HTK 在 (103,96) 触发警报，2 GGI、FV、E1 被拉出去，6:42–6:47 全灭（2430→0），只杀 2 HTK。随后第 4 波直接进家。
  - 对照：同一波残部 5:15–5:43 打到碉堡旁，我方杀 3 HTNK + 3 E2（约 2970），损失 1380。
  - 3:10 指挥官把 `threatRadius` 14→10，之后 4:26、6:31 两次照样被拉出去。
- **推测原因**：`army()` 里 `threats` 有两个条件：离任一建筑 < `threatRadius`，**或者**离任一受伤矿车 < 5 格。第二个条件没有距离限制，矿车跑多远就追多远。命中后 `defenders` 全体 `AttackMove` 到威胁中心 `tc`，不看离防御塔多远。另外，前沿矿厂也算"建筑"，所以 `threatRadius` 的圆心也会前移。
- **建议改法**（`army()`）
  1. 新增 plan 字段 `leashRadius`（默认 8）：以"最近的己方防御塔，没有塔就用集结点 rally"为锚点，过滤掉离锚点超过 `defenseDistance + leashRadius` 的威胁。
  2. 只因矿车触发、而且超出拴绳距离的威胁，不派部队，改为给那辆矿车下 `Move` 回最近矿厂或基地中心。可选：只派 ≤ 3 个快速载具，并且威胁价值必须 < 这几个单位价值的 50%。
  3. 迎击点 `tc` 按锚点到 `tc` 的方向截断到拴绳半径以内，部队在塔旁接敌，不追到 `tc`。
  4. `threats` 排除弹体（见 #3），避免 V3 导弹 5:11、5:19、5:58、6:13 反复触发警报，让部队朝导弹落点移动。

## 2. 改 plan 不会取消已经在建或排队的项目（影响：高）
- **现象**（同一局 5 次复现）
  - 2:33 按 buildOrder 在资金 83 时排产第 2 座 GAWEAP（2000）。2:49 指挥官把它挪到 buildOrder 末尾，3:29 设 `maxFactories: 1`，都没有取消；3:45 进度 64%，4:17 才落地。建筑队列一次只能造 1 个，被拆的矿厂（3:33）4:17 才开始重建，5:55 落地。
  - 4:30 反射排产 NASAM，4:41 设 `aaDef: 0`，5:27 进度 48%，5:36 仍然落地。
  - 5:37 排产第 3 座碉堡，5:50 设 `baseDef: 2`，6:05 仍然放下。
  - 5:59 从 buildOrder 删掉电厂，6:18 在建电厂进度 63%，6:31 放下。
- **影响**：整个 1:21–7:00 资金基本为 0，指挥官没有任何止血手段。仅第 2 座工厂和 NASAM 就占了约 3000 资金，大约是 4 辆灰熊。
- **推测原因**：`production()` 只在队列空闲（`status === Idle && currentSize === 0`）时看 plan 决定排产；`C.apply()` 只做 `Object.assign(C.plan, patch)`，没有队列对账。
- **建议改法**
  1. 在 `production()` 开头（或者 `C.apply()` 之后立即）加一个 `reconcileQueues(S, av)`：对 Structures、Armory、Vehicles、Infantry 四条队列逐项算"plan 现在还要不要"。Structures 看 buildOrder 计数、`targetRefineries`、`maxFactories`；Armory 看 `defenses`，显式写 0 的按 0 处理；Vehicles 和 Infantry 看 mix 权重是否 > 0。不再需要的项调用生产队列的取消接口（需要在游戏 API 里确认名字，比如 `player.production` 或 `my` 上的 dequeue/cancel 方法），并记一条 `plan` 事件："取消 X（已投入 N%，退款 M）"。
  2. 状态为 Ready 但 plan 不再需要的建筑也要取消，不要放置，避免卡住队列。
  3. 可选：buildOrder 里单价 ≥ 1500 的项加资金门槛（比如资金 ≥ 单价的 50%，或者没有警报时才排）；矿厂被拆、矿厂数 < `targetRefineries` 时，允许抢占 Structures 队列里的非经济建筑。

## 3. V3 导弹被当成空军，防空反射还会覆盖 plan（影响：中）
- **现象**：4:30 `首次发现敌方单位类型 V3ROCKET（空中）`，随后反射 `发现敌方空中单位：自动加防空车和防空塔`，排产 NASAM，同时把 `aaVehicle` 强制提到 2。4:41 指挥官设了 `aaDef: 0`，7:06 NASAM 被拆后又自动排产一次。全局敌方没有飞机。
- **推测原因**
  - `isAir` 用 `rules.consideredAircraft || isAircraft() || zone === 1` 判断，导弹和弹体也在空中层，所以命中。
  - `production()` 里 `if (M.airSeen) want.aaDef = Math.max(want.aaDef || 0, 1)` 和 `if (M.airSeen) mix.aaVehicle = Math.max(mix.aaVehicle || 0, 2)` 不管 plan 是不是显式写了 0。
- **建议改法**
  1. `isAir` 排除弹体：按 rules 上的导弹、弹体标记判断（需要确认字段，比如 `rules.missile`、`spawned` 或 `isProjectile`），或者用名字黑名单兜底 `/ROCKET|MISL|V3ROCKET|DMISL|CMISL/`。`intelSample()` 的空军判定、`army()` 的威胁、`C.intel()` 的 `visibleArmy` 都要用同一个 `isRealUnit` 过滤弹体。
  2. 反射只在 plan 没有显式指定时才生效：`if (M.airSeen && !('aaDef' in P.defenses))`；`vehicleMix` 同理，看 `'aaVehicle' in P.vehicleMix`。

## 4. 情报里的敌军中心点被慢单位和留在家里的单位拖住，ETA 偏晚（影响：中）
- **现象**：情报员 6 次 ETA 只有 2 次误差在 ±15 秒以内。1:29 的 urgent 预计"约 2:25 到基地"，实际 1:22 已接敌。第 2 波预计犀牛 3:10 到，实际 2:47 接敌。第 3 波预计 4:40 到，实际 4:26 接敌。有 4 条 urgent 送达时已经接敌。
- **推测原因**：`intelSample()` 用 `centroid(全部可见敌军)` 算 `d`，`C.intel()` 的 `visibleArmy.at / distToMyBase / trend` 也一样。载具跑在步兵前 10–20 秒，中心点落在队伍中后段；敌方家门口留着的单位（我方有视野时）和 V3 导弹也会被算进去。
- **建议改法**（`intelSample()`、`C.intel()`）
  1. 另算"前锋"：离我方基地最近的敌方单位，加上它周围 8 格内的单位，得到 `lead = {at, d, comp, value}`。`armyHist` 同时记录 `leadD`。
  2. 趋势和速度用 `leadD` 的 12 秒差分，输出 `lead.etaSec = leadD / speed`（离碉堡射程还有多远）。
  3. 离敌方出生点 < 15 格的单位不算入"逼近部队"；弹体不算入（见 #3）。
  4. 保留原来的全体中心点作为 `main`，并排输出。

## 5. GGI 不会被部署，反装甲能力用不上（影响：中，限制 T-012）
- **现象**：4:23 和 5:25 指挥官把步兵改成 GGI，全局出了 5 个 GGI，6:42–7:18 全部阵亡。第 4 波期间只杀掉 2 辆 HTK，犀牛和天启一辆没掉。runtime 里只有展开 MCV 时用到 `ORD.DeploySelected`。日志不记录击杀者，所以没法确认 GGI 的实际输出。
- **推测原因**：`army()` 没有部署逻辑。GGI 不部署时只有机枪，打不动犀牛和天启。
- **建议改法**（`army()`）：defend 姿态下，可部署步兵（GGI，rules 上有 deployer 或 deploysInto 一类标记）到达集结点 3 格内、没有移动命令时，下 `DeploySelected`；收到迎击或进攻命令、需要移动时，先取消部署。

## 6. 美国阵营的雷达可能一直造不出来，科技链被静默卡住（影响：低，待核实）
- **现象**：buildOrder 第 7 项是 `radar`，但整局 build 日志没有排产过雷达，快照里也从未出现 GAAIRC（3 座矿厂 2:33 已齐）。
- **推测原因**：`SIDES.GA.radar = 'GAAIRC'`，但我方是 Americans，可用列表里可能是国家专属的 AMRADR。`production()` 遇到 `!av.has(n)` 会静默跳过。
- **建议改法**：`R()` 允许一个 role 对应候选数组（`radar: ['GAAIRC', 'AMRADR']`），取第一个可用的；buildOrder 某一项连续 60 秒不可用时记一条 `warn`。下局开局用 `C.intel({detail: true}).available` 核实一次。

## 7. 侦察犬阵亡后，敌方基地位置的"可见敌军"长时间不变（影响：低，待核实）
- **现象**：1:36–2:30 情报一直显示 11–12 E2 + 1 DOG 静止在 (130–133,83–85)，此时我方侦察犬已经在 0:55 阵亡。
- **推测**：`g.getVisibleHostileObjects` 可能包含迷雾里的记忆对象，而不只是当前可见的对象。如果是这样，趋势判断会被旧数据带偏。
- **建议**：在 `C.state()` 里对 hostile 对象加一层当前可见校验（比如用 tile 的可见性接口），或者在情报里标注 `lastSeen`。

## 8. 指挥官改方案的生效延迟（非代码问题，记录备查）
- 3:29 决定的 apply 到 3:40 才出现 plan 事件，约 10 游戏秒。这是 agent 往返加写文件的时间，不是 runtime 的问题。紧急情况下应由执行层反射兜底（#1、#2 修好后影响会变小）。
