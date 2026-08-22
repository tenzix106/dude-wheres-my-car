import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { app } from "../server.js";

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) {
  throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
}

const server = app.listen(0, "127.0.0.1");
await new Promise((resolve, reject) => {
  server.once("listening", resolve);
  server.once("error", reject);
});

const address = server.address();
const baseUrl = `http://127.0.0.1:${address.port}`;
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);
let lobbyId;

async function request(pathname, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    ...options,
    signal: AbortSignal.timeout(30_000),
  });
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();
  assert.equal(
    response.status,
    expectedStatus,
    `${options.method || "GET"} ${pathname}: ${JSON.stringify(body)}`,
  );
  return { response, body };
}

const json = (body, headers = {}) => ({
  method: "POST",
  headers: { "Content-Type": "application/json", ...headers },
  body: JSON.stringify(body),
});

const hostPost = (token, body) => json(body, { "X-Host-Token": token });
const showcasePost = (token, roundId, phase, carIndex, imageIndex = 0) =>
  hostPost(token, { roundId, phase, carIndex, imageIndex });

try {
  const appPage = await request("/");
  assert.match(appPage.body, /<style>[\s\S]*\.shell/);
  assert.match(appPage.body, /<script>const app =/);
  assert.doesNotMatch(appPage.body, /src="\/app\.js/);
  assert.doesNotMatch(appPage.body, /src="\/logo\.svg/);

  await request("/api/lobbies", json({ rounds: [] }), 400);

  const tooManyRounds = Array.from({ length: 9 }, (_, index) => ({
    title: `Round ${index + 1}`,
    cars: ["https://www.mudah.my/a", "https://www.carlist.my/b"],
    names: ["Car A", "Car B"],
  }));
  await request("/api/lobbies", json({ rounds: tooManyRounds }), 400);

  const tinyImage =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
  const rounds = [1, 2].map((number) => ({
    title: `Smoke Round ${number}`,
    cars: [
      `https://www.mudah.my/smoke-car-${number}-a`,
      `https://www.carlist.my/smoke-car-${number}-b`,
    ],
    names: [`Smoke Car ${number}A`, `Smoke Car ${number}B`],
    prices: ["RM 1", "RM 2"],
    images: number === 1 ? [[tinyImage], [tinyImage]] : [[], []],
    thumbnails: number === 1 ? [tinyImage, tinyImage] : [null, null],
  }));
  const created = await request(
    "/api/lobbies",
    json({ title: `Codex smoke test ${Date.now()}`, rounds }),
    201,
  );
  lobbyId = created.body.id;
  const hostToken = created.body.hostToken;
  assert.ok(lobbyId && hostToken);

  const initial = await request(`/api/lobbies/${lobbyId}`);
  assert.equal(initial.body.status, "lobby");
  assert.equal(initial.body.hostToken, undefined);
  assert.equal(initial.body.playerIds, undefined);
  assert.equal(initial.body.rounds.length, 2);
  assert.equal(initial.body.rounds[0].cars[0].images.length, 1);

  const sync = await request(`/api/lobbies/${lobbyId}?sync=1`);
  assert.equal(sync.body.rounds[0].cars[0].images, undefined);
  assert.equal(sync.body.rounds[0].cars[0].thumbnail, undefined);

  const qr = await request(`/api/lobbies/${lobbyId}/qr`);
  assert.match(qr.response.headers.get("content-type"), /image\/svg\+xml/);
  assert.equal(qr.response.headers.get("cache-control"), "no-store");
  assert.equal(
    qr.response.headers.get("x-join-url"),
    `${baseUrl}/lobby/${lobbyId}`,
  );
  assert.match(qr.body, /^<svg/);

  const hostPage = await request(
    `/lobby/${lobbyId}?host=${encodeURIComponent(hostToken)}`,
  );
  assert.doesNotMatch(hostPage.body, /globalThis\.__LOBBY_PLAYER_ID__="/);
  let state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.players, 0);

  const guestPage = await request(`/lobby/${lobbyId}`);
  const guestCookie = (guestPage.response.headers.get("set-cookie") || "")
    .split(";")[0];
  assert.match(guestCookie, /^dwmac_player=/);
  const navigationPlayerId = guestPage.body.match(
    /__LOBBY_PLAYER_ID__="([a-zA-Z0-9-]+)"/,
  )?.[1];
  assert.ok(navigationPlayerId);
  const repeatedGuestPage = await request(`/lobby/${lobbyId}`, {
    headers: { Cookie: guestCookie },
  });
  assert.match(
    repeatedGuestPage.body,
    new RegExp(`__LOBBY_PLAYER_ID__="${navigationPlayerId}"`),
  );
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const status = await request(
      `/api/lobbies/${lobbyId}/join-status?playerId=${navigationPlayerId}`,
    );
    if (status.body.joined) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const navigationJoin = await request(
    `/api/lobbies/${lobbyId}/join-status?playerId=${navigationPlayerId}`,
  );
  assert.equal(navigationJoin.body.joined, true);
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.players, 1);

  await request(`/api/lobbies/${lobbyId}/join`, json({}), 400);
  const joins = await Promise.all([
    request(`/api/lobbies/${lobbyId}/join`, json({ playerId: "smoke-player-a" })),
    request(`/api/lobbies/${lobbyId}/join`, json({ playerId: "smoke-player-b" })),
  ]);
  assert.ok(joins.every(({ body }) => body.players >= 1));
  const repeatedJoin = await request(
    `/api/lobbies/${lobbyId}/join`,
    json({ playerId: "smoke-player-a" }),
  );
  assert.equal(repeatedJoin.body.players, 3);
  const joinedStatus = await request(
    `/api/lobbies/${lobbyId}/join-status?playerId=smoke-player-a`,
  );
  assert.equal(joinedStatus.body.joined, true);
  const missingJoinStatus = await request(
    `/api/lobbies/${lobbyId}/join-status?playerId=not-joined`,
  );
  assert.equal(missingJoinStatus.body.joined, false);

  await request(`/api/lobbies/${lobbyId}/start`, json({}), 403);
  await request(
    `/api/lobbies/${lobbyId}/start`,
    hostPost("incorrect-token", {}),
    403,
  );
  await request(`/api/lobbies/${lobbyId}/start`, hostPost(hostToken, {}));

  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.status, "playing");
  assert.equal(state.currentRound, 0);
  assert.equal(state.rounds[0].phase, "showcase");
  assert.equal(state.players, 3);

  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "wrong-round", "showcase", 0),
    409,
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-1", "showcase", 1),
  );
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.rounds[0].showcase.carIndex, 1);
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-1", "showcase", 0),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-1", "showcase", 1),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-1", "voting", 1),
  );
  // Retrying an exact-state command must not advance anything twice.
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-1", "voting", 1),
  );

  await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote`,
    json({ carId: "r1-c1", voterId: "" }),
    400,
  );
  await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote`,
    json({ carId: "not-a-car", voterId: "smoke-voter-a" }),
    400,
  );
  await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote`,
    json({ carId: "r1-c1", voterId: "smoke-voter-a" }),
    201,
  );
  const voteStatus = await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote-status?voterId=smoke-voter-a`,
  );
  assert.deepEqual(voteStatus.body, { recorded: true, carId: "r1-c1" });
  await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote`,
    json({ carId: "r1-c2", voterId: "smoke-voter-a" }),
    409,
  );
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  // Voters are participants even if their separate mobile join request was
  // dropped, so the UI must never be able to render "1 of 0 players voted".
  assert.equal(state.players, 4);
  assert.equal(state.rounds[0].votes["r1-c1"], 1);
  assert.equal(state.rounds[0].voterCount, 1);

  await request(`/api/lobbies/${lobbyId}/next`, hostPost(hostToken, {}));
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.currentRound, 1);
  assert.equal(state.rounds[1].phase, "showcase");
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-2", "showcase", 1),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-2", "showcase", 0),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-2", "showcase", 1),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase`,
    showcasePost(hostToken, "round-2", "voting", 1),
  );
  await request(`/api/lobbies/${lobbyId}/next`, hostPost(hostToken, {}));
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.status, "complete");

  await request("/api/lobbies/does-not-exist", {}, 404);
  await request(
    "/api/lobbies/does-not-exist/join",
    json({ playerId: "not-a-player" }),
    404,
  );
  await request("/api/lobbies/does-not-exist/qr", {}, 404);
  console.log(`Smoke test passed for ${lobbyId}.`);
} finally {
  if (lobbyId) {
    const { error } = await supabase.from("lobbies").delete().eq("id", lobbyId);
    if (error) console.error("Could not remove smoke-test lobby:", error);
  }
  await new Promise((resolve) => server.close(resolve));
}
