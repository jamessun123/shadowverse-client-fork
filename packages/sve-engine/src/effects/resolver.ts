import { getCardDef, resolveTokenName } from "../cards/registry";

import { onCardEntersExArea, onFollowerEntersField, queueLastWords } from "../rules/confirmation";

import { runConfirmationTiming } from "../rules/confirmation";
import { describeEffect } from "../rules/trigger-labels";
import {
  contextForTriggerResolution,
  finishDeferredTriggers,
  withChoiceContext,
} from "../rules/effect-utils";

import { cardMatchesFilter, evalCondition } from "../state/conditions";

import { createCardInstance } from "../state/factory";

import {
  clampDamageToFollower,
  findInstance,
  findMatchingEvolveCard,
  getEffectiveStats,
  getPlayer,
  hasKeyword,
  opponentOf,
  resolveCardDefCost,
  resolveCardNo,
} from "../state/queries";
import { resetCardInstanceState } from "../state/card-reset";
import { destroyFollower, drawCard, moveCard, shuffleDeck } from "../state/zones";
import {
  DamageAmount,
  DeckFilter,
  Effect,
  GameState,
  Keyword,
  PlayerId,
  TargetSelector,
} from "../types";

export function appendResumeEffects(state: GameState, effects: Effect[]): GameState {
  if (effects.length === 0) return state;
  const next = structuredClone(state);
  const existing = next.resolutionContext?.resumeAfterChoice ?? [];
  next.resolutionContext = {
    sourceInstanceId: next.resolutionContext?.sourceInstanceId,
    effectStack: next.resolutionContext?.effectStack ?? [],
    resumeAfterChoice: [...existing, ...effects],
    forcedTargetId: next.resolutionContext?.forcedTargetId,
    deferTriggers: true,
  };
  return next;
}

function getTargetCandidates(

  state: GameState,

  player: PlayerId,

  selector: TargetSelector,

): string[] {

  const enemy = opponentOf(player);

  switch (selector.type) {

    case "selfLeader":

      return ["selfLeader"];

    case "enemyLeader":

      return ["leader"];

    case "enemyFollower":

      return getPlayer(state, enemy).zones.field
        .filter((c) => !hasKeyword(c, "aura", state, enemy))
        .map((c) => c.instanceId);

    case "selfFollower":

      return getPlayer(state, player).zones.field

        .filter((c) => c.instanceId !== state.resolutionContext?.sourceInstanceId)

        .map((c) => c.instanceId);

    case "anyFollower":

      return [...getPlayer(state, 0).zones.field, ...getPlayer(state, 1).zones.field]
        .filter((c) => {
          const owner = getPlayer(state, 0).zones.field.some((f) => f.instanceId === c.instanceId)
            ? 0
            : 1;
          const effectEnemy = opponentOf(player);
          if (owner === effectEnemy && hasKeyword(c, "aura", state, owner)) return false;
          return true;
        })
        .map((c) => c.instanceId);

    case "self":

      return state.resolutionContext?.sourceInstanceId

        ? [state.resolutionContext.sourceInstanceId]

        : [];

    default:

      return [];

  }

}

function shouldPromptTargetSelection(
  selector: TargetSelector,
  candidates: string[],
): boolean {
  if (candidates.length === 0) return false;
  if (candidates.length > 1) return true;
  return (
    selector.type === "enemyFollower" ||
    selector.type === "anyFollower" ||
    selector.type === "selfFollower"
  );
}



function dealDamageToFollower(state: GameState, instanceId: string, amount: number): GameState {

  const next = structuredClone(state);

  const found = findInstance(next, instanceId);

  if (!found) return state;

  const dmg = clampDamageToFollower(next, found.card, found.player, amount);

  found.card.modifiers.push({ atk: 0, def: -dmg, sourceId: "effect" });

  const { def } = getEffectiveStats(found.card, next);

  if (def <= 0) {

    queueLastWords(next, instanceId, found.player);

    return destroyFollower(next, instanceId);

  }

  return next;

}



function resolveDamageAmount(state: GameState, player: PlayerId, amount: DamageAmount): number {
  if (typeof amount === "number") return amount;
  if (amount.op === "otherFieldTraitCount") {
    const sourceId = state.resolutionContext?.sourceInstanceId;
    return getPlayer(state, player).zones.field.filter((c) => {
      if (c.instanceId === sourceId) return false;
      const def = getCardDef(c.name);
      return def?.traits?.includes(amount.trait);
    }).length;
  }
  if (amount.op === "fieldTraitCount") {
    return getPlayer(state, player).zones.field.filter((c) => {
      const def = getCardDef(c.name);
      return def?.traits?.includes(amount.trait);
    }).length;
  }
  return 0;
}

