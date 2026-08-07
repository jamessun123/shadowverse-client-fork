import { applyAction } from "../actions/applyAction";
import { getCardDef } from "../cards/registry";
import { canPlayCardFromZones } from "../effects/resolver";
import { AbilityDefinition, GameState, Keyword, PlayerId, PlayerView } from "../types";
import { isAdvanceAbility } from "../rules/effect-utils";
import { describeEffect } from "../rules/trigger-labels";
import {
  canEvolveFollower,
  canSuperEvolveNow,
  computeEvolvePayment,
  findMatchingEvolveCard,
  getActivatedAbilities,
  getEffectivePlayCost,
  getEffectiveEvolveCost,
  isBoxed,
  getLegalAttackTargets,
  hasKeyword,
  opponentOf,
  resolveCardNo,
} from "../state/queries";

function activateLabel(ability: AbilityDefinition): string {
  if (ability.label) return ability.label;
  const costBits: string[] = [];
  if ((ability.cost?.pp ?? 0) > 0) costBits.push(`${ability.cost!.pp} PP`);
  if (ability.cost?.engage) costBits.push("engage");
  if (ability.cost?.banishFromCemetery) costBits.push("banish from cemetery");
  if (ability.cost?.banishFromExArea) costBits.push("banish from EX");
  if (ability.cost?.fuse) {
    const n = ability.cost.fuse.count ?? 1;
    costBits.push(`fuse ${n}`);
  }
  if (ability.cost?.burySelf) costBits.push("bury this");
  const effect = describeEffect(ability.effect);
  const costSuffix = costBits.length ? ` (${costBits.join(", ")})` : "";
  return `Activate${costSuffix}: ${effect}`;
}

