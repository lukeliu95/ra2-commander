#!/usr/bin/env python3
"""Match bookkeeping and plan evolution for the ra2-commander skill.

Data lives outside the skill so upgrades never wipe learned knowledge:
  $RA2_DATA (default ~/.claude/ra2-commander)
    plans/vNNN.json       {"version","parent","createdAt","reason","plan"}
    plans/current.txt     version name of the plan the next match will use
    plans/history.json    {"vNNN": [{"match","result","durationSec","opponent"}]}
    opponents/<key>.md    opponent profile (maintained by the learner agent)
    tactics.md            tactic library (maintained by the learner agent)
    matches/match-NNN/    per-match artifacts (install.js, arm.js, logs, dumps, debrief)
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import re
import shutil
import sys
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
RUNTIME = SKILL_DIR / "scripts" / "runtime.js"
SEED = SKILL_DIR / "assets" / "seed"
DATA = Path(os.environ.get("RA2_DATA", Path.home() / ".claude" / "ra2-commander"))


def runtime_version() -> str:
    return "rt-" + hashlib.sha1(RUNTIME.read_bytes()).hexdigest()[:10]


def plan_keys() -> set:
    src = RUNTIME.read_text(encoding="utf-8")
    block = re.search(r"const DEFAULT_PLAN = \{(.*?)\n  \};", src, re.S).group(1)
    top, depth = [], 0
    for ch in block:
        depth += ch in "{["
        depth -= ch in "}]"
        top.append(ch if depth == 0 else " ")
    return set(re.findall(r"(?:^|,)\s*([a-zA-Z]+):", "".join(top), re.M))


def load_json(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def save_json(p: Path, obj):
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def current_version() -> str:
    return (DATA / "plans" / "current.txt").read_text().strip()


def load_plan(version: str) -> dict:
    return load_json(DATA / "plans" / f"{version}.json", None)


def next_name(folder: Path, prefix: str, width: int) -> str:
    nums = [int(m.group(1)) for p in folder.glob(f"{prefix}*") if (m := re.match(rf"{prefix}(\d+)", p.stem if p.is_file() else p.name))]
    return f"{prefix}{(max(nums) + 1 if nums else 1):0{width}d}"


def cmd_init(_):
    DATA.mkdir(parents=True, exist_ok=True)
    copied = []
    for src in SEED.rglob("*"):
        if src.is_dir():
            continue
        dst = DATA / src.relative_to(SEED)
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            copied.append(str(dst.relative_to(DATA)))
    print(json.dumps({"dataDir": str(DATA), "copiedFromSeed": copied}, ensure_ascii=False, indent=2))


def record_rows(history: dict, version: str):
    rows = history.get(version, [])
    wins = sum(r["result"] == "won" for r in rows)
    losses = sum(r["result"] == "lost" for r in rows)
    durs = [r["durationSec"] for r in rows if r.get("durationSec") and r["result"] == "won"]
    return wins, losses, (round(sum(durs) / len(durs)) if durs else None)


def cmd_status(_):
    history = load_json(DATA / "plans" / "history.json", {})
    cur = current_version()
    out = {"dataDir": str(DATA), "runtimeVersion": runtime_version(), "currentPlan": cur, "plans": [], "recentMatches": []}
    for p in sorted((DATA / "plans").glob("v*.json")):
        meta = load_json(p, {})
        w, l, avg = record_rows(history, meta["version"])
        out["plans"].append({"version": meta["version"], "parent": meta.get("parent"), "wins": w, "losses": l,
                             "avgWinSec": avg, "reason": (meta.get("reason") or "")[:120]})
    for m in sorted((DATA / "matches").glob("match-*"))[-5:]:
        res = load_json(m / "result.json", {})
        out["recentMatches"].append({"match": m.name, **{k: res.get(k) for k in ("result", "durationSec", "planVersion", "opponent")}})
    print(json.dumps(out, ensure_ascii=False, indent=2))


def cmd_new_match(a):
    version = a.plan or current_version()
    plan_meta = load_plan(version)
    if not plan_meta:
        sys.exit(f"plan {version} not found")
    matches = DATA / "matches"
    matches.mkdir(parents=True, exist_ok=True)
    match_id = next_name(matches, "match-", 3)
    mdir = matches / match_id
    mdir.mkdir()
    rv = runtime_version()
    roles = [r.strip() for r in a.roles.split(",") if r.strip()]
    seed = {"matchId": match_id, "planVersion": version, "runtimeVersion": rv, "roles": roles, "plan": plan_meta["plan"]}
    save_json(mdir / "match.json", {"matchId": match_id, "createdAt": dt.datetime.now().isoformat(timespec="seconds"),
                                    "opponent": a.opponent, "map": a.map, "roles": roles, "planVersion": version, "runtimeVersion": rv})
    save_json(mdir / "plan_used.json", plan_meta)
    runtime_src = RUNTIME.read_text(encoding="utf-8")
    (mdir / "install.js").write_text(
        runtime_src
        + f"\nlocalStorage.setItem('ra2cmd:runtime', '(' + ra2Runtime.toString() + ')()');"
        + f"\nlocalStorage.setItem('ra2cmd:runtimeVersion', '{rv}');\n'installed {rv}'\n", encoding="utf-8")
    (mdir / "arm.js").write_text(
        "(() => {\n"
        f"  const need = '{rv}', have = localStorage.getItem('ra2cmd:runtimeVersion');\n"
        "  if (have !== need) return `NEED_INSTALL: page has ${have}, need ${need}`;\n"
        f"  window.__RA2_SEED = {json.dumps(seed, ensure_ascii=False)};\n"
        "  return (0, eval)(localStorage.getItem('ra2cmd:runtime'));\n"
        "})()\n", encoding="utf-8")
    briefs = render_briefs(mdir, match_id, a.opponent, roles, a.tab)
    print(json.dumps({"matchId": match_id, "matchDir": str(mdir), "planVersion": version, "runtimeVersion": rv, "roles": roles,
                      "installJs": str(mdir / "install.js"), "armJs": str(mdir / "arm.js"), "agentBriefs": briefs}, ensure_ascii=False, indent=2))


def render_briefs(mdir: Path, match_id: str, opponent: str, roles: list, tab: str) -> dict:
    values = {"TAB_ID": tab, "MATCH_ID": match_id, "MATCH_DIR": str(mdir), "DATA_DIR": str(DATA), "SKILL_DIR": str(SKILL_DIR),
              "OPPONENT": opponent, "ROLES": ",".join(roles)}
    out = {}
    for role in [*roles, "learner"]:
        tpl = SKILL_DIR / "agents" / f"{role}.md"
        if not tpl.exists():
            sys.exit(f"no agent template for role '{role}' ({tpl})")
        text = tpl.read_text(encoding="utf-8")
        for k, v in values.items():
            text = text.replace("{{" + k + "}}", v)
        dst = mdir / "agents" / f"{role}.md"
        dst.parent.mkdir(exist_ok=True)
        dst.write_text(text, encoding="utf-8")
        out[role] = str(dst)
    return out


def cmd_record(a):
    mdir = DATA / "matches" / a.match
    info = load_json(mdir / "match.json", None)
    if not info:
        sys.exit(f"{a.match} not found")
    res = {"match": a.match, "result": a.result, "durationSec": a.duration, "planVersion": info["planVersion"],
           "opponent": info.get("opponent"), "notes": a.notes, "recordedAt": dt.datetime.now().isoformat(timespec="seconds")}
    save_json(mdir / "result.json", res)
    history_path = DATA / "plans" / "history.json"
    history = load_json(history_path, {})
    rows = [r for r in history.get(info["planVersion"], []) if r["match"] != a.match]
    rows.append({k: res[k] for k in ("match", "result", "durationSec", "opponent")})
    history[info["planVersion"]] = rows
    save_json(history_path, history)
    w, l, avg = record_rows(history, info["planVersion"])
    print(json.dumps({"recorded": res, "planRecord": {"wins": w, "losses": l, "avgWinSec": avg}}, ensure_ascii=False, indent=2))


def cmd_promote(a):
    cand = load_json(Path(a.candidate), None)
    if cand is None:
        sys.exit("candidate not found")
    plan = cand.get("plan", cand)
    unknown = set(plan) - plan_keys()
    if unknown:
        sys.exit(f"unknown plan fields: {sorted(unknown)} (allowed: {sorted(plan_keys())})")
    parent = a.parent or current_version()
    merged = {**load_plan(parent)["plan"], **plan}
    version = next_name(DATA / "plans", "v", 3)
    save_json(DATA / "plans" / f"{version}.json", {"version": version, "parent": parent,
              "createdAt": dt.datetime.now().isoformat(timespec="seconds"), "reason": a.reason, "plan": merged})
    (DATA / "plans" / "current.txt").write_text(version + "\n")
    diff = {k: {"from": load_plan(parent)["plan"].get(k), "to": v} for k, v in merged.items() if load_plan(parent)["plan"].get(k) != v}
    print(json.dumps({"promoted": version, "parent": parent, "diff": diff}, ensure_ascii=False, indent=2))


def cmd_use(a):
    if not load_plan(a.version):
        sys.exit(f"plan {a.version} not found")
    (DATA / "plans" / "current.txt").write_text(a.version + "\n")
    print(json.dumps({"current": a.version}))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("init").set_defaults(fn=cmd_init)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    p = sub.add_parser("new-match")
    p.add_argument("--opponent", default="ai-easy", help="opponent key, e.g. ai-easy / ai-medium / ai-hard")
    p.add_argument("--map", default="unknown")
    p.add_argument("--roles", default="commander,analyst", help="real-time agent roles; add quartermaster to split economy control")
    p.add_argument("--plan", help="plan version to use (default: current)")
    p.add_argument("--tab", default="seed", help="Claude Browser tabId running the game")
    p.set_defaults(fn=cmd_new_match)
    p = sub.add_parser("briefs", help="re-render agent briefs for an existing match (e.g. after editing templates)")
    p.add_argument("--match", required=True)
    p.add_argument("--tab", default="seed")
    p.set_defaults(fn=lambda a: print(json.dumps(render_briefs(DATA / "matches" / a.match, a.match,
                   load_json(DATA / "matches" / a.match / "match.json", {}).get("opponent", "ai-easy"),
                   load_json(DATA / "matches" / a.match / "match.json", {}).get("roles", []), a.tab), ensure_ascii=False, indent=2)))
    p = sub.add_parser("record")
    p.add_argument("--match", required=True)
    p.add_argument("--result", required=True, choices=["won", "lost", "aborted"])
    p.add_argument("--duration", type=int, required=True, help="game seconds")
    p.add_argument("--notes", default="")
    p.set_defaults(fn=cmd_record)
    p = sub.add_parser("promote")
    p.add_argument("--candidate", required=True, help="JSON file with plan fields to change (partial is fine)")
    p.add_argument("--reason", required=True)
    p.add_argument("--parent", help="base version (default: current)")
    p.set_defaults(fn=cmd_promote)
    p = sub.add_parser("use")
    p.add_argument("version")
    p.set_defaults(fn=cmd_use)
    a = ap.parse_args()
    a.fn(a)


if __name__ == "__main__":
    main()
