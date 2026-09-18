# 方案（plan）、角色分工与情报接口

所有实时 agent 都通过页面里的 `window.__cmd`（下文简称 `C`）协作。执行层每 250ms 按 plan 运转；agent 只改 plan 或发建议，不直接操控单个单位。这样 agent 30 秒的思考延迟不会拖慢战斗反应。

## plan 字段
| 字段 | 含义 | 默认 |
|---|---|---|
| `stance` | `defend` 集结在基地朝敌方来向的前沿；`attack` 攒够 `attackMinUnits` 后出击，拆建筑时自动集火；`harass` 最多 5 辆快速载具去打敌方矿厂，其余守家 | defend |
| `buildOrder` | 建筑顺序，按出现次数计目标数量。角色名：power、refinery、barracks、factory、radar、tech、depot；也可以直接写建筑名 | 见 runtime |
| `targetRefineries` / `minersPerRefinery` / `maxMiners` | 经济目标 | 3 / 2 / 7 |
| `maxFactories` | 战车工厂上限（资金 >2500 时才补） | 2 |
| `vehicleMix` | 载具权重。角色名：tank、aaVehicle（盟军 FV，打步兵和空军都好）、heavyTank；也可以直接写单位名 | {tank:3, aaVehicle:2} |
| `infantryMix` / `infantryCap` | 步兵权重（inf、aaInf、engineer）和上限 | {inf:1} / 8 |
| `defenses` | 防御建筑目标数：baseDef（碉堡/哨戒炮）、aaDef（爱国者/防空炮）、strongDef（光棱塔/磁暴线圈） | {baseDef:2} |
| `defenseDistance` | 防御塔和集结点离基地中心、朝敌方方向的格数 | 6 |
| `threatRadius` | 敌军离我方建筑多近算入侵 | 14 |
| `leashRadius` | 拴绳距离：只迎击离最近防御塔 `defenseDistance + leashRadius` 格以内的敌人，迎击点截断在塔旁 `leashRadius` 格内。调大就更积极保护前沿建筑，但更容易被引出防线 | 8 |
| `sortieMaxUnits` | 拴绳外有炮兵（V3/榴弹炮等）在轰我方建筑、且护卫价值不超过炮兵本身时，最多派这么多辆最快的载具出击清炮，其余部队留在防线。0 关闭 | 4 |
| `attackMinUnits` / `retreatRatio` | 出击门槛；进攻部队价值跌到出发时的这个比例就自动撤退 | 14 / 0.35 |
| `attackTarget` | `'auto'`（建造厂 > 电厂 > 防御 > 工厂 > 矿厂）或 `[x,y]` | auto |
| `siegeAutoAttackUnits` / `siegeQuietSeconds` | 防守姿态下连续 N 秒看不到敌军且我方单位 ≥ 门槛，就自动转进攻 | 8 / 10 |
| `scout` / `repair` | 开局派军犬侦察；建筑血量 <70% 自动修理 | true / true |

