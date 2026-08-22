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

try {
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
  assert.equal(repeatedJoin.body.players, 2);

  await request(`/api/lobbies/${lobbyId}/start`, json({}), 403);
  await request(
    `/api/lobbies/${lobbyId}/start`,
    hostPost("incorrect-token", {}),
    403,
  );
  await request(`/api/lobbies/${lobbyId}/start`, hostPost(hostToken, {}));

  let state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.status, "playing");
  assert.equal(state.currentRound, 0);
  assert.equal(state.rounds[0].phase, "showcase");
  assert.equal(state.players, 2);

  await request(
    `/api/lobbies/${lobbyId}/showcase/image`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/car/next`,
    hostPost(hostToken, {}),
  );
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.rounds[0].showcase.carIndex, 1);
  await request(
    `/api/lobbies/${lobbyId}/showcase/car/previous`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/car`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/car`,
    hostPost(hostToken, {}),
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
  await request(
    `/api/lobbies/${lobbyId}/rounds/round-1/vote`,
    json({ carId: "r1-c2", voterId: "smoke-voter-a" }),
    409,
  );
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.rounds[0].votes["r1-c1"], 1);
  assert.equal(state.rounds[0].voterCount, 1);

  await request(`/api/lobbies/${lobbyId}/next`, hostPost(hostToken, {}));
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.currentRound, 1);
  assert.equal(state.rounds[1].phase, "showcase");
  await request(
    `/api/lobbies/${lobbyId}/showcase/car/next`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/back`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/car`,
    hostPost(hostToken, {}),
  );
  await request(
    `/api/lobbies/${lobbyId}/showcase/car`,
    hostPost(hostToken, {}),
  );
  await request(`/api/lobbies/${lobbyId}/next`, hostPost(hostToken, {}));
  state = (await request(`/api/lobbies/${lobbyId}`)).body;
  assert.equal(state.status, "complete");

  await request("/api/lobbies/does-not-exist", {}, 404);
  await request("/api/lobbies/does-not-exist/qr", {}, 404);
  console.log(`Smoke test passed for ${lobbyId}.`);
} finally {
  if (lobbyId) {
    const { error } = await supabase.from("lobbies").delete().eq("id", lobbyId);
    if (error) console.error("Could not remove smoke-test lobby:", error);
  }
  await new Promise((resolve) => server.close(resolve));
}
