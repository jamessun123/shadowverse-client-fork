import { crestAlreadyInExArea } from "../cards/crests";
import { getCardDef } from "../cards/registry";
import { normalizeIdentityName } from "../cards/reprints";
import { placeLeavingPlay } from "../cards/tokens";
import {
  buryDeckCards,
  canPlayCardFromZones,
  moveZoneCardTo,
  resolveEffect,
  resolveSpell,
} from "../effects/resolver";
import { applyMulligan, beginStartPhase } from "../phases/setup";
import {
  onCardEntersExArea,
  onFollowerEntersField,
  resolveOneTrigger,
  runConfirmationTiming,
} from "../rules/confirmation";
import {
  contextForTriggerResolution,
  canAdvanceActivate,
  finishDeferredTriggers,
  getChosenChooseIndices,
  getChosenChooseLabels,
  isAdvanceAbility,
  recordChosenChooseOption,
  shouldClearResolutionContext,
  shouldDeferTriggers,
  withChoiceContext,
} from "../rules/effect-utils";
import { clearRevealedCards, revealCard, shouldRevealBeforeHand } from "../state/reveal";
import { describeAbility } from "../rules/trigger-labels";
import {
  queueLastWords,
  queueOnCardPlayed,
  queueOnCardFused,
  queueOnDiscard,
  queueStartOfEndAbilities,
} from "../rules/trigger-queue";
import {
  flushPendingUnionBurst,
  markResolvingUnionBurst,
  recordUnionBurstActivated,
  scheduleOrRecordUnionBurstActivated,
} from "../rules/union-burst";
import { cardMatchesFilter } from "../state/conditions";
import { resetCardInstanceState } from "../state/card-reset";
import {
  clampDamageToFollower,
  findInstance,
  findMatchingEvolveCard,
  evolveCardsMatch,
  canEvolveFollower,
  fieldOccupancy,
  getActivatedAbilities,
  getEffectivePlayCost,
  getEffectiveStats,
  computeEvolvePayment,
  getEffectiveEvolveCost,
  consumeGrantedPlayCostReductions,
  resolveCardDefCost,
  getLegalAttackTargets,
  getPlayer,
  getStrikeAbilities,
  hasFieldSpace,
  hasKeyword,
  opponentOf,
  resolveCardNo,
} from "../state/queries";
import { destroyFollower, drawCard, moveCard, shuffleDeck } from "../state/zones";
import { ActionResult, Effect, GameAction, GameState, PlayerId } from "../types";
import { appendActionLog } from "./actionLog";

function fail(state: GameState, error: string): ActionResult {
  return { ok: false, state, error };
}

function isQuickCard(def: ReturnType<typeof getCardDef> | undefined): boolean {
  if (!def) return false;
  if (def.keywords?.includes("quick")) return true;
  return Boolean(def.abilities?.some((a) => a.quick));
}

function hasPlayableQuickCards(state: GameState, player: PlayerId): boolean {
  const pp = state.players[player].pp;
  const quickZones: Array<{
    card: (typeof state.players)[0]["zones"]["hand"][0];
    fromZone: "hand" | "exArea";
  }> = [
    ...state.players[player].zones.hand.map((card) => ({ card, fromZone: "hand" as const })),
    ...state.players[player].zones.exArea.map((card) => ({ card, fromZone: "exArea" as const })),
  ];
  for (const { card, fromZone } of quickZones) {
    const def = getCardDef(card.name);
    if (!isQuickCard(def)) continue;
    const cost = getEffectivePlayCost(card, card.name, state, player, fromZone);
    if (pp >= cost && canPlayCardFromZones(state, player, card.name)) return true;
  }
  return false;
}

function proceedAfterEndMainQuick(state: GameState): GameState {
  let next = structuredClone(state);
  const player = next.activePlayer;
  next.quickWindow = null;
  next.quickWindowPlayer = null;
  next.phase = "end";

  const wards = getPlayer(next, player).zones.field.filter(
    (c) => hasKeyword(c, "ward", next) && !c.engaged,
  );
  if (wards.length > 0) {
    next.pendingChoices = {
      type: "wardEngage",
      player,
      candidates: wards.map((w) => ({
        instanceId: w.instanceId,
        name: resolveCardNo(next, w),
        label: getCardDef(resolveCardNo(next, w))?.name || w.name,
      })),
    };
    return next;
  }

  return beginEndPhaseDiscard(next);
}

function continueEndPhaseFlow(state: GameState): GameState {
  let next = structuredClone(state);
  if (next.pendingChoices || next.pendingTriggers.length > 0) return next;

  const player = next.activePlayer;
  const p = next.players[player];
  if (!p.flags.endStartAbilitiesQueued) {
    queueStartOfEndAbilities(next, player);
    p.flags.endStartAbilitiesQueued = true;
    next = runConfirmationTiming(next);
    if (next.pendingChoices || next.pendingTriggers.length > 0) return next;
  }

  if (!next.endPhaseQuickResolved) {
    const opp = opponentOf(player);
    if (hasPlayableQuickCards(next, opp)) {
      next.quickWindow = "endPhase";
      next.quickWindowPlayer = opp;
      return next;
    }
    next.endPhaseQuickResolved = true;
  }

  return proceedAfterEndMainQuick(next);
}

function preserveResumeContext(
  next: GameState,
  sourceId: string | undefined,
  stack: Effect[],
  tail: Effect[],
): GameState {
  const prev = next.resolutionContext;
  const appended = prev?.resumeAfterChoice ?? [];
  const owner = prev?.resumeOwnerInstanceId ?? sourceId;
  next.resolutionContext = {
    sourceInstanceId: sourceId,
    resumeOwnerInstanceId: owner,
    effectStack: stack,
    resumeAfterChoice: appended.length > 0 ? appended : tail,
    lastSelectedTargetId: prev?.lastSelectedTargetId,
    buriedCosts: prev?.buriedCosts,
    lastDiscardedCardName: prev?.lastDiscardedCardName,
    lastSelectedCardName: prev?.lastSelectedCardName,
    engagedAsCostCount: prev?.engagedAsCostCount,
    pendingUnionBurst: prev?.pendingUnionBurst,
    resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
    deferTriggers: true,
  };
  return next;
}

