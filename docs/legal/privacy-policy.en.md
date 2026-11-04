# Privacy Policy — Keeple

> **DRAFT. NOT LEGAL ADVICE.** This text was written from how the app's code works. It has not been reviewed by a lawyer. **Do not publish it** until the owner has filled in every field marked with ⚠️ and a legal review has been done.

**Last updated:** ⚠️ [OWNER DECISION: date at publication]

Keeple is a reading companion. You import articles, PDFs or text, read them, highlight, write notes, and ask an AI about passages. This policy says what the app stores, where, who else receives data, and what you can do about it. The service is in beta (see the Beta notice).

## 1. Who runs the service

- Operator: Menlo Software AIP. ⚠️ [OWNER DECISION: postal address and registration number of Menlo Software AIP, if any; its legal form is deliberately not stated here]
- Contact for privacy questions and requests: [jm@useclave.io](mailto:jm@useclave.io)
- Data protection officer or named privacy contact: ⚠️ [LEGAL REVIEW: whether one is required and who it is]

## 2. What is stored, and where

**In your browser (local storage).** Your library copy (list of texts, highlights, notes, AI questions and answers, reading positions), your appearance settings, the Together AI key if you paste one, and two small flags that remember you saw a first-visit hint and that the sample texts were added to your shelf. Texts that could not be saved on the server stay in the browser only.

**On our server (a PostgreSQL database hosted by Neon).** When the database is available, the app saves a copy of:

