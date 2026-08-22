import express from "express";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const indexTemplate = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
const clientScript = fs
  .readFileSync(path.join(root, "public", "app.js"), "utf8")
  .replace(/<\/script/gi, "<\\/script");
const clientStyles = fs.readFileSync(
  path.join(root, "public", "styles.css"),
  "utf8",
);
const logoDataUrl = `data:image/svg+xml;base64,${Buffer.from(
  fs.readFileSync(path.join(root, "public", "logo.svg"), "utf8"),
).toString("base64")}`;
const clientHtml = indexTemplate
  .replace('<link rel="stylesheet" href="/styles.css" />', `<style>${clientStyles}</style>`)
  .replaceAll('src="/logo.svg"', `src="${logoDataUrl}"`)
  .replace(
    /<script\s+src="\/app\.js"[\s\S]*?<\/script>/,
    `<script>${clientScript}</script>`,
  );
const app = express();
const port = process.env.PORT || 3000;
const lobbyCache = new Map();
const lobbyCacheTtlMs = 5 * 60 * 1000;

// Render terminates HTTPS at its proxy. Trust one proxy hop so req.protocol
// reflects X-Forwarded-Proto and QR codes contain the public HTTPS URL.
app.set("trust proxy", 1);

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  },
);

async function getLobby(id) {
  const cached = lobbyCache.get(id);
  if (cached && Date.now() - cached.loadedAt < lobbyCacheTtlMs) {
    const { data: version, error: versionError } = await supabase
      .from("lobbies")
      .select("updated_at")
      .eq("id", id)
      .maybeSingle();
    if (!versionError && !version) {
      lobbyCache.delete(id);
      return null;
    }
    if (!versionError && version.updated_at === cached.updatedAt)
      return cached.lobby;
  }

  const { data, error } = await supabase
    .from("lobbies")
    .select("state, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  const lobby = data?.state || null;
  if (lobby) {
    if (lobbyCache.size >= 100) lobbyCache.delete(lobbyCache.keys().next().value);
    lobbyCache.set(id, {
      lobby,
      loadedAt: Date.now(),
      updatedAt: data.updated_at,
    });
  }
  return lobby;
}

async function createLobby(lobby) {
  const { data, error } = await supabase
    .from("lobbies")
    .insert({
      id: lobby.id,
      state: lobby,
      created_at: lobby.createdAt,
    })
    .select("updated_at")
    .single();
  if (error) throw error;
  lobbyCache.set(lobby.id, {
    lobby,
    loadedAt: Date.now(),
    updatedAt: data.updated_at,
  });
}

async function patchLobby(lobby, patches) {
  const { error } = await supabase.rpc("patch_lobby_state", {
    p_lobby_id: lobby.id,
    p_patches: patches,
  });
  if (error) {
    if (error.code === "PGRST202") {
      error.status = 503;
      error.publicMessage =
        "Supabase migration patch_lobby_state has not been applied.";
    }
    throw error;
  }
  // Other Render requests may be handled by another process. Invalidating
  // forces this process to reload the authoritative state, while updated_at
  // validation makes other process-local caches notice the same write.
  lobbyCache.delete(lobby.id);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function publicUrl(req) {
  const configuredUrl = process.env.PUBLIC_BASE_URL?.trim();
  if (configuredUrl) {
    const url = new URL(configuredUrl);
    if (url.hostname.endsWith(".onrender.com")) url.protocol = "https:";
    return url.toString().replace(/\/$/, "");
  }

  const host = req.get("host");
  const protocol = host?.split(":")[0].endsWith(".onrender.com")
    ? "https"
    : req.protocol;
  return `${protocol}://${host}`.replace(/\/$/, "");
}
// Strip the host token before a lobby is sent to any client — it must only
// ever leave the server once, in the creation response.
function sanitizeLobby(lobby) {
  if (!lobby) return lobby;
  const { hostToken, playerIds, ...rest } = lobby;
  return rest;
}
// Host-only routes require the token issued at lobby creation, sent back as
// the `X-Host-Token` header. Replaces the old `?host=1` convention, which
// anyone could type in.
function requireHost(req, res, lobby) {
  const token = req.get("X-Host-Token") || "";
  if (!lobby || !lobby.hostToken || !token || token !== lobby.hostToken) {
    res.status(403).json({ error: "Host authorization required." });
    return false;
  }
  return true;
}
function sourceFor(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (hostname === "mudah.my" || hostname.endsWith(".mudah.my"))
      return "Mudah.my";
    if (hostname === "carlist.my" || hostname.endsWith(".carlist.my"))
      return "Carlist.my";
  } catch {
    /* handled by caller */
  }
  return null;
}
async function getRoundVotes(lobbyId, roundId) {
  const { data, error } = await supabase
    .from('votes')
    .select('car_id')
    .eq('lobby_id', lobbyId)
    .eq('round_id', roundId);

  if (error) {
    console.error('Failed to load votes:', error);
    throw error;
  }

  const votes = {};

  for (const vote of data) {
    votes[vote.car_id] = (votes[vote.car_id] || 0) + 1;
  }

  return {
    votes,
    voterCount: data.length,
  };
}

async function getLobbyPlayerCount(lobbyId) {
  const { data, error } = await supabase
    .from("lobbies")
    .select("players:state->players")
    .eq("id", lobbyId)
    .maybeSingle();

  if (error) {
    console.warn("Failed to refresh player count:", error);
    return null;
  }
  return Number(data?.players);
}

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(root, "public"), { index: false }));

