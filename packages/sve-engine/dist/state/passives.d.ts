import { AbilityDefinition, CardInstance, GameState, Keyword, PlayerId } from "../types";
export declare function isBoxed(card: CardInstance, state: GameState): boolean;
export declare function getPassiveKeywords(state: GameState, card: CardInstance, player: PlayerId): Keyword[];
export declare function getAuraKeywords(state: GameState, card: CardInstance, player: PlayerId): Keyword[];
export declare function getMaxDamagePerHit(state: GameState, card: CardInstance, player: PlayerId): number | null;
/**
 * "This card can't be destroyed by abilities." Burying and lethal damage (including
 * ability damage) still remove the card — only the destroy op is blocked.
 */
export declare function isDestroyImmuneToAbilities(state: GameState, card: CardInstance, player: PlayerId): boolean;
export declare function hasNamedFollowerOnFieldByIdentity(state: GameState, player: PlayerId, identityName: string): boolean;
export declare function matchesExAreaEntryFilter(ability: AbilityDefinition, enteredCardNo: string): boolean;
