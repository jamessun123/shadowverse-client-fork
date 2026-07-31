import { getCardDef } from "../cards/registry";
import { evalCondition } from "../state/conditions";
import { findInstance, resolveCardNo } from "../state/queries";
import {
  AbilityDefinition,
  CardDefinition,
  ChoicePrompt,
  Effect,
  GameState,
  PlayerId,
  ResolutionContext,
} from "../types";

export function effectContainsOp(effect: Effect, op: Effect["op"]): boolean {
  if (effect.op === op) return true;
  if (effect.op === "sequence") {
    return effect.steps.some((step) => effectContainsOp(step, op));
  }
  if (effect.op === "if") {
    return (
      effectContainsOp(effect.then, op) ||
      (effect.else != null && effectContainsOp(effect.else, op))
    );
  }
  if (effect.op === "optionalCost") {
    return effectContainsOp(effect.cost, op) || effectContainsOp(effect.then, op);
  }
  return false;
}

export function isAdvanceAbility(
  def: CardDefinition | undefined,
  ability: AbilityDefinition,
): boolean {
  if (!def?.keywords?.includes("advanced")) return false;
  return effectContainsOp(ability.effect, "summonFromEvolveDeck");
}

/** Advance activated effects gate on nested if/else deck or cemetery conditions. */
export function canAdvanceActivate(state: GameState, player: PlayerId, effect: Effect): boolean {
  if (effect.op !== "if") return true;
  if (evalCondition(state, player, effect.condition)) return true;
  if (effect.else?.op === "if" && evalCondition(state, player, effect.else.condition)) return true;
  return false;
}

export function shouldDeferTriggers(state: GameState): boolean {
  // Only defer while a player choice is open. An orphaned resumeAfterChoice
  // queue (resume left behind with no pendingChoices) must not permanently
  // softlock pending triggers such as cemetery onAllyFollowerEnter (Sneer).
  // Resume is drained by continueAfterChoice before confirmation on the choice
  // path; runConfirmationTiming already returns early when pendingChoices is set.
  if (state.pendingChoices && state.pendingChoices.type !== "mulligan") return true;
  return false;
}

export function finishDeferredTriggers(state: GameState): GameState {
  if (!state.resolutionContext?.deferTriggers) return state;
  if (state.pendingChoices) return state;
  if ((state.resolutionContext.resumeAfterChoice?.length ?? 0) > 0) return state;
  const next = structuredClone(state);
  next.resolutionContext = { ...next.resolutionContext!, deferTriggers: false };
  return next;
}

export function shouldClearResolutionContext(state: GameState): boolean {
  if (state.pendingChoices) return false;
  if ((state.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0) return false;
  if (state.resolutionContext?.deferTriggers) return false;
  return true;
}

export function contextForTriggerResolution(
  state: GameState,
  sourceInstanceId: string,
  effect: Effect,
): ResolutionContext {
  const prev = state.resolutionContext;
  return {
    sourceInstanceId,
    resumeOwnerInstanceId: prev?.resumeOwnerInstanceId ?? prev?.sourceInstanceId,
    effectStack: [effect],
    resumeAfterChoice: prev?.resumeAfterChoice,
    deferTriggers: prev?.deferTriggers,
    buriedCosts: prev?.buriedCosts,
    lastDiscardedCardName: prev?.lastDiscardedCardName,
    engagedAsCostCount: prev?.engagedAsCostCount,
  };
}

export function getChoiceContext(state: GameState): {
  sourceCardNo?: string;
  sourceLabel?: string;
} {
  const sourceId = state.resolutionContext?.sourceInstanceId;
  if (!sourceId) return {};
  const found = findInstance(state, sourceId);
  if (!found) return {};
  const cardNo = resolveCardNo(state, found.card);
  const def = getCardDef(cardNo);
  return {
    sourceCardNo: cardNo,
    sourceLabel: def?.name ?? cardNo,
  };
}

export function withChoiceContext<T extends ChoicePrompt>(
  state: GameState,
  choice: T,
): T {
  const ctx = getChoiceContext(state);
  if (!ctx.sourceLabel) return choice;
  return { ...choice, ...ctx };
}

/** Track keys for excludeChosenThisTurn: global + per-source. */
export function chooseTrackKeys(trackKey: string, sourceInstanceId?: string): string[] {
  const keys = [trackKey];
  if (sourceInstanceId) keys.push(`${trackKey}@${sourceInstanceId}`);
  return keys;
}

export function getChosenChooseIndices(
  state: GameState,
  player: PlayerId,
  trackKey: string,
  sourceCard?: { chosenChooseOptionsThisTurn?: Record<string, number[]> },
  sourceInstanceId?: string,
): Set<number> {
  const out = new Set<number>();
  const flags = state.players[player].flags;
  for (const key of chooseTrackKeys(trackKey, sourceInstanceId)) {
    for (const i of sourceCard?.chosenChooseOptionsThisTurn?.[key] ?? []) out.add(i);
    for (const i of flags.chosenChooseOptionTracksThisTurn?.[key] ?? []) out.add(i);
  }
  return out;
}

export function getChosenChooseLabels(
  state: GameState,
  player: PlayerId,
  trackKey: string,
  sourceCard?: { chosenChooseOptionLabelsThisTurn?: Record<string, string[]> },
  sourceInstanceId?: string,
): Set<string> {
  const out = new Set<string>();
  const flags = state.players[player].flags;
  for (const key of chooseTrackKeys(trackKey, sourceInstanceId)) {
    for (const label of sourceCard?.chosenChooseOptionLabelsThisTurn?.[key] ?? []) {
      out.add(label);
    }
    for (const label of flags.chosenChooseOptionLabelsThisTurn?.[key] ?? []) {
      out.add(label);
    }
  }
  return out;
}

function pushUnique<T>(list: T[] | undefined, value: T): T[] {
  if (!list) return [value];
  return list.includes(value) ? list : [...list, value];
}

/** Record a chosen mode on the source card and player for the rest of the turn. */
export function recordChosenChooseOption(
  state: GameState,
  player: PlayerId,
  trackKey: string,
  optionIndex: number,
  optionLabel: string,
  sourceInstanceId?: string,
): void {
  const keys = chooseTrackKeys(trackKey, sourceInstanceId);
  const flags = state.players[player].flags;
  if (!flags.chosenChooseOptionTracksThisTurn) flags.chosenChooseOptionTracksThisTurn = {};
  if (!flags.chosenChooseOptionLabelsThisTurn) flags.chosenChooseOptionLabelsThisTurn = {};

  const source = sourceInstanceId ? findInstance(state, sourceInstanceId) : null;
  if (source) {
    if (!source.card.chosenChooseOptionsThisTurn) source.card.chosenChooseOptionsThisTurn = {};
    if (!source.card.chosenChooseOptionLabelsThisTurn) {
      source.card.chosenChooseOptionLabelsThisTurn = {};
    }
  }

  for (const key of keys) {
    flags.chosenChooseOptionTracksThisTurn[key] = pushUnique(
      flags.chosenChooseOptionTracksThisTurn[key],
      optionIndex,
    );
    flags.chosenChooseOptionLabelsThisTurn[key] = pushUnique(
      flags.chosenChooseOptionLabelsThisTurn[key],
      optionLabel,
    );
    if (source) {
      source.card.chosenChooseOptionsThisTurn![key] = pushUnique(
        source.card.chosenChooseOptionsThisTurn![key],
        optionIndex,
      );
      source.card.chosenChooseOptionLabelsThisTurn![key] = pushUnique(
        source.card.chosenChooseOptionLabelsThisTurn![key],
        optionLabel,
      );
    }
  }
}
