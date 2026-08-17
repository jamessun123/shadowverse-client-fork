"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadDecks = loadDecks;
exports.applyMulligan = applyMulligan;
exports.beginStartPhase = beginStartPhase;
const registry_1 = require("../cards/registry");
const detectIdentity_1 = require("../deck/detectIdentity");
const factory_1 = require("../state/factory");
const passives_1 = require("../state/passives");
const zones_1 = require("../state/zones");
const trigger_queue_1 = require("../rules/trigger-queue");
const confirmation_1 = require("../rules/confirmation");
const FALLBACK_MAIN = "Vanilla Soldier";
const FALLBACK_EVO = "Eager Recruit Evolved";
/**
 * Resolve a deck entry to its registry name when known.
 * Unknown names are kept as-is so choice modals (search/summon) still show the
 * real card art instead of rewriting every unimplemented card to Vanilla Soldier.
 */
function resolveDeckCardName(nameOrCardNo, fallback) {
    if (!nameOrCardNo)
        return fallback;
    const def = (0, registry_1.getCardDef)(nameOrCardNo);
    if (def?.name)
        return def.name;
    console.warn(`[sve-engine] Unknown deck card "${nameOrCardNo}" — keeping original name`);
    return nameOrCardNo;
}
function clearTurnScopedCardState(card) {
    card.abilitiesActivatedThisTurn = [];
    card.counters = {};
    card.chosenChooseOptionsThisTurn = {};
    card.chosenChooseOptionLabelsThisTurn = {};
    card.modifiers = card.modifiers.filter((m) => !m.untilEndOfTurn);
    card.playCostReduction = 0;
    card.evolveCostOverride = undefined;
    if (card.grantedOnCardPlayed?.length) {
        card.grantedOnCardPlayed = card.grantedOnCardPlayed.filter((g) => !g.untilEndOfTurn);
    }
    // Clear until-end-of-turn attack lock when modifiers expire; also clear explicit flag
    // that was set without a modifier.
    if (card.cannotAttack && !card.modifiers.some((m) => m.cannotAttack)) {
        card.cannotAttack = undefined;
    }
}
function refreshFieldCard(card, state) {
    card.evolvedThisTurn = false;
    card.foughtWithBane = false;
    card.foughtWithInstanceId = undefined;
    clearTurnScopedCardState(card);
    if ((0, passives_1.isBoxed)(card, state)) {
        card.engaged = true;
        card.onFieldSinceTurnStart = false;
        return;
    }
    if (card.skipRefreshNextStart) {
        card.skipRefreshNextStart = undefined;
        card.engaged = true;
        card.onFieldSinceTurnStart = false;
        card.boxedUntilTurn = undefined;
        return;
    }
    card.boxedUntilTurn = undefined;
    card.engaged = false;
    card.onFieldSinceTurnStart = true;
}
function loadDecks(state, decks) {
    let next = structuredClone(state);
    for (const pid of [0, 1]) {
        const input = decks[pid];
        next.players[pid].zones.deck = input.mainDeck.map((cardNo) => (0, factory_1.createCardInstance)(resolveDeckCardName(cardNo, FALLBACK_MAIN), pid));
        next.players[pid].zones.evolveDeck = input.evolveDeck.map((cardNo) => (0, factory_1.createCardInstance)(resolveDeckCardName(cardNo, FALLBACK_EVO), pid));
        next = (0, zones_1.shuffleDeck)(next, pid);
        if (input.universe === "idolmaster") {
            const p = next.players[pid];
            for (let i = 0; i < 5 && p.zones.exArea.length < p.exLimit; i++) {
                p.zones.exArea.push((0, factory_1.createCardInstance)(detectIdentity_1.COOL_EARRINGS_CARD_NO, pid, pid));
            }
        }
        for (let i = 0; i < 4; i++) {
            next = (0, zones_1.drawCard)(next, pid);
        }
    }
    next.phase = "mulligan";
    next.pendingChoices = { type: "mulligan", player: next.firstPlayer };
    next.eventLog.push({ type: "gamePrepared" });
    return next;
}
function applyMulligan(state, player, redraw) {
    let next = structuredClone(state);
    if (redraw) {
        const returned = next.players[player].zones.hand.splice(0);
        // The new hand comes off the top before the old cards go under, so a redraw
        // can never hand back the cards it just returned.
        for (let i = 0; i < returned.length; i++) {
            next = (0, zones_1.drawCard)(next, player);
        }
        next.players[player].zones.deck.push(...returned);
    }
    next.players[player].flags.mulliganDone = true;
    next.eventLog.push({ type: "mulligan", player, data: { redraw } });
    if (!next.players[0].flags.mulliganDone) {
        next.pendingChoices = { type: "mulligan", player: 0 };
        return next;
    }
    if (!next.players[1].flags.mulliganDone) {
        next.pendingChoices = { type: "mulligan", player: 1 };
        return next;
    }
    next.pendingChoices = null;
    next.turnNumber = 1;
    next.activePlayer = next.firstPlayer;
    return beginStartPhase(next);
}
function beginStartPhase(state) {
    let next = structuredClone(state);
    const player = next.activePlayer;
    const p = next.players[player];
    if (p.maxPp < 10)
        p.maxPp += 1;
    p.pp = p.maxPp;
    p.turnsPassed += 1;
    p.flags.evolvedThisTurn = false;
    p.flags.cardsPlayedThisTurn = 0;
    p.flags.spellsPlayedThisTurn = 0;
    p.flags.unionBurstsActivatedThisTurn = 0;
    p.flags.unionBurstSourceIdsThisTurn = [];
    p.flags.leaderLostDefThisTurn = false;
    p.flags.chosenChooseOptionTracksThisTurn = {};
    p.flags.chosenChooseOptionLabelsThisTurn = {};
    for (const card of p.zones.field) {
        refreshFieldCard(card, next);
    }
    for (const zone of ["hand", "exArea", "cemetery"]) {
        for (const card of p.zones[zone]) {
            clearTurnScopedCardState(card);
        }
    }
    const skipDraw = next.turnNumber === 1 && player === next.firstPlayer;
    if (!skipDraw) {
        next = (0, zones_1.drawCard)(next, player);
    }
    next.phase = "main";
    next.eventLog.push({ type: "startPhase", player });
    (0, trigger_queue_1.queueStartOfMainAbilities)(next, player);
    next = (0, confirmation_1.runConfirmationTiming)(next);
    return next;
}
