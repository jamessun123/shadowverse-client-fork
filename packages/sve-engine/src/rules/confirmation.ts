import { getCardDef } from "../cards/registry";
import { placeLeavingPlay } from "../cards/tokens";
import { resetCardInstanceState } from "../state/card-reset";
import { canEffectResolve, resolveEffect } from "../effects/resolver";
import { isBoxed } from "../state/passives";
import {
  contextForTriggerResolution,
  shouldClearResolutionContext,
  shouldDeferTriggers,
} from "./effect-utils";
import {
  onCardEntersExAreaTriggers,
  queueAllyFollowerEnterTriggers,
  queueCemeteryOnAllyFollowerEnter,
  queueFanfare,
  queueLastWords,
} from "./trigger-queue";
import {
  flushPendingUnionBurst,
  markResolvingUnionBurst,
  scheduleOrRecordUnionBurstActivated,
} from "./union-burst";
import {
  fieldOccupancy,
  findInstance,
  getPlayer,
  getEffectiveStats,
  hasKeyword,
  isEquippedAttachment,
  resolveCardNo,
} from "../state/queries";
import { destroyFollower, drawCard, removeFromField } from "../state/zones";
import { GameState, PendingTrigger, PlayerId, TriggerTiming } from "../types";

function checkLosses(state: GameState): GameState {
  let next = structuredClone(state);
  for (const pid of [0, 1] as PlayerId[]) {
    if (next.players[pid].leaderDef <= 0) {
      next.winner = pid === 0 ? 1 : 0;
      next.phase = "gameOver";
      return next;
    }
    while (next.players[pid].flags.owedDraws > 0) {
      if (next.players[pid].zones.deck.length === 0) {
        next.winner = pid === 0 ? 1 : 0;
        next.phase = "gameOver";
        return next;
      }
      next = drawCard(next, pid);
      next.players[pid].flags.owedDraws -= 1;
    }
  }
  return next;
}

function destroyAtZeroDef(state: GameState): GameState {
  let next = state;
  let changed = true;
  while (changed) {
    changed = false;
    for (const pid of [0, 1] as PlayerId[]) {
      for (const card of [...getPlayer(next, pid).zones.field]) {
        const stats = getEffectiveStats(card, next);
        // Amulets and other non-followers have no defense and must not be
        // destroyed by the zero-def rule that applies to followers.
        if (!stats.hasCombatStats) continue;
        if (stats.def <= 0) {
          queueLastWords(next, card.instanceId, pid);
          next = destroyFollower(next, card.instanceId);
          changed = true;
        }
      }
    }
  }
  return next;
}

function resolveBane(state: GameState): GameState {
  let next = structuredClone(state);
  const toDestroy = new Set<string>();

  for (const pid of [0, 1] as PlayerId[]) {
    for (const card of next.players[pid].zones.field) {
      if (!card.foughtWithBane || !card.foughtWithInstanceId) continue;
      const opponent = findInstance(next, card.foughtWithInstanceId);
      if (!opponent || opponent.zone !== "field") continue;
      const cardHasBane = hasKeyword(card, "bane", next, pid);
      const oppHasBane = hasKeyword(opponent.card, "bane", next, opponent.player);
      if (cardHasBane && !oppHasBane) {
        toDestroy.add(card.foughtWithInstanceId);
      } else if (oppHasBane && !cardHasBane) {
        toDestroy.add(card.instanceId);
      } else if (cardHasBane && oppHasBane) {
        toDestroy.add(card.instanceId);
        toDestroy.add(card.foughtWithInstanceId);
      }
    }
  }

  for (const instanceId of toDestroy) {
    const found = findInstance(next, instanceId);
    if (!found || found.zone !== "field") continue;
    queueLastWords(next, instanceId, found.player);
    next = destroyFollower(next, instanceId);
  }

  return next;
}

function enforceFieldLimits(state: GameState): GameState {
  let next = structuredClone(state);
  for (const pid of [0, 1] as PlayerId[]) {
    const p = next.players[pid];
    while (fieldOccupancy(p.zones.field) > p.fieldLimit) {
      let idx = p.zones.field.length - 1;
      while (idx >= 0 && isEquippedAttachment(p.zones.field[idx])) idx -= 1;
      if (idx < 0) break;
      const [excess] = p.zones.field.splice(idx, 1);
      resetCardInstanceState(excess);
      placeLeavingPlay(p.zones, excess, "cemetery");
    }
    while (p.zones.exArea.length > p.exLimit) {
      const excess = p.zones.exArea.pop()!;
      resetCardInstanceState(excess);
      placeLeavingPlay(p.zones, excess, "cemetery");
    }
  }
  return next;
}

