"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeEffect = describeEffect;
exports.describeAbility = describeAbility;
const registry_1 = require("../cards/registry");
function describeEffect(effect) {
    switch (effect.op) {
        case "grantOnCardPlayed":
            return "next matching card costs less";
        case "playCostReduction":
            return `reduce play cost by ${effect.amount}`;
        case "choose":
            return "choose an option";
        case "chooseMultiple":
            return "choose options";
        case "summon": {
            const key = effect.tokenName ?? effect.tokenCardNo ?? "";
            const def = (0, registry_1.getCardDef)((0, registry_1.resolveTokenName)(key));
            const label = (def?.name ?? key).replace(/\s+TOKEN$/i, "");
            return `summon ${label}`;
        }
        case "dealDamage":
            return "deal damage";
        case "damageFollowerAndLeader":
            return `deal ${effect.followerAmount} to a follower and ${effect.leaderAmount} to leader`;
        case "draw":
            return `draw ${effect.count}`;
        case "optionalCost":
            return effect.label ?? "optional cost";
        case "sequence":
            return effect.steps.map(describeEffect).join(", then ");
        case "if":
            return describeEffect(effect.then);
        default:
            return effect.op;
    }
}
function describeAbility(sourceCardNo, ability) {
    if (ability.label)
        return ability.label;
    const name = (0, registry_1.getCardDef)(sourceCardNo)?.name ?? sourceCardNo;
    const timingLabel = ability.timing === "onExAreaEntry"
        ? "EX area entry"
        : ability.timing === "fanfare"
            ? "Fanfare"
            : ability.timing === "lastWords"
                ? "Last Words"
                : ability.timing === "onEvolve"
                    ? "On Evolve"
                    : ability.timing === "onSuperEvolve"
                        ? "On Super Evolve"
                        : ability.timing === "startOfEnd"
                            ? "End of turn"
                            : ability.timing === "onDiscard"
                                ? "When discarded"
                                : ability.timing === "onCardPlayed"
                                    ? "When you play a card"
                                    : ability.timing === "onAllyFollowerEnter"
                                        ? "When an ally enters the field"
                                        : ability.timing === "onOpponentDeckToCemetery"
                                            ? "When an opponent mills"
                                            : ability.timing === "onAbilityDamageTaken"
                                                ? "When this takes ability damage"
                                                : ability.timing === "onAbilityDamageDealt"
                                                    ? "When this deals ability damage"
                                                    : ability.timing;
    return `${name} — ${timingLabel}: ${describeEffect(ability.effect)}`;
}
