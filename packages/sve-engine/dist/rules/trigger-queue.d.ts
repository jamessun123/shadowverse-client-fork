import { GameState, PlayerId } from "../types";
export declare function queueOnCardPlayed(state: GameState, playedInstanceId: string, player: PlayerId): void;
/** Queue watchers for a card that was fused into the EX area. */
export declare function queueOnCardFused(state: GameState, fusedInstanceId: string, player: PlayerId): void;
export declare function queueLastWords(state: GameState, instanceId: string, player: PlayerId): void;
export declare function queueFanfare(state: GameState, instanceId: string, player: PlayerId): void;
export declare function queueStartOfEndAbilities(state: GameState, player: PlayerId): void;
export declare function queueStartOfMainAbilities(state: GameState, player: PlayerId): void;
/** During the active player's turn, when a card leaves an opponent's deck into cemetery. */
export declare function queueOnOpponentDeckToCemetery(state: GameState): void;
export declare function queueAllyFollowerEnterTriggers(state: GameState, enteredInstanceId: string, player: PlayerId): void;
/** Cemetery cards that react when an ally follower enters (e.g. Delta Cannon + Tetra). */
export declare function queueCemeteryOnAllyFollowerEnter(state: GameState, enteredInstanceId: string, player: PlayerId): void;
export declare function onCardEntersExAreaTriggers(state: GameState, instanceId: string, player: PlayerId): void;
