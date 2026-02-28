# Netlify deployment settings for this project

This repository has a Node.js WebSocket server (`server.js`) and static frontend files in `public/`.

## Important limitation

Netlify Hosting serves static files and serverless functions. It **does not run a long-lived WebSocket server like `node server.js`** as part of a normal site deploy.

That means:
- You can deploy the frontend UI on Netlify.
- You should host `server.js` on a separate backend host (Render, Railway, Fly.io, VPS, etc.).
- The frontend must connect to that backend WebSocket URL.

## Netlify UI values (Build & deploy settings)

Use these values in the Netlify project settings:

- **Runtime:** Node.js 20
- **Base directory:** `.`
- **Package directory:** *(leave empty)*
- **Build command:** `echo 'No build step required'`
- **Publish directory:** `public`
- **Functions directory:** `netlify/functions`
- **Deploy log visibility:** your preference (Public or Private)
- **Build status:** Active builds

These values are also encoded in `netlify.toml`.

## What to do next

1. Deploy this repo to Netlify (frontend only).
2. Deploy `server.js` somewhere that supports persistent Node/WebSocket processes.
3. Update the frontend WebSocket endpoint to point to that backend URL before production use.


## Production URL for this project

The frontend is deployed at:

- `https://semlastudios.netlify.app/`

Because this host is HTTPS, your game backend must expose a secure WebSocket endpoint (`wss://...`).

Quick override options supported by `public/app.js`:

1. Query string (temporary):
   - `https://semlastudios.netlify.app/?ws=wss://<your-backend-host>`
2. Global variable (persistent, in `index.html` before `app.js`):
   - `window.CHESS_WS_URL = 'wss://<your-backend-host>'`


## Render quick setup for `server.js`

Use Render for the persistent Node/WebSocket backend:

- Service type: **Web Service**
- Runtime: **Node**
- Build command: `npm install`
- Start command: `npm start`
- Environment variable: `PORT` is optional (Render injects it; `server.js` reads `process.env.PORT`)

After deploy, point the Netlify UI to Render via:

- `?ws=wss://<your-render-domain>`
- or `window.CHESS_WS_URL = 'wss://<your-render-domain>'` before `app.js` loads.
