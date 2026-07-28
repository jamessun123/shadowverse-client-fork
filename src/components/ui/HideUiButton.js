import React from "react";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { IconButton, Tooltip } from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { setUiChromeHidden } from "../../redux/GameStateSlice";

export default function HideUiButton({ sx = {}, size = "small", onHide, title }) {
  const dispatch = useDispatch();
  const hidden = useSelector((s) => s.gameState.uiChromeHidden);

  // Global chrome hide: button disappears once overlays are hidden.
  // Local onHide (zone modals): always show so this panel can be dismissed.
  if (!onHide && hidden) return null;

  const handleClick = () => {
    if (onHide) onHide();
    else dispatch(setUiChromeHidden(true));
  };

  return (
    <Tooltip title={title || (onHide ? "Hide this panel" : "Hide UI to view board and hand")}>
      <IconButton
        size={size}
        aria-label="Hide UI"
        onClick={handleClick}
        sx={{
          color: "white",
          backgroundColor: "rgba(0, 0, 0, 0.55)",
          "&:hover": { backgroundColor: "rgba(0, 0, 0, 0.75)" },
          ...sx,
        }}
      >
        <VisibilityOffIcon fontSize={size} />
      </IconButton>
    </Tooltip>
  );
}

export function ModalHideUiRow({ onHide }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-end",
        width: "100%",
        padding: "4px 8px",
        boxSizing: "border-box",
      }}
    >
      <HideUiButton onHide={onHide} />
    </div>
  );
}
