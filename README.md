# UIUC Gym Buddy App

UIUC Gym Buddy App helps people near UIUC find a workout partner who is free to go to the gym at the same time. Members can customize a profile, enter recurring free times by hand or upload a calendar export or schedule screenshot, review suggested free windows, find a compatible buddy, chat, and send a dated gym meetup invitation. A member can optionally show that they are working out now at a chosen campus gym; that status expires automatically. The app does **not** track gym busyness or GPS location. Email signup verifies an inbox, not student status.

## Run it locally

This project needs Node.js 24 or newer. On a Mac, double-click **Launch UIUC Gym Buddy App.command** to install dependencies if needed, start the app, and open it in your browser. Keep the Terminal window open while using the app.

Or, in a Terminal opened in this folder, run:

```sh
npm install
npm --prefix client install
npm run dev
```

Open **http://localhost:5173**. Create two pilot accounts in different browser sessions to try matching, chat, presence, and invitations. Pilot account addresses must end in `@illinois.edu`; this local sign-in checks the address format but does **not** verify mailbox ownership. Local data is saved to `data/app.db` and remains on this computer. Pilot password sign-in is disabled by default in production and whenever Illinois single sign-on is configured.

To run the built version, run `npm run build` followed by `npm start`, then open **http://localhost:8787**.

## Schedules and privacy

- **Manual:** Add or remove recurring weekly windows in *My availability*.
- **Google, Outlook, Apple Calendar:** Export a calendar as an `.ics` file, upload it in *Import schedule*, review the proposed free windows, then save the ones you want. This is a one-time import; it does not stay synced to your calendar.
- **Screenshot:** A PNG, JPG, or WebP of a weekly schedule can be interpreted with the OpenAI Responses API. Copy `.env.example` to `.env`, add your own `OPENAI_API_KEY`, and restart the app. Without a key, manual entry and `.ics` imports still work. Screenshot analysis sends that image to OpenAI for interpretation; the app does not save the image or calendar event titles. The proposed times require review before they are added. OpenAI’s [image-input guide](https://developers.openai.com/api/docs/guides/images-vision) documents the supported image inputs.

The importer uses the next seven days in the `America/Chicago` timezone to propose a **recurring weekly** availability template. One-off commitments can change, so students should check and update their availability before arranging a meetup. Only the free windows a student chooses to save are used for matching. Other students see shared openings, not private calendar commitments.

Chat messages and profiles are stored in the app database. A student can block another person; blocks hide both students from each other's discovery and prevent new messages and invitations. To reduce unwanted invites, a student can send up to 10 workout invitations per day, with up to 3 to the same person. Reports are recorded, but a human review process is still needed before opening the app to the wider campus.

## iPhone and web

The responsive website includes an installable Home Screen experience. After it is hosted over HTTPS, open it in Safari on an iPhone and choose **Share → Add to Home Screen**. The site and the native app use the same server and student data.

To publish the website on Vercel while keeping its accounts and chats in a persistent database, follow [the Vercel hosting guide](docs/VERCEL.md). The website needs a separate HTTPS API service with a persistent `/app/data` volume.

A separate native SwiftUI iPhone app lives in [`ios/`](ios/). Its screens use the real API for profiles, schedule review, matching, presence, chat, and invitations. See [`ios/SETUP.md`](ios/SETUP.md) for Xcode, Apple signing, and iPhone setup. This repository includes an iOS Simulator build check on GitHub Actions; a physical iPhone build still needs a Mac with Xcode and an Apple signing account.

## Sign-in choices

Verified email and password sign-in is available on the website and in the native iPhone app when the server has `RESEND_API_KEY`, `EMAIL_FROM`, and `PUBLIC_APP_URL` configured. A person can sign up with **any email address they can verify**, set a password, open the verification link in their inbox, and then sign in. Password reset also uses an emailed link. Set up a verified sending domain with Resend before inviting classmates; the app never stores the email service key in the website or iPhone app. Email verification proves control of that mailbox, **not** enrollment at UIUC. The local pilot account form is separate and remains disabled in production once verified email sign-in is configured.

Illinois NetID is a separate sign-in option. It is not required for an email-and-password account.

The app has an OpenID Connect sign-in flow for Illinois NetID on the web and in the native iPhone app. It is **not active** until a University of Illinois identity application is registered and the four `ILLINOIS_OIDC_*` settings in [`.env.example`](.env.example) are configured. The app never asks for or stores a NetID password. The login button is hidden until sign-in is configured. University identity staff must confirm the approved issuer, app registration, redirect URI, and which claim establishes active student eligibility; a valid Illinois account alone does not establish that someone is a current student. Existing unverified pilot accounts require a reviewed migration before their data can be used with NetID sign-in.

Illinois Technology Services describes [Shibboleth and Entra ID as supported SSO options](https://answers.illinois.edu/illinois/132408). This implementation uses a registered OIDC client and must be checked with campus identity staff before launch.

## What works in this version

- Verified email registration, sign-in, password reset, saved profiles, and optional partner-gender preferences
- Manual weekly availability and schedule-import suggestions
- Matches based on shared free windows and gym locations
- Dated meetup invitations with accept, decline, and cancel actions
- Private chats with compatible students, opt-in expiring working-out-now status, and block/report controls
- Responsive web interface with iPhone Home Screen installation, plus a native SwiftUI app source project

The source includes a class pilot; a public deployment is not live yet. To make it usable by classmates, deploy the website and an HTTPS API with a persistent SQLite volume, then configure verified email delivery. The screenshot AI path needs an `OPENAI_API_KEY` if it will be used. The [`Dockerfile`](Dockerfile) builds the web client and API together; persist `/app/data` when hosting. Before a wider campus launch, add human review of reports, a privacy/retention policy, and student-eligibility checks, then test the experience with real students and assistive technology. Live Google/Outlook account syncing would require OAuth setup; Apple Calendar has no equivalent general web sign-in, so `.ics` export is the supported path here.

## Continue in a new Codex chat

Use [this GitHub repository](https://github.com/jovannyf1/uiuc-gym-buddy-app) as the source of truth. In a new chat, share that link and describe the change you want, for example: “Continue UIUC Gym Buddy App from this repository. Add [feature] and put the finished work on GitHub.” `AGENTS.md` gives the next chat the project goal, scope, and checks.
