import React from "react";
import { cardImage } from "../../decks/getCards";
import { getDetails } from "../../decks/cardDetails";
import EffectText from "../deckbuilder/EffectText";

function resolveEffectText(name) {
  if (!name) return "";
  const direct = getDetails(name)?.effect;
  if (direct) return direct;
  if (!String(name).endsWith(" TOKEN")) {
    const withToken = getDetails(`${name} TOKEN`)?.effect;
    if (withToken) return withToken;
  } else {
    const withoutToken = getDetails(String(name).replace(/ TOKEN$/, ""))?.effect;
    if (withoutToken) return withoutToken;
  }
  return "";
}

function formatEffectText(text) {
  return String(text).replace(/\s*-{3,}\s*/g, "\n\n").trim();
}

export default function ZoomedCard({ hovering, name, scale = 1, setHovering }) {
  const effectText = hovering ? formatEffectText(resolveEffectText(name)) : "";

  return (
    <>
      {hovering && (
        <div
          style={{
            position: "fixed",
            top: "2%",
            left: 0,
            width: "39vw",
            maxWidth: 546,
            maxHeight: "96vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
            zIndex: 2000,
            // Keep the shell non-interactive so it cannot steal hover from the
            // action-log thumbnail underneath (which would dismiss the preview).
            pointerEvents: "none",
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            padding: "0 8px",
            boxSizing: "border-box",
          }}
        >
          <img
            src={cardImage(name)}
            alt={name}
            style={{
              height: "auto",
              width: "100%",
              maxHeight: effectText ? "72vh" : "90vh",
              objectFit: "contain",
              flex: "0 0 auto",
            }}
          />
          {effectText ? (
            <div
              onMouseEnter={() => setHovering?.(true)}
              onMouseLeave={() => setHovering?.(false)}
              style={{
                width: "100%",
                maxHeight: "22vh",
                overflowY: "auto",
                pointerEvents: "auto",
                background: "rgba(0, 0, 0, 0.78)",
                border: "1px solid rgba(72, 171, 224, 0.35)",
                borderRadius: 8,
                padding: "10px 12px",
                boxSizing: "border-box",
                color: "#fff",
                fontFamily: "Noto Serif JP, serif",
                fontSize: 18,
                lineHeight: 1.45,
                whiteSpace: "pre-wrap",
                boxShadow: "0 4px 16px rgba(0, 0, 0, 0.45)",
              }}
            >
              <EffectText text={effectText} iconSize={15} />
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
