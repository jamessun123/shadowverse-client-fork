import {
  getCardDefClient,
  getNameByCardNoClient,
  getCardStatsClient,
} from "./cardLookup";
import { cardImage } from "../decks/getCards";
import { detectDeckIdentity } from "../decks/detectDeck";
import cardStats from "./card-stats.json";
import mvpCards from "./mvp-cards.json";

/** SEP is usable once turn threshold is met (7 for first player, 6 for second). */
function canSuperEvolveNow(state, playerId) {
  const p = state.players[playerId];
  if (!p || p.superEvoPoints <= 0) return false;
  const threshold = playerId === state.firstPlayer ? 7 : 6;
  return p.turnsPassed >= threshold;
}

/** Resolve instance identity (exact card name, or legacy cardNo). */
function instanceKey(instance) {
  return instance?.name || instance?.cardNo || "";
}

/**
 * Maps authoritative engine PlayerView state into legacy Redux CardSlice shape
 * so existing Field/Hand/PlayPoints components render without a full rewrite.
 */
export function engineViewToRedux(view, playerSlot) {
  if (!view?.state) return null;

  const self = view.self;
  const enemy = self === 0 ? 1 : 0;
  const ps = view.state.players[self];
  const es = view.state.players[enemy];

  const field = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const fieldInstanceIds = Array(10).fill(null);
  const evoField = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const engagedField = Array(10).fill(false);
  const customValues = Array(10)
    .fill(null)
    .map(() => ({ showAtk: false, atk: 0, showDef: false, def: 0 }));
  const wardField = Array(10).fill(0);
  const baneField = Array(10).fill(0);
  const auraField = Array(10).fill(0);
  const rushField = Array(10).fill(0);
  const stormField = Array(10).fill(0);
  const drainField = Array(10).fill(0);
  const intimidateField = Array(10).fill(0);
  const exPlayCostField = Array(10).fill(null);
  const counterField = Array(10).fill(0);

  const hasKeywordFlag = (stats, inst, kw) => {
    const active = view.activeKeywords?.[inst.instanceId];
    if (active) return active.includes(kw);
    return Boolean(
      (stats.keywords || []).includes(kw) ||
        (inst.grantedKeywords || []).includes(kw),
    );
  };

  const visibleCounter = (inst) => {
    const persistent = inst?.persistentCounters || {};
    return Object.values(persistent).reduce((sum, n) => {
      const v = Number(n);
      return sum + (Number.isFinite(v) && v > 0 ? v : 0);
    }, 0);
  };

  const cardName = (instance) => {
    const key = instanceKey(instance);
    if (key === "HIDDEN") return "Hidden Card";
    const resolved =
      getNameByCardNoClient(key) ||
      getCardDefClient(key)?.name ||
      key;
    // Present tokens without the data-file " TOKEN" suffix on the board label.
    return String(resolved).replace(/\s+TOKEN$/i, "");
  };

  const findEvoInstance = (playerState, evolveInstanceId) => {
    if (!evolveInstanceId) return null;
    return (
      playerState.zones.resolutionZone.find((c) => c.instanceId === evolveInstanceId) ||
      playerState.zones.evolveDeck.find((c) => c.instanceId === evolveInstanceId) ||
      playerState.zones.cemetery.find((c) => c.instanceId === evolveInstanceId)
    );
  };

  const equipmentField = Array(10).fill(0);
  const enemyEquipmentField = Array(10).fill(0);

  /** Keep the engine/token name intact so art + cardData resolve (… TOKEN). */
  const equipmentName = (instance) => {
    const key = instanceKey(instance);
    if (key === "HIDDEN") return "Hidden Card";
    return (
      getNameByCardNoClient(key) ||
      getCardDefClient(key)?.name ||
      key
    );
  };

  const attachmentIds = (playerState) => {
    const ids = new Set();
    for (const inst of playerState.zones.field) {
      for (const id of inst.equippedInstanceIds || []) ids.add(id);
    }
    return ids;
  };

  const equipmentNamesFor = (playerState, inst) => {
    if (!inst?.equippedInstanceIds?.length) return [];
    return inst.equippedInstanceIds
      .map((id) => playerState.zones.field.find((c) => c.instanceId === id))
      .filter(Boolean)
      .map((c) => equipmentName(c));
  };

  const isBoardOccupant = (inst, attached) =>
    !inst.equippedToInstanceId && !attached.has(inst.instanceId);

  const applyFollowerCombatStats = (inst, stats) => {
    const isFollower = stats.cardType === "follower";
    // Prefer explicit printed stats; do not flash "0" when lookup failed.
    const printedAtk = isFollower
      ? stats.attack != null && !Number.isNaN(Number(stats.attack))
        ? Number(stats.attack)
        : null
      : null;
    const printedDef = isFollower
      ? stats.defense != null && !Number.isNaN(Number(stats.defense))
        ? Number(stats.defense)
        : null
      : null;
    let atk = printedAtk ?? 0;
    let defVal = printedDef ?? 0;
    if (isFollower && printedAtk != null) {
      for (const m of inst.modifiers || []) {
        atk += m.atk ?? 0;
        defVal += m.def ?? 0;
      }
    }
    return {
      showAtk: printedAtk != null,
      atk,
      showDef: printedDef != null,
      def: defVal,
    };
  };

  const applyStats = (inst, idx, displayKey) => {
    const key = displayKey || instanceKey(inst);
    const stats = getCardStatsClient(key);
    const combat = applyFollowerCombatStats(inst, stats);
    customValues[idx] = {
      showAtk: combat.showAtk,
      atk: combat.atk,
      showDef: combat.showDef,
      def: combat.def,
    };
    wardField[idx] = hasKeywordFlag(stats, inst, "ward") ? 1 : 0;
    baneField[idx] = hasKeywordFlag(stats, inst, "bane") ? 1 : 0;
    auraField[idx] = hasKeywordFlag(stats, inst, "aura") ? 1 : 0;
    rushField[idx] = hasKeywordFlag(stats, inst, "rush") ? 1 : 0;
    stormField[idx] = hasKeywordFlag(stats, inst, "storm") ? 1 : 0;
    drainField[idx] = hasKeywordFlag(stats, inst, "drain") ? 1 : 0;
    intimidateField[idx] = hasKeywordFlag(stats, inst, "intimidate") ? 1 : 0;
    engagedField[idx] = Boolean(inst.engaged);
  };

  const selfAttached = attachmentIds(ps);
  const boardField = ps.zones.field.filter((inst) => isBoardOccupant(inst, selfAttached));
  boardField.forEach((inst, i) => {
    field[i] = cardName(inst);
    fieldInstanceIds[i] = inst.instanceId;
    counterField[i] = visibleCounter(inst);
    const eqNames = equipmentNamesFor(ps, inst);
    if (eqNames.length) equipmentField[i] = eqNames.length === 1 ? eqNames[0] : eqNames;
    const link = ps.zones.evolveZone.find((l) => l.fieldInstanceId === inst.instanceId);
    const evoInst =
      (link ? findEvoInstance(ps, link.evolveInstanceId) : null) ||
      (inst.linkedEvoInstanceId ? findEvoInstance(ps, inst.linkedEvoInstanceId) : null);
    if (evoInst) {
      evoField[i] = cardName(evoInst);
      applyStats(inst, i, instanceKey(evoInst));
    } else {
      applyStats(inst, i);
    }
  });

  ps.zones.exArea.forEach((inst, i) => {
    const idx = 5 + i;
    field[idx] = cardName(inst);
    fieldInstanceIds[idx] = inst.instanceId;
    counterField[idx] = visibleCounter(inst);
    applyStats(inst, idx);
    const printed = getCardStatsClient(instanceKey(inst)).cost ?? 0;
    const effective = view.exPlayCosts?.[inst.instanceId];
    if (effective != null && effective < printed) {
      exPlayCostField[idx] = effective;
    }
  });

  const enemyField = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const enemyFieldInstanceIds = Array(10).fill(null);
  const enemyEvoField = Array(10).fill(0);
  const enemyEngaged = Array(10).fill(false);
  const enemyExPlayCostField = Array(10).fill(null);
  const enemyCounterField = Array(10).fill(0);
  const enemyWardField = Array(10).fill(0);
  const enemyBaneField = Array(10).fill(0);
  const enemyAuraField = Array(10).fill(0);
  const enemyRushField = Array(10).fill(0);
  const enemyStormField = Array(10).fill(0);
  const enemyDrainField = Array(10).fill(0);
  const enemyIntimidateField = Array(10).fill(0);
  const enemyCustom = Array(10)
    .fill(null)
    .map(() => ({ showAtk: false, atk: 0, showDef: false, def: 0 }));

  const applyEnemyKeywordFlags = (inst, idx, displayKey) => {
    const key = displayKey || instanceKey(inst);
    const stats = getCardStatsClient(key);
    enemyWardField[idx] = hasKeywordFlag(stats, inst, "ward") ? 1 : 0;
    enemyBaneField[idx] = hasKeywordFlag(stats, inst, "bane") ? 1 : 0;
    enemyAuraField[idx] = hasKeywordFlag(stats, inst, "aura") ? 1 : 0;
    enemyRushField[idx] = hasKeywordFlag(stats, inst, "rush") ? 1 : 0;
    enemyStormField[idx] = hasKeywordFlag(stats, inst, "storm") ? 1 : 0;
    enemyDrainField[idx] = hasKeywordFlag(stats, inst, "drain") ? 1 : 0;
    enemyIntimidateField[idx] = hasKeywordFlag(stats, inst, "intimidate") ? 1 : 0;
  };

  const enemyAttached = attachmentIds(es);
  const enemyBoard = es.zones.field.filter((inst) =>
    isBoardOccupant(inst, enemyAttached),
  );
  enemyBoard.forEach((inst, i) => {
    enemyField[i] = cardName(inst);
    enemyFieldInstanceIds[i] = inst.instanceId;
    enemyCounterField[i] = visibleCounter(inst);
    enemyEngaged[i] = Boolean(inst.engaged);
    const eqNames = equipmentNamesFor(es, inst);
    if (eqNames.length) {
      enemyEquipmentField[i] = eqNames.length === 1 ? eqNames[0] : eqNames;
    }
    const link = es.zones.evolveZone.find((l) => l.fieldInstanceId === inst.instanceId);
    const evoInst =
      (link ? findEvoInstance(es, link.evolveInstanceId) : null) ||
      (inst.linkedEvoInstanceId ? findEvoInstance(es, inst.linkedEvoInstanceId) : null);
    if (evoInst) {
      enemyEvoField[i] = cardName(evoInst);
    }
    const displayKey = evoInst ? instanceKey(evoInst) : instanceKey(inst);
    const est = getCardStatsClient(displayKey);
    const combat = applyFollowerCombatStats(inst, est);
    enemyCustom[i] = {
      showAtk: combat.showAtk,
      atk: combat.atk,
      showDef: combat.showDef,
      def: combat.def,
    };
    applyEnemyKeywordFlags(inst, i, displayKey);
  });
  es.zones.exArea.forEach((inst, i) => {
    const idx = 5 + i;
    enemyField[idx] = cardName(inst);
    enemyFieldInstanceIds[idx] = inst.instanceId;
    enemyCounterField[idx] = visibleCounter(inst);
    const est = getCardStatsClient(instanceKey(inst));
    const combat = applyFollowerCombatStats(inst, est);
    enemyCustom[idx] = {
      showAtk: combat.showAtk,
      atk: combat.atk,
      showDef: combat.showDef,
      def: combat.def,
    };
    applyEnemyKeywordFlags(inst, idx);
    const printed = getCardStatsClient(instanceKey(inst)).cost ?? 0;
    const effective = view.opponentExPlayCosts?.[inst.instanceId];
    if (effective != null && effective < printed) {
      enemyExPlayCostField[idx] = effective;
    }
  });

  return {
    hand: ps.zones.hand.map((c) => cardName(c)),
    handInstanceIds: ps.zones.hand.map((c) => c.instanceId),
    enemyHand: Array(view.opponentHandCount).fill("Hidden Card"),
    deck: ps.zones.deck.map((c) => cardName(c)),
    enemyDeckSize: view.opponentDeckCount ?? es.zones.deck.length,
    field,
    fieldInstanceIds,
    evoField,
    engagedField,
    equipmentField,
    customValues,
    wardField,
    baneField,
    auraField,
    rushField,
    stormField,
    drainField,
    intimidateField,
    exPlayCostField,
    counterField,
    enemyField,
    enemyFieldInstanceIds,
    enemyEvoField,
    enemyEngagedField: enemyEngaged,
    enemyEquipmentField,
    enemyExPlayCostField,
    enemyCounterField,
    enemyCustomValues: enemyCustom,
    enemyWardField,
    enemyBaneField,
    enemyAuraField,
    enemyRushField,
    enemyStormField,
    enemyDrainField,
    enemyIntimidateField,
    cemetery: ps.zones.cemetery.map((c) => cardName(c)),
    cemeteryInstanceIds: ps.zones.cemetery.map((c) => c.instanceId),
    enemyCemetery: es.zones.cemetery.map((c) => cardName(c)),
    banish: ps.zones.banish.map((c) => cardName(c)),
    banishInstanceIds: ps.zones.banish.map((c) => c.instanceId),
    enemyBanish: es.zones.banish.map((c) => cardName(c)),
    evoDeck: [
      ...ps.zones.evolveDeck.map((c) => ({
        card: cardName(c),
        status: Boolean(c.evolveUsed),
      })),
      // Evolve cards currently on field followers stay shown face-up (used).
      ...ps.zones.evolveZone
        .map((link) => {
          const evo = findEvoInstance(ps, link.evolveInstanceId);
          return evo ? { card: cardName(evo), status: true } : null;
        })
        .filter(Boolean),
    ],
    enemyEvoDeck: [
      ...es.zones.evolveDeck.map((c) => {
        const used = Boolean(c.evolveUsed);
        const key = instanceKey(c);
        const hidden = !used || key === "HIDDEN";
        return {
          card: hidden ? "Hidden Card" : cardName(c),
          status: used,
        };
      }),
      // Opponent evolve cards currently on field are public (face-up).
      ...es.zones.evolveZone
        .map((link) => {
          const evo = findEvoInstance(es, link.evolveInstanceId);
          if (!evo) return null;
          const key = instanceKey(evo);
          if (key === "HIDDEN") return { card: "Hidden Card", status: true };
          return { card: cardName(evo), status: true };
        })
        .filter(Boolean),
    ],
    playPoints: { available: ps.pp, max: ps.maxPp },
    enemyPlayPoints: { available: es.pp, max: es.maxPp },
    evoPoints: ps.evoPoints,
    enemyEvoPoints: es.evoPoints,
    playerHealth: ps.leaderDef,
    enemyHealth: es.leaderDef,
    leaderActive: view.state.activePlayer === self && view.state.phase === "main",
    enemyLeaderActive: view.state.activePlayer === enemy && view.state.phase === "main",
    superEvoActive: canSuperEvolveNow(view.state, self),
    enemySuperEvoActive: canSuperEvolveNow(view.state, enemy),
    instanceMap: buildInstanceMap(ps),
  };
}

