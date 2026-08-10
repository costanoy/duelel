# Duelel

<<<<<<< HEAD
Real-time typing race. Simple idea: a typing game, but racing directly against another person.
=======
Corrida de digitação em tempo real. A ideia é simples: um jogo de digitação, mas competindo direto contra outra pessoa.
>>>>>>> c1cd04011979bc5350baf3a5dc6e43e725fc44a6

**Live at:** https://duelel.cyberhat.com.br

<<<<<<< HEAD
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
=======
Esse projeto nasceu em outubro de 2021, como o meu primeiro jogo para Web. Desses anos para cá, com tudo o que aprendi trabalhando como dev, decidi refazer o jogo do zero, colocando o meu conhecimento em prática e melhorando tudo o que era antes um site simples com um jogo de digitação.

## O que dá pra fazer no jogo

- Duelo online contra outra pessoa, via partida rápida (matchmaking automático) ou sala privada por link
- Treino sozinho, em dois formatos: um texto fixo pra terminar ou 30 segundos correndo contra o relógio
- Ranking com melhores PPM, separado por plataforma
- Interface em PT-BR e EN, com detecção automática pelo idioma do navegador
- Instalável como PWA (funciona offline nos modos solo/tempo) e empacotado pra Google Play (ainda em fase de testes antes de ser lançado)

## Stack

**Front-end:** HTML/CSS/JS puro. Queria ver até onde dava pra levar sem React/Vue, e no fim ajudou a manter o app leve e rápido de carregar.

**Back-end:** Node.js com o módulo `http` nativo servindo os arquivos estáticos, `ws` cuidando do WebSocket (matchmaking, salas, sincronização da corrida em tempo real) e `better-sqlite3` guardando o ranking.

**Deploy:** Railway, com deploy automático a cada push no GitHub.

## Como funciona o multiplayer

- Ao entrar na fila, o servidor te agrupa com jogadores compatíveis (mesma plataforma, mesma preferência de acento na versão em português, mesmo idioma).
- Só quando os dois confirmam é que o servidor sorteia o horário de largada e manda o texto pros dois ao mesmo tempo. Cada tecla digitada é retransmitida pro adversário via WebSocket, e o próprio servidor decide o vencedor (por tempo de conclusão) evitando que o cliente minta sobre o resultado.

## Rodando local
>>>>>>> c1cd04011979bc5350baf3a5dc6e43e725fc44a6

```bash
npm install
npm start
```

Opens at `http://localhost:8080`. To test a duel, open two tabs (or two devices on the same network).

<<<<<<< HEAD
If `better-sqlite3` fails to build on your system, the server still starts — just the leaderboard gets disabled, everything else works normally.

## Structure
=======
Se o `better-sqlite3` não compilar no seu sistema, o servidor sobe do mesmo jeito, só o ranking fica desativado, o resto funciona normal.

## Estrutura
>>>>>>> c1cd04011979bc5350baf3a5dc6e43e725fc44a6

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
