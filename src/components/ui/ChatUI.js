import React, { useState, useEffect, useRef } from "react";
import ChatIcon from "@mui/icons-material/Chat";
import { Snackbar, IconButton, SnackbarContent } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import {
  Button,
  Paper,
  TextField,
  Typography,
  Box,
} from "@mui/material";
import { useDispatch, useSelector } from "react-redux";
import { setChat, setCurrentCard } from "../../redux/CardSlice";
import { cardImage } from "../../decks/getCards";

export default function ChatUI({ setHovering }) {
  const dispatch = useDispatch();
  const bottomRef = useRef(null);

  const [open, setOpen] = useState(true);
  const [openSnack, setOpenSnack] = useState(false);
  const [chatMessage, setChatMessage] = useState("");

  const reduxChatLog = useSelector((state) => state.card.chatLog);
  const reduxLastChatMessage = useSelector(
    (state) => state.card.lastChatMessage,
  );
  const playerSlot = useSelector((s) => s.gameState.playerSlot);
  const actionLog =
    useSelector((s) => s.gameState.engineView?.state?.actionLog) || [];

  useEffect(() => {
    if (reduxLastChatMessage !== "") setOpenSnack(true);
  }, [reduxLastChatMessage]);

  useEffect(() => {
    if (!open) return;
    bottomRef.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [open, actionLog.length, reduxChatLog.length]);

  const handleClick = () => {
    setOpen((prev) => {
      if (prev) {
        setHovering?.(false);
      }
      return !prev;
    });
  };

  const handleCardHoverStart = (name) => {
    if (!name) return;
    dispatch(setCurrentCard(name));
    setHovering?.(true);
  };

  const handleCardHoverEnd = () => {
    setHovering?.(false);
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.value !== "") {
      dispatch(setChat(e.target.value));
      setChatMessage("");
    }
  };

  const handleCloseSnack = (event, reason) => {
    if (reason === "clickaway") {
      return;
    }
    setOpenSnack(false);
  };

  const who = (player) => {
    if (playerSlot == null) return `P${player}`;
    return player === playerSlot ? "You" : "Opponent";
  };

  const action = (
    <React.Fragment>
      <IconButton
        size="small"
        aria-label="close"
        color="inherit"
        onClick={handleCloseSnack}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
    </React.Fragment>
  );

  if (!open) {
    return (
      <React.Fragment>
        {reduxLastChatMessage !== "" && (
          <Snackbar
            open={openSnack}
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "left",
            }}
            autoHideDuration={6000}
            onClose={handleCloseSnack}
          >
            <SnackbarContent
              style={{
                backgroundColor: "white",
                color: "black",
              }}
              message={<span id="client-snackbar">{reduxLastChatMessage}</span>}
              action={action}
            />
          </Snackbar>
        )}
        <Button variant="outlined" onClick={handleClick}>
          <ChatIcon sx={{ color: "white" }} />
        </Button>
      </React.Fragment>
    );
  }

  return (
    <Paper
      elevation={4}
      sx={{
        width: "100%",
        maxWidth: "20vw",
        height: "min(78vh, 820px)",
        display: "flex",
        flexDirection: "column",
        backgroundColor: "rgba(10, 18, 32, 0.94)",
        color: "white",
        borderRadius: 2,
        overflow: "hidden",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 1.5,
          py: 1,
          borderBottom: "1px solid rgba(255,255,255,0.15)",
          fontFamily: "Noto Serif JP, serif",
          fontSize: "1.2rem",
          flexShrink: 0,
        }}
      >
        Chat / Action Log
        <IconButton
          size="small"
          onClick={handleClick}
          sx={{ color: "white" }}
          aria-label="Close chat"
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      </Box>
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: 1.25,
          px: 1.25,
          py: 1.25,
        }}
      >
        {actionLog.length === 0 && reduxChatLog.length === 0 && (
          <Typography
            sx={{
              opacity: 0.6,
              fontSize: "1.05rem",
              fontFamily: "Noto Serif JP, serif",
            }}
          >
            Actions and chat will appear here.
          </Typography>
        )}
        {actionLog.map((entry) => {
          const mine = playerSlot != null && entry.player === playerSlot;
          return (
            <Box
              key={`action-${entry.seq}`}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1.25,
                px: 1.25,
                py: 1,
                borderRadius: 2,
                backgroundColor: mine
                  ? "rgba(229, 248, 254, 0.18)"
                  : "rgba(255, 238, 239, 0.16)",
              }}
            >
              {entry.cardName && cardImage(entry.cardName) && (
                <img
                  src={cardImage(entry.cardName)}
                  alt=""
                  onMouseEnter={() => handleCardHoverStart(entry.cardName)}
                  onMouseLeave={handleCardHoverEnd}
                  style={{
                    height: 52,
                    width: "auto",
                    borderRadius: 4,
                    cursor: "pointer",
                  }}
                />
              )}
              <Typography
                sx={{
                  fontWeight: 600,
                  lineHeight: 1.4,
                  fontSize: "1.08rem",
                  fontFamily: "Noto Serif JP, serif",
                  color: "white",
                  textAlign: "left",
                }}
              >
                <Box component="span" sx={{ opacity: 0.75 }}>
                  T{entry.turnNumber} · {who(entry.player)}{" "}
                </Box>
                {entry.text}
              </Typography>
            </Box>
          );
        })}
        {reduxChatLog.map((x, i) => (
          <Typography
            key={`chat-${i}-${x}`}
            sx={{
              fontSize: "1.08rem",
              lineHeight: 1.4,
              color: x[9] === "M" ? "#ff8a8a" : "#8ec8ff",
              whiteSpace: "pre-line",
              fontFamily: "Noto Serif JP, serif",
              textAlign: "left",
            }}
          >
            {x}
          </Typography>
        ))}
        <div ref={bottomRef} />
      </Box>
      <TextField
        style={{ padding: "0.75em 1em 1em" }}
        id="fullWidth"
        inputProps={{
          maxLength: 50,
          style: { fontSize: "1.08rem", color: "white" },
        }}
        InputLabelProps={{ style: { color: "rgba(255,255,255,0.7)" } }}
        sx={{
          flexShrink: 0,
          "& .MuiOutlinedInput-root": {
            "& fieldset": { borderColor: "rgba(255,255,255,0.25)" },
            "&:hover fieldset": { borderColor: "rgba(255,255,255,0.45)" },
            "&.Mui-focused fieldset": {
              borderColor: "rgba(255,255,255,0.65)",
            },
          },
        }}
        value={chatMessage}
        onChange={(e) => {
          setChatMessage(e.target.value);
        }}
        onKeyPress={(e) => {
          if (e.key === "Enter") handleChange(e);
        }}
      />
    </Paper>
  );
}
