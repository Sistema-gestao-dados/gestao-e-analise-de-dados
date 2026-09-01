# Gestão e Análise de Dados

Sistema único de gestão e análise operacional de transporte, com os
conversores de arquivo (BI Cittati, Relatório de Viagens e Passagem Trecho)
integrados ao mesmo painel — antes eram dois sistemas separados
(`city-route-analytics` + `Convert-temp`), agora é um só.

## Módulos

- **Operação** — dashboard, resumos, relatório comparativo, jornada, pesquisa
- **Cadastros** — linhas, KM, grupos de linhas
- **Dados** — viagens, versões ativas, importação CSV/TXT, histórico
- **Conversores** — BI Cittati → TXT, Relatório de Viagens → TXT,
  Passagem Trecho → TXT (os 3 módulos que vieram do Convert-temp)
- **Administração** — auditoria, usuários

## Stack

TanStack Start (React 19) + Supabase (auth + Postgres) + Tailwind + Vite/Nitro.
Não depende de nenhuma plataforma de builder (Lovable, etc.) — roda em
qualquer host Node/Nitro.

## Rodando localmente

```sh
npm install
cp .env.example .env   # preencha com as chaves do seu Supabase
npm run dev
```

## Publicar em produção

Veja o passo a passo completo em **[DEPLOY.md](./DEPLOY.md)**
(Supabase → GitHub → Vercel, e como atualizar depois via zip/push).
