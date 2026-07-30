import { getCardDef, resolveTokenName } from "../cards/registry";
import { AbilityDefinition, Effect } from "../types";

export function describeEffect(effect: Effect): string {
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
      const def = getCardDef(resolveTokenName(key));
      const label = (def?.name ?? key).replace(/\s+TOKEN$/i, "");
      return `summon ${label}`;
    }    case "dealDamage":
      return "deal damage";
    case "damageFollowerAndLeader":
      return `deal ${effect.followerAmount} to a follower and ${effect.leaderAmount} to leader`;
    case "draw":
      return `draw ${effect.count}`;
    case "sequence":
      return effect.steps.map(describeEffect).join(", then ");
    case "if":
      return describeEffect(effect.then);
    default:
      return effect.op;
  }
}

export function describeAbility(sourceCardNo: string, ability: AbilityDefinition): string {
  if (ability.label) return ability.label;
  const name = getCardDef(sourceCardNo)?.name ?? sourceCardNo;
  const timingLabel =
    ability.timing === "onExAreaEntry"
      ? "EX area entry"
      : ability.timing === "fanfare"
        ? "Fanfare"
        : ability.timing === "lastWords"
          ? "Last Words"
          : ability.timing === "onEvolve"
            ? "On Evolve"
            : ability.timing === "startOfEnd"
              ? "End of turn"
              : ability.timing === "onCardPlayed"
                ? "When you play a card"
                : ability.timing === "onAllyFollowerEnter"
                  ? "When an ally enters the field"
                  : ability.timing === "onOpponentDeckToCemetery"
                    ? "When an opponent mills"
                    : ability.timing === "onAbilityDamageTaken"
                      ? "When this takes ability damage"
                      : ability.timing;
  return `${name} — ${timingLabel}: ${describeEffect(ability.effect)}`;
}
