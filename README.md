# UIUC Gym Buddy App

UIUC Gym Buddy App helps UIUC students find another student who is free to go to the gym at the same time. Students can enter recurring free times by hand or upload a calendar export or schedule screenshot, review suggested free windows, find a compatible buddy, and send a dated gym meetup invitation. The app does **not** track gym busyness.

## Run it locally

This project needs Node.js 24 or newer. On a Mac, double-click **Launch UIUC Gym Buddy App.command** to install dependencies if needed, start the app, and open it in your browser. Keep the Terminal window open while using the app.

Or, in a Terminal opened in this folder, run:

```sh
npm install
npm --prefix client install
npm run dev
```

Open **http://localhost:5173**. Create two accounts in different browser sessions to try matching and invitations. Account addresses must end in `@illinois.edu`; this first version checks the address format but does **not** verify mailbox ownership. Local data is saved to `data/app.db` and remains on this computer.

To run the built version, run `npm run build` followed by `npm start`, then open **http://localhost:8787**.

## Schedules and privacy

- **Manual:** Add or remove recurring weekly windows in *My availability*.
- **Google, Outlook, Apple Calendar:** Export a calendar as an `.ics` file, upload it in *Import schedule*, review the proposed free windows, then save the ones you want. This is a one-time import; it does not stay synced to your calendar.
- **Screenshot:** A PNG, JPG, or WebP of a weekly schedule can be interpreted with the OpenAI API. Copy `.env.example` to `.env`, add your own `OPENAI_API_KEY`, and restart the app. Without a key, manual entry and `.ics` imports still work. Screenshot analysis sends that image to OpenAI for interpretation; the app does not save the image or calendar event titles. The proposed times require review before they are added.

The importer uses the next seven days in the `America/Chicago` timezone to propose a **recurring weekly** availability template. One-off commitments can change, so students should check and update their availability before arranging a meetup. Only the free windows a student chooses to save are used for matching. Other students see shared openings, not private calendar commitments.

## What works in this version

- Account registration and sign-in, saved profiles, and optional partner-gender preferences
- Manual weekly availability and schedule-import suggestions
- Matches based on shared free windows and gym locations
- Dated meetup invitations with accept, decline, and cancel actions
- Responsive keyboard-accessible web interface

This is a local pilot, not a public campus launch. Before inviting real students to use a hosted version, add mailbox verification, HTTPS hosting, user reporting/moderation, and a clear privacy/retention policy. Live Google/Outlook account syncing would require OAuth setup; Apple Calendar has no equivalent general web sign-in, so `.ics` export is the supported path here.
