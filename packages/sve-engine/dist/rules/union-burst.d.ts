import { AbilityDefinition, GameState, PlayerId } from "../types";
/** Record that a Union Burst ability resolved and queue cross-card triggers. */
export declare function recordUnionBurstActivated(state: GameState, player: PlayerId, sourceInstanceId: string, ability: AbilityDefinition | undefined): GameState;
