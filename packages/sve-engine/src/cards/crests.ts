import { getCardDef } from "./registry";
import { normalizeIdentityName } from "./reprints";
import { GameState, PlayerId } from "../types";

/** Crest identity for a card name/cardNo, or null when the card is not a crest. */
function crestIdentity(cardName: string): string | null {
  const def = getCardDef(cardName);
  if (def?.cardType !== "crest") return null;
  return normalizeIdentityName(def.name).toLowerCase();
}

/**
 * A player may control only one crest of each name at a time, so a second copy
 * is never created in or moved into their EX area.
 */
export function crestAlreadyInExArea(
  state: GameState,
  player: PlayerId,
  cardName: string,
  ignoreInstanceId?: string,
): boolean {
  const identity = crestIdentity(cardName);
  if (!identity) return false;
  return state.players[player].zones.exArea.some(
    (c) => c.instanceId !== ignoreInstanceId && crestIdentity(c.name) === identity,
  );
}
