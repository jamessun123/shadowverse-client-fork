import { AbilityDefinition, CardDefinition, ChoicePrompt, Effect, GameState, PlayerId, ResolutionContext } from "../types";
export declare function effectContainsOp(effect: Effect, op: Effect["op"]): boolean;
export declare function isAdvanceAbility(def: CardDefinition | undefined, ability: AbilityDefinition): boolean;
/** Advance activated effects gate on nested if/else deck or cemetery conditions. */
export declare function canAdvanceActivate(state: GameState, player: PlayerId, effect: Effect): boolean;
export declare function shouldDeferTriggers(state: GameState): boolean;
export declare function finishDeferredTriggers(state: GameState): GameState;
export declare function shouldClearResolutionContext(state: GameState): boolean;
export declare function contextForTriggerResolution(state: GameState, sourceInstanceId: string, effect: Effect): ResolutionContext;
export declare function getChoiceContext(state: GameState): {
    sourceCardNo?: string;
    sourceLabel?: string;
};
export declare function withChoiceContext<T extends ChoicePrompt>(state: GameState, choice: T): T;
/** Track keys for excludeChosenThisTurn: global + per-source. */
export declare function chooseTrackKeys(trackKey: string, sourceInstanceId?: string): string[];
export declare function getChosenChooseIndices(state: GameState, player: PlayerId, trackKey: string, sourceCard?: {
    chosenChooseOptionsThisTurn?: Record<string, number[]>;
}, sourceInstanceId?: string): Set<number>;
export declare function getChosenChooseLabels(state: GameState, player: PlayerId, trackKey: string, sourceCard?: {
    chosenChooseOptionLabelsThisTurn?: Record<string, string[]>;
}, sourceInstanceId?: string): Set<string>;
/** Record a chosen mode on the source card and player for the rest of the turn. */
export declare function recordChosenChooseOption(state: GameState, player: PlayerId, trackKey: string, optionIndex: number, optionLabel: string, sourceInstanceId?: string): void;
