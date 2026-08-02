import { ActionLogEntry, ActionResult, GameAction, GameState, PlayerId } from "../types";
/** This player's turn count (going second: first action turn is 1, not global 2). */
export declare function playerTurnNumber(state: GameState, player: PlayerId): number;
/** Append a Union Burst activation to the action log with the running turn count. */
export declare function appendUnionBurstLogEntry(state: GameState, player: PlayerId, sourceInstanceId: string, count: number): void;
/** Build a human-readable action log entry from pre-action state. */
export declare function buildActionLogEntry(state: GameState, player: PlayerId, action: GameAction): ActionLogEntry | null;
export declare function appendActionLog(before: GameState, player: PlayerId, action: GameAction, result: ActionResult): ActionResult;
