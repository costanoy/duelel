# Briefing — Redesign visual do Duelel (estilo transmissão de e-sports)

## O que é o Duelel

Duelel é um jogo de corrida de digitação em tempo real, 1 contra 1, no navegador (https://duelel.cyberhat.com.br). Dois jogadores recebem o mesmo texto; quem terminar de digitar primeiro vence. Também tem modos solo (30 segundos contra o relógio, ou terminar um texto) e um ranking de PPM (palavras por minuto). É uma peça de portfólio, então precisa parecer um produto bem acabado.

Público: pessoas que gostam de jogos rápidos e competitivos, desktop e celular. Interface bilíngue PT-BR / EN.

## Direção de estilo

**Transmissão de e-sports / placar esportivo**, com uma pitada de grafismo de F1 só no ranking.

- A partida é tratada como uma transmissão ao vivo: lado esquerdo × lado direito, tela de VS entre os dois jogadores, cartões de jogador, "score bug" com o placar durante a corrida, tela de resultado com destaque do vencedor.
- Cada jogador tem uma cor de "time" fixa:
  - **Você = âmbar `#F2C14E`** (sempre à esquerda)
  - **Oponente = ciano `#49C5E6`** (sempre à direita)
- Formas angulares/chanfradas, barras diagonais, faixas e rótulos em caixa alta — mas com moderação. Moderno e limpo, não poluído.
- **Ranking:** inspirado na "torre de tempos" das transmissões de F1 — posições empilhadas em barras finas (posição, nome, PPM).
- Detalhe opcional de F1: ao terminar uma corrida, **roxo** para recorde geral e **verde** para recorde pessoal.

## Regra mais importante

O coração do jogo é **ler e digitar o texto**. A área do texto da corrida tem que continuar **limpa, legível e calma**: fonte monoespaçada, bom contraste, sem textura, sem scanline, sem animação atrás. Todo o estilo de transmissão vive **em volta** do texto (cabeçalho, placar, barras de progresso, telas antes e depois da corrida).

Estados do texto durante a corrida (manter essa lógica):
- Caractere ainda não digitado: cor apagada (hoje `#565B67`)
- Caractere digitado certo: cor de texto principal (hoje `#E8E8E2`)
- Erro: vermelho (hoje `#E5533D`) — o cursor trava até corrigir
- Cursor do jogador: âmbar
- Posição do oponente: marcador discreto em ciano no texto

## Identidade que deve ser mantida

- **Logo:** duas barras horizontais arredondadas com um rastro de pontinhos/traços à esquerda (efeito "cometa") — a de cima âmbar, a de baixo ciano e mais comprida. Wordmark "Duelel" em monoespaçada, com "Duel" em âmbar e "el" em ciano. *(Vou anexar os arquivos da logo.)*
- **Tema escuro.** Fundo atual `#28292D`, superfícies `#2E3036` / `#35373E`, bordas `#393C45`, texto secundário `#8B909C`. Pode refinar esses tons, mas o app continua escuro.
- **Tipografia atual:** JetBrains Mono (texto da corrida, números, rótulos) e Inter (interface). Pode sugerir uma fonte condensada de display para títulos/placar (estilo transmissão), desde que exista no Google Fonts.

## Telas para desenhar

Desenhar cada tela em **desktop (1440px de largura)** e **celular (390px de largura)**. Usar os textos reais abaixo (em PT; o layout precisa aguentar a versão EN, que às vezes é mais longa).

1. **Início**
   - Cabeçalho: logo + wordmark à esquerda, seletor de idioma PT | EN no centro, indicador de plataforma ("desktop" / "mobile") à direita.
   - Campo "Nome".
   - Três modos em cartões:
     - `1 · online` — **Procurar partida** — "Entra na fila e enfrenta o próximo oponente disponível na sua plataforma."
     - `2 · privado` — **Sala com amigo** — "Gera um link pra você mandar e desafiar quem quiser diretamente."
     - `3 · treino` — **Treinar sozinho** — "Pratique sem oponente. Você contra o tempo — ou contra um texto." (tem um seletor com 3 opções: Tempo / Texto / Texto Duelel)
   - Link "🏆 Ranking".
   - Rodapé: "ppm = palavras por minuto (5 caracteres = 1 palavra), padrão universal de digitação."

2. **Procurando oponente** — "Procurando oponente…" + "Buscando outro jogador no desktop." + botão "cancelar". (Pensar como a tela de "matchmaking" de um jogo competitivo.)

3. **Sala pronta (sala privada)** — "Sala pronta" + "Envie o link abaixo. A corrida começa assim que a pessoa entrar." + o link + botão "Copiar link" (vira "Copiado ✓").

4. **Partida encontrada / Prontos?** — tela de **VS**: cartão do jogador à esquerda (âmbar) × cartão do oponente à direita (ciano), com o nome de cada um. Título "Prontos?". Cada lado mostra o estado: "aguardando…" ou "pronto ✓". No celular, "toque para confirmar".

5. **Contagem regressiva** — 3, 2, 1, "Vai!" sobre a tela da corrida.

6. **Corrida (tela principal)**
   - "Score bug" no topo: nome + PPM ao vivo de cada jogador (âmbar à esquerda, ciano à direita).
   - Duas barras de progresso, uma por jogador.
   - Área do texto (ver "Regra mais importante").
   - Rótulos pequenos de "tempo" e "precisão".
   - Exemplo de texto: "o tempo passa rápido quando você digita contra alguém do outro lado do mundo"

7. **Resultado** — dois estados: "Você venceu! 🏆" e "Você perdeu". Mostrar PPM, precisão e tempo dos dois jogadores lado a lado, destacando o vencedor. Botões: "Revanche", "Jogar de novo", "🏆 Ranking", "Início". Incluir também o estado "Revanche — Aguardando o oponente aceitar…" e o botão "Aceitar revanche 🔥".

8. **Ranking** — "Ranking — Líderes", com 4 abas: "Teclado", "Celular", "Texto Duelel - Teclado", "Texto Duelel - Celular". Lista estilo torre de tempos da F1 (posição, nome, PPM, modo). Estados: carregando ("carregando…") e vazio ("Ninguém aqui ainda. Seja o primeiro!"). Botão "voltar".

9. **Modo solo** — mesma tela da corrida, mas só com o jogador (sem oponente); versão "30 segundos" com cronômetro em destaque; tela final "treino concluído" com botão "De novo".

## Restrições técnicas (importante para a implementação)

- O site é **um único arquivo HTML com CSS e JavaScript puros** — sem React, sem framework, sem build. O design precisa ser reproduzível com CSS comum (gradientes, `clip-path`, bordas, sombras, animações CSS). Nada que dependa de imagens pesadas ou de bibliotecas.
- Fontes somente do **Google Fonts**.
- Precisa funcionar bem no celular (o teclado virtual ocupa metade da tela na corrida — a área do texto tem que ficar no topo).
- Animações curtas e rápidas (entradas de tela, VS, contagem, vitória). Nada que atrase o jogador.
- Contraste acessível no texto.

## O que eu preciso receber

1. As telas acima em desktop e celular.
2. Uma folha de **tokens de design**: paleta final (com hex), fontes e tamanhos, espaçamentos, raios/chanfros, sombras, e a descrição das animações principais (duração e easing).
3. Se possível, o HTML/CSS das telas — vai servir de referência para eu aplicar o estilo no código real.
