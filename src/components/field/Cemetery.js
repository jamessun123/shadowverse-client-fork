import React, { useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useEngineSync } from "../hooks/useEngineSync";
import { useUiModalOpen } from "../hooks/useUiChromeVisible";
import { ModalHideUiRow } from "../ui/HideUiButton";
import { cardImage } from "../../decks/getCards";
import { socket } from "../../sockets";
import {
  Menu,
  MenuItem,
  Modal,
  Box,
  Radio,
  RadioGroup,
  FormControlLabel,
  FormControl,
} from "@mui/material";
import CardMUI from "@mui/material/Card";
import Card from "../hand/Card";
import {
  addToHandFromCemetery,
  addToHandFromBanish,
  addToBanishFromCemetery,
  placeToTopOfDeckFromCemetery,
  placeToBotOfDeckFromCemetery,
  setCurrentCard,
  setCurrentCardIndex,
  setViewingCemetery,
} from "../../redux/CardSlice";
// import cardback from "../../assets/cardbacks/default.png";
import "../../css/Card.css";

const img = require("../../assets/pin_bellringer_angel.png");

export default function Cemetery({
  setHovering,
  setReadyFromCemetery,
  setReadyFromBanish,
  setReady,
  ready,
}) {
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const modalOpen = useUiModalOpen(open);
  const [name, setName] = useState("");
  const [contextMenu, setContextMenu] = React.useState(null);
  const [cemeterySelected, setCemeterySelected] = useState(true);
  const [banishSelected, setBanishSelected] = useState(false);
  const [cardIndex, setCardIndex] = useState(-1);

  const reduxCemetery = useSelector((state) => state.card.cemetery);
  const cemeteryInstanceIds = useSelector((state) => state.card.cemeteryInstanceIds);
  const reduxBanish = useSelector((state) => state.card.banish);
  const reduxRoom = useSelector((state) => state.card.room);
  const gameMode = useSelector((state) => state.gameState.gameMode);
  const legalActions = useSelector((state) => state.gameState.legalActions) ?? [];
  const activateOptions = useSelector((state) => state.gameState.activateOptions) ?? [];
  const leaderActive = useSelector((state) => state.card.leaderActive);
  const pendingChoices = useSelector((state) => state.gameState.pendingChoices);
  const automated = gameMode === "automated";
  const { sendAction } = useEngineSync();

  const handleModalOpen = () => {
    if ((reduxCemetery.length > 0 || reduxBanish.length > 0) && !ready) {
      setOpen(true);
      dispatch(setViewingCemetery(true));
    }
  };
  const handleModalClose = () => {
    setOpen(false);
    dispatch(setViewingCemetery(false));
  };

  const handleContextMenu = (event, name, index) => {
    setName(name);
    setCardIndex(index);
    dispatch(setCurrentCard(name));
    dispatch(setCurrentCardIndex(index));
    event.preventDefault();
    setContextMenu(
      contextMenu === null
        ? {
            mouseX: event.clientX + 2,
            mouseY: event.clientY - 6,
          }
        : null
    );
  };

  const handleClose = () => {
    setContextMenu(null);
  };

  const handleToTopOfDeckFromCemetery = () => {
    handleClose();
    dispatch(placeToTopOfDeckFromCemetery({ name: name, index: cardIndex }));
  };
  const handleToBotOfDeckFromCemetery = () => {
    handleClose();
    dispatch(placeToBotOfDeckFromCemetery({ name: name, index: cardIndex }));
  };

  const handleCardToFieldFromCemetery = () => {
    handleModalClose();
    handleClose();
    setReady(true);
    setReadyFromCemetery(true);
  };

  const handleCardToBanishFromCemetery = () => {
    handleClose();
    dispatch(addToBanishFromCemetery({ name: name, index: cardIndex }));
  };

  const getCemeteryActivateOptions = (instanceId) => {
    const fromView = activateOptions.filter(
      (o) => o.instanceId === instanceId && o.zone === "cemetery",
    );
    if (fromView.length > 0) return fromView;
    const opts = [];
    for (const action of legalActions) {
      if (action.startsWith(`ACTIVATE_CEMETERY:${instanceId}:`)) {
        opts.push({
          abilityKey: action.slice(`ACTIVATE_CEMETERY:${instanceId}:`.length),
          label: "Activate",
        });
      }
    }
    if (opts.length === 0 && legalActions.includes(`ACTIVATE_CEMETERY:${instanceId}`)) {
      opts.push({ label: "Activate" });
    }
    return opts;
  };

  const handleAutomatedActivateFromCemetery = (opt) => {
    if (!automated || cardIndex < 0) return;
    const instanceId = cemeteryInstanceIds[cardIndex];
    if (!instanceId) return;
    const options = getCemeteryActivateOptions(instanceId);
    const chosen = opt || (options.length === 1 ? options[0] : null);
    if (!chosen) return;
    sendAction({
      type: "ACTIVATE_CEMETERY",
      cemeteryInstanceId: instanceId,
      abilityKey: chosen.abilityKey,
    });
    handleClose();
    handleModalClose();
  };

  const cemeteryActivateOpts =
    automated &&
    leaderActive &&
    !pendingChoices &&
    cardIndex >= 0 &&
    cemeteryInstanceIds[cardIndex]
      ? getCemeteryActivateOptions(cemeteryInstanceIds[cardIndex])
      : [];

  const handleCardToHandFromCemetery = () => {
    handleModalClose();
    handleClose();
    dispatch(addToHandFromCemetery({ name: name, index: cardIndex }));
    socket.emit("send msg", {
      type: "showCard",
      data: true,
      room: reduxRoom,
    });
    socket.emit("send msg", {
      type: "cardRevealed",
      data: name,
      room: reduxRoom,
    });
  };

  const handleCardToFieldFromBanish = () => {
    handleModalClose();
    handleClose();
    setReady(true);
    setReadyFromBanish(true);
  };

  const handleCardToHandFromBanish = () => {
    handleModalClose();
    handleClose();
    dispatch(addToHandFromBanish({ name: name, index: cardIndex }));
    socket.emit("send msg", {
      type: "showCard",
      data: true,
      room: reduxRoom,
    });
    socket.emit("send msg", {
      type: "cardRevealed",
      data: name,
      room: reduxRoom,
    });
  };

  const handleCemeterySelected = () => {
    setCemeterySelected(true);
    setBanishSelected(false);
  };
  const handleBanishSelected = () => {
    setCemeterySelected(false);
    setBanishSelected(true);
  };

  return (
    <>
      <div
        onClick={handleModalOpen}
        style={{
          // height: "160px",
          // width: "115px",
          // backgroundColor: "#131219",
          borderRadius: "10px",
          // border: "4px solid #0000",
          border: "4px solid #1a20d6c8",
          cursor: `url(${img}) 55 55, auto`,
          position: "relative",
        }}
        className={"cardStyle"}
      >
        {reduxCemetery && reduxCemetery.length > 0 && (
          <img
            className={"cardStyle"}
            src={cardImage(reduxCemetery[0])}
            alt={"cardback"}
          />
        )}
        <div
          style={{
            width: "50px",
            position: "absolute",
            backgroundColor: "rgba(0, 0, 0, 0.4)",
            top: "70%",
            right: "27%",
            color: "rgba(255, 255, 255, 1)",
            fontSize: "30px",
            fontFamily: "Noto Serif JP, serif",
          }}
        >
          {reduxCemetery.length || 0}
        </div>
      </div>

      <Modal
        open={modalOpen}
        onClose={handleModalClose}
        aria-labelledby="modal-modal-title"
        aria-describedby="modal-modal-description"
        sx={{
          "& > .MuiBackdrop-root": {
            backgroundColor: "transparent",
          },
        }}
      >
        <Box
          sx={{
            position: "relative",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "transparent",
            // boxShadow: 24,
            // p: 3,
            width: "40%",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <ModalHideUiRow onHide={handleModalClose} />
          <FormControl>
            <RadioGroup
              row
              aria-labelledby="demo-row-radio-buttons-group-label"
              name="row-radio-buttons-group"
            >
              <FormControlLabel
                checked={cemeterySelected}
                onChange={handleCemeterySelected}
                sx={{ fontFamily: "Noto Serif JP, serif", color: "white" }}
                value={cemeterySelected}
                control={<Radio />}
                label="Cemetery"
              />
              <FormControlLabel
                checked={banishSelected}
                onChange={handleBanishSelected}
                sx={{ fontFamily: "Noto Serif JP, serif", color: "white" }}
                value={banishSelected}
                control={<Radio />}
                label="Banish"
              />
            </RadioGroup>
          </FormControl>
          <CardMUI
            sx={{
              backgroundColor: "rgba(0, 0, 0, 0.7)",
              minHeight: "250px",
              padding: "7%",
              height: "500px",
              overflowY: "scroll",
              width: "100%",
              display: "flex",
              flexDirection: "row",
              flexWrap: "wrap",
              justifyContent: "center",
              alignItems: "center",
            }}
            variant="outlined"
          >
            {cemeterySelected &&
              reduxCemetery.map((card, index) => (
                <div
                  key={`card-${index}`}
                  onContextMenu={(e) => {
                    handleContextMenu(e, card, index);
                  }}
                >
                  <Card
                    //   key={`card-${idx}`}
                    ready={ready}
                    name={card}
                    setHovering={setHovering}
                  />
                </div>
              ))}
            {banishSelected &&
              reduxBanish.map((card, index) => (
                //<div key={`card-${idx}`} style={{ width: "115px" }}>
                <div
                  key={`card-${index}`}
                  style={{ width: "115px" }}
                  onContextMenu={(e) => {
                    handleContextMenu(e, card, index);
                  }}
                >
                  <Card
                    evolvedUsed={true}
                    ready={ready}
                    name={card}
                    setHovering={setHovering}
                  />
                </div>
              ))}
          </CardMUI>
        </Box>
      </Modal>

      {(reduxCemetery.length > 0 || reduxBanish.length > 0) && (
        <Menu
          open={contextMenu !== null}
          onClose={handleClose}
          anchorReference="anchorPosition"
          anchorPosition={
            contextMenu !== null
              ? { top: contextMenu.mouseY - 120, left: contextMenu.mouseX - 35 }
              : undefined
          }
          anchorOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
          transformOrigin={{
            vertical: "top",
            horizontal: "left",
          }}
        >
          {cemeterySelected &&
            cemeteryActivateOpts.map((opt) => (
              <MenuItem
                key={`cem-act-${opt.abilityKey}`}
                onClick={() => handleAutomatedActivateFromCemetery(opt)}
              >
                {opt.label}
              </MenuItem>
            ))}
          {cemeterySelected && !automated && (
            <MenuItem onClick={handleCardToHandFromCemetery}>Hand</MenuItem>
          )}
          {cemeterySelected && !automated && (
            <MenuItem onClick={handleCardToFieldFromCemetery}>Field</MenuItem>
          )}
          {cemeterySelected && !automated && (
            <MenuItem onClick={handleToTopOfDeckFromCemetery}>
              Top of Deck
            </MenuItem>
          )}
          {cemeterySelected && !automated && (
            <MenuItem onClick={handleToBotOfDeckFromCemetery}>
              Bot of Deck
            </MenuItem>
          )}
          {cemeterySelected && !automated && (
            <MenuItem onClick={handleCardToBanishFromCemetery}>Banish</MenuItem>
          )}
          {banishSelected && !automated && (
            <MenuItem onClick={handleCardToHandFromBanish}>Hand</MenuItem>
          )}
          {banishSelected && !automated && (
            <MenuItem onClick={handleCardToFieldFromBanish}>Field</MenuItem>
          )}
        </Menu>
      )}
    </>
  );
}
