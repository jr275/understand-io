#!/usr/bin/env bash
# Points the production app (Vercel project understand-io, Production) at a Neon database.
#
#   bash scripts/set-production-database.sh              asks for the URL at a hidden prompt, then: tests the connection,
#                                                         applies the migrations, saves DATABASE_URL in Vercel and redeploys
#   bash scripts/set-production-database.sh --clipboard  same, but reads the URL from the macOS clipboard (copy it in Neon first;
#                                                         the clipboard is emptied afterwards)
#   bash scripts/set-production-database.sh --dry-run    does the first two steps only (nothing is sent to Vercel)
#
# The URL never lands in the shell history or on screen. It may be pasted as Neon shows it: plain, in quotes, as
# DATABASE_URL='...' or as psql '...'. Nothing here edits files.
set -uo pipefail
cd "$(dirname "$0")/.."

DRY=0
CLIP=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;;
    --clipboard) CLIP=1 ;;
  esac
done

if [ "$CLIP" = "1" ]; then
  DB="$(pbpaste)"
  printf '' | pbcopy
  echo "(URL lida da area de transferencia, que foi esvaziada)"
else
  read -rsp "Cole a URL completa do banco (nada aparece) e aperte Enter: " DB
  echo
fi
trap 'unset DB' EXIT

# Accept what Neon's tabs give: DATABASE_URL='...', export DATABASE_URL="...", psql '...', with or without quotes.
DB="$(printf %s "$DB" | tr -d '\r\n' | sed -E "s/^[[:space:]]*(export[[:space:]]+)?(DATABASE_URL=)?(psql[[:space:]]+)?//; s/^['\"]//; s/['\"][[:space:]]*\$//")"

case "$DB" in
  postgres://*|postgresql://*) ;;
  *)
    echo "ERRO: isso nao e uma URL completa (deve comecar com postgresql://). Nada foi alterado."
    exit 1
    ;;
esac

echo "1/4 testando a conexao..."
if ! psql "$DB" -Atc "select 'conexao ok'"; then
  echo "ERRO: nao foi possivel conectar. Confira a senha (resete no Neon se precisar). Nada foi alterado."
  exit 1
fi

echo "2/4 aplicando as migracoes..."
if ! DATABASE_URL="$DB" npx drizzle-kit migrate; then
  echo "ERRO: a migracao falhou. Nada foi alterado na Vercel."
  exit 1
fi
N=$(psql "$DB" -Atc "select count(*) from pg_tables where schemaname='public' and tablename in ('accounts','annotations','documents','glosses','readers','reading_progress','settings')")
if [ "${N:-0}" != "7" ]; then
  echo "ERRO: esperava 7 tabelas e encontrei ${N:-0}. Nada foi alterado na Vercel."
  exit 1
fi
echo "ok: as 7 tabelas existem."

if [ "$DRY" = "1" ]; then
  echo "(--dry-run) parei aqui: nada foi enviado a Vercel."
  exit 0
fi

echo "3/4 gravando DATABASE_URL na Vercel (projeto understand-io, so Production)..."
if ! printf %s "$DB" | vercel env add DATABASE_URL production --force --sensitive --yes --project understand-io --scope menlo6; then
  echo "ERRO: nao consegui gravar na Vercel."
  exit 1
fi

echo "4/4 refazendo o deploy de producao..."
LAST=$(vercel list understand-io --scope menlo6 2>/dev/null | grep Production | head -1 | grep -o 'understand-[a-z0-9]*-menlo6\.vercel\.app')
if [ -z "$LAST" ]; then
  echo "Nao achei o ultimo deploy. Na Vercel, abra Deployments, o primeiro de Production, e clique em Redeploy."
  exit 1
fi
vercel redeploy "$LAST" --scope menlo6
echo "Pronto. Avise para eu testar a producao."