function promptSelectZoneCards(
  state: GameState,
  player: PlayerId,
  fromZone: "cemetery" | "hand" | "exArea" | "field",
  count: number,
  action: "banish" | "discard" | "bury",
  matches: { instanceId: string; name: string }[],
  resumeActivate?: {
    sourceInstanceId: string;
    zone: "field" | "cemetery" | "exArea" | "hand";
    abilityKey: string;
  },
): GameState {
  const next = structuredClone(state);
  next.pendingChoices = withChoiceContext(next, {
    type: "selectZoneCards",
    player,
    fromZone,
    count,
    action,
    resumeActivate,
    reasonLabel: `${action} ${count} card(s)`,
    options: zoneCardOptions(matches),
  });
  return next;
}

function dealDamageToLeader(state: GameState, player: PlayerId, amount: number): GameState {

  const next = structuredClone(state);

  next.players[player].leaderDef -= amount;

  next.players[player].flags.leaderLostDefThisTurn = true;

  return next;

}



function labelForInstance(state: GameState, id: string): string {

  if (id === "leader") return "Enemy Leader";

  if (id === "selfLeader") return "Your Leader";

  const found = findInstance(state, id);

  if (!found) return id.slice(0, 8);

  const def = getCardDef(found.card.name);

  const name = def?.name || found.card.name;

  const { atk, def: defense } = getEffectiveStats(found.card, state);

  return `${name} (${atk}/${defense})`;

}



function promptSelectTarget(

  state: GameState,

  player: PlayerId,

  effect: Effect,

  candidates: string[],

): GameState {

  const next = structuredClone(state);

  next.pendingChoices = withChoiceContext(next, {
    type: "selectTarget",
    player,
    effect,
    reasonLabel: describeEffect(effect),
    candidates: candidates.map((instanceId) => {
      const found = findInstance(next, instanceId);
      return {
        instanceId,
        label: labelForInstance(next, instanceId),
        name: found?.card.name,
      };
    }),
  });

  return next;

}



function zoneCardOptions(cards: { instanceId: string; name: string }[]) {

  return cards.map((c) => ({

    instanceId: c.instanceId,

    label: getCardDef(c.name)?.name || c.name,

    name: c.name,

  }));

}



function promptSelectZoneCard(

  state: GameState,

  player: PlayerId,

  fromZone: "deck" | "cemetery" | "hand" | "evolveDeck",

  to: "hand" | "exArea" | "field",

  matches: { instanceId: string; name: string }[],

  optional?: boolean,

  playCostReduction?: number,

  reveal?: boolean,

): GameState {

  const next = structuredClone(state);

  next.pendingChoices = withChoiceContext(next, {
    type: "selectZoneCard",
    player,
    fromZone,
    to,
    optional,
    playCostReduction,
    reveal,
    options: zoneCardOptions(matches),
  });

  return next;

}



function promptSearchDeckTop(

  state: GameState,

  player: PlayerId,

  top: { instanceId: string; name: string }[],

  filter: DeckFilter,

  to: "hand" | "exArea" | "field",

  optional?: boolean,

  playCostReduction?: number,

  remainderTo: "cemetery" | "deckBottom" = "cemetery",

  reveal?: boolean,

): GameState {

  const next = structuredClone(state);

  next.pendingChoices = withChoiceContext(next, {
    type: "searchDeckTop",
    player,
    to,
    filter,
    topInstanceIds: top.map((c) => c.instanceId),
    optional,
    playCostReduction,
    remainderTo,
    reveal,
    reasonLabel: "Search deck",
    options: top.map((c) => ({
      instanceId: c.instanceId,
      label: getCardDef(c.name)?.name || c.name,
      name: c.name,
      eligible: cardMatchesFilter(c.name, filter),
    })),
  });

  return next;

}

function promptSelectDeckSummon(
  state: GameState,
  player: PlayerId,
  top: { instanceId: string; name: string }[],
  filter: DeckFilter,
  maxTotalCost: number,
  remainderTo: "cemetery" | "deckBottom",
): GameState {
  const next = structuredClone(state);
  next.pendingChoices = withChoiceContext(next, {
    type: "selectDeckSummon",
    player,
    maxTotalCost,
    filter,
    topInstanceIds: top.map((c) => c.instanceId),
    remainderTo,
    reasonLabel: "Summon followers from deck",
    options: top.map((c) => ({
      instanceId: c.instanceId,
      label: getCardDef(c.name)?.name || c.name,
      name: c.name,
      cost: resolveCardDefCost(c.name),
      eligible: cardMatchesFilter(c.name, filter),
    })),
  });
  return next;
}

export function buryDeckCards(state: GameState, player: PlayerId, instanceIds: string[]): GameState {

  let next = structuredClone(state);

  const p = next.players[player];

  for (const id of instanceIds) {

    const idx = p.zones.deck.findIndex((c) => c.instanceId === id);

    if (idx < 0) continue;

    const [card] = p.zones.deck.splice(idx, 1);

    p.zones.cemetery.push(card);

    next.eventLog.push({ type: "bury", player });

  }

  return next;

}



