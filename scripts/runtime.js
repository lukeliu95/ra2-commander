// ra2-commander runtime: executor + fair intel + siege + role ownership + post-game recorder.
// Installed into the page's localStorage by evolve.py's install.js; started by arm.js (window.__RA2_SEED).
function ra2Runtime() {
  const SEED = window.__RA2_SEED || {};
  const Q = {Structures: 0, Armory: 1, Infantry: 2, Vehicles: 3};
  const QN = ['Structures', 'Armory', 'Infantry', 'Vehicles'];
  const ST = {Idle: 0, Active: 1, OnHold: 2, Ready: 3};
  const ORD = {Move: 0, Attack: 2, AttackMove: 4, DeploySelected: 10};
  const SIDES = {
    GA: {power: 'GAPOWR', refinery: 'GAREFN', barracks: 'GAPILE', factory: 'GAWEAP', radar: ['GAAIRC', 'AMRADR'], tech: 'GATECH', depot: 'GADEPT', harv: 'CMIN',
      baseDef: 'GAPILL', aaDef: 'NASAM', strongDef: 'ATESLA', tank: 'MTNK', aaVehicle: 'FV', heavyTank: 'SREF', inf: 'E1', aaInf: 'JUMPJET', dog: 'ADOG', engineer: 'ENGINEER'},
    NA: {power: 'NAPOWR', refinery: 'NAREFN', barracks: 'NAHAND', factory: 'NAWEAP', radar: 'NARADR', tech: 'NATECH', depot: 'NADEPT', harv: 'HARV',
      baseDef: 'NALASR', aaDef: 'NAFLAK', strongDef: 'TESLA', tank: 'HTNK', aaVehicle: 'HTK', heavyTank: 'APOC', inf: 'E2', aaInf: 'FLAKT', dog: 'DOG', engineer: 'SENGINEER'},
    // Confederation (third faction seen in match-005). baseDef/aaDef/aaInf unconfirmed — verified from `unit_rules.json` only up to what appeared on screen.
    CA: {power: 'CAPOWR', refinery: 'CAREFN', barracks: 'CAHAND', factory: 'CAWEAP', radar: 'CARADR', tech: 'CATECH', depot: 'CADEPT', harv: 'CHAR',
      baseDef: 'NALASR', aaDef: 'NAFLAK', strongDef: 'ATESLA', tank: 'LTNK', aaVehicle: 'BGGY', heavyTank: 'HOWI', inf: 'PLA', aaInf: 'HOVI', dog: 'ADOG', engineer: 'SENGINEER'},
  };
  const DEFAULT_PLAN = {
    stance: 'defend',
    buildOrder: ['power', 'refinery', 'barracks', 'factory', 'refinery', 'power', 'radar', 'refinery', 'factory', 'power'],
    targetRefineries: 3, minersPerRefinery: 2, maxMiners: 7, maxFactories: 2,
    vehicleMix: {tank: 3, aaVehicle: 2}, infantryMix: {inf: 1}, infantryCap: 8,
    defenses: {baseDef: 2}, defenseDistance: 6, threatRadius: 14, leashRadius: 8, sortieMaxUnits: 4, minerEscort: 0,
    attackMinUnits: 14, retreatRatio: 0.35, defendRetreatRatio: 0.4, defendMinValue: 800, attackTarget: 'auto',
    siegeAutoAttackUnits: 8, siegeQuietSeconds: 10,
    scout: true, repair: true,
  };
  const ECON_FIELDS = ['buildOrder', 'targetRefineries', 'minersPerRefinery', 'maxMiners', 'maxFactories', 'infantryCap', 'repair'];

  if (window.__cmd?.timer) clearInterval(window.__cmd.timer);
  if (window.__cmd?.waitCap) clearInterval(window.__cmd.waitCap);
  const C = window.__cmd = {
    version: SEED.runtimeVersion || 'dev', matchId: SEED.matchId || null, planVersion: SEED.planVersion || null,
    started: false, over: null, seq: 0, log: [], cursors: {}, mem: {},
    plan: {...DEFAULT_PLAN, ...(SEED.plan || {})},
    ownership: SEED.roles && SEED.roles.includes('quartermaster')
      ? {commander: Object.keys(DEFAULT_PLAN).filter(k => !ECON_FIELDS.includes(k)), quartermaster: ECON_FIELDS, main: '*'}
      : {commander: '*', main: '*'},
    rec: {snapshots: []},
  };
  C.plan0 = JSON.parse(JSON.stringify(C.plan));
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const log = (kind, msg, author) => {
    const e = {seq: ++C.seq, t: C.g ? fmt(C.g.getCurrentTick() / C.g.getTickRate()) : '0:00', kind, msg};
    if (author) e.author = author;
    C.log.push(e); if (C.log.length > 4000) C.log.shift();
    console.info('[cmd]', e.t, kind, msg);
    return e;
  };

  const trap = (prop, onSet) => Object.defineProperty(Object.prototype, prop, {
    configurable: true,
    set(v) { Object.defineProperty(this, prop, {value: v, writable: true, configurable: true, enumerable: true}); try { onSet(this, v); } catch (e) {} },
    get() { return undefined; },
  });
  const cap = {};
  trap('actionQueue', self => { if (typeof self.add === 'function' && self.actionFactory && !cap.actions) cap.actions = self; });
  trap('gameApi', (self, v) => { if (v && typeof v.getPlayers === 'function') cap.gameApi = v; });
  C.waitCap = setInterval(() => {
    if (!cap.gameApi || !cap.actions) return;
    clearInterval(C.waitCap);
    delete Object.prototype.actionQueue; delete Object.prototype.gameApi;
    try { start(); } catch (e) { log('error', 'start failed: ' + e.message); }
  }, 30);

  function start() {
    const g = C.g = cap.gameApi, ai = cap.actions, game = C.game = ai.game;
    for (const fn of ['getTile', 'getAllTilesResourceData', 'getRealMapSize']) if (typeof g[fn] !== 'function' && g.map && typeof g.map[fn] === 'function') g[fn] = g.map[fn].bind(g.map);
    const players = g.getPlayers();
    const ME = C.me = players.find(p => { try { return !g.getPlayerData(p).isAi; } catch (e) { return false; } }) || 'Player 1';
    const my = C.my = new ai.constructor(game, ai.actionFactory, ai.actionQueue, {name: ME, getDebugMode: () => false});
    const player = game.getPlayerByName(ME);
    const rate = g.getTickRate();
    const enemies = C.enemies = players.filter(p => p !== ME && !g.areAlliedPlayers(ME, p));
    const starts = Object.fromEntries(players.map(p => [p, g.getPlayerData(p).startLocation]));
    const liveEnemy = () => enemies.find(p => !g.isPlayerDefeated(p)) || enemies[0];
    const enemyStart = () => starts[liveEnemy()];
    const baseUnits = g.getGeneralRules().baseUnit;
    const M = C.mem = {side: null, sideKey: null, enemyBuildings: new Map(), enemyTypes: new Map(), myIds: new Map(), enemyUnitIds: new Map(),
      armyHist: [], approach: null, alarm: false, airSeen: false, attack: null, scoutId: null, scouted: false, repairing: new Set(),
      lastOrder: new Map(), pendingPlace: 0, lastTick: {}, oreTiles: [], siegeTarget: null, siegeHit: new Map(), noArmySince: null,
      av: null, counts: null, unavail: {}, sqIdleSince: null, starved: false, sortie: null, stillTicks: new Map(), hoardSince: null, hoardWarned: 0, defend: null, defendBroken: false, airNearWarned: false,
      // Cumulative battle tallies. Both real-time roles independently mis-added the exchange ratio in match-009
      // (reported 2.8:1, actually 1.76:1 — a 59% error) because `events` is a truncated rolling window and there
      // was no running total to read. Kept here rather than parsed back out of log strings.
      costByName: {}, kills: {}, losses: {}, killValue: 0, lossValue: 0};
    const sec = () => g.getCurrentTick() / rate;
    const every = (key, s) => { const now = sec(); if (now - (M.lastTick[key] ?? -1e9) >= s) { M.lastTick[key] = now; return true; } return false; };
    // A role may map to candidates (e.g. country-specific radar); pick the one that is buildable or already owned.
    const R = n => {
      const v = M.side && M.side[n];
      if (!v) return n;
      if (!Array.isArray(v)) return v;
      return v.find(x => M.av && M.av.has(x)) || v.find(x => M.counts && M.counts[x]) || v[0];
    };
    const obj = id => { try { return game.getWorld().hasObjectId(id) ? game.getObjectById(id) : null; } catch (e) { return null; } };
    const xy = o => ({x: (o.centerTile || o.tile).rx, y: (o.centerTile || o.tile).ry});
    const d2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
    const dist = (a, b) => Math.sqrt(d2(a, b));
    const hp = o => o.healthTrait ? o.healthTrait.hitPoints / o.healthTrait.maxHitPoints : 1;
    const cost = o => o.rules.cost || 0;
    const tally = arr => arr.reduce((m, n) => (m[n] = (m[n] || 0) + 1, m), {});
    const centroid = arr => arr.length ? {x: Math.round(arr.reduce((s, o) => s + xy(o).x, 0) / arr.length), y: Math.round(arr.reduce((s, o) => s + xy(o).y, 0) / arr.length)} : null;
    const airborne = o => !!(o.rules.consideredAircraft || (o.isAircraft && o.isAircraft()) || o.zone === 1);
    const isMissile = o => !!((o.isProjectile && o.isProjectile()) || (airborne(o) && (o.rules.spawned || /ROCKET|MISL|MSSL/.test(o.name))));
    const isAir = o => airborne(o) && !isMissile(o);
    const isCombat = o => !o.isBuilding() && !o.rules.harvester && !baseUnits.includes(o.name) && !o.rules.engineer;
    const avail = () => new Set(player.production.getAvailableObjects().map(r => r.name));
    const queue = t => { try { return player.production.getQueue(t); } catch (e) { return null; } };
    const orderThrottled = (units, type, x, y, key, s) => {
      const now = sec(), k = key + ':' + x + ',' + y;
      const ids = units.filter(u => { const lo = M.lastOrder.get(u.id); return !lo || lo.k !== k || now - lo.t > s; }).map(u => u.id);
      if (!ids.length) return 0;
      my.orderUnits(ids, type, x, y);
      for (const id of ids) M.lastOrder.set(id, {k, t: now});
      return ids.length;
    };

    C.state = () => {
      const mine = g.getVisibleUnits(ME, 'self').map(obj).filter(Boolean);
      const hostile = g.getVisibleHostileObjects(player).filter(o => o && !o.isDestroyed && o.owner && enemies.includes(o.owner.name) && !isMissile(o));
      return {mine, buildings: mine.filter(o => o.isBuilding()), hostile};
    };

    function baseCenter(buildings) {
      const cy = buildings.find(b => b.rules.constructionYard);
      return cy ? xy(cy) : (buildings[0] ? xy(buildings[0]) : starts[ME]);
    }
    function enemyDir(base) {
      const target = M.approach || enemyStart();
      const len = dist(target, base) || 1;
      return {x: (target.x - base.x) / len, y: (target.y - base.y) / len};
    }
    function findSpot(name, center, maxR = 18) {
      for (let r = 1; r <= maxR; r++) {
        const ring = [];
        for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) if (Math.max(Math.abs(dx), Math.abs(dy)) === r) ring.push({x: center.x + dx, y: center.y + dy});
        ring.sort((a, b) => d2(a, center) - d2(b, center));
        for (const p of ring) {
          const tile = g.getTile(p.x, p.y);
          if (tile && g.canPlaceBuilding(ME, name, tile)) return p;
        }
      }
      return null;
    }
    function placementCenter(rules, buildings) {
      const base = baseCenter(buildings), dir = enemyDir(base), P = C.plan;
      if (rules.refinery && M.oreTiles.length) {
        const near = M.oreTiles.filter(t => d2(t, base) < 28 * 28).sort((a, b) => d2(a, base) - d2(b, base));
        const taken = buildings.filter(b => b.rules.refinery).map(xy);
        const pick = near.find(t => taken.every(r => d2(r, t) > 36)) || near[0];
        if (pick) return {x: Math.round(base.x + (pick.x - base.x) * 0.6), y: Math.round(base.y + (pick.y - base.y) * 0.6)};
      }
      if (rules.isBaseDefense) {
        const k = buildings.filter(b => b.rules.isBaseDefense).length;
        const side = (k % 3) - 1;
        return {x: Math.round(base.x + dir.x * P.defenseDistance - dir.y * side * 4), y: Math.round(base.y + dir.y * P.defenseDistance + dir.x * side * 4)};
      }
      return {x: Math.round(base.x - dir.x * 3), y: Math.round(base.y - dir.y * 3)};
    }
    function pickByMix(mix, counts, av) {
      let best = null, bestScore = -1e9;
      const total = Object.values(mix).reduce((s, w) => s + w, 0) || 1;
      const have = Object.keys(mix).reduce((s, k) => s + (counts[R(k)] || 0), 0);
      for (const [k, w] of Object.entries(mix)) {
        const n = R(k);
        if (!av.has(n) || w <= 0) continue;
        const score = (w / total) * (have + 1) - (counts[n] || 0);
        if (score > bestScore) { bestScore = score; best = n; }
      }
      return best;
    }

    const wantDefenses = (P, av) => {
      const want = {...P.defenses};
      if (M.airSeen && P.defenses.aaDef !== 0 && av.has(R('aaDef'))) want.aaDef = Math.max(want.aaDef || 0, 1);
      return want;
    };
    const wantVehicleMix = P => {
      const mix = {...P.vehicleMix};
      if (M.airSeen && P.vehicleMix.aaVehicle !== 0) mix.aaVehicle = Math.max(mix.aaVehicle || 0, 2);
      return mix;
    };

    // Plan changes must also stop spending on items already in production that the plan no longer wants.
    function reconcileQueues(counts, av, infCount) {
      const P = C.plan, pd = g.getPlayerData(ME);
      const occ = n => P.buildOrder.filter(r => R(r) === n).length;
      const sumFor = (obj, n) => Object.entries(obj).filter(([k]) => R(k) === n).reduce((s, [, v]) => s + v, 0);
      const need = {
        [Q.Structures]: it => {
          const n = it.rules.name;
          if (n === R('power')) return true;
          const desired = n === R('refinery') ? Math.max(occ(n), P.targetRefineries) : n === R('factory') ? P.maxFactories : occ(n);
          return (counts[n] || 0) < desired;
        },
        [Q.Armory]: it => (counts[it.rules.name] || 0) < sumFor(wantDefenses(P, av), it.rules.name),
        [Q.Vehicles]: it => it.rules.harvester || sumFor(wantVehicleMix(P), it.rules.name) > 0,
        [Q.Infantry]: it => it.rules.name === R('dog') || (sumFor(P.infantryMix, it.rules.name) > 0 && infCount < P.infantryCap),
      };
      const objType = {[Q.Structures]: 2, [Q.Armory]: 2, [Q.Vehicles]: 7, [Q.Infantry]: 3};
      for (const qt of [Q.Structures, Q.Armory, Q.Vehicles, Q.Infantry]) {
        const q = queue(qt);
        if (!q || !q.currentSize) continue;
        for (const it of q.getAll()) {
          if (need[qt](it) || !every(`cancel:${qt}:${it.rules.name}`, 3)) continue;
          my.unqueueFromProduction(qt, it.rules.name, it.rules.type || objType[qt], 1);
          log('reflex', `方案已不需要，取消 ${it.rules.name}（进度 ${Math.round((it.progress || 0) * 100)}%，取消前资金 ${pd.credits}）`);
        }
      }
    }

    function production(S, av) {
      const P = C.plan, pd = g.getPlayerData(ME);
      const counts = M.counts = tally(S.mine.map(o => o.name));
      const powerLeft = pd.power.total - pd.power.drain;
      const infCount = S.mine.filter(o => o.isInfantry()).length;
      if (every('reconcile', 1.5)) reconcileQueues(counts, av, infCount);
      // Four queues splitting zero income never finish the expensive one (match-004: TESLA sat at 66% for 3.5 min).
      // While a >=1000 structure/defense is in progress and cash is short, stop queueing new infantry/vehicles.
      const expensiveBusy = [Q.Structures, Q.Armory].some(t => { const q = queue(t); return q && q.currentSize && q.status !== ST.Ready && q.getAll().some(i => (i.rules.cost || 0) >= 1000); });
      // Hysteresis: enter below 300, leave only above 800 or once the expensive item is done (match-005 flipped 22 times without it).
      const starved = expensiveBusy && (M.starved ? pd.credits < 800 : pd.credits < 300);
      if (starved !== M.starved) { M.starved = starved; log('reflex', starved ? '资金不足且有 ≥1000 的建筑在建：暂停新排步兵/载具，让它先收敛（矿车不受影响）' : '贵建筑已收敛或资金恢复：恢复步兵/载具排产'); }
      const sq = queue(Q.Structures);
      if (sq) {
        if (sq.status === ST.Ready && sec() >= M.pendingPlace) {
          const rules = sq.getAll()[0].rules;
          const spot = findSpot(rules.name, placementCenter(rules, S.buildings));
          if (spot) { my.placeBuilding(rules.name, spot.x, spot.y); log('build', `放置 ${rules.name} @${spot.x},${spot.y}`); M.pendingPlace = sec() + 0.8; }
          else if (every('nospot', 5)) log('warn', `找不到 ${rules.name} 的位置`);
        } else if (sq.status === ST.Idle && sq.currentSize === 0) {
          let next = null;
          const seen = {};
          for (const role of P.buildOrder) {
            const n = R(role); seen[n] = (seen[n] || 0) + 1;
            if ((counts[n] || 0) >= seen[n]) continue;
            if (av.has(n)) { delete M.unavail[n]; next = n; break; }
            M.unavail[n] ??= sec();
            if (sec() - M.unavail[n] > 60 && every('unavail:' + n, 60)) log('warn', `建造顺序里的 ${role}(${n}) 已 60 秒不可造，被跳过`);
          }
          if (!next && (counts[R('refinery')] || 0) < P.targetRefineries && av.has(R('refinery'))) next = R('refinery');
          if (!next && (counts[R('factory')] || 0) < P.maxFactories && pd.credits > 2500 && av.has(R('factory'))) next = R('factory');
          if (!next && powerLeft < 150 && av.has(R('power'))) next = R('power');
          if (!next) {
            M.sqIdleSince ??= sec();
            if (sec() - M.sqIdleSince > 45 && every('sqIdle', 60)) log('warn', `建筑队列已空闲 ${Math.round(sec() - M.sqIdleSince)} 秒：buildOrder 已完成且没有兜底项，需要指挥官追加`);
          } else {
            M.sqIdleSince = null;
            const r = game.rules.getObject(next, 2);
            if (r && r.power < 0 && powerLeft + r.power < 0 && av.has(R('power')) && next !== R('power')) { next = R('power'); log('reflex', '电力不够，先补电厂'); }
            my.queueForProduction(Q.Structures, next, 2, 1); log('build', `排产 ${next}（资金 ${pd.credits}，余电 ${powerLeft}）`);
          }
        }
      }
      const dq = queue(Q.Armory);
      if (dq) {
        if (dq.status === ST.Ready && sec() >= M.pendingPlace) {
          const rules = dq.getAll()[0].rules;
          const spot = findSpot(rules.name, placementCenter(rules, S.buildings));
          if (spot) { my.placeBuilding(rules.name, spot.x, spot.y); log('build', `放置防御 ${rules.name} @${spot.x},${spot.y}`); M.pendingPlace = sec() + 0.8; }
        } else if (dq.status === ST.Idle && dq.currentSize === 0) {
          // Enemy aircraft actually loitering near our buildings right now overrides the normal cost gate for
          // AA specifically — match-007: NASAM costs 1000, always misses the <=700 alarm fast-track, so 7
          // JUMPJET camped inside the base for 90s with zero air defense ever queued.
          const nearRadius = (P.defenseDistance + P.leashRadius + 6) ** 2;
          const airNear = S.hostile.some(o => isAir(o) && S.buildings.some(b => d2(xy(b), xy(o)) < nearRadius));
          // Same idea for strongDef (prism tower / Tesla coil): match-008 found ATESLA queued at 2:33 still not
          // placed by 3:47 (74s+ to build vs. 34s in match-005) while heavy armor/high-value infantry (LTNK,
          // GHOST2) were already closing in — the one thing that actually counters them never got funded in time.
          const groundNear = S.hostile.some(o => !isAir(o) && !o.isBuilding() && !o.rules.harvester && cost(o) >= 500 && S.buildings.some(b => d2(xy(b), xy(o)) < nearRadius));
          for (const [role, n] of Object.entries(wantDefenses(P, av))) {
            const name = R(role);
            if ((counts[name] || 0) >= n || !av.has(name)) continue;
            const c = (game.rules.getObject(name, 2) || {}).cost || 0;
            const aaUrgent = role === 'aaDef' && airNear && pd.credits >= 300;
            const strongUrgent = role === 'strongDef' && groundNear && pd.credits >= c * 0.3;
            const urgent = aaUrgent || strongUrgent;
            if ((pd.credits > 700 && pd.credits >= c * 0.5) || (M.alarm && c <= 700) || urgent) { my.queueForProduction(Q.Armory, name, 2, 1); log('build', `排产防御 ${name}（${c}，资金 ${pd.credits}${urgent ? '，敌方逼近，绕过资金门槛' : ''}）`); }
            break;
          }
          if ((airNear || groundNear) && !M.airNearWarned) { M.airNearWarned = true; log('warn', `敌方${airNear ? '飞行单位' : ''}${airNear && groundNear ? '/' : ''}${groundNear ? '重型单位' : ''}正在基地附近逗留：相应防御排产已绕过资金门槛`); }
          else if (!airNear && !groundNear) M.airNearWarned = false;
        }
      }
      const harvs = S.mine.filter(o => o.rules.harvester).length;
      const refs = counts[R('refinery')] || 0;
      const vq = queue(Q.Vehicles);
      if (vq && vq.currentSize < 2) {
        const wantMiners = Math.min(P.maxMiners, refs * P.minersPerRefinery);
        const queuedMiner = vq.getAll().some(i => i.rules.harvester);
        // Miners are exempt from the starvation guard only up to 2/refinery (the minimum useful count); a 3rd miner
        // competing with tanks for the same queue slot cost us a MTNK in the window before match-005's first attack.
        if (harvs < wantMiners && !queuedMiner && av.has(R('harv')) && (!starved || harvs < refs * 2)) { my.queueForProduction(Q.Vehicles, R('harv'), 7, 1); log('prod', `补矿车（${harvs}/${wantMiners}）`); }
        else if (!starved && (pd.credits > 600 || (sq && sq.status === ST.Idle && sq.currentSize === 0) || M.alarm)) {
          const n = pickByMix(wantVehicleMix(P), counts, av);
          if (n) my.queueForProduction(Q.Vehicles, n, 7, 1);
        }
      }
      const iq = queue(Q.Infantry);
      if (iq && iq.currentSize < 1) {
        if (P.scout && !M.scoutId && !M.scouted && av.has(R('dog')) && !(counts[R('dog')] > 0)) my.queueForProduction(Q.Infantry, R('dog'), 3, 1);
        else if (!starved && infCount < P.infantryCap && (pd.credits > 300 || M.alarm)) {
          const n = pickByMix(P.infantryMix, counts, av);
          if (n) my.queueForProduction(Q.Infantry, n, 3, 1);
        }
      }
    }

    function intelSample(S) {
      const now = sec();
      // Cache name -> cost for everything we ever see, so kills/losses can be valued after the object is gone.
      const cacheCost = o => { const c = cost(o); if (c) M.costByName[o.name] = c; };
      const bump = (which, comp) => {
        let v = 0;
        for (const [n, k] of Object.entries(comp)) { M[which][n] = (M[which][n] || 0) + k; v += (M.costByName[n] || 0) * k; }
        if (which === 'kills') M.killValue += v; else M.lossValue += v;
      };
      for (const o of S.hostile) {
        cacheCost(o);
        if (o.isBuilding()) { if (!M.enemyBuildings.has(o.id)) { M.enemyBuildings.set(o.id, {name: o.name, ...xy(o), seen: now}); log('intel', `发现敌方建筑 ${o.name} @${xy(o).x},${xy(o).y}`); } }
        else {
          if (!M.enemyTypes.has(o.name)) { M.enemyTypes.set(o.name, now); log('intel', `首次发现敌方单位类型 ${o.name}${isAir(o) ? '（空中）' : ''}`); }
          if (isAir(o) && !M.airSeen) { M.airSeen = true; log('reflex', '发现敌方空中单位：自动加防空车和防空塔'); }
          M.enemyUnitIds.set(o.id, o.name);
        }
      }
      for (const o of S.mine) cacheCost(o);
      for (const [id, b] of M.enemyBuildings) if (!game.getWorld().hasObjectId(id)) { M.enemyBuildings.delete(id); bump('kills', {[b.name]: 1}); log('kill', `摧毁敌方建筑 ${b.name}`); }
      const lostE = []; for (const [id, n] of M.enemyUnitIds) if (!game.getWorld().hasObjectId(id)) { M.enemyUnitIds.delete(id); lostE.push(n); M.stillTicks.delete(id); }
      if (lostE.length) { const comp = tally(lostE); bump('kills', comp); log('kill', `击杀敌方 ${JSON.stringify(comp)}`); }
      const cur = new Set(S.mine.map(o => o.id));
      const lost = []; for (const [id, n] of M.myIds) if (!cur.has(id)) { lost.push(n); M.myIds.delete(id); }
      for (const o of S.mine) M.myIds.set(o.id, o.name);
      if (lost.length) { const comp = tally(lost); bump('losses', comp); log('loss', `我方损失 ${JSON.stringify(comp)}`); }
      const base = baseCenter(S.buildings);
      const army = S.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
      // Track which hostile infantry haven't moved in a while: deployed infantry (e.g. E1 -> M60E) deal much
      // more damage than their cost implies, but stay put to do it (match-006: 5 stationary E1 ground down 9 MTNK).
      for (const o of army) {
        if (!o.isInfantry || !o.isInfantry()) continue;
        const p = xy(o), st = M.stillTicks.get(o.id);
        if (st && st.x === p.x && st.y === p.y) st.n++; else M.stillTicks.set(o.id, {x: p.x, y: p.y, n: 1});
      }
      // Revealed ground stays visible for good (no fog of war), so units idling at the enemy base are "visible" too.
      // Distance/trend are computed from the field army only; the home group is reported separately.
      const away = army.filter(o => dist(xy(o), enemyStart()) > 15);
      const c = centroid(away);
      // The field-army centroid still lags behind fast vehicles; track the group nearest to our base for ETA.
      const leadUnit = away.reduce((b, o) => !b || d2(xy(o), base) < d2(xy(b), base) ? o : b, null);
      const lead = leadUnit ? away.filter(o => d2(xy(o), xy(leadUnit)) < 64) : [];
      M.armyHist.push({t: now, n: army.length, value: army.reduce((s, o) => s + cost(o), 0), fn: away.length, fv: away.reduce((s, o) => s + cost(o), 0), c, d: c ? Math.round(dist(c, base)) : null,
        ln: lead.length, lv: lead.reduce((s, o) => s + cost(o), 0), lc: centroid(lead), lcomp: tally(lead.map(o => o.name)), ld: leadUnit ? Math.round(dist(xy(leadUnit), base)) : null});
      if (M.armyHist.length > 60) M.armyHist.shift();
      const close = army.filter(o => dist(xy(o), base) < 30);
      if (close.length >= 2) {
        const cc = centroid(close);
        M.approach = M.approach ? {x: Math.round(M.approach.x * 0.7 + cc.x * 0.3), y: Math.round(M.approach.y * 0.7 + cc.y * 0.3)} : cc;
      }
      // T-023: warn when the enemy is hoarding at home well past our own army value, instead of waiting for an
      // analyst to notice by hand (match-006: the ratio was readable at 6:56 but wasn't flagged until 7:43).
      const homeVal = army.filter(o => !away.includes(o)).reduce((s, o) => s + cost(o), 0);
      const myVal = S.mine.filter(isCombat).reduce((s, o) => s + cost(o), 0);
      const ratio = myVal > 0 ? homeVal / myVal : (homeVal > 0 ? Infinity : 0);
      if (ratio >= 1.5) {
        M.hoardSince ??= now;
        const dur = now - M.hoardSince;
        if (ratio >= 2 && dur >= 60 && M.hoardWarned < 2) { M.hoardWarned = 2; log('advice', `[urgent] 敌方在家囤兵 ${homeVal}，已达我方部队价值(${myVal})的 ${ratio.toFixed(1)} 倍，持续 ${Math.round(dur)} 秒未变化：经济要不要跟上，或者趁它没出门主动 harass 打断，两个选项都要考虑（T-023）`, 'reflex'); }
        else if (M.hoardWarned < 1) { M.hoardWarned = 1; log('advice', `[warn] 敌方在家囤兵已反超我方部队价值 ${ratio.toFixed(1)} 倍且仍在涨（${homeVal} vs ${myVal}），进入观察期（T-023）`, 'reflex'); }
      } else { M.hoardSince = null; M.hoardWarned = 0; }
    }

    function pickTarget(base) {
      const T = C.plan.attackTarget;
      if (Array.isArray(T)) return {x: T[0], y: T[1]};
      const known = [...M.enemyBuildings.values()];
      if (!known.length) return enemyStart();
      const pri = n => /CNST/.test(n) ? 0 : /POWR|NRCT/.test(n) ? 1 : /PILL|LASR|TSLA|TESLA|SAM|FLAK|GCAN|PRISM/.test(n) ? 2 : /WEAP|PILE|HAND|AIRC|RADR|TECH/.test(n) ? 3 : /REFN/.test(n) ? 4 : 5;
      known.sort((a, b) => pri(a.name) - pri(b.name) || d2(a, base) - d2(b, base));
      return {x: known[0].x, y: known[0].y};
    }

    function army(S) {
      const P = C.plan, now = sec();
      const base = baseCenter(S.buildings), dir = enemyDir(base);
      const mine = S.mine.filter(isCombat);
      const scout = M.scoutId ? mine.find(o => o.id === M.scoutId) : null;
      if (P.scout && !M.scouted) {
        const es = enemyStart();
        if (!M.scoutId) { const dog = mine.find(o => o.name === R('dog')); if (dog) { M.scoutId = dog.id; my.orderUnits([dog.id], ORD.Move, es.x, es.y); log('scout', `派 ${dog.name} 去侦察敌方出生点`); } }
        else if (!scout) { M.scouted = true; log('scout', '侦察犬已阵亡，侦察结束'); }
        else if (dist(xy(scout), es) < 8) { M.scouted = true; my.orderUnits([scout.id], ORD.Move, base.x, base.y); log('scout', '侦察到敌方基地，召回侦察犬'); }
      }
      const units = mine.filter(o => o.id !== M.scoutId || M.scouted);
      const myBuild = S.buildings.map(xy);
      const miners = S.mine.filter(o => o.rules.harvester);
      const rally = {x: Math.round(base.x + dir.x * (P.defenseDistance + 2)), y: Math.round(base.y + dir.y * (P.defenseDistance + 2))};
      // Fight next to our defenses: chasing threats far from towers lost the whole army twice in match-003.
      const towerObjs = S.buildings.filter(b => b.rules.isBaseDefense);
      const towers = towerObjs.map(xy);
      const anchorFor = p => towers.length ? towers.reduce((a, t) => d2(t, p) < d2(a, p) ? t : a) : rally;
      // A tower's own weapon range, so the engage point sits where the tower can actually shoot (match-005: engage
      // point was 8-10.3 tiles from the anchor tower while its weapon range was 5.5-8, so it never fired a shot).
      const rangeCache = new Map();
      const towerRangeAt = p => {
        const b = towerObjs.find(o => { const x = xy(o); return x.x === p.x && x.y === p.y; });
        if (!b) return null;
        if (rangeCache.has(b.name)) return rangeCache.get(b.name);
        let r = null;
        try {
          const rules = game.rules.getObject(b.name, 2);
          const w = rules && (rules.primary || rules.elitePrimary) && game.rules.getWeapon(rules.primary || rules.elitePrimary);
          if (w && w.range) r = w.range;
        } catch (e) {}
        rangeCache.set(b.name, r);
        return r;
      };
      const leash = P.defenseDistance + P.leashRadius;
      const raw = S.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
      const nearBuilding = o => myBuild.some(b => d2(b, xy(o)) < P.threatRadius ** 2);
      const hurtMiners = miners.filter(m => hp(m) < 0.95 && raw.some(o => d2(xy(m), xy(o)) < 25));
      const threats = raw.filter(o => (nearBuilding(o) || hurtMiners.some(m => d2(xy(m), xy(o)) < 25)) && d2(xy(o), anchorFor(xy(o))) < leash ** 2);
      const outside = raw.filter(o => nearBuilding(o) && !threats.includes(o));
      const exposedMiners = hurtMiners.filter(m => !threats.some(o => d2(xy(m), xy(o)) < 25));
      if (exposedMiners.length) {
        orderThrottled(exposedMiners, ORD.Move, base.x, base.y, 'minerHome', 8);
        if (every('minerHome', 10)) log('reflex', `矿车在防线外被打：撤回基地（${exposedMiners.length} 辆），部队不出防线`);
      }
      if (outside.length && every('outsideLeash', 15)) log('warn', `防线外有敌军在打我方建筑：${JSON.stringify(tally(outside.map(o => o.name)))}，超出拴绳距离 ${leash} 格未出兵（可调 leashRadius）`);
      // T-022: stationary infantry is usually deployed (e.g. E1 -> M60E, +67% damage) — cost alone underrates it.
      const dmgWeight = o => (o.isInfantry && o.isInfantry() && (M.stillTicks.get(o.id)?.n || 0) >= 2) ? 1.6 : 1;
      const threatValue = threats.reduce((s, o) => s + cost(o) * dmgWeight(o), 0);
      const myValue = units.reduce((s, o) => s + cost(o), 0);
      // Artillery parked just outside the leash shelled both towers to death in match-004 with zero response.
      // Send a few fast vehicles only when the shooters are lightly escorted; everyone else stays on the line.
      const isArty = o => !!(o.rules.isArtillery || /^(V3|ARTY|DRED)$/.test(o.name)); // HOWI is CA's heavy tank (APOCChina), not artillery (match-005 unit_rules.json)
      const arty = outside.filter(isArty);
      let sortieGo = false;
      if (P.sortieMaxUnits > 0 && arty.length && !threats.length) {
        const ac = centroid(arty);
        // Escorts may sit beyond threatRadius, so count every enemy within 10 tiles of the guns, not just `outside`.
        const escort = raw.filter(o => !isArty(o) && d2(xy(o), ac) < 100).reduce((s, o) => s + cost(o), 0);
        const artyValue = arty.reduce((s, o) => s + cost(o), 0);
        const fast = units.filter(o => o.isVehicle && o.isVehicle()).sort((a, b) => (b.rules.speed || 0) - (a.rules.speed || 0)).slice(0, P.sortieMaxUnits);
        const fastValue = fast.reduce((s, o) => s + cost(o), 0);
        if (fast.length && escort <= artyValue && escort + artyValue <= fastValue * 1.5) {
          sortieGo = true;
          if (!M.sortie) { M.sortie = {t: now}; log('reflex', `拴绳外有 ${JSON.stringify(tally(arty.map(o => o.name)))} 在轰建筑，护卫价值 ${escort}：派 ${fast.length} 辆快速载具出击 @${ac.x},${ac.y}`); }
          orderThrottled(fast, ORD.AttackMove, ac.x, ac.y, 'sortie', 3);
          orderThrottled(units.filter(o => !fast.includes(o) && d2(xy(o), rally) > 36), ORD.AttackMove, rally.x, rally.y, 'rally', 6);
          return;
        }
      }
      if (M.sortie && !sortieGo) { log('reflex', threats.length ? '出击结束：防线告警，快速载具归队' : arty.length ? '出击结束：炮兵护卫增强，快速载具归队' : '出击结束：炮兵已清除，快速载具归队'); M.sortie = null; orderThrottled(units, ORD.Move, rally.x, rally.y, 'retreat', 1); }

      if (threats.length) {
        const tc = centroid(threats);
        const anchor = anchorFor(tc), reach = dist(tc, anchor);
        const towerR = towerRangeAt(anchor);
        const capR = towerR ? Math.max(1, Math.min(P.leashRadius, towerR - 1)) : P.leashRadius;
        const ptRaw = reach > capR ? {x: anchor.x + (tc.x - anchor.x) * capR / reach, y: anchor.y + (tc.y - anchor.y) * capR / reach} : tc;
        // Round to a coarse grid so minor centroid drift (deployed infantry doesn't move) doesn't re-key the
        // AttackMove order every 0.8s tick and cancel the in-progress attack — match-006 ground down 9 MTNK
        // this way against a stationary deployed-E1 blob while trading favorably at first contact.
        const pt = {x: Math.round(ptRaw.x / 2) * 2, y: Math.round(ptRaw.y / 2) * 2};
        if (!M.alarm) { M.alarm = true; M.defend = {value: myValue, t: now}; M.defendBroken = false; log('alarm', `基地/矿车受威胁：${JSON.stringify(tally(threats.map(o => o.name)))} 价值 ${threatValue} @${tc.x},${tc.y}，迎击点 ${pt.x},${pt.y}，我方部队价值 ${myValue}`); }
        else if (every('alarmRefresh', 10)) { log('alarm', `交战持续：${JSON.stringify(tally(threats.map(o => o.name)))} 价值 ${threatValue} @${tc.x},${tc.y}，我方剩余部队价值 ${myValue}`); }
        const deep = M.attack ? units.filter(o => dist(xy(o), enemyStart()) < 25) : [];
        const recallAll = threatValue > myValue * 0.25;
        const defenders = recallAll ? units : units.filter(o => !deep.includes(o));
        if (M.attack && recallAll && every('recall', 10)) { log('reflex', '家里被打且威胁较大：进攻部队回防'); M.attack = null; C.plan.stance = 'defend'; }
        // The defend branch used to fight to zero every time: threatValue's stationary-infantry weighting (T-022)
        // fed the alarm log and the attack-recall check, but nothing ever told defenders to break off a losing
        // fight (match-007: 3 MTNK + 5 E1 ground down to 0 against 5 stationary E1, killing only the E1s).
        // match-008: two FV died in the same 0.8s sample window, jumping the ratio from 61.5% straight past
        // 40% to 0% — a committed force that's already thin can get wiped between two samples with no
        // intermediate reading to catch. An absolute floor covers that: below defendMinValue, retreat regardless
        // of what the ratio says, since there's nothing left worth trading further.
        const defendRatio = M.defend && M.defend.value > 0 ? myValue / M.defend.value : 1;
        if (!M.defendBroken && (defendRatio < (P.defendRetreatRatio ?? 0.4) || (myValue > 0 && myValue < (P.defendMinValue ?? 800)))) {
          M.defendBroken = true;
          log('reflex', `防守交战只剩 ${Math.round(defendRatio * 100)}%（价值 ${myValue}）：撤回基地，不硬拼到全灭（可调 defendRetreatRatio/defendMinValue）`);
        }
        if (M.defendBroken) orderThrottled(defenders, ORD.Move, base.x, base.y, 'retreat', 2);
        else orderThrottled(defenders, ORD.AttackMove, pt.x, pt.y, 'def', 3);
        return;
      }
      if (M.alarm) { M.alarm = false; M.defend = null; M.defendBroken = false; log('alarm', '威胁解除'); }

      if (P.stance === 'attack') {
        if (!M.attack) {
          if (units.length >= P.attackMinUnits) {
            const tgt = pickTarget(base);
            M.attack = {value: myValue, target: tgt, ids: new Set(units.map(u => u.id)), t: now};
            log('attack', `发起进攻：${units.length} 个单位（价值 ${myValue}）→ ${tgt.x},${tgt.y}`);
          } else {
            orderThrottled(units.filter(o => d2(xy(o), rally) > 36), ORD.AttackMove, rally.x, rally.y, 'rally', 6);
            return;
          }
        }
        const A = M.attack;
        for (const u of units) if (!A.ids.has(u.id) && d2(xy(u), rally) < 100) A.ids.add(u.id);
        orderThrottled(units.filter(u => !A.ids.has(u.id)), ORD.AttackMove, rally.x, rally.y, 'rally', 6);
        const gv = units.filter(u => A.ids.has(u.id)).reduce((s, o) => s + cost(o), 0);
        if (gv < A.value * P.retreatRatio) {
          log('reflex', `进攻部队只剩 ${Math.round(gv / A.value * 100)}%：自动撤退并转为防守`);
          M.attack = null; C.plan.stance = 'defend';
          orderThrottled(units, ORD.Move, rally.x, rally.y, 'retreat', 1);
          return;
        }
        const tgtAlive = M.enemyBuildings.size === 0 || [...M.enemyBuildings.values()].some(b => d2(b, A.target) < 36);
        if (!tgtAlive && every('retarget', 4)) { A.target = pickTarget(base); log('attack', `目标已清除，转向 ${A.target.x},${A.target.y}`); }
        const idle = units.filter(u => A.ids.has(u.id) && (!u.unitOrderTrait || u.unitOrderTrait.orders.length === 0));
        orderThrottled(idle, ORD.AttackMove, A.target.x, A.target.y, 'atk', 4);
        return;
      }
      if (M.attack) M.attack = null;
      if (P.stance === 'harass') {
        const fast = units.filter(o => o.isVehicle() && (o.rules.speed || 0) >= 30).slice(0, 5);
        const known = [...M.enemyBuildings.values()].filter(b => /REFN/.test(b.name));
        const tgt = known.sort((a, b) => d2(a, base) - d2(b, base))[0] || enemyStart();
        orderThrottled(fast, ORD.AttackMove, tgt.x, tgt.y, 'harass', 8);
        orderThrottled(units.filter(o => !fast.includes(o) && d2(xy(o), rally) > 36), ORD.AttackMove, rally.x, rally.y, 'rally', 6);
        return;
      }
      // T-026: a small standing guard at the refineries, not just a reaction once a miner is already hurt.
      // Opt-in (default 0) — only spend units on this once a matchup is known to snipe miners before they take damage.
      // The guard has to sit on the *ore patch*, which is where a miner is actually exposed: posting it on the
      // refinery's own tile can never intercept a sniper working the patch (match-009 ran with minerEscort:1 and
      // logged no effect; the commander traced it to this mismatch with the T-026 wording). Falls back to the
      // refinery tile when no ore is known yet.
      const refPts = S.buildings.filter(b => b.rules.refinery).map(xy);
      const oreNear = r => {
        if (!M.oreTiles.length) return null;
        const inRange = M.oreTiles.filter(t => d2(t, r) < 20 * 20);
        return inRange.length ? inRange.reduce((a, t) => (d2(t, r) < d2(a, r) ? t : a)) : null;
      };
      const guardCount = Math.min(P.minerEscort || 0, units.length, refPts.length);
      const guardIds = new Set();
      for (let i = 0; i < guardCount; i++) {
        const u = [...units].sort((a, b) => (b.rules.speed || 0) - (a.rules.speed || 0))[i];
        const spot = oreNear(refPts[i]) || refPts[i];
        orderThrottled([u], ORD.AttackMove, spot.x, spot.y, 'escort:' + u.id, 8);
        guardIds.add(u.id);
      }
      orderThrottled(units.filter(o => !guardIds.has(o.id) && d2(xy(o), rally) > 36), ORD.AttackMove, rally.x, rally.y, 'rally', 6);
    }

    // Attack-move ignores ordinary buildings, so with no enemy army nearby issue direct attacks: CY > power > defenses > production > refinery.
    // A nuclear reactor (NANRCT) detonates when destroyed, and it carries rules.power > 0 — so the old ranking
    // made it a rank-1 target, i.e. we deliberately stacked the army onto a bomb as our second priority.
    // match-009 lost 3 HTNK (2700) in a single tick that way, the largest single loss of the match. Demote it to
    // last: by the time we reach it the enemy is finished anyway, so hitting it early buys nothing but our tanks.
    const isNuke = b => !!(b.rules.nuclear || /NRCT|NUKE/.test(b.name));
    const siegeRank = b => isNuke(b) ? 6 : b.rules.constructionYard ? 0 : (b.rules.power > 0 ? 1 : b.rules.isBaseDefense ? 2 : /WEAP|PILE|HAND|AIRC|RADR|TECH|YARD/.test(b.name) ? 3 : b.rules.refinery ? 4 : 5);
    function siege(S) {
      const P = C.plan, now = sec();
      const armyUnits = S.mine.filter(isCombat).filter(o => o.id !== M.scoutId || M.scouted);
      const enemyUnits = S.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
      if (P.stance === 'defend' && !M.alarm) {
        // "Quiet" has to mean the enemy has no troops in the *field*, not that none are visible anywhere. There is
        // no fog of war, so a turtling AI keeps its whole army visible at home and `enemyUnits.length === 0` never
        // becomes true: match-009 sat on 25 units with 15 enemy units turtled for 90s, attackMinUnits (10) was long
        // satisfied, and this rule never fired — the commander had to set stance by hand to win. T-024's wording is
        // "no enemy troops on the field", which is exactly `field` in the intel schema (further than 15 tiles from
        // the enemy start). Fixing only the judge would be worse than the bug though: a turtled enemy at parity
        // would now trigger a 74-tile march the moment our count crossed the threshold, so T-005's real edge
        // (>= 2x the enemy's visible army value) is required as well.
        const fieldUnits = enemyUnits.filter(o => dist(xy(o), enemyStart()) > 15);
        if (fieldUnits.length === 0) {
          M.noArmySince ??= now;
          // Require at least one vehicle before auto-committing: match-007 sent 8 bare E1 (MTNK still building)
          // into an unscouted enemy base on unit count alone, while 5 enemy E1 were already closing on our own base.
          const hasVehicle = armyUnits.some(o => o.isVehicle && o.isVehicle());
          const myValue = armyUnits.reduce((s, o) => s + cost(o), 0);
          const enemyValue = enemyUnits.reduce((s, o) => s + cost(o), 0);
          const advantage = enemyValue === 0 || myValue >= enemyValue * 2;
          if (now - M.noArmySince >= P.siegeQuietSeconds && armyUnits.length >= P.siegeAutoAttackUnits && hasVehicle && advantage) {
            C.apply({stance: 'attack', attackMinUnits: Math.min(P.attackMinUnits, armyUnits.length)}, `攻城规则：${P.siegeQuietSeconds} 秒敌方无野战部队，我方 ${armyUnits.length} 个单位（含载具、价值 ${myValue}）对敌方 ${enemyValue}（T-005 优势达标），转入进攻拆建筑`, 'main');
            M.noArmySince = null;
          } else if (now - M.noArmySince >= P.siegeQuietSeconds && armyUnits.length >= P.siegeAutoAttackUnits && hasVehicle && every('siegeBlocked', 30)) {
            // Every other gate is met and only the ratio is holding us back — say so. Without this the only way to
            // notice a stuck reflex is `status.attack` staying null, which is what match-009's analyst had to do.
            log('warn', `自动转攻被 T-005 优势门槛挡住：我方价值 ${myValue} 对敌方 ${enemyValue}（需 2 倍），继续防守`);
          }
        } else M.noArmySince = null;
        return;
      }
      if (P.stance !== 'attack' || !M.attack) return;
      const group = armyUnits.filter(u => M.attack.ids.has(u.id));
      if (!group.length) return;
      if (enemyUnits.some(e => group.some(u => d2(xy(u), xy(e)) < 144))) {
        if (M.siegeTarget) { log('siege', '附近出现敌军，暂停拆建筑，先打部队'); M.siegeTarget = null; }
        return;
      }
      const candidates = S.hostile.filter(o => o.isBuilding());
      if (!candidates.length) return;
      const gc = centroid(group);
      candidates.sort((a, b) => siegeRank(a) - siegeRank(b) || d2(xy(a), gc) - d2(xy(b), gc));
      const tgt = candidates[0], tp = xy(tgt);
      if (!M.siegeTarget || M.siegeTarget.id !== tgt.id) { log('siege', `没有敌军，拆建筑：${tgt.name} @${tp.x},${tp.y}`); M.siegeTarget = {id: tgt.id, name: tgt.name}; }
      M.attack.target = tp;
      const strikers = group.filter(u => d2(xy(u), tp) < 18 * 18).filter(u => { const h = M.siegeHit.get(u.id); return !h || h.id !== tgt.id || now - h.t > 6; });
      if (strikers.length) {
        my.orderUnits(strikers.map(u => u.id), ORD.Attack, tgt.id);
        for (const u of strikers) { M.siegeHit.set(u.id, {id: tgt.id, t: now}); M.lastOrder.set(u.id, {k: 'siege:' + tgt.id, t: now}); }
      }
    }

    function repair(S) {
      if (!C.plan.repair || g.getPlayerData(ME).credits < 150) return;
      for (const b of S.buildings) {
        const h = hp(b);
        if (h < 0.7 && !M.repairing.has(b.id)) { my.toggleRepairWrench(b.id); M.repairing.add(b.id); log('reflex', `修理 ${b.name}（血量 ${Math.round(h * 100)}%）`); }
        else if (h >= 0.999 && M.repairing.has(b.id)) M.repairing.delete(b.id);
      }
    }

    // Full-information snapshots for post-game review only. Real-time agents must not read C.rec.
    function record() {
      const snap = {t: Math.round(sec()), players: {}};
      for (const p of players) {
        const pd = g.getPlayerData(p);
        const objs = g.getVisibleUnits(p, 'self').map(obj).filter(Boolean);
        const b = objs.filter(o => o.isBuilding()), u = objs.filter(o => !o.isBuilding() && !isMissile(o));
        const armyUnits = u.filter(isCombat);
        snap.players[p] = {credits: pd.credits, power: pd.power.total - pd.power.drain, defeated: g.isPlayerDefeated(p),
          buildings: tally(b.map(o => o.name)), units: tally(u.map(o => o.name)),
          army: {count: armyUnits.length, value: armyUnits.reduce((s, o) => s + cost(o), 0), at: centroid(armyUnits)}};
      }
      C.rec.snapshots.push(snap);
    }

    function tick() {
      if (C.over) return;
      if (g.isPlayerDefeated(ME) || enemies.every(p => g.isPlayerDefeated(p))) {
        C.over = g.isPlayerDefeated(ME) ? 'lost' : 'won';
        try { record(); } catch (e) {}
        log('over', `游戏结束：${C.over === 'won' ? '我方胜利' : '我方失败'}，用时 ${fmt(sec())}`);
        C.endedAt = Math.round(sec());
        // Persist a dump the instant the match ends: if the page navigates away before a learner
        // gets to it (match-006 lost the entire post-game dump this way), this is the fallback.
        try {
          localStorage.setItem('ra2cmd:lastMeta', JSON.stringify(C.dump('meta')));
          localStorage.setItem('ra2cmd:lastLog', JSON.stringify(C.dump('log', {limit: 4000})));
          localStorage.setItem('ra2cmd:lastSnapshots', JSON.stringify(C.dump('snapshots', {limit: 1000})));
        } catch (e) { log('warn', '赛后自动导出到 localStorage 失败: ' + e.message); }
        clearInterval(C.timer); return;
      }
      const S = C.state();
      const cy = S.buildings.find(b => b.rules.constructionYard);
      if (!cy && !S.buildings.length) {
        const mcv = S.mine.find(o => baseUnits.includes(o.name));
        if (mcv && every('deploy', 1)) { my.orderUnits([mcv.id], ORD.DeploySelected); log('build', `展开 ${mcv.name}`); }
        return;
      }
      if (!M.side && cy) {
        M.sideKey = cy.name.slice(0, 2); M.side = SIDES[M.sideKey] || SIDES.GA;
        try { M.oreTiles = g.getAllTilesResourceData().filter(r => r.ore + r.gems > 0).map(r => ({x: r.tile.rx, y: r.tile.ry})); } catch (e) { M.oreTiles = []; }
        log('start', `阵营 ${M.sideKey}，我方 ${ME} @${starts[ME].x},${starts[ME].y}，敌方 ${enemies.map(p => `${p}@${starts[p].x},${starts[p].y}`).join(' ')}，矿格 ${M.oreTiles.length}`);
      }
      const av = M.av = avail();
      production(S, av);
      if (every('intel', 1.5)) intelSample(S);
      if (every('army', 0.8)) army(S);
      if (every('siege', 0.7)) siege(C.state());
      if (every('repair', 2)) repair(S);
      if (every('record', 10)) record();
    }

    C.apply = (patch, reason, author = 'commander') => {
      const allowed = C.ownership[author];
      if (!allowed) return {ok: false, error: `角色 ${author} 没有修改方案的权限（可用 C.advise 提建议）`};
      const keys = Object.keys(patch);
      const bad = keys.filter(k => !(k in C.plan));
      if (bad.length) return {ok: false, error: '未知字段: ' + bad.join(',')};
      if (allowed !== '*') { const denied = keys.filter(k => !allowed.includes(k)); if (denied.length) return {ok: false, error: `${author} 无权修改: ${denied.join(',')}`}; }
      if (patch.stance && !['defend', 'attack', 'harass'].includes(patch.stance)) return {ok: false, error: 'stance 只能是 defend/attack/harass'};
      Object.assign(C.plan, patch);
      if (patch.stance && patch.stance !== 'attack') M.attack = null;
      if (patch.attackTarget && M.attack) M.attack.target = Array.isArray(patch.attackTarget) ? {x: patch.attackTarget[0], y: patch.attackTarget[1]} : pickTarget(baseCenter(C.state().buildings));
      log('plan', `${reason || ''} ${JSON.stringify(patch)}`, author);
      return {ok: true, plan: C.plan};
    };
    C.advise = (from, msg, level = 'info') => { log('advice', `[${level}] ${msg}`, from); return {ok: true}; };

    C.intel = ({reader = 'commander', maxEvents = 40, detail = false} = {}) => {
      const S = C.state(), pd = g.getPlayerData(ME), now = sec();
      const base = baseCenter(S.buildings);
      const myArmy = S.mine.filter(isCombat);
      const enArmy = S.hostile.filter(o => !o.isBuilding() && !o.rules.harvester);
      const enField = enArmy.filter(o => dist(xy(o), enemyStart()) > 15), enHome = enArmy.filter(o => !enField.includes(o));
      const h = M.armyHist, last = h[h.length - 1], prev = h.find(x => now - x.t <= 12);
      let trend = 'unknown';
      if (last && prev && last.d != null && prev.d != null) trend = last.d < prev.d - 3 ? 'approaching' : last.d > prev.d + 3 ? 'withdrawing' : 'static';
      let lead = null;
      if (last && last.ld != null) {
        const lp = h.find(x => now - x.t <= 12 && x.ld != null);
        const speed = lp && last.t > lp.t ? (lp.ld - last.ld) / (last.t - lp.t) : 0;
        const toLine = Math.max(0, last.ld - (C.plan.defenseDistance + C.plan.leashRadius));
        lead = {count: last.ln, value: last.lv, comp: last.lcomp, at: last.lc, distToMyBase: last.ld,
          trend: speed > 0.25 ? 'approaching' : speed < -0.25 ? 'withdrawing' : 'static',
          tilesPerSec: Math.round(speed * 100) / 100, etaToDefenseLineSec: speed > 0.25 ? Math.round(toLine / speed) : null};
      }
      const cursor = C.cursors[reader] || 0;
      const fresh = C.log.filter(e => e.seq > cursor);
      C.cursors[reader] = C.seq;
      const qs = [0, 1, 2, 3].map(t => { const q = queue(t); return q && q.currentSize ? `${QN[t]}:${q.getAll().map(i => `${i.rules.name}${Math.round((i.progress || 0) * 100)}%`).join('+')}${q.status === ST.OnHold ? '(暂停)' : ''}` : null; }).filter(Boolean);
      // me.army.at is the centroid of every combat unit, which includes stragglers and newly built defenders left
      // at home — so it can sit 30+ tiles behind a strike force that is already inside the enemy base (match-009
      // reported (100,102) while the group was razing buildings at (71,118), leaving the commander unable to tell
      // whether the offensive was progressing). Expose the attacking group on its own.
      const strikeGroup = M.attack ? S.mine.filter(o => isCombat(o) && M.attack.ids.has(o.id)) : [];
      const out = {
        time: fmt(now), side: M.sideKey, over: C.over, reader,
        me: {credits: pd.credits, power: `${pd.power.total}/${pd.power.drain}${pd.power.isLowPower ? ' 低电!' : ''}`, base,
          buildings: tally(S.buildings.map(o => o.name)), units: tally(S.mine.filter(o => !o.isBuilding()).map(o => o.name)),
          army: {count: myArmy.length, value: myArmy.reduce((s, o) => s + cost(o), 0), at: centroid(myArmy)},
          damaged: S.buildings.filter(b => hp(b) < 0.7).map(b => `${b.name}${Math.round(hp(b) * 100)}%`), queues: qs},
        enemy: {start: enemyStart(),
          visibleArmy: {count: enArmy.length, value: enArmy.reduce((s, o) => s + cost(o), 0), comp: tally(enArmy.map(o => o.name)),
            field: {count: enField.length, value: enField.reduce((s, o) => s + cost(o), 0), comp: tally(enField.map(o => o.name)), at: centroid(enField), distToMyBase: last?.d, trend},
            atEnemyHome: {count: enHome.length, value: enHome.reduce((s, o) => s + cost(o), 0), comp: tally(enHome.map(o => o.name))},
            note: '探过的区域永久可见（无战争迷雾）。distToMyBase/trend 只按 field（离敌方出生点 >15 格）计算；估时间用 lead。'},
          lead,
          knownBuildings: tally([...M.enemyBuildings.values()].map(b => b.name)), airSeen: M.airSeen, approachFrom: M.approach},
        // Running battle total for the whole match, so a ratio never has to be reconstructed from a truncated
        // `events` window (match-009: two independent roles both got it wrong by 59%). Value uses the same
        // cost() basis as me.army.value / enemy.visibleArmy.value.
        tally: {kill: {comp: M.kills, value: M.killValue}, loss: {comp: M.losses, value: M.lossValue},
          note: '本局累计（含建筑）。交换比 = kill.value / loss.value。'},
        status: {stance: C.plan.stance, alarm: M.alarm, attack: M.attack ? {target: M.attack.target, startValue: M.attack.value, since: fmt(M.attack.t), count: strikeGroup.length, at: centroid(strikeGroup)} : null, siegeTarget: M.siegeTarget, scouted: M.scouted},
        events: fresh.slice(-maxEvents).map(e => `${e.t} [${e.kind}${e.author ? '/' + e.author : ''}] ${e.msg}`),
        droppedEvents: Math.max(0, fresh.length - maxEvents),
        plan: C.plan,
      };
      if (detail) {
        try { out.available = [...avail()]; } catch (e) { out.available = []; out.availableError = e.message; }
        out.enemy.typesFirstSeen = Object.fromEntries([...M.enemyTypes].map(([n, t]) => [n, fmt(t)]));
        out.enemy.buildingsFirstSeen = [...M.enemyBuildings.values()].map(b => `${b.name}@${b.x},${b.y} ${fmt(b.seen)}`);
        out.enemy.armyTrack = h.slice(-10).map(x => `${fmt(x.t)} all:n${x.n} v${x.value} field:n${x.fn ?? '-'} v${x.fv ?? '-'} ${x.c ? x.c.x + ',' + x.c.y : '-'} d${x.d ?? '-'} lead:n${x.ln} d${x.ld ?? '-'}`);
      }
      return out;
    };

    C.dump = (part, {offset = 0, limit = 300, excludeKinds = [], stride = 1} = {}) => {
      if (part === 'meta') return {matchId: C.matchId, runtimeVersion: C.version, planVersion: C.planVersion, result: C.over, durationSec: C.endedAt ?? Math.round(sec()),
        me: ME, side: M.sideKey, enemies, starts, factions: Object.fromEntries(players.map(p => [p, g.getPlayerData(p).country?.name])),
        plan0: C.plan0, planFinal: C.plan, logCount: C.log.length, snapshotCount: C.rec.snapshots.length,
        logKinds: tally(C.log.map(e => e.kind))};
      if (part === 'log') return C.log.filter(e => !excludeKinds.includes(e.kind)).slice(offset, offset + limit);
      if (part === 'snapshots') return C.rec.snapshots.filter((_, i, a) => i % stride === 0 || i === a.length - 1).slice(offset, offset + limit);
      return {error: 'part 只能是 meta/log/snapshots'};
    };

    C.started = true;
    C.timer = setInterval(() => { try { tick(); } catch (e) { if (every('err', 3)) log('error', e.message); } }, 250);
    log('start', `指挥系统启动 runtime=${C.version} plan=${C.planVersion} match=${C.matchId}，对手 ${enemies.join(',')}`);
  }
  return `ra2 runtime ${C.version} armed (match ${C.matchId}, plan ${C.planVersion})`;
}
