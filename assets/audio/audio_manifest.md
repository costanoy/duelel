# Manifesto de áudio do Duelel

## Identidade sonora
Os sons são bipes curtos, limpos e secos, num clima de placar eletrônico de corrida. Não têm eco nem cauda longa. Tudo precisa ser discreto: quem joga está concentrado digitando, e o som só marca os momentos-chave (partida encontrada, contagem, largada, vitória). O jogo não tem trilha musical de propósito, porque música atrapalha a digitação.

Use esta frase nos prompts do ElevenLabs: "som de interface eletrônico curto e seco, estilo placar esportivo digital, sem eco, sem reverb, timbre limpo".

## Onde ficam os arquivos
O jogo é um site, e o servidor só entrega o que está em `public/`. Por isso os arquivos finais ficam em `public/sounds/`, e não em `assets/audio/sfx/`. Os nomes antigos (`count.mp3` etc.) foram mantidos para não mexer no código nem no cache do service worker.

- Formato: MP3 192 kbps, 48 kHz, estéreo. Funciona em todos os navegadores, inclusive no Safari do iPhone.
- Registro dos sons no código: `SOUND_NAMES` em `public/index.html`.
- Pré-cache offline: `PRECACHE` em `public/sw.js`.

## Assets

| id | tipo | ferramenta | descrição/prompt usado | duração | loop | arquivo final | status |
|----|------|-----------|------------------------|---------|------|---------------|--------|
| count | ui | desconhecida (ver "Direitos") | bipe da contagem 3-2-1; também toca baixo (vol. 0,3) nos últimos 3 s do treino de 30 s e ao religar o som | 0,46 s | não | public/sounds/count.mp3 | integrado |
| go | ui | desconhecida | sinal da largada | 0,62 s | não | public/sounds/go.mp3 | integrado |
| match | ui | desconhecida | partida encontrada (fila ou sala) | 0,46 s | não | public/sounds/match.mp3 | integrado |
| win | sfx | desconhecida | vitória no duelo, no bot e no desafio por link; também é reaproveitado para novo recorde pessoal | 0,90 s | não | public/sounds/win.mp3 | integrado |
| ui_erro_tecla | ui | ElevenLabs | "toque surdo e muito curto de erro, tipo tecla bloqueada, grave e abafado, 80 ms, sem eco" (opcional; desligado por padrão para não irritar) | ~0,1 s | não | public/sounds/ui_erro_tecla.mp3 | pendente |
| sfx_derrota | sfx | ElevenLabs | "dois bipes descendentes curtos e suaves, sensação de 'quase', sem tom de deboche, sem eco" (hoje a derrota é silenciosa) | ~0,6 s | não | public/sounds/sfx_derrota.mp3 | pendente |
| sfx_recorde | sfx | ElevenLabs | "brilho eletrônico curto subindo, sensação de conquista, mais leve que a vitória, sem eco" (hoje usa `win`) | ~0,8 s | não | public/sounds/sfx_recorde.mp3 | pendente |
| sfx_oponente_terminou | ui | ElevenLabs | "bipe agudo de alerta único, curto, tipo bandeira quadriculada no placar, sem eco" (hoje só aparece o aviso 🏁 na tela) | ~0,3 s | não | public/sounds/sfx_oponente_terminou.mp3 | pendente |
| ui_revanche | ui | ElevenLabs | "notificação curta de dois tons subindo, amigável, sem eco" (oponente pediu revanche; hoje só o botão pulsa) | ~0,4 s | não | public/sounds/ui_revanche.mp3 | pendente |

Os itens "pendente" não foram gerados porque o MCP do ElevenLabs recusou a chave atual: `check_subscription` respondeu 400 `invalid_api_key` ("API key must start with 'sk_'"). Quando a chave for corrigida, a rodada tem **5 assets × 3 variações = 15 gerações no ElevenLabs** e **0 no Suno**. Para integrar cada som:
1. Acrescentar o nome em `SOUND_NAMES`.
2. Acrescentar o arquivo em `PRECACHE` no `sw.js` e subir a versão do `CACHE`.
3. Chamar `sfx('nome')` no evento certo.

## Pós-processamento feito em 27/10/2026
Os 4 sons originais estavam desnivelados: count -8,2 LUFS, go -8,8, match -23,0 (medido no arquivo de 1 s com silêncio) e win -14,0. Usei ffmpeg em duas etapas:
1. Cortei a cauda silenciosa (abaixo de -50 dB) com um fade-out de 30 ms.
2. Normalizei para cerca de -16 LUFS com pico de no máximo -1 dBTP. O `match` precisou de limitador leve para subir sem clipar.

Resultado: os quatro ficaram em -16,2/-16,3 LUFS. No jogo, todos tocam com o mesmo volume-base (0,6), então agora soam equilibrados entre si. Os originais continuam no histórico do git, no commit f957c6f.

Para repetir com um som novo, troque três valores no primeiro comando:
- FIM: o ponto em que começa o silêncio, mais 0,04 s.
- FADE: FIM menos 0,03.
- GANHO: -16 menos o LUFS medido.
```
ffmpeg -i entrada.mp3 -af "atrim=0:FIM,afade=t=out:st=FADE:d=0.03,volume=GANHOdB,alimiter=limit=0.891:level=false" -ar 48000 -c:a libmp3lame -b:a 192k saida.mp3
ffmpeg -i saida.mp3 -af loudnorm=print_format=json -f null -
```
O primeiro comando corta e normaliza. O segundo mede o resultado (input_i é o LUFS, input_tp é o pico).

## Direitos de uso
- count, go, match e win entraram no commit f957c6f (30/09/2026) sem registro de origem. Os metadados mostram só que foram codificados com ffmpeg (Lavf59.27), o que não diz se foram sintetizados ou baixados. **Confirme a origem e a licença antes de uma divulgação comercial.**
- Os próximos sons do ElevenLabs devem ter anotados aqui o plano da conta usada e a data. Os planos gratuitos do ElevenLabs exigem atribuição e não permitem uso comercial; os pagos permitem.
