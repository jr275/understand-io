# Beta limitations notice — Keeple.me

> **DRAFT. NOT LEGAL ADVICE.** This text was written from how the app works. It has not been reviewed by a lawyer. **Do not publish it** until the owner has filled in every field marked with ⚠️ and a legal review has been done.

**Last updated:** ⚠️ [OWNER DECISION: date at publication]

Keeple.me is in **beta**. It works, but it is still being built. Please read this before you rely on it.

- **Things can change or break.** Features, limits and the look of the app may change. Parts may be paused or removed. No uptime or support is promised.
- **Keep a backup.** Your library is saved in your browser and, when the server database is available, on our server. Data can still be lost. Use "Download backup" in the library. The backup holds the texts kept only in your browser, not texts kept only on the server.
- **Usage limits.** The operator may change them at any time:

  <!-- NOTE FOR OWNER: these are the defaults shipped in the code (docs/ops/configuration.md, GLOSS_QUOTA_* and GLOSS_BUDGET_*); the operator can change them without a release, and these texts must be updated if they do. The limits count the operator's shared AI key only: a reader's own Together key is not counted, but the one-generation-at-a-time rule applies to it too. -->
  - anonymous visitors: 3 AI questions per day per client;
  - signed-in users: 20 AI questions per day;
  - one AI generation at a time per user;
  - size limits on documents (the app tells you when a file or text is too large);
  - a global daily budget that can pause AI for everyone. When it is reached, AI features can be unavailable for a while. Reading, highlighting and notes do not need AI and are not affected.
- **AI can be wrong.** Read the AI notice.
- **Sign-in may be unavailable.** Google sign-in works only when the operator has turned it on. Without it, your library is tied to your browser.
- **Link import can fail.** Some sites refuse requests from our server, or need a login or payment. You can paste the text or upload a file instead.
- **Browsers and devices.** The app has been tested mainly in Chrome and on emulated phone sizes, not on every browser, device or screen reader. Voice features depend on your browser.
- **Sessions.** Signing out removes the cookie in your browser, but a copy of it made elsewhere would stay valid for up to 90 days.

Found a problem? Tell us: [jm@useclave.io](mailto:jm@useclave.io)
