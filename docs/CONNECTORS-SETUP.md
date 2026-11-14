# Connecting real accounts (Google Meet, Moodle, ClickUp)

Every connection works in **demo mode** with sample data until you add real credentials in
**Settings → Connections** (`http://localhost:8001/fast-track/settings`). Each card shows a status
line: a green dot and "Connected" once the last Test connection passed against the real account.

Type keys into Settings only. Never paste them into chat, a commit or a doc.

## Google Meet (about 10 minutes)

You need a Google Workspace account that hosts the Meet calls (Meet's REST API reads Workspace calls;
personal Gmail accounts don't get transcripts).

1. Open <https://console.cloud.google.com/>, top bar → project picker → **New project**
   (name: `Staffroom Fast Track`). Select it.
2. **APIs & Services → Library**: enable **Google Meet REST API** and **Google Drive API**.
3. **APIs & Services → OAuth consent screen** (Google Auth Platform): User type **Internal** if your
   Workspace allows it (no review needed), otherwise **External** and add yourself under **Test users**.
   App name `Staffroom Fast Track`, your email as support and developer contact.
   On **Data access / Scopes**, add:
   - `https://www.googleapis.com/auth/meetings.space.readonly`
   - `https://www.googleapis.com/auth/drive.meet.readonly`
   - `openid`, `email`
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**, type **Web application**.
   Under **Authorised redirect URIs** add exactly what the Meet card shows, for the laptop:
   `http://localhost:8001/api/connectors/google/callback`
   (add the deployed site's `https://…/api/connectors/google/callback` too if you will sign in there).
5. Copy the **Client ID** and **Client secret** into the Meet card's two fields → **Save**.
6. Press **Sign in with Google**, pick the Workspace account, allow. You land back on Settings,
   signed in. The status line turns green after the automatic check.
7. Hold a short Meet with **transcription switched on** (Activities → Transcripts), end it, wait a few
   minutes for Google to finish the transcript, type its code (`abc-defg-hij`) into **Class Meet code**,
   and press **Pull class from Meet**.

The connection renews itself (a refresh token is stored in the local database), so it keeps working
after the first hour. **Disconnect** revokes it at Google.

Quick fallback: the OAuth Playground (<https://developers.google.com/oauthplayground>) can mint a
one-hour access token for the same scopes; paste it into "Or paste an access token".

## ClickUp (2 minutes)

1. ClickUp → avatar → **Settings → Apps → API Token → Generate**. It starts with `pk_`.
2. Paste it into the ClickUp card → **Save**. Leave Workspace id and List id blank: the first sync
   creates a "Staffroom Fast Track" Space with a "Fast Track follow-ups" List.
3. Press **Sync flagged learners**. Tasks appear in ClickUp with each learner's launch link.

## Moodle (10 minutes, needs site admin)

1. Site administration → Advanced features → enable **Web services**; Server → Web services →
   **Manage protocols** → enable **REST**.
2. **External services → Add**: name `Fast Track`, enabled, authorised users only. Add functions
   `core_webservice_get_site_info`, `core_user_get_users_by_field`, `core_enrol_get_enrolled_users`,
   `core_grades_update_grades`. Authorise your admin user.
3. **Manage tokens → Create token** for that user and service.
4. In the Moodle card: site URL (e.g. `https://moodle.example.com`), the token, then the course id
   (from `course/view.php?id=…`) and the activity id for grades → **Save**.

No Moodle to hand? <https://sandbox.moodledemo.net> resets every hour; its front page shows the admin
login, which is enough for a demo (re-enter the token after each reset).

## Public site

With `FASTTRACK_PUBLIC=1` every connector stays in demo mode, Google sign-in is switched off and
Settings are read-only, even if keys are set as environment variables. Set
`FASTTRACK_PUBLIC_CONNECTORS=1` on the host only if you deliberately want the deployed site to use
the team's real accounts.
