# Shared collections and referrals: design (not built, not launched)

**Status: design only.** Nothing in this document is implemented, and none of it may be launched without the owner's approval (Fase 8 brief: "Do not launch public sharing or referral incentives without owner approval"). It is written so that building it later is a matter of following it, and so the owner can see what is being asked before saying yes. The analytics half of referral measurement (`ref` code, `referral` channel) *is* built (`docs/product/analytics.md`) and records nothing until analytics is switched on.

## Principles (the rules the design cannot break)

1. **Private by default, public only by an explicit act.** A new collection is private. Publishing needs a confirmation that names what will become public.
2. **Only what the owner selected is public, and only what is safe to show.** Never a private document, a mark, a note, a question, an AI answer or the reader's library as a whole. A shared collection exposes: its title, the owner's chosen description, and for each selected text: title, author and source address, plus an excerpt of at most N characters the owner can see and edit. Texts that came from a file (PDF, Word) or were pasted are shown as a title only unless the owner enables an excerpt: the owner may not hold the right to republish them.
3. **Revocable at once.** Revoking removes the public page and the link answers 404 on the next request (no cache: `Cache-Control: no-store`, and the page is rendered at request time). Revocation is one click and needs no support.
4. **Attribution travels with the link**, not with the reader's identity: the page says "A collection by <name the owner chose>". The owner's e-mail, account id and reader id are never shown or stored in the public record.
5. **No incentives without approval.** Referral codes can exist and be measured before any reward does; a reward (extra AI questions, a discount) is a financial and abuse decision for the owner.

## Data model (additive migration, one new group of tables)

```
collections        id (nanoid), reader_id -> readers ON DELETE CASCADE, title, description,
                   visibility ('private'|'shared'), created_at, updated_at
collection_items   collection_id -> collections ON DELETE CASCADE, document_id, position,
                   excerpt (owner-approved text, max 600 chars, nullable)       -- no FK to documents (samples), checked by canAttachTo as elsewhere
shares             id, collection_id -> collections ON DELETE CASCADE, token_hash (sha256 of an unguessable 128-bit token; the token itself is shown once),
                   display_name (what the owner chose to show), consented_at, revoked_at (null = live), views (count only)
referral_codes     code (8 letters/digits), reader_id -> readers ON DELETE CASCADE, created_at, revoked_at
```

- The token is never stored, only its hash; the public URL is `/c/<token>`. Guessing needs 2^128 tries. Revoking sets `revoked_at`; publishing again creates a new token, so an old link never comes back to life.
- `consented_at` is written only by the explicit publish confirmation (what is shown, who will see it, that it can be revoked). A `shared` collection with no `consented_at` is a bug the integrity check reports.
- `views` is a counter, not a log of viewers.

## API and pages

| Route | Who | What |
| --- | --- | --- |
| `POST /api/collections`, `PATCH`, `DELETE` | the owner (reader cookie) | create, edit, delete a collection and its items |
| `POST /api/collections/:id/share` | the owner | body must contain `confirm: true` and the display name; creates the share, returns the URL once |
| `DELETE /api/collections/:id/share` | the owner | revokes (sets `revoked_at`); idempotent |
| `GET /c/:token` | anyone | server-rendered public page; 404 if the token is unknown or revoked; `noindex` unless the owner ticks "let search engines index this" (default off) |
| `GET /c/:token/opengraph-image` | anyone | a card with the collection title and the count of texts, never an excerpt |
| `POST /api/referral` | the owner | creates or rotates the owner's referral code; `DELETE` revokes it |
| `GET /r/:code` | anyone | redirects to `/?ref=<code>` (so attribution is measured the same way as any campaign); a revoked or unknown code redirects to `/` with no `ref` |

All writes pass through `src/proxy.ts` (cross-site refused) and are rate-limited per reader. The public page and the image are read-only and carry no cookie.

## AI-generated collection descriptions, with sources

The owner may ask for a description of the collection. It is generated **from the owner-approved excerpts and titles only**, through the same gate as every AI request (daily allowance, one at a time, budget reservation), cites the texts it drew on by their position in the collection (`[2]`), and is shown to the owner as an editable draft. Nothing is public until the owner publishes, and the model is told, as everywhere in the product, that the text is data and not instructions. No mark, note, question or private text is ever in the prompt.

## Privacy and abuse

- A public page is the one place the product serves reader-chosen content to strangers, so it gets the strictest handling: text is rendered as text (no HTML from imported pages), links are `rel="noopener noreferrer nofollow ugc"`, and the page has its own report link that sends the owner an e-mail (an owner decision: who receives reports).
- Takedown: the operator can revoke any share by token hash from a script (`scripts/` like the others), and the legal texts need a section on public collections and on notice-and-takedown (`docs/legal/OPEN_ITEMS.md`).
- Copyright: excerpts are capped and owner-approved; the product does not host the full text of a shared collection's items.
- Referral abuse (self-referral, throwaway accounts) matters only once a reward exists; until then a code is a label.

## Acceptance criteria (for when it is built)

1. A new collection is private; the public URL of a private or revoked collection answers 404.
2. Publishing without `confirm: true` is refused; the share row has `consented_at`.
3. After `DELETE .../share`, the next request to the public URL answers 404 (test with the same token).
4. The public page, its JSON and its image never contain a document, mark, note, question or answer that was not selected, nor the owner's e-mail, account id or reader id (test with a fixture that holds marker strings in each).
5. A referral link can be revoked and then redirects without a `ref`.
6. Unit tests for the token (hash only stored), the excerpt cap and the visibility rules; E2E for publish, view as a stranger (no cookie), revoke, view again.

## Owner decisions (before any of it is built)

1. Whether to build sharing at all in this phase, and whether excerpts are ever allowed for files and pasted texts.
2. Who receives abuse reports, and the takedown promise in the terms.
3. Whether referral codes get a reward, and what (this is a financial decision).
4. Whether public collections may be indexed by default (recommended: no).
