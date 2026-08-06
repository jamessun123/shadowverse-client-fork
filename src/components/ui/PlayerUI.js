import React, { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  setEvoPoints,
  setSuperEvoActive,
  setDice,
} from "../../redux/CardSlice";
import { socket } from "../../sockets";
import Leader from "./Leader";
import sword from "../../assets/logo/sword.png";
import forest from "../../assets/logo/forest.png";
import abyss from "../../assets/logo/abyss.png";
import dragon from "../../assets/logo/dragon.png";
import haven from "../../assets/logo/haven.png";
import rune from "../../assets/logo/rune.png";
import uma from "../../assets/logo/carrot.png";
import cool from "../../assets/logo/cool.png";
import cute from "../../assets/logo/cute.png";
import passion from "../../assets/logo/passion.png";
import Dice from "react-dice-roll";
import { motion } from "framer-motion";

import { styled } from "@mui/material/styles";
import Rating from "@mui/material/Rating";
import WifiOffIcon from "@mui/icons-material/WifiOff";
import WifiIcon from "@mui/icons-material/Wifi";
import "../../css/EnemyUI.css";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import FiberManualRecordOutlinedIcon from "@mui/icons-material/FiberManualRecordOutlined";
import sepOn from "../../assets/logo/sep_on.png";
import sepOff from "../../assets/logo/sep_off.png";

const StyledRating = styled(Rating)({
  "& .MuiRating-iconFilled": {
    color:
      "radial-gradient(circle at 10% 20%, rgb(255, 200, 124) 0%, rgb(252, 251, 121) 90%);",
  },
  "& .MuiRating-iconHover": {
    color: "#fec13f",
  },
});

