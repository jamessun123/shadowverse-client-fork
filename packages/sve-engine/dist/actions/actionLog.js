"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildActionLogEntry = buildActionLogEntry;
exports.appendActionLog = appendActionLog;
const queries_1 = require("../state/queries");
function cardName(state, instanceId) {
    if (!instanceId)
        return undefined;
    const found = (0, queries_1.findInstance)(state, instanceId);
    if (!found)
        return undefined;
    return found.card.name.replace(/\s+TOKEN$/i, "");
}
function targetLabel(state, targetId) {
    if (!targetId)
        return "a target";
    if (targetId === "leader")
        return "the enemy leader";
    if (targetId === "selfLeader")
        return "their leader";
    return cardName(state, targetId) ?? "a follower";
}
function describeChoice(state, payload) {
    const choice = state.pendingChoices;
    if (!choice)
        return { text: "resolved a choice" };
    if (payload.skip)
        return { text: `skipped (${choice.type})` };
    if (payload.targetId != null) {
        const id = String(payload.targetId);
        const name = targetLabel(state, id);
        return { text: `selected target: ${name}`, cardName: cardName(state, id) };
    }
    if (payload.instanceId != null) {
        const id = String(payload.instanceId);
        const name = cardName(state, id) ?? id;
        return { text: `selected ${name}`, cardName: cardName(state, id) };
    }
    if (Array.isArray(payload.instanceIds)) {
        const ids = payload.instanceIds;
        const names = ids.map((id) => cardName(state, id) ?? id);
        return {
            text: ids.length
                ? `selected ${names.join(", ")}`
                : `selected no cards (${choice.type})`,
            cardName: names.length === 1 ? names[0] : undefined,
        };
    }
    if (payload.optionIndex != null) {
        const idx = Number(payload.optionIndex);
        const opt = choice.type === "choose" || choice.type === "chooseMultiple"
            ? choice.options.find((o) => o.index === idx)
            : undefined;
        return { text: `chose option: ${opt?.label ?? `#${idx}`}` };
    }
    if (payload.triggerId != null) {
        const trigger = state.pendingTriggers.find((t) => t.id === String(payload.triggerId));
        return { text: `ordered trigger: ${trigger?.label ?? String(payload.triggerId)}` };
    }
    if (payload.position != null) {
        return { text: `put card on deck ${payload.position}` };
    }
    if (typeof payload.redraw === "boolean") {
        return { text: payload.redraw ? "mulligan redraw" : "kept hand" };
    }
    return { text: `responded to ${choice.type}` };
}
/** Build a human-readable action log entry from pre-action state. */
function buildActionLogEntry(state, player, action) {
    const base = {
        seq: (state.actionLog?.length ?? 0) + 1,
        turnNumber: state.turnNumber,
        phase: state.phase,
        player,
        actionType: action.type,
    };
    switch (action.type) {
        case "MULLIGAN":
            return {
                ...base,
                text: action.redraw ? "redrew their hand (mulligan)" : "kept their opening hand",
            };
        case "PLAY_CARD": {
            const name = cardName(state, action.handInstanceId);
            return {
                ...base,
                text: name ? `played ${name}` : "played a card",
                cardName: name,
            };
        }
        case "QUICK_PLAY": {
            const name = cardName(state, action.handInstanceId);
            return {
                ...base,
                text: name ? `quick-played ${name}` : "quick-played a card",
                cardName: name,
            };
        }
        case "ATTACK": {
            const attacker = cardName(state, action.attackerId);
            const target = targetLabel(state, action.targetId);
            return {
                ...base,
                text: attacker
                    ? `attacked ${target} with ${attacker}`
                    : `attacked ${target}`,
                cardName: attacker,
            };
        }
        case "EVOLVE": {
            const name = cardName(state, action.fieldInstanceId);
            const kind = action.useSuperEvo ? "super-evolved" : "evolved";
            return {
                ...base,
                text: name ? `${kind} ${name}` : kind,
                cardName: name,
            };
        }
        case "ACTIVATE": {
            const name = cardName(state, action.fieldInstanceId);
            return {
                ...base,
                text: name ? `activated ${name}` : "activated a field ability",
                cardName: name,
            };
        }
        case "ACTIVATE_CEMETERY": {
            const name = cardName(state, action.cemeteryInstanceId);
            return {
                ...base,
                text: name ? `activated ${name} from cemetery` : "activated a cemetery ability",
                cardName: name,
            };
        }
        case "ACTIVATE_EXAREA": {
            const name = cardName(state, action.exAreaInstanceId);
            return {
                ...base,
                text: name ? `activated ${name} from EX area` : "activated an EX area ability",
                cardName: name,
            };
        }
        case "ACTIVATE_HAND": {
            const name = cardName(state, action.handInstanceId);
            return {
                ...base,
                text: name ? `activated ${name} from hand` : "activated a hand ability",
                cardName: name,
            };
        }
        case "END_MAIN":
            return { ...base, text: "ended their main phase" };
        case "PASS_QUICK_WINDOW":
            return { ...base, text: "passed the quick window" };
        case "CHOICE_RESPONSE": {
            const described = describeChoice(state, action.payload || {});
            return { ...base, text: described.text, cardName: described.cardName };
        }
        case "CONCEDE":
            return { ...base, text: "conceded" };
        default:
            return { ...base, text: `performed ${action.type}` };
    }
}
function appendActionLog(before, player, action, result) {
    if (!result.ok)
        return result;
    const entry = buildActionLogEntry(before, player, action);
    const next = result.state;
    if (!next.actionLog)
        next.actionLog = [];
    next.actionLog.push(entry);
    return result;
}
