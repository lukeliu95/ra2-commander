# 游戏内部接口与坑点（王二火大 / Chrono Divide，ra2web 引擎 0.87.x）

这些是逆向 `js/app.js` 和实战验证出来的事实。游戏版本更新后可能失效；失效时先对照本文件，逐项重新验证。

## 目录
1. 怎么拿到控制权
2. GameApi（查询）
3. 命令接口（ActionsApi 同类）
4. 引擎对象字段
5. 枚举
6. 单位/建筑名
7. 坑点清单
8. 游戏更新后如何重新逆向

## 1. 怎么拿到控制权
- 游戏自带 AI 通过两个对象操作：`GameApi`（查询）和一个命令类（压缩名曾是 `j_e`，含 `orderUnits / placeBuilding / queueForProduction / toggleRepairWrench / sellObject …`）。它们都在闭包里，window 上拿不到。
- 开局时 BotManager 执行 `this.gameApi = ...`，命令类构造函数执行 `this.actionQueue = ...`，都是**赋值**。所以在**主菜单阶段**给 `Object.prototype` 装这两个属性的 setter，开局赋值时就能捕获实例；捕获后立刻 `delete Object.prototype.xxx` 卸载。
- 命令类的 `add()` 只用 `this.bot.name` 决定是谁下的命令，所以 `new actions.constructor(game, actionFactory, actionQueue, {name: 人类玩家名, getDebugMode: () => false})` 就能以我方身份下命令。
- 前提：对局里必须至少有一个 AI（遭遇战 vs AI 满足），否则 BotManager 不会创建这些对象。
- 陷阱必须在点"开始游戏"**之前**装好。开局后才装是抓不到的，只能退出重开或刷新页面重来。

## 2. GameApi（`C.g`）
常用：`getPlayers()`、`getPlayerData(name)` → `{country, startLocation, isAi, credits, power:{total, drain, isLowPower}}`、`isPlayerDefeated(name)`、`areAlliedPlayers(a,b)`、`getVisibleUnits(name, 'self'|..., filter?)` → id 数组、`getUnitData(id)`、`getGeneralRules().baseUnit`（MCV 名列表）、`getTickRate()`（60）、`getCurrentTick()`、`canPlaceBuilding(player, buildingName, tile)`、`getBuildingPlacementData(name)`、`getVisibleHostileObjects(playerObject)`。
- `getTile(x,y)`、`getAllTilesResourceData()` **不在 GameApi 上，而在 `g.map` 上**。runtime 启动时会把它们代理到 `g` 上。
- `getVisibleHostileObjects` 传**玩家对象**（`game.getPlayerByName(name)`），返回**引擎对象数组**（不是 id），包含中立单位，需按 `o.owner.name` 过滤。
- `getUnitData` 在对局销毁后会抛异常。

## 3. 命令接口（`C.my`）
- `orderUnits(ids, orderType, x, y)`：对地面格子下令（移动、攻击移动）。
- `orderUnits(ids, 2 /*Attack*/, objectId)`：只传一个参数时是**攻击指定对象**（拆建筑要用这个）。
- `orderUnits([mcvId], 10 /*DeploySelected*/)`：展开 MCV。
- `queueForProduction(queueType, name, objectType, qty)`；`unqueueFromProduction(queueType, name, objectType, qty)`（取消并退款，已实测）；`placeBuilding(name, x, y)`；`toggleRepairWrench(buildingId)`；`sellObject(id)`；`quitGame()`。
- 生产队列原始对象：`game.getPlayerByName(me).production.getQueue(type)` → `{status, currentSize, getAll() → [{rules, progress}]}`；`production.getAvailableObjects()` → rules 列表。

## 4. 引擎对象字段（`game.getObjectById(id)`）
`name`、`rules`（`cost`、`power`（正=发电，负=耗电）、`constructionYard`、`refinery`、`harvester`、`isBaseDefense`、`engineer`、`consideredAircraft`、`speed`、`deployer`）、`tile.rx/ry`、`centerTile`（建筑）、`healthTrait.hitPoints/maxHitPoints`、`owner.name`、`zone`（1=空中）、`stance`、`unitOrderTrait.orders`（空数组=空闲）、`isBuilding() / isVehicle() / isInfantry() / isAircraft()`、`isDestroyed`。

