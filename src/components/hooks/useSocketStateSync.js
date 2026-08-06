import { useEffect } from "react";
import { store } from "../../redux/store";
import { socket } from "../../sockets";

const useSocketStateSync = () => {
  useEffect(() => {
    socket.on("send_full_state", ({ requesterId }) => {
      const { card, gameState } = store.getState();
      if (gameState.gameMode === "automated") return;
      console.log("[useSocketStateSync] received request from", requesterId);
      console.log("[useSocketStateSync] sending state, keys:", Object.keys(card).length);

      socket.emit("send_full_state", {
        requesterId,
        fullState: card,
      });
    });

    return () => {
      socket.off("send_full_state");
    };
  }, []);
};

export default useSocketStateSync;