function continueAfterChoice(state: GameState, player: PlayerId): GameState {
  if (state.pendingChoices) return state;
  let next = state;
  const resumeOwner =
    next.resolutionContext?.resumeOwnerInstanceId ?? next.resolutionContext?.sourceInstanceId;
  const sourceId = resumeOwner;
  const stack = next.resolutionContext?.effectStack ?? [];

  // Do not resolve queued triggers while a multi-step effect still has resume work
  // (e.g. Disdainful Rending must finish both damages before Galmieux's ping trigger).
  const hasResume = (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0;
  if (!hasResume && !shouldDeferTriggers(next) && next.pendingTriggers.length > 0) {
    next = runConfirmationTiming(next);
    if (next.pendingChoices || next.pendingTriggers.length > 0) return next;
  }

  while (next.resolutionContext?.resumeAfterChoice?.length) {
    const [head, ...tail] = next.resolutionContext.resumeAfterChoice;
    const prev = next.resolutionContext;
    next.resolutionContext = {
      sourceInstanceId: sourceId,
      resumeOwnerInstanceId: resumeOwner ?? sourceId,
      effectStack: stack,
      resumeAfterChoice: tail,
      // Do not carry forcedTargetId into the next step (would auto-resolve unrelated
      // damage). Keep lastSelectedTargetId for conditions like Flag's Condemned check.
      lastSelectedTargetId: prev?.lastSelectedTargetId,
      buriedCosts: prev?.buriedCosts,
      lastDiscardedCardName: prev?.lastDiscardedCardName,
      lastSelectedCardName: prev?.lastSelectedCardName,
      engagedAsCostCount: prev?.engagedAsCostCount,
      pendingUnionBurst: prev?.pendingUnionBurst,
      resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
      deferTriggers: true,
    };
    next = resolveEffect(next, head, player, { deferConfirmation: true });
    if (next.pendingChoices) {
      return preserveResumeContext(next, sourceId, stack, tail);
    }
  }

  if (!next.pendingChoices && !(next.resolutionContext?.resumeAfterChoice?.length ?? 0)) {
    next = finishDeferredTriggers(next);
    // Flush the resolving spell (kept in resolution during choose/target prompts).
    if (sourceId) {
      const src = findInstance(next, sourceId);
      if (src?.zone === "resolutionZone" && getCardDef(src.card.name)?.cardType === "spell") {
        next = moveCard(next, sourceId, "cemetery", src.player);
      }
    }
    next = flushPendingUnionBurst(next);
    if (shouldClearResolutionContext(next)) {
      next.resolutionContext = null;
    }
  }
  return next;
}

function finishEndPhase(state: GameState): GameState {
  let next = structuredClone(state);
  const player = next.activePlayer;
  const hand = next.players[player].zones.hand;
  if (hand.length > next.players[player].handLimit) {
    const excess = hand.length - next.players[player].handLimit;
    next.pendingChoices = {
      type: "discard",
      player,
      count: excess,
      candidates: hand.map((c) => ({
        instanceId: c.instanceId,
        name: resolveCardNo(next, c),
        label: getCardDef(resolveCardNo(next, c))?.name || c.name,
      })),
    };
    return next;
  }
  return endTurn(next);
}

function maybeContinueEndPhase(state: GameState): GameState {
  if (state.phase !== "end") return state;
  return continueEndPhaseFlow(state);
}

function isCombatAttackerOnField(state: GameState): boolean {
  if (!state.combat) return false;
  const found = findInstance(state, state.combat.attackerId);
  return Boolean(found && found.zone === "field");
}

function abortCombatIfAttackerGone(state: GameState): GameState {
  if (!state.combat || isCombatAttackerOnField(state)) return state;
  const next = structuredClone(state);
  next.combat = null;
  next.phase = "main";
  next.quickWindow = null;
  next.quickWindowPlayer = null;
  return next;
}

function continuePausedCombat(state: GameState): GameState {
  if (!state.combat || state.pendingChoices) return state;
  let next = abortCombatIfAttackerGone(state);
  if (!next.combat) return next;

  const combat = next.combat;
  if (combat.strikeAbilityIndex != null) {
    next = structuredClone(next);
    next.phase = "combat";
    next.combat = { ...combat, strikeAbilityIndex: combat.strikeAbilityIndex + 1 };
    return resolveCombat(next);
  }

  if (combat.phase === "declared") {
    next = structuredClone(next);
    next.phase = "combat";
    return resolveCombat(next);
  }

  return next;
}

function finishChoiceResolution(state: GameState, player: PlayerId): GameState {
  let next = state;
  if (!next.pendingChoices) {
    next = continueAfterChoice(next, player);
  }
  next = runConfirmationTiming(next);
  if (!next.pendingChoices) {
    next = continuePausedCombat(next);
  }
  if (next.phase === "end") {
    next = continueEndPhaseFlow(next);
  } else {
    next = maybeContinueEndPhase(next);
  }
  return next;
}

function sendSearchRemainder(
  state: GameState,
  player: PlayerId,
  instanceIds: string[],
  remainderTo: "cemetery" | "deckBottom" | "deckTop" | "shuffle",
): GameState {
  if (remainderTo === "deckTop") {
    // Leave looked-at cards on top in their current order.
    return state;
  }
  if (remainderTo === "shuffle") {
    // Full-deck search: unchosen cards stay in place, then shuffle.
    return shuffleDeck(state, player);
  }
  if (remainderTo === "deckBottom") {
    let next = structuredClone(state);
    const deck = next.players[player].zones.deck;
    for (const id of instanceIds) {
      const idx = deck.findIndex((c) => c.instanceId === id);
      if (idx < 0) continue;
      const [card] = deck.splice(idx, 1);
      deck.push(card);
    }
    return next;
  }
  return buryDeckCards(state, player, instanceIds);
}

function ok(state: GameState): ActionResult {
  return { ok: true, state };
}

function assertActivePlayer(state: GameState, player: PlayerId, error: string): ActionResult | null {
  if (state.activePlayer !== player) return fail(state, error);
  return null;
}

function assertPhase(state: GameState, phases: GameState["phase"][], error: string): ActionResult | null {
  if (!phases.includes(state.phase)) return fail(state, error);
  return null;
}

function handleChoiceResponse(state: GameState, player: PlayerId, payload: Record<string, unknown>): ActionResult {
  const choice = state.pendingChoices;
  if (!choice || choice.player !== player) return fail(state, "No pending choice");

  let next = structuredClone(state);
  next.pendingChoices = null;

  if (choice.type === "mulligan") {
    return ok(applyMulligan(next, player, Boolean(payload.redraw)));
  }

  if (choice.type === "selectTrigger") {
    const triggerId = String(payload.triggerId);
    const trigger = next.pendingTriggers.find((t) => t.id === triggerId);
    if (!trigger) return fail(state, "Invalid trigger");
    next = resolveOneTrigger(next, trigger);
    next = finishChoiceResolution(next, player);
    next = maybeContinueEndPhase(next);
    return ok(next);
  }

  if (choice.type === "selectTarget") {
    const allowed = (choice.candidates ?? []).map((c) =>
      typeof c === "string" ? c : c.instanceId,
    );
    const minCount = choice.minCount ?? choice.count ?? 1;
    const maxCount = choice.maxCount ?? choice.count ?? 1;
    const isMulti = maxCount > 1 || minCount !== maxCount;

    let targetIds: string[] = [];
    if (isMulti) {
      targetIds = Array.isArray(payload.targetIds)
        ? (payload.targetIds as string[]).map(String)
        : payload.targetId
          ? [String(payload.targetId)]
          : [];
      if (targetIds.length < minCount || targetIds.length > maxCount) {
        return fail(
          state,
          minCount === maxCount
            ? `Must select exactly ${minCount} card(s)`
            : `Must select between ${minCount} and ${maxCount} card(s)`,
        );
      }
      for (const id of targetIds) {
        if (!allowed.includes(id)) return fail(state, "Invalid target");
      }
    } else {
      const targetId = String(payload.targetId);
      if (!allowed.includes(targetId)) {
        return fail(state, "Invalid target");
      }
      targetIds = [targetId];
    }

    const resume = next.resolutionContext?.resumeAfterChoice;
    const prev = next.resolutionContext;
    const sourceId = prev?.sourceInstanceId ?? next.combat?.attackerId;
    next.resolutionContext = {
      sourceInstanceId: sourceId,
      resumeOwnerInstanceId: prev?.resumeOwnerInstanceId ?? sourceId,
      effectStack: [choice.effect],
      forcedTargetId: targetIds[0],
      forcedTargetIds: isMulti ? targetIds : undefined,
      lastSelectedTargetId: targetIds[0],
      resumeAfterChoice: resume,
      buriedCosts: prev?.buriedCosts,
      lastDiscardedCardName: prev?.lastDiscardedCardName,
      lastSelectedCardName: prev?.lastSelectedCardName,
      engagedAsCostCount: prev?.engagedAsCostCount,
      pendingUnionBurst: prev?.pendingUnionBurst,
      resolvingUnionBurstSourceId: prev?.resolvingUnionBurstSourceId,
      deferTriggers: true,
    };
    // Defer confirmation so multi-step spells (e.g. Disdainful Rending) finish
    // their resume queue before queued ability-damage triggers resolve.
    next = resolveEffect(next, choice.effect, player, { deferConfirmation: true });
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "selectZoneCards") {
    const ids = (payload.instanceIds as string[]) || [];
    const minCount = choice.minCount ?? choice.count;
    const maxCount = choice.maxCount ?? choice.count;
    if (ids.length < minCount || ids.length > maxCount) {
      return fail(
        state,
        minCount === maxCount
          ? `Must select exactly ${minCount} card(s)`
          : `Must select between ${minCount} and ${maxCount} card(s)`,
      );
    }
    for (const id of ids) {
      if (!choice.options.some((o) => o.instanceId === id)) {
        return fail(state, "Invalid card");
      }
    }
    for (const id of ids) {
      if (choice.fromZone === "field" && choice.action === "engage") {
        const found = findInstance(next, id);
        if (!found || found.zone !== "field") return fail(state, "Invalid card");
        if (found.card.engaged) return fail(state, "Card is already engaged");
        found.card.engaged = true;
        continue;
      }
      if (choice.fromZone === "field" && choice.action === "bury") {
        const buried = findInstance(next, id);
        if (!buried || buried.zone !== "field") return fail(state, "Invalid card");
        queueLastWords(next, id, buried.player);
        next = destroyFollower(next, id);
        continue;
      }
      if (choice.action === "fuse") {
        const pZones = next.players[player].zones;
        let handIdx = pZones.hand.findIndex((c) => c.instanceId === id);
        if (handIdx >= 0) {
          const [card] = pZones.hand.splice(handIdx, 1);
          resetCardInstanceState(card);
          placeLeavingPlay(pZones, card, "cemetery");
          queueOnDiscard(next, card.instanceId, player);
          next.resolutionContext = {
            ...next.resolutionContext,
            sourceInstanceId: next.resolutionContext?.sourceInstanceId,
            resumeOwnerInstanceId: next.resolutionContext?.resumeOwnerInstanceId,
            effectStack: next.resolutionContext?.effectStack ?? [],
            resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
            deferTriggers: next.resolutionContext?.deferTriggers,
            buriedCosts: next.resolutionContext?.buriedCosts,
            engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
            lastDiscardedCardName: card.name,
          };
          continue;
        }
        const exIdx = pZones.exArea.findIndex((c) => c.instanceId === id);
        if (exIdx < 0) return fail(state, "Invalid card");
        const [card] = pZones.exArea.splice(exIdx, 1);
        resetCardInstanceState(card);
        placeLeavingPlay(pZones, card, "cemetery");
        continue;
      }
      const zone = next.players[player].zones[choice.fromZone];
      const idx = zone.findIndex((c) => c.instanceId === id);
      if (idx < 0) return fail(state, "Invalid card");
      const [card] = zone.splice(idx, 1);
      if (choice.action === "banish") {
        resetCardInstanceState(card);
        placeLeavingPlay(next.players[player].zones, card, "banish");
      } else {
        resetCardInstanceState(card);
        placeLeavingPlay(next.players[player].zones, card, "cemetery");
        if (choice.action === "discard" && choice.fromZone === "hand") {
          queueOnDiscard(next, card.instanceId, player);
          next.resolutionContext = {
            ...next.resolutionContext,
            sourceInstanceId: next.resolutionContext?.sourceInstanceId,
            resumeOwnerInstanceId: next.resolutionContext?.resumeOwnerInstanceId,
            effectStack: next.resolutionContext?.effectStack ?? [],
            resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
            deferTriggers: next.resolutionContext?.deferTriggers,
            buriedCosts: next.resolutionContext?.buriedCosts,
            engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
            lastDiscardedCardName: card.name,
          };
        }
      }
    }
    if (choice.recordEngagedAsCost) {
      next.resolutionContext = {
        ...next.resolutionContext,
        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
        effectStack: next.resolutionContext?.effectStack ?? [],
        resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
        deferTriggers: next.resolutionContext?.deferTriggers,
        buriedCosts: next.resolutionContext?.buriedCosts,
        lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
        engagedAsCostCount: ids.length,
      };
    }
    if (choice.resumeActivate) {
      const { sourceInstanceId, zone: activateZone, abilityKey } = choice.resumeActivate;
      if (choice.fromZone === "exArea" && choice.action === "banish") {
        const ex = next.players[player].zones.exArea;
        const srcIdx = ex.findIndex((c) => c.instanceId === sourceInstanceId);
        if (srcIdx >= 0) {
          const [self] = ex.splice(srcIdx, 1);
          resetCardInstanceState(self);
          placeLeavingPlay(next.players[player].zones, self, "banish");
        }
      }
      next = finishActivateAfterCost(next, player, sourceInstanceId, activateZone, abilityKey);
      return ok(finishChoiceResolution(next, player));
    }
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "selectDeckSummon") {
    const ids = (payload.instanceIds as string[]) || [];
    let totalCost = 0;
    const p = next.players[player];
    const to = choice.to ?? "field";
    if (choice.maxCount != null && ids.length > choice.maxCount) {
      return fail(state, `Select up to ${choice.maxCount} card(s)`);
    }
    const seenNames = new Set<string>();
    for (const id of ids) {
      if (!choice.topInstanceIds.includes(id)) return fail(state, "Invalid card");
      const option = choice.options.find((o) => o.instanceId === id);
      if (!option?.eligible) return fail(state, "Card does not match filter");
      if (choice.distinctNames) {
        const key = normalizeIdentityName(option.name);
        if (seenNames.has(key)) {
          return fail(state, "Selected cards must have different names");
        }
        seenNames.add(key);
      }
      totalCost += option.cost;
    }
    if (choice.maxTotalCost != null && totalCost > choice.maxTotalCost) {
      return fail(state, `Total cost must be ${choice.maxTotalCost} or less`);
    }
    if (to === "field") {
      const slots = p.fieldLimit - fieldOccupancy(p.zones.field);
      if (ids.length > slots) return fail(state, "Not enough field space");
    } else if (to === "exArea") {
      const slots = p.exLimit - p.zones.exArea.length;
      if (ids.length > slots) return fail(state, "Not enough EX space");
    } else if (to === "hand") {
      // hand has no hard limit for this search
    }
    for (const id of ids) {
      const idx = next.players[player].zones.deck.findIndex((c) => c.instanceId === id);
      if (idx < 0) continue;
      const [card] = next.players[player].zones.deck.splice(idx, 1);
      if (choice.playCostReduction) {
        card.playCostReduction = (card.playCostReduction ?? 0) + choice.playCostReduction;
      }
      if (to === "exArea") {
        if (next.players[player].zones.exArea.length >= next.players[player].exLimit) break;
        next.players[player].zones.exArea.push(card);
        onCardEntersExArea(next, card.instanceId, player);
      } else if (to === "hand") {
        next.players[player].zones.hand.push(card);
        if (shouldRevealBeforeHand("hand", "deck", choice.reveal)) {
          next = revealCard(next, player, id, card.name);
        }
      } else {
        if (!hasFieldSpace(next.players[player].zones.field, next.players[player].fieldLimit)) break;
        next.players[player].zones.field.push(card);
        onFollowerEntersField(next, card.instanceId, player);
      }
    }
    const remaining = choice.topInstanceIds.filter((id) => !ids.includes(id));
    next = sendSearchRemainder(next, player, remaining, choice.remainderTo);
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "selectCemeterySummon") {
    const ids = (payload.instanceIds as string[]) || [];
    const minCount = choice.minCount ?? 1;
    if (ids.length < minCount || ids.length > choice.count) {
      return fail(
        state,
        minCount === choice.count
          ? `Select exactly ${choice.count} card(s)`
          : `Select ${minCount} to ${choice.count} card(s)`,
      );
    }
    let totalCost = 0;
    const p = next.players[player];
    const seenNames = new Set<string>();
    for (const id of ids) {
      const card = p.zones.cemetery.find((c) => c.instanceId === id);
      if (!card || !cardMatchesFilter(card.name, choice.filter)) {
        return fail(state, "Invalid card");
      }
      if (choice.distinctNames) {
        const key = normalizeIdentityName(card.name);
        if (seenNames.has(key)) {
          return fail(state, "Selected cards must have different names");
        }
        seenNames.add(key);
      }
      totalCost += resolveCardDefCost(card.name);
    }
    if (choice.maxTotalCost != null && totalCost > choice.maxTotalCost) {
      return fail(state, `Total cost must be ${choice.maxTotalCost} or less`);
    }
    const slots = p.fieldLimit - fieldOccupancy(p.zones.field);
    if (ids.length > slots) return fail(state, "Not enough field space");
    for (const id of ids) {
      const idx = p.zones.cemetery.findIndex((c) => c.instanceId === id);
      if (idx < 0) continue;
      const [card] = p.zones.cemetery.splice(idx, 1);
      p.zones.field.push(card);
      onFollowerEntersField(next, card.instanceId, player);
    }
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "putHandOnDeck") {
    if (choice.phase === "selectCard") {
      const instanceId = String(payload.instanceId);
      const found = findInstance(next, instanceId);
      if (!found || found.zone !== "hand" || found.player !== player) {
        return fail(state, "Invalid card");
      }
      if (!choice.position) {
        next.pendingChoices = {
          type: "putHandOnDeck",
          player,
          phase: "selectPosition",
          selectedInstanceId: instanceId,
          options: choice.options,
        };
        return ok(next);
      }
      next = putHandCardOnDeck(next, player, instanceId, choice.position);
      return ok(finishChoiceResolution(next, player));
    }
    const position = payload.position === "bottom" ? "bottom" : "top";
    if (!choice.selectedInstanceId) return fail(state, "No card selected");
    next = putHandCardOnDeck(next, player, choice.selectedInstanceId, position);
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "selectZoneCard") {
    if (payload.skip && choice.optional) {
      return ok(finishChoiceResolution(next, player));
    }
    const instanceId = String(payload.instanceId);
    const zoneOwner = choice.fromPlayer ?? player;
    const found = findInstance(next, instanceId);
    if (!found || found.zone !== choice.fromZone || found.player !== zoneOwner) {
      return fail(state, "Invalid card");
    }
    if (next.resolutionContext) {
      next.resolutionContext.lastSelectedCardName = found.card.name;
      next.resolutionContext.lastSelectedTargetId = instanceId;
    } else {
      next.resolutionContext = {
        effectStack: [],
        lastSelectedCardName: found.card.name,
        lastSelectedTargetId: instanceId,
        deferTriggers: true,
      };
    }
    if (choice.playSelected) {
      const def = getCardDef(found.card.name);
      if (!def) return fail(state, "Unknown card");
      if (def.cardType === "crest") {
        if (next.players[player].zones.exArea.length >= next.players[player].exLimit) {
          return fail(state, "EX area full");
        }
      } else if (
        def.cardType !== "spell" &&
        !hasFieldSpace(next.players[player].zones.field, next.players[player].fieldLimit)
      ) {
        return fail(state, "Field full");
      }
      // Spells with no legal targets: accept the cemetery choice and close the
      // prompt, but do not play the card (it stays in the cemetery).
      if (def.cardType === "spell" && !canPlayCardFromZones(next, player, found.card.name)) {
        return ok(finishChoiceResolution(next, player));
      }
      next = playCardForFree(next, player, instanceId);
      return ok(finishChoiceResolution(next, player));
    }
    if (shouldRevealBeforeHand(choice.to, choice.fromZone, choice.reveal)) {
      next = revealCard(next, zoneOwner, instanceId, found.card.name);
    }
    if (zoneOwner !== player) {
      next = moveCard(next, instanceId, choice.to, player);
      if (choice.to === "exArea" && choice.playCostReduction) {
        const moved = findInstance(next, instanceId);
        if (moved) {
          moved.card.playCostReduction += choice.playCostReduction;
        }
      }
      if (choice.to === "field") {
        const moved = findInstance(next, instanceId);
        if (moved) {
          moved.card.enteredFromCemetery = choice.fromZone === "cemetery";
          moved.card.enteredFromHand = choice.fromZone === "hand";
        }
      }
    } else {
      next = moveZoneCardTo(next, player, instanceId, choice.fromZone, choice.to);
      if (choice.to === "exArea" && choice.playCostReduction) {
        const moved = findInstance(next, instanceId);
        if (moved) {
          moved.card.playCostReduction += choice.playCostReduction;
        }
      }
    }
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "searchDeckTop") {
    const remainderTo = choice.remainderTo ?? "cemetery";
    if (payload.skip && choice.optional) {
      next = sendSearchRemainder(next, player, choice.topInstanceIds, remainderTo);
      return ok(finishChoiceResolution(next, player));
    }
    const instanceId = String(payload.instanceId);
    if (!choice.topInstanceIds.includes(instanceId)) {
      return fail(state, "Invalid card");
    }
    const option = choice.options.find((o) => o.instanceId === instanceId);
    if (!option?.eligible) return fail(state, "Card does not match filter");
    if (shouldRevealBeforeHand(choice.to, "deck", choice.reveal)) {
      next = revealCard(next, player, instanceId, option.name);
    }
    if (next.resolutionContext) {
      next.resolutionContext.lastSelectedCardName = option.name;
      next.resolutionContext.lastSelectedTargetId = instanceId;
    } else {
      next.resolutionContext = {
        effectStack: [],
        lastSelectedCardName: option.name,
        lastSelectedTargetId: instanceId,
        deferTriggers: true,
      };
    }
    if (choice.to === "cemetery") {
      next = buryDeckCards(next, player, [instanceId]);
    } else {
      next = moveZoneCardTo(next, player, instanceId, "deck", choice.to, false);
    }
    if (choice.to === "exArea") {
      const moved = findInstance(next, instanceId);
      if (!moved || moved.zone !== "exArea") {
        return fail(state, "EX area full");
      }
      if (
        choice.playCostReduction &&
        (!choice.playCostReductionFilter ||
          cardMatchesFilter(moved.card.name, choice.playCostReductionFilter))
      ) {
        moved.card.playCostReduction += choice.playCostReduction;
      }
    }
    const remaining = choice.topInstanceIds.filter((id) => id !== instanceId);
    next = sendSearchRemainder(next, player, remaining, remainderTo);
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "discard") {
    const ids = (payload.instanceIds as string[]) || [];
    if (ids.length !== choice.count) {
      return fail(state, `Must discard exactly ${choice.count} card(s)`);
    }
    const handIds = new Set(next.players[player].zones.hand.map((c) => c.instanceId));
    for (const id of ids) {
      if (!handIds.has(id)) return fail(state, "Card not in hand");
      next = moveCard(next, id, "cemetery", player);
      queueOnDiscard(next, id, player);
    }
    next = runConfirmationTiming(next);
    if (next.pendingChoices || next.pendingTriggers.length > 0) {
      return ok(next);
    }
    return ok(beginEndPhaseDiscard(next));
  }

  if (choice.type === "wardEngage") {
    const ids = (payload.instanceIds as string[]) || [];
    for (const id of ids) {
      const found = findInstance(next, id);
      if (found) found.card.engaged = true;
    }
    return ok(beginEndPhaseDiscard(next));
  }

  if (choice.type === "choose") {
    const index = Number(payload.optionIndex);
    const opt = choice.options.find((o) => o.index === index);
    if (!opt) return fail(state, "Invalid choice");
    if (opt.additionalPpCost) {
      if (next.players[player].pp < opt.additionalPpCost) {
        return fail(state, "Not enough PP");
      }
      next.players[player].pp -= opt.additionalPpCost;
    }
    const trackKey = choice.trackChosenKey;
    const sourceId =
      choice.sourceInstanceId ?? next.resolutionContext?.sourceInstanceId;
    if (trackKey) {
      const sourceCard = sourceId ? findInstance(next, sourceId)?.card : undefined;
      const usedIdx = getChosenChooseIndices(next, player, trackKey, sourceCard, sourceId);
      const usedLabels = getChosenChooseLabels(next, player, trackKey, sourceCard, sourceId);
      if (usedIdx.has(index) || usedLabels.has(opt.label)) {
        return fail(state, "Already chose that option this turn");
      }
    }
    // Defer confirmation so nested target prompts don't race with turn cleanup.
    next = resolveEffect(next, opt.effect, player, { deferConfirmation: true });
    // Record after the option effect so tracking lands on the final state clone.
    if (trackKey) {
      recordChosenChooseOption(next, player, trackKey, index, opt.label, sourceId);
    }
    return ok(finishChoiceResolution(next, player));
  }

  if (choice.type === "chooseMultiple") {
    const indices = (payload.optionIndices as number[]) || [];
    if (indices.length < choice.min || indices.length > choice.max) {
      return fail(state, `Choose between ${choice.min} and ${choice.max} option(s)`);
    }
    const unique = new Set(indices);
    if (unique.size !== indices.length) return fail(state, "Duplicate options");
    const effects = indices.flatMap((index) => {
      const opt = choice.options.find((o) => o.index === index);
      if (!opt) return [];
      if (opt.effect.op === "sequence") return opt.effect.steps;
      return [opt.effect];
    });
    next.resolutionContext = {
      sourceInstanceId: next.resolutionContext?.sourceInstanceId,
      resumeOwnerInstanceId: next.resolutionContext?.resumeOwnerInstanceId,
      effectStack: [],
      resumeAfterChoice: effects,
      pendingUnionBurst: next.resolutionContext?.pendingUnionBurst,
      resolvingUnionBurstSourceId: next.resolutionContext?.resolvingUnionBurstSourceId,
      buriedCosts: next.resolutionContext?.buriedCosts,
      lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
      lastSelectedCardName: next.resolutionContext?.lastSelectedCardName,
      lastSelectedTargetId: next.resolutionContext?.lastSelectedTargetId,
      engagedAsCostCount: next.resolutionContext?.engagedAsCostCount,
      deferTriggers: true,
    };
    return ok(finishChoiceResolution(next, player));
  }

  return ok(next);
}

function putHandCardOnDeck(
  state: GameState,
  player: PlayerId,
  instanceId: string,
  position: "top" | "bottom",
): GameState {
  const next = structuredClone(state);
  const hand = next.players[player].zones.hand;
  const idx = hand.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return state;
  const [card] = hand.splice(idx, 1);
  if (position === "top") next.players[player].zones.deck.unshift(card);
  else next.players[player].zones.deck.push(card);
  return next;
}

/** Play a card already in a zone (e.g. opponent cemetery) for 0 PP. */
function playCardForFree(
  state: GameState,
  player: PlayerId,
  instanceId: string,
): GameState {
  const found = findInstance(state, instanceId);
  if (!found) return state;
  const def = getCardDef(found.card.name);
  if (!def) return state;

  const prev = state.resolutionContext;
  let next = structuredClone(state);
  const p = next.players[player];
  p.flags.cardsPlayedThisTurn += 1;
  if (def.cardType === "spell") {
    p.flags.spellsPlayedThisTurn = (p.flags.spellsPlayedThisTurn ?? 0) + 1;
  }
  consumeGrantedPlayCostReductions(next, player, found.card.name);

  if (def.cardType === "crest") {
    if (p.zones.exArea.length >= p.exLimit) return state;
    if (crestAlreadyInExArea(next, player, found.card.name, instanceId)) return state;
    next = moveCard(next, instanceId, "exArea", player);
    next.resolutionContext = {
      sourceInstanceId: prev?.sourceInstanceId,
      effectStack: prev?.effectStack ?? [],
      resumeAfterChoice: prev?.resumeAfterChoice,
      forcedTargetId: prev?.forcedTargetId,
      buriedCosts: prev?.buriedCosts,
      lastDiscardedCardName: prev?.lastDiscardedCardName,
      lastSelectedCardName: prev?.lastSelectedCardName,
      engagedAsCostCount: prev?.engagedAsCostCount,
      deferTriggers: true,
    };
  } else if (def.cardType !== "spell") {
    if (!hasFieldSpace(p.zones.field, p.fieldLimit)) return state;
    next = moveCard(next, instanceId, "field", player);
    const onField = findInstance(next, instanceId);
    if (onField) {
      onField.card.enteredFromCemetery = found.zone === "cemetery";
      onField.card.enteredFromHand = false;
    }
    next.resolutionContext = {
      sourceInstanceId: prev?.sourceInstanceId,
      effectStack: prev?.effectStack ?? [],
      resumeAfterChoice: prev?.resumeAfterChoice,
      forcedTargetId: prev?.forcedTargetId,
      buriedCosts: prev?.buriedCosts,
      lastDiscardedCardName: prev?.lastDiscardedCardName,
      lastSelectedCardName: prev?.lastSelectedCardName,
      engagedAsCostCount: prev?.engagedAsCostCount,
      deferTriggers: true,
    };
  } else {
    next = moveCard(next, instanceId, "resolutionZone", player);
    next.resolutionContext = {
      sourceInstanceId: instanceId,
      resumeOwnerInstanceId: instanceId,
      effectStack: [],
      resumeAfterChoice: prev?.resumeAfterChoice,
      forcedTargetId: prev?.forcedTargetId,
      buriedCosts: prev?.buriedCosts,
      lastDiscardedCardName: prev?.lastDiscardedCardName,
      lastSelectedCardName: prev?.lastSelectedCardName,
      engagedAsCostCount: prev?.engagedAsCostCount,
      deferTriggers: true,
    };
    next = resolveSpell(next, found.card.name, player);
    if (!next.pendingChoices) {
      // Queue while the spell still exists — token spells are eliminated on
      // cemetery move and would otherwise skip on-play watchers (e.g. Barbaros).
      queueOnCardPlayed(next, instanceId, player, found.card.name);
      const res = findInstance(next, instanceId);
      if (res?.zone === "resolutionZone") {
        next = moveCard(next, instanceId, "cemetery", player);
      }
      // Restore prior ability source after the free spell finishes immediately.
      if (!(next.resolutionContext?.resumeAfterChoice?.length ?? 0)) {
        next.resolutionContext = {
          sourceInstanceId: prev?.sourceInstanceId,
          resumeOwnerInstanceId: prev?.resumeOwnerInstanceId,
          effectStack: prev?.effectStack ?? [],
          resumeAfterChoice: prev?.resumeAfterChoice,
          forcedTargetId: prev?.forcedTargetId,
          buriedCosts: prev?.buriedCosts,
          lastDiscardedCardName: prev?.lastDiscardedCardName,
          lastSelectedCardName: prev?.lastSelectedCardName,
          engagedAsCostCount: prev?.engagedAsCostCount,
          deferTriggers: true,
        };
      }
    } else {
      queueOnCardPlayed(next, instanceId, player, found.card.name);
    }
  }

  if (def.cardType !== "spell") {
    queueOnCardPlayed(next, instanceId, player);
  }
  return next;
}

function beginEndPhaseDiscard(state: GameState): GameState {
  return finishEndPhase(structuredClone(state));
}

function clearTurnPlayCostReduction(player: GameState["players"][PlayerId]): void {
  for (const zone of Object.values(player.zones)) {
    if (!Array.isArray(zone)) continue;
    for (const card of zone) {
      card.playCostReduction = 0;
    }
  }
}

function endTurn(state: GameState): GameState {
  let next = structuredClone(state);
  const player = next.activePlayer;

  for (const p of next.players) {
    p.flags.endStartAbilitiesQueued = false;
    p.flags.chosenChooseOptionTracksThisTurn = {};
    p.flags.chosenChooseOptionLabelsThisTurn = {};
    for (const cards of [p.zones.field, p.zones.hand, p.zones.exArea, p.zones.cemetery]) {
      for (const card of cards) {
        card.modifiers = card.modifiers.filter((m) => !m.untilEndOfTurn);
        card.abilitiesActivatedThisTurn = [];
        card.chosenChooseOptionsThisTurn = {};
        card.chosenChooseOptionLabelsThisTurn = {};
      }
    }
  }
  clearTurnPlayCostReduction(next.players[player]);

  next.activePlayer = opponentOf(player);
  next.turnNumber += 1;
  next.phase = "start";
  next.combat = null;
  next.quickWindow = null;
  next.endPhaseQuickResolved = undefined;
  next = beginStartPhase(next);
  next = runConfirmationTiming(next);
  return next;
}

function playCard(
  state: GameState,
  player: PlayerId,
  handInstanceId: string,
  targets?: string[],
  fromQuickWindow = false,
): ActionResult {
  const inQuickWindow = state.quickWindow !== null;

  if (inQuickWindow) {
    if (state.quickWindowPlayer !== player) return fail(state, "Not your quick window");
    if (!fromQuickWindow) return fail(state, "Use quick play during quick window");
  } else {
    const phaseErr = assertPhase(state, ["main"], "Cannot play card now");
    if (phaseErr) return phaseErr;
    const activeErr = assertActivePlayer(state, player, "Not your turn");
    if (activeErr) return activeErr;
  }

  const found = findInstance(state, handInstanceId);
  if (!found || found.player !== player) {
    return fail(state, "Card not found");
  }
  if (found.zone !== "hand" && found.zone !== "exArea") {
    return fail(state, "Card not in hand or EX area");
  }

  const def = getCardDef(found.card.name);
  if (!def) return fail(state, "Unknown card");

  if (def.cardType === "crest") {
    return fail(state, "Crests cannot be played");
  }

  if (inQuickWindow && !isQuickCard(def)) {
    return fail(state, "Not a quick card");
  }

  if (def.cardType === "spell" && !canPlayCardFromZones(state, player, found.card.name)) {
    return fail(state, "No valid targets");
  }

  let next = structuredClone(state);
  const p = next.players[player];
  const playCost = getEffectivePlayCost(found.card, found.card.name, state, player, found.zone);
  if (p.pp < playCost) return fail(state, "Not enough PP");

  p.pp -= playCost;
  p.flags.cardsPlayedThisTurn += 1;
  if (def.cardType === "spell") {
    p.flags.spellsPlayedThisTurn = (p.flags.spellsPlayedThisTurn ?? 0) + 1;
  }
  consumeGrantedPlayCostReductions(next, player, found.card.name);

  if (!hasFieldSpace(p.zones.field, p.fieldLimit) && def.cardType !== "spell") {
    return fail(state, "Field full");
  }

  next = moveCard(next, handInstanceId, "resolutionZone", player);
  const inResolution = findInstance(next, handInstanceId);
  if (inResolution && def.cardType !== "spell") {
    inResolution.card.enteredFromHand = found.zone === "hand";
  }

  if (def.cardType === "spell") {
    next.resolutionContext = {
      sourceInstanceId: handInstanceId,
      resumeOwnerInstanceId: handInstanceId,
      effectStack: [],
      deferTriggers: true,
    };
    next = resolveSpell(next, found.card.name, player);
    // Keep the spell in resolution while a choose/target prompt is open so it
    // is not double-counted in the cemetery and effects can still see it.
    if (!next.pendingChoices) {
      // Queue while the spell still exists — token spells cease to exist when
      // moved to cemetery and would otherwise skip on-play watchers.
      queueOnCardPlayed(next, handInstanceId, player, found.card.name);
      const res = findInstance(next, handInstanceId);
      // A spell that relocated itself (e.g. Chain Lightning into EX) must stay put.
      if (res?.zone === "resolutionZone") {
        next = moveCard(next, handInstanceId, "cemetery", player);
      }
      if (shouldClearResolutionContext(next)) {
        next.resolutionContext = null;
      }
    } else {
      queueOnCardPlayed(next, handInstanceId, player, found.card.name);
    }
  } else if (def.cardType === "follower" || def.cardType === "amulet") {
    // Drop orphaned resolution context so field-entry triggers (e.g. cemetery
    // Sneer of Disdain) are not permanently deferred by a leftover resume queue.
    if (!next.pendingChoices) {
      next.resolutionContext = null;
    }
    next = moveCard(next, handInstanceId, "field", player);
    queueOnCardPlayed(next, handInstanceId, player);
  }

  next = runConfirmationTiming(next);

  // After the last playable quick, close the window so the game cannot softlock
  // waiting for a pass the player may not realize is required.
  if (
    fromQuickWindow &&
    next.quickWindow !== null &&
    !next.pendingChoices &&
    next.pendingTriggers.length === 0 &&
    !hasPlayableQuickCards(next, player)
  ) {
    if (next.quickWindow === "afterAttack") {
      next.quickWindow = null;
      next.quickWindowPlayer = null;
      if (next.combat) {
        next.combat = { ...next.combat, phase: "damage" };
        next = resolveCombat(next);
      }
    } else if (next.quickWindow === "endPhase") {
      next.endPhaseQuickResolved = true;
      next = continueEndPhaseFlow(next);
    }
  }

  return ok(next);
}

function attack(
  state: GameState,
  player: PlayerId,
  attackerId: string,
  targetId: string | "leader",
): ActionResult {
  const activeErr = assertActivePlayer(state, player, "Not your turn");
  if (activeErr) return activeErr;
  const phaseErr = assertPhase(state, ["main"], "Cannot attack now");
  if (phaseErr) return phaseErr;
  if (state.combat?.phase === "quickWindow") {
    return fail(state, "Resolve quick window first");
  }

  const attackerFound = findInstance(state, attackerId);
  if (!attackerFound || attackerFound.zone !== "field" || attackerFound.player !== player) {
    return fail(state, "Invalid attacker");
  }
  const attacker = attackerFound.card;
  if (getCardDef(attacker.name)?.cardType !== "follower") {
    return fail(state, "Only followers can attack");
  }
  if (attacker.engaged) return fail(state, "Follower is engaged and cannot attack");

  const canAttack =
    attacker.onFieldSinceTurnStart ||
    attacker.evolvedThisTurn ||
    hasKeyword(attacker, "storm", state) ||
    hasKeyword(attacker, "rush", state);
  if (!canAttack) return fail(state, "Follower cannot attack");

  const legal = getLegalAttackTargets(state, attacker, player);
  const isLegal =
    targetId === "leader"
      ? legal.some((t) => t.type === "leader")
      : legal.some((t) => t.type === "follower" && t.instanceId === targetId);
  if (!isLegal) return fail(state, "Illegal attack target");

  let next = structuredClone(state);
  const attackerOnNext = findInstance(next, attackerId);
  if (!attackerOnNext) return fail(state, "Invalid attacker");
  attackerOnNext.card.engaged = true;
  next.combat = {
    attackerId,
    targetId,
    targetPlayer: opponentOf(player),
    phase: "declared",
  };
  next.phase = "combat";
  next.eventLog.push({ type: "attack", player, data: { attackerId, targetId } });
  next = resolveCombat(next);

  return ok(next);
}

function resolveCombatDamage(state: GameState): GameState {
  if (!state.combat) return state;
  let next = abortCombatIfAttackerGone(state);
  if (!next.combat) return next;
  next = structuredClone(next);
  const combat = next.combat!;
  const attackerFound = findInstance(next, combat.attackerId);
  if (!attackerFound || attackerFound.zone !== "field") {
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return next;
  }

  const { atk: attackerAtk } = getEffectiveStats(attackerFound.card, next);

  if (combat.targetId === "leader") {
    next.players[combat.targetPlayer].leaderDef -= attackerAtk;
    if (hasKeyword(attackerFound.card, "drain", next)) {
      next.players[attackerFound.player].leaderDef += attackerAtk;
    }
  } else {
    const targetFound = findInstance(next, combat.targetId);
    if (targetFound && targetFound.zone === "field") {
      const targetStats = getEffectiveStats(targetFound.card, next);
      if (targetStats.hasCombatStats && targetStats.def > 0) {
        const { atk: targetAtk } = targetStats;
        const dmgToTarget = clampDamageToFollower(
          next,
          targetFound.card,
          targetFound.player,
          attackerAtk,
        );
        targetFound.card.modifiers.push({ def: -dmgToTarget, sourceId: combat.attackerId });
        attackerFound.card.modifiers.push({ def: -targetAtk, sourceId: combat.targetId });

        if (hasKeyword(attackerFound.card, "drain", next)) {
          next.players[attackerFound.player].leaderDef += attackerAtk;
        }

        if (
          hasKeyword(attackerFound.card, "bane", next, attackerFound.player) ||
          hasKeyword(targetFound.card, "bane", next, targetFound.player)
        ) {
          attackerFound.card.foughtWithBane = true;
          targetFound.card.foughtWithBane = true;
          attackerFound.card.foughtWithInstanceId = targetFound.card.instanceId;
          targetFound.card.foughtWithInstanceId = attackerFound.card.instanceId;
        }
      }
    }
  }

  next.combat = null;
  next.phase = "main";
  next.quickWindow = null;
  next.quickWindowPlayer = null;
  return runConfirmationTiming(next);
}

function resolveCombat(state: GameState): GameState {
  if (!state.combat) return state;
  let next = abortCombatIfAttackerGone(state);
  if (!next.combat) return next;
  next = structuredClone(next);
  const combat = next.combat!;

  if (combat.phase === "quickWindow") {
    return next;
  }

  if (combat.phase === "damage") {
    return resolveCombatDamage(next);
  }

  const attackerFound = findInstance(next, combat.attackerId);
  if (!attackerFound || attackerFound.zone !== "field") {
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return next;
  }

  // Strike resolves before quick window and combat damage (Comprehensive Rules §11).
  const strikeAbilities = getStrikeAbilities(next, attackerFound.card);
  const strikeStart = combat.strikeAbilityIndex ?? 0;
  for (let i = strikeStart; i < strikeAbilities.length; i++) {
    const { ability, key } = strikeAbilities[i];
    next.resolutionContext = { sourceInstanceId: combat.attackerId, effectStack: [ability.effect] };
    if (ability.unionBurst) {
      next = markResolvingUnionBurst(next, combat.attackerId);
    }
    next = resolveEffect(next, ability.effect, attackerFound.player, {
      deferConfirmation: true,
    });
    next = runConfirmationTiming(next);
    if (
      next.pendingChoices ||
      next.pendingTriggers.length > 0 ||
      (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0
    ) {
      next.combat = { ...combat, strikeAbilityIndex: i };
      next.phase = "main";
      next.quickWindow = null;
      next.quickWindowPlayer = null;
      return next;
    }
    const host = findInstance(next, combat.attackerId);
    if (host && ability.oncePerTurn && !host.card.abilitiesActivatedThisTurn.includes(key)) {
      host.card.abilitiesActivatedThisTurn.push(key);
    }
    next = recordUnionBurstActivated(next, attackerFound.player, combat.attackerId, ability);
    next.resolutionContext = null;
    next = abortCombatIfAttackerGone(next);
    if (!next.combat) return next;
  }

  if (!isCombatAttackerOnField(next)) {
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return next;
  }

  const attackerAfterStrike = findInstance(next, combat.attackerId);
  if (!attackerAfterStrike || attackerAfterStrike.zone !== "field") {
    next.combat = null;
    next.phase = "main";
    next.quickWindow = null;
    next.quickWindowPlayer = null;
    return next;
  }

  const defender = opponentOf(attackerAfterStrike.player);
  if (hasPlayableQuickCards(next, defender)) {
    next.combat = { ...combat, phase: "quickWindow", strikeAbilityIndex: undefined };
    next.quickWindow = "afterAttack";
    next.quickWindowPlayer = defender;
    next.phase = "main";
    return next;
  }

  next.combat = { ...combat, phase: "damage", strikeAbilityIndex: undefined };
  return resolveCombat(next);
}

function evolve(
  state: GameState,
  player: PlayerId,
  fieldInstanceId: string,
  evolveDeckInstanceId?: string,
  useSuperEvo?: boolean,
  useEvoPoint?: boolean,
): ActionResult {
  const activeErr = assertActivePlayer(state, player, "Not your turn");
  if (activeErr) return activeErr;

  if (!canEvolveFollower(state, player, fieldInstanceId)) {
    return fail(state, "Cannot evolve this follower");
  }

  const fieldFound = findInstance(state, fieldInstanceId);
  if (!fieldFound || fieldFound.zone !== "field") return fail(state, "Invalid field card");
  if (fieldFound.card.linkedEvoInstanceId) return fail(state, "Already evolved");

  const evoCard =
    (evolveDeckInstanceId
      ? findInstance(state, evolveDeckInstanceId)?.card
      : null) ?? findMatchingEvolveCard(state, player, fieldInstanceId);
  if (!evoCard) return fail(state, "Invalid evolve card");
  const evoFound = findInstance(state, evoCard.instanceId);
  if (!evoFound || evoFound.zone !== "evolveDeck") return fail(state, "Invalid evolve card");
  if (evoFound.card.evolveUsed) return fail(state, "Evolve card already used");
  const evolveDeckInstanceIdResolved = evoCard.instanceId;

  const baseDef = getCardDef(fieldFound.card.name);
  const evoDef = getCardDef(evoFound.card.name);
  if (!evolveCardsMatch(fieldFound.card.name, evoFound.card.name)) {
    return fail(state, "Cards do not match");
  }

  const cost = getEffectiveEvolveCost(state, player, fieldFound.card);
  if (cost == null) return fail(state, "Cannot evolve this follower");
  let next = structuredClone(state);
  const p = next.players[player];

  const payment = computeEvolvePayment(cost, p.pp, p.evoPoints, Boolean(useEvoPoint));
  if (!payment.ok) return fail(state, "Cannot pay evolve cost");
  p.evoPoints -= payment.epCost;
  p.pp -= payment.ppCost;

  next = moveCard(next, evolveDeckInstanceIdResolved, "resolutionZone", player);

  const fieldOnNext = findInstance(next, fieldInstanceId);
  if (!fieldOnNext || fieldOnNext.zone !== "field") return fail(state, "Invalid field card");

  fieldOnNext.card.linkedEvoInstanceId = evolveDeckInstanceIdResolved;
  fieldOnNext.card.evolvedThisTurn = true;
  // Keep onFieldSinceTurnStart so a follower that could already attack the
  // leader still can after evolving; evolvedThisTurn grants Rush for followers.

  if (useSuperEvo && next.players[player].superEvoPoints > 0) {
    const threshold = player === next.firstPlayer ? 7 : 6;
    if (next.players[player].turnsPassed >= threshold) {
      next.players[player].superEvoPoints -= 1;
      fieldOnNext.card.superEvolved = true;
      fieldOnNext.card.modifiers.push({ atk: 1, def: 1, sourceId: "superEvo" });
    }
  }

  next.players[player].flags.evolvedThisTurn = true;

  next.players[player].zones.evolveZone.push({
    fieldInstanceId,
    evolveInstanceId: evolveDeckInstanceIdResolved,
  });

  const onEvolveAbs = evoDef?.abilities?.filter((a) => a.timing === "onEvolve") ?? [];
  const onSEAbs = fieldOnNext.card.superEvolved
    ? (evoDef?.abilities?.filter((a) => a.timing === "onSuperEvolve") ?? [])
    : [];

  // Queue as confirmation triggers so Union Burst recording / cross-card watchers
  // (Eris Storm, Yuni spell discount) run through the same path as fanfares.
  const evoCardNo = evoFound.card.name;
  for (const [idx, ability] of onEvolveAbs.entries()) {
    next.pendingTriggers.push({
      id: `onEvolve_${fieldInstanceId}_${idx}_${next.pendingTriggers.length}`,
      controller: player,
      sourceInstanceId: fieldInstanceId,
      ability,
      timing: "onEvolve",
      label: ability.label ?? describeAbility(evoCardNo, ability),
      abilityKey: `onEvolve:${idx}`,
    });
  }
  for (const [idx, ability] of onSEAbs.entries()) {
    next.pendingTriggers.push({
      id: `onSuperEvolve_${fieldInstanceId}_${idx}_${next.pendingTriggers.length}`,
      controller: player,
      sourceInstanceId: fieldInstanceId,
      ability,
      timing: "onSuperEvolve",
      label: ability.label ?? describeAbility(evoCardNo, ability),
      abilityKey: `onSuperEvolve:${idx}`,
    });
  }

  next = runConfirmationTiming(next);
  return ok(next);
}

function finishActivateAfterCost(
  state: GameState,
  player: PlayerId,
  sourceInstanceId: string,
  zone: "field" | "cemetery" | "exArea" | "hand",
  abilityKey: string,
): GameState {
  let next = structuredClone(state);
  // Prefer the live field/hand/etc. copy; if burySelf already removed it, fall back to
  // the pre-clone state or any zone so we can still resolve the activated ability.
  const sourceOnNext =
    findInstance(next, sourceInstanceId) ?? findInstance(state, sourceInstanceId);
  let ability = undefined as ReturnType<typeof getActivatedAbilities>[number]["ability"] | undefined;
  const equipMatch = /^equipActivated:([^:]+):(\d+)$/.exec(abilityKey);
  if (equipMatch) {
    const eqFound = findInstance(next, equipMatch[1]);
    const eqDef = eqFound ? getCardDef(resolveCardNo(next, eqFound.card)) : undefined;
    ability = eqDef?.abilities?.[Number(equipMatch[2])];
  } else {
    const def = sourceOnNext ? getCardDef(resolveCardNo(next, sourceOnNext.card)) : undefined;
    ability = def?.abilities
      ?.map((a, idx) => ({ ability: a, key: `activated:${idx}` }))
      .find((entry) => entry.key === abilityKey)?.ability;
  }
  if (!ability) return next;

  const liveSource = findInstance(next, sourceInstanceId);
  if (liveSource) {
    if (zone === "field" && ability.cost?.engage) {
      liveSource.card.engaged = true;
    }
    if (ability.oncePerTurn && !liveSource.card.abilitiesActivatedThisTurn.includes(abilityKey)) {
      liveSource.card.abilitiesActivatedThisTurn.push(abilityKey);
    }
    if (ability.maxPerTurn != null) {
      liveSource.card.counters[abilityKey] = (liveSource.card.counters[abilityKey] ?? 0) + 1;
    }
  }

  if (ability.cost?.burySelf) {
    const src = findInstance(next, sourceInstanceId);
    if (src?.zone === "field") {
      queueLastWords(next, sourceInstanceId, player);
      next = destroyFollower(next, sourceInstanceId);
    }
  }

  if (ability.cost?.discardSelf) {
    const src = findInstance(next, sourceInstanceId);
    if (src?.zone !== "hand") return state;
    next = moveCard(next, sourceInstanceId, "cemetery", player);
    queueOnDiscard(next, sourceInstanceId, player);
  }

  next.resolutionContext = {
    sourceInstanceId,
    effectStack: [ability.effect],
  };
  if (ability.unionBurst) {
    next = markResolvingUnionBurst(next, sourceInstanceId);
  }
  next = resolveEffect(next, ability.effect, player);
  if (ability.cost?.fuse) {
    queueOnCardFused(next, sourceInstanceId, player);
  }
  next = scheduleOrRecordUnionBurstActivated(next, player, sourceInstanceId, ability);
  if (shouldClearResolutionContext(next)) {
    next = flushPendingUnionBurst(next);
    next.resolutionContext = null;
  }
  return next;
}

function resolveActivate(
  state: GameState,
  player: PlayerId,
  sourceInstanceId: string,
  zone: "field" | "cemetery" | "exArea" | "hand",
  useEvoPoint?: boolean,
  abilityKey?: string,
): ActionResult {
  const found = findInstance(state, sourceInstanceId);
  if (!found || found.zone !== zone || found.player !== player) {
    return fail(state, "Invalid card");
  }
  const activated = getActivatedAbilities(state, found.card, player, zone);
  if (activated.length === 0) return fail(state, "No activated ability");

  const selected = abilityKey
    ? activated.find((entry) => entry.key === abilityKey)
    : activated.length === 1
      ? activated[0]
      : undefined;
  if (!selected) {
    return fail(
      state,
      abilityKey ? "Invalid activated ability" : "Choose which ability to activate",
    );
  }

  if (zone === "field" && found.card.engaged && selected.ability.cost?.engage) {
    return fail(state, "Follower is engaged and cannot pay engage cost");
  }

  let next = structuredClone(state);
  const p = next.players[player];
  const { ability, key } = selected;
  const def = getCardDef(resolveCardNo(next, found.card));
  const advance = isAdvanceAbility(def, ability);
  if (advance && p.flags.evolvedThisTurn) {
    return fail(state, "Already evolved or advanced this turn");
  }
  if (advance && !canAdvanceActivate(next, player, ability.effect)) {
    return fail(state, "Advance conditions not met");
  }

  const activateCost = ability.cost?.pp ?? 0;
  const payment = computeEvolvePayment(activateCost, p.pp, p.evoPoints, Boolean(useEvoPoint));
  if (!payment.ok) return fail(state, "Cannot pay activate cost");
  p.evoPoints -= payment.epCost;
  p.pp -= payment.ppCost;
  if (advance) {
    p.flags.evolvedThisTurn = true;
  }

  if (ability.cost?.banishFromCemetery) {
    const filter = ability.cost.banishFromCemetery;
    const count = ability.cost.banishCount ?? 1;
    const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, filter));
    if (matches.length < count) return fail(state, "Cannot pay activate cost");
    if (matches.length >= count) {
      next.pendingChoices = {
        type: "selectZoneCards",
        player,
        fromZone: "cemetery",
        count,
        action: "banish",
        options: matches.map((c) => ({
          instanceId: c.instanceId,
          name: c.name,
          label: getCardDef(c.name)?.name || c.name,
        })),
        resumeActivate: { sourceInstanceId, zone, abilityKey: key },
      };
      return ok(next);
    }
    for (let i = 0; i < count; i++) {
      const idx = p.zones.cemetery.findIndex((c) => cardMatchesFilter(c.name, filter));
      if (idx < 0) return fail(state, "Cannot pay activate cost");
      const [card] = p.zones.cemetery.splice(idx, 1);
      resetCardInstanceState(card);
      placeLeavingPlay(p.zones, card, "banish");
    }
  }

  if (ability.cost?.banishFromExArea) {
    const filter = ability.cost.banishFromExArea;
    const total = ability.cost.banishCount ?? 1;
    const matches = p.zones.exArea.filter((c) => cardMatchesFilter(c.name, filter));
    if (matches.length < total) return fail(state, "Cannot pay activate cost");
    const sourceInEx = matches.some((c) => c.instanceId === sourceInstanceId);
    const needFromEx = sourceInEx ? total - 1 : total;
    const pool = sourceInEx
      ? matches.filter((c) => c.instanceId !== sourceInstanceId)
      : matches;
    if (needFromEx > 0 && pool.length >= needFromEx) {
      next.pendingChoices = {
        type: "selectZoneCards",
        player,
        fromZone: "exArea",
        count: needFromEx,
        action: "banish",
        options: pool.map((c) => ({
          instanceId: c.instanceId,
          name: c.name,
          label: getCardDef(c.name)?.name || c.name,
        })),
        resumeActivate: { sourceInstanceId, zone, abilityKey: key },
      };
      return ok(next);
    }
    const toBanish = sourceInEx
      ? [sourceInstanceId, ...pool.slice(0, needFromEx).map((c) => c.instanceId)]
      : pool.slice(0, needFromEx).map((c) => c.instanceId);
    for (const id of toBanish) {
      const idx = p.zones.exArea.findIndex((c) => c.instanceId === id);
      if (idx < 0) return fail(state, "Cannot pay activate cost");
      const [card] = p.zones.exArea.splice(idx, 1);
      resetCardInstanceState(card);
      placeLeavingPlay(p.zones, card, "banish");
    }
  }

  if (ability.cost?.buryFromField) {
    const filter = ability.cost.buryFromField;
    const count = ability.cost.buryFieldCount ?? 1;
    const matches = p.zones.field.filter((c) => {
      if (ability.cost?.excludeSelfFromBury && c.instanceId === sourceInstanceId) return false;
      return cardMatchesFilter(c.name, filter);
    });
    if (matches.length < count) return fail(state, "Cannot pay activate cost");
    if (matches.length >= count) {
      next.pendingChoices = {
        type: "selectZoneCards",
        player,
        fromZone: "field",
        count,
        action: "bury",
        options: matches.map((c) => ({
          instanceId: c.instanceId,
          name: c.name,
          label: getCardDef(c.name)?.name || c.name,
        })),
        resumeActivate: { sourceInstanceId, zone, abilityKey: key },
      };
      return ok(next);
    }
  }

  if (ability.cost?.engageFromField) {
    const filter = ability.cost.engageFromField;
    const count = ability.cost.engageFieldCount ?? 1;
    const matches = p.zones.field.filter((c) => {
      if (c.engaged) return false;
      if (ability.cost?.excludeSelfFromEngage && c.instanceId === sourceInstanceId) return false;
      return cardMatchesFilter(c.name, filter);
    });
    if (matches.length < count) return fail(state, "Cannot pay activate cost");
    if (matches.length >= count) {
      next.pendingChoices = {
        type: "selectZoneCards",
        player,
        fromZone: "field",
        count,
        action: "engage",
        options: matches.map((c) => ({
          instanceId: c.instanceId,
          name: c.name,
          label: getCardDef(c.name)?.name || c.name,
        })),
        resumeActivate: { sourceInstanceId, zone, abilityKey: key },
      };
      return ok(next);
    }
  }

  if (ability.cost?.fuse) {
    const filter = ability.cost.fuse.filter;
    const count = ability.cost.fuse.count ?? 1;
    const excludeSelf = ability.cost.fuse.excludeSelf !== false;
    const matches: { instanceId: string; name: string; label: string }[] = [];
    for (const c of p.zones.hand) {
      if (excludeSelf && c.instanceId === sourceInstanceId) continue;
      if (!cardMatchesFilter(c.name, filter)) continue;
      const base = getCardDef(c.name)?.name || c.name;
      matches.push({ instanceId: c.instanceId, name: c.name, label: `${base} (Hand)` });
    }
    for (const c of p.zones.exArea) {
      if (excludeSelf && c.instanceId === sourceInstanceId) continue;
      if (!cardMatchesFilter(c.name, filter)) continue;
      const base = getCardDef(c.name)?.name || c.name;
      matches.push({ instanceId: c.instanceId, name: c.name, label: `${base} (EX)` });
    }
    if (matches.length < count) return fail(state, "Cannot pay fuse cost");
    next.pendingChoices = {
      type: "selectZoneCards",
      player,
      fromZone: "hand",
      count,
      action: "fuse",
      options: matches,
      resumeActivate: { sourceInstanceId, zone, abilityKey: key },
    };
    return ok(next);
  }

  if (ability.cost?.removePersistentCounter) {
    const { key: counterKey, amount = 1 } = ability.cost.removePersistentCounter;
    const live = findInstance(next, sourceInstanceId);
    if (!live) return fail(state, "Invalid card");
    const have = live.card.persistentCounters?.[counterKey] ?? 0;
    if (have < amount) return fail(state, "Not enough counters");
    if (!live.card.persistentCounters) live.card.persistentCounters = {};
    live.card.persistentCounters[counterKey] = have - amount;
  }

  next = finishActivateAfterCost(next, player, sourceInstanceId, zone, key);
  next = runConfirmationTiming(next);
  return ok(next);
}

