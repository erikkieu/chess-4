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

## Deploy `server.js` on Render

1. Push this repo to GitHub.
2. In Render, create a **Web Service** from that repo.
3. Set these values:
   - **Runtime:** `Node`
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance:** your preference (Free works for testing)
4. Add environment variable:
   - `PORT` = `10000` (Render also injects PORT automatically, and `server.js` already supports it)
5. Deploy and copy your backend URL, for example:
   - `https://your-chess-backend.onrender.com`

Your WebSocket URL is the same host with `wss://`, for example:
- `wss://your-chess-backend.onrender.com`

Then connect the frontend to Render using either:

- Query string (quick test):
  - `https://semlastudios.netlify.app/?ws=wss://your-chess-backend.onrender.com`
- Global variable in `public/index.html` (persistent):
  - `window.CHESS_WS_URL = "wss://your-chess-backend.onrender.com";`

## Netlify

For exact Netlify settings and deployment caveats for this app, see `NETLIFY_DEPLOY.md`.
