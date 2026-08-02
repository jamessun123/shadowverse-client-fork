import { setEngineView, setInstanceMap, resetEngine } from "../redux/GameStateSlice";
import {
  syncFromEngine,
  setLeaderSilent,
  setEnemyLeader,
  queueEnemyRevealedCards,
  setInitialDecklist,
} from "../redux/CardSlice";
import { engineViewToRedux } from "./adapter";
import { getNameByCardNoClient } from "./cardLookup";
import { store } from "../redux/store";

/** Reveals already shown this game (by instanceId). Prevents re-animating on later syncs. */
const shownRevealIds = new Set();

/**
 * Apply authoritative engine payload to Redux.
 * Accepts either a room broadcast `{ 0, 1, seq }` or a single `PlayerView`.
 */
export function applyEnginePayload(dispatch, payload, knownSlot = null) {
  if (!payload) return false;

  let view;
  let seq;

  if (payload.self != null && payload.state && payload[0] === undefined) {
    view = payload;
    seq = payload.seq ?? Date.now();
  } else {
    const hasBoth = payload[0] != null && payload[1] != null;
    const slot =
      knownSlot ??
      store.getState().gameState.playerSlot ??
      (hasBoth ? null : payload.slot != null ? payload.slot : null) ??
      (!hasBoth && payload[0] != null ? 0 : null) ??
      (!hasBoth && payload[1] != null ? 1 : null);
    if (slot == null) return false;
    view = payload[slot];
    seq = payload.seq;
    if (!view) return false;
  }

  const freshGame =
    view.state?.phase === "mulligan" && view.state?.turnNumber === 0;
  if (freshGame) {
    shownRevealIds.clear();
    dispatch(resetEngine());
  }

  // Don't apply board/PP from a stale broadcast after a newer seq was already applied.
  const lastSeq = store.getState().gameState.lastSeq;
  if (!freshGame && seq != null && seq <= lastSeq) {
    return false;
  }

  dispatch(setEngineView({ view, seq, force: freshGame, testingMode: payload.testingMode }));
  if (view.registeredDecklist) {
    dispatch(
      setInitialDecklist({
        deck: view.registeredDecklist.mainDeck || [],
        evoDeck: view.registeredDecklist.evolveDeck || [],
      }),
    );
  }
  const mapped = engineViewToRedux(view, view.self);
  if (!mapped) return false;
  dispatch(syncFromEngine(mapped));
  dispatch(setInstanceMap(mapped.instanceMap));
  if (view.selfLeader) dispatch(setLeaderSilent(view.selfLeader));
  if (view.opponentLeader) dispatch(setEnemyLeader(view.opponentLeader));

  const self = view.self;
  const reveals = view.state?.revealedCards ?? [];
  const opponentReveals = reveals.filter((r) => r.owner !== self);
  const newReveals = opponentReveals.filter(
    (r) => r.instanceId && !shownRevealIds.has(r.instanceId)
  );

  if (newReveals.length > 0) {
    for (const r of newReveals) shownRevealIds.add(r.instanceId);
    dispatch(
      queueEnemyRevealedCards(
        newReveals.map((r) => {
          const key = r.name || r.cardNo;
          const name = (getNameByCardNoClient(key) || key || "").replace(
            /\s+TOKEN$/i,
            ""
          );
          return { id: r.instanceId, name };
        })
      )
    );
  }

  return true;
}