export function applyAction(
  state: GameState,
  player: PlayerId,
  action: GameAction,
): ActionResult {
  return appendActionLog(state, player, action, applyActionUnlogged(state, player, action));
}

function applyActionUnlogged(
  state: GameState,
  player: PlayerId,
  action: GameAction,
): ActionResult {
  if (state.phase === "gameOver") return fail(state, "Game is over");

  let workingState = clearRevealedCards(state);

  if (
    workingState.pendingChoices &&
    action.type !== "CHOICE_RESPONSE" &&
    action.type !== "MULLIGAN"
  ) {
    return fail(workingState, "Must resolve pending choice first");
  }

  switch (action.type) {
    case "MULLIGAN":
      if (workingState.phase !== "mulligan") return fail(workingState, "Not mulligan phase");
      return ok(applyMulligan(workingState, player, action.redraw));

    case "CHOICE_RESPONSE":
      return handleChoiceResponse(workingState, player, action.payload);

    case "PLAY_CARD":
      return playCard(workingState, player, action.handInstanceId, action.targets);

    case "QUICK_PLAY":
      if (state.quickWindow === null) return fail(state, "No quick window");
      return playCard(state, player, action.handInstanceId, action.targets, true);

    case "PASS_QUICK_WINDOW": {
      if (state.quickWindow === null) return fail(state, "No quick window");
      if (state.quickWindowPlayer !== player) return fail(state, "Not your quick window");
      if (state.quickWindow === "afterAttack") {
        let next = structuredClone(state);
        next.quickWindow = null;
        next.quickWindowPlayer = null;
        if (next.combat) {
          next.combat = { ...next.combat, phase: "damage" };
          next = resolveCombat(next);
        }
        return ok(next);
      }
      if (state.quickWindow === "endPhase") {
        let next = structuredClone(state);
        next.endPhaseQuickResolved = true;
        next = continueEndPhaseFlow(next);
        return ok(next);
      }
      return fail(state, "Unknown quick window");
    }

    case "ATTACK":
      return attack(state, player, action.attackerId, action.targetId);

    case "EVOLVE":
      return evolve(
        state,
        player,
        action.fieldInstanceId,
        action.evolveDeckInstanceId,
        action.useSuperEvo,
        action.useEvoPoint,
      );

    case "END_MAIN": {
      const activeErr = assertActivePlayer(state, player, "Not your turn");
      if (activeErr) return activeErr;
      if (state.quickWindow === "endPhase") {
        return fail(state, "Opponent must resolve quick window first");
      }
      if (state.combat?.phase === "quickWindow") {
        return fail(state, "Resolve quick window first");
      }
      if (state.combat?.phase === "declared") {
        return ok(resolveCombat(state));
      }

      let next = structuredClone(state);
      next.phase = "end";
      next.endPhaseQuickResolved = false;
      next = continueEndPhaseFlow(next);
      return ok(next);
    }

    case "ACTIVATE": {
      const activeErr = assertActivePlayer(state, player, "Not your turn");
      if (activeErr) return activeErr;
      const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
      if (phaseErr) return phaseErr;
      return resolveActivate(
        state,
        player,
        action.fieldInstanceId,
        "field",
        action.useEvoPoint,
        action.abilityKey,
      );
    }

    case "ACTIVATE_CEMETERY": {
      const activeErr = assertActivePlayer(state, player, "Not your turn");
      if (activeErr) return activeErr;
      const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
      if (phaseErr) return phaseErr;
      return resolveActivate(
        state,
        player,
        action.cemeteryInstanceId,
        "cemetery",
        undefined,
        action.abilityKey,
      );
    }

    case "ACTIVATE_EXAREA": {
      const activeErr = assertActivePlayer(state, player, "Not your turn");
      if (activeErr) return activeErr;
      const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
      if (phaseErr) return phaseErr;
      return resolveActivate(
        state,
        player,
        action.exAreaInstanceId,
        "exArea",
        undefined,
        action.abilityKey,
      );
    }

    case "ACTIVATE_HAND": {
      const activeErr = assertActivePlayer(state, player, "Not your turn");
      if (activeErr) return activeErr;
      const phaseErr = assertPhase(state, ["main"], "Cannot activate now");
      if (phaseErr) return phaseErr;
      return resolveActivate(
        state,
        player,
        action.handInstanceId,
        "hand",
        action.useEvoPoint,
        action.abilityKey,
      );
    }

    case "CONCEDE": {
      const next = structuredClone(state);
      next.winner = opponentOf(player);
      next.phase = "gameOver";
      return ok(next);
    }

    case "DEBUG_ADJUST_PP": {
      if (!state.testingMode) return fail(state, "Testing mode only");
      const next = structuredClone(state);
      const p = next.players[player];
      const delta = Number(action.delta) || 0;
      p.pp = Math.max(0, p.pp + delta);
      if (p.pp > p.maxPp) p.maxPp = p.pp;
      return ok(next);
    }

    case "DEBUG_ADJUST_LIFE": {
      if (!state.testingMode) return fail(state, "Testing mode only");
      const next = structuredClone(state);
      const p = next.players[player];
      const delta = Number(action.delta) || 0;
      p.leaderDef = Math.max(0, p.leaderDef + delta);
      return ok(next);
    }

    case "DEBUG_TUTOR_FROM_DECK": {
      if (!state.testingMode) return fail(state, "Testing mode only");
      const instanceId = String(action.instanceId || "");
      if (!instanceId) return fail(state, "No card selected");
      const found = findInstance(state, instanceId);
      if (!found || found.zone !== "deck" || found.player !== player) {
        return fail(state, "Card not in your deck");
      }
      return ok(moveZoneCardTo(state, player, instanceId, "deck", "hand"));
    }

    default:
      return fail(state, "Unknown action");
  }
}

export function advanceCombatIfNeeded(state: GameState): GameState {
  return state;
}
