import { Condition, DeckFilter, GameState, PlayerId } from "../types";
export declare function cardMatchesFilter(cardNo: string, filter: DeckFilter, state?: GameState): boolean;
export declare function evalCondition(state: GameState, player: PlayerId, condition: Condition): boolean;
