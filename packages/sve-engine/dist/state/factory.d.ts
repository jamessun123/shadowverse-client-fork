import { CardInstance, GameState, PlayerId, PlayerState } from "../types";
export declare function nextId(prefix?: string): string;
export declare function resetIdCounter(): void;
/**
 * Create a card instance. Accepts an exact card name, or a legacy printing
 * code which is resolved to the gameplay name.
 */
export declare function createCardInstance(nameOrCardNo: string, owner: PlayerId, controller?: PlayerId): CardInstance;
export declare function emptyPlayer(player: PlayerId): PlayerState;
export declare function createInitialGameState(firstPlayer?: PlayerId): GameState;
