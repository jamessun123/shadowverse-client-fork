import { useSelector } from "react-redux";

export function useUiChromeVisible() {
  return !useSelector((s) => s.gameState.uiChromeHidden);
}

/** Zone/inspect modals stay openable even while overlay chrome (choice modal, etc.) is hidden. */
export function useUiModalOpen(isOpen) {
  return Boolean(isOpen);
}
