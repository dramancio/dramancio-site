# dramancio.com

Site pessoal de Diego Raphael Amancio. É um site estático (HTML, CSS e JS, sem build), hospedado no GitHub Pages.

As publicações e citações são atualizadas automaticamente a partir do
[Google Scholar](https://scholar.google.com/citations?user=WHdCNq0AAAAJ&hl=en).

## Como funciona a atualização automática

- `.github/workflows/update-scholar.yml` roda toda segunda-feira às 06:00 UTC. Também dá para rodar na hora, em **Actions → Update Google Scholar data → Run workflow**.
- O workflow executa `scripts/update_scholar.py`. O script lê o perfil do Scholar e regrava `data/scholar.js`.
- Se houver mudança, o próprio robô faz um commit ("Update Scholar data") e o GitHub Pages republica o site sozinho.
- O Scholar às vezes bloqueia robôs. Quando isso acontece, ou quando os dados parecem errados (por exemplo, a lista encolhe mais de 20%), o script **não altera nada**. O site continua com os últimos dados bons e a execução mostra um aviso amarelo na aba Actions.

## Publicar pela primeira vez

1. Crie uma conta no [GitHub](https://github.com) se ainda não tiver.
2. Crie um repositório **público** chamado, por exemplo, `dramancio-site`.
3. Envie todos os arquivos desta pasta, incluindo as pastas ocultas `.github` e `.nojekyll`:
   - **Pelo navegador:** no repositório, use *Add file → Upload files* e arraste o conteúdo da pasta. Atenção: o Finder esconde pastas que começam com ponto; use `Cmd+Shift+.` para mostrá-las.
   - **Pelo terminal:** primeiro rode `xcode-select --install`, depois use `git init`, `git add .`, `git commit` e `git push`.
4. Em **Settings → Pages**, escolha *Source: Deploy from a branch*, *Branch: main / (root)*. Em *Custom domain*, coloque `dramancio.com`.
5. Em **Settings → Actions → General → Workflow permissions**, marque *Read and write permissions* e salve.
6. Em **Actions**, abra *Update Google Scholar data* e clique em *Run workflow* para testar.

## Apontar o domínio dramancio.com (hoje no Wix)

No painel do Wix, vá em **Domínios → dramancio.com → Gerenciar registros DNS** e configure:

| Tipo  | Host | Valor                      |
|-------|------|----------------------------|
| A     | @    | 185.199.108.153            |
| A     | @    | 185.199.109.153            |
| A     | @    | 185.199.110.153            |
| A     | @    | 185.199.111.153            |
| CNAME | www  | `dramancio.github.io`      |

Apague os registros A antigos que apontam para o Wix. Se o Wix não deixar editar o DNS enquanto o domínio estiver ligado ao site, primeiro desconecte o domínio do site Wix.

A propagação leva de minutos a algumas horas. Depois, em **Settings → Pages**, marque **Enforce HTTPS**. Só cancele o plano do Wix quando o novo site estiver no ar.

## Editar o conteúdo

- Textos (bio, notícias, formação, disciplinas, contato): edite `index.html`.
- O destaque "New publication" é manual: troque o bloco `<article class="card highlight">` em `index.html` quando quiser destacar outro artigo.
- Visual: `assets/style.css`.
- Foto: substitua `assets/diego.jpg`.
- **Não edite** `data/scholar.js` à mão; ele é regravado automaticamente.
- Para trocar o perfil do Scholar, mude `SCHOLAR_ID` em `scripts/update_scholar.py`.
