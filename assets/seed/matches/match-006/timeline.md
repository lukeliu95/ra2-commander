# 对局时间线 match-006

> **数据来源说明**：本局的 `window.__cmd` 在学习员拿到浏览器访问权限前已经丢失（页面已回到主菜单，`window.__cmd`/`window.game` 均为 `undefined`），无法执行标准的 `C.dump('meta'|'log'|'snapshots')` 导出，也就没有 `log.json`/`snapshots.json`，`summarize_match.py` 无法运行。本文件是**手工从 `commander_log.md` 和 `analyst_log.md` 重建**的时间线（analyst 在比赛中通过 `C.intel({detail:true})` already 读到了不少全视野字段，如资金曲线、`atEnemyHome`），信息量小于真正的全量快照，但覆盖了全部关键节点。详见 `runtime_issues.md` 里的事故记录。

- 结果：**lost**，用时 **9:25**（565 秒，本系列迄今最长的一局）
- 方案版本：v005，runtime：rt-d5b11898dd
- 阵营：我方 GA（盟军/Allied）@(135,80)；敌方 GA（盟军/Alliance）@(71,118) —— **五局以来第一次同阵营对局**
- 地图：岛屿之战 (2)，对手 ai-easy

## 关键节点对照表（我方 / 敌方）

| 时间 | 事件 | 备注 |
|---|---|---|
| 0:00 | 游戏开始，MCV 展开 | |
| 0:21 | 我方资金 7948，GAREFN 63% 在建 | |
| 0:54–0:56 | 侦察到敌方 GAPILE/GAREFN/GACNST/GAPOWR/GAWEAP/GAAIRC 全 GA 前缀 | 确认敌方盟军（Alliance），与我方同阵营，五局首次 |
| ≤1:09 | 敌方主要建筑（建造厂/电厂/兵营/矿厂/战车工厂/空指部）建齐 | 落在档案 match-001/002 区间内 |
| 1:03/1:22/1:36 | 敌方 ADOG/E1 单兵摸家 3 次 | 全部被塔+集结部队秒杀，我方仅损 1 ADOG |
| 1:47 | 我方空指部落地 | 光棱塔前置 |
| 1:47/2:02/2:17 | 骚扰再 3 次 | 零损失换全歼 |
| 2:11 | 敌方首见 FV | 档案预期 2:14–2:17，提前吻合 |
| 2:13 | 我方光棱塔 ATESLA 落地 | T-017 按时完成 |
| 2:39 | 敌方首见 MTNK | 档案预期 2:30，+9 秒 |
| 2:56 | 敌方 10–11 单位（约 3980）试探性前出到中路后撤回 | 非正式主攻 |
| 3:14 | **敌方主攻出门**：11 单位/4550（5E1+1FV+3MTNK+1ADOG），走中路 | analyst 3:14 urgent 预警 |
| 3:15–3:38 | 接敌混战（塔旁）：我方杀 2FV+3MTNK+1ADOG≈3980，损 3MTNK+4E1≈3300 | 交换比约 1.2:1，符合档案 |
| 3:38 | commander 读到「敌方 field 只剩 5 E1（900）静止，atEnemyHome:0」，**误判战斗已结束** | 实际混战仍在进行的中间态快照 |
| 3:38 | commander apply `{stance:'attack', attackMinUnits:12}`（我方 12 单位/6150，价值比 6.8 倍时下的决策） | **本局最大误判**，见下方指示 1/2 分析 |
| 3:42–4:06 | 我方在"反攻"指令生效前后又连续损失约 9 辆 MTNK、多个 E1、**2 座碉堡被拆**，GAREFN 降到 23% 血量 | 部队从 12 单位/6150 打到 **1 单位/180** |
| 3:53 | 敌方首见 JUMPJET（空军） | 档案区间 3:26–7:12 内，但为本局首次盟军局提前重度使用空军的信号 |
| 4:06 | commander 发现问题，apply `{stance:'defend', attackMinUnits:14}` 撤回 | |
| 4:27 | analyst urgent：我方兵力骤降至 3 单位/1380 | 确认同一诊断 |
| 4:37–5:36 | 双方静默重建，我方 4 单位/2280 → 12 单位/7830（7MTNK+4FV+1E1） | 恢复良好 |
| 5:00 | 我方 7 单位/4380，2 座碉堡重建，ATESLA 仍在；敌方在家 4 单位/2550（3JUMPJET+1MTNK） | |
| 5:13 | buildOrder 完成、队列闲置 105 秒 | |
| 5:52 | 敌方第二波集结 11 单位/7050（6JUMPJET+3MTNK+2FV）@(93,104) | 档案预期空军规模化出现在 7:12 后，**提前约 80 秒**，analyst 6:05 warn |
| 6:00 | 我方 apply 追加 tech（作战实验室）+ depot（维修厂）+ power | |
| 6:04–6:17 | 第二波接敌（塔旁），杀 5JUMPJET+3MTNK+1FV≈4600，损 3FV+3MTNK≈3480 | **本局防守最佳的一次交换**（约 1.3:1） |
| 6:56 | `atEnemyHome` **首次反超我方 army.value**（9/4980 vs 我方 4530，比值 1.10）——analyst 赛后确认这是信号最早可读的时间点 | 见下方指示 3 分析 |
| 7:03–7:12 | 敌方在家静止；首见 MGTK（镜像坦克，档案外新单位），atEnemyHome 涨到 10/5980（1.32 倍） | |
| 7:16 | 我方 apply `defenses.aaDef:2`（NASAM 血量仅 4%） | |
| 7:28 | atEnemyHome 11/6980（1.36 倍） | |
| 7:36–7:43 | 敌方继续囤积；首见 SREF（档案外新单位，后证明有强拆楼能力），atEnemyHome 13/9180（1.79 倍） | analyst 实际第一条囤兵专项 warn 在此时发出 |
| 8:05 | 敌方囤兵已达 15 单位/11130（2.17 倍），我方仅 8 单位/5130 | |
| 8:19 | 敌方在家囤积到 **17–18 单位/12630–13230**（我方同期 5130，**2.46–2.58 倍**）；commander 已正确识别危险，但选择先做经济调整（8:44 落地）而非立刻巩固防线/主动打断 | 见下方指示 3 的囤兵信号回溯分析 |
| 8:28 | **敌方本局最大规模主攻出门**：16 单位/12450（6JUMPJET+3MGTK+3MTNK+2SREF+2FV） | analyst 8:37 urgent：价值差 2.4 倍，建议死守不出击 |
| 8:44 | commander apply `targetRefineries 3→4, minersPerRefinery 2→3, maxMiners 12` | **经济加码来得太晚**——敌方已出动 16 分钟前 |
| 8:29–9:09 | 基地被突破：8:52/8:54 两座碉堡被拆，8:55/9:00 两座矿厂被拆，8:57 ATESLA 被拆，8:43 NASAM 被拆，我方部队 8 单位/5130 → 1 单位/180，GACNST 降到 48%→掉血 | |
| 9:10 | analyst urgent：GACNST 67%，判负前兆 | |
| 9:25 | **游戏结束，判负** | 9:09 GACNST 开始掉血，9:10 起连续损失科技/电厂/兵营/矿厂/矿车 |