function capPlayPoints(state: GameState): GameState {
  const next = structuredClone(state);
  for (const pid of [0, 1] as PlayerId[]) {
    const p = next.players[pid];
    if (p.pp > p.maxPp) p.pp = p.maxPp;
  }
  return next;
}

export { queueLastWords, queueFanfare } from "./trigger-queue";

/** Fanfare and field-entry setup when a follower/amulet enters the field. */
export function onFollowerEntersField(
  state: GameState,
  instanceId: string,
  player: PlayerId,
): void {
  const found = findInstance(state, instanceId);
  if (!found || found.zone !== "field") return;
  if (found.card.enteredFromHand === undefined) {
    found.card.enteredFromHand = false;
  }
  found.card.enteredFieldTurn = state.turnNumber;
  found.card.onFieldSinceTurnStart = false;
  queueFanfare(state, instanceId, player);
  queueAllyFollowerEnterTriggers(state, instanceId, player);
  queueCemeteryOnAllyFollowerEnter(state, instanceId, player);
}

export function onCardEntersExArea(
  state: GameState,
  instanceId: string,
  player: PlayerId,
): void {
  onCardEntersExAreaTriggers(state, instanceId, player);
}

function markTriggerAbilityUsed(state: GameState, trigger: PendingTrigger): void {
  if (!trigger.abilityKey) return;
  const markableTimings: TriggerTiming[] = [
    "onCardPlayed",
    "onCardPlayedOrFused",
    "onCardFused",
    "onAllyFollowerEnter",
    "onOpponentDeckToCemetery",
    "onAbilityDamageTaken",
    "onAbilityDamageDealt",
    "onUnionBurstActivated",
  ];
  if (!markableTimings.includes(trigger.timing)) return;
  const found = findInstance(state, trigger.sourceInstanceId);
  if (!found) return;
  const { ability, abilityKey } = trigger;
  if (ability.oncePerTurn && !found.card.abilitiesActivatedThisTurn.includes(abilityKey)) {
    found.card.abilitiesActivatedThisTurn.push(abilityKey);
  }
  if (ability.maxPerTurn != null) {
    found.card.counters[abilityKey] = (found.card.counters[abilityKey] ?? 0) + 1;
  }
}

/** True when a pending trigger's effect can currently resolve (with source context). */
function isTriggerResolvable(state: GameState, trigger: PendingTrigger): boolean {
  const probe = structuredClone(state);
  const enteredId = trigger.ability.useEnteredTarget ? trigger.forcedTargetId : undefined;
  probe.resolutionContext = {
    ...contextForTriggerResolution(probe, trigger.sourceInstanceId, trigger.ability.effect),
    forcedTargetId: enteredId,
    lastSelectedTargetId: enteredId,
  };
  return canEffectResolve(probe, trigger.controller, trigger.ability.effect);
}

/** Drop triggers that would no-op (e.g. Fanfare 2PP with insufficient PP). */
function pruneUnresolvableTriggers(state: GameState): GameState {
  const next = structuredClone(state);
  next.pendingTriggers = next.pendingTriggers.filter((t) => isTriggerResolvable(next, t));
  return next;
}

export function resolveOneTrigger(state: GameState, trigger: PendingTrigger): GameState {
  let next = structuredClone(state);
  next.pendingTriggers = next.pendingTriggers.filter((t) => t.id !== trigger.id);
  // Set source before canEffectResolve — self-target effects (e.g. Apostle of Disdain
  // buff/Storm) need sourceInstanceId to see any candidates.
  const enteredId = trigger.ability.useEnteredTarget ? trigger.forcedTargetId : undefined;
  next.resolutionContext = {
    ...contextForTriggerResolution(next, trigger.sourceInstanceId, trigger.ability.effect),
    // Auto-target the entered/activator follower when the ability opts in.
    forcedTargetId: enteredId,
    lastSelectedTargetId: enteredId,
  };
  if (trigger.ability.unionBurst) {
    next = markResolvingUnionBurst(next, trigger.sourceInstanceId);
  }
  // Comprehensive Rules 10.7.3.2: if it cannot be played, remove pending status only.
  if (!canEffectResolve(next, trigger.controller, trigger.ability.effect)) {
    if (shouldClearResolutionContext(next)) {
      next.resolutionContext = null;
    }
    return next;
  }
  next = resolveEffect(next, trigger.ability.effect, trigger.controller);
  markTriggerAbilityUsed(next, trigger);
  next = scheduleOrRecordUnionBurstActivated(
    next,
    trigger.controller,
    trigger.sourceInstanceId,
    trigger.ability,
  );
  if (shouldClearResolutionContext(next)) {
    next = flushPendingUnionBurst(next);
    next.resolutionContext = null;
  }
  return next;
}

