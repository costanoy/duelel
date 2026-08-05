# Duelel

Corrida de digitação em tempo real. A ideia é simples: um jogo de digitação, mas competindo direto contra outra pessoa.

**No ar:** https://duelel.cyberhat.com.br

Esse projeto nasceu em outubro de 2021, como o meu primeiro jogo para Web. Desses anos para cá, com tudo o que aprendi trabalhando como dev, decidi refazer o jogo do zero, colocando o meu conhecimento em prática e melhorando tudo o que era antes um site simples com um jogo de digitação.

## O que dá pra fazer no jogo

- Duelo online contra outra pessoa, via partida rápida (matchmaking automático) ou sala privada por link
- Treino sozinho, em dois formatos: um texto fixo pra terminar, ou 30 segundos correndo contra o relógio
- Ranking com melhores PPM, separado por plataforma
- Interface em PT-BR e EN, com detecção automática pelo idioma do navegador
- Instalável como PWA (funciona offline nos modos solo/tempo) e empacotado pra Google Play

## Stack

**Front-end:** HTML/CSS/JS puro, sem framework — um `index.html` só. Foi proposital: queria ver até onde dava pra levar sem React/Vue, e no fim ajudou a manter o app leve e rápido de carregar.

**Back-end:** Node.js com o módulo `http` nativo servindo os arquivos estáticos, `ws` cuidando do WebSocket (matchmaking, salas, sincronização da corrida em tempo real) e `better-sqlite3` guardando o ranking. Sem Express, sem framework de backend — só o necessário.

**Deploy:** Railway, com deploy automático a cada push no GitHub. Domínio próprio, DNS na Hostinger apontando via CNAME.

## Como funciona o multiplayer, por cima

Cada partida passa por três fases: fila → tela de "prontos?" → corrida.

1. Ao entrar na fila, o servidor te agrupa com jogadores compatíveis (mesma plataforma, mesma preferência de acento, mesmo idioma — celular não compete com teclado físico, e PT não cai contra EN).
2. Quando acha um par, cria a corrida mas **não** começa o cronômetro ainda — os dois precisam confirmar que estão prontos primeiro.
3. Só quando os dois confirmam é que o servidor sorteia o horário de largada e manda o texto pros dois ao mesmo tempo. Cada tecla digitada é retransmitida pro adversário via WebSocket, e o próprio servidor decide o vencedor (por tempo de conclusão) — evita que o cliente minta sobre o resultado.

## Rodando local

```bash
npm install
npm start
```

Abre em `http://localhost:8080`. Pra testar o duelo, abre duas abas (ou dois dispositivos na mesma rede).

Se o `better-sqlite3` não compilar no seu sistema, o servidor sobe do mesmo jeito — só o ranking fica desativado, o resto funciona normal.

## Algumas decisões que talvez pareçam estranhas

- **Letra errada trava o cursor.** Sem isso, dava pra "vencer" só martelando o teclado até bater a quantidade de caracteres, mesmo digitando lixo. Agora só avança com o prefixo 100% correto.
- **"Sem acentos" não é a mesma coisa que tirar o acento de qualquer palavra.** Fazer isso transforma "mãe" em "mae", que não é uma palavra de verdade em português. O certo é sortear só entre as palavras que já são naturalmente sem acento.
- **Caps Lock não deveria quebrar o jogo.** A comparação de caracteres ignora maiúscula/minúscula — digitar tudo em caixa alta por acidente não te bloqueia.

## Estrutura

```
server.js                  servidor (http + websocket + sqlite)
package.json
public/
  index.html                o app inteiro — front-end, sem build step
  manifest.webmanifest      PWA
  sw.js                     service worker (cache offline pros modos solo/tempo)
  icons/                    ícones do app
  privacidade.html          política de privacidade
Caddyfile, deploy/          configs de referência (nginx, systemd) pra quem for hospedar num VPS
```

## O que eu sei que falta

- A validação de pontuação no modo solo roda inteiramente no cliente — dá pra trapacear editando o JS no console. Pra um projeto de portfólio, não achei que valia a pena resolver isso agora (exigiria recalcular tudo no servidor, incluindo o texto gerado).
- Não tem conta de usuário. Cada jogador é identificado por um ID aleatório salvo no `localStorage` — some se limpar os dados do navegador.
- iOS não é suportado como app nativo (só funciona como PWA pelo Safari). Publicar na App Store exigiria Mac + assinatura anual, então por enquanto ficou só no Google Play.

## Licença

MIT. Usa, copia, faz o que quiser.
