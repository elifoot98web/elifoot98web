# Elifoot 98 Online
[![GitHub license](https://img.shields.io/github/license/elifoot98web/elifoot98web)](LICENSE)
![Github Stars](https://img.shields.io/github/stars/elifoot98web/elifoot98web)  
[![Deploy to Github pages](https://github.com/elifoot98web/elifoot98web/actions/workflows/deploy-gh-pages.yml/badge.svg)](https://github.com/elifoot98web/elifoot98web/actions/workflows/deploy-gh-pages.yml)  

## O que é o projeto?
O Elifoot 98 Online é uma versão do jogo de futebol Elifoot 98, que foi originalmente lançado em 1998. O projeto foi criado para permitir que os jogadores joguem o Elifoot 98 diretamente no navegador em sistemas modernos e celulares (que já não possuem a capacidade de rodá-lo nativamente), sem a necessidade de instalar extensões ao sistema ou usar emuladores complicados.  

## Versão Live 
### [https://www.elifoot98.com.br](https://www.elifoot98.com.br)
[<img alt="alt_text" src="https://github.com/jlcvp/elifoot98web/assets/2317417/ed9337b7-bc92-40f9-8434-019ccd4dad5f" />](https://www.elifoot98.com.br)  


## Propósito
O Elifoot 98 Online é um projeto de código aberto, desenvolvido por fãs do jogo, que visa preservar e compartilhar a experiência do Elifoot 98 com as antigas e novas gerações de jogadores. O projeto não possui fins lucrativos e respeita os direitos autorais do jogo original.

### Copyright Elifoot 98
O Elifoot 98 foi originalmente distribuído como software shareware, permitindo acesso gratuito com funcionalidades limitadas. A própria tela inicial do jogo informava que sua distribuição era livre e gratuita, conforme os termos estabelecidos pelo autor.  
[Homepage do Elifoot 98 como ela era em 2000](https://web.archive.org/web/20010124090300/http://www.ip.pt/~ip213368/)


## Funcionalidades
- **Jogar Elifoot 98 completo no navegador**, com o progresso salvo automaticamente e preservado entre sessões.
- **Instalável como PWA** (celular ou desktop) e funcional offline depois da primeira carga.
- **Jogos salvos**: exportar, importar e baixar o disco virtual inteiro.
- **Patches de times e bandeiras**: carregue um `.zip` de patch e o jogo reinicia já com ele aplicado.
- **Teclado virtual e input de texto**, para digitar nomes em celulares sem teclado físico.
- **Cheat 'O Matic**: um scanner de memória no estilo Cheat Engine, direto na máquina virtual.
- **Multiplayer para assistir junto** — *veja abaixo*.

### Multiplayer (assistir junto, não jogar junto)
Quem hospeda transmite a própria tela por WebRTC; quem entra **assiste**. O espectador não tem
emulador e não controla o jogo — mas conversa no chat, aponta com um cursor compartilhado e vê
quem mais está na sala.

- Hospedar: `Jogar e transmitir para amigos` na tela inicial, ou `Hospedar Jogo Multiplayer`
  no menu de dentro do jogo. A sala ganha um código no formato `ELI-XXXX` e uma senha opcional.
- Assistir: `Assistir a uma Partida` na tela inicial, com o código ou o link compartilhado.
- A conexão é ponto a ponto via [trystero](https://github.com/dmotz/trystero): nenhum tráfego
  do jogo passa por um servidor nosso. **A senha é o único controle de acesso** — o link de
  convite não a inclui, de propósito.


## Desenvolvimento

### Requisitos
- **Node.js 22** (é a versão usada no CI; o harness de multiplayer depende do `WebSocket` global).
- **[Git LFS](https://git-lfs.com/) — obrigatório.** `src/assets/elifoot/elifoot98.jsdos` (~6,7 MB,
  com todo o ambiente Windows 3.1 + jogo) é rastreado por LFS. Sem o LFS o arquivo vem como um
  ponteiro de texto e **a aplicação não inicia**.

### Ferramentas utilizadas
- [Angular](https://angular.dev/) 21 + [Ionic](https://ionic.io/) 9 — estrutura da aplicação e responsividade
- [js-dos](https://js-dos.com/) — DOSBox compilado para WebAssembly
- [trystero](https://github.com/dmotz/trystero) — WebRTC ponto a ponto do multiplayer
- [tesseract.js](https://tesseract.projectnaptha.com/) — OCR que detecta quando o jogo termina de salvar
- [JSZip](https://stuk.github.io/jszip/) — exportação dos saves e aplicação de patches

### Como isso roda
O Elifoot 98 é uma aplicação **Windows 3.1 de 16 bits**, então a pilha tem três camadas:
js-dos (DOSBox em WebAssembly) → Windows 3.1 (que vem dentro do próprio bundle do jogo) →
`ELIFOOT.EXE`. Tudo o que o usuário vê é o Windows 3.1 desenhando o jogo dentro de um canvas.

### Desenvolvendo e rodando localmente
1. `git lfs install` (apenas na primeira vez, antes de clonar; se já clonou sem LFS, rode `git lfs pull`)
2. `npm install` (apenas na primeira vez que for rodar o projeto)
3. `npm start`
4. Pronto, abra o navegador e acesse http://localhost:4200

### Scripts
```bash
npm start                  # ng serve → http://localhost:4200
npm run build              # build de produção → www/
npm run build:githubpages  # o que o CI publica
npm run lint               # ESLint (src/**/*.ts e src/**/*.html)
npm test                   # karma + jasmine (configurado, mas o projeto ainda não tem specs)
npm run mp:launch          # abre dois navegadores para testar uma sala multiplayer
```

O multiplayer só pode ser testado com dois ou mais navegadores ao mesmo tempo, então isso é
feito por um harness que dirige o Chrome pelo DevTools Protocol —
[`scripts/multiplayer-harness/`](scripts/multiplayer-harness/README.md). O README de lá tem o
roteiro de cenários e as armadilhas que invalidam um teste sem avisar (a principal: uma janela
coberta por outra é tratada como oculta pelo Chrome, o que estrangula os timers e trava as
animações do Ionic).

### Antes de commitar
Todo script `build*` roda o `prebuild`, que **reescreve `src/environments/environment*.ts` no
lugar** para carimbar versão, data e commit. Depois de um build local esses arquivos ficam
sujos — restaure os placeholders com `git checkout src/environments` antes de commitar.

PRs para a `main` só passam se a `version` do `package.json` mudar. Use
`npm version <v> --no-git-tag-version` para que o `package.json` e o `package-lock.json` fiquem
em sincronia.

### Documentação para quem for contribuir
- [`CLAUDE.md`](CLAUDE.md) — arquitetura, armadilhas de dependência e as invariantes que já
  foram bug uma vez. É o documento a ler primeiro.
- [`docs/multiplayer-ux-study.md`](docs/multiplayer-ux-study.md) — o registro de projeto do
  multiplayer: decisões, fases, o que foi construído diferente do planejado e o que foi
  explicitamente rejeitado (e por quê).

## Donations
Se você gosta do projeto e quer ajudar a mantê-lo, considere fazer uma doação.  

| [![Doe via tipa.ai](resource/tipai.png)](https://tipa.ai/jlcvp) | [![Doe via livepix](resource/livepix.png)](https://livepix.gg/jlcvp) |
|------------------|--------------------------|
| [tipa.ai/jlcvp](https://tipa.ai/jlcvp) | [livepix.gg/jlcvp](https://livepix.gg/jlcvp) |