function buildInstanceMap(ps) {
  const map = {};
  const add = (list) => {
    for (const c of list) {
      const key = instanceKey(c);
      const name =
        getNameByCardNoClient(key) ||
        getCardDefClient(key)?.name ||
        key;
      map[name] = { instanceId: c.instanceId, cardNo: key, name: key };
    }
  };
  add(ps.zones.hand);
  add(ps.zones.field);
  add(ps.zones.exArea);
  return map;
}

/** Names the authoritative engine actually knows (card-stats sync + MVP stubs). */
const ENGINE_CARD_NAMES = new Set([
  ...Object.values(cardStats).map((s) => s?.name).filter(Boolean),
  ...mvpCards.map((c) => c.name).filter(Boolean),
]);

/**
 * Map a deck-builder name to an engine identity when we can normalize it.
 * Unknown names are passed through — the server registry is the source of truth.
 * Never silently rewrite a deck name to a different card via texture cardNo →
 * card-stats lookup (those codes collide when cards.json is incomplete).
 */
function resolveEngineCardName(name, fallback) {
  if (!name) return fallback;
  if (ENGINE_CARD_NAMES.has(name)) return name;
  const stripped = String(name).replace(/\s+TOKEN$/i, "").trim();
  const asToken = `${stripped} TOKEN`;
  if (ENGINE_CARD_NAMES.has(asToken)) return asToken;
  if (stripped !== name && ENGINE_CARD_NAMES.has(stripped)) return stripped;
  return name;
}

/** Build deck payload for server from deck names. Engine identity is the card name. */
export function deckToEnginePayload(mainDeckNames, evoDeckNames) {
  const identity = detectDeckIdentity(mainDeckNames, evoDeckNames);
  return {
    mainDeck: mainDeckNames.map((name) => resolveEngineCardName(name, "Vanilla Soldier")),
    evolveDeck: evoDeckNames.map((name) =>
      resolveEngineCardName(name, "Eager Recruit Evolved"),
    ),
    universe: identity.universe ?? undefined,
  };
}

/** Default MVP deck for rules-enforced mode when selected deck has no engine mapping. */
export function defaultMvpDeck() {
  const filler = Array(35).fill("Vanilla Soldier");
  const extras = [
    "Fanfare Scholar",
    "Fanfare Scholar",
    "Eager Recruit",
    "Eager Recruit",
    "Fireball",
  ];
  return {
    mainDeck: [...filler, ...extras],
    evolveDeck: ["Eager Recruit Evolved", "Eager Recruit Evolved"],
  };
}

export function resolveCardImage(cardName) {
  return cardImage(cardName) || "";
}
