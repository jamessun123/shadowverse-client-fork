"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moveCard = moveCard;
exports.removeFromField = removeFromField;
exports.destroyFollower = destroyFollower;
exports.drawCard = drawCard;
exports.shuffleDeck = shuffleDeck;
const crests_1 = require("../cards/crests");
const tokens_1 = require("../cards/tokens");
const confirmation_1 = require("../rules/confirmation");
const card_reset_1 = require("./card-reset");
const queries_1 = require("./queries");
function moveCard(state, instanceId, toZone, toPlayer) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found)
        return state;
    if (toZone === "exArea" &&
        (0, crests_1.crestAlreadyInExArea)(state, toPlayer, found.card.name, instanceId)) {
        return state;
    }
    let next = structuredClone(state);
    const fromZones = next.players[found.player].zones;
    const fromList = fromZones[found.zone];
    const idx = fromList.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0)
        return state;
    const [card] = fromList.splice(idx, 1);
    // Host leaving field: send attached equipment to cemetery/banish.
    if (found.zone === "field" && toZone !== "field" && card.equippedInstanceIds?.length) {
        const equipIds = [...card.equippedInstanceIds];
        card.equippedInstanceIds = [];
        for (const eqId of equipIds) {
            next = moveCard(next, eqId, "cemetery", found.player);
        }
    }
    // Equipment leaving: unlink from host.
    if (card.equippedToInstanceId) {
        const host = (0, queries_1.findInstance)(next, card.equippedToInstanceId);
        if (host?.card.equippedInstanceIds) {
            host.card.equippedInstanceIds = host.card.equippedInstanceIds.filter((id) => id !== instanceId);
            // Strip modifiers sourced from this equipment.
            host.card.modifiers = host.card.modifiers.filter((m) => m.sourceId !== instanceId);
            if (host.card.grantedOnCardPlayed?.length) {
                host.card.grantedOnCardPlayed = host.card.grantedOnCardPlayed.filter((g) => g.sourceId !== instanceId);
            }
            host.card.grantedKeywords = host.card.grantedKeywords.filter(() => true);
            // Recalculate damage bonuses from remaining equipment modifiers.
            host.card.damageDealtBonus = host.card.modifiers.reduce((sum, m) => sum + (m.damageDealtBonus ?? 0), 0) || undefined;
            host.card.damageTakenReduction = host.card.modifiers.reduce((sum, m) => sum + (m.damageTakenReduction ?? 0), 0) || undefined;
        }
        card.equippedToInstanceId = undefined;
    }
    // Tokens cease to exist outside field / EX / resolution.
    if ((toZone === "cemetery" || toZone === "banish") &&
        (0, tokens_1.isTokenCard)(card.name)) {
        (0, card_reset_1.resetCardInstanceState)(card);
        return next;
    }
    card.controller = toPlayer;
    const toList = next.players[toPlayer].zones[toZone];
    toList.push(card);
    if (toZone === "cemetery" || toZone === "banish") {
        (0, card_reset_1.resetCardInstanceState)(card);
    }
    else if (toZone === "field") {
        (0, confirmation_1.onFollowerEntersField)(next, card.instanceId, toPlayer);
    }
    else if (toZone === "exArea") {
        (0, confirmation_1.onCardEntersExArea)(next, card.instanceId, toPlayer);
    }
    return next;
}
function removeFromField(state, instanceId) {
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found || found.zone !== "field")
        return null;
    let next = structuredClone(state);
    const player = found.player;
    let p = next.players[player];
    const idx = p.zones.field.findIndex((c) => c.instanceId === instanceId);
    if (idx < 0)
        return null;
    const [card] = p.zones.field.splice(idx, 1);
    // Host leaving: dump equipment first (while still tracked on the card).
    // moveCard clones state, so re-bind `p` after each call before placing the host.
    if (card.equippedInstanceIds?.length) {
        const equipIds = [...card.equippedInstanceIds];
        card.equippedInstanceIds = [];
        for (const eqId of equipIds) {
            next = moveCard(next, eqId, "cemetery", player);
        }
        p = next.players[player];
    }
    if (card.equippedToInstanceId) {
        const host = (0, queries_1.findInstance)(next, card.equippedToInstanceId);
        if (host?.card.equippedInstanceIds) {
            host.card.equippedInstanceIds = host.card.equippedInstanceIds.filter((id) => id !== instanceId);
            host.card.modifiers = host.card.modifiers.filter((m) => m.sourceId !== instanceId);
            if (host.card.grantedOnCardPlayed?.length) {
                host.card.grantedOnCardPlayed = host.card.grantedOnCardPlayed.filter((g) => g.sourceId !== instanceId);
            }
        }
        card.equippedToInstanceId = undefined;
    }
    (0, card_reset_1.resetCardInstanceState)(card);
    (0, tokens_1.placeLeavingPlay)(p.zones, card, "cemetery");
    return { state: next, card, player };
}
function destroyFollower(state, instanceId) {
    const removed = removeFromField(state, instanceId);
    if (!removed)
        return state;
    let next = removed.state;
    const link = next.players[removed.player].zones.evolveZone.find((l) => l.fieldInstanceId === instanceId);
    if (link) {
        const evoIdx = next.players[removed.player].zones.resolutionZone.findIndex((c) => c.instanceId === link.evolveInstanceId);
        if (evoIdx >= 0) {
            const [evoCard] = next.players[removed.player].zones.resolutionZone.splice(evoIdx, 1);
            (0, card_reset_1.resetCardInstanceState)(evoCard);
            evoCard.evolveUsed = true;
            next.players[removed.player].zones.evolveDeck.push(evoCard);
        }
        else {
            next = moveCard(next, link.evolveInstanceId, "evolveDeck", removed.player);
            const evoInDeck = next.players[removed.player].zones.evolveDeck.find((c) => c.instanceId === link.evolveInstanceId);
            if (evoInDeck) {
                (0, card_reset_1.resetCardInstanceState)(evoInDeck);
                evoInDeck.evolveUsed = true;
            }
        }
        next.players[removed.player].zones.evolveZone = next.players[removed.player].zones.evolveZone.filter((l) => l.fieldInstanceId !== instanceId);
    }
    return next;
}
function drawCard(state, player) {
    const next = structuredClone(state);
    const deck = next.players[player].zones.deck;
    if (deck.length === 0) {
        next.players[player].flags.owedDraws += 1;
        next.eventLog.push({ type: "deckOut", player });
        return next;
    }
    const [card] = deck.splice(0, 1);
    next.players[player].zones.hand.push(card);
    next.eventLog.push({ type: "draw", player });
    return next;
}
function shuffleDeck(state, player) {
    const next = structuredClone(state);
    const deck = next.players[player].zones.deck;
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return next;
}
