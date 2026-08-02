import { AbilityDefinition, CardInstance, GameState, Keyword, PlayerId } from "../types";
export declare function getPlayer(state: GameState, player: PlayerId): import("../types").PlayerState;
/** Equipment sits on the field zone but does not occupy a board slot. */
export declare function isEquippedAttachment(card: CardInstance): boolean;
/** Board occupants only (followers/amulets that are not attached equipment). */
export declare function fieldOccupancy(field: CardInstance[]): number;
export declare function hasFieldSpace(field: CardInstance[], fieldLimit: number): boolean;
export declare function findInstance(state: GameState, instanceId: string): {
    card: CardInstance;
    player: PlayerId;
    zone: string;
} | null;
/** Base printing to use for play cost / unevolved stats (evolved printings in hand count as base). */
export declare function getBaseCardNoForInstance(cardNo: string, linkedEvoInstanceId?: string): string;
export declare function computeEvolvePayment(cost: number, pp: number, evoPoints: number, useEvoPoint: boolean): {
    ok: boolean;
    ppCost: number;
    epCost: number;
};
export declare function canSuperEvolveNow(state: GameState, player: PlayerId): boolean;
/** When evolved, the evolve card's definition applies for stats/keywords/abilities. */
export declare function resolveCardNo(state: GameState | undefined, card: CardInstance): string;
export { isBoxed } from "./passives";
/** Printed play cost; evolved promos with cost 0 inherit from their base form. */
export declare function resolveCardDefCost(cardNo: string): number;
/** EX-area discount from passives on the card being played and followers on field (e.g. Tetra Evo). */
export declare function getExAreaPlayCostReduction(state: GameState, player: PlayerId, cardNo: string): number;
export declare function getPassivePlayCostReduction(state: GameState, player: PlayerId, cardNo: string): number;
/**
 * Pending "next matching card costs less" grants from activate abilities
 * (stored on field/EX via grantOnCardPlayed + playCostReduction).
 */
export declare function getGrantedPlayCostReduction(state: GameState, player: PlayerId, cardNo: string): number;
/** Consume pending play-cost grants that matched a card that was just played. */
export declare function consumeGrantedPlayCostReductions(state: GameState, player: PlayerId, cardNo: string): void;
export declare function getEffectivePlayCost(card: CardInstance, cardNo: string, state?: GameState, player?: PlayerId, fromZone?: string): number;
export declare function getEffectiveStats(card: CardInstance, state?: GameState): {
    atk: number;
    def: number;
    cost: number;
    hasCombatStats: false;
} | {
    atk: number;
    def: number;
    cost: number;
    hasCombatStats: true;
};
export declare function isFollowerCard(card: CardInstance, state?: GameState): boolean;
/** PP cost to evolve (separate from a card's play cost). */
export declare function getEvolveCost(evoCardNo: string, baseCardNo?: string): number;
/**
 * Evolve costs currently available for a field follower.
 * Alternate evolve abilities are independent — any met option unlocks evolving.
 */
export declare function getAvailableEvolveCosts(state: GameState, player: PlayerId, fieldCard: CardInstance): number[];
/** Cheapest currently available evolve PP cost, or null if none are legal. */
export declare function getEffectiveEvolveCost(state: GameState, player: PlayerId, fieldCard: CardInstance): number | null;
export declare function hasKeyword(card: CardInstance, keyword: Keyword, state?: GameState, player?: PlayerId): boolean;
export declare function clampDamageToFollower(state: GameState, card: CardInstance, player: PlayerId, amount: number): number;
export declare function canEvolveFollower(state: GameState, player: PlayerId, fieldInstanceId: string): boolean;
export declare function getActivatedAbilities(state: GameState, card: CardInstance, player: PlayerId, zone: "field" | "cemetery" | "exArea" | "hand"): {
    ability: AbilityDefinition;
    key: string;
}[];
export declare function evolveCardsMatch(fieldCardNo: string, evoCardNo: string): boolean;
export declare function findMatchingEvolveCard(state: GameState, player: PlayerId, fieldInstanceId: string): CardInstance | null;
export declare function getStrikeAbilities(state: GameState, card: CardInstance): {
    ability: AbilityDefinition;
    key: string;
}[];
export declare function opponentOf(player: PlayerId): PlayerId;
export declare function isOverflowActive(state: GameState, player: PlayerId): boolean;
export declare function canAttackLeader(state: GameState, attacker: CardInstance, player: PlayerId): boolean;
export declare function getWardTargets(state: GameState, defender: PlayerId): CardInstance[];
export declare function getLegalAttackTargets(state: GameState, attacker: CardInstance, player: PlayerId): Array<{
    type: "leader";
    player: PlayerId;
} | {
    type: "follower";
    instanceId: string;
}>;
