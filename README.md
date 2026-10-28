# UIUC Gym Buddy App

UIUC Gym Buddy App helps people near UIUC find a workout partner who is free to go to the gym at the same time. Members can customize a profile, enter recurring free times by hand or upload a calendar export or schedule screenshot, review suggested free windows, find a compatible buddy, chat, and send a dated gym meetup invitation. A member can optionally show that they are working out now at a chosen campus gym; that status expires automatically. The app does **not** track gym busyness or GPS location. Email verification is optional for account recovery and does not prove student status.

## Run it locally

This project needs Node.js 24 or newer. On a Mac, double-click **Launch UIUC Gym Buddy App.command** to install dependencies if needed, start the app, and open it in your browser. Keep the Terminal window open while using the app.

Or, in a Terminal opened in this folder, run:

```sh
npm install
npm --prefix client install
npm run dev
```

Open **http://localhost:5173**. To test email signup and password reset locally, set `EMAIL_FROM`, `PUBLIC_APP_URL=http://localhost:5173`, and either SMTP credentials or `RESEND_API_KEY` in a private `.env` file. The email form stays unavailable when delivery is not configured. Registration signs a person in immediately; they can request an optional verification message from inside the app to protect account recovery. Local data is saved to `data/app.db` and remains on this computer. The legacy pilot endpoints remain for local development fixtures but are not offered in the app and must stay disabled on public deployments.

To run the built version, run `npm run build` followed by `npm start`, then open **http://localhost:8787**.

## Schedules and privacy

- **Manual:** Add or remove recurring weekly windows in *My availability*.
- **Google, Outlook, Apple Calendar:** Export a calendar as an `.ics` file, upload it in *Import schedule*, review the proposed free windows, then save the ones you want. This is a one-time import; it does not stay synced to your calendar.
- **Screenshot:** A PNG, JPG, or WebP of a weekly schedule can be interpreted with the OpenAI Responses API. Copy `.env.example` to `.env`, add your own `OPENAI_API_KEY`, and restart the app. Without a key, manual entry and `.ics` imports still work. Screenshot analysis sends that image to OpenAI for interpretation; the app does not save the image or calendar event titles. The proposed times require review before they are added. OpenAI’s [image-input guide](https://developers.openai.com/api/docs/guides/images-vision) documents the supported image inputs.

The importer uses the next seven days in the `America/Chicago` timezone to propose a **recurring weekly** availability template. One-off commitments can change, so students should check and update their availability before arranging a meetup. Only the free windows a student chooses to save are used for matching. Other students see shared openings, not private calendar commitments.

Chat messages and profiles are stored in the app database. A student can block another person; blocks hide both students from each other's discovery and prevent new messages and invitations. To reduce unwanted invites, a student can send up to 10 workout invitations per day, with up to 3 to the same person. Reports are recorded, but a human review process is still needed before opening the app to the wider campus.

## iPhone and web

The responsive website includes an installable Home Screen experience. After it is hosted over HTTPS, open it in Safari on an iPhone and choose **Share → Add to Home Screen**. The site and the native app use the same server and student data.

To publish the website on Vercel with saved accounts and chats, follow [the Vercel and Supabase hosting guide](docs/VERCEL.md). The free setup runs the website and API on Vercel and stores persistent data in Supabase Postgres; no separate paid server is needed.

[How to know the app works](docs/VERIFICATION.md) records local evidence and the checks to run at the public address before sharing it.

A separate native SwiftUI iPhone app lives in [`ios/`](ios/). Its screens use the real API for profiles, schedule review, matching, presence, chat, and invitations. See [`ios/SETUP.md`](ios/SETUP.md) for Xcode, Apple signing, and iPhone setup. This repository includes an iOS Simulator build check on GitHub Actions; a physical iPhone build still needs a Mac with Xcode and an Apple signing account.

## Sign in with email

Email and password sign-in is available on the website and in the native iPhone app when a mail provider is configured with `EMAIL_FROM`, `PUBLIC_APP_URL`, and either SMTP credentials or `RESEND_API_KEY`. A person can sign up with **any email address**, use the app immediately, and verify the address later from a reminder inside the app. Verification matters for account recovery: password-reset email is available only after the address is verified. Password reset signs out old sessions. Password hashes, verification status, and sessions are saved in the app database; on Vercel that database is Supabase Postgres. The app never stores the email service password in the website or iPhone app. Verification proves control of that mailbox, **not** enrollment at UIUC. NetID sign-in is deferred and is not available in this version.

New accounts choose a case-insensitive, unique `@username` separate from their full name. A username and email address are reserved as soon as the account is created, including before email verification. Existing accounts receive a starter `member<ID>` username that can be changed in the profile. Full names can repeat; sign-in still uses email.

## Quick tour and Gemini help

After the first sign-in, the app asks whether the person wants a quick tour; choosing **Not now** leaves the app ready to use, and Help can replay the tour later. The tour works without an AI key. Gemini questions use the server-only `GEMINI_API_KEY`, default to `gemini-2.5-flash-lite`, and are limited to 12 per account per hour and 600 characters. Only the typed question and fixed app instructions are sent; chats, schedules, and profile data are not. Questions are not saved. Google’s free-tier quotas and terms may change, and free-tier prompts may be used to improve Google products, so don’t enter passwords, verification codes, or sensitive details. Without a key, the tour remains available and the Help panel explains that AI answers are not configured.

## What works in this version

- Immediate email registration and sign-in, unique usernames and emails from account creation, optional verification for account recovery, password reset for verified accounts, saved profiles, and optional partner-gender preferences
- Manual weekly availability and schedule-import suggestions
- Matches based on shared free windows and gym locations
- Dated meetup invitations with accept, decline, and cancel actions
- Private chats with compatible students, opt-in expiring working-out-now status, and block/report controls
- Responsive web interface with iPhone Home Screen installation, plus a native SwiftUI app source project

The public website is at [uiuc-gym-buddy-app-client.vercel.app](https://uiuc-gym-buddy-app-client.vercel.app/). Test its account, matching, and chat flows with real classmates before treating the public journey as complete. The screenshot AI path needs an `OPENAI_API_KEY` if it will be used and may incur separate API charges. Before a wider campus launch, add human review of reports, a privacy/retention policy, and student-eligibility checks, then test the experience with real students and assistive technology. Live Google/Outlook account syncing would require OAuth setup; Apple Calendar has no equivalent general web sign-in, so `.ics` export is the supported path here.

## Continue in a new Codex chat

Use [this GitHub repository](https://github.com/jovannyf1/uiuc-gym-buddy-app) as the source of truth. In a new chat, share that link and describe the change you want, for example: “Continue UIUC Gym Buddy App from this repository. Add [feature] and put the finished work on GitHub.” `AGENTS.md` gives the next chat the project goal, scope, and checks.
