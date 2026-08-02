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
  const count = (next.players[player].flags.unionBurstsActivatedThisTurn ?? 0) + 1;
  next.players[player].flags.unionBurstsActivatedThisTurn = count;
  queueOnUnionBurstActivated(next, sourceInstanceId, player);
  appendUnionBurstLogEntry(next, player, sourceInstanceId, count);
  return next;
}
