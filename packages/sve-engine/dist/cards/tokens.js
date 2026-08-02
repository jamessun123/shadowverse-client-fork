"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTokenCard = isTokenCard;
exports.placeLeavingPlay = placeLeavingPlay;
exports.destinationForDestroyedCard = destinationForDestroyedCard;
const registry_1 = require("./registry");
function isTokenCard(cardNo) {
    const def = (0, registry_1.getCardDef)(cardNo);
    if (!def)
        return /\bTOKEN\b/i.test(cardNo);
    return (def.printingType === "token" ||
        def.specialType === "token" ||
        /\bTOKEN\b/i.test(def.name));
}
/**
 * Place a card into cemetery/banish after it leaves play.
 * Tokens cease to exist when moved outside field / EX / resolution
 * (SVE Comprehensive Rules 9.1) — they are never left in cemetery or banish.
 *
 * @returns true if placed in a zone, false if eliminated
 */
function placeLeavingPlay(zones, card, intended = "cemetery") {
    if (isTokenCard(card.name))
        return false;
    zones[intended].push(card);
    return true;
}
/** @deprecated Prefer placeLeavingPlay — tokens are eliminated, not banished. */
function destinationForDestroyedCard(cardNo) {
    return isTokenCard(cardNo) ? "banish" : "cemetery";
}
