#!/usr/bin/env python3
"""Call the Vercel AI Gateway evaluation endpoint with a real RA2 decision.

Contract (from vercel/ai packages/gateway/src/gateway-evaluation-model.ts):
  POST {baseURL}/evaluation-model
  headers: Authorization: Bearer <key>
           ai-model-id: <model id>          <- the model goes in a HEADER, not the body
           ai-evaluation-model-specification-version: 4
  body:    {state, questions}
  answer:  {answers: {id: {type: choice|score|boolean, ...}}, usage}

Questions are typed:
  choice  {instructions, criteria: {key: description}}
  score   {instructions, criteria: ["worst", ..., "best"]}   (max 10 levels)
  boolean {instructions}

Prints the decision plus the round-trip time, which is what decides whether this
can sit in a live command loop at all.
"""
import importlib.util
import json
import time
import urllib.request

spec = importlib.util.spec_from_file_location("sj", "scripts/score_with_jev.py")
sj = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sj)
KEY = sj.load_key()
URL = sj.BASE + "/evaluation-model"

STATE = {
    "match": "match-018 hypothetical, t=9:34",
    "me": {"units": 31, "army_value": 21290, "credits": 0, "static_defences": 0,
           "longest_range": 5.75},
    "enemy_visible_field": {"units": 0, "value": 0},
    "enemy_at_home": {"units": 15, "value": 11130,
                      "composition": {"MGTK": 3, "SREF": 2, "JUMPJET": 6, "FV": 2, "E1": 1}},
    "enemy_home_defences": {"pillboxes": 5, "note": "all clustered on the north approach"},
    "enemy_heavy_unit": {"name": "MGTK", "range": 7, "note": "outranges every unit we own"},
    "history": "twice this match the judge read 'enemy field is empty' as 'safe to attack' and lost 16210 for 13110",
}

QUESTIONS = {
    "should_attack": {
        "type": "choice",
        "instructions": "We are deciding whether to send the army out right now to destroy the enemy base.",
        "criteria": {
            "attack_now": "Send everything out immediately",
            "hold_and_build": "Stay home, keep building army and defences",
            "raid_weak_spot": "Send a small force at the undefended south side of their base",
        },
    },
    "outcome_if_attack": {
        "type": "score",
        "instructions": "If we attack right now, how good is the outcome for us?",
        "criteria": ["disaster", "clearly bad", "even trade", "good", "decisive win"],
    },
    "enemy_outranges_us": {
        "type": "boolean",
        "instructions": "Can the enemy damage our attacking force from outside our own effective range?",
    },
    "which_asset_decides_it": {
        "type": "choice",
        "instructions": "Which asset would most change the answer if we had it?",
        "criteria": {
            "range8_tower": "A defensive tower with range 8 that outranges their heavy tank",
            "more_tanks": "More tanks of the same kind we already have",
            "air_defence": "More anti-air against their jumpjets",
            "nothing_helps": "No single asset changes the outcome",
        },
    },
}

body = json.dumps({"state": STATE, "questions": QUESTIONS}).encode()
req = urllib.request.Request(
    URL,
    data=body,
    headers={
        "Authorization": f"Bearer {KEY}",
        "Content-Type": "application/json",
        "ai-model-id": "typesafe-ai/jev",
        "ai-evaluation-model-specification-version": "4",
    },
)

t0 = time.time()
try:
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        status = r.status
except urllib.error.HTTPError as e:
    raw, status = e.read().decode(), e.code
dt = time.time() - t0

print(f"http={status}  round-trip={dt:.2f}s")
print(raw[:1200].replace(KEY, "<key>"))

if status == 200:
    data = json.loads(raw)
    print("\n--- decoded ---")
    for qid, a in data.get("answers", {}).items():
        print(f"  {qid}: {json.dumps(a, ensure_ascii=False)}")
