# 界面操作：打开游戏到开局

游戏画面是 canvas/WebGL，读不到无障碍树，只能按截图坐标点击。**每次点击前都先截图**（`computer screenshot`，scale 0.5 即可），按截图结果里报告的坐标系（如 `coordinate frame: 800x620`）换算。面板尺寸变化后坐标会整体移动，不要沿用旧坐标。

## 流程
1. `mcp__Claude_Browser__preview_start`，参数 `url: https://gonghui.k0s.cn/`；已经打开过就用 `navigate` 并传 `force: true`。
2. 等 8–10 秒加载。如果弹出"检测到不受支持的图形卡"，点"使用低质量设置"。
3. 主菜单右侧按钮从上到下：排位赛、联机大厅、**单机模式**、回放、MOD、信息与制作人员、选项。
4. **在主菜单阶段执行 arm.js**（必要时先执行 install.js），确认返回 `ra2 runtime … armed`。
5. 点"单机模式"，右侧出现"战役 / 遭遇战 / 上一页"，点"遭遇战"。点错进了"战役"（会提示下载战役资源）或"回放"，就点"上一页"返回。
6. 遭遇战设置页：左上是玩家列表（Player 1 和 AI 难度，如"AI-简单"），右侧有地图名（如"岛屿之战 (2)"）、"开始游戏"和"自订战役"。记下地图名和 AI 难度，用于 `evolve.py new-match --map --opponent`。只有用户要求时才修改设置。
7. 点"开始游戏"。10 秒内检查 `window.__cmd.started === true`，并确认 `C.log` 里出现"展开 AMCV/SMCV"。

## 参考坐标（仅在截图对得上时使用）
- 800x668 坐标系：主菜单"单机模式"约 (708,338)；子菜单"遭遇战"约 (698,298)；设置页"开始游戏"约 (698,298)。
- 800x620 坐标系：主菜单"单机模式"约 (676,314)；子菜单"遭遇战"约 (676,274)；设置页"开始游戏"约 (680,276)；"上一页"约 (680,530)。

## 禁止
- 不进入"排位赛"和"联机大厅"。自动化只用于和 AI 对战的单机模式，对真人使用就是作弊。
- 不改用户账号相关设置，不下载战役资源，除非用户明确要求。

## 结束后
- 结算画面出现后，截图可能仍是旧帧。以 `C.over` 为准。
- 复盘学习员导出数据**之前**不要刷新或离开页面：`C.rec` 和 `C.log` 只在当前页面内存里。

---

# 没有 `mcp__Claude_Browser__*` 工具时的替代方案（本机实测可用）

当环境里没有 Claude 浏览器 MCP 时，用本机 CDP 桥直接驱动一个独立 Chrome 实例。**角色任务书（`agents/*.md`）里的「工具边界」节已经写成这套用法，这里的细节是给主会话做界面导航用的。**

## 1. 启动 Chrome（两个必须的参数）

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=<工作区>/_ra2-bridge/chrome-profile \
  --no-sandbox --no-first-run --no-default-browser-check \
  about:blank &
```

- **`--no-sandbox` 不可省**：从受限 shell 启动时 Chrome 的子进程沙箱初始化会失败（日志里 `Failed to initialize sandbox. Operation not permitted`），GPU/网络进程连续崩溃，主进程随即 `Trace/BPT trap: 5` 退出。
- **不要加 `--use-gl=swiftshader`**：会被本机 ANGLE 拒绝（`Requested GL implementation not found`），GPU 进程起不来，游戏页直接判「当前浏览器不受支持 / 加载检测未通过」。保持默认 Metal ANGLE 即可（实测 `ANGLE (Apple, ANGLE Metal Renderer)`）。
- 游戏页 `gonghui.k0s.cn` 首次进入会弹一个「游戏需要您的许可来播放音频」对话框，那是**真 DOM**，直接 `document.querySelector('button.dialog-button').click()` 关掉，不必按坐标点。

## 2. 窗口高度必须够，否则按钮被裁掉

游戏 canvas 按 `窗口宽 : 600` 的比例铺满，若窗口可见高度 < 600，**底部按钮（如「开始游戏」）会被裁到屏幕外，OCR 永远找不到它**。先量一下再决定要不要放大：

```bash
node <bridge>/cdp.js resize 1320 900      # 之后 innerHeight 应 ≥ 600
```

## 3. 桥的用法

`<bridge>` 默认是工作区里的 `_ra2-bridge/`（`scripts/evolve.py` 的 `RA2_BRIDGE_DIR` 决定任务书里渲染出来的路径）。

```bash
export PATH="/opt/homebrew/bin:$PATH"     # 本机 node/python3 不在默认 PATH
node <bridge>/cdp.js list                                   # 列出页面
node <bridge>/cdp.js eval '<单表达式>'                       # 立即求值
node <bridge>/cdp.js evalstdin --target gonghui <<'JS'      # 片段：可 await，须 return
...
JS
node <bridge>/cdp.js evalfile <path.js> --target gonghui
node <bridge>/cdp.js click 917 303                          # CSS 像素坐标
node <bridge>/cdp.js shot out.png
node <bridge>/cdp.js resize 1320 900
```

`evalstdin` / `evalfile` 会把片段包进 async IIFE，所以**片段必须以 `return <值>` 结尾**；返回值原样打印到 stdout。装了 `install.js` 这类"最后一句是裸表达式"的脚本时，返回 `undefined` 是正常的——用 `localStorage.getItem('ra2cmd:runtimeVersion')` 和 `window.__cmd` 验证，别把 `undefined` 当成失败。

## 4. 看屏幕：截图 + 反色 + OCR

游戏是 WebGL canvas，读不到文字；但截图 OCR 在这台机器上完全够用。深色底浅色字直接 OCR 效果很差，**先反色再放大**：

```bash
<bridge>/see.sh 11 2 35          # 全屏：psm、放大倍数、最低置信度
<bridge>/peek.sh 870 295 200 110 6 6   # 局部：x y w h 放大倍数 psm
```

两者输出的都是 **CSS 像素坐标**，可以直接喂给 `cdp.js click`。`peek.sh` 用来精确定位小按钮；`see.sh` 用来读整屏有哪些选项。`prep.js --modes ascii --ascii-cols 150` 能把画面渲成 ASCII 图，用于判断"这块区域到底是列表、按钮还是图片"。

**实际坐标必须以当次 OCR 为准**：canvas 尺寸一变（改窗口大小、换 tab），整套坐标都会平移。本文件顶部那两组参考坐标只适用于对应尺寸，不要直接照抄。

## 5. 已知导航坐标（1320×900 窗口、canvas 1320×756 时实测）

- 主菜单：排位赛 (918,222)、联机大厅 (918,264)、**单机模式 (917,303)**、回放 (917,345)、MOD (917,388)、信息与制作人员 (917,432)、选项 (917,471)
- 单机模式子菜单：**战役 (917,219)**、**遭遇战 (917,261)**
- 遭遇战设置页右侧：**开始游戏 (951,339)**、**自订战役 (951,381)**；地图名与 AI 难度在该列上方（如 `作战 / 岛屿之战 (2)`）

窗口尺寸不同就必须重新 OCR 定位。
