# How to know Illini Workout Buddy works

The goal is a real workout plan between two people, not merely a successful build. This record separates evidence from the local code from checks still needed at the address another person will open. The expected results below are proposed acceptance criteria; confirm them with the person using the app before calling the experience finished.

## Current evidence (October 28, 2026)

| Promise a person can check | Evidence in this repository | Status |
| --- | --- | --- |
| An unverified email or case variant cannot create a second account. A username or case variant cannot be reused; an existing member can change a starter username, but cannot take another member's. | `server/email-auth.test.js` and a local browser signup at `http://localhost:5180` using isolated SQLite | **Local API and browser pass for duplicate signup.** The browser showed “This username is already taken” and “This email already has an account” while the first account was still unverified. PostgreSQL migration and public-site checks await this release. |
| A new email account opens the app immediately; after sign-out it signs in without verification; a wrong password is rejected. The signed-in reminder can send a verification link, and only verified addresses can reset passwords. | `server/email-auth.test.js`, `server/email-smtp.test.js` | **Local automated pass.** Delivery is simulated; no real inbox or provider was checked. |
| A production server offers email sign-in to verified and unverified email accounts. Old pilot or NetID-only accounts cannot access matches, chats, or meetups. | `server/netid-mode.test.js` | **Local automated pass.** The test exercises API access with a production setting. |
| Email signup, optional verification, reset, and a changed password work with saved account data after reconnecting to PostgreSQL. | `server/postgres.integration.test.js`, run by the `postgres-integration` GitHub job on pull requests | **GitHub CI pass for [PR #2](https://github.com/jovannyf1/uiuc-gym-buddy-app/pull/2)** on the optional-verification release. The new username migration awaits its own CI check. |
| Two people with no shared free time do not match; a 60-minute shared Monday window appears with the exact time. | `server/first-run.test.js`, `server/core.test.js` | **Local automated pass.** The test calls the API, not the visible website. |
| Two unverified email users can match, chat, send a dated invitation, accept it, and both see the accepted plan. | `server/first-run.test.js` | **Local automated pass.** The test uses two separate sessions. |
| Profiles, availability, chat, and the accepted invitation survive closing the local database. | `server/first-run.test.js` | **Local automated pass for SQLite.** Hosted Supabase persistence has not been checked in this run. |
| A third person cannot open a private chat, and blocking prevents further contact. | `server/social.test.js` | **Local automated pass.** This is a focused access check, not a security audit. |
| The website opens directly after registration and shows a nonblocking email reminder; sending a verification email can fail without ending the session. | Local browser walkthrough at `http://localhost:5175` using isolated SQLite and unavailable test SMTP | **Local browser pass.** Fresh registration opened My profile and showed “Your account is ready.” The email-send button reported delivery failure without ending the session; sign-out and sign-in to that same unverified account reopened the dashboard. No real email or production account was used. |
| The installed website works on a phone and another person can finish a workout plan without coaching. | Follow the public-address check below. | **Untested.** The public address exists, but this change has not yet been checked there or by another person. |

On October 28, for optional verification, `npm ci`, `npm --prefix client ci`, `npm test`, and `npm run build` passed locally. The tests reported **25 passed, 0 failed, 1 skipped**; the skipped PostgreSQL test needs `PG_TEST_URL`. This establishes the local API flow, including account access after a simulated email failure, but not the released site or real mail delivery. GitHub PostgreSQL and iPhone Simulator results for this change are pending. A physical-device run remains untested.

## Rerun after an edit

From the repository root, run these commands in order. They are also run on pushes and pull requests by `.github/workflows/checks.yml`; CI additionally supplies a PostgreSQL test database for the integration test.

```sh
npm ci
npm --prefix client ci
npm test
npm run build
```

Run `node --test server/first-run.test.js` for a quick check of the two-person journey while editing. A green CI result proves the tested code paths on that commit; still run the public-address check below after release.

## Check the version people will receive

Record the public HTTPS address and release commit before starting. Use two fresh email accounts in separate browsers or phones, and keep a short record of **expected / observed / pass, fail, or untested** for each step. Do not reuse the local test results as public results.

1. Open the address on a phone and a computer. Check that the signup page loads and the main controls are usable with touch and keyboard.
2. Register both accounts with real inboxes. Confirm each enters the app immediately and can sign out and back in before verifying. Check that the reminder appears inside the app and does not stop profile or match use. Then request verification, confirm each email arrives and its link opens the same public address, and try a wrong password and a real password-reset email.
3. Give one person Monday 5:00–6:30 p.m. and the other Tuesday 5:30–6:30 p.m., both with Strength training at ARC. Expect **no match**. Move the second person's time to Monday 5:30–6:30 p.m. Expect a **Monday 5:30–6:30 p.m. match** on both accounts.
4. Start a chat and send a dated Monday 5:30–6:00 p.m. invitation. The recipient should receive it, accept it, and both accounts should show **accepted**.
5. Close both browsers and reopen the public address. Profiles, schedules, chat, and the accepted plan should still appear. Have each person try to view data they were not given permission to see; record anything exposed.
6. Ask the intended user to make a workout plan without hints. Observe whether they finish and where they pause. Their result decides whether the flow is understandable.

If email or the database is not configured, mark the dependent steps **untested**, not passed. Never put test passwords, verification links, private chat text, or database credentials in the evidence record. A screenshot of the visible result and the date/device are useful evidence; a passing code test alone is not proof of the public experience.

After a change, rerun the local checks and then repeat the affected public steps. Update this record with the date, address, observed results, failures, and remaining unknowns before saying the change is done.
