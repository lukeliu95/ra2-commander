---
name: ra2-commander
description: 用多个 subagent 实时指挥网页版红色警戒2《王二火大 / Chrono Divide》（gonghui.k0s.cn 等 ra2web 站点）的单机遭遇战：注入式执行层接管生产、建造、部队和攻城，指挥官、情报分析员（可选后勤官）实时读情报调整打法，赛后由复盘学习员更新对手档案和战术库，并进化出下一代方案。用户提到红警、红色警戒、王二火大、Chrono Divide、ra2web、"帮我打游戏""打一局遭遇战""让 AI 指挥作战""复盘对手打法""进化打法""下一局"，或者给出这类游戏网址时，都要使用本 skill，即使用户没提"skill"或"subagent"。只用于单机模式对战电脑 AI，不用于排位赛或联机大厅。
---

# ra2-commander：实时多 agent 指挥与赛后进化

## 这套系统是怎么赢的（先理解再动手）
- **反应和决策分层**。LLM 一轮思考 10–30 秒，战斗却是秒级的。所以页面里跑一个 250ms 的执行层（`scripts/runtime.js`），负责生产、建筑放置、部队操控，以及秒级反射：迎击、补电、修理、防空、撤退、集火建筑。agent 只做战略：改方案参数、发预警。
- **公平视野**。实时角色只读 `C.intel()`（我方可见的信息）；全视野的记录器数据 `C.rec` 只在赛后复盘时用。
- **每局都是一次迭代**。开局用当前最优方案 → 实时角色边打边调、边记录 → 学习员复盘，更新对手档案、战术库，生成下一代方案，列出执行层问题 → 主会话审核并修代码 → 下一局。
- 进化数据放在 `$RA2_DATA`（默认 `~/.claude/ra2-commander/`），和 skill 代码分开，升级 skill 不会丢失积累。

## 文件
- `scripts/runtime.js`：执行层、情报、攻城、角色权限、赛后记录器（带版本号，装进页面 localStorage）
- `scripts/evolve.py`：`init`、`status`、`new-match`（生成本局的 install.js / arm.js）、`record`、`promote`、`use`
- `scripts/summarize_match.py`：把赛后导出的数据整理成双方时间线
- `agents/commander.md`、`agents/analyst.md`、`agents/quartermaster.md`（实时角色）；`agents/learner.md`（赛后角色）
- `references/plan-schema.md`：plan 字段、反射、权限、intel 接口。修改方案或处理用户中途指令时读。
- `references/game-api.md`：引擎接口、枚举、单位名、坑点清单、游戏更新后如何重新逆向。runtime 报错或行为异常时读。
- `references/ui-navigation.md`：怎么点进遭遇战。每局开局前读。**本环境没有 `mcp__Claude_Browser__*` 工具，改用本机 CDP 桥 + 截图 OCR 驱动游戏页的具体做法（Chrome 启动参数、窗口高度、桥命令、看屏脚本）也写在这个文件的后半部分。**

## 流程

### 0. 边界
只在"单机模式 → 遭遇战（对 AI）"里使用。用户要打排位赛或联机大厅时，说明这等于对真人作弊，拒绝自动化。

### 1. 准备数据
```bash
python3 <skill>/scripts/evolve.py init     # 首次运行会从 assets/seed 拷贝初始经验；已有数据不覆盖
python3 <skill>/scripts/evolve.py status   # 当前方案版本、各版本胜负、最近对局、runtime 版本
```
向用户简述：本局会用哪个方案版本，它的战绩如何。

### 2. 打开游戏，停在主菜单
按 `references/ui-navigation.md` 操作。游戏加载后停在主菜单，**先不要进遭遇战**。

### 3. 建本局并注入（必须在点"开始游戏"之前）
```bash
python3 <skill>/scripts/evolve.py new-match --opponent ai-easy --map "岛屿之战 (2)" --roles commander,analyst
```
- `--opponent` 用 `ai-easy / ai-medium / ai-hard` 对应 AI 难度；地图和难度不确定就先按默认，进设置页看清后再修改 `match.json`。
- `--roles`：默认 `commander,analyst` 两个实时 agent；加上 `quartermaster` 就是三个，经济字段交给后勤官。
- 用 `mcp__Claude_Browser__javascript_tool` 检查 `localStorage.getItem('ra2cmd:runtimeVersion')`，与输出的 `runtimeVersion` 比较：
  - 不一致（首次使用，或 runtime.js 改过）：Read 本局目录的 `install.js`，把全文作为 javascript_exec 执行，应返回 `installed rt-…`。
    - 省事的做法：如果 skill 目录是 git 仓库，本地 `scripts/runtime.js` 没有未提交改动，并且当前提交已推送到 GitHub 公开仓库，可以不粘贴，直接在页面里执行：`const s = await (await fetch('https://raw.githubusercontent.com/<owner>/<repo>/<commit>/scripts/runtime.js')).text(); (0, eval)(s); localStorage.setItem('ra2cmd:runtime', '(' + ra2Runtime.toString() + ')()'); localStorage.setItem('ra2cmd:runtimeVersion', '<runtimeVersion>')`。`<runtimeVersion>` 取自 new-match 的输出；`git status` 显示 runtime.js 有改动时不要用这个方法，否则装进去的代码和版本号对不上。
  - 然后 Read `arm.js`（很短）并执行，应返回 `ra2 runtime … armed`。返回 `NEED_INSTALL` 说明上一步没装上。
- 刷新过页面就要重新执行 arm.js。

