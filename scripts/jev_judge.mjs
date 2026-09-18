#!/usr/bin/env node
// Evaluation bridge: ask jev typed questions about a game state.
//
// Why the SDK and not plain HTTP: Vercel documents that the evaluation modality is
// available through the AI SDK only -- not through the OpenAI-compatible,
// Anthropic-compatible or Cohere-compatible endpoints. Hand-posting the SDK's own
// route (POST {base}/evaluation-model with an "ai-model-id" header) returns 404 on
// this deployment, so the SDK is the supported path.
//
// Usage:
//   node scripts/jev_judge.mjs <scenario.json>     # {state, questions}
//   echo '{"state":..., "questions":{...}}' | node scripts/jev_judge.mjs
//
// Prints the answers plus the round-trip time. The timing is the number that
// decides whether this can sit inside a live command loop: the in-game executor
// ticks every 250ms and an attack decision has a window of a few seconds.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));

// The gateway provider resolves AI_GATEWAY_API_KEY from the environment at request
// time. Seed it from the repo .env first, and never print it.
function loadKey() {
  if (process.env.AI_GATEWAY_API_KEY) return;
  let text;
  try {
    text = readFileSync(join(REPO, '.env'), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[1] === 'AI_GATEWAY_API_KEY') {
      process.env.AI_GATEWAY_API_KEY = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
loadKey();

if (!process.env.AI_GATEWAY_API_KEY) {
  console.error(JSON.stringify({ ok: false, error: 'AI_GATEWAY_API_KEY missing (env or repo .env)' }));
  process.exit(1);
}

const { experimental_evaluate: evaluate } = await import('ai');
const { gateway } = await import('@ai-sdk/gateway');

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

const arg = process.argv[2];
const raw = arg ? readFileSync(arg, 'utf8') : await readStdin();
if (!raw.trim()) {
  console.error(JSON.stringify({ ok: false, error: 'no scenario on argv[2] or stdin' }));
  process.exit(1);
}

let scenario;
try {
  scenario = JSON.parse(raw);
} catch (e) {
  console.error(JSON.stringify({ ok: false, error: 'scenario is not valid JSON: ' + e.message }));
  process.exit(1);
}

const started = Date.now();
try {
  const result = await evaluate({
    model: gateway.evaluationModel('typesafe-ai/jev'),
    state: scenario.state,
    questions: scenario.questions,
  });
  const ms = Date.now() - started;
  console.log(JSON.stringify({
    ok: true,
    model: 'typesafe-ai/jev',
    roundTripMs: ms,
    answers: result.answers,
    usage: result.usage,
    warnings: result.warnings,
  }, null, 2));
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    roundTripMs: Date.now() - started,
    error: e?.message ?? String(e),
  }, null, 2));
  process.exit(1);
}
