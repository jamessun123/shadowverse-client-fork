"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.crestAlreadyInExArea = crestAlreadyInExArea;
const registry_1 = require("./registry");
const reprints_1 = require("./reprints");
/** Crest identity for a card name/cardNo, or null when the card is not a crest. */
function crestIdentity(cardName) {
    const def = (0, registry_1.getCardDef)(cardName);
    if (def?.cardType !== "crest")
        return null;
    return (0, reprints_1.normalizeIdentityName)(def.name).toLowerCase();
}
/**
 * A player may control only one crest of each name at a time, so a second copy
 * is never created in or moved into their EX area.
 */
function crestAlreadyInExArea(state, player, cardName, ignoreInstanceId) {
    const identity = crestIdentity(cardName);
    if (!identity)
        return false;
    return state.players[player].zones.exArea.some((c) => c.instanceId !== ignoreInstanceId && crestIdentity(c.name) === identity);
}