app.post("/api/lobbies", asyncRoute(async (req, res) => {
  const requestedRounds = req.body?.rounds;
  if (!Array.isArray(requestedRounds) || !requestedRounds.length)
    return res.status(400).json({ error: "Add at least one round." });
  if (requestedRounds.length > 8)
    return res
      .status(400)
      .json({ error: "A lobby can have up to eight rounds." });
  const rounds = [];
  for (let index = 0; index < requestedRounds.length; index += 1) {
    const item = requestedRounds[index];
    if (!Array.isArray(item.cars) || item.cars.length !== 2)
      return res
        .status(400)
        .json({ error: `Round ${index + 1} needs two car links.` });
    const cars = item.cars.map((url, carIndex) => {
      const source = sourceFor(url);
      const images = Array.isArray(item.images?.[carIndex])
        ? item.images[carIndex]
        : [];
      if (
        images.length > 8 ||
        images.some(
          (image) =>
            typeof image !== "string" ||
            !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image) ||
            image.length > 7_000_000,
        )
      )
        return null;
      const thumbnail =
        typeof item.thumbnails?.[carIndex] === "string" &&
        images.includes(item.thumbnails[carIndex])
          ? item.thumbnails[carIndex]
          : null;
      const name = String(item.names?.[carIndex] || "")
        .trim()
        .slice(0, 80);
      const price = String(item.prices?.[carIndex] || "")
        .trim()
        .slice(0, 40);
      return (
        source &&
        name && {
          id: `r${index + 1}-c${carIndex + 1}`,
          source,
          sourceUrl: url,
          name,
          price,
          images,
          thumbnail,
        }
      );
    });
    if (cars.some((car) => !car))
      return res.status(400).json({
        error: `Round ${index + 1}: add a car name and use full links from mudah.my or carlist.my only.`,
      });
    rounds.push({
      id: `round-${index + 1}`,
      title: String(item.title || `Round ${index + 1}`).slice(0, 80),
      cars,
      phase: "showcase",
      showcase: {
        carIndex: 0,
        imageIndex: 0,
      },
    });
  }
  const id = `lobby-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const hostToken = crypto.randomBytes(20).toString("hex");
  const lobby = {
    id,
    title: String(req.body?.title || "Untitled car showdown").slice(0, 80),
    status: "lobby",
    rounds,
    currentRound: 0,
    players: 0,
    playerIds: [],
    createdAt: new Date().toISOString(),
    hostToken,
  };
  await createLobby(lobby);
  // Only this response ever includes the raw hostToken — the browser stores
  // it so it can be sent back on subsequent host-only requests.
  res.status(201).json(lobby);
}));

app.get('/api/lobbies/:id', async (req, res) => {
  try {
    const lobby = await getLobby(req.params.id);

    if (!lobby) {
      return res.status(404).json({
        error: 'Lobby not found',
      });
    }

    const result = sanitizeLobby(structuredClone(lobby));

    const [playerCount, ...roundVoteResults] = await Promise.all([
      getLobbyPlayerCount(result.id),
      ...result.rounds.map((round) => getRoundVotes(result.id, round.id)),
    ]);
    if (Number.isFinite(playerCount)) result.players = playerCount;
    result.rounds.forEach((round, index) => {
      const { votes, voterCount } = roundVoteResults[index];
      round.votes = Object.fromEntries(
        round.cars.map((car) => [car.id, votes[car.id] || 0]),
      );
      round.voterCount = voterCount;
    });

    if (req.query.sync === "1") {
      result.rounds.forEach((round) => {
        round.cars.forEach((car) => {
          delete car.images;
          delete car.thumbnail;
        });
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Failed to load lobby:', error);

    res.status(500).json({
      error: 'Could not load lobby.',
    });
  }
});

app.post("/api/lobbies/:id/join", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  const playerId = String(req.body?.playerId || "").trim();
  if (!playerId || playerId.length > 120)
    return res.status(400).json({ error: "A player ID is required." });
  if (!Array.isArray(lobby.playerIds))
    lobby.playerIds = Array.from(
      { length: Number(lobby.players) || 0 },
      (_, index) => `legacy-${index + 1}`,
    );
  if (!lobby.playerIds.includes(playerId)) lobby.playerIds.push(playerId);
  lobby.players = lobby.playerIds.length;
  await patchLobby(lobby, [
    { path: ["playerIds"], value: lobby.playerIds },
    { path: ["players"], value: lobby.players },
  ]);
  res.json({ players: lobby.players });
}));

app.post("/api/lobbies/:id/start", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  lobby.status = "playing";
  lobby.currentRound = 0;
  lobby.rounds[0].phase = "showcase";
  lobby.rounds[0].showcase = { carIndex: 0, imageIndex: 0 };
  await patchLobby(lobby, [
    { path: ["status"], value: lobby.status },
    { path: ["currentRound"], value: lobby.currentRound },
    { path: ["rounds", "0", "phase"], value: lobby.rounds[0].phase },
    { path: ["rounds", "0", "showcase"], value: lobby.rounds[0].showcase },
  ]);
  res.json({ ok: true });
}));

app.post("/api/lobbies/:id/next", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  if (lobby.currentRound < lobby.rounds.length - 1) {
    lobby.currentRound += 1;
    lobby.rounds[lobby.currentRound].phase = "showcase";
    lobby.rounds[lobby.currentRound].showcase = { carIndex: 0, imageIndex: 0 };
  } else lobby.status = "complete";
  const roundIndex = String(lobby.currentRound);
  const patches = [
    { path: ["status"], value: lobby.status },
    { path: ["currentRound"], value: lobby.currentRound },
  ];
  if (lobby.status === "playing") {
    patches.push(
      { path: ["rounds", roundIndex, "phase"], value: lobby.rounds[lobby.currentRound].phase },
      { path: ["rounds", roundIndex, "showcase"], value: lobby.rounds[lobby.currentRound].showcase },
    );
  }
  await patchLobby(lobby, patches);
  res.json({ ok: true });
}));

app.post("/api/lobbies/:id/rounds/:roundId/vote", async (req, res) => {
  try {
    const { carId, voterId } = req.body;

    if (typeof voterId !== "string" || !voterId.trim()) {
      return res.status(400).json({
        error: "Missing voter id",
      });
    }

    const lobby = await getLobby(req.params.id);

    if (!lobby) {
      return res.status(404).json({
        error: "Lobby not found",
      });
    }

    const round = lobby.rounds.find((item) => item.id === req.params.roundId);

    if (!round) {
      return res.status(404).json({
        error: "Round not found",
      });
    }

    if (round.phase !== "voting") {
      return res.status(409).json({
        error: "Voting has not started yet",
      });
    }

    if (!round.cars.some((car) => car.id === carId)) {
      return res.status(400).json({
        error: "Invalid car",
      });
    }

    const { error } = await supabase.from("votes").insert({
      lobby_id: lobby.id,
      round_id: round.id,
      car_id: carId,
      voter_id: voterId.trim(),
    });

    if (error) {
      // PostgreSQL unique constraint means this voter already voted.
      if (error.code === "23505") {
        return res.status(409).json({
          error: "You have already voted in this round.",
        });
      }

      console.error("Failed to record vote:", error);

      return res.status(500).json({
        error: "Could not record your vote.",
      });
    }

    // The insert is the source of truth. Return immediately instead of making
    // mobile clients wait for another Supabase round-trip to recount votes.
    res.status(201).json({ ok: true });
  } catch (error) {
    console.error("Vote error:", error);

    res.status(500).json({
      error: "Could not record your vote.",
    });
  }
});

function currentShowcase(lobby) {
  const round = lobby?.rounds[lobby.currentRound];
  if (round) {
    round.phase ??= "showcase";
    round.showcase ??= { carIndex: 0, imageIndex: 0 };
    round.cars.forEach((car) => {
      car.images ??= [];
    });
  }
  return round;
}
app.post("/api/lobbies/:id/showcase/image", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  const round = currentShowcase(lobby);
  if (!round || round.phase !== "showcase")
    return res.status(409).json({ error: "Showcase is not active" });
  const images = round.cars[round.showcase.carIndex].images || [];
  if (round.showcase.imageIndex < images.length - 1)
    round.showcase.imageIndex += 1;
  await patchLobby(lobby, [{
    path: ["rounds", String(lobby.currentRound), "showcase"],
    value: round.showcase,
  }]);
  res.json({ ok: true });
}));
app.post("/api/lobbies/:id/showcase/back", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  const round = currentShowcase(lobby);
  if (!round || round.phase !== "showcase")
    return res.status(409).json({ error: "Showcase is not active" });
  if (round.showcase.imageIndex > 0) round.showcase.imageIndex -= 1;
  else if (round.showcase.carIndex > 0) {
    round.showcase.carIndex -= 1;
    round.showcase.imageIndex = Math.max(
      (round.cars[round.showcase.carIndex].images || []).length - 1,
      0,
    );
  }
  await patchLobby(lobby, [{
    path: ["rounds", String(lobby.currentRound), "showcase"],
    value: round.showcase,
  }]);
  res.json({ ok: true });
}));
app.post("/api/lobbies/:id/showcase/car", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  const round = currentShowcase(lobby);
  if (!round || round.phase !== "showcase")
    return res.status(409).json({ error: "Showcase is not active" });
  if (round.showcase.carIndex < round.cars.length - 1) {
    round.showcase.carIndex += 1;
    round.showcase.imageIndex = 0;
  } else round.phase = "voting";
  await patchLobby(lobby, [
    {
      path: ["rounds", String(lobby.currentRound), "showcase"],
      value: round.showcase,
    },
    {
      path: ["rounds", String(lobby.currentRound), "phase"],
      value: round.phase,
    },
  ]);
  res.json({ ok: true });
}));

app.post("/api/lobbies/:id/showcase/car/previous", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  const round = currentShowcase(lobby);
  if (!round || round.phase !== "showcase")
    return res.status(409).json({ error: "Showcase is not active" });
  if (round.showcase.carIndex > 0) {
    round.showcase.carIndex -= 1;
    round.showcase.imageIndex = 0;
  }
  await patchLobby(lobby, [{
    path: ["rounds", String(lobby.currentRound), "showcase"],
    value: round.showcase,
  }]);
  res.json({ ok: true });
}));

app.post("/api/lobbies/:id/showcase/car/next", asyncRoute(async (req, res) => {
  const lobby = await getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: "Lobby not found" });
  if (!requireHost(req, res, lobby)) return;
  const round = currentShowcase(lobby);
  if (!round || round.phase !== "showcase")
    return res.status(409).json({ error: "Showcase is not active" });
  if (round.showcase.carIndex < round.cars.length - 1) {
    round.showcase.carIndex += 1;
    round.showcase.imageIndex = 0;
  }
  await patchLobby(lobby, [{
    path: ["rounds", String(lobby.currentRound), "showcase"],
    value: round.showcase,
  }]);
  res.json({ ok: true });
}));

app.get("/api/lobbies/:id/qr", async (req, res, next) => {
  try {
    if (!(await getLobby(req.params.id))) return res.status(404).end();
    const joinUrl = `${publicUrl(req)}/lobby/${encodeURIComponent(req.params.id)}`;
    const svg = await QRCode.toString(joinUrl, {
      type: "svg",
      margin: 1,
      width: 360,
      errorCorrectionLevel: "M",
    });
    res.set("Cache-Control", "no-store");
    res.set("X-Join-URL", joinUrl);
    res.type("image/svg+xml").send(svg);
  } catch (error) {
    next(error);
  }
});

app.get(["/lobby/:id", "/"], (_req, res) =>
  res
    .set("Cache-Control", "no-store")
    .type("html")
    .send(clientHtml),
);

app.use((error, req, res, _next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, error);
  if (res.headersSent) return;
  res
    .status(error.status || 500)
    .json({ error: error.publicMessage || "Could not update lobby." });
});

export { app };

if (path.resolve(process.argv[1] || "") === fileURLToPath(import.meta.url)) {
  app.listen(port, "0.0.0.0", () =>
    console.log(`Dude, where's my car? is running at http://localhost:${port}`),
  );
}
