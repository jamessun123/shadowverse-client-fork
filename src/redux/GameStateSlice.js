import { createSlice } from "@reduxjs/toolkit";

export const GameStateSlice = createSlice({
  name: "gameState",
  initialState: {
    gameMode: "automated",
    testingMode: false,
    engineView: null,
    playerSlot: null,
    pendingChoices: null,
    legalActions: [],
    activateOptions: [],
    enginePhase: null,
    engineWinner: null,
    quickWindow: null,
    quickWindowPlayer: null,
    instanceMap: {},
    selectedAttackerId: null,
    lastSeq: 0,
    uiChromeHidden: false,
  },
  reducers: {
    setGameMode: (state, action) => {
      state.gameMode = action.payload;
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem("sve_game_mode", action.payload);
      }
    },
    setTestingMode: (state, action) => {
      state.testingMode = !!action.payload;
    },
    setPlayerSlot: (state, action) => {
      state.playerSlot = action.payload;
    },
    setEngineView: (state, action) => {
      const { view, seq, force, testingMode } = action.payload;
      const freshMulligan =
        view?.state?.phase === "mulligan" && view?.state?.turnNumber === 0;
      if (!force && !freshMulligan && seq != null && seq <= state.lastSeq) return;
      state.engineView = view;
      if (view?.self != null) state.playerSlot = view.self;
      state.pendingChoices = view?.state?.pendingChoices ?? null;
      state.legalActions = view?.legalActions ?? [];
      state.activateOptions = view?.activateOptions ?? [];
      state.enginePhase = view?.state?.phase ?? null;
      state.engineWinner = view?.state?.winner ?? null;
      state.quickWindow = view?.state?.quickWindow ?? null;
      state.quickWindowPlayer = view?.state?.quickWindowPlayer ?? null;
      if (testingMode != null) state.testingMode = !!testingMode;
      else if (view?.state?.testingMode != null) state.testingMode = !!view.state.testingMode;
      state.selectedAttackerId = null;
      if (seq != null) state.lastSeq = seq;
    },
    setInstanceMap: (state, action) => {
      state.instanceMap = action.payload;
    },
    setSelectedAttackerId: (state, action) => {
      state.selectedAttackerId = action.payload;
    },
    setUiChromeHidden: (state, action) => {
      state.uiChromeHidden = action.payload;
    },
    resetEngine: (state) => {
      state.engineView = null;
      state.pendingChoices = null;
      state.legalActions = [];
      state.activateOptions = [];
      state.enginePhase = null;
      state.engineWinner = null;
      state.quickWindow = null;
      state.quickWindowPlayer = null;
      state.instanceMap = {};
      state.selectedAttackerId = null;
      state.lastSeq = 0;
      state.uiChromeHidden = false;
      // Keep testingMode — rematch / fresh sync should not clear it.
    },
  },
});

export const {
  setGameMode,
  setTestingMode,
  setPlayerSlot,
  setEngineView,
  setInstanceMap,
  setSelectedAttackerId,
  setUiChromeHidden,
  resetEngine,
} =
  GameStateSlice.actions;
