import { ActionLogEntry, ActionResult, GameAction, GameState, PlayerId } from "../types";
/** Build a human-readable action log entry from pre-action state. */
export declare function buildActionLogEntry(state: GameState, player: PlayerId, action: GameAction): ActionLogEntry;
export declare function appendActionLog(before: GameState, player: PlayerId, action: GameAction, result: ActionResult): ActionResult;
