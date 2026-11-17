# Status e decisões

## 2026-11-16 — ordem de merge (decisão do dono)

1. Next 16.4.6: destrava o build, que falha em 16.4.2 por GHSA-mfr8-8qww-v76h. **O PR #23 (`chore/next-16.4.6`, parte de `main`) será fechado sem merge**, porque `main` não tem o hotfix `0536acf` (marca e `GLOSS_BUILD_MIGRATIONS`) que está em produção. O bump entra pelo PR #22 (commit `8cd2501`, cherry-pick de `6156ea7`; gates verdes sobre o #22).
2. PR #22 (Keeple), com rebase sobre o Next novo.
3. Backup do Neon provado (ensaio de restauração).
4. `feature/keeple-domain-auth` + migração 0007.

`APP_URL` e o cliente Google para `www.keeple.me` ficam para a Fase 3.

Produção hoje: deploy `dpl_4obqqegCZePkKPK1nH7skKwyh8HD`, commit `0536acf` (branch `hotfix/keeple-brand`), conferido com a API da Vercel em 2026-11-16.
