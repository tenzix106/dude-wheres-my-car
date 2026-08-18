import express from 'express';
import QRCode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'store.json');
const app = express();
const port = process.env.PORT || 3000;

const seed = {
  lobbies: [],
  rounds: [{
    id: 'weekend-escape', title: 'The weekend escape',
    question: 'You have the keys for a spontaneous road trip. Which one do you take?',
    cars: [
      { id: 'mx5', name: 'Mazda MX-5 RF', year: 2020, price: 'RM 154,000', detail: '2.0L · Auto · 28,000 km', source: 'Mudah.my', sourceUrl: 'https://www.mudah.my/' },
      { id: 'gr86', name: 'Toyota GR86', year: 2023, price: 'RM 308,000', detail: '2.4L · Manual · 9,500 km', source: 'Carlist.my', sourceUrl: 'https://www.carlist.my/' }
    ],
    votes: { mx5: 18, gr86: 24 }
  }]
};

function readStore() {
  if (!fs.existsSync(dataFile)) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dataFile, JSON.stringify(seed, null, 2));
  }
  const store = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  store.lobbies ??= [];
  store.rounds ??= [];
  return store;
}
function writeStore(store) { fs.writeFileSync(dataFile, JSON.stringify(store, null, 2)); }
function getRound(id) { return readStore().rounds.find((round) => round.id === id); }
function publicUrl(req) {
  return (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
}
function sourceFor(url) {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    if (hostname === 'mudah.my' || hostname.endsWith('.mudah.my')) return 'Mudah.my';
    if (hostname === 'carlist.my' || hostname.endsWith('.carlist.my')) return 'Carlist.my';
  } catch { /* handled by caller */ }
  return null;
}
function getLobby(id) { return readStore().lobbies.find((lobby) => lobby.id === id); }

app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(root, 'public')));

