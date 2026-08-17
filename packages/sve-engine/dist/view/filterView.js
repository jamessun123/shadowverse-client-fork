"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPlayerView = createPlayerView;
exports.tryAction = tryAction;
const applyAction_1 = require("../actions/applyAction");
const registry_1 = require("../cards/registry");
const resolver_1 = require("../effects/resolver");
const effect_utils_1 = require("../rules/effect-utils");
const trigger_labels_1 = require("../rules/trigger-labels");
const queries_1 = require("../state/queries");
function activateLabel(ability) {
    if (ability.label)
        return ability.label;
    const costBits = [];
    if ((ability.cost?.pp ?? 0) > 0)
        costBits.push(`${ability.cost.pp} PP`);
    if (ability.cost?.engage)
        costBits.push("engage");
    if (ability.cost?.banishFromCemetery)
        costBits.push("banish from cemetery");
    if (ability.cost?.banishFromExArea)
        costBits.push("banish from EX");
    if (ability.cost?.fuse) {
        const n = ability.cost.fuse.count ?? 1;
        costBits.push(`fuse ${n}`);
    }
    if (ability.cost?.burySelf)
        costBits.push("bury this");
    if (ability.cost?.discardSelf)
        costBits.push("discard this");
    const effect = (0, trigger_labels_1.describeEffect)(ability.effect);
    const costSuffix = costBits.length ? ` (${costBits.join(", ")})` : "";
    return `Activate${costSuffix}: ${effect}`;
}
function pushActivateOptions(legalActions, activateOptions, state, player, instanceId, zone, card, pp, evoPoints) {
    const activated = (0, queries_1.getActivatedAbilities)(state, card, player, zone);
    if (activated.length === 0)
        return;
    const def = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
    for (const { ability, key } of activated) {
        const cost = ability.cost?.pp ?? 0;
        const advance = (0, effect_utils_1.isAdvanceAbility)(def, ability);
        const ppPay = (0, queries_1.computeEvolvePayment)(cost, pp, evoPoints, false);
        const epPay = (0, queries_1.computeEvolvePayment)(cost, pp, evoPoints, true);
        const label = activateLabel(ability);
        if (ppPay.ok) {
            const actionPrefix = zone === "field"
                ? "ACTIVATE"
                : zone === "cemetery"
                    ? "ACTIVATE_CEMETERY"
                    : zone === "exArea"
                        ? "ACTIVATE_EXAREA"
                        : "ACTIVATE_HAND";
            legalActions.push(`${actionPrefix}:${instanceId}:${key}`);
            activateOptions.push({
                instanceId,
                zone,
                abilityKey: key,
                label,
                useEvoPoint: false,
            });
        }
        if (zone === "field" && advance && epPay.ok && epPay.epCost > 0) {
            legalActions.push(`ACTIVATE_EP:${instanceId}:${key}`);
            activateOptions.push({
                instanceId,
                zone,
                abilityKey: key,
                label: `${label} (use EP)`,
                useEvoPoint: true,
            });
        }
        if (zone === "hand" && advance && epPay.ok && epPay.epCost > 0) {
            legalActions.push(`ACTIVATE_HAND_EP:${instanceId}:${key}`);
            activateOptions.push({
                instanceId,
                zone,
                abilityKey: key,
                label: `${label} (use EP)`,
                useEvoPoint: true,
            });
        }
    }
    // Compatibility aliases so existing UI checks still light up.
    if (zone === "field" && activated.some((a) => (0, queries_1.computeEvolvePayment)(a.ability.cost?.pp ?? 0, pp, evoPoints, false).ok)) {
        legalActions.push(`ACTIVATE:${instanceId}`);
    }
    if (zone === "cemetery")
        legalActions.push(`ACTIVATE_CEMETERY:${instanceId}`);
    if (zone === "exArea")
        legalActions.push(`ACTIVATE_EXAREA:${instanceId}`);
    if (zone === "hand" && activated.some((a) => (0, queries_1.computeEvolvePayment)(a.ability.cost?.pp ?? 0, pp, evoPoints, false).ok)) {
        legalActions.push(`ACTIVATE_HAND:${instanceId}`);
    }
}
function createPlayerView(state, self) {
    const opponent = (0, queries_1.opponentOf)(self);
    const view = structuredClone(state);
    view.players[opponent].zones.hand = view.players[opponent].zones.hand.map((c) => ({
        ...c,
        name: "HIDDEN",
    }));
    view.players[self].zones.evolveDeck = view.players[self].zones.evolveDeck;
    // Used evolve cards are public information (face-up in the evolve area).
    view.players[opponent].zones.evolveDeck = view.players[opponent].zones.evolveDeck.map((c) => c.evolveUsed
        ? c
        : {
            ...c,
            name: "HIDDEN",
        });
    view.players[opponent].zones.deck = view.players[opponent].zones.deck.map((c) => ({
        ...c,
        name: "HIDDEN",
    }));
    const legalActions = [];
    const activateOptions = [];
    const combatQuickWindow = state.combat?.phase === "quickWindow";
    if (state.phase === "main" && state.activePlayer === self && !state.pendingChoices && !combatQuickWindow) {
        legalActions.push("END_MAIN");
        const pp = state.players[self].pp;
        const p = state.players[self];
        for (const card of p.zones.hand) {
            const cost = (0, queries_1.getEffectivePlayCost)(card, card.name, state, self, "hand");
            if (pp >= cost && (0, resolver_1.canPlayCardFromZones)(state, self, card.name)) {
                legalActions.push(`PLAY:${card.instanceId}`);
            }
            pushActivateOptions(legalActions, activateOptions, state, self, card.instanceId, "hand", card, pp, p.evoPoints);
        }
        for (const card of p.zones.exArea) {
            const cost = (0, queries_1.getEffectivePlayCost)(card, card.name, state, self, "exArea");
            if (pp >= cost && (0, resolver_1.canPlayCardFromZones)(state, self, card.name)) {
                legalActions.push(`PLAY:${card.instanceId}`);
            }
        }
        for (const card of p.zones.field) {
            if (!card.engaged && !(0, queries_1.isBoxed)(card, state)) {
                const cardDef = (0, registry_1.getCardDef)((0, queries_1.resolveCardNo)(state, card));
                const canAttack = cardDef?.cardType === "follower" &&
                    (card.onFieldSinceTurnStart ||
                        card.evolvedThisTurn ||
                        (0, queries_1.hasKeyword)(card, "storm", state) ||
                        (0, queries_1.hasKeyword)(card, "rush", state));
                if (canAttack) {
                    legalActions.push(`ATTACK:${card.instanceId}`);
                    for (const target of (0, queries_1.getLegalAttackTargets)(state, card, self)) {
                        if (target.type === "leader") {
                            legalActions.push(`ATTACK_LEADER:${card.instanceId}`);
                        }
                        else {
                            legalActions.push(`ATTACK_TARGET:${card.instanceId}:${target.instanceId}`);
                        }
                    }
                }
            }
            pushActivateOptions(legalActions, activateOptions, state, self, card.instanceId, "field", card, pp, p.evoPoints);
            // Evolve is allowed even while engaged (e.g. after activating).
            if (!(0, queries_1.isBoxed)(card, state) &&
                !card.linkedEvoInstanceId &&
                (0, queries_1.canEvolveFollower)(state, self, card.instanceId)) {
                const evoMatch = (0, queries_1.findMatchingEvolveCard)(state, self, card.instanceId);
                if (evoMatch) {
                    const cost = (0, queries_1.getEffectiveEvolveCost)(state, self, card);
                    if (cost == null)
                        continue;
                    const canSuper = (0, queries_1.canSuperEvolveNow)(state, self);
                    const ppPay = (0, queries_1.computeEvolvePayment)(cost, pp, p.evoPoints, false);
                    const epPay = (0, queries_1.computeEvolvePayment)(cost, pp, p.evoPoints, true);
                    if (ppPay.ok) {
                        legalActions.push(`EVOLVE:${card.instanceId}`);
                        if (canSuper)
                            legalActions.push(`SUPER_EVOLVE:${card.instanceId}`);
                    }
                    if (epPay.ok && epPay.epCost > 0) {
                        legalActions.push(`EVOLVE_EP:${card.instanceId}`);
                        if (canSuper)
                            legalActions.push(`SUPER_EVOLVE_EP:${card.instanceId}`);
                    }
                }
            }
        }
        for (const card of p.zones.cemetery) {
            pushActivateOptions(legalActions, activateOptions, state, self, card.instanceId, "cemetery", card, pp, p.evoPoints);
        }
        for (const card of p.zones.exArea) {
            pushActivateOptions(legalActions, activateOptions, state, self, card.instanceId, "exArea", card, pp, p.evoPoints);
        }
    }
    if (state.quickWindow && state.quickWindowPlayer === self && !state.pendingChoices) {
        const pp = state.players[self].pp;
        const quickZones = [
            ...state.players[self].zones.hand.map((card) => ({ card, fromZone: "hand" })),
            ...state.players[self].zones.exArea.map((card) => ({ card, fromZone: "exArea" })),
        ];
        for (const { card, fromZone } of quickZones) {
            const def = (0, registry_1.getCardDef)(card.name);
            if (!def?.keywords?.includes("quick") && !def?.abilities?.some((a) => a.quick))
                continue;
            const cost = (0, queries_1.getEffectivePlayCost)(card, card.name, state, self, fromZone);
            if (pp >= cost && (0, resolver_1.canPlayCardFromZones)(state, self, card.name)) {
                legalActions.push(`QUICK_PLAY:${card.instanceId}`);
            }
        }
        // Always allow pass so the window can end after playing the last playable quick.
        legalActions.push("PASS_QUICK_WINDOW");
    }
    if (state.pendingChoices?.player === self) {
        legalActions.push("CHOICE_REQUIRED");
    }
    const exPlayCosts = {};
    for (const card of state.players[self].zones.exArea) {
        if ((0, registry_1.getCardDef)(card.name)?.cardType === "crest")
            continue;
        exPlayCosts[card.instanceId] = (0, queries_1.getEffectivePlayCost)(card, card.name, state, self, "exArea");
    }
    const opponentExPlayCosts = {};
    for (const card of state.players[opponent].zones.exArea) {
        if ((0, registry_1.getCardDef)(card.name)?.cardType === "crest")
            continue;
        opponentExPlayCosts[card.instanceId] = (0, queries_1.getEffectivePlayCost)(card, card.name, state, opponent, "exArea");
    }
    const combatKeywordList = [
        "ward",
        "bane",
        "aura",
        "rush",
        "storm",
        "drain",
        "intimidate",
    ];
    const activeKeywords = {};
    const collectActiveKeywords = (owner, card) => {
        activeKeywords[card.instanceId] = combatKeywordList.filter((kw) => (0, queries_1.hasKeyword)(card, kw, state, owner));
    };
    for (const card of state.players[self].zones.field)
        collectActiveKeywords(self, card);
    for (const card of state.players[self].zones.exArea)
        collectActiveKeywords(self, card);
    for (const card of state.players[opponent].zones.field)
        collectActiveKeywords(opponent, card);
    for (const card of state.players[opponent].zones.exArea) {
        collectActiveKeywords(opponent, card);
    }
    return {
        self,
        state: view,
        opponentHandCount: state.players[opponent].zones.hand.length,
        opponentDeckCount: state.players[opponent].zones.deck.length,
        opponentEvoDeckCount: state.players[opponent].zones.evolveDeck.length +
            state.players[opponent].zones.evolveZone.length,
        legalActions,
        activateOptions,
        exPlayCosts,
        opponentExPlayCosts,
        activeKeywords,
    };
}
function tryAction(state, player, action) {
    return (0, applyAction_1.applyAction)(state, player, action);
}
