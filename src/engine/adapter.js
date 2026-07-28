import {
  getCardDefClient,
  getCardByNameClient,
  getNameByCardNoClient,
  getCardStatsClient,
} from "./cardLookup";
import { cardImage, getCardNoFromName } from "../decks/getCards";
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
    .map(() => ({ showAtk: true, atk: 0, showDef: true, def: 0 }));
  const wardField = Array(10).fill(0);
  const baneField = Array(10).fill(0);
  const auraField = Array(10).fill(0);
  const exPlayCostField = Array(10).fill(null);

  const cardName = (instance) => {
    const key = instanceKey(instance);
    if (key === "HIDDEN") return "Hidden Card";
    const resolved =
      getNameByCardNoClient(key) ||
      getCardDefClient(key)?.name ||
      key;
    // Present tokens without the data-file " TOKEN" suffix.
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

  const applyStats = (inst, idx, displayKey) => {
    const stats = getCardStatsClient(displayKey || instanceKey(inst));
    const isFollower = stats.cardType === "follower";
    let atk = stats.attack ?? 0;
    let defVal = stats.defense ?? 0;
    if (isFollower) {
      for (const m of inst.modifiers || []) {
        atk += m.atk ?? 0;
        defVal += m.def ?? 0;
      }
    }
    customValues[idx] = {
      showAtk: isFollower,
      atk,
      showDef: isFollower,
      def: defVal,
    };
    wardField[idx] = stats.keywords.includes("ward") ? 1 : 0;
    baneField[idx] = stats.keywords.includes("bane") ? 1 : 0;
    auraField[idx] = stats.keywords.includes("aura") ? 1 : 0;
    // Engaged = horizontal; reserved = vertical (do not rotate).
    engagedField[idx] = Boolean(inst.engaged);
  };

  ps.zones.field.forEach((inst, i) => {
    field[i] = cardName(inst);
    fieldInstanceIds[i] = inst.instanceId;
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
  const enemyCustom = Array(10)
    .fill(null)
    .map(() => ({ showAtk: true, atk: 0, showDef: true, def: 0 }));

  es.zones.field.forEach((inst, i) => {
    enemyField[i] = cardName(inst);
    enemyFieldInstanceIds[i] = inst.instanceId;
    enemyEngaged[i] = Boolean(inst.engaged);
    const link = es.zones.evolveZone.find((l) => l.fieldInstanceId === inst.instanceId);
    const evoInst =
      (link ? findEvoInstance(es, link.evolveInstanceId) : null) ||
      (inst.linkedEvoInstanceId ? findEvoInstance(es, inst.linkedEvoInstanceId) : null);
    if (evoInst) {
      enemyEvoField[i] = cardName(evoInst);
    }
    const displayKey = evoInst ? instanceKey(evoInst) : instanceKey(inst);
    const est = getCardStatsClient(displayKey);
    const isFollower = est.cardType === "follower";
    let atk = est.attack ?? 0;
    let defVal = est.defense ?? 0;
    if (isFollower) {
      for (const m of inst.modifiers || []) {
        atk += m.atk ?? 0;
        defVal += m.def ?? 0;
      }
    }
    enemyCustom[i] = {
      showAtk: isFollower,
      atk,
      showDef: isFollower,
      def: defVal,
    };
  });
  es.zones.exArea.forEach((inst, i) => {
    const idx = 5 + i;
    enemyField[idx] = cardName(inst);
    enemyFieldInstanceIds[idx] = inst.instanceId;
    const est = getCardStatsClient(instanceKey(inst));
    const isFollower = est.cardType === "follower";
    let atk = est.attack ?? 0;
    let defVal = est.defense ?? 0;
    if (isFollower) {
      for (const m of inst.modifiers || []) {
        atk += m.atk ?? 0;
        defVal += m.def ?? 0;
      }
    }
    enemyCustom[idx] = {
      showAtk: isFollower,
      atk,
      showDef: isFollower,
      def: defVal,
    };
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
    field,
    fieldInstanceIds,
    evoField,
    engagedField,
    customValues,
    wardField,
    baneField,
    auraField,
    exPlayCostField,
    enemyField,
    enemyFieldInstanceIds,
    enemyEvoField,
    enemyEngagedField: enemyEngaged,
    enemyExPlayCostField,
    enemyCustomValues: enemyCustom,
    cemetery: ps.zones.cemetery.map((c) => cardName(c)),
    cemeteryInstanceIds: ps.zones.cemetery.map((c) => c.instanceId),
    enemyCemetery: es.zones.cemetery.map((c) => cardName(c)),
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
 * Never silently rewrite a whole deck to Vanilla Soldier (that breaks deploys
 * when the client card-stats set is incomplete).
 */
function resolveEngineCardName(name, fallback) {
  if (!name) return fallback;
  if (ENGINE_CARD_NAMES.has(name)) return name;
  const stripped = String(name).replace(/\s+TOKEN$/i, "").trim();
  const asToken = `${stripped} TOKEN`;
  if (ENGINE_CARD_NAMES.has(asToken)) return asToken;
  if (stripped !== name && ENGINE_CARD_NAMES.has(stripped)) return stripped;

  const cardNo =
    getCardByNameClient(name)?.cardNo ||
    getCardDefClient(name)?.cardNo ||
    getCardNoFromName(name);
  if (cardNo) {
    const fromStats = cardStats[cardNo]?.name;
    if (fromStats) return fromStats;
    const fromMvp = mvpCards.find((c) => c.cardNo === cardNo)?.name;
    if (fromMvp) return fromMvp;
  }
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
