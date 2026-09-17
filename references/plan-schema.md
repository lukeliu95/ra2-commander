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
| `attackMinUnits` / `retreatRatio` | 出击门槛；进攻部队价值跌到出发时的这个比例就自动撤退 | 14 / 0.35 |
| `attackTarget` | `'auto'`（建造厂 > 电厂 > 防御 > 工厂 > 矿厂）或 `[x,y]` | auto |
| `siegeAutoAttackUnits` / `siegeQuietSeconds` | 防守姿态下连续 N 秒看不到敌军且我方单位 ≥ 门槛，就自动转进攻 | 8 / 10 |
| `scout` / `repair` | 开局派军犬侦察；建筑血量 <70% 自动修理 | true / true |

## 执行层反射（不需要 agent 参与）
- 敌军进入我方建筑 `threatRadius` 范围，或攻击矿车，并且在拴绳范围内：全军攻击移动到防御塔旁的迎击点。进攻途中家里的威胁超过我方部队价值 25%：撤回主力，stance 变回 defend。
- 防线外的矿车被打：矿车撤回基地，部队不出防线（`[reflex] 矿车在防线外被打`）。防线外有敌军在打我方建筑：只记 warn，由指挥官决定要不要调大 `leashRadius` 或主动出击。
- **队列对账**：每 1.5 秒检查一次生产队列，方案不再需要的在建或排队项目会被取消并退款（`[reflex] 方案已不需要，取消 X`）。所以改 plan 可以立刻止血。电厂和矿车永远不会被取消。
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
  - `enemy`：start、visibleArmy {count, value, comp, at, distToMyBase, trend: approaching / withdrawing / static / unknown}、knownBuildings、airSeen、approachFrom
  - `enemy.lead`：离我方基地最近的敌军前锋群（排除还在敌方出生点 15 格内的单位）{count, value, comp, at, distToMyBase, trend, tilesPerSec, etaToDefenseLineSec}。**预判到达时间用它**：全体中心点会被慢速步兵和留守单位拖住，match-003 用中心点估的 ETA 6 次只准 2 次
  - `status`：stance、alarm、attack、siegeTarget、scouted
  - `events`（自上次读取以来）、`droppedEvents`、`plan`
  - `detail:true` 时额外返回：`available`（可生产列表）、`enemy.typesFirstSeen`、`enemy.buildingsFirstSeen`、`enemy.armyTrack`（最近 10 次敌军位置/距离）
- 事件类型：build、prod、intel、alarm、reflex、attack、siege、scout、kill、loss、plan、advice、warn、error、over、start
- `C.dump('meta' | 'log' | 'snapshots', offset, limit)`：赛后导出。**snapshots 是全视野数据，比赛进行中禁止读取**，只给复盘学习员用。
