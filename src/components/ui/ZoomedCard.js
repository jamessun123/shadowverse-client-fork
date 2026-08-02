import React, { forwardRef } from "react";
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
  // Fall back to authored engine card text when cardData is incomplete.
  const eng = getCardDefClient(name) || getCardDefClient(`${name} TOKEN`);
  if (eng?.cardText) {
    return {
      name: eng.name || name,
      details: {
        effect: eng.cardText,
        trait: Array.isArray(eng.traits) ? eng.traits.join(" / ") : "",
      },
    };
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

function CardInfoPanel({ name }) {
  const resolved = resolveDetails(name);
  const displayName = resolved?.name || name || "";
  const effectText = formatEffectText(resolved?.details?.effect || "");
  const traits = resolveTraits(displayName, resolved?.details);
  if (!displayName && !traits.length && !effectText) return null;

  return (
    <div
      style={{
        width: "100%",
        flex: "0 0 auto",
        overflow: "visible",
        // Never capture the pointer — overlapping the hovered card would steal
        // hover and flicker the preview. Game.js keeps the preview open while
        // the cursor stays inside this shell's bounds.
        pointerEvents: "none",
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
  );
}

const ZoomedCard = forwardRef(function ZoomedCard(
  { hovering, name, equipment = [], scale = 1 },
  ref,
) {
  const eqList = Array.isArray(equipment)
    ? equipment.filter(Boolean)
    : equipment
      ? [equipment]
      : [];
  const sideBySide = eqList.length > 0;
  const resolved = hovering ? resolveDetails(name) : null;
  const displayName = resolved?.name || name || "";
  const effectText = resolved
    ? formatEffectText(resolved.details?.effect || "")
    : "";
  const traits = resolved ? resolveTraits(displayName, resolved.details) : [];
  const showInfoPanel = Boolean(displayName || traits.length || effectText);

  if (!hovering) return null;

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        top: "2%",
        left: 0,
        width: sideBySide ? "min(72vw, 980px)" : "39vw",
        maxWidth: sideBySide ? 980 : 546,
        maxHeight: "96vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        zIndex: 2000,
        // Non-interactive so the preview never steals hover from the card (or
        // action-log thumbnail) underneath it.
        pointerEvents: "none",
        transform: `scale(${scale})`,
        transformOrigin: "top left",
        padding: "0 8px",
        boxSizing: "border-box",
      }}
    >
      {sideBySide ? (
        <div
          style={{
            display: "flex",
            flexDirection: "row",
            alignItems: "flex-start",
            gap: 12,
            width: "100%",
            minHeight: 0,
            flex: "1 1 auto",
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
              alignItems: "center",
            }}
          >
            <img
              src={cardImage(name)}
              alt={displayName || name}
              style={{
                height: "auto",
                width: "100%",
                maxHeight: showInfoPanel ? "58vh" : "90vh",
                objectFit: "contain",
              }}
            />
            {showInfoPanel ? <CardInfoPanel name={name} /> : null}
          </div>
          {eqList.map((eqName) => (
            <div
              key={eqName}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
                alignItems: "center",
              }}
            >
              <img
                src={cardImage(eqName)}
                alt={eqName}
                style={{
                  height: "auto",
                  width: "100%",
                  maxHeight: "58vh",
                  objectFit: "contain",
                }}
              />
              <CardInfoPanel name={eqName} />
            </div>
          ))}
        </div>
      ) : (
        <>
          <img
            src={cardImage(name)}
            alt={displayName || name}
            style={{
              height: "auto",
              width: "100%",
              maxHeight: showInfoPanel ? "58vh" : "90vh",
              objectFit: "contain",
              flex: "1 1 auto",
              minHeight: 0,
            }}
          />
          {showInfoPanel ? <CardInfoPanel name={name} /> : null}
        </>
      )}
    </div>
  );
});

export default ZoomedCard;
