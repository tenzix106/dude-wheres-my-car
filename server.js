import express from "express";
import QRCode from "qrcode";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = process.env.PORT || 3000;

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
  const { data, error } = await supabase
    .from("lobbies")
    .select("state")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return data?.state || null;
}

async function createLobby(lobby) {
  const { error } = await supabase.from("lobbies").insert({
    id: lobby.id,
    state: lobby,
    created_at: lobby.createdAt,
  });
  if (error) throw error;
}

async function saveLobby(lobby) {
  const { data, error } = await supabase
    .from("lobbies")
    .update({ state: lobby, updated_at: new Date().toISOString() })
    .eq("id", lobby.id)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Lobby ${lobby.id} no longer exists.`);
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function publicUrl(req) {
  return (
    process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`
  ).replace(/\/$/, "");
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

app.use(express.json({ limit: "50mb" }));
app.use(express.static(path.join(root, "public")));

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

    await Promise.all(result.rounds.map(async (round) => {
      const { votes, voterCount } = await getRoundVotes(result.id, round.id);
      round.votes = Object.fromEntries(
        round.cars.map((car) => [car.id, votes[car.id] || 0]),
      );
      round.voterCount = voterCount;
    }));

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
  await saveLobby(lobby);
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
  await saveLobby(lobby);
  res.json(sanitizeLobby(lobby));
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
  await saveLobby(lobby);
  res.json(sanitizeLobby(lobby));
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

    const { votes } = await getRoundVotes(lobby.id, round.id);

    res.json({ votes });
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
  await saveLobby(lobby);
  res.json(round);
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
  await saveLobby(lobby);
  res.json(round);
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
  await saveLobby(lobby);
  res.json(round);
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
  await saveLobby(lobby);
  res.json(round);
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
  await saveLobby(lobby);
  res.json(round);
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
    res.type("image/svg+xml").send(svg);
  } catch (error) {
    next(error);
  }
});

app.get(["/lobby/:id", "/"], (_req, res) =>
  res.sendFile(path.join(root, "public", "index.html")),
);

app.use((error, req, res, _next) => {
  console.error(`${req.method} ${req.originalUrl} failed:`, error);
  if (res.headersSent) return;
  res.status(500).json({ error: "Could not update lobby." });
});

app.listen(port, "0.0.0.0", () =>
  console.log(`Dude, where's my car? is running at http://localhost:${port}`),
);
