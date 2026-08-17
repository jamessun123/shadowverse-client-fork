import { GameState, PlayerId } from "../types";
export declare function queueOnCardPlayed(state: GameState, playedInstanceId: string, player: PlayerId, 
/** Fallback when the played card was already eliminated (e.g. token spell). */
playedCardName?: string): void;
/** Queue watchers for a card that was fused into the EX area. */
export declare function queueOnCardFused(state: GameState, fusedInstanceId: string, player: PlayerId): void;
/** Queue "When this card is discarded" abilities for a card now in the cemetery. */
export declare function queueOnDiscard(state: GameState, instanceId: string, player: PlayerId): void;
export declare function queueLastWords(state: GameState, instanceId: string, player: PlayerId): void;
export declare function queueFanfare(state: GameState, instanceId: string, player: PlayerId): void;
/** Queue On Evolve / On Super Evolve so Union Burst flags survive confirmation. */
export declare function queueOnEvolveAbilities(state: GameState, instanceId: string, player: PlayerId, includeSuperEvolve?: boolean): void;
export declare function queueStartOfEndAbilities(state: GameState, player: PlayerId): void;
export declare function queueStartOfMainAbilities(state: GameState, player: PlayerId): void;
/** During the active player's turn, when a card leaves an opponent's deck into cemetery. */
export declare function queueOnOpponentDeckToCemetery(state: GameState): void;
export declare function queueAllyFollowerEnterTriggers(state: GameState, enteredInstanceId: string, player: PlayerId): void;
/** Cemetery cards that react when an ally follower enters (e.g. Delta Cannon + Tetra). */
export declare function queueCemeteryOnAllyFollowerEnter(state: GameState, enteredInstanceId: string, player: PlayerId): void;
/** Queue onAbilityDamageTaken after a follower takes ability damage (even if it dies to it). */
export declare function queueOnAbilityDamageTaken(state: GameState, instanceId: string): void;
/**
 * Queue onAbilityDamageDealt after a follower deals ability damage to an enemy follower.
 * Equipment attached to the dealer can also carry this timing (e.g. Dark Axe Nachtfang).
 */
export declare function queueOnAbilityDamageDealt(state: GameState, sourceInstanceId: string, damagedInstanceId: string): void;
export declare function onCardEntersExAreaTriggers(state: GameState, instanceId: string, player: PlayerId): void;
/** Queue onUnionBurstActivated abilities on other ally field followers. */
export declare function queueOnUnionBurstActivated(state: GameState, activatorInstanceId: string, player: PlayerId): void;
