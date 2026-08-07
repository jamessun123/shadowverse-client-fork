import { AbilityDefinition, GameState, PlayerId } from "../types";
/** Record that a Union Burst ability resolved and queue cross-card triggers. */
export declare function recordUnionBurstActivated(state: GameState, player: PlayerId, sourceInstanceId: string, ability: AbilityDefinition | undefined): GameState;
/**
 * Record a Union Burst only once its effect has fully finished.
 * If the ability paused on a target/choose prompt, stash it on the resolution
 * context so mid-ability checks (e.g. Eris / Ameth "2 other UBs") do not count
 * the current activation.
 */
export declare function scheduleOrRecordUnionBurstActivated(state: GameState, player: PlayerId, sourceInstanceId: string, ability: AbilityDefinition | undefined): GameState;
/** Flush a stashed Union Burst once choices/resume work are done. */
export declare function flushPendingUnionBurst(state: GameState): GameState;
/** Mark that a Union Burst from this source is currently resolving. */
export declare function markResolvingUnionBurst(state: GameState, sourceInstanceId: string): GameState;
