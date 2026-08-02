import React, { useMemo, useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  List,
  ListItemButton,
  ListItemText,
} from "@mui/material";
import { useSelector } from "react-redux";
import { useEngineSync } from "../hooks/useEngineSync";

export default function TestingPanel() {
  const testingMode = useSelector((s) => s.gameState.testingMode);
  const playerSlot = useSelector((s) => s.gameState.playerSlot);
  const engineView = useSelector((s) => s.gameState.engineView);
  const { sendAction } = useEngineSync();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");

  const self = engineView?.state?.players?.[playerSlot];
  const deck = self?.zones?.deck ?? [];
  const pp = self?.pp ?? 0;
  const maxPp = self?.maxPp ?? 0;
  const life = self?.leaderDef ?? 0;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return deck;
    return deck.filter((c) => String(c.name || "").toLowerCase().includes(q));
  }, [deck, query]);

  if (!testingMode) return null;

  return (
    <>
      <Box
        sx={{
          position: "fixed",
          top: 16,
          right: 16,
          zIndex: 1200,
          backgroundColor: "rgba(10, 14, 20, 0.92)",
          border: "1px solid rgba(72, 171, 224, 0.55)",
          borderRadius: "10px",
          padding: "12px 14px",
          color: "#daf6ff",
          minWidth: 220,
          fontFamily: "Noto Serif JP, serif",
        }}
      >
        <Typography variant="subtitle2" sx={{ mb: 1, color: "#7fd0ff" }}>
          Testing Mode
        </Typography>
        <Typography variant="caption" sx={{ display: "block", mb: 1, opacity: 0.85 }}>
          PP {pp}/{maxPp} · Life {life} · Deck {deck.length}
        </Typography>
        <Stack spacing={1}>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => sendAction({ type: "DEBUG_ADJUST_PP", delta: -1 })}>
              PP −
            </Button>
            <Button size="small" variant="outlined" onClick={() => sendAction({ type: "DEBUG_ADJUST_PP", delta: 1 })}>
              PP +
            </Button>
          </Stack>
          <Stack direction="row" spacing={1}>
            <Button size="small" variant="outlined" onClick={() => sendAction({ type: "DEBUG_ADJUST_LIFE", delta: -1 })}>
              Life −
            </Button>
            <Button size="small" variant="outlined" onClick={() => sendAction({ type: "DEBUG_ADJUST_LIFE", delta: 1 })}>
              Life +
            </Button>
          </Stack>
          <Button
            size="small"
            variant="contained"
            onClick={() => {
              setQuery("");
              setSearchOpen(true);
            }}
          >
            Search Deck
          </Button>
        </Stack>
      </Box>

      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Search your deck</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            margin="dense"
            label="Filter by name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <List dense sx={{ maxHeight: 360, overflow: "auto", mt: 1 }}>
            {filtered.map((card) => (
              <ListItemButton
                key={card.instanceId}
                onClick={() => {
                  sendAction({ type: "DEBUG_TUTOR_FROM_DECK", instanceId: card.instanceId });
                  setSearchOpen(false);
                }}
              >
                <ListItemText primary={card.name} secondary={card.instanceId} />
              </ListItemButton>
            ))}
            {filtered.length === 0 && (
              <Typography variant="body2" sx={{ p: 2, opacity: 0.7 }}>
                No matching cards in deck.
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearchOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