### 4. 同一条消息里并行派出实时 agent（后台）
`new-match` 已经把每个角色的任务书渲染好（占位符已替换），放在 `<matchDir>/agents/<role>.md`，输出里的 `agentBriefs` 列出了路径。每个角色一个 Agent 调用（`subagent_type: general-purpose`，`run_in_background: true`），prompt 只需要写三件事：
- 你是本局的哪个角色，先 Read 任务书全文并严格执行；
- 游戏在内置浏览器面板哪个 tab、执行层已注入、主会话马上开局，先轮询等 `__cmd.started`；
- 同时在线的还有哪些角色，分别负责什么。

任务书很长，不要整段抄进 prompt，让 agent 自己去读，免得抄错。实时 agent 要在开局**之前**派出，开局第一秒就在线；开局阶段由执行层自动处理，不用等它们读完文件。改过模板后，用 `evolve.py briefs --match <id>` 重新渲染。

**模型路由（取决于本机是否注册了 `vercel` provider）**：本仓库的约定是把 `commander` 走 Vercel AI Gateway
的 `typesafe-ai/jev`。派它**之前**先跑一次 `list_subagent_models`，按结果分两种走法：

- **看得到 `vercel`** → 显式传 `provider: vercel`、`model: typesafe-ai/jev`。其余角色
  （`analyst` / `quartermaster` / `learner`）用项目默认模型，不要跟着改。
- **看不到 `vercel`** → 按项目默认模型正常开局。这是"本机没配这个 provider"的既定行为，**不是静默回退**：
  别人克隆这个公开仓库时并没有 `vercel`，skill 不该因此拒绝服务。

  **但如果你这一局的本意就是要用 `jev`**（用户点名要用，或你正在验证这条链路），那**不要用默认模型开局**——
  去用别的模型跑一局会把"jev 行不行"这个问题悄悄变成"别的模型行不行"。先告诉用户 `vercel` 未注册
  （GUI Settings 里 provider id 用 `vercel`），等注册好再开。

**开赛前体检（指挥官走 `jev` 时必须做）**：`jev` 在 Gateway 目录里的元数据是 `type: evaluation`、
`context_window: 0`、`max_tokens: 0`、不带 `tool-use` 标签，与本项目对指挥官的预期可能不匹配。
所以在派出 commander 之后、点"开始游戏"之前，让它完成**至少一次工具调用**（例如 Read `plan_used.json`）
并把结果回出来：
- 体检通过 → 正常开局。
- 体检失败（无法调用工具 / 上下文为 0 / 直接报错）→ **不要开局**，把失败形态原样报给用户。
  指挥官拿不到工具 = 整局没有战略决策，开局只会白送一局。

### 5. 开局
进入 单机模式 → 遭遇战 → 开始游戏。10 秒内确认 `window.__cmd.started === true`，并且日志里有展开 MCV 和排产电厂。没启动的话，退出这局，刷新页面，从第 3 步重来：开局后才装的陷阱抓不到对象。

### 6. 比赛中主会话做什么
- 不和实时 agent 抢指挥。每 60–90 秒做一次健康检查：`C.log` 里有没有 error / warn，游戏时间有没有前进，`C.cursors` 里各角色的游标是否在推进（游标不动说明那个 agent 掉线了）。`javascript_tool` 单次调用超过 45 秒会超时，页面内等待控制在 30 秒以内。
- 用户中途下指令（例如"没有敌军就直接拆主基地和电厂"）：
  - 能用 plan 表达的，调用 `C.apply(patch, '用户指令：…', 'main')`，再用 SendMessage 告诉指挥官，免得它改回去。
  - plan 表达不了的（需要新的执行层行为）：先在页面热加载一个最小补丁让本局生效，同时把同样的逻辑改进 `scripts/runtime.js`（`node --check` 通过）。下一局重新 new-match 时版本号会变，自动触发重装。
- runtime 报错时读 `references/game-api.md` 排查。

### 7. 赛后复盘与进化
- 确认 `C.over` 不为 null，等实时 agent 都结束（或者主动停掉），**不要刷新页面**。
- 用 `<matchDir>/agents/learner.md` 派出复盘学习员（同样让它先 Read 任务书）。它负责导出数据、生成时间线、登记战绩、更新对手档案和战术库、promote 新方案，并写 `runtime_issues.md` 和 `debrief.md`。
- 学习员完成后，主会话读 `runtime_issues.md`。问题明确且修复有把握的，改 `scripts/runtime.js` 并用 `node --check` 验证；需要取舍的，列给用户决定。改过执行层就在 debrief 里补记。
- 用 `evolve.py status` 核对新方案版本已成为 current。

### 8. 向用户汇报
- 胜负和用时；方案版本和它的历史战绩
- 实时 agent 的关键决策
- 对手的新行为
- 进化内容：战术库新增或升级的条目、新方案版本的字段 diff、修复的执行层问题
- 相关文件：debrief.md、timeline.md、各角色 log

## 扩展更多角色
新角色需要三步：在 `agents/` 下写提示词模板；需要写方案时，在 `runtime.js` 的 `C.ownership` 里给它分配字段（字段不要和别的角色重叠，避免互相覆盖）；只提建议就用 `C.advise`，不需要改 runtime。可以参考的方向：侦察官（专门管理侦察单位）、空军官。

## 进化原则
- 每一代方案改动少而准：赢了最多改 2 个字段，输了最多改 3 个，每个改动都引用战术库条目或对局数据。
- 新版本累计输 2 局、而父版本胜率更高时，用 `evolve.py use` 回退，再换个方向改。
- 执行层的 bug 往往比参数更左右胜负（攻击移动不打建筑就是例子），复盘时优先找。
