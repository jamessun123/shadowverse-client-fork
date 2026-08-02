import React, { useState, useEffect } from "react";
import { cardImage } from "../../decks/getCards";
import { motion } from "framer-motion";
import {
  modifyAtk,
  modifyDef,
  setCurrentCard,
  modifyCounter,
  setEngaged,
} from "../../redux/CardSlice";
import { useDispatch, useSelector } from "react-redux";
import cancel from "../../assets/logo/cancel.png";
import carrot from "../../assets/logo/carrot.png";
import drive from "../../assets/logo/drive.png";
import img from "../../assets/pin_bellringer_angel.png";
import atkImg from "../../assets/logo/atk.png";
import defImg from "../../assets/logo/def.png";

import "../../css/Card.css";
import "../../css/AnimatedBorder.css";

export default function Card({
  name,
  idx,
  // setDragging,
  ready,
  setHovering,
  onField = false,
  evolvedUsed = false,
  opponentField = false,
  cardBeneath,
  equipmentBeneath,
  engaged,
  showAtk,
  showDef,
  atkVal,
  defVal,
  counterVal,
  discountedPlayCost,
  aura,
  bane,
  ward,
  rush,
  storm,
  drain,
  intimidate,
  handLength,
  inHand = false,
  inHandIndex = -1,
}) {
  let numOfCarrots = 0;
  const dispatch = useDispatch();
  const [atk, setAtk] = useState(0);
  const [def, setDef] = useState(0);
  const [counter, setCounter] = useState(0);
  const [hoverInput, setHoverInput] = useState(false);

  const reduxEnemyCardSelectedInHand = useSelector(
    (state) => state.card.enemyCardSelectedInHand
  );

  const reduxCardSelectedOnField = useSelector(
    (state) => state.card.cardSelectedOnField
  );
  const reduxEnemyCardSelectedOnField = useSelector(
    (state) => state.card.enemyCardSelectedOnField
  );
  const gameMode = useSelector((state) => state.gameState.gameMode);

  useEffect(() => {
    setAtk(Number(atkVal));
    setDef(Number(defVal));
  }, [atkVal, defVal]);

  useEffect(() => {
    setCounter(Number(counterVal));
  }, [counterVal]);

  const handleTap = () => {
    if (gameMode === "automated") return;
    if (onField && !opponentField && !ready && !hoverInput) {
      dispatch(setEngaged(idx));
    }
  };

  const handleAtkInput = (event) => {
    setAtk(Number(event.target.value));
    dispatch(
      modifyAtk({
        value: event.target.value,
        index: idx,
      })
    );
  };
  const handleDefInput = (event) => {
    setDef(Number(event.target.value));
    dispatch(
      modifyDef({
        value: event.target.value,
        index: idx,
      })
    );
  };

  const handleCounterInput = (event) => {
    const num = event.target.value;
    if (Number(num) === 0) setHoverInput(false);
    setCounter(Number(num));
    dispatch(
      modifyCounter({
        value: num,
        index: idx,
      })
    );
  };

  const handleHoverStart = () => {
    // Opponent field stays inspectable even while placing/selecting (ready).
    if (ready && !opponentField) return;
    setHovering(true);
    if (name.slice(0, 6) === "Carrot" || name === "Drive Point") {
      dispatch(setCurrentCard(cardBeneath));
    } else {
      const eqList = Array.isArray(equipmentBeneath)
        ? equipmentBeneath.filter((n) => n && n !== 0)
        : equipmentBeneath != null && equipmentBeneath !== 0
          ? [equipmentBeneath]
          : [];
      if (eqList.length) {
        dispatch(setCurrentCard({ name, equipment: eqList }));
      } else {
        dispatch(setCurrentCard(name));
      }
    }
  };

  const cardPos = (idx) => {
    if (idx === -1) return -1;
    else if (idx < 5) return idx + 5;
    else return idx - 5;
  };

  const handleHoverEnd = () => {
    setHovering(false);
  };

  const handleStartHoverInput = () => {
    setHoverInput(true);
  };

  const handleEndHoverInput = () => {
    setHoverInput(false);
  };

  const updateNumberOfCarrots = () => {
    if (name !== 0) {
      if (name === "Carrot") {
        numOfCarrots = 1;
      } else if (Number(name?.slice(-1)) > 0) {
        numOfCarrots = Number(name.slice(-1));
      }
    }
  };
  updateNumberOfCarrots();

  return (
    <>
      <motion.div
        onTap={handleTap}
        style={{
          position: "relative",
          overflow: "visible",
        }}
        animate={engaged ? { rotate: -90 } : { rotate: 0 }}
        initial={false}
        onHoverStart={() => handleHoverStart()}
        onHoverEnd={() => handleHoverEnd()}
        whileHover={
          (!ready || opponentField) && {
            translateY: inHand ? -80 : -25,
            scale: inHand ? 1.5 : 1.3,
            cursor: `url(${img}) 55 55, auto`,
            overlay: "auto",
          }
        }
        className={
          cardPos(reduxCardSelectedOnField) === idx && opponentField
            ? "box2"
            : reduxEnemyCardSelectedOnField === idx && !opponentField
            ? "box2"
            : inHand &&
              (reduxEnemyCardSelectedInHand - handLength + 1) * -1 ===
                inHandIndex
            ? "box2"
            : "none"
        }
      >
        {aura === 1 && <span className="kw-silhouette kw-aura" aria-hidden />}
        {bane === 1 && <span className="kw-silhouette kw-bane" aria-hidden />}
        {ward === 1 && <span className="kw-silhouette kw-ward" aria-hidden />}
        {rush === 1 && <span className="kw-silhouette kw-rush" aria-hidden />}
        {storm === 1 && <span className="kw-silhouette kw-storm" aria-hidden />}
        {drain === 1 && <span className="kw-silhouette kw-drain" aria-hidden />}
        {intimidate === 1 && (
          <span className="kw-silhouette kw-intimidate" aria-hidden />
        )}
        {typeof discountedPlayCost === "number" &&
          Number.isFinite(discountedPlayCost) &&
          discountedPlayCost >= 0 && (
          <div
            style={{
              position: "absolute",
              top: "25%",
              left: "30%",
              borderRadius: "50px",
              color: "white",
              fontSize: "30px",
              fontFamily: "Noto Serif JP, serif",
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              height: "50px",
              width: "50px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
              zIndex: 2,
            }}
          >
            {discountedPlayCost}
          </div>
        )}
        {Number(counterVal) > 0 ? (
          <>
            {gameMode !== "automated" && !opponentField && (
              <input
                disabled={opponentField ? true : false}
                value={counter}
                onChange={handleCounterInput}
                type="number"
                min={0}
                className={"counterInput"}
                onMouseEnter={handleStartHoverInput}
                onMouseLeave={handleEndHoverInput}
              />
            )}
            <div
              style={{
                position: "absolute",
                top: "25%",
                right: "30%",
                borderRadius: "50px",
                color: "white",
                fontSize: "30px",
                fontFamily: "Noto Serif JP, serif",
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                height: "50px",
                width: "50px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              {counter}
            </div>
          </>
        ) : null}
        {(numOfCarrots > 0 && name !== "Carrot") ||
        (name === "Drive Point" && onField) ? (
          <img
            style={{ opacity: 1, position: "relative", zIndex: 1 }}
            height={"100%"}
            src={cardImage(cardBeneath)}
            alt={name}
          />
        ) : (
          <>
            {equipmentBeneath != null &&
              equipmentBeneath !== 0 &&
              (Array.isArray(equipmentBeneath)
                ? equipmentBeneath
                : [equipmentBeneath]
              )
                .filter((n) => n && n !== 0)
                .map((eqName, eqIdx) => (
                  <img
                    key={`eq-${eqName}-${eqIdx}`}
                    height={"100%"}
                    src={cardImage(eqName)}
                    alt=""
                    aria-hidden
                    style={{
                      position: "absolute",
                      left: `${-14 - eqIdx * 8}%`,
                      top: `${4 + eqIdx * 2}%`,
                      height: "94%",
                      zIndex: 0,
                      pointerEvents: "none",
                      opacity: 0.92,
                      filter: "brightness(0.92)",
                    }}
                  />
                ))}
            <img
              height={"100%"}
              src={cardImage(name)}
              alt={name}
              style={{ position: "relative", zIndex: 1 }}
            />
          </>
        )}

        {showAtk && (
          <>
            {gameMode !== "automated" && !opponentField && (
              <input
                value={atk}
                onChange={handleAtkInput}
                type="number"
                min={0}
                max={99}
                className={"atkInputNum"}
                onMouseEnter={handleStartHoverInput}
                onMouseLeave={handleEndHoverInput}
              />
            )}
            <div
              style={{
                position: "absolute",
                top: "75%",
                right: atk > 9 ? "50%" : "60%",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              <img height={"40px"} src={atkImg} alt="atk" />
              <span
                style={{
                  color: "white",
                  fontSize: "25px",
                  textShadow: "-1px 1px 0 #000",
                  position: "relative",
                  top: "50%",
                  right: "50%",
                }}
              >
                {atk}
              </span>
            </div>
          </>
        )}
        {showDef && (
          <>
            {gameMode !== "automated" && !opponentField && (
              <input
                value={def}
                onChange={handleDefInput}
                type="number"
                min={0}
                className={"defInputNum"}
                onMouseEnter={handleStartHoverInput}
                onMouseLeave={handleEndHoverInput}
              />
            )}
            <div
              style={{
                position: "absolute",
                top: "75%",
                left: "70%",
                display: "flex",
                alignItems: "center",
                pointerEvents: "none",
                zIndex: 2,
              }}
            >
              <img height={"40px"} src={defImg} alt="def" />
              <span
                style={{
                  color: "white",
                  fontSize: "25px",
                  textShadow: "-1px 1px 0 #000",
                  position: "relative",
                  top: "50%",
                  right: "50%",
                }}
              >
                {def}
              </span>
            </div>
          </>
        )}
        {evolvedUsed && (
          <img
            src={cancel}
            alt={"cancel"}
            style={{
              position: "relative",
              height: "100px",
              width: "100px",
              opacity: 0.65,
              left: "7%",
              bottom: "90%",
            }}
          />
        )}
        {numOfCarrots > 0 && onField && (
          <div
            style={{
              width: "50px",
              position: "relative",
              left: "45%",
              bottom: "120%",
              fontFamily: "EB Garamond",
              color: "white",
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              borderRadius: "10px",
              border: "4px solid #0000",
              display: "flex",
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <img
              src={carrot}
              alt={"carrot"}
              style={{
                height: "20px",
                width: "20px",
              }}
            />
            <div style={{ fontSize: 15 }}>x {numOfCarrots} </div>
          </div>
        )}
        {name === "Drive Point" && onField && (
          <div
            style={{
              width: "50px",
              position: "relative",
              left: "45%",
              bottom: "120%",
              fontFamily: "EB Garamond",
              color: "white",
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              borderRadius: "10px",
              border: "4px solid #0000",
              display: "flex",
              flexDirection: "row",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <img
              src={drive}
              alt={"drive"}
              style={{
                height: "20px",
                width: "20px",
              }}
            />
            <div style={{ fontSize: 15 }}></div>
          </div>
        )}
      </motion.div>
    </>
  );
}
