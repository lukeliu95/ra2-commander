#!/usr/bin/env python3
"""Turn a match dump (meta.json, log.json, snapshots.json in a match dir) into timeline.md.

Usage: summarize_match.py <match_dir>
The snapshots are full-information recorder data, so this is a post-game replay view of BOTH players.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path


def fmt(s):
    return f"{int(s) // 60}:{int(s) % 60:02d}"


def main():
    mdir = Path(sys.argv[1])
    meta = json.loads((mdir / "meta.json").read_text(encoding="utf-8"))
    log = json.loads((mdir / "log.json").read_text(encoding="utf-8"))
    snaps = json.loads((mdir / "snapshots.json").read_text(encoding="utf-8"))
    players = list(snaps[0]["players"].keys()) if snaps else []
    me = meta.get("me")
    label = {p: ("我方" if p == me else "敌方") + f" {p}" for p in players}
    out = [f"# 对局时间线 {meta.get('matchId')}", "",
           f"- 结果：**{meta.get('result')}**，用时 {fmt(meta.get('durationSec') or 0)}",
           f"- 方案版本：{meta.get('planVersion')}，runtime：{meta.get('runtimeVersion')}",
           f"- 阵营：{json.dumps(meta.get('factions'), ensure_ascii=False)}",
           f"- 出生点：{json.dumps(meta.get('starts'), ensure_ascii=False)}", ""]

    for p in players:
        out += [f"## {label[p]}", "", "### 首次出现（建筑/单位类型）", "", "| 时间 | 类型 | 名称 |", "|---|---|---|"]
        seen = set()
        for s in snaps:
            ps = s["players"][p]
            for kind, key in (("建筑", "buildings"), ("单位", "units")):
                for name, count in ps[key].items():
                    if count > 0 and (key, name) not in seen:
                        seen.add((key, name))
                        out.append(f"| {fmt(s['t'])} | {kind} | {name} |")
        out += ["", "### 曲线（每 30 秒）", "", "| 时间 | 资金 | 余电 | 建筑数 | 矿厂 | 矿车 | 作战单位 | 部队价值 | 部队位置 |", "|---|---|---|---|---|---|---|---|---|"]
        last = -999
        for s in snaps:
            if s["t"] - last < 30 and s is not snaps[-1]:
                continue
            last = s["t"]
            ps = s["players"][p]
            refs = sum(v for k, v in ps["buildings"].items() if "REFN" in k)
            miners = sum(v for k, v in ps["units"].items() if k in ("CMIN", "HARV", "CMON", "SMIN"))
            at = ps["army"]["at"]
            pos = f"{at['x']},{at['y']}" if at else "-"
            out.append(f"| {fmt(s['t'])} | {ps['credits']} | {ps['power']} | {sum(ps['buildings'].values())} | {refs} | {miners} | "
                       f"{ps['army']['count']} | {ps['army']['value']} | {pos} |")
        peak = max(snaps, key=lambda s: s["players"][p]["army"]["value"]) if snaps else None
        if peak:
            out += ["", f"部队价值峰值：{peak['players'][p]['army']['value']}（{fmt(peak['t'])}，{peak['players'][p]['army']['count']} 个单位）", ""]

    out += ["## 交战与损失（相邻快照部队价值下降 ≥20% 或建筑减少）", "", "| 时间 | 玩家 | 部队价值变化 | 建筑变化 |", "|---|---|---|---|"]
    for a, b in zip(snaps, snaps[1:]):
        for p in players:
            va, vb = a["players"][p]["army"]["value"], b["players"][p]["army"]["value"]
            ba, bb = a["players"][p]["buildings"], b["players"][p]["buildings"]
            lost_b = {k: ba[k] - bb.get(k, 0) for k in ba if ba[k] > bb.get(k, 0)}
            if (va and vb < va * 0.8) or lost_b:
                out.append(f"| {fmt(b['t'])} | {label[p]} | {va}→{vb} | {'-' + json.dumps(lost_b, ensure_ascii=False) if lost_b else ''} |")

    out += ["", "## 决策与关键事件（执行层日志）", ""]
    keep = {"plan", "advice", "alarm", "attack", "siege", "reflex", "scout", "over", "error", "warn", "start"}
    prev = None
    for e in log:
        if e["kind"] not in keep:
            continue
        line = f"- {e['t']} [{e['kind']}{'/' + e['author'] if e.get('author') else ''}] {e['msg']}"
        if line != prev:
            out.append(line)
        prev = line

    out += ["", "## 击杀/损失汇总（每 30 秒）", "", "| 时间段 | 我方击杀 | 我方损失 |", "|---|---|---|"]
    buckets = defaultdict(lambda: {"kill": defaultdict(int), "loss": defaultdict(int)})
    for e in log:
        if e["kind"] not in ("kill", "loss"):
            continue
        m, s = map(int, e["t"].split(":"))
        b = (m * 60 + s) // 30 * 30
        j = re.search(r"(\{.*\})", e["msg"])
        if j:
            for k, v in json.loads(j.group(1)).items():
                buckets[b][e["kind"]][k] += v
        else:
            name = e["msg"].split()[-1]
            buckets[b][e["kind"]]["建筑:" + name] += 1
    for b in sorted(buckets):
        out.append(f"| {fmt(b)}–{fmt(b + 30)} | {json.dumps(dict(buckets[b]['kill']), ensure_ascii=False)} | {json.dumps(dict(buckets[b]['loss']), ensure_ascii=False)} |")

    (mdir / "timeline.md").write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"wrote {mdir / 'timeline.md'} ({len(out)} lines)")


if __name__ == "__main__":
    main()
