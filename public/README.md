# Dude, where's my car?

A shareable car-choice game with a host-controlled lobby. The host adds one or more rounds by pasting a Mudah.my or Carlist.my listing link for each car; guests scan a QR code, wait in the lobby, and vote when the game begins. Votes are stored by the included Node server, so every connected visitor sees the same tally.

## Run it

1. Install Node.js 20+.
2. In this folder, run `npm install`.
3. Run `npm start` and visit `http://localhost:3000`.

For phone voting on the same Wi-Fi, open the site using the computer's LAN address (for example, `http://192.168.x.x:3000`), rather than `localhost`, before showing the QR code. For a real public game, deploy it and set `PUBLIC_BASE_URL=https://your-domain.example` so QR codes always contain your public HTTPS address.

When hosted on Render, set `PUBLIC_BASE_URL=https://dude-wheres-my-car.onrender.com`. The server also trusts Render's HTTPS proxy headers, so generated QR links use HTTPS even when this variable is omitted.

## Host a game

1. Visit the home page and name the game.
2. Paste the two full listing links for the first round. Use **Preview listing** to attempt an interactive embedded view.
3. Select **Add another round** to include another pair, then create the lobby.
4. Show the lobby QR code. A guest who scans it joins the lobby on their own phone.
5. Select **Start game**; vote totals update for everyone about every three seconds. The host can move to the next round or finish the game.

The app only accepts `mudah.my` and `carlist.my` links. It does not scrape, cache, or reproduce listing data: it loads the original URL in an iframe and always offers an **Open original listing** link. Either marketplace may block iframe embedding with browser security headers; that is expected, and cannot safely be bypassed by this app.

## Host controls

Creating a lobby generates a random host token and lands the host on `/lobby/<id>?host=<token>` — the server checks that exact token on every host-only action (start, next round, showcase navigation), so a guest who edits the URL to guess a value can no longer seize control. Keep that link private; sharing it hands over host controls. Use the **Copy lobby link** button in the lobby view to copy the plain, token-free join link for guests instead.

Photos are downscaled and re-encoded client-side (max 1600px wide, JPEG) before upload, which keeps the Supabase lobby payload manageable and page loads fast even with a full 8-photo showcase per car.

## Supabase setup

Apply `supabase/migrations/20260822000000_create_lobbies.sql` to the Supabase project, then configure `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. The secret key must only be available to the Node server; never expose it in client-side code.

Also apply `supabase/migrations/20260822010000_patch_lobby_state.sql`. It lets host controls and guest joins update only the changed lobby fields instead of uploading the complete image-heavy lobby document on every action.

To import lobbies from an existing `data/store.json`, run `npm run migrate:store` once after applying the migration. The running application no longer reads or writes that file.

Run `npm run test:smoke` to exercise lobby creation, joining, host authorization, showcase navigation, voting, round progression, completion, and cleanup against the configured Supabase project.

## Before public launch

- Add rate limiting, moderation, and a privacy notice. Host authorization now uses a real per-lobby token rather than a guessable link, but nothing here is hardened against abuse at scale yet.
- Confirm the marketplaces' current terms and obtain permission before importing listing data, photographs, or brand assets.

> Note: migrated lobbies created before host tokens were introduced will still reject host actions with a 403. Create a new lobby instead.