## 执行层反射（不需要 agent 参与）
- 敌军进入我方建筑 `threatRadius` 范围，或攻击矿车，并且在拴绳范围内：全军攻击移动到防御塔旁的迎击点，迎击半径取 `min(leashRadius, 锚定塔武器射程-1)`（match-005 证明过：不按塔的实际射程算，部队会站在塔火力覆盖不到的地方对射送死）。进攻途中家里的威胁超过我方部队价值 25%：撤回主力，stance 变回 defend。
- 防线外的矿车被打：矿车撤回基地，部队不出防线（`[reflex] 矿车在防线外被打`）。防线外有敌军在打我方建筑：只记 warn，由指挥官决定要不要调大 `leashRadius` 或主动出击。
- **清炮出击**：拴绳外的炮兵（V3、榴弹炮、无畏）在轰建筑、护卫价值 ≤ 炮兵价值、且炮兵+护卫 ≤ 出击载具价值的 1.5 倍时，派最多 `sortieMaxUnits` 辆最快载具攻击移动过去；炮兵清除或防线告警时立刻归队（`[reflex] 拴绳外有 … 在轰建筑` / `出击结束`）。match-004 两座哨戒炮就是被拴绳外的 V3 白白轰掉的。
- **队列对账**：每 1.5 秒检查一次生产队列，方案不再需要的在建或排队项目会被取消并退款（`[reflex] 方案已不需要，取消 X（进度 N%，取消前资金 M）`）。所以改 plan 可以立刻止血。`infantryCap` 也参与对账：把它调到当前步兵数以下会清空步兵队列。电厂和矿车永远不会被取消。
- **资金饥饿保护**：有 ≥1000 的建筑/防御在建且资金 <300 时，暂停新排步兵和载具（矿车不受影响），让贵的那项先造完（`[reflex] 资金不足且有 ≥1000 的建筑在建`）。match-004 里磁暴线圈在四条队列分钱的情况下 3 分半没造完。警报只能让 ≤700 的防御跳过资金门槛；更贵的防御要攒到半价才排产。
- buildOrder 全部完成、建筑队列空闲超过 45 秒：每 60 秒记一条 warn，提醒指挥官追加经济或防御建筑。
- 下一座建筑会造成断电：先插队造电厂。
- 发现敌方空中单位（弹体如 V3 导弹不算）：防空车权重至少 2，补 1 座防空塔。plan 里显式写了 `defenses.aaDef: 0` 或 `vehicleMix.aaVehicle: 0` 时，这个反射不会覆盖。
- 建造顺序里的项目连续 60 秒不可造（比如国家专属建筑名不对）：记一条 warn。
- 进攻部队折损到 `retreatRatio`：撤回集结点，stance 变回 defend。
- 攻城：进攻中附近没有敌军时，直接集火建筑（建造厂 > 电厂 > 防御 > 工厂 > 矿厂）。
- 防守中长时间看不到敌军且兵力够：自动转进攻（作者记为 `main`）。

这些反射会把 stance 改回 defend，指挥官读到对应事件后要重新判断，而不是盲目再切回 attack。

## 角色与写权限（`C.ownership`）
- `commander`：默认拥有全部字段（`'*'`）。
- `quartermaster`：arm 时 roles 里包含 quartermaster 才启用，拥有经济字段 `buildOrder, targetRefineries, minersPerRefinery, maxMiners, maxFactories, infantryCap, repair`；此时 commander 只能改其余字段。
- `analyst`：没有写权限，只能 `C.advise('analyst', msg, level)`。
- `main`：主会话（用户中途下指令时使用）。
- 越权调用 `C.apply` 会返回 `{ok:false, error}`，不会生效。

## 接口
- `C.apply(patch, reason, author)` → `{ok, plan}`。每个字段整体替换；reason 必须写清楚针对什么情况。
- `C.advise(from, msg, level)`：level 为 info / warn / urgent，会作为 `[advice/<from>]` 事件出现在所有读者的情报里。
- `C.intel({reader, maxEvents = 40, detail = false})`：公平视野（只含我方可见信息）。每个 reader 有独立游标，不会互相吞事件。字段：
  - `time`、`over`（null / won / lost）
  - `me`：credits、power、base、buildings、units、army {count, value, at}、damaged、queues
  - `enemy`：start、visibleArmy {count, value, comp, field, atEnemyHome, note}、knownBuildings、airSeen、approachFrom
    - 这个引擎没有战争迷雾：侦察过的区域永久可见，所以敌方留在家里的单位也算"可见"。`visibleArmy.field` 只算离敌方出生点 >15 格的野战部队 {count, value, comp, at, distToMyBase, trend}；`atEnemyHome` 是留守/新造的单位 {count, value, comp}，可以当作免费的科技侦察，但**不要用它判断来袭**
  - `enemy.lead`：离我方基地最近的敌军前锋群（排除还在敌方出生点 15 格内的单位）{count, value, comp, at, distToMyBase, trend, tilesPerSec, etaToDefenseLineSec}。**预判到达时间用它**：全体中心点会被慢速步兵和留守单位拖住，match-003 用中心点估的 ETA 6 次只准 2 次
  - `status`：stance、alarm、attack、siegeTarget、scouted
  - `events`（自上次读取以来）、`droppedEvents`、`plan`
  - `detail:true` 时额外返回：`available`（可生产列表）、`enemy.typesFirstSeen`、`enemy.buildingsFirstSeen`、`enemy.armyTrack`（最近 10 次敌军位置/距离）
- 事件类型：build、prod、intel、alarm、reflex、attack、siege、scout、kill、loss、plan、advice、warn、error、over、start
- `C.dump('meta' | 'log' | 'snapshots', offset, limit)`：赛后导出。**snapshots 是全视野数据，比赛进行中禁止读取**，只给复盘学习员用。
