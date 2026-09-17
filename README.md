# ra2-commander

**让 Claude 的多个 AI Agent 实时指挥网页版红色警戒2，在 [gonghui.k0s.cn](https://gonghui.k0s.cn/)（《王二火大 / Chrono Divide》）上和电脑 AI 打遭遇战，并且每打一局就复盘、学习对手、进化出下一代打法。**

> A [Claude Code](https://claude.com/claude-code) skill that lets multiple AI agents command a Red Alert 2 web remake (Chrono Divide / 王二火大 at gonghui.k0s.cn) in real time against the built-in AI, then review each match, learn the opponent's tactics, and evolve the next generation of strategy.

---

## 它能做什么

- **接管游戏**：在页面里注入一个 250ms 的执行层，自动完成展开基地车、建造、生产、放置建筑、部队集结、迎击、修理、进攻和拆家。
- **多 Agent 实时指挥**（至少 2 个 subagent 同时在线）：
  - **指挥官**：读战场情报，调整姿态（守/攻/骚扰）、兵种比例、防御、出击时机。
  - **情报分析员**：盯对手的建造、兵力、行军路线，对照对手档案，提前发预警。
  - **后勤官**（可选第三个）：负责经济和生产节奏。
- **赛后学习**：复盘学习员导出全局数据，生成双方时间线，更新**对手档案**和**战术库**（每条战术带证据和置信度）。
- **进化**：基于证据生成下一代方案（带版本谱系和战绩）。下一局自动使用最新方案；新方案连续输棋时回退。

## 实战记录

| 对局 | 打法 | 结果 |
|---|---|---|
| match-001 | 固定脚本，没有 agent | 3:45 被 AI 的一波 10 单位主攻推平 |
| match-002 | 执行层 + 实时指挥官 subagent | **7:27 胜利**，零建筑损失，拆光 AI 全部建筑 |
| match-003 | 指挥官 + 情报分析员同时在线（skill 首次完整测试） | 进行中。分析员识破了"出生点互换、AI 换成苏军"，并提前 60 秒预警 20 人动员兵冲锋 |

这些经验已经作为初始知识写进 `assets/seed/`：方案 v000→v002、对手档案 `ai-easy`、战术库 T-001～T-010。

## 架构

```
┌────────────────────────── 浏览器页面（gonghui.k0s.cn）──────────────────────────┐
│  游戏引擎 ──Object.prototype 陷阱──▶ GameApi / 命令接口                            │
│                                         │                                          │
│  runtime.js 执行层（每 250ms）：生产 · 放置 · 部队 · 反射 · 攻城 · 记录器          │
│      ▲ plan（按角色分配写权限）          │ intel（公平视野，每个读者独立游标）     │
└──────┼───────────────────────────────────┼─────────────────────────────────────────┘
       │ C.apply / C.advise                ▼
  ┌──────────┐   ┌──────────────┐   ┌────────────┐
  │ 指挥官   │◀──│ 情报分析员    │   │ 后勤官(可选)│   ← 实时 subagent（约 10–15 秒一轮）
  └──────────┘   └──────────────┘   └────────────┘
       │ 对局结束
       ▼
  ┌──────────────┐  归档 → 时间线 → 对手档案 / 战术库 → 下一代方案 → 执行层问题清单
  │ 复盘学习员    │─────────────────────────────────────────────────────────────────▶ 下一局
  └──────────────┘
```

设计要点：
- **反应和决策分层**：LLM 思考一轮要 10–30 秒，战斗却是秒级的。秒级反应（迎击、补电、修理、防空、撤退、集火建筑）由执行层完成；agent 只负责战略参数。
- **公平视野**：实时 agent 只能读我方可见的情报。全视野的记录器数据只在赛后复盘时使用。
- **进化数据和代码分离**：战绩、方案版本、对手档案、战术库保存在 `~/.claude/ra2-commander/`，升级 skill 不会丢失。

## 环境要求

- [Claude Code](https://claude.com/claude-code) **桌面版**（Code 标签页），需要内置浏览器面板（`mcp__Claude_Browser__*` 工具）来打开并注入游戏页面。
- Python 3.8+（运行 `scripts/*.py`）
- Node.js（可选，只用于 `node --check` 做语法检查）
- 已测试环境：gonghui.k0s.cn 客户端 v0.87.0，单机模式 → 遭遇战，AI-简单，地图"岛屿之战 (2)"。

## 安装

把仓库克隆到 Claude Code 的用户级 skills 目录：

```bash
git clone https://github.com/lukeliu95/ra2-commander.git ~/.claude/skills/ra2-commander
```

重新打开 Claude Code 会话后，skill 列表里会出现 `ra2-commander`。

## 使用

在 Claude Code 桌面版里直接说：

```
打开 https://gonghui.k0s.cn/ ，用 ra2-commander 打一局遭遇战
```

或者更具体一些：

```
用 ra2-commander 打一局，开指挥官、情报分析员和后勤官三个 agent，打完复盘并进化方案
```

Claude 会按 `SKILL.md` 的流程执行：

1. `evolve.py init / status`：初始化数据目录，查看当前方案版本和战绩。
2. 在内置浏览器打开游戏，停在主菜单。
3. `evolve.py new-match`：生成本局目录、注入代码（install.js / arm.js）和各角色任务书，在**开局前**注入执行层。
4. 并行派出实时 agent（默认指挥官 + 情报分析员）。
5. 点击 单机模式 → 遭遇战 → 开始游戏。执行层第一秒接管，agent 实时指挥。
6. 对局结束后，派出复盘学习员：归档、更新对手档案和战术库、晋升新方案版本、列出执行层问题。
7. 向你汇报胜负、关键决策、对手的新打法和进化内容。

中途可以随时插话，例如"没有敌军就直接拆主基地和电厂"。Claude 会把指令转成方案修改，或者给执行层打补丁。

### 常用命令

```bash
S=~/.claude/skills/ra2-commander/scripts
python3 $S/evolve.py status                                   # 方案版本谱系和战绩
python3 $S/evolve.py new-match --opponent ai-easy --map "岛屿之战 (2)" --roles commander,analyst,quartermaster
python3 $S/evolve.py record --match match-004 --result won --duration 430
python3 $S/evolve.py promote --candidate candidate.json --reason "T-005: 更早出击"
python3 $S/evolve.py use v002                                 # 回退到某个方案版本
python3 $S/summarize_match.py ~/.claude/ra2-commander/matches/match-004
```

数据目录可以用环境变量 `RA2_DATA` 指定。想从头开始，删掉 `~/.claude/ra2-commander/` 再运行 `init`，会重新从种子数据初始化。

## 仓库结构

```
SKILL.md                    skill 主流程（Claude 读这个）
scripts/runtime.js          页面内执行层：接管、生产、部队、反射、攻城、情报、权限、记录器
scripts/evolve.py           数据目录、开新局、生成注入代码和任务书、登记战绩、方案晋升与回退
scripts/summarize_match.py  赛后数据 → 双方时间线
agents/commander.md         实时：指挥官
agents/analyst.md           实时：情报分析员
agents/quartermaster.md     实时（可选）：后勤官
agents/learner.md           赛后：复盘学习员
references/plan-schema.md   方案字段、反射、角色权限、情报接口
references/game-api.md      引擎接口、枚举、单位名、坑点清单、游戏更新后如何重新逆向
references/ui-navigation.md 菜单操作
assets/seed/                初始经验：方案 v000–v002、对手档案、战术库、前两局记录
```

## 扩展

- **加角色**：在 `agents/` 下写任务书模板，在 `runtime.js` 的 `C.ownership` 里给它分配方案字段；只提建议的角色用 `C.advise`，不需要改代码。可以参考的方向：侦察官、空军官、微操官。
- **打更强的 AI**：`new-match --opponent ai-medium`，会建立独立的对手档案。
- **游戏更新后接口失效**：按 `references/game-api.md` 第 8 节重新定位接口。

## 使用规则

- **只用于单机模式对战电脑 AI。** 不要在排位赛或联机大厅里使用：对真人使用自动化就是作弊，skill 本身也会拒绝。
- 请尊重游戏站点和社区，不要高频刷局，也不要做任何影响服务器的操作。
- 本项目通过读取客户端内存对象、调用游戏自带 AI 使用的同一套命令接口来操作，不修改服务器，也不包含或分发任何游戏代码和素材。

## 免责声明

本项目是独立的非官方实验项目，与 Electronic Arts（EA）、《命令与征服》/《红色警戒》系列版权方、"王二火大 / Chrono Divide"项目及 gonghui.k0s.cn 站点均无任何关联。相关名称和商标归各自所有者所有。游戏客户端更新可能导致本项目失效。

## License

[MIT](LICENSE)
