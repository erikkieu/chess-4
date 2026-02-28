# Chess-4 (Board + WebSocket Chat)

This project provides a **four-player chess board UI** and a **WebSocket lobby/chat** that supports:

- global messages to everyone
- private messages to a selected user
- 4 player slots (gold/red/blue/green)
- ready-up flow; game starts only when all 4 players are ready
- randomized first turn when the match starts
- synchronized piece movement for all clients using chess-like movement rules (rook/knight/bishop/queen/king/pawn)

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Connect from other devices

Yes. The server listens on port `3000` and can be reached from other devices on the same network using your machine IP, e.g. `http://192.168.x.x:3000` (if firewall/network rules allow it).

## Notes

- Turn order rotates: gold → red → blue → green.
- If a player disconnects during a game, the match resets and everyone must ready up again.
- Advanced rules (check/checkmate, castling, en passant) are not implemented yet.