export default function PlayerUI({ name }) {
  const dispatch = useDispatch();
  const [ep, setEP] = useState(0);
  const [superEvo, setSEP] = useState(false);
  const reduxCurrentSuperEvo = useSelector(
    (state) => state.card.superEvoActive,
  );
  const reduxCurrentEP = useSelector((state) => state.card.evoPoints);
  const reduxCurrentHealth = useSelector((state) => state.card.playerHealth);
  const reduxMaxPlayPoints = useSelector((state) => state.card.playPoints.max);
  const reduxCurrentPlayPoints = useSelector(
    (state) => state.card.playPoints.available,
  );
  const reduxShowDice = useSelector((state) => state.card.showDice);
  const reduxLeaderActive = useSelector((state) => state.card.leaderActive);
  const reduxRoom = useSelector((state) => state.card.room);
  const reduxSelfOnlineStatus = useSelector(
    (state) => state.card.selfOnlineStatus,
  );
  const gameMode = useSelector((state) => state.gameState.gameMode);
  const automated = gameMode === "automated";
  const sepLit = automated ? reduxCurrentSuperEvo : superEvo;

  useEffect(() => {
    if (automated) setSEP(reduxCurrentSuperEvo);
  }, [automated, reduxCurrentSuperEvo]);

  useEffect(() => {
    setEP(reduxCurrentEP);
  }, [reduxCurrentEP]);

  const handleEP = (newValue) => {
    setEP(newValue);
    dispatch(setEvoPoints(newValue));
    console.log(newValue);
  };

  const handleSuperEvo = () => {
    setSEP(!superEvo);
    dispatch(setSuperEvoActive(!superEvo));
    socket.emit("send msg", {
      type: "superEvoActive",
      data: !superEvo,
      room: reduxRoom,
    });
  };

  const handleDiceRoll = (value) => {
    console.log(value);
    dispatch(setDice({ show: true, roll: value }));
  };

  // const incrementEP = () => {
  //   setEP((ep) => ep + 1);
  // };

  // const decrementEP = () => {
  //   ep > 0 ? setEP((ep) => ep - 1) : setEP(0);
  // };

  const getClassFromLeader = (name) => {
    switch (name) {
      case "SiLong":
        return dragon;
      case "Drache":
        return dragon;
      case "Forte":
        return dragon;
      case "Galmieux":
        return dragon;
      case "Jeanne":
        return haven;
      case "Rola":
        return haven;
      case "Sekka":
        return forest;
      case "Hozumi":
        return forest;
      case "CC":
        return forest;
      case "Orchis":
        return forest;
      case "Bunny":
        return sword;
      case "Albert":
        return sword;
      case "Icy":
        return abyss;
      case "Anisage":
        return abyss;
      case "Vania":
        return abyss;
      case "Mono":
        return abyss;
      case "Lishenna":
        return rune;
      case "Ceridwen":
        return rune;
      case "Kuon":
        return rune;
      case "Daria":
        return rune;
      case "Manhatten Cafe":
        return uma;
      case "Maruzensky":
        return uma;
      case "Rin":
        return cool;
      case "Uzuki":
        return cute;
      case "Mio":
        return passion;
      default:
        return dragon;
    }
  };
  const getColorFromLeader = (name) => {
    switch (name) {
      case "SiLong":
        return "linear-gradient(to right, rgb(252, 74, 26), rgb(247, 183, 51))";
      case "Drache":
        return "linear-gradient(to right, rgb(252, 74, 26), rgb(247, 183, 51))";
      case "Forte":
        return "linear-gradient(to right, rgb(252, 74, 26), rgb(247, 183, 51))";
      case "Galmieux":
        return "linear-gradient(to right, rgb(252, 74, 26), rgb(247, 183, 51))";
      case "Jeanne":
        return "linear-gradient(to top, #c79081 0%, #dfa579 100%)";
      case "Rola":
        return "linear-gradient(to top, #c79081 0%, #dfa579 100%)";
      case "CC":
        return "linear-gradient(-60deg, #16a085 0%, #f4d03f 100%)";
      case "Orchis":
        return "linear-gradient(-60deg, #16a085 0%, #f4d03f 100%)";
      case "Sekka":
        return "linear-gradient(-60deg, #16a085 0%, #f4d03f 100%)";
      case "Hozumi":
        return "linear-gradient(-60deg, #16a085 0%, #f4d03f 100%)";
      case "Bunny":
        return "linear-gradient(110.3deg, rgb(238, 179, 123) 8.7%, rgb(216, 103, 77) 47.5%, rgb(114, 43, 54) 89.1%)";
      case "Albert":
        return "linear-gradient(110.3deg, rgb(238, 179, 123) 8.7%, rgb(216, 103, 77) 47.5%, rgb(114, 43, 54) 89.1%)";
      case "Icy":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Anisage":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Vania":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Mono":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Kuon":
        return "linear-gradient(181deg, rgb(2, 0, 97) 15%, rgb(97, 149, 219) 158.5%)";
      case "Daria":
        return "linear-gradient(181deg, rgb(2, 0, 97) 15%, rgb(97, 149, 219) 158.5%)";
      case "Manhatten Cafe":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Maruzensky":
        return "linear-gradient(109.6deg, rgb(0, 0, 0) 11.2%, rgb(247, 30, 30) 100.3%)";
      case "Rin":
        return "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)";
      case "Uzuki":
        return "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)";
      case "Mio":
        return "linear-gradient(120deg, #e0c3fc 0%, #8ec5fc 100%)";
      default:
        return "linear-gradient(to right, rgb(252, 74, 26), rgb(247, 183, 51))";
    }
  };

  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: "0.85em",
        boxSizing: "border-box",
      }}
    >
      <Leader name={name} active={reduxLeaderActive} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          gap: "0.65em",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.5em",
          }}
        >
          <div style={{ height: "48px", width: "48px" }}>
            {reduxShowDice && (
              <motion.div>
                <Dice
                  size={48}
                  faceBg={"transparent"}
                  onRoll={(value) => handleDiceRoll(value)}
                />
              </motion.div>
            )}
          </div>
          {reduxSelfOnlineStatus ? (
            <div className={"onlineStatus"} title={"Connected"}>
              <WifiIcon sx={{ height: 34, width: 34 }} />
            </div>
          ) : (
            <div className={"offlineStatus"} title={"Disconnected — reconnecting…"}>
              <WifiOffIcon sx={{ height: 34, width: 34 }} />
            </div>
          )}
          <div style={{ opacity: 0.75 }}>
            <img height={52} width={52} src={getClassFromLeader(name)} alt={name} />
          </div>
        </div>
        <div
          style={{
            fontFamily: "Noto Serif JP, serif",
            background: getColorFromLeader(name),
            outline: "7px ridge rgba(0, 0, 0, 1.0)",
            userSelect: "none",
            height: "78px",
            width: "190px",
            display: "flex",
            justifyContent: "space-evenly",
            alignItems: "center",
            fontSize: "56px",
            zIndex: 1,
            color: "white",
          }}
        >
          {reduxCurrentHealth}
        </div>
        <div
          style={{
            height: "54px",
            width: "190px",
            display: "flex",
            justifyContent: "space-evenly",
            alignItems: "center",
            background:
              "linear-gradient(to right, rgb(5, 117, 230), rgb(2, 27, 121))",
            fontFamily: "Noto Serif JP, serif",
            fontSize: "38px",
            outline: "7px ridge rgba(0, 0, 0, 1.0)",
            color: "white",
            zIndex: 1,
          }}
        >
          {reduxCurrentPlayPoints} / {reduxMaxPlayPoints}
        </div>
        <div
          style={{
            height: "42px",
            width: "190px",
            display: "flex",
            justifyContent: "space-evenly",
            alignItems: "center",
            background:
              "linear-gradient(to right, rgb(5, 117, 230), rgb(2, 27, 121))",
            fontFamily: "Noto Serif JP, serif",
            fontSize: "30px",
            outline: "3px ridge rgba(0, 0, 0, 1.0)",
            color: "white",
            zIndex: 1,
          }}
        >
          <div
            style={{
              fontFamily: "Noto Serif JP, serif",
              fontSize: "20px",
            }}
          >
            EP
          </div>
          <StyledRating
            name="customized-color"
            value={ep}
            max={3}
            readOnly={automated}
            onChange={(event, newValue) => {
              if (automated) return;
              handleEP(newValue);
            }}
            icon={<FiberManualRecordIcon fontSize="inherit" />}
            emptyIcon={<FiberManualRecordOutlinedIcon fontSize="inherit" />}
          />
        </div>
        <div
          style={{
            cursor: automated ? "default" : "pointer",
            height: "58px",
            width: "116px",
            zIndex: 1,
          }}
          onClick={automated ? undefined : () => handleSuperEvo()}
        >
          {sepLit ? (
            <div>
              <img height={58} width={116} src={sepOn} alt={"sep"} />
            </div>
          ) : (
            <div>
              <img height={58} width={116} src={sepOff} alt={"sep"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
