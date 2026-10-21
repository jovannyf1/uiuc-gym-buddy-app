# Put Illini Workout Buddy online

The website lives at a Vercel address. Its accounts, schedules, invitations, and chats live on a separate Render service with a persistent SQLite disk. This is necessary because [Vercel Functions do not provide persistent writable files](https://vercel.com/docs/functions/runtimes). The repository contains both setup files; it does not contain a real site address or any secret keys.

## 1. Create the persistent backend on Render

Connect the GitHub repository to Render and create a **Blueprint** from [`render.yaml`](../render.yaml). The Blueprint builds the existing Dockerfile as one web service in Ohio, attaches a 1 GB disk at `/app/data`, and waits for passing GitHub checks before later automatic deploys. Accept the paid plan only after reviewing its displayed price. [Render's current pricing](https://render.com/pricing) lists this `0.5c-512mb` web service at **$7/month plus $0.25/month for the 1 GB disk**, before any extra usage. A free Render web service cannot attach the disk; without it, account and chat data would disappear on redeploy. Nothing in this repository creates a paid service by itself.

When the Render deployment finishes, copy its actual HTTPS `.onrender.com` address. Open `/api/auth/netid/config` at that address: a JSON response confirms the API has started. Sign-up will still say setup is pending until email delivery is configured in step 3.

## 2. Create the Vercel website

Import the same GitHub repository into Vercel with the **Root Directory** at the repository root. In the Vercel project's Production environment variables, set `BACKEND_ORIGIN` to the Render HTTPS origin from step 1 (scheme and host only; do not add `/api`). Deploy the production branch. [`vercel.mjs`](../vercel.mjs) installs both dependency sets, builds `client/`, serves `client/dist`, and forwards `/api/*` requests to Render under the same visible Vercel address. It refuses to build without a real HTTPS backend address.

Copy the resulting stable Vercel production address. If you later add a custom domain, use that as the public app address and update the settings in step 3. Preview deployments need their own `BACKEND_ORIGIN` setting and an allowed origin on the backend; leave previews unshared until they have been tested.

## 3. Turn on verified email sign-in

Create a Resend account, verify a sending domain you control, and make a sending API key. Resend's test sender can reach only the account owner; a [verified sending domain](https://resend.com/docs/send-with-phoenix) is needed to deliver sign-up links to other students. In **Render → the API service → Environment**, add these four values, then redeploy the service:

| Name | Value |
| --- | --- |
| `RESEND_API_KEY` | The secret sending key from Resend. Keep it only on Render. |
| `EMAIL_FROM` | A sender address at the verified domain you actually own. |
| `PUBLIC_APP_URL` | The exact HTTPS Vercel production origin students will open. Verification and password-reset links point here. |
| `CLIENT_ORIGIN` | The same exact HTTPS Vercel origin, so the API accepts browser writes forwarded through Vercel. |

The signup form accepts any valid email address. It sends a verification link and requires that link before the account can sign in; password resets also arrive by email. Email verification proves control of an inbox, **not** current UIUC student status. Illinois NetID sign-in still requires separate campus registration. Do not enable `ALLOW_PILOT_AUTH` on the public service; that older flow checks only the spelling of an `@illinois.edu` address. The screenshot feature separately needs an optional server-side `OPENAI_API_KEY` on Render.

These four values are deliberately not hardcoded in `render.yaml`: the Vercel URL is unknown when Render is first created, and the Resend key must stay secret. The safe fixed settings (`NODE_ENV`, `DATA_DIR`, secure cookies, and disabled pilot auth) are in the Blueprint.

## 4. Look at the live app

Open the Vercel production URL on a phone or another browser. Create an account, receive its email, open the verification link, sign in, edit the profile, and send a message between two accounts. Refresh the page and confirm the data remains. Restart or redeploy the Render service and check again; that confirms the disk is mounted where the database writes. Test a schedule upload through the Vercel URL. Do not share the address as ready until these steps work.

On the native iPhone app, enter the **Render HTTPS origin** in the app's **Server** settings. The iPhone app and Vercel website then use the same backend and accounts; email verification and reset links open the Vercel website. Physical iPhone installation still needs Xcode and Apple signing, as described in [`ios/SETUP.md`](../ios/SETUP.md). Safari users can add the Vercel website to the Home Screen without installing the native app.

If Illinois NetID is configured later, register its web callback at the public Vercel origin plus `/api/auth/netid/callback`, because sign-in returns through Vercel's API proxy. Keep the Illinois OIDC client secret on Render.

References: [Vercel API rewrites](https://vercel.com/docs/routing/rewrites), [Render Blueprints](https://render.com/docs/blueprint-spec), and [Render persistent disks](https://render.com/docs/disks).
