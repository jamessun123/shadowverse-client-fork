import { CardInstance } from "../types";

/** Reset mutable instance state when a card leaves play (cemetery/banish). */
export function resetCardInstanceState(card: CardInstance): void {
  card.modifiers = [];
  card.grantedKeywords = [];
  card.grantedLastWords = [];
  card.grantedStartOfEnd = [];
  card.grantedOnCardPlayed = [];
  card.playCostReduction = 0;
  card.persistentPlayCostReduction = 0;
  card.abilitiesActivatedThisTurn = [];
  card.engaged = false;
  card.linkedEvoInstanceId = undefined;
  card.evolvedThisTurn = false;
  card.superEvolved = false;
  card.enteredFromHand = undefined;
  card.enteredFromCemetery = undefined;
  card.boxedUntilTurn = undefined;
  card.foughtWithBane = false;
  card.foughtWithInstanceId = undefined;
  card.onFieldSinceTurnStart = false;
  card.counters = {};
  card.persistentCounters = {};
  card.chosenChooseOptionsThisTurn = {};
  card.chosenChooseOptionLabelsThisTurn = {};
  card.equippedInstanceIds = undefined;
  card.equippedToInstanceId = undefined;
  card.skipRefreshNextStart = undefined;
  card.damageDealtBonus = undefined;
  card.damageTakenReduction = undefined;
  card.cannotAttack = undefined;
}
