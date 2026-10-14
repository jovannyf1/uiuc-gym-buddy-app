# Project brief for future chats

This GitHub repository is the source of truth for **UIUC Gym Buddy App**. The student's goal is for a UIUC student to find another student free to go to the gym at the same time, agree on an accessible time and place, and work out together. Success means actual meetups, not just profiles or downloads.

Keep the product focused on gym buddies. Do not add gym busyness tracking. Students can manually enter weekly free times, upload `.ics` exports from Google/Outlook/Apple Calendar, or upload a screenshot for AI interpretation. All imported times must be reviewed before becoming recurring availability. Matching uses shared free windows, gym activity and location preferences; invitations have a specific date and accept/decline/cancel actions.

Read `README.md` before changing the app. Node.js 24+ is required. Run `npm ci`, `npm --prefix client ci`, `npm test`, and `npm run build`. The API is in `server/`; the React UI is in `client/`. Do not commit `.env`, `data/`, uploaded schedules, screenshots, or API keys. Screenshot interpretation uses a server-side `OPENAI_API_KEY`; the browser never receives the key.

Current limits: `@illinois.edu` addresses are format-checked but not verified; data is stored in local SQLite; calendar imports are one-time previews, not live sync; the AI screenshot path has automated tests but needs a configured API key for a live call. Hosting, email verification, and a public-use privacy/moderation plan are needed before a real student launch.

When the student asks for changes in a new chat, work from this repository, run relevant checks, and put completed work back on GitHub. Avoid separate numbered local deliverables; give the GitHub link or commit/PR as the result.
