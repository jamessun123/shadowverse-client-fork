import { Effect, GameState, PlayerId } from "../types";
export declare function appendResumeEffects(state: GameState, effects: Effect[]): GameState;
export declare function buryDeckCards(state: GameState, player: PlayerId, instanceIds: string[]): GameState;
export declare function moveZoneCardTo(state: GameState, player: PlayerId, instanceId: string, fromZone: "deck" | "cemetery" | "hand" | "evolveDeck", to: "hand" | "exArea" | "field" | "cemetery"): GameState;
export type ResolveEffectOptions = {
    deferConfirmation?: boolean;
};
export declare function resolveEffect(state: GameState, effect: Effect, player: PlayerId, options?: ResolveEffectOptions): GameState;
/**
 * Whether a choose-modal option should be offered. Pure if-then options (no else)
 * are gated on the condition so text like "if you've activated 2 other UBs…"
 * does not appear as a selectable no-op.
 */
export declare function canChooseOptionResolve(state: GameState, player: PlayerId, effect: Effect): boolean;
export declare function canEffectResolve(state: GameState, player: PlayerId, effect: Effect): boolean;
export declare function canPlayCardFromZones(state: GameState, player: PlayerId, cardNo: string): boolean;
export declare function resolveSpell(state: GameState, cardNo: string, player: PlayerId): GameState;
