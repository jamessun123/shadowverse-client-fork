import { Effect, GameState, PlayerId } from "../types";
export declare function appendResumeEffects(state: GameState, effects: Effect[]): GameState;
export declare function buryDeckCards(state: GameState, player: PlayerId, instanceIds: string[]): GameState;
export declare function moveZoneCardTo(state: GameState, player: PlayerId, instanceId: string, fromZone: "deck" | "cemetery" | "hand" | "evolveDeck", to: "hand" | "exArea" | "field" | "cemetery", 
/**
 * Full-deck searches shuffle afterwards; "look at the top N" effects must not,
 * since the cards below the looked-at ones keep their order.
 */
shuffleDeckAfter?: boolean): GameState;
export type ResolveEffectOptions = {
    deferConfirmation?: boolean;
};
export declare function resolveEffect(state: GameState, effect: Effect, player: PlayerId, options?: ResolveEffectOptions): GameState;
/**
 * Whether a choose-modal option should be offered. If-then options whose else is
 * missing or a noop are gated on the condition (and the then-branch resolving),
 * so modes like Croce's X=N / Ameth's "2 other UBs" are not selectable no-ops.
 */
export declare function canChooseOptionResolve(state: GameState, player: PlayerId, effect: Effect): boolean;
export declare function canEffectResolve(state: GameState, player: PlayerId, effect: Effect): boolean;
export declare function canPlayCardFromZones(state: GameState, player: PlayerId, cardNo: string): boolean;
export declare function resolveSpell(state: GameState, cardNo: string, player: PlayerId): GameState;
