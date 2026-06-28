# Bingo Night 🎯

A real-time multiplayer version of the **house-style Indian Bingo** — the one you
play at home on a hand-drawn 5×5 grid, taking turns to call numbers until someone
gets five lines and shouts **BINGO!**

> Not Tambola/Housie (the 90-number caller game). This is the simpler family
> version: everyone has their own 5×5 board, players take turns calling numbers,
> and the first to complete 5 lines wins.

## How it plays

- Each player gets a **5×5 grid** filled with the numbers **1–25** in a random order.
- Players sit in a circle and take turns. On your turn you **call any number
  1–25 that hasn't been called yet** — pick the one that helps your own board.
- **Everyone** marks the called number on their grid.
- A **line** is any fully-marked row, column, or diagonal (12 possible).
- The first player to complete **5 lines** spells **B-I-N-G-O** and wins.
- If two or more players hit 5 lines on the **same call**, it's a **draw**.

## Features

- **Open lobby** — no room codes. Start a game and it's publicly listed; anyone
  taps to join.
- **Host controls** — the host starts the game and can remove (kick) players.
- **No login** — just enter a name. Your identity (`name + timestamp`) is kept in
  the browser for the session, so a refresh keeps you in the game.
- **Rejoin** — drop out (refresh, phone lock, flaky network) and you're put right
  back into the same in-progress game. Your seat is held and your turn is skipped
  while you're away; the room (and host role) survive a brief disconnect via a
  short grace window (`REJOIN_GRACE_MS`, default 45s).
- **Mobile-first UI** — built for phone screens, big tap targets, no desktop assumptions.
- **Authoritative server** — grids, draws, turn order and win/draw detection all
  run on the server, so the game can't be faked from the client.
- **Robust** — handles disconnects (turns are skipped), host leaving (host is
  reassigned), and empty rooms (auto-removed).

## Run it

```bash
npm install
npm start          # http://localhost:3000
# or: npm run dev  (auto-restart on change)
```

Open the URL on a few phones/tabs on the same network, enter different names, and
play. (Set `PORT` to change the port.)

## Test

```bash
npm test           # node's built-in test runner
```

Covers grid generation, line counting, win/draw detection, turn enforcement,
kicking, host reassignment and room cleanup.

## Deploy to Render

This repo includes a Render Blueprint (`render.yaml`), so deploying is mostly clicks:

1. Push to GitHub (the Blueprint deploys the `main` branch).
2. Go to **render.com → New → Blueprint**, pick this repo, and apply.
   Render reads `render.yaml` and creates the web service for you.
3. You get a `https://<name>.onrender.com` URL. Every push to `main` auto-deploys
   — no CI/CD to maintain.

Prefer not to use the Blueprint? **New → Web Service**, pick the repo, and set
Build = `npm install`, Start = `npm start`. Render auto-detects the rest.

Notes:
- **WebSockets** work out of the box on Render — no extra config.
- **Single instance only.** Game state lives in memory, so the service must not
  be scaled past one instance (`numInstances: 1` in the Blueprint). Two instances
  would not share rooms.
- **Free tier** sleeps after ~15 min idle and cold-starts on the next visit;
  any in-progress game is lost when it sleeps or redeploys. Upgrade to a paid
  instance to keep it always-on.
- `/health` is wired up as the Render health check.

## Project layout

```
server/
  game.js     Pure game logic (grid, lines, win, validation) — fully unit-tested
  rooms.js    In-memory room/lobby/turn manager
  server.js   Express + Socket.IO wiring and event handlers
public/
  index.html  Single-page app shell (name → lobby → room → game)
  styles.css  Mobile-first styles
  app.js       Client: socket events + rendering
test/
  game.test.js
```

## Tech

Node + Express + Socket.IO on the back end; vanilla HTML/CSS/JS on the front end
(no build step). Game state lives in memory — rooms exist only while people are
playing, just like a real Bingo night.
