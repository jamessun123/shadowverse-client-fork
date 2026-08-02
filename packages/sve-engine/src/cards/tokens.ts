import { getCardDef } from "./registry";
import type { CardInstance } from "../types";

export function isTokenCard(cardNo: string): boolean {
  const def = getCardDef(cardNo);
  if (!def) return /\bTOKEN\b/i.test(cardNo);
  return (
    def.printingType === "token" ||
    def.specialType === "token" ||
    /\bTOKEN\b/i.test(def.name)
  );
}

/**
 * Place a card into cemetery/banish after it leaves play.
 * Tokens cease to exist when moved outside field / EX / resolution
 * (SVE Comprehensive Rules 9.1) — they are never left in cemetery or banish.
 *
 * @returns true if placed in a zone, false if eliminated
 */
export function placeLeavingPlay(
  zones: { cemetery: CardInstance[]; banish: CardInstance[] },
  card: CardInstance,
  intended: "cemetery" | "banish" = "cemetery",
): boolean {
  if (isTokenCard(card.name)) return false;
  zones[intended].push(card);
  return true;
}

/** @deprecated Prefer placeLeavingPlay — tokens are eliminated, not banished. */
export function destinationForDestroyedCard(cardNo: string): "banish" | "cemetery" {
  return isTokenCard(cardNo) ? "banish" : "cemetery";
}