export function moveZoneCardTo(

  state: GameState,

  player: PlayerId,

  instanceId: string,

  fromZone: "deck" | "cemetery" | "hand" | "evolveDeck",

  to: "hand" | "exArea" | "field",

): GameState {

  let next = structuredClone(state);

  const p = next.players[player];

  const list = p.zones[fromZone];

  const idx = list.findIndex((c) => c.instanceId === instanceId);

  if (idx < 0) return state;

  const [card] = list.splice(idx, 1);

  if (to === "hand") {

    p.zones.hand.push(card);

  } else if (to === "exArea" && p.zones.exArea.length < p.exLimit) {

    p.zones.exArea.push(card);

    onCardEntersExArea(next, card.instanceId, player);

  } else if (to === "field") {

    if (p.zones.field.length >= p.fieldLimit) {
      list.push(card);
    } else {
      p.zones.field.push(card);
      if (fromZone === "cemetery") {
        card.enteredFromCemetery = true;
        card.enteredFromHand = false;
      } else if (fromZone === "hand") {
        card.enteredFromHand = true;
        card.enteredFromCemetery = false;
      } else {
        card.enteredFromHand = false;
        card.enteredFromCemetery = false;
      }
      onFollowerEntersField(next, card.instanceId, player);
    }

  } else {

    list.push(card);

  }

  if (fromZone === "deck") return shuffleDeck(next, player);

  return next;

}



function applyGrantKeyword(

  state: GameState,

  player: PlayerId,

  keyword: Keyword,

  targets: TargetSelector,

): GameState {

  const next = structuredClone(state);

  const candidates = getTargetCandidates(next, player, targets);

  if (candidates.length === 0) return state;

  const found = findInstance(next, candidates[0]);

  if (!found) return state;

  if (!found.card.grantedKeywords.includes(keyword)) {

    found.card.grantedKeywords.push(keyword);

  }

  return next;

}