app.post('/api/lobbies', (req, res) => {
  const requestedRounds = req.body?.rounds;
  if (!Array.isArray(requestedRounds) || !requestedRounds.length) return res.status(400).json({ error: 'Add at least one round.' });
  if (requestedRounds.length > 8) return res.status(400).json({ error: 'A lobby can have up to eight rounds.' });
  const rounds = [];
  for (let index = 0; index < requestedRounds.length; index += 1) {
    const item = requestedRounds[index];
    if (!Array.isArray(item.cars) || item.cars.length !== 2) return res.status(400).json({ error: `Round ${index + 1} needs two car links.` });
    const cars = item.cars.map((url, carIndex) => {
      const source = sourceFor(url);
      const images = Array.isArray(item.images?.[carIndex]) ? item.images[carIndex] : [];
      if (images.length > 8 || images.some((image) => typeof image !== 'string' || !/^data:image\/(jpeg|png|webp|gif);base64,/.test(image) || image.length > 7_000_000)) return null;
      const thumbnail = typeof item.thumbnails?.[carIndex] === 'string' && images.includes(item.thumbnails[carIndex]) ? item.thumbnails[carIndex] : null;
      const name = String(item.names?.[carIndex] || '').trim().slice(0, 80);
      const price = String(item.prices?.[carIndex] || '').trim().slice(0, 40);
      return source && name && { id: `r${index + 1}-c${carIndex + 1}`, source, sourceUrl: url, name, price, images, thumbnail };
    });
    if (cars.some((car) => !car)) return res.status(400).json({ error: `Round ${index + 1}: add a car name and use full links from mudah.my or carlist.my only.` });
    rounds.push({ id: `round-${index + 1}`, title: String(item.title || `Round ${index + 1}`).slice(0, 80), cars, votes: Object.fromEntries(cars.map((car) => [car.id, 0])), phase: 'showcase', showcase: { carIndex: 0, imageIndex: 0 } });
  }
  const store = readStore();
  const id = `lobby-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const lobby = { id, title: String(req.body?.title || 'Untitled car showdown').slice(0, 80), status: 'lobby', rounds, currentRound: 0, players: 0, createdAt: new Date().toISOString() };
  store.lobbies.push(lobby); writeStore(store);
  res.status(201).json(lobby);
});

app.get('/api/lobbies/:id', (req, res) => {
  const lobby = getLobby(req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  res.json(lobby);
});

app.post('/api/lobbies/:id/join', (req, res) => {
  const store = readStore();
  const lobby = store.lobbies.find((item) => item.id === req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  lobby.players += 1; writeStore(store);
  res.json({ players: lobby.players });
});

app.post('/api/lobbies/:id/start', (req, res) => {
  const store = readStore();
  const lobby = store.lobbies.find((item) => item.id === req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  lobby.status = 'playing'; lobby.currentRound = 0; lobby.rounds[0].phase = 'showcase'; lobby.rounds[0].showcase = { carIndex: 0, imageIndex: 0 }; writeStore(store);
  res.json(lobby);
});

app.post('/api/lobbies/:id/next', (req, res) => {
  const store = readStore();
  const lobby = store.lobbies.find((item) => item.id === req.params.id);
  if (!lobby) return res.status(404).json({ error: 'Lobby not found' });
  if (lobby.currentRound < lobby.rounds.length - 1) { lobby.currentRound += 1; lobby.rounds[lobby.currentRound].phase = 'showcase'; lobby.rounds[lobby.currentRound].showcase = { carIndex: 0, imageIndex: 0 }; }
  else lobby.status = 'complete';
  writeStore(store); res.json(lobby);
});

app.post('/api/lobbies/:id/rounds/:roundId/vote', (req, res) => {
  const { carId } = req.body;
  const store = readStore();
  const lobby = store.lobbies.find((item) => item.id === req.params.id);
  const round = lobby?.rounds.find((item) => item.id === req.params.roundId);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (round.phase !== 'voting') return res.status(409).json({ error: 'Voting has not started yet' });
  if (!round.cars.some((car) => car.id === carId)) return res.status(400).json({ error: 'Invalid car' });
  round.votes[carId] += 1; writeStore(store); res.json({ votes: round.votes });
});

function currentShowcase(lobby) {
  const round = lobby?.rounds[lobby.currentRound];
  if (round) {
    round.phase ??= 'showcase';
    round.showcase ??= { carIndex: 0, imageIndex: 0 };
    round.cars.forEach((car) => { car.images ??= []; });
  }
  return round;
}
app.post('/api/lobbies/:id/showcase/image', (req, res) => {
  const store = readStore(); const lobby = store.lobbies.find((item) => item.id === req.params.id); const round = currentShowcase(lobby);
  if (!round || round.phase !== 'showcase') return res.status(409).json({ error: 'Showcase is not active' });
  const images = round.cars[round.showcase.carIndex].images || [];
  if (round.showcase.imageIndex < images.length - 1) round.showcase.imageIndex += 1;
  writeStore(store); res.json(round);
});
app.post('/api/lobbies/:id/showcase/back', (req, res) => {
  const store = readStore(); const lobby = store.lobbies.find((item) => item.id === req.params.id); const round = currentShowcase(lobby);
  if (!round || round.phase !== 'showcase') return res.status(409).json({ error: 'Showcase is not active' });
  if (round.showcase.imageIndex > 0) round.showcase.imageIndex -= 1;
  else if (round.showcase.carIndex > 0) { round.showcase.carIndex -= 1; round.showcase.imageIndex = Math.max((round.cars[round.showcase.carIndex].images || []).length - 1, 0); }
  writeStore(store); res.json(round);
});
app.post('/api/lobbies/:id/showcase/car', (req, res) => {
  const store = readStore(); const lobby = store.lobbies.find((item) => item.id === req.params.id); const round = currentShowcase(lobby);
  if (!round || round.phase !== 'showcase') return res.status(409).json({ error: 'Showcase is not active' });
  if (round.showcase.carIndex < round.cars.length - 1) { round.showcase.carIndex += 1; round.showcase.imageIndex = 0; }
  else round.phase = 'voting';
  writeStore(store); res.json(round);
});

app.get('/api/lobbies/:id/qr', async (req, res, next) => {
  if (!getLobby(req.params.id)) return res.status(404).end();
  try {
    const joinUrl = `${publicUrl(req)}/lobby/${encodeURIComponent(req.params.id)}`;
    const svg = await QRCode.toString(joinUrl, { type: 'svg', margin: 1, width: 360, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').send(svg);
  } catch (error) { next(error); }
});

app.get('/api/rounds/:id', (req, res) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  res.json(round);
});

app.post('/api/rounds/:id/vote', (req, res) => {
  const { carId } = req.body;
  const store = readStore();
  const round = store.rounds.find((item) => item.id === req.params.id);
  if (!round) return res.status(404).json({ error: 'Round not found' });
  if (!round.cars.some((car) => car.id === carId)) return res.status(400).json({ error: 'Invalid car' });
  round.votes[carId] = (round.votes[carId] || 0) + 1;
  writeStore(store);
  res.json({ votes: round.votes });
});

app.get('/api/rounds/:id/qr', async (req, res, next) => {
  const round = getRound(req.params.id);
  if (!round) return res.status(404).end();
  try {
    const voteUrl = `${publicUrl(req)}/vote?round=${encodeURIComponent(round.id)}`;
    const svg = await QRCode.toString(voteUrl, { type: 'svg', margin: 1, width: 280, errorCorrectionLevel: 'M' });
    res.type('image/svg+xml').send(svg);
  } catch (error) { next(error); }
});

app.get(['/vote', '/lobby/:id', '/'], (_req, res) => res.sendFile(path.join(root, 'public', 'index.html')));
app.listen(port, '0.0.0.0', () => console.log(`Dude, where's my car? is running at http://localhost:${port}`));
