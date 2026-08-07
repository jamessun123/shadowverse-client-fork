import { AbilityDefinition, GameState, PlayerId } from "../types";
import { appendUnionBurstLogEntry } from "../actions/actionLog";
import { queueOnUnionBurstActivated } from "./trigger-queue";

/** Record that a Union Burst ability resolved and queue cross-card triggers. */
export function recordUnionBurstActivated(
  state: GameState,
  player: PlayerId,
  sourceInstanceId: string,
  ability: AbilityDefinition | undefined,
): GameState {
  if (!ability?.unionBurst) return state;
  const next = state;
  const flags = next.players[player].flags;
  const ids = flags.unionBurstSourceIdsThisTurn ?? [];
  ids.push(sourceInstanceId);
  flags.unionBurstSourceIdsThisTurn = ids;
  const count = ids.length;
  flags.unionBurstsActivatedThisTurn = count;
  queueOnUnionBurstActivated(next, sourceInstanceId, player);
  appendUnionBurstLogEntry(next, player, sourceInstanceId, count);
  return next;
}

function abilityStillResolving(state: GameState): boolean {
  if (state.pendingChoices) return true;
  return (state.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0;
}

/**
 * Record a Union Burst only once its effect has fully finished.
 * If the ability paused on a target/choose prompt, stash it on the resolution
 * context so mid-ability checks (e.g. Eris / Ameth "2 other UBs") do not count
 * the current activation.
 */
export function scheduleOrRecordUnionBurstActivated(
  state: GameState,
  player: PlayerId,
  sourceInstanceId: string,
  ability: AbilityDefinition | undefined,
): GameState {
  if (!ability?.unionBurst) return state;
  if (abilityStillResolving(state)) {
    const next = state;
    if (!next.resolutionContext) {
      next.resolutionContext = { effectStack: [ability.effect] };
    }
    next.resolutionContext.pendingUnionBurst = { player, sourceInstanceId, ability };
    next.resolutionContext.resolvingUnionBurstSourceId = sourceInstanceId;
    return next;
  }
  return recordUnionBurstActivated(state, player, sourceInstanceId, ability);
}

/** Flush a stashed Union Burst once choices/resume work are done. */
export function flushPendingUnionBurst(state: GameState): GameState {
  const pending = state.resolutionContext?.pendingUnionBurst;
  if (!pending || abilityStillResolving(state)) return state;
  const next = recordUnionBurstActivated(
    state,
    pending.player,
    pending.sourceInstanceId,
    pending.ability,
  );
  if (next.resolutionContext) {
    delete next.resolutionContext.pendingUnionBurst;
    delete next.resolutionContext.resolvingUnionBurstSourceId;
  }
  return next;
}

/** Mark that a Union Burst from this source is currently resolving. */
export function markResolvingUnionBurst(
  state: GameState,
  sourceInstanceId: string,
): GameState {
  const next = state;
  if (!next.resolutionContext) {
    next.resolutionContext = { effectStack: [] };
  }
  next.resolutionContext.resolvingUnionBurstSourceId = sourceInstanceId;
  return next;
}
