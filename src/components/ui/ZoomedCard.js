import React from "react";
import { cardImage } from "../../decks/getCards";
import { getDetails, traitTokens } from "../../decks/cardDetails";
import EffectText from "../deckbuilder/EffectText";
import { getCardDefClient } from "../../engine/cardLookup";

function resolveDetails(name) {
  if (!name) return null;
  const direct = getDetails(name);
  if (direct) return { name, details: direct };
  if (!String(name).endsWith(" TOKEN")) {
    const withToken = getDetails(`${name} TOKEN`);
    if (withToken) return { name: `${name} TOKEN`, details: withToken };
  } else {
    const stripped = String(name).replace(/ TOKEN$/, "");
    const withoutToken = getDetails(stripped);
    if (withoutToken) return { name: stripped, details: withoutToken };
  }
  return { name, details: null };
}

function resolveTraits(name, details) {
  if (details?.trait && details.trait !== "-") {
    return details.trait
      .split("/")
      .map((t) => t.trim())
      .filter((t) => t && t !== "-");
  }
  const fromName = traitTokens(name);
  if (fromName.length) return fromName;
  const eng = getCardDefClient(name);
  if (Array.isArray(eng?.traits) && eng.traits.length) return eng.traits;
  return [];
}

function formatEffectText(text) {
  return String(text || "")
    .replace(/\s*-{3,}\s*/g, "\n\n")
    .trim();
}

export default function ZoomedCard({ hovering, name, scale = 1, setHovering }) {
  const resolved = hovering ? resolveDetails(name) : null;
  const displayName = resolved?.name || name || "";
  const effectText = resolved
    ? formatEffectText(resolved.details?.effect || "")
    : "";
  const traits = resolved ? resolveTraits(displayName, resolved.details) : [];
  const showInfoPanel = Boolean(displayName || traits.length || effectText);

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
            alt={displayName || name}
            style={{
              height: "auto",
              width: "100%",
              // Shrink the art so the full text panel can sit below without scrolling.
              maxHeight: showInfoPanel ? "58vh" : "90vh",
              objectFit: "contain",
              flex: "1 1 auto",
              minHeight: 0,
            }}
          />
          {showInfoPanel ? (
            <div
              onMouseEnter={() => setHovering?.(true)}
              onMouseLeave={() => setHovering?.(false)}
              style={{
                width: "100%",
                flex: "0 0 auto",
                overflow: "visible",
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
              {displayName ? (
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 20,
                    lineHeight: 1.25,
                    marginBottom: traits.length || effectText ? 6 : 0,
                  }}
                >
                  {displayName.replace(/\s+TOKEN$/i, "")}
                </div>
              ) : null}
              {traits.length > 0 ? (
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 6,
                    marginBottom: effectText ? 8 : 0,
                  }}
                >
                  {traits.map((trait) => (
                    <span
                      key={trait}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        padding: "2px 9px",
                        borderRadius: 999,
                        fontSize: 13,
                        background: "rgba(72, 171, 224, 0.22)",
                        border: "1px solid rgba(72, 171, 224, 0.45)",
                        color: "#d7f0ff",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {trait}
                    </span>
                  ))}
                </div>
              ) : null}
              {effectText ? <EffectText text={effectText} iconSize={15} /> : null}
            </div>
          ) : null}
        </div>
      )}
    </>
  );
}
