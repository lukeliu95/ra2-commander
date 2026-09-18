#!/usr/bin/env node
// Replay historical attack decisions through jev.
//
// The point is falsification, not demonstration. match-017 auto-attacked twice into
// an intact base and lost 16210 for 13110 (2.19x and 2.08x value advantage); the
// same reflex correctly refused twice at *lower* ratios (1.69x, 1.93x); match-015
// auto-attacked once and won. If jev is going to be useful as the attack judge it
// has to separate the first two from the last one -- on the data that was actually
// available at the time, not on hindsight.
//
// Usage: node scripts/replay_jev.mjs <case.json>
//   { "cases": [ {"id": "...", "match": "match-017", "t": 139, "outcome": "..."} ] }

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const DATA = process.env.RA2_DATA || join(homedir(), '.claude', 'ra2-commander');

function loadKey() {
  if (process.env.AI_GATEWAY_API_KEY) return;
  try {
    for (const line of readFileSync(join(REPO, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && m[1] === 'AI_GATEWAY_API_KEY') process.env.AI_GATEWAY_API_KEY = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
}
loadKey();

const { experimental_evaluate: evaluate } = await import('ai');
const { gateway } = await import('@ai-sdk/gateway');

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const QUESTIONS = {
  should_attack: {
    type: 'choice',
    instructions: 'We must decide whether to send our army out to destroy the enemy base right now.',
    criteria: {
      attack_now: 'Send the army out now',
      hold_and_build: 'Stay home, keep building army and defences',
      raid_weak_spot: 'Send a small force at a part of their base that is not defended',
    },
  },
  outcome_if_attack: {
    type: 'score',
    instructions: 'If we attack right now, how good is the outcome for us?',
    criteria: ['disaster', 'clearly bad', 'even trade', 'good', 'decisive win'],
  },
  base_is_soft: {
    type: 'boolean',
    instructions: 'Is the enemy base currently soft enough that our army can demolish it?',
  },
};

function stateFrom(snap, meKey, enemyKey, meta) {
  const me = snap.players[meKey];
  const en = snap.players[enemyKey];
  const defNames = meta.defenceNames || [];
  const enemyDefences = Object.fromEntries(
    Object.entries(en.buildings).filter(([n]) => defNames.includes(n)));
  const myDefences = Object.fromEntries(
    Object.entries(me.buildings).filter(([n]) => defNames.includes(n)));
  const state = {
    time: `${Math.floor(snap.t / 60)}:${String(snap.t % 60).padStart(2, '0')}`,
    my_army: { count: me.army.count, value: me.army.value, composition: me.units },
    my_buildings: me.buildings,
    my_credits: me.credits,
    enemy_army: { count: en.army.count, value: en.army.value, composition: en.units, position: en.army.at },
    enemy_buildings: en.buildings,
    enemy_known_static_defences: enemyDefences,
    enemy_credits: en.credits,
  };
  // Framed variant: hand it the discriminating facts our own rules learned the hard way,
  // instead of raw counts. If jev cannot get the historical outcomes right even with these,
  // it is not a judging problem that better framing can fix.
  if (meta.framed) {
    const ranges = meta.rangeTable || {};
    const enemyMaxRange = Math.max(0, ...Object.keys(en.units).map(n => ranges[n] || 0));
    const myMaxRange = Math.max(0, ...Object.keys(me.units).concat(Object.keys(me.buildings)).map(n => ranges[n] || 0));
    state.observations = {
      enemy_units_that_outrange_everything_we_have:
        Object.keys(en.units).filter(n => (ranges[n] || 0) > myMaxRange),
      our_longest_range: myMaxRange,
      enemy_longest_range: enemyMaxRange,
      we_own_an_anti_armour_tower: Object.keys(me.buildings).some(n => /CTESLA|TESLA|ATESLA/.test(n)),
      enemy_known_static_defence_count: Object.keys(enemyDefences).reduce((s, n) => s + enemyDefences[n], 0),
      enemy_army_is_at_its_own_base: true,
      enemy_still_has_production_buildings:
        Object.keys(en.buildings).filter(n => /CNST|WEAP|HAND|AIRC|RADR/.test(n)),
      note: 'Enemy units listed as at its own base are the only enemy force; this platform has no fog of war.',
    };
  }
  return state;
}

for (const c of spec.cases) {
  const dir = join(DATA, 'matches', c.match);
  const snaps = JSON.parse(readFileSync(join(dir, 'snapshots.json'), 'utf8'));
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
  const snap = snaps.reduce((best, s) => Math.abs(s.t - c.t) < Math.abs(best.t - c.t) ? s : best, snaps[0]);
  const state = stateFrom(snap, meta.me || 'Player 1', meta.enemies?.[0] || '@@AI2@@', c);
  const started = Date.now();
  try {
    const r = await evaluate({ model: gateway.evaluationModel('typesafe-ai/jev'), state, questions: QUESTIONS });
    const a = r.answers;
    console.log(`${c.id}  (${c.match} @ ${state.time}, actual outcome: ${c.outcome})  ${Date.now() - started}ms`);
    console.log(`   should_attack = ${a.should_attack.choice}` +
      (a.should_attack.probabilities ? `  ${JSON.stringify(a.should_attack.probabilities)}` : ''));
    console.log(`   outcome_if_attack = ${a.outcome_if_attack.score}` +
      (a.outcome_if_attack.probabilities ? `  ${JSON.stringify(a.outcome_if_attack.probabilities)}` : ''));
    console.log(`   base_is_soft = ${a.base_is_soft.probability}`);
  } catch (e) {
    console.log(`${c.id}  ERROR: ${e?.message ?? e}`);
  }
  console.log();
}
