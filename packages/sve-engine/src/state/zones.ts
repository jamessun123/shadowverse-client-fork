import { isTokenCard, placeLeavingPlay } from "../cards/tokens";
import { onCardEntersExArea, onFollowerEntersField } from "../rules/confirmation";
import { resetCardInstanceState } from "./card-reset";
import { CardInstance, GameState, PlayerId } from "../types";
import { findInstance } from "./queries";

export function moveCard(
  state: GameState,
  instanceId: string,
  toZone: keyof GameState["players"][0]["zones"],
  toPlayer: PlayerId,
): GameState {
  const found = findInstance(state, instanceId);
  if (!found) return state;
  let next = structuredClone(state);
  const fromZones = next.players[found.player].zones;
  const fromList = fromZones[found.zone as keyof typeof fromZones] as CardInstance[];
  const idx = fromList.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return state;
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
    const host = findInstance(next, card.equippedToInstanceId);
    if (host?.card.equippedInstanceIds) {
      host.card.equippedInstanceIds = host.card.equippedInstanceIds.filter((id) => id !== instanceId);
      // Strip modifiers sourced from this equipment.
      host.card.modifiers = host.card.modifiers.filter((m) => m.sourceId !== instanceId);
      host.card.grantedKeywords = host.card.grantedKeywords.filter(() => true);
      // Recalculate damage bonuses from remaining equipment modifiers.
      host.card.damageDealtBonus = host.card.modifiers.reduce(
        (sum, m) => sum + (m.damageDealtBonus ?? 0),
        0,
      ) || undefined;
      host.card.damageTakenReduction = host.card.modifiers.reduce(
        (sum, m) => sum + (m.damageTakenReduction ?? 0),
        0,
      ) || undefined;
    }
    card.equippedToInstanceId = undefined;
  }

  // Tokens cease to exist outside field / EX / resolution.
  if (
    (toZone === "cemetery" || toZone === "banish") &&
    isTokenCard(card.name)
  ) {
    resetCardInstanceState(card);
    return next;
  }

  card.controller = toPlayer;
  const toList = next.players[toPlayer].zones[toZone] as CardInstance[];
  toList.push(card);

  if (toZone === "cemetery" || toZone === "banish") {
    resetCardInstanceState(card);
  } else if (toZone === "field") {
    onFollowerEntersField(next, card.instanceId, toPlayer);
  } else if (toZone === "exArea") {
    onCardEntersExArea(next, card.instanceId, toPlayer);
  }
  return next;
}

export function removeFromField(
  state: GameState,
  instanceId: string,
): { state: GameState; card: CardInstance; player: PlayerId } | null {
  const found = findInstance(state, instanceId);
  if (!found || found.zone !== "field") return null;
  let next = structuredClone(state);
  const p = next.players[found.player];
  const idx = p.zones.field.findIndex((c) => c.instanceId === instanceId);
  if (idx < 0) return null;
  const [card] = p.zones.field.splice(idx, 1);

  // Host leaving: dump equipment first (while still tracked on the card).
  if (card.equippedInstanceIds?.length) {
    const equipIds = [...card.equippedInstanceIds];
    card.equippedInstanceIds = [];
    for (const eqId of equipIds) {
      next = moveCard(next, eqId, "cemetery", found.player);
    }
  }
  if (card.equippedToInstanceId) {
    const host = findInstance(next, card.equippedToInstanceId);
    if (host?.card.equippedInstanceIds) {
      host.card.equippedInstanceIds = host.card.equippedInstanceIds.filter((id) => id !== instanceId);
      host.card.modifiers = host.card.modifiers.filter((m) => m.sourceId !== instanceId);
    }
    card.equippedToInstanceId = undefined;
  }

  resetCardInstanceState(card);
  placeLeavingPlay(p.zones, card, "cemetery");
  return { state: next, card, player: found.player };
}

export function destroyFollower(state: GameState, instanceId: string): GameState {
  const removed = removeFromField(state, instanceId);
  if (!removed) return state;
  let next = removed.state;
  const link = next.players[removed.player].zones.evolveZone.find(
    (l) => l.fieldInstanceId === instanceId,
  );
  if (link) {
    const evoIdx = next.players[removed.player].zones.resolutionZone.findIndex(
      (c) => c.instanceId === link.evolveInstanceId,
    );
    if (evoIdx >= 0) {
      const [evoCard] = next.players[removed.player].zones.resolutionZone.splice(evoIdx, 1);
      resetCardInstanceState(evoCard);
      evoCard.evolveUsed = true;
      next.players[removed.player].zones.evolveDeck.push(evoCard);
    } else {
      next = moveCard(next, link.evolveInstanceId, "evolveDeck", removed.player);
      const evoInDeck = next.players[removed.player].zones.evolveDeck.find(
        (c) => c.instanceId === link.evolveInstanceId,
      );
      if (evoInDeck) {
        resetCardInstanceState(evoInDeck);
        evoInDeck.evolveUsed = true;
      }
    }
    next.players[removed.player].zones.evolveZone = next.players[
      removed.player
    ].zones.evolveZone.filter((l) => l.fieldInstanceId !== instanceId);
  }
  return next;
}

export function drawCard(state: GameState, player: PlayerId): GameState {
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

export function shuffleDeck(state: GameState, player: PlayerId): GameState {
  const next = structuredClone(state);
  const deck = next.players[player].zones.deck;
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return next;
}
