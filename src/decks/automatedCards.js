/**
 * Cards with engine abilities (hand-authored card-defs / non-empty abilities).
 * Regenerate: npm run generate:automated-cards
 */
import list from "./automatedCards.json";

export const AUTOMATED_CARDS = new Set(list);

export function isAutomatedCard(name) {
  return AUTOMATED_CARDS.has(name);
}
