# Duelel — servidor de produção

Corrida de digitação em tempo real. Backend em **Node + WebSocket**, ranking em
**SQLite** (um arquivo, sem serviço externo). Os modos **Sozinho** e **30 segundos**
rodam no navegador; o **duelo online** e o **ranking** passam pelo servidor.

```
duelel/
├── server.js            # servidor HTTP + WebSocket + SQLite
├── package.json         # dependências (ws, better-sqlite3)
├── public/
│   └── index.html       # o app inteiro (front-end)
├── Caddyfile            # HTTPS automático (jeito mais fácil)
└── deploy/
    ├── nginx-duelel.conf
    └── duelel.service   # systemd
```

## Como funciona (visão geral)

Hoje o app guarda tudo num "quadro compartilhado" e fica **perguntando** de tempos em
tempos "e aí, meu oponente digitou mais alguma coisa?". Isso é *polling*: funciona, mas
tem atraso e não escala. O **WebSocket** inverte isso.

Um WebSocket é uma **conexão que fica aberta** entre o navegador e o servidor. Diferente
de uma requisição HTTP normal (pergunta → resposta → fecha), aqui o cano continua ligado
nos dois sentidos. Quando seu oponente digita uma letra, o servidor **empurra** essa
informação pra você na hora, sem você precisar perguntar. É o que permite os dois carets
correrem praticamente em tempo real.

O fluxo de um duelo:

1. **Conexão** — ao abrir o site, o navegador abre um WebSocket com o servidor e manda um
   `hello` com seu nome, plataforma (mobile/desktop) e preferência de acentos.
2. **Fila** — em "Partida rápida" o navegador manda `quick_join`. O servidor guarda você
   numa fila identificada por `plataforma|acentos` (ex.: `desktop|com-acento`). Só encara
   quem está na **mesma** fila — é assim que a segregação por plataforma e por acentos é
   garantida **do lado do servidor**, sem depender do cliente.
3. **Match** — quando aparece um par compatível, o servidor sorteia o texto, define o
   horário de largada (`startAt`) e manda `match_found` para os dois ao mesmo tempo.
4. **Corrida** — cada letra digitada vira uma mensagem `progress` que o servidor
   **repassa** ao oponente (`opp_progress`). Quando você termina, manda `finished` com seu
   tempo. O servidor é quem **decide o vencedor** (quem completou em menos tempo), o que
   evita trapaça e dessincronização.
5. **Fim** — o servidor manda `race_over` para os dois com o placar, grava o PPM de cada um
   no ranking (SQLite) e libera as conexões.

**Salas privadas** são a mesma corrida, só que o pareamento é por um **código** (`room_create`
gera o código; o link `#sala=CODIGO` faz o convidado cair direto no `room_join`).

**Por que WebSocket e não Supabase:** o Supabase Realtime faria o mesmo papel de "empurrar
eventos", mas é um serviço externo (e você não tem vaga sobrando). Aqui o próprio Node faz
o tempo real, e o ranking mora num arquivo SQLite no mesmo servidor. Zero dependência de
serviço de terceiros.

## Rodar localmente

Precisa de **Node 18+**.

```bash
cd duelel
npm install
npm start
# abre http://localhost:8080
```

Para testar o duelo, abra em duas abas/dispositivos e clique em "Partida rápida" nas duas
(com a mesma preferência de acentos), ou crie uma sala numa aba e abra o link na outra.

> `better-sqlite3` compila um binário nativo no `npm install`. Se der erro, instale as
> ferramentas de build (`build-essential`/`python3` no Linux). Se ainda assim falhar, o
> servidor sobe mesmo assim — só o ranking fica desativado.

## Colocar no ar (cyberhat.com.br)

O front-end é estático, mas o servidor WebSocket precisa de um **processo Node rodando**.
Não dá pra hospedar só em hospedagem compartilhada comum — você precisa de um lugar que
rode Node de forma contínua. Opções:

- **VPS** (DigitalOcean, Hetzner, Contabo, uma droplet simples): melhor opção porque o
  arquivo SQLite fica num disco que persiste. É o que os arquivos em `deploy/` assumem.
- **PaaS** (Render, Railway, Fly.io): sobem `node server.js` num comando. Cuidado: em
  alguns planos o disco é efêmero e o `duelel.db` some a cada deploy — use um volume
  persistente se quiser manter o ranking.

### Passo a passo num VPS (subdomínio `duelel.cyberhat.com.br`)

1. **DNS**: crie um registro **A** apontando `duelel.cyberhat.com.br` para o IP do servidor.
2. **Código**: copie a pasta para o servidor (ex.: `/var/www/duelel`), rode `npm install`.
3. **Processo**: use o `deploy/duelel.service` (systemd) para manter o Node no ar:
   ```bash
   sudo cp deploy/duelel.service /etc/systemd/system/
   sudo systemctl daemon-reload && sudo systemctl enable --now duelel
   ```
4. **HTTPS + WebSocket**: o jeito mais fácil é o **Caddy** (TLS automático):
   ```bash
   # com o Caddyfile deste repo (ajuste o domínio):
   sudo caddy run --config Caddyfile
   ```
   Se preferir **Nginx**, use `deploy/nginx-duelel.conf` e gere o certificado com
   `certbot --nginx -d duelel.cyberhat.com.br`. O ponto crítico são as duas linhas de
   `Upgrade`/`Connection` — sem elas o WebSocket não conecta.

Pronto: `https://duelel.cyberhat.com.br` serve o app e o WebSocket usa `wss://` no mesmo
domínio automaticamente (o front detecta http/https sozinho).

### Subpasta em vez de subdomínio?

Funciona, mas dá mais trabalho: você precisa fazer o proxy de `/duelel/` **e** de
`/duelel/ws` para o Node, e servir os estáticos com esse prefixo. Subdomínio é mais limpo —
recomendo.

## O que dá pra evoluir depois

- **Validação de pontuação**: hoje o cliente informa o PPM. Para um ranking "sério", o
  servidor deveria recalcular a partir do texto e do tempo, e/ou exigir login.
- **Contas de usuário**: o ranking usa um id salvo no navegador (localStorage). Limpar o
  navegador cria um novo jogador. Login resolveria isso.
- **Reconexão automática** e **rematch dentro da sala** sem recriar o link.
- **Escala horizontal**: com muita gente, várias instâncias do Node exigiriam um Redis para
  compartilhar filas/salas. Para começar, uma instância aguenta tranquilo.
