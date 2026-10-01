# Handoff: Duelel — redesign "transmissão de e-sports"

## Visão geral
Novo visual para o Duelel (https://duelel.cyberhat.com.br), jogo de corrida de digitação 1×1 no navegador. A partida é tratada como uma transmissão ao vivo: você à esquerda em âmbar, o oponente à direita em ciano, tela de VS, score bug durante a corrida e ranking no estilo da torre de tempos da F1. Todo o estilo fica **em volta** do texto da corrida, que continua limpo e calmo.

O briefing original está em `briefing-original.md`.

## Sobre os arquivos de design
Os arquivos `.dc.html` são **referências de design feitas em HTML**, e não código de produção. Abra-os no navegador (eles precisam do `support.js` na mesma pasta) para ver cada tela em desktop (1440px) e celular (390px).

A tarefa é **recriar esse visual no código real do Duelel**, que é **um único arquivo HTML com CSS e JS puros**, sem framework e sem build. Não introduza React nem bibliotecas. Nos mocks os estilos estão inline; no código real, use as classes de `duelel-broadcast.css`.

## Fidelidade
**Alta fidelidade.** Cores, tipografia, espaçamentos, chanfros e textos são finais. Os nomes (marina, kenji_42), os PPMs e a lista do ranking são dados de exemplo.

## Arquivos
- `duelel-broadcast.css`: **comece por aqui.** Tem os tokens (`:root`) e todos os componentes (cabeçalho, botões, cartões de modo, segmentado, score bug, barras, texto da corrida, chips de recorde, torre do ranking) e os `@keyframes`. Pode ser colado direto no `<style>` do index.
- `Duelel Telas 1-4.dc.html`: Início, Procurando oponente, Sala pronta, VS/Prontos?
- `Duelel Telas 5-9.dc.html`: Contagem, Corrida, Resultado, Ranking, Modo solo
- `Duelel Tokens.dc.html`: folha de tokens visual (paleta, tipografia, espaçamento, chanfros, animações)
- `Logo.dc.html`: logo refeita em CSS (provisória, até a logo final chegar)
- `support.js`: runtime necessário só para abrir os `.dc.html` no navegador. Não vai para produção.

## Tokens

### Cores
| token | hex | uso |
|---|---|---|
| --bg | #26272B | fundo (antes #28292D) |
| --ink | #1B1C1F | blocos escuros do placar, número da posição, texto sobre cores de time |
| --surface | #2E3036 | cartões, trilhos das barras |
| --surface-2 | #35373E | hover, botão secundário |
| --surface-lose | #2A2B30 | cartão do perdedor no resultado |
| --race-panel | #2C2E33 | painel do texto da corrida |
| --border | #393C45 | bordas, divisórias |
| --text | #E8E8E2 | texto principal / caractere digitado certo |
| --text-2 | #B5B9C2 | números do perdedor, textos de apoio mais fortes |
| --muted | #8B909C | texto secundário, rótulos |
| --untyped | #6A6F7C | caractere não digitado (antes #565B67, subiu por contraste) |
| --dim | #565B67 | só decorativo (travessão do título, "VS" apagado) |
| --p1 | #F2C14E | você (hover #F6D27A) |
| --p2 | #49C5E6 | oponente (borda tracejada do slot vazio #3E5A63) |
| --error | #E5533D | erro (fundo do caractere: 16% de alpha) |
| --record | #B07CF2 | recorde geral (roxo F1) |
| --pb | #5BD68A | recorde pessoal (verde F1) |

Texto sobre âmbar, ciano, roxo ou verde é sempre `#1B1C1F`.

### Tipografia (Google Fonts)
- **Barlow Condensed** 700/800 itálico, caixa alta: títulos, nomes de jogador, placar, botões, tags
- **JetBrains Mono** 400/500/700: texto da corrida, números, rótulos, links, abas
- **Inter** 400/500/600: descrições

| token | desktop | celular |
|---|---|---|
| display-xl (Você venceu!, Treino concluído) | Barlow 800i 96–104px / 1.0 | 56px / 0.95 |
| display-l (Procurando…, Sala pronta, Prontos?) | Barlow 800i 64–88px / 1.0 | 40–52px |
| nome no VS | Barlow 800i 112px / 0.9 | 68px |
| título do cartão de modo | Barlow 800i 40px / 0.95 | 30px |
| contagem | Barlow 800i 360px | 150px |
| botão | Barlow 700–800 20px, +0.08em | 18px |
| texto da corrida | JetBrains 400 30px / 1.8 | 20px / 1.7 |
| stat grande (PPM no resultado) | JetBrains 700 88px / 0.85 | 56–64px |
| PPM no score bug | JetBrains 700 28px | 18px |
| rótulo | JetBrains 500 12px, +0.12em, caixa alta | 11px |
| corpo | Inter 400 15–17px / 1.55 | 14–15px |

### Espaçamento
Escala de 4px: 4, 8, 12, 16, 24, 32, 48, 64. Margem lateral do cabeçalho: 48px no desktop e 16px no celular. Conteúdo do Início com largura máxima de 1120px. Coluna da corrida com 1040px.

### Chanfros, raios e sombras
- Chanfro via `clip-path`: 8px (pequeno), 12px (botões, cartões no celular), 16–20px (cartões grandes). As classes `.cut`, `.cut-br`, `.cut-tl` e `.cut-bl` estão no CSS.
- Cartões: chanfro nos cantos superior esquerdo e inferior direito. Botões: só no canto inferior direito.
- Raio 0 em tudo, exceto no logo.
- **Sem sombras projetadas.** Faixas de cor usam `box-shadow: inset` (4–6px na cor do time), e contornos usam `inset 0 0 0 1px`.
- Faixa de 3px no topo de cada tela, metade âmbar e metade ciano (`.top-stripe`).

## Telas

### 01 Início
- Cabeçalho em grid `1fr auto 1fr`: logo + wordmark (22px) à esquerda, PT | EN no centro (segmentado com fundo #2E3036 e ativo em #393C45), indicador "desktop"/"mobile" à direita (JetBrains 11px, caixa alta, bolinha de 6px).
- Linha com o campo **Nome** (rótulo em cima; faixa âmbar de 6px à esquerda + input #2E3036, 56px de altura, 400px de largura, JetBrains 20px, caret âmbar) à esquerda e o link **🏆 Ranking** (outline) à direita.
- Três cartões em grid de 3 colunas com gap de 20px, chanfro de 16px, padding de 32px e altura mínima de 300px. Faixa inferior de 4px: âmbar (online), ciano (privado), #565B67 (treino). O kicker `1 · online` fica na mesma cor. Seta "→" no rodapé dos cartões 1 e 2. O cartão 3 leva o segmentado Tempo / Texto / Texto Duelel (ativo em âmbar com texto escuro).
- Rodapé com borda superior e o texto de ppm (JetBrains 12px, #8B909C, centralizado).
- Celular: os cartões empilham e a faixa de cor passa para a esquerda (4px). Ranking vira um botão de largura total com 48px de altura.

### 02 Procurando oponente
Cartão do jogador (340×200, #2E3036, faixa âmbar de 6px à esquerda, chanfro inferior esquerdo, tag "Você" e nome em Barlow 56px) · "VS" em #565B67 · slot vazio do oponente (borda tracejada de 2px em #3E5A63, três quadrados ciano pulsando, rótulo "oponente"). Abaixo: título "Procurando oponente…", o subtítulo e o botão "cancelar" (JetBrains, outline). No celular, a pilha fica vertical.

### 03 Sala pronta
Coluna de 720px: tag ciano "2 · privado", título, subtítulo, campo do link (faixa ciano + #2E3036, JetBrains 18px, com a parte `s/xxxx` em ciano) e botão âmbar **Copiar link** colado à direita. O estado **Copiado ✓** fica com fundo #35373E e contorno âmbar de 1px. Volta ao normal depois de cerca de 2s. No celular, o botão desce e ocupa a largura total.

### 04 VS / Prontos?
- Tela dividida na diagonal: o painel esquerdo tem gradiente âmbar (14% → 2%) e o direito, ciano. Duas linhas finas (âmbar e ciano) marcam o corte, que vai de 54% no topo a 46% embaixo.
- "Prontos?" centralizado no topo (88px). Rótulo "partida encontrada" no cabeçalho.
- Cada lado tem tag (Você/Oponente), nome em 112px na cor do time e estado:
  - **pronto ✓**: fundo na cor do time, texto escuro
  - **aguardando…**: contorno de 1px na cor do time
- Selo "VS" central de 120px, fundo #E8E8E2, chanfrado.
- Celular: o corte é horizontal (você em cima, oponente embaixo) e o botão âmbar **toque para confirmar** ocupa a largura total no rodapé.

### 05 Contagem regressiva
A tela da corrida (zerada) fica embaixo de um overlay `rgba(27,28,31,.72)`. Os números 3, 2, 1 aparecem em #E8E8E2 e "Vai!" em âmbar (360px no desktop, 150px no celular), com a animação `count`. O texto fica visível por trás para o jogador já ler.

### 06 Corrida
- **Score bug** centralizado: [nome âmbar] [PPM âmbar] [relógio #1B1C1F] [PPM ciano] [nome ciano], com chanfro nas pontas externas.
- **Barras** de 8px, uma por jogador, com rótulo do nome à esquerda e % à direita.
- **Painel do texto**: #2C2E33, borda de 1px #393C45, padding 44/48, JetBrains 30px/1.8. Classes por caractere: `.ok` (digitado certo), `.err` (erro; o cursor trava até corrigir), `.cur` (cursor: barra âmbar de 2px à esquerda; só pisca quando o jogador está parado), `.opp` (oponente: sublinhado ciano de 3px).
- Rótulos "tempo" e "precisão" abaixo.
- Na corrida o cabeçalho completo some e fica só o símbolo do logo no canto.
- Celular: score bug de largura total com 44px de altura, barras de 4px, texto em 20px **no topo**, e a metade inferior fica livre para o teclado virtual.

### 07 Resultado
- Título "Você venceu! 🏆" (âmbar) ou "Você perdeu" (#E8E8E2).
- Dois cartões lado a lado (1000px, gap de 16px). O do **vencedor** tem fundo #2E3036, faixa superior de 6px na cor do time, tag "vencedor", números em #E8E8E2 e chanfro. O do **perdedor** tem fundo #2A2B30, faixa de 2px e números em #8B909C/#B5B9C2.
- Os dados de cada lado são PPM (88px), precisão e tempo.
- Chip "recorde geral" (roxo) ou "recorde pessoal" (verde) ao lado do PPM, quando for o caso.
- Botões: **Revanche** (primário), Jogar de novo (secundário), 🏆 Ranking (outline), Início (ghost).
- Quando o oponente pede revanche, o primário vira **Aceitar revanche 🔥**. Quando você pede, o botão vira uma caixa com contorno âmbar: "Revanche" + "Aguardando o oponente aceitar…".

### 08 Ranking
- Título "Ranking — Líderes" (travessão em #565B67) e botão "← voltar" à direita.
- 4 abas (JetBrains 13px): a ativa com fundo #E8E8E2 e texto escuro, as inativas com #2E3036. No celular, a linha de abas rola na horizontal.
- Torre com linhas de 42px e gap de 3px: posição num bloco #1B1C1F, faixa de 4px (roxo no 1º lugar, âmbar se for você, #393C45 nas demais), nome em Barlow 22px caixa alta, modo em JetBrains 12px muted e PPM à direita (roxo no 1º).
- Estados: **carregando** (4 linhas esqueleto com opacidade decrescente + "carregando…") e **vazio** (caixa tracejada com "Ninguém aqui ainda. Seja o primeiro!").

### 09 Modo solo
- Score bug só com você. O relógio fica maior (200px de largura, JetBrains 44px, rótulo "treino") e a barra única mostra o tempo decorrido em relação aos 30s.
- "Treino concluído": cartão único (PPM, precisão, tempo, chip de recorde pessoal) e os botões **De novo** (primário) e Início.

## Interações e animações
| o quê | detalhe | duração | easing |
|---|---|---|---|
| Entrada de tela | translateY 12px + fade | 180ms | cubic-bezier(.2,.8,.2,1) |
| VS | painéis ±40px, selo escala 1.3→1, escalonado 60ms | 320ms | idem |
| Pronto ✓ | escala .96→1 | 140ms | ease-out |
| Contagem | cada número escala 1.4→1 | 250ms (1 por segundo) | cubic-bezier(.3,1.4,.5,1) |
| Barra de progresso | transição de width | 120ms | linear |
| PPM ao vivo | sem animação, atualiza até 4×/s | — | — |
| Vitória | título entra com recorte diagonal (clip-path) | 360ms | cubic-bezier(.2,.8,.2,1) |
| Procurando | 3 quadrados pulsando, defasados em 150ms | 900ms loop | ease-in-out |
| Ranking | linhas entram com 30ms entre cada (`--i`) | 200ms | cubic-bezier(.2,.8,.2,1) |

Com `prefers-reduced-motion`, tudo vira um fade de 120ms. Nunca coloque animação atrás ou dentro do painel de texto.

Hovers: botão primário #F6D27A; cartões de modo e botão secundário ganham a próxima superfície. Foco: outline âmbar de 2px com offset de 3px.

## Responsividade
Um único breakpoint em 600px (ver os `@media` do CSS). No celular, o texto da corrida precisa ficar no topo da viewport, porque o teclado virtual ocupa a metade de baixo. Use `100dvh` e evite qualquer elemento fixo acima do score bug. A interface é bilíngue: botões e abas usam `white-space: nowrap`, então confira a versão EN, que é mais longa.

## Assets
- Logo: provisória, refeita em CSS (`Logo.dc.html`): duas barras arredondadas com rastro de pontos, a de cima âmbar e a de baixo ciano, mais comprida. Substituir pelos arquivos finais (SVG) quando chegarem.
- Não há imagens. Os emojis 🏆 e 🔥 vêm dos textos originais.
- Fontes: Google Fonts (URL no topo do CSS).
