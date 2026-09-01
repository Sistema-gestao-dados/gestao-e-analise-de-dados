# Deploy — Gestão e Análise de Dados

Este sistema **não depende mais do Lovable**. Ele é um app TanStack Start
(React) comum, que roda em qualquer host com Node/Nitro — o guia abaixo usa
GitHub + Vercel + Supabase, que é o que você já tem conta.

## 1. Criar um Supabase novo (independente do antigo, que fica preso ao Lovable)

1. Acesse https://supabase.com/dashboard e clique em **New Project**.
2. Anote a **senha do banco** que você definir (só aparece uma vez).
3. Espere o projeto terminar de provisionar (1–2 min).
4. Vá em **Project Settings → API** e copie:
   - `Project URL` → vai virar `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `Project ID` (o subdomínio antes de `.supabase.co`) → `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID`
   - `anon` / `publishable` key → `SUPABASE_PUBLISHABLE_KEY` / `VITE_SUPABASE_PUBLISHABLE_KEY`
   - `service_role` key (em **Reveal**, é secreta) → `SUPABASE_SERVICE_ROLE_KEY`

## 2. Rodar as migrations (cria as tabelas, permissões etc.)

O projeto já vem com todo o schema em `supabase/migrations/` (13 arquivos,
em ordem cronológica). Duas formas de aplicar, escolha uma:

**Opção A — pelo painel (mais simples, sem instalar nada):**
No Supabase, abra **SQL Editor → New query**, abra cada arquivo de
`supabase/migrations/` na ordem em que aparecem na pasta (o nome já começa
com data/hora) e rode um por um, colando o conteúdo e clicando em **Run**.

**Opção B — pela CLI do Supabase:**
```sh
npm i -g supabase
supabase login
supabase link --project-ref <seu-project-id>
supabase db push
```

## 3. Configurar as variáveis de ambiente localmente

```sh
cp .env.example .env
```
Preencha o `.env` com os 6 valores que você copiou no passo 1.
**Nunca** commite o `.env` (ele já está no `.gitignore`).

## 4. Testar localmente (opcional, mas recomendado antes de publicar)

```sh
npm install
npm run dev
```
Abra `http://localhost:3000`. Como ainda não existe nenhum administrador,
a própria tela de login vai mostrar um formulário para **criar o primeiro
administrador** — preencha nome, e-mail e senha por ali. Depois disso, os
próximos usuários são criados pela tela **Usuários** (dentro do sistema, só
admin vê essa opção).

## 5. Subir para o GitHub

```sh
cd gestao-e-analise-de-dados
git init
git add .
git commit -m "Sistema unificado: Gestão e Análise de Dados"
git branch -M main
git remote add origin https://github.com/<seu-usuario>/gestao-e-analise-de-dados.git
git push -u origin main
```
(Crie o repositório vazio no GitHub antes, em https://github.com/new —
não marque "Add README" pra evitar conflito.)

## 6. Publicar na Vercel

1. Em https://vercel.com, **Add New → Project** e importe o repositório
   que você acabou de criar.
2. A Vercel detecta o framework automaticamente (Vite + Nitro). Não é
   necessário mudar build command / output directory.
3. Em **Environment Variables**, adicione as mesmas 6 chaves do passo 1
   (as mesmas do seu `.env`).
4. Clique em **Deploy**.

Pronto — a partir daqui, todo `git push` na branch `main` gera um novo
deploy automático na Vercel.

## 7. Como atualizar depois (fluxo "subir o zip")

Quando você tiver um novo `.zip` do projeto atualizado (gerado por mim ou
por você):

1. Extraia o `.zip` por cima da pasta local do repositório (sobrescrevendo
   os arquivos), **sem apagar a pasta `.git`**.
2. Rode:
   ```sh
   git add .
   git commit -m "Atualização"
   git push
   ```
3. A Vercel detecta o push e publica a nova versão sozinha — sem precisar
   mexer em nada no painel.

Se preferir, dá pra fazer o mesmo passo 1–2 direto pela interface web do
GitHub (Add file → Upload files, arrastando os arquivos alterados) ou por um
Codespace do GitHub, como você já costuma fazer.

## Checklist rápido pra evitar erro

- [ ] As 6 variáveis de ambiente estão preenchidas (local **e** na Vercel)
- [ ] As 13 migrations rodaram sem erro, na ordem
- [ ] `SUPABASE_SERVICE_ROLE_KEY` só está no `.env`/Vercel — nunca em código
      commitado nem em variável `VITE_*`
- [ ] `npm run build` roda limpo localmente antes de dar push (pega erro de
      TypeScript cedo, antes da Vercel)
