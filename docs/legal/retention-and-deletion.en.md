# Retention and deletion policy — Understand.io

> **DRAFT. NOT LEGAL ADVICE.** This text was written from how the app's code works. It has not been reviewed by a lawyer. **Do not publish it** until the owner has filled in every field marked with ⚠️ and a legal review has been done.

**Last updated:** ⚠️ [OWNER DECISION: date at publication]

This page says how long data stays and what you can delete. In short: **the app keeps your data until you delete it. It has no automatic expiry, and it has no self-service account deletion yet.**

## 1. What stays, and what you can delete yourself

| Data | Where | How long | Delete it yourself? |
| --- | --- | --- | --- |
| Documents (text, or a saved link) | Server and browser | Until you delete the document. No automatic expiry. | Yes. Deleting a document removes it and its highlights, notes, AI questions and answers, and reading position from the server and from the browser. |
| Highlights, underlines, notes | Server and browser | Until you delete them (or the document). | Yes, one by one. |
| AI questions and answers | Server and browser | Until you delete them (or the document). | Yes, one by one. |
| Reading position | Server and browser | Until the document is deleted. | Only by deleting the document. |
| Appearance settings | Browser only | Until you clear browser data. | Clear this site's data in your browser. |
| Your pasted Together AI key | Browser only | Until you remove it. | Yes, with "Remove" in the key panel. |
| Anonymous reader record and `gloss_reader` cookie | Server, and the cookie in your browser | The cookie lasts up to 2 years from when it was set. The server record has no expiry. | No. Clearing cookies does not delete the server record. Ask us (section 4). |
| Account (Google id, email, name, picture address) | Server | No expiry. The session cookie lasts 90 days. | No. There is no account deletion in the app. Ask us (section 4). |
| Request counters (hashed keys) | Server | Each row gets an expiry of twice its counting window. Expired rows are deleted by a clean-up that runs on about one in fifty counted requests, so they can stay longer when traffic is low. | No. |
| Platform logs | Vercel | Short, set by the hosting plan (about one hour was observed in October 2026 and it can change). ⚠️ [OWNER DECISION: confirm the period shown in the Vercel account before publishing] | No. |
| Data sent to Together AI | Together AI | ⚠️ [LEGAL REVIEW: Together AI's retention terms for the operator's account and for your own key] | No. |

<!-- NOTE FOR OWNER: the limits are shipped with these defaults and are set by environment variables (docs/ops/configuration.md). Update this text if the operator changes them. -->

When you delete something in the app, the server removes the rows (it does not keep a hidden copy in the app's tables). If you are offline, the delete is kept in the browser and sent the next time the app loads. A document you delete on one device disappears from your other devices the next time they sync.

Signing out deletes the cookies and clears the library copy in that browser. It does **not** delete anything on the server, your pasted key or your settings.

## 2. Backups

- **The app makes no automatic server backups.** The database provider (Neon, Free plan) keeps a restore history of 6 hours, and the operator may also make backup files of the database by hand. Deleted data may remain in the restore history for up to that long, and in a backup file until that file is deleted: ⚠️ [OWNER DECISION: how long backup files are kept].
- **Backup file you download:** the app can create a file with the texts kept only in this browser and the marks, questions and positions for them. It is not encrypted, and it does not hold texts that live only on the server. Keep it safe. We cannot delete files you have downloaded.
- **Export of notes:** one Markdown file with the highlights, notes and questions of the texts held in your browser.
- There is no full export of everything the server holds about you yet.

## 3. Third parties

Browser speech services (if your browser sends audio to its vendor), Together AI, Google, Vercel and Neon keep data under their own terms. Deleting something in the app does not delete what they have already received. See the Privacy Policy and the AI notice.

## 4. Asking us to delete or export data

To delete your account or the server copies of your data, or to ask what we hold, write to [jm@useclave.io](mailto:jm@useclave.io). Today this is done by hand by the operator. We will answer within ⚠️ [OWNER DECISION: time to answer]. We may ask you to prove who you are: ⚠️ [LEGAL REVIEW: identity checks and the exact rights and deadlines that apply].

## 5. Inactive accounts

The app does not delete inactive readers or accounts. ⚠️ [OWNER DECISION: whether to set a period after which inactive data is deleted, and how long]. ⚠️ [LEGAL REVIEW: whether a retention period is required]

## 6. Product analytics records (only if switched on)

If the operator switches on product analytics (privacy policy, section 3A), its records are deleted automatically after ⚠️ [OWNER DECISION: how many days analytics records are kept; the app's default is 120]. They hold no text, title, address, note or question, and cannot be tied to a document. In daily mode they cannot be tied to you once the day is over. They are not part of the backup file you download, and you cannot delete them yourself.