export function runConfirmationTiming(state: GameState): GameState {
  if (state.phase === "gameOver") return state;

  let next = structuredClone(state);
  let loop = true;
  /** Hard cap so last-words summon chains (e.g. White/Black Psalm) cannot softlock or auto-win. */
  let resolutions = 0;
  const maxResolutions = 64;

  while (loop) {
    loop = false;
    if (resolutions >= maxResolutions) return next;

    if (next.pendingChoices && next.pendingChoices.type !== "mulligan") return next;

    next = capPlayPoints(next);
    next = resolveBane(next);

    // Resolve "whenever this takes ability damage" before destroyAtZeroDef so dig/buff
    // effects (e.g. Galmieux, Ardent Disdain) still see the damaged follower on the field.
    if (shouldDeferTriggers(next)) return next;
    const adtActive = next.pendingTriggers.filter(
      (t) => t.timing === "onAbilityDamageTaken" && t.controller === next.activePlayer,
    );
    const adtInactive = next.pendingTriggers.filter(
      (t) => t.timing === "onAbilityDamageTaken" && t.controller !== next.activePlayer,
    );
    if (adtActive.length > 1) {
      next.pendingChoices = {
        type: "selectTrigger",
        player: next.activePlayer,
        options: adtActive.map((t) => ({
          triggerId: t.id,
          label: t.label,
        })),
      };
      return next;
    }
    if (adtActive.length === 1) {
      next = resolveOneTrigger(next, adtActive[0]);
      resolutions += 1;
      loop = true;
      continue;
    }
    if (adtInactive.length > 1) {
      const opp = next.activePlayer === 0 ? 1 : 0;
      next.pendingChoices = {
        type: "selectTrigger",
        player: opp,
        options: adtInactive.map((t) => ({
          triggerId: t.id,
          label: t.label,
        })),
      };
      return next;
    }
    if (adtInactive.length === 1) {
      next = resolveOneTrigger(next, adtInactive[0]);
      resolutions += 1;
      loop = true;
      continue;
    }

    next = destroyAtZeroDef(next);
    next = enforceFieldLimits(next);
    next = checkLosses(next);
    if (next.phase === "gameOver") return next;

    if (shouldDeferTriggers(next)) return next;

    // Remove fanfares/triggers that cannot resolve before offering order choice
    // (e.g. Karyl's "2PP: Equip" after spending all PP to play her).
    const beforePrune = next.pendingTriggers.length;
    next = pruneUnresolvableTriggers(next);
    if (next.pendingTriggers.length !== beforePrune) {
      loop = true;
      continue;
    }

    const activeTriggers = next.pendingTriggers.filter((t) => t.controller === next.activePlayer);
    const inactiveTriggers = next.pendingTriggers.filter((t) => t.controller !== next.activePlayer);

    if (activeTriggers.length > 1 && !next.pendingChoices) {
      next.pendingChoices = {
        type: "selectTrigger",
        player: next.activePlayer,
        options: activeTriggers.map((t) => ({
          triggerId: t.id,
          label: t.label,
        })),
      };
      return next;
    }

    if (activeTriggers.length === 1) {
      next = resolveOneTrigger(next, activeTriggers[0]);
      resolutions += 1;
      loop = true;
      continue;
    }

    if (inactiveTriggers.length > 1 && !next.pendingChoices) {
      const opp = next.activePlayer === 0 ? 1 : 0;
      next.pendingChoices = {
        type: "selectTrigger",
        player: opp,
        options: inactiveTriggers.map((t) => ({
          triggerId: t.id,
          label: t.label,
        })),
      };
      return next;
    }

    if (inactiveTriggers.length === 1) {
      next = resolveOneTrigger(next, inactiveTriggers[0]);
      resolutions += 1;
      loop = true;
    }
  }

  return next;
}