function canSatisfyOptionalCost(state: GameState, player: PlayerId, effect: Effect): boolean {
  switch (effect.op) {
    case "discardFromHand": {
      const need = effect.count ?? 1;
      const matches = getPlayer(state, player).zones.hand.filter((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
      return matches.length >= need;
    }
    case "selectFromHand":
      return getPlayer(state, player).zones.hand.some((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
    case "banishFromExArea": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.exArea.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
    }
    case "banishFromCemetery": {
      const need = effect.count ?? 1;
      return (
        getPlayer(state, player).zones.cemetery.filter((c) =>
          cardMatchesFilter(c.name, effect.filter),
        ).length >= need
      );
    }
    case "spendPp":
      return getPlayer(state, player).pp >= effect.amount;
    case "burySelf": {
      const sourceId = state.resolutionContext?.sourceInstanceId;
      if (!sourceId) return false;
      const found = findInstance(state, sourceId);
      return Boolean(found && found.zone === "field" && found.player === player);
    }
    case "sequence":
      return effect.steps.every((step) => canSatisfyOptionalCost(state, player, step));
    default:
      return true;
  }
}

export type ResolveEffectOptions = {
  deferConfirmation?: boolean;
};

export function resolveEffect(
  state: GameState,
  effect: Effect,
  player: PlayerId,
  options?: ResolveEffectOptions,
): GameState {

  let next = structuredClone(state);

  if (options?.deferConfirmation) {
    next.resolutionContext = {
      sourceInstanceId: next.resolutionContext?.sourceInstanceId,
      effectStack: next.resolutionContext?.effectStack ?? [],
      resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
      forcedTargetId: next.resolutionContext?.forcedTargetId,
      buriedCosts: next.resolutionContext?.buriedCosts,
      lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
      deferTriggers: true,
    };
  }

  switch (effect.op) {

    case "draw":

      for (let i = 0; i < effect.count; i++) {

        next = drawCard(next, player);

      }

      break;



    case "recoverPp": {

      const p = next.players[player];

      p.pp = Math.min(p.pp + effect.amount, p.maxPp);

      break;

    }

    case "spendPp": {
      const p = next.players[player];
      p.pp = Math.max(0, p.pp - effect.amount);
      break;
    }

    case "rollDie": {
      const roll = Math.floor(Math.random() * effect.sides) + 1;
      next.eventLog.push({ type: "diceRoll", player, data: { roll } });
      const outcome = effect.outcomes.find((o) => o.on.includes(roll));
      if (outcome) {
        next = resolveEffect(next, outcome.effect, player, options);
        if (next.pendingChoices) return next;
      }
      break;
    }

    case "buryOpponentMaxAttackFollower": {
      for (const opp of [opponentOf(player)] as PlayerId[]) {
        const field = getPlayer(next, opp).zones.field;
        if (field.length === 0) continue;
        let best = field[0];
        let bestAtk = getEffectiveStats(best, next).atk;
        for (const card of field.slice(1)) {
          const atk = getEffectiveStats(card, next).atk;
          if (atk > bestAtk) {
            best = card;
            bestAtk = atk;
          }
        }
        const p = next.players[opp];
        const idx = p.zones.field.findIndex((c) => c.instanceId === best.instanceId);
        if (idx < 0) continue;
        const [buried] = p.zones.field.splice(idx, 1);
        resetCardInstanceState(buried);
        p.zones.cemetery.push(buried);
        next.eventLog.push({ type: "bury", player: opp });
      }
      break;
    }



    case "healLeader":

      next.players[player].leaderDef += effect.amount;

      break;



    case "dealDamage": {
      const forced = next.resolutionContext?.forcedTargetId;
      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId: string;

      if (forced) {

        if (!candidates.includes(forced)) break;

        targetId = forced;

      } else if (
        shouldPromptTargetSelection(effect.targets, candidates) &&
        !next.pendingChoices
      ) {

        return promptSelectTarget(next, player, effect, candidates);

      } else {

        targetId = candidates[0];

      }

      const damage = resolveDamageAmount(next, player, effect.amount);

      if (targetId === "leader") {

        next = dealDamageToLeader(next, opponentOf(player), damage);

      } else if (targetId === "selfLeader") {

        next = dealDamageToLeader(next, player, damage);

      } else {

        next = dealDamageToFollower(next, targetId, damage);

      }

      break;

    }



    case "buffFieldTrait": {
      const p = next.players[player];
      const sourceId = next.resolutionContext?.sourceInstanceId || "effect";
      for (const card of p.zones.field) {
        if (effect.excludeSelf && card.instanceId === sourceId) continue;
        const def = getCardDef(card.name);
        if (!def?.traits?.includes(effect.trait)) continue;
        card.modifiers.push({ atk: effect.atk ?? 0, def: effect.def ?? 0, sourceId });
        if (effect.keyword && !card.grantedKeywords.includes(effect.keyword)) {
          card.grantedKeywords.push(effect.keyword);
        }
      }
      break;
    }

    case "buff": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId: string;

      if (forced) {

        if (!candidates.includes(forced)) break;

        targetId = forced;

      } else if (
        shouldPromptTargetSelection(effect.targets, candidates) &&
        !next.pendingChoices
      ) {

        return promptSelectTarget(next, player, effect, candidates);

      } else {

        targetId = candidates[0];

      }

      const found = findInstance(next, targetId);

      if (found) {

        found.card.modifiers.push({

          atk: effect.atk ?? 0,

          def: effect.def ?? 0,

          sourceId: next.resolutionContext?.sourceInstanceId || "effect",

        });

      }

      break;

    }



    case "grantKeyword":

      next = applyGrantKeyword(next, player, effect.keyword, effect.targets);

      break;



    case "destroy": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId: string;

      if (forced) {

        if (!candidates.includes(forced)) break;

        targetId = forced;

      } else if (
        shouldPromptTargetSelection(effect.targets, candidates) &&
        !next.pendingChoices
      ) {

        return promptSelectTarget(next, player, effect, candidates);

      } else {

        targetId = candidates[0];

      }

      queueLastWords(next, targetId, player);

      next = destroyFollower(next, targetId);

      break;

    }



    case "summon": {

      const p = next.players[player];

      const zone = effect.zone === "exArea" ? p.zones.exArea : p.zones.field;

      const limit = effect.zone === "exArea" ? p.exLimit : p.fieldLimit;

      for (let i = 0; i < effect.count && zone.length < limit; i++) {
        const tokenKey = effect.tokenName ?? effect.tokenCardNo;
        if (!tokenKey) break;
        const token = createCardInstance(resolveTokenName(tokenKey), player, player);
        if (!getCardDef(token.name)) break;
        zone.push(token);

        if (effect.zone === "field") {

          onFollowerEntersField(next, token.instanceId, player);

        } else {

          onCardEntersExArea(next, token.instanceId, player);

        }

      }

      break;

    }



    case "discard": {

      const hand = next.players[player].zones.hand;

      const toDiscard = Math.min(effect.count, hand.length);

      if (toDiscard <= 0) break;

      if (toDiscard > 0 && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "hand", toDiscard, "discard", hand);

      }

      for (let i = 0; i < toDiscard; i++) {

        const card = hand.pop()!;

        next.players[player].zones.cemetery.push(card);

      }

      break;

    }



    case "if":

      if (evalCondition(next, player, effect.condition)) {

        next = resolveEffect(next, effect.then, player);

      } else if (effect.else) {

        next = resolveEffect(next, effect.else, player);

      }

      break;



    case "noop":
      break;

    case "optionalCost": {
      if (!canSatisfyOptionalCost(next, player, effect.cost)) break;
      if (!next.pendingChoices) {
        next.pendingChoices = withChoiceContext(next, {
          type: "choose",
          player,
          min: 1,
          max: 1,
          reasonLabel: effect.label ?? "Optional effect",
          options: [
            {
              index: 0,
              label: effect.label ?? "Pay cost",
              effect: { op: "sequence", steps: [effect.cost, effect.then] },
            },
            { index: 1, label: "Skip", effect: { op: "noop" } },
          ],
        });
        return next;
      }
      break;
    }

    case "sequence": {
      next.resolutionContext = {
        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
        effectStack: next.resolutionContext?.effectStack ?? [],
        resumeAfterChoice: next.resolutionContext?.resumeAfterChoice,
        forcedTargetId: next.resolutionContext?.forcedTargetId,
        buriedCosts: next.resolutionContext?.buriedCosts,
        lastDiscardedCardName: next.resolutionContext?.lastDiscardedCardName,
        deferTriggers: true,
      };
      for (let i = 0; i < effect.steps.length; i++) {
        next = resolveEffect(next, effect.steps[i], player, { deferConfirmation: true });
        if (next.pendingChoices) {
          return appendResumeEffects(next, effect.steps.slice(i + 1));
        }
      }
      break;
    }



    case "choose":

      if (!next.pendingChoices) {

        const affordableOptions = effect.options
          .map((o, i) => ({
            index: i,
            label: o.label,
            effect: o.effect,
            additionalPpCost: o.additionalPpCost,
          }))
          .filter(
            (o) =>
              (!o.additionalPpCost || next.players[player].pp >= o.additionalPpCost) &&
              canEffectResolve(next, player, o.effect),
          );
        if (affordableOptions.length === 0) break;
        next.pendingChoices = withChoiceContext(next, {
          type: "choose",
          player,
          reasonLabel: "Choose an option",
          options: affordableOptions,
          min: effect.min,
          max: effect.max,
        });

        return next;

      }

      break;



    case "chooseMultiple":

      if (!next.pendingChoices) {

        next.pendingChoices = withChoiceContext(next, {
          type: "chooseMultiple",
          player,
          reasonLabel: "Choose effects and order",
          options: effect.options.map((o, i) => ({
            index: i,
            label: o.label,
            effect: o.effect,
          })),
          min: effect.min,
          max: effect.max,
        });

        return next;

      }

      break;



    case "mill": {

      const deck = next.players[player].zones.deck;

      for (let i = 0; i < effect.count && deck.length > 0; i++) {

        const [card] = deck.splice(0, 1);

        next.players[player].zones.cemetery.push(card);

        next.eventLog.push({ type: "bury", player });

      }

      if (deck.length === 0 && effect.count > 0) {

        next.eventLog.push({ type: "deckOut", player });

      }

      break;

    }



    case "millOpponent": {

      const opp = opponentOf(player);

      const deck = next.players[opp].zones.deck;

      for (let i = 0; i < effect.count && deck.length > 0; i++) {

        const [card] = deck.splice(0, 1);

        next.players[opp].zones.cemetery.push(card);

      }

      break;

    }



    case "damageFollowerAndLeader": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, { type: "enemyFollower" });

      if (candidates.length === 0) break;

      let targetId: string;

      if (forced) {

        if (!candidates.includes(forced)) break;

        targetId = forced;

      } else if (
        shouldPromptTargetSelection({ type: "enemyFollower", count: 1 }, candidates) &&
        !next.pendingChoices
      ) {

        return promptSelectTarget(next, player, effect, candidates);

      } else {

        targetId = candidates[0];

      }

      next = dealDamageToFollower(next, targetId, effect.followerAmount);

      next = dealDamageToLeader(next, opponentOf(player), effect.leaderAmount);

      break;

    }



    case "tutorFromCemetery": {

      const p = next.players[player];

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "cemetery",
          effect.to,
          matches,
          undefined,
          effect.playCostReduction,
          effect.reveal,
        );

      }

      break;

    }



    case "autoEvolveIf": {

      if (!evalCondition(next, player, effect.condition)) break;

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const fieldFound = findInstance(next, sourceId);

      if (!fieldFound || fieldFound.zone !== "field" || fieldFound.card.linkedEvoInstanceId) break;

      const evoCard = findMatchingEvolveCard(next, player, sourceId);

      if (!evoCard) break;

      const evoFound = findInstance(next, evoCard.instanceId);

      if (!evoFound || evoFound.zone !== "evolveDeck") break;

      next = moveCard(next, evoCard.instanceId, "resolutionZone", player);

      const fieldOnNext = findInstance(next, sourceId);
      if (!fieldOnNext || fieldOnNext.zone !== "field") break;

      fieldOnNext.card.linkedEvoInstanceId = evoCard.instanceId;

      fieldOnNext.card.evolvedThisTurn = true;

      fieldOnNext.card.onFieldSinceTurnStart = false;

      next.players[player].flags.evolvedThisTurn = true;

      next.players[player].zones.evolveZone.push({

        fieldInstanceId: sourceId,

        evolveInstanceId: evoCard.instanceId,

      });

      if (effect.triggerOnEvolve === true) {
        const evoDef = getCardDef(evoFound.card.name);
        for (const ability of evoDef?.abilities?.filter((a) => a.timing === "onEvolve") ?? []) {
          next.resolutionContext = contextForTriggerResolution(next, sourceId, ability.effect);
          next = resolveEffect(next, ability.effect, player);
          if (next.pendingChoices || (next.resolutionContext?.resumeAfterChoice?.length ?? 0) > 0) {
            return next;
          }
          next.resolutionContext = null;
        }
      }

      break;

    }



    case "tutorFromDeck": {

      const p = next.players[player];

      const matches = p.zones.deck.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "deck",
          effect.to,
          matches,
          undefined,
          effect.playCostReduction,
          effect.reveal,
        );

      }

      break;

    }



    case "searchDeckChoose": {

      const p = next.players[player];

      const top = p.zones.deck.slice(0, effect.lookAt);

      if (top.length === 0) break;

      if (!next.pendingChoices) {

        return promptSearchDeckTop(
          next,
          player,
          top,
          effect.filter,
          effect.to,
          effect.optional,
          effect.playCostReduction,
          effect.remainderTo ?? "cemetery",
          effect.reveal,
        );

      }

      break;

    }



    case "engage": {

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId = candidates[0];

      if (candidates.length >= 1 && !next.pendingChoices) {

        return promptSelectTarget(next, player, effect, candidates);

      }

      const found = findInstance(next, targetId);

      if (found) found.card.engaged = true;

      break;

    }



    case "box": {

      const forced = next.resolutionContext?.forcedTargetId;

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      let targetId: string;

      if (forced) {

        if (!candidates.includes(forced)) break;

        targetId = forced;

      } else if (candidates.length >= 1 && !next.pendingChoices) {

        return promptSelectTarget(next, player, effect, candidates);

      } else {

        targetId = candidates[0];

      }

      const found = findInstance(next, targetId);

      if (found) {

        found.card.engaged = true;

        found.card.boxedUntilTurn = next.turnNumber + 2;

      }

      break;

    }



    case "grantPlayCostReduction": {

      const candidates = getTargetCandidates(next, player, effect.targets);

      if (candidates.length === 0) break;

      const targetId = candidates[0];

      const found = findInstance(next, targetId);

      if (found) found.card.persistentPlayCostReduction += effect.amount;

      break;

    }



    case "banishFromCemetery": {

      const p = next.players[player];

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      const toBanish = Math.min(effect.count, matches.length);

      if (toBanish <= 0) break;

      if (matches.length >= toBanish && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "cemetery", toBanish, "banish", matches);

      }

      for (let i = 0; i < toBanish; i++) {

        const idx = p.zones.cemetery.findIndex((c) => cardMatchesFilter(c.name, effect.filter));

        if (idx < 0) break;

        const [card] = p.zones.cemetery.splice(idx, 1);

        p.zones.banish.push(card);

      }

      break;

    }



    case "banishFromExArea": {

      const p = next.players[player];

      for (let i = 0; i < effect.count; i++) {

        const idx = p.zones.exArea.findIndex((c) => cardMatchesFilter(c.name, effect.filter));

        if (idx < 0) break;

        const [card] = p.zones.exArea.splice(idx, 1);

        p.zones.banish.push(card);

      }

      break;

    }



    case "reviveSelfFromCemetery": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const p = next.players[player];

      const idx = p.zones.cemetery.findIndex((c) => c.instanceId === sourceId);

      if (idx < 0 || p.zones.field.length >= p.fieldLimit) break;

      const [card] = p.zones.cemetery.splice(idx, 1);

      p.zones.field.push(card);

      onFollowerEntersField(next, card.instanceId, player);

      break;

    }



    case "moveSourceToExArea": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const p = next.players[player];

      if (p.zones.exArea.length >= p.exLimit) break;

      let fromZone: "cemetery" | "hand" | null = null;

      let idx = p.zones.cemetery.findIndex((c) => c.instanceId === sourceId);

      if (idx >= 0) fromZone = "cemetery";

      if (fromZone === null) {

        idx = p.zones.hand.findIndex((c) => c.instanceId === sourceId);

        if (idx >= 0) fromZone = "hand";

      }

      if (fromZone === null || idx < 0) break;

      const [card] = p.zones[fromZone].splice(idx, 1);

      p.zones.exArea.push(card);

      onCardEntersExArea(next, card.instanceId, player);

      break;

    }



    case "selectFromHand": {

      const p = next.players[player];

      const matches = p.zones.hand.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) {

        if (effect.optional) break;

        return next;

      }

      if (!next.pendingChoices) {

        return promptSelectZoneCard(
          next,
          player,
          "hand",
          effect.to,
          matches,
          effect.optional,
          effect.playCostReduction,
        );

      }

      break;

    }



    case "discardFromHand": {

      const p = next.players[player];

      const matches = p.zones.hand.filter((c) => cardMatchesFilter(c.name, effect.filter));

      const toDiscard = Math.min(effect.count, matches.length);

      if (toDiscard <= 0) break;

      if (toDiscard > 0 && !next.pendingChoices) {

        return promptSelectZoneCards(next, player, "hand", toDiscard, "discard", matches);

      }

      let remaining = toDiscard;

      for (let i = p.zones.hand.length - 1; i >= 0 && remaining > 0; i--) {

        const card = p.zones.hand[i];

        if (!cardMatchesFilter(card.name, effect.filter)) continue;

        p.zones.hand.splice(i, 1);

        p.zones.cemetery.push(card);

        next.resolutionContext = {
          ...next.resolutionContext,
          sourceInstanceId: next.resolutionContext?.sourceInstanceId,
          effectStack: next.resolutionContext?.effectStack ?? [],
          lastDiscardedCardName: card.name,
        };

        remaining--;

      }

      break;

    }



    case "triggerAbilities": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const found = findInstance(next, sourceId);

      if (!found) break;

      const def = getCardDef(resolveCardNo(next, found.card));

      const abilities = def?.abilities?.filter((a) => a.timing === effect.timing) ?? [];

      for (const ability of abilities) {

        next = resolveEffect(next, ability.effect, player);

        if (next.pendingChoices) return next;

      }

      break;

    }



    case "banishSelf": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      if (!sourceId) break;

      const found = findInstance(next, sourceId);

      if (!found) break;

      const p = next.players[found.player];

      const zoneKey = found.zone as keyof typeof p.zones;

      const list = p.zones[zoneKey] as typeof p.zones.hand;

      const idx = list.findIndex((c) => c.instanceId === sourceId);

      if (idx < 0) break;

      const [card] = list.splice(idx, 1);

      resetCardInstanceState(card);

      p.zones.banish.push(card);

      break;

    }

    case "burySelf": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      if (!sourceId) break;
      const found = findInstance(next, sourceId);
      if (!found || found.zone !== "field") break;
      queueLastWords(next, sourceId, found.player);
      next = destroyFollower(next, sourceId);
      break;
    }

    case "grantLastWords": {

      const sourceId = next.resolutionContext?.sourceInstanceId;

      const found = sourceId ? findInstance(next, sourceId) : null;

      if (!found) break;

      if (!found.card.grantedLastWords) found.card.grantedLastWords = [];

      found.card.grantedLastWords.push(effect.effect);

      break;

    }



    case "putHandCardOnDeck": {

      const hand = next.players[player].zones.hand;

      if (hand.length === 0) break;

      if (!next.pendingChoices) {

        const pick = structuredClone(next);

        pick.pendingChoices = withChoiceContext(pick, {
          type: "putHandOnDeck",
          player,
          phase: "selectCard",
          position: effect.position,
          reasonLabel: "Put a hand card on your deck",
          options: hand.map((c) => ({
            instanceId: c.instanceId,
            name: c.name,
            label: getCardDef(c.name)?.name || c.name,
          })),
        });

        return pick;

      }

      break;

    }



    case "summonFromEvolveDeck": {

      const p = next.players[player];

      if (p.zones.field.length >= p.fieldLimit) break;

      const filter = effect.filter ?? {};

      const matches = p.zones.evolveDeck.filter((c) => cardMatchesFilter(c.name, filter));

      if (matches.length === 0) break;

      if (!next.pendingChoices) {
        if (matches.length === 1) {
          next = moveZoneCardTo(next, player, matches[0].instanceId, "evolveDeck", "field");
          break;
        }
        return promptSelectZoneCard(next, player, "evolveDeck", "field", matches);
      }

      break;

    }



    case "summonFromCemetery": {

      const p = next.players[player];

      const slots = p.fieldLimit - p.zones.field.length;

      if (slots <= 0) break;

      const toSummon = Math.min(effect.count, slots);

      const matches = p.zones.cemetery.filter((c) => cardMatchesFilter(c.name, effect.filter));

      if (matches.length === 0) break;

      if (effect.maxTotalCost != null) {

        if (!next.pendingChoices) {

          const pick = structuredClone(next);

          pick.pendingChoices = {

            type: "selectCemeterySummon",

            player,

            count: toSummon,

            maxTotalCost: effect.maxTotalCost,

            filter: effect.filter,

            options: matches.map((c) => ({

              instanceId: c.instanceId,

              name: c.name,

              label: getCardDef(c.name)?.name || c.name,

              cost: resolveCardDefCost(c.name),

            })),

          };

          return pick;

        }

        break;

      }

      let summoned = 0;

      for (const card of [...matches]) {

        if (summoned >= toSummon || p.zones.field.length >= p.fieldLimit) break;

        const idx = p.zones.cemetery.findIndex((c) => c.instanceId === card.instanceId);

        if (idx < 0) continue;

        const [picked] = p.zones.cemetery.splice(idx, 1);

        p.zones.field.push(picked);

        onFollowerEntersField(next, picked.instanceId, player);

        summoned++;

      }

      break;

    }



    case "searchDeckSummonMultiple": {
      const p = next.players[player];
      const top = p.zones.deck.slice(0, effect.lookAt);
      if (top.length === 0) break;
      if (!next.pendingChoices) {
        return promptSelectDeckSummon(
          next,
          player,
          top,
          effect.filter,
          effect.maxTotalCost,
          effect.remainderTo ?? "deckBottom",
        );
      }
      break;
    }

    case "buryFieldFollowers": {
      const p = next.players[player];
      const sourceId = next.resolutionContext?.sourceInstanceId;
      const buriedCosts: number[] = [];
      let toBury;
      if (effect.sourceOnly && sourceId) {
        const source = findInstance(next, sourceId);
        toBury = source?.zone === "field" ? [source.card] : [];
      } else {
        toBury = p.zones.field.filter((card) => {
          if (effect.excludeSelf && card.instanceId === sourceId) return false;
          const cardNo = resolveCardNo(next, card);
          if (effect.filter && !cardMatchesFilter(cardNo, effect.filter)) return false;
          if (effect.minCost != null && resolveCardDefCost(cardNo) < effect.minCost) {
            return false;
          }
          return true;
        });
      }
      for (const card of toBury) {
        buriedCosts.push(resolveCardDefCost(resolveCardNo(next, card)));
        queueLastWords(next, card.instanceId, player);
        next = destroyFollower(next, card.instanceId);
      }
      next.resolutionContext = {
        ...next.resolutionContext,
        sourceInstanceId: next.resolutionContext?.sourceInstanceId,
        effectStack: next.resolutionContext?.effectStack ?? [],
        buriedCosts,
      };
      break;
    }

    case "dealDamageAllEnemies": {
      const opp = opponentOf(player);
      if (!effect.followersOnly) {
        next = dealDamageToLeader(next, opp, effect.amount);
      }
      for (const card of [...next.players[opp].zones.field]) {
        next = dealDamageToFollower(next, card.instanceId, effect.amount);
      }
      break;
    }

    case "grantOnCardPlayed": {
      const sourceId = next.resolutionContext?.sourceInstanceId;
      const found = sourceId ? findInstance(next, sourceId) : null;
      if (!found) break;
      if (!found.card.grantedOnCardPlayed) found.card.grantedOnCardPlayed = [];
      found.card.grantedOnCardPlayed.push({
        filter: effect.filter,
        effect: effect.effect,
        untilEndOfTurn: effect.untilEndOfTurn,
        oncePerTurn: effect.oncePerTurn,
        maxPerTurn: effect.maxPerTurn,
        label: effect.label,
      });
      break;
    }

    case "passiveKeywords":

    case "auraGrantKeyword":

    case "damageCap":

      break;

  }



  if (options?.deferConfirmation) {
    return next;
  }

  next = finishDeferredTriggers(next);
  return runConfirmationTiming(next);

}