## 交战与损失汇总

| 时段 | 我方战果 | 我方损失 | 交换比 |
|---|---|---|---|
| 3:14–3:38（第 1 波，混战前段） | 2FV+3MTNK+1ADOG≈3980 | 3MTNK+4E1≈3300 | ≈1.2:1（favorable） |
| 3:38–4:06（"反攻"误判段，见下） | 少量 | ≈9 MTNK + 多个 E1 + 2 碉堡 | **严重不利**（部队 6150→180） |
| 6:04–6:17（第 2 波） | 5JUMPJET+3MTNK+1FV≈4600 | 3FV+3MTNK≈3480 | ≈1.3:1（本局最佳） |
| 8:29–9:09（终局总攻） | 部分 JUMPJET/MTNK/FV/MGTK | 2 碉堡+2 矿厂+ATESLA+NASAM+GACNST 及全部部队 | **崩盘** |

## 与档案的偏差

- JUMPJET 5:52 就规模化出动（6 架），档案盟军空军通常 7:12 后才零星出现。
- 档案外新单位：**MGTK**（7:06 首见，疑似"镜像坦克"）、**SREF**（7:43 首见，疑似强攻坚/拆楼单位，终局 3 分钟内单独炸穿 2 矿厂+2 碉堡+ATESLA）。
- 攒兵规模远超档案：终局囤兵 17 单位/12630（档案约 10 单位/3200–5000，超出 2–4 倍）。

## 决策链摘要（执行层日志中 plan/advice/alarm 级别事件，从 commander_log/analyst_log 摘录）

- 0:56 `[plan/commander]` 确认盟军阵营，维持 v005 不变
- 3:14 `[advice/analyst, urgent]` 敌方主攻已出门，11 单位/4550
- 3:38 `[plan/commander]` apply `{stance:'attack', attackMinUnits:12}` —— 事后证明基于过时快照的误判
- 4:06 `[plan/commander]` apply `{stance:'defend', attackMinUnits:14}` 撤回
- 4:27 `[advice/analyst, urgent]` 我方兵力骤降至 3 单位/1380
- 6:00 `[plan/commander]` buildOrder 追加 tech+depot+power
- 6:05 `[advice/analyst, warn]` JUMPJET 提前成规模出现
- 7:16 `[plan/commander]` apply `defenses.aaDef:2`
- 7:53 `[advice/analyst, warn]` 敌方囤兵已达 9180，价值差 1.8 倍
- 8:37 `[advice/analyst, urgent]` 敌方最大规模主攻出门，价值差 2.4 倍，建议死守
- 8:44 `[plan/commander]` apply 经济加码（targetRefineries/minersPerRefinery/maxMiners）
- 9:10 `[advice/analyst, urgent]` 基地核心建筑连续失守，判负前兆

## 预警准确率（analyst_log 原文）

7 条预警全部与后续实际发展相符（100%），但预警本身只能提示、不能操作——3:42–4:11 和 8:29–9:09 两次崩盘时预警发出后局势仍继续恶化，说明这个对手的伤害速率已经超过"发现→advise→commander 决策"链路（约 15–25 秒）能挽回的范围。