function pushActivateOptions(
  legalActions: string[],
  activateOptions: PlayerView["activateOptions"],
  state: GameState,
  player: PlayerId,
  instanceId: string,
  zone: "field" | "cemetery" | "exArea" | "hand",
  card: GameState["players"][0]["zones"]["field"][0],
  pp: number,
  evoPoints: number,
): void {
  const activated = getActivatedAbilities(state, card, player, zone);
  if (activated.length === 0) return;
  const def = getCardDef(resolveCardNo(state, card));
  for (const { ability, key } of activated) {
    const cost = ability.cost?.pp ?? 0;
    const advance = isAdvanceAbility(def, ability);
    const ppPay = computeEvolvePayment(cost, pp, evoPoints, false);
    const epPay = computeEvolvePayment(cost, pp, evoPoints, true);
    const label = activateLabel(ability);
    if (ppPay.ok) {
      const actionPrefix =
        zone === "field"
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
  if (zone === "field" && activated.some((a) => computeEvolvePayment(a.ability.cost?.pp ?? 0, pp, evoPoints, false).ok)) {
    legalActions.push(`ACTIVATE:${instanceId}`);
  }
  if (zone === "cemetery") legalActions.push(`ACTIVATE_CEMETERY:${instanceId}`);
  if (zone === "exArea") legalActions.push(`ACTIVATE_EXAREA:${instanceId}`);
  if (zone === "hand" && activated.some((a) => computeEvolvePayment(a.ability.cost?.pp ?? 0, pp, evoPoints, false).ok)) {
    legalActions.push(`ACTIVATE_HAND:${instanceId}`);
  }
}

export function createPlayerView(state: GameState, self: PlayerId): PlayerView {
  const opponent = opponentOf(self);
  const view = structuredClone(state);

  view.players[opponent].zones.hand = view.players[opponent].zones.hand.map((c) => ({
    ...c,
    name: "HIDDEN",
  }));
  view.players[self].zones.evolveDeck = view.players[self].zones.evolveDeck;
  // Used evolve cards are public information (face-up in the evolve area).
  view.players[opponent].zones.evolveDeck = view.players[opponent].zones.evolveDeck.map((c) =>
    c.evolveUsed
      ? c
      : {
          ...c,
          name: "HIDDEN",
        },
  );
  view.players[opponent].zones.deck = view.players[opponent].zones.deck.map((c) => ({
    ...c,
    name: "HIDDEN",
  }));

  const legalActions: string[] = [];
  const activateOptions: PlayerView["activateOptions"] = [];
  const combatQuickWindow = state.combat?.phase === "quickWindow";
  if (state.phase === "main" && state.activePlayer === self && !state.pendingChoices && !combatQuickWindow) {
    legalActions.push("END_MAIN");
    const pp = state.players[self].pp;
    const p = state.players[self];
    for (const card of p.zones.hand) {
      const cost = getEffectivePlayCost(card, card.name, state, self, "hand");
      if (pp >= cost && canPlayCardFromZones(state, self, card.name)) {
        legalActions.push(`PLAY:${card.instanceId}`);
      }
      pushActivateOptions(
        legalActions,
        activateOptions,
        state,
        self,
        card.instanceId,
        "hand",
        card,
        pp,
        p.evoPoints,
      );
    }
    for (const card of p.zones.exArea) {
      const cost = getEffectivePlayCost(card, card.name, state, self, "exArea");
      if (pp >= cost && canPlayCardFromZones(state, self, card.name)) {
        legalActions.push(`PLAY:${card.instanceId}`);
      }
    }
    for (const card of p.zones.field) {
      if (!card.engaged && !isBoxed(card, state)) {
        const cardDef = getCardDef(resolveCardNo(state, card));
        const canAttack =
          cardDef?.cardType === "follower" &&
          (card.onFieldSinceTurnStart ||
            card.evolvedThisTurn ||
            hasKeyword(card, "storm", state) ||
            hasKeyword(card, "rush", state));
        if (canAttack) {
          legalActions.push(`ATTACK:${card.instanceId}`);
          for (const target of getLegalAttackTargets(state, card, self)) {
            if (target.type === "leader") {
              legalActions.push(`ATTACK_LEADER:${card.instanceId}`);
            } else {
              legalActions.push(`ATTACK_TARGET:${card.instanceId}:${target.instanceId}`);
            }
          }
        }
      }

      pushActivateOptions(
        legalActions,
        activateOptions,
        state,
        self,
        card.instanceId,
        "field",
        card,
        pp,
        p.evoPoints,
      );

      // Evolve is allowed even while engaged (e.g. after activating).
      if (
        !isBoxed(card, state) &&
        !card.linkedEvoInstanceId &&
        canEvolveFollower(state, self, card.instanceId)
      ) {
        const evoMatch = findMatchingEvolveCard(state, self, card.instanceId);
        if (evoMatch) {
          const cost = getEffectiveEvolveCost(state, self, card);
          if (cost == null) continue;
          const canSuper = canSuperEvolveNow(state, self);
          const ppPay = computeEvolvePayment(cost, pp, p.evoPoints, false);
          const epPay = computeEvolvePayment(cost, pp, p.evoPoints, true);
          if (ppPay.ok) {
            legalActions.push(`EVOLVE:${card.instanceId}`);
            if (canSuper) legalActions.push(`SUPER_EVOLVE:${card.instanceId}`);
          }
          if (epPay.ok && epPay.epCost > 0) {
            legalActions.push(`EVOLVE_EP:${card.instanceId}`);
            if (canSuper) legalActions.push(`SUPER_EVOLVE_EP:${card.instanceId}`);
          }
        }
      }
    }
    for (const card of p.zones.cemetery) {
      pushActivateOptions(
        legalActions,
        activateOptions,
        state,
        self,
        card.instanceId,
        "cemetery",
        card,
        pp,
        p.evoPoints,
      );
    }
    for (const card of p.zones.exArea) {
      pushActivateOptions(
        legalActions,
        activateOptions,
        state,
        self,
        card.instanceId,
        "exArea",
        card,
        pp,
        p.evoPoints,
      );
    }
  }
  if (state.quickWindow && state.quickWindowPlayer === self && !state.pendingChoices) {
    const pp = state.players[self].pp;
    const quickZones: Array<{ card: (typeof state.players)[0]["zones"]["hand"][0]; fromZone: "hand" | "exArea" }> = [
      ...state.players[self].zones.hand.map((card) => ({ card, fromZone: "hand" as const })),
      ...state.players[self].zones.exArea.map((card) => ({ card, fromZone: "exArea" as const })),
    ];
    for (const { card, fromZone } of quickZones) {
      const def = getCardDef(card.name);
      if (!def?.keywords?.includes("quick") && !def?.abilities?.some((a) => a.quick)) continue;
      const cost = getEffectivePlayCost(card, card.name, state, self, fromZone);
      if (pp >= cost && canPlayCardFromZones(state, self, card.name)) {
        legalActions.push(`QUICK_PLAY:${card.instanceId}`);
      }
    }
    // Always allow pass so the window can end after playing the last playable quick.
    legalActions.push("PASS_QUICK_WINDOW");
  }
  if (state.pendingChoices?.player === self) {
    legalActions.push("CHOICE_REQUIRED");
  }

  const exPlayCosts: Record<string, number> = {};
  for (const card of state.players[self].zones.exArea) {
    if (getCardDef(card.name)?.cardType === "crest") continue;
    exPlayCosts[card.instanceId] = getEffectivePlayCost(
      card,
      card.name,
      state,
      self,
      "exArea",
    );
  }
  const opponentExPlayCosts: Record<string, number> = {};
  for (const card of state.players[opponent].zones.exArea) {
    if (getCardDef(card.name)?.cardType === "crest") continue;
    opponentExPlayCosts[card.instanceId] = getEffectivePlayCost(
      card,
      card.name,
      state,
      opponent,
      "exArea",
    );
  }

  const combatKeywordList: Keyword[] = [
    "ward",
    "bane",
    "aura",
    "rush",
    "storm",
    "drain",
    "intimidate",
  ];
  const activeKeywords: Record<string, Keyword[]> = {};
  const collectActiveKeywords = (owner: PlayerId, card: (typeof state.players)[0]["zones"]["field"][0]) => {
    activeKeywords[card.instanceId] = combatKeywordList.filter((kw) =>
      hasKeyword(card, kw, state, owner),
    );
  };
  for (const card of state.players[self].zones.field) collectActiveKeywords(self, card);
  for (const card of state.players[self].zones.exArea) collectActiveKeywords(self, card);
  for (const card of state.players[opponent].zones.field) collectActiveKeywords(opponent, card);
  for (const card of state.players[opponent].zones.exArea) {
    collectActiveKeywords(opponent, card);
  }

  return {
    self,
    state: view,
    opponentHandCount: state.players[opponent].zones.hand.length,
    opponentDeckCount: state.players[opponent].zones.deck.length,
    opponentEvoDeckCount:
      state.players[opponent].zones.evolveDeck.length +
      state.players[opponent].zones.evolveZone.length,
    legalActions,
    activateOptions,
    exPlayCosts,
    opponentExPlayCosts,
    activeKeywords,
  };
}

export function tryAction(state: GameState, player: PlayerId, action: Parameters<typeof applyAction>[2]) {
  return applyAction(state, player, action);
}