export function canEffectResolve(state: GameState, player: PlayerId, effect: Effect): boolean {
  switch (effect.op) {
    case "buff":
    case "dealDamage":
    case "engage":
    case "box":
    case "destroy":
      return getTargetCandidates(state, player, effect.targets).length > 0;
    case "sequence":
      return effect.steps.every((step) => canEffectResolve(state, player, step));
    case "if":
      return canEffectResolve(state, player, effect.then);
    case "optionalCost":
      return canEffectResolve(state, player, effect.then);
    case "choose":
    case "chooseMultiple":
      return effect.options.some(
        (o) =>
          (!o.additionalPpCost || state.players[player].pp >= o.additionalPpCost) &&
          canEffectResolve(state, player, o.effect),
      );
    case "tutorFromCemetery": {
      return getPlayer(state, player).zones.cemetery.some((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
    }
    case "discardFromHand": {
      const need = effect.count ?? 1;
      const matches = getPlayer(state, player).zones.hand.filter((c) =>
        cardMatchesFilter(c.name, effect.filter),
      );
      return matches.length >= need;
    }
    default:
      return true;
  }
}

export function canPlayCardFromZones(
  state: GameState,
  player: PlayerId,
  cardNo: string,
): boolean {
  const def = getCardDef(cardNo);
  if (!def) return false;
  if (def.cardType === "spell") {
    const spell = def.abilities?.find((a) => a.timing === "spell");
    if (!spell) return false;
    if (spell.condition && !evalCondition(state, player, spell.condition)) return false;
    return canEffectResolve(state, player, spell.effect);
  }
  return true;
}

export function resolveSpell(state: GameState, cardNo: string, player: PlayerId): GameState {

  const def = getCardDef(cardNo);

  const spell = def?.abilities?.find((a) => a.timing === "spell");

  if (!spell) return state;

  return resolveEffect(state, spell.effect, player);

}


