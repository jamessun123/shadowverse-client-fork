import type { CardInstance } from "../types";
export declare function isTokenCard(cardNo: string): boolean;
/**
 * Place a card into cemetery/banish after it leaves play.
 * Tokens cease to exist when moved outside field / EX / resolution
 * (SVE Comprehensive Rules 9.1) — they are never left in cemetery or banish.
 *
 * @returns true if placed in a zone, false if eliminated
 */
export declare function placeLeavingPlay(zones: {
    cemetery: CardInstance[];
    banish: CardInstance[];
}, card: CardInstance, intended?: "cemetery" | "banish"): boolean;
/** @deprecated Prefer placeLeavingPlay — tokens are eliminated, not banished. */
export declare function destinationForDestroyedCard(cardNo: string): "banish" | "cemetery";
