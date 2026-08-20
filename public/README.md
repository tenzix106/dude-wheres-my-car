# Dude, where's my car?

A shareable car-choice game with a host-controlled lobby. The host adds one or more rounds by pasting a Mudah.my or Carlist.my listing link for each car; guests scan a QR code, wait in the lobby, and vote when the game begins. Votes are stored by the included Node server, so every connected visitor sees the same tally.

## Run it

1. Install Node.js 20+.
2. In this folder, run `npm install`.
3. Run `npm start` and visit `http://localhost:3000`.

For phone voting on the same Wi-Fi, open the site using the computer's LAN address (for example, `http://192.168.x.x:3000`), rather than `localhost`, before showing the QR code. For a real public game, deploy it and set `PUBLIC_BASE_URL=https://your-domain.example` so QR codes always contain your public HTTPS address.

## Host a game

1. Visit the home page and name the game.
2. Paste the two full listing links for the first round. Use **Preview listing** to attempt an interactive embedded view.
3. Select **Add another round** to include another pair, then create the lobby.
4. Show the lobby QR code. A guest who scans it joins the lobby on their own phone.
5. Select **Start game**; vote totals update for everyone about every three seconds. The host can move to the next round or finish the game.

The app only accepts `mudah.my` and `carlist.my` links. It does not scrape, cache, or reproduce listing data: it loads the original URL in an iframe and always offers an **Open original listing** link. Either marketplace may block iframe embedding with browser security headers; that is expected, and cannot safely be bypassed by this app.

## Host controls

Creating a lobby generates a random host token and lands the host on `/lobby/<id>?host=<token>` — the server checks that exact token on every host-only action (start, next round, showcase navigation), so a guest who edits the URL to guess a value can no longer seize control. Keep that link private; sharing it hands over host controls. Use the **Copy lobby link** button in the lobby view to copy the plain, token-free join link for guests instead.

Photos are downscaled and re-encoded client-side (max 1600px wide, JPEG) before upload, which keeps `data/store.json` small and page loads fast even with a full 8-photo showcase per car.

## Before public launch

- Move votes from the JSON file to a database (for example PostgreSQL/Supabase) — `data/store.json` is rewritten in full on every vote, which won't scale to a large concurrent audience.
- Add rate limiting, moderation, and a privacy notice. Host authorization now uses a real per-lobby token rather than a guessable link, but nothing here is hardened against abuse at scale yet.
- Confirm the marketplaces' current terms and obtain permission before importing listing data, photographs, or brand assets.

> Note: lobbies created before this update don't have a host token stored in `data/store.json` and will reject host actions with a 403. Clear out old test lobbies from that file (or delete it — it's regenerated on first run) after upgrading.