| Data | What exactly |
| --- | --- |
| Anonymous reader record | A random reader id and its creation time. |
| Documents you import | Title, author, description, year (if found), source address and label, topic, estimated reading time, the **full text**, favourite flag, a fingerprint (SHA-256) of the normalised text used to detect duplicates, timestamps. For a link that could not be read: the address (with any password typed into it removed), the title and description the page gives about itself, and the reason. |
| Highlights, underlines, notes | Kind, colour, the note text, and the selected passage with its position. |
| AI questions and answers | The action used, the selected passage, the whole conversation (your questions and the AI's answers), structured results (summaries, translations and similar), the model name, token counts and a cost estimate. |
| Reading progress | Position, fraction read, finished flag, time. |
| Account (only if you sign in) | Google subject id, email, name, address of your profile picture, the id of your reader, first and last seen times. |
| Request counters and AI allowance records | Counts per hashed client key and day or hour, used for the usage limits (section 8); a short-lived lock per hashed key that allows one AI generation at a time; and an hourly total of AI requests, tokens and the estimated cost of the shared AI key, which is not tied to any person. |

If the database cannot be reached, the app keeps your data in the browser and tries again later.

<!-- NOTE FOR OWNER: docs/ops/configuration.md and docs/ops/runbook.md (2026-10-18) say no production database was configured at that time. This draft follows the owner's statement that production uses Neon. Confirm that the database is on and which plan and region it uses. -->
<!-- NOTE FOR OWNER: schema.ts defines a `settings` table, but no route writes to it. Appearance settings stay in the browser only. If settings sync is added, update this section. -->

## 3. Cookies

Cookies are set only when the app saves something for you or you sign in. They are signed so they cannot be altered, but they are not encrypted. They hold random ids, not your name or email. All are `HttpOnly` and `SameSite=Lax`, and `Secure` in production.

| Cookie | Purpose | Lifetime |
| --- | --- | --- |
| `gloss_reader` | Identifies your anonymous reader so the server can find your library. | 2 years |
| `gloss_session` | Keeps you signed in (only after Google sign-in). Holds your account id. | 90 days |
| `gloss_oauth` | Temporary state for one sign-in attempt. Sent only to sign-in pages. | 10 minutes |

By default the app includes no advertising, analytics or tracking service. If the operator switches on first-party product analytics, section 3A applies. ⚠️ [LEGAL REVIEW: whether these cookies need a consent banner or other notice in the countries you serve]

## 3A. Product analytics (only if the operator switches it on)

By default the app does not measure how it is used. The operator can switch on first-party product analytics: the app records counts of actions itself and sends nothing to an analytics service or any other third party. ⚠️ [OWNER DECISION: whether product analytics is switched on, and in which of the two modes below]

In either mode a record says only that an action happened, never what you read or wrote. A record has the kind of action (for example "a text was opened"), a few fixed choices (for example that the text was a PDF, or that a question used the shared key), the type of page, the time and, if you arrived through a campaign link, the channel it came from. It never has text, a title, a web address, a note, a question to the AI, an answer, or the words you searched for. Nothing is recorded if your browser sends Do Not Track or Global Privacy Control.

- **Daily mode.** A record is tied to a code made from your network address, your browser's description and the date, mixed with a secret kept on the server. The address and the description are not stored, only the code. This is **pseudonymised data, not anonymous data**: during one day the code tells your browser apart from others, and the operator, who holds the secret, could recreate it for a known address and browser. The code is different every day, so it cannot follow you from one day to the next. Nothing is stored on your device.
- **Full mode.** A record is tied to a code derived from your reader id (the random id in the `gloss_reader` cookie), the same every day, so that the operator can see whether people come back. The reader id itself is not in the record. The campaign link that brought you is kept in your browser's session storage until you close the tab. ⚠️ [LEGAL REVIEW: whether full mode needs prior consent (a banner or a choice) in the countries you serve, and which legal basis applies]

Records are deleted automatically after ⚠️ [OWNER DECISION: how many days analytics records are kept; the app's default is 120]. ⚠️ [LEGAL REVIEW: how a request to delete or access analytics records is answered in full mode, where they are tied to a code and not to a name]

## 4. Sign-in with Google

Google is the only sign-in method. We ask Google for `openid email profile`. We keep your Google subject id, email, name and picture address. We never see your Google password. We use Google's access token once, to read your profile, and do not store it. Your browser loads your profile picture from the address Google gave.

When you sign in, the library you built in that browser before signing in is attached to your account. When you sign out, the app deletes the cookies and clears the library copy in that browser. It does **not** delete anything on the server, your pasted key or your settings. A copy of a session cookie made elsewhere would stay valid for up to 90 days, because sessions cannot be revoked by the server.

## 5. AI and voice

When you press an AI button, the app sends text to Together AI, a third party. This can be your question and the passage, nearby paragraphs, or large parts of the document (for summaries, key concepts, test questions and translation). Nothing is sent unless you press a button. See the **AI notice** for details.

Voice: the microphone starts only after you press its button. Browser speech recognition is done by your browser's speech service, and depending on the browser the audio may go to the browser vendor. If your browser has none, your recording can be sent to our server and on to Together AI to be turned into text. We do not store audio. Reading aloud uses your browser's voices. An online voice may send the text being read to the browser vendor.

## 6. Importing links and files

When you import a link, our server fetches that address (public web hosts only) and stores the extracted text. When you upload a file (PDF, text, Markdown, Word, EPUB or HTML) or paste text, the server reads it and stores the text. A page captured by a bookmarklet is processed the same way. The original file or page is not kept; the extracted text is. Do not import material you have no right to use or that is confidential.

## 7. Who else receives data

| Provider | Role | Data |
| --- | --- | --- |
| Vercel | Hosting and platform logs | All requests to the app. Vercel keeps its own request and function logs. |
| Neon | Database | Everything in the server list in section 2. |
| Together AI | AI answers, embeddings, transcription | Text and audio you choose to send (section 5). |
| Google | Sign-in | The sign-in exchange (section 4). |

We do not name or use other providers. The app's own log lines contain error codes and usage counts (operation, whose key paid, token counts, cost estimate). They do not contain document text, notes, questions, audio or API keys. ⚠️ [LEGAL REVIEW: confirm what each provider logs and under which terms it acts for us]

## 8. Usage limits and hashed keys

To limit abuse and cost, the app counts requests per client address, per reader id and (when you are signed in) per account id, and allows one AI generation at a time per user. Only a hash of each key is stored in the database, with a count and an expiry. The app also keeps hourly totals of what the shared AI key was used for (number of requests, tokens, estimated cost, and how many failed); these totals are not tied to any person. The raw address is read from the request headers and held only in the server's memory for the counting window; the app does not write it to the database.

<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says the limiter is per process only. The code also counts in the `rate_hits` table (rateStore.ts), keyed by a SHA-256 hash, so this draft describes the hashed database counters. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md says Google sign-in keeps "your account id and email". The code (schema.ts, auth.ts) also stores the name and the picture address. This draft follows the code. -->
<!-- NOTE FOR OWNER: docs/privacy-and-providers.md calls PostgreSQL "your own database". This draft names Neon, as stated by the owner. -->


<!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
Current beta limits: anonymous visitors, 3 AI questions per day per client; signed-in users, 20 per day; one AI generation at a time per user; size limits on documents; and a global daily budget that can pause AI for everyone. The operator may change these.

## 9. International transfers

Vercel, Neon, Together AI and Google are companies that may process data in countries other than yours. Server region: the app's functions run on Vercel in region `iad1` (Washington, D.C., United States). Database region: ⚠️ [OWNER DECISION: the region of the Neon database; the repository does not state it]. ⚠️ [LEGAL REVIEW: transfer mechanism and required disclosures]

## 10. Keeping and deleting data

You can delete a document (this also removes its marks, questions and reading position), a single highlight or note, or an AI answer, from inside the app. There is no automatic expiry. There is no self-service account deletion yet. See the **Retention and deletion policy**.

## 11. Your choices and rights

In the app you can delete content, download a backup and a Markdown export of your notes, remove your pasted key, and clear your browser data. For anything else, such as deleting your account or copies of your data on the server, write to [jm@useclave.io](mailto:jm@useclave.io) (see section 16). Response time and process: ⚠️ [OWNER DECISION: time to answer requests]. ⚠️ [LEGAL REVIEW: wording of data subject rights, how to verify identity, and the supervisory authority to name]

## 12. Legal bases

⚠️ [LEGAL REVIEW: a lawyer must choose and state the legal basis for each purpose (providing the service, security and limits, AI processing, sign-in) under the laws that apply]

## 13. Children

⚠️ [OWNER DECISION: minimum age for using Keeple]. ⚠️ [LEGAL REVIEW: rules on children's data in the countries you serve]

## 14. Security

Each request to your data is checked against your reader id. Production uses HTTPS. The app does not itself encrypt the text of your documents, notes or questions in the database; protection at rest depends on the database host. A backup file you download is not encrypted. No system is perfectly secure.

## 15. Changes

⚠️ [OWNER DECISION: how users will be told about changes, for example a notice in the app or an email]

## 16. Contact and privacy requests

Menlo Software AIP, the operator, answers privacy questions and requests at **[jm@useclave.io](mailto:jm@useclave.io)**.

- **What you can ask for:** a copy of the data we hold about you, correction, deletion of your library or your account, an explanation of how your data is used, and withdrawal of anything you agreed to. Deleting inside the app (section 10) does not need a request.
- **What to send:** which request it is. If you signed in, the email of the Google account you used. If you never signed in, your library is known to the server only by a random reader id, stored in the `gloss_reader` cookie of your browser: we can find that library only if you send us that id, and we cannot tell you apart from someone else without it.
- **What happens next:** we may ask you to confirm that the library or account is yours before we act. ⚠️ [LEGAL REVIEW: identity verification, deadlines, and the exact rights that apply]. ⚠️ [OWNER DECISION: the time in which requests are answered]
- **Requests about the AI provider, hosting or sign-in:** those companies act as described in section 7; a request to delete data also covers the copies we hold, but not copies a provider keeps under its own terms (see the AI notice and the Retention and deletion text).