## 5. 枚举
- 队列 QueueType：0 Structures、1 Armory（防御）、2 Infantry、3 Vehicles、4 Aircrafts、5 Ships
- 队列状态：0 Idle、1 Active、2 OnHold、3 Ready（建筑造好待放置）
- ObjectType：1 Aircraft、2 Building、3 Infantry、7 Vehicle
- OrderType：0 Move、1 ForceMove、2 Attack、3 ForceAttack、4 AttackMove、5 Guard、6 GuardArea、7 Capture、8 Occupy、9 Deploy、10 DeploySelected、11 Stop、13 Dock、14 Gather、15 Repair、16 Scatter、17 EnterTransport

## 6. 单位/建筑名
- 盟军：GACNST 建造厂、GAPOWR 电厂、GAREFN 矿厂、GAPILE 兵营、GAWEAP 战车工厂、GAAIRC 空指部、GADEPT 维修厂、GATECH 作战实验室、GAPILL 碉堡、NASAM 爱国者、ATESLA 光棱塔、GAGAP 裂缝产生器；CMIN 超时空矿车、MTNK 灰熊、FV 多功能步兵车、SREF 光棱坦克、E1 美国大兵、ADOG 军犬、ENGINEER 工程师、JUMPJET 火箭飞行兵、AMCV 基地车
- 苏军：NACNST、NAPOWR、NAREFN、NAHAND、NAWEAP、NARADR、NADEPT、NATECH、NALASR 哨戒炮、NAFLAK 防空炮、TESLA 磁暴线圈；HARV 武装采矿车、HTNK 犀牛、HTK 防空履带车、APOC 天启、E2 动员兵、DOG、FLAKT 防空步兵、SENGINEER、SMCV
- 不确定的名字以 `intel({detail:true}).available` 为准。

## 7. 坑点清单（都踩过）
1. **截图不可靠**：WebGL 画布经常返回旧帧，曾经把旧帧误判成"失败"结算画面。局势一律用接口判断。
2. **攻击移动（4）不打普通建筑**：只自动打单位和防御塔。部队曾在敌方基地里站了 3 分钟，建筑一直满血。拆建筑必须用 Attack(2) 加对象 id（runtime 的 siege 已处理）。
3. **进攻中改 attackTarget 以前不生效**：runtime 现已在 `apply` 里同步更新进行中的进攻。
4. 开局读矿区要在建造厂出现后；太早会读到 0。
5. 页面加载后可能弹出"检测到不受支持的图形卡"，点"使用低质量设置"。
6. 浏览器面板尺寸会变，菜单坐标跟着变（800x668 / 800x620 都出现过）。每次点击前先截图，按本次截图报告的坐标系换算。
7. 从页面 fetch `http://127.0.0.1` 会被浏览器拦截（公网页面访问本机网络）。所以 runtime 默认靠粘贴 install.js 装进 localStorage，页面里 `eval` 可用。例外是 `https://raw.githubusercontent.com/...` 允许跨域：如果本地 runtime.js 和 GitHub 上某个已推送提交完全一致，可以在页面里按提交哈希 fetch 下来再 eval，省去粘贴 3 万多字符。
12. 在 `mcp__Claude_Browser__resize_window` 模拟的视口里，canvas 点击可能不生效。点菜单要用面板原生尺寸（preset desktop）；面板太矮、按钮被截掉时，请用户把浏览器面板拉高。
8. 研究接口时游戏照常在跑，闲置几分钟基地就会被 AI 推平。先把脚本准备好再开局。
9. 刷新页面会清空所有注入，要重新执行 arm.js（localStorage 里的 runtime 还在）。
10. `javascript_tool` 单次调用超过 45 秒会超时。在页面里等待的时间不要超过约 30 秒，长时间监控要拆成多次调用。
11. 对手阵营和出生点每局可能不同（match-003 双方出生点互换，AI 变成苏军）。档案里的坐标、路线要按当局出生点换算，单位名要按阵营换算。

## 8. 游戏更新后如何重新逆向
- 下载 `https://<站点>/js/app.js?v=<版本>`，用 Python 搜索：`orderUnits(`、`placeBuilding(`、`queueForProduction(`、`getQueueData(`、`[s.DeploySelected=`、`[s.Active=`、`getVisibleHostileObjects(`、`getTile(e,t){`、`this.gameApi`、`this.actionQueue`。
- 注意 grep 可能被别名成 ugrep，复杂正则会超限，用 Python 更稳。
- 验证顺序：陷阱能否抓到对象 → 展开 MCV → 排产并放置一座电厂 → 部队移动 → Attack 指定建筑。
