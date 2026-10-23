# Put Illini Workout Buddy online for $0

The free hosting setup is **Vercel Hobby for the website and API, plus Supabase Free for PostgreSQL**. Vercel serves the React site and runs the Express API; Supabase saves accounts, profiles, schedules, matches, meetups, and chats. This setup does not need a separate paid server. Keep both accounts on their free plans. Supabase may pause a free project after a week without activity, so reopen the app and confirm the project is active before sharing it after a quiet week. The free database includes 500 MB. See [Supabase free-plan limits](https://supabase.com/docs/guides/platform/billing-on-supabase) and [Vercel Hobby](https://vercel.com/docs/plans/hobby).

## 1. Create the free Supabase database

Create a Supabase project on the Free plan and choose a US region. In the project dashboard, open **Connect → Transaction pooler** and copy the connection URI. It should use port `6543`; that pooler mode is intended for serverless functions such as Vercel. The app runs the versioned SQL in [`supabase/migrations/`](../supabase/migrations/) the first time its API starts. The connection URI contains the database password, so add it only as a Vercel environment variable and never put it in the browser app or GitHub. [Supabase connection guidance](https://supabase.com/docs/guides/database/connecting-to-postgres).

## 2. Import the repository into Vercel

Import `jovannyf1/uiuc-gym-buddy-app` from GitHub. Leave the project root at the repository root; `vercel.json` sets the install and build commands, and the Express entry point is [`index.js`](../index.js). The Vite build copies static files to `public/` for Vercel's CDN. Vercel also runs the API in a Node.js function. Requests larger than 4.5 MB are rejected by Vercel, so screenshot uploads are capped below that limit. [Vercel Express hosting](https://vercel.com/docs/frameworks/backend/express) · [function limits](https://vercel.com/docs/functions/limitations).

In **Vercel → Project → Settings → Environment Variables**, add these for Production:

| Name | Value |
| --- | --- |
| `SUPABASE_DATABASE_URL` | The Supabase transaction-pooler connection URI from step 1. |
| `EMAIL_FROM` | The sender name and email address, such as `Illini Workout Buddy <you@gmail.com>`. |
| `PUBLIC_APP_URL` | The exact public HTTPS Vercel address, such as `https://your-project.vercel.app`. |
| `SMTP_HOST` | Your email provider's SMTP host. For Gmail, use `smtp.gmail.com`. |
| `SMTP_PORT` | `465` for TLS, or `587` for STARTTLS. |
| `SMTP_USER` | The complete sender email address. |
| `SMTP_PASSWORD` | An app password or SMTP password from the email provider. |

These secrets stay on the server. For Gmail, make an App Password in the Google account's security settings and use that in `SMTP_PASSWORD`; do not use the usual account password. Vercel permits authenticated SMTP over ports 465 and 587, and the app waits for delivery before replying. [Vercel SMTP guidance](https://vercel.com/kb/guide/serverless-functions-and-smtp). Resend can also be used instead by setting `RESEND_API_KEY` and leaving the SMTP host blank; sending to classmates requires a verified sender domain.

The existing app verifies email addresses itself and stores the hashed account credentials and sessions in Supabase Postgres. Every application table has row-level security enabled and no browser-role policies; the Express server uses the private database URI, so browsers cannot read account data through Supabase's Data API. Email verification confirms access to an inbox, not UIUC enrollment. The built-in Supabase Auth email sender is not used. If no SMTP credentials are set, email signup stays disabled rather than accepting unverified accounts.

`OPENAI_API_KEY` is optional for interpreting screenshot schedules; it is a separate API service and may have usage charges. Manual availability and `.ics` calendar imports do not need that key. NetID sign-in is deferred and is not part of this launch. Production never enables the local pilot account endpoints.

## 3. Test the deployed app before sharing it

After Vercel finishes its first production deployment, open the Vercel HTTPS address. Check that `/api/auth/config` returns JSON with `emailAuthEnabled: true`, then test these paths in the app:

- Create an account using a real inbox, open its verification email, and sign in. Try a wrong password, then request a reset email and sign in with a new password.
- Edit the profile and availability; refresh and confirm both remain saved.
- Use a second account in a separate browser to find a buddy, start a chat, and send a meetup invitation.
- Upload a small `.ics` file and, if `OPENAI_API_KEY` is configured, a schedule screenshot under 4 MB.
- Refresh or revisit from another device and confirm the saved profile and chat still appear.

Keep the address private until these checks work. The native iPhone app uses the same API; enter the Vercel HTTPS address in its **Server** setting. Safari can also install the website from **Share → Add to Home Screen**.
