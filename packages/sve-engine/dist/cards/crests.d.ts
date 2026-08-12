import { GameState, PlayerId } from "../types";
/**
 * A player may control only one crest of each name at a time, so a second copy
 * is never created in or moved into their EX area.
 */
export declare function crestAlreadyInExArea(state: GameState, player: PlayerId, cardName: string, ignoreInstanceId?: string): boolean;
