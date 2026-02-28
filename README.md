# Chess-4 (Board + WebSocket Chat)

This project provides a **four-player chess board UI** based on your reference layout and a **WebSocket chatroom** that supports:

- global messages to everyone
- private messages to a selected user

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Notes

- The board is currently visual + initial piece placement only.
- Chat uses a WebSocket server implemented directly with Node's built-in modules.
