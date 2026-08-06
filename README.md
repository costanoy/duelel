# Duelel

Real-time typing race. Simple idea: a typing game, but racing directly against another person.

**Live at:** https://duelel.cyberhat.com.br

This project started back in October 2021, as my first web game. Since then, with everything I've learned working as a dev, I decided to rebuild it from scratch — putting that knowledge into practice and improving on what used to be a simple site with a typing game.

## What you can do

- Online duel against another person, either through quick match (automatic matchmaking) or a private room via link
- Solo practice, in two formats: a fixed text to finish, or 30 seconds racing against the clock
- Leaderboard with best WPM, split by platform
- Interface in PT-BR and EN, auto-detected from the browser's language
- Installable as a PWA (works offline in the solo/timed modes) and packaged for Google Play (still in closed testing before release)

## Stack

**Front-end:** plain HTML/CSS/JS. Wanted to see how far I could take it without React/Vue, and it ended up keeping the app light and fast to load.

**Back-end:** Node.js with the native `http` module serving static files, `ws` handling the WebSocket side (matchmaking, rooms, real-time race sync), and `better-sqlite3` storing the leaderboard.

**Deploy:** Railway, auto-deploying on every push to GitHub.

## How the multiplayer works

- When you join the queue, the server groups you with compatible players (same platform, same accent preference on the Portuguese version, same language).
- The countdown only starts once both players confirm ready — the server then rolls the start time and sends the text to both at once. Every keystroke gets relayed to the opponent over WebSocket, and the server itself decides the winner (by completion time), so the client can't lie about the result.

## Running locally

```bash
npm install
npm start
```

Opens at `http://localhost:8080`. To test a duel, open two tabs (or two devices on the same network).

If `better-sqlite3` fails to build on your system, the server still starts — just the leaderboard gets disabled, everything else works normally.

## Structure

```
server.js                  server (http + websocket + sqlite)
package.json
public/
  index.html                the whole app — front-end, no build step
  manifest.webmanifest      PWA
  sw.js                     service worker (offline cache for solo/timed modes)
  icons/                    app icons
  privacidade.html          privacy policy
Caddyfile, deploy/          reference configs (nginx, systemd) for anyone self-hosting on a VPS
```
