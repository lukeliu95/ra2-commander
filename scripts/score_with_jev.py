#!/usr/bin/env python3
"""调用 Vercel AI Gateway 上的模型（含 typesafe-ai/jev），用于 RA2 赛后的评分/评估。

设计原则：
  - 不假设 jev 的输入输出契约。第一次成功调用时把**原始响应**完整打出来，
    用真实返回来确定它到底是 chat 补全、打分，还是别的形状。
  - key 只从 .env 或环境变量读，绝不打印。
  - 遇到 403 customer_verification_required 时给出可直接照做的提示。

用法：
    python3 scripts/score_with_jev.py --prompt "给下面这段指挥日志打分：..."
    echo "长文本" | python3 scripts/score_with_jev.py
    python3 scripts/score_with_jev.py --model anthropic/claude-sonnet-4.5 --prompt hi
    python3 scripts/score_with_jev.py --list-models | head
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
BASE = "https://ai-gateway.vercel.sh/v1"
ENV_FILE = REPO / ".env"
KEY_NAME = "AI_GATEWAY_API_KEY"


def load_key() -> str:
    """环境变量优先，其次仓库根的 .env。绝不回显。"""
    key = os.environ.get(KEY_NAME, "").strip()
    if key:
        return key
    if ENV_FILE.is_file():
        for line in ENV_FILE.read_text(encoding="utf-8", errors="replace").splitlines():
            line = line.strip()
            if line.startswith(f"{KEY_NAME}="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit(f"找不到 {KEY_NAME}：既不在环境变量里，也不在 {ENV_FILE}")


def call(path: str, key: str, payload: dict | None = None) -> tuple[int, str]:
    req = urllib.request.Request(
        f"{BASE}{path}",
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:  # 网络层
        return 0, json.dumps({"transport_error": str(e)})


def explain(status: int, body: str) -> None:
    if status == 200:
        return
    try:
        etype = (json.loads(body).get("error") or {}).get("type", "")
    except Exception:
        etype = ""
    if status == 403 and "customer_verification_required" in (etype + body):
        print(
            "\n[阻塞] 403 customer_verification_required —— 这是**账号级**门槛，"
            "与模型无关（任何模型都会 403，含 $0 免费档）。\n"
            "       需要先去 Vercel 账号挂一张支付方式：\n"
            "       https://vercel.com/d?to=%2F%5Bteam%5D%2F%7E%2Fai%3Fmodal%3Dadd-credit-card\n"
            "       加完之后重跑本脚本即可。",
            file=sys.stderr,
        )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="typesafe-ai/jev")
    ap.add_argument("--prompt", default=None, help="提示词；省略则从 stdin 读")
    ap.add_argument("--max-tokens", type=int, default=None)
    ap.add_argument("--temperature", type=float, default=None)
    ap.add_argument("--list-models", action="store_true", help="打印可用模型 id")
    ap.add_argument("--raw", action="store_true", help="只打印原始响应体")
    a = ap.parse_args()

    key = load_key()

    if a.list_models:
        st, body = call("/models", key)
        if st != 200:
            print(f"GET /models -> {st}\n{body}", file=sys.stderr)
            explain(st, body)
            return 1
        data = json.loads(body)
        for m in data.get("data", data):
            if isinstance(m, dict):
                print(m.get("id", ""))
        return 0

    prompt = a.prompt
    if prompt is None:
        prompt = sys.stdin.read()
    if not prompt.strip():
        sys.exit("提示词为空：用 --prompt 或从 stdin 传")

    payload: dict = {
        "model": a.model,
        "messages": [{"role": "user", "content": prompt}],
    }
    if a.max_tokens is not None:
        payload["max_tokens"] = a.max_tokens
    if a.temperature is not None:
        payload["temperature"] = a.temperature

    st, body = call("/chat/completions", key, payload)
    print(f"model={a.model}  http={st}", file=sys.stderr)

    if a.raw or st != 200:
        print(body)
        explain(st, body)
        return 0 if st == 200 else 1

    # 首次成功：把原始响应也留下，便于确定 jev 的真实契约
    try:
        data = json.loads(body)
    except Exception:
        print(body)
        return 0
    choices = data.get("choices")
    if isinstance(choices, list) and choices:
        msg = choices[0].get("message") or {}
        print(msg.get("content", ""))
    else:
        print(json.dumps(data, ensure_ascii=False, indent=2))
    print("\n--- 原始响应（确认契约用）---", file=sys.stderr)
    print(json.dumps(data, ensure_ascii=False)[:2000], file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
