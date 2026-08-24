const app = document.querySelector("#app");
const lobbyId = location.pathname.match(/^\/lobby\/([^/]+)/)?.[1];
// The `host` query param now carries the real per-lobby token issued at
// creation, not a guessable "1" — the server rejects host actions unless
// this exact token is sent back on each request.
const hostToken = new URLSearchParams(location.search).get("host") || "";
const isHost = Boolean(hostToken);
let lobby;
let hasRenderedLobby = false;

function showLoading(message = "Loading lobby") {
  app.innerHTML = `<section class="loading-state" role="status" aria-live="polite"><span class="loading-spinner" aria-hidden="true"></span><p>${message}<span class="loading-dots" aria-hidden="true">...</span></p></section>`;
}

const themeToggle = document.querySelector("#theme-toggle");
function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle?.setAttribute("aria-pressed", String(isDark));
  if (themeToggle)
    themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}
let prefersDarkTheme = false;
try {
  prefersDarkTheme = localStorage.getItem("theme") === "dark";
} catch {
  // Storage may be unavailable inside an embedded QR scanner browser.
}
applyTheme(prefersDarkTheme);
themeToggle?.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme !== "dark";
  applyTheme(isDark);
  try {
    localStorage.setItem("theme", isDark ? "dark" : "light");
  } catch {
    // The theme still applies for the current page.
  }
});

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>'"]/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        c
      ],
  );
const marketplace = (url) => {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return (
      host === "mudah.my" ||
      host.endsWith(".mudah.my") ||
      host === "carlist.my" ||
      host.endsWith(".carlist.my")
    );
  } catch {
    return false;
  }
};
const fallbackVotedRounds = new Set();
const listingAddress = (url) => {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}${parsed.search}`.slice(
      0,
      88,
    );
  } catch {
    return url;
  }
};
let fallbackVoterId = "";
function getVoterId() {
  const navigationPlayerId = String(
    globalThis.__LOBBY_PLAYER_ID__ || "",
  ).trim();
  if (navigationPlayerId) {
    fallbackVoterId = navigationPlayerId;
    try {
      localStorage.setItem("voterId", navigationPlayerId);
    } catch {
      // The server-provided identity remains stable for this page.
    }
    return navigationPlayerId;
  }

  let id = "";
  try {
    id = localStorage.getItem("voterId") || "";
  } catch {
    // QR scanner webviews can disable persistent browser storage.
  }

  if (!id) {
    id = fallbackVoterId ||
      (globalThis.crypto?.randomUUID
        ? globalThis.crypto.randomUUID()
        : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    fallbackVoterId = id;
    try {
      localStorage.setItem("voterId", id);
    } catch {
      // Keep the stable in-memory fallback for this page session.
    }
  }

  return id;
}

function hasVotedInRound(roundId) {
  if (fallbackVotedRounds.has(roundId)) return true;
  try {
    return localStorage.getItem(`voted:${lobbyId}:${roundId}`) === "yes";
  } catch {
    return false;
  }
}

function markRoundVoted(roundId) {
  fallbackVotedRounds.add(roundId);
  try {
    localStorage.setItem(`voted:${lobbyId}:${roundId}`, "yes");
  } catch {
    // The database uniqueness constraint remains the source of truth.
  }
}
const lightbox = document.querySelector("#lightbox");
const lightboxImg = document.querySelector("#lightbox-img");
const lightboxCaption = document.querySelector("#lightbox-caption");
const lightboxPrevBtn = document.querySelector("#lightbox-prev");
const lightboxNextBtn = document.querySelector("#lightbox-next");
const lightboxCarPrevBtn = document.querySelector("#lightbox-car-prev");
const lightboxCarNextBtn = document.querySelector("#lightbox-car-next");
let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTitle = "";
let lightboxShowcase = false;
function renderLightbox() {
  lightboxImg.src = lightboxImages[lightboxIndex];
  const isLastImage = lightboxIndex === lightboxImages.length - 1;
  lightboxCaption.textContent = isLastImage ? lightboxTitle : "";
  lightboxCaption.hidden = !isLastImage || !lightboxTitle;
  lightboxImg.alt = lightboxTitle
    ? `${lightboxTitle}, photo ${lightboxIndex + 1} of ${lightboxImages.length}`
    : `Photo ${lightboxIndex + 1} of ${lightboxImages.length}`;
  lightboxPrevBtn.disabled = lightboxIndex === 0;
  lightboxNextBtn.disabled = lightboxIndex === lightboxImages.length - 1;
  const state = lobby?.rounds[lobby.currentRound]?.showcase;
  lightboxCarPrevBtn.hidden = !lightboxShowcase;
  lightboxCarNextBtn.hidden = !lightboxShowcase;
  if (lightboxShowcase && state) {
    lightboxCarPrevBtn.disabled = state.carIndex === 0;
    lightboxCarNextBtn.disabled =
      state.carIndex === lobby.rounds[lobby.currentRound].cars.length - 1;
  }
}
function openLightbox(images, startIndex, title, showcase = false) {
  if (!images.length) return;
  lightboxImages = images;
  lightboxIndex = Math.max(0, Math.min(startIndex, images.length - 1));
  lightboxTitle = title || "";
  lightboxShowcase = showcase;
  renderLightbox();
  lightbox.hidden = false;
  lightbox.requestFullscreen?.().catch(() => {});
}
function syncLightboxToShowcase() {
  if (!lightboxShowcase) return;
  const round = lobby?.rounds[lobby.currentRound];
  if (!round || round.phase === "voting") {
    closeLightbox();
    return;
  }
  const state = round?.showcase;
  const car = state && round.cars[state.carIndex];
  if (!car) return;
  const images = car.images?.length
    ? car.images
    : car.thumbnail
      ? [car.thumbnail]
      : [];
  if (!images.length) return;
  lightboxImages = images;
  lightboxIndex = Math.min(state.imageIndex, images.length - 1);
  lightboxTitle = car.name || car.source;
  renderLightbox();
}
function closeLightbox() {
  if (document.fullscreenElement === lightbox) document.exitFullscreen?.();
  lightbox.hidden = true;
}
lightboxPrevBtn.addEventListener("click", () => {
  if (lightboxIndex > 0) {
    if (lightboxShowcase) {
      setShowcaseState({ imageIndex: lightboxIndex - 1 });
      return;
    }
    lightboxIndex -= 1;
    renderLightbox();
  }
});
lightboxNextBtn.addEventListener("click", () => {
  if (lightboxIndex < lightboxImages.length - 1) {
    if (lightboxShowcase) {
      setShowcaseState({ imageIndex: lightboxIndex + 1 });
      return;
    }
    lightboxIndex += 1;
    renderLightbox();
  }
});
lightboxCarPrevBtn.addEventListener("click", () => {
  if (lightboxShowcase && !lightboxCarPrevBtn.disabled)
    setShowcaseState({
      carIndex: lobby.rounds[lobby.currentRound].showcase.carIndex - 1,
      imageIndex: 0,
    });
});
lightboxCarNextBtn.addEventListener("click", () => {
  if (lightboxShowcase && !lightboxCarNextBtn.disabled)
    setShowcaseState({
      carIndex: lobby.rounds[lobby.currentRound].showcase.carIndex + 1,
      imageIndex: 0,
    });
});
document
  .querySelector("#lightbox-close")
  .addEventListener("click", closeLightbox);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement) lightbox.hidden = true;
});
document.addEventListener("keydown", (event) => {
  if (lightbox.hidden) return;
  if (event.key === "ArrowLeft") lightboxPrevBtn.click();
  else if (event.key === "ArrowRight") lightboxNextBtn.click();
  else if (event.key === "Escape") closeLightbox();
});
const carFields = () =>
  `<div class="car-link"><label>Car name <input class="car-name" required maxlength="80" placeholder="e.g. 2020 Mazda MX-5" /></label><label>Price <input class="car-price" maxlength="40" placeholder="Optional · e.g. RM 154,000" /></label><label>Listing link <input required type="url" placeholder="https://www.mudah.my/... or carlist.my/..." /></label><div class="preview-slot preview-empty">Add a supported listing link to preview it.</div><label class="image-picker">Showcase photos <input class="image-input" type="file" accept="image/*" multiple /></label><div class="paste-zone" tabindex="0" role="button">Click here, then paste an image</div><p class="image-help">Select or paste up to 8 images, then arrange them below.</p><div class="image-order" aria-live="polite"></div></div>`;
const roundFields = (number) =>
  `<fieldset class="round-fields"><legend>ROUND ${number}</legend><button type="button" class="remove-round secondary">Remove round</button><label>Round name <input class="round-name" maxlength="80" placeholder="Optional · defaults to Round ${number}" /></label><div class="link-grid">${carFields()}${carFields()}</div></fieldset>`;

function setupPage() {
  document.title = "Create a game — Dude, where’s my car?";
  app.innerHTML = `<section class="intro setup-intro"><p class="eyebrow">Host a very serious game</p><h1>Build your<br><em>car showdown.</em></h1><p>Add two cars and their showcase images, invite the room with a QR code, then start when everyone is in.</p></section><form id="creator" class="creator"><label class="game-name">Game name <input id="game-name" required maxlength="80" value="Tonight’s car showdown" /></label><div id="rounds">${roundFields(1)}</div><div class="form-actions"><button type="button" id="add-round" class="secondary">+ Add another round</button><button type="submit" class="primary">Create lobby →</button></div><p id="form-message" class="small"></p></form>`;
  document.querySelector("#add-round").addEventListener("click", () => {
    const rounds = document.querySelector("#rounds");
    if (rounds.children.length >= 8) return;
    rounds.insertAdjacentHTML(
      "beforeend",
      roundFields(rounds.children.length + 1),
    );
    bindImagePickers();
    bindPreviews();
    bindRoundControls();
  });
  bindImagePickers();
  bindPreviews();
  bindRoundControls();
  document.querySelector("#creator").addEventListener("submit", createLobby);
}
function bindRoundControls() {
  document.querySelectorAll(".remove-round").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "yes";
    button.addEventListener("click", () => {
      const rounds = document.querySelector("#rounds");
      if (rounds.children.length === 1) return;
      button.closest(".round-fields").remove();
      [...rounds.children].forEach((round, index) => {
        round.querySelector("legend").textContent = `ROUND ${index + 1}`;
      });
      refreshRoundControls();
    });
  });
  refreshRoundControls();
}
function refreshRoundControls() {
  const rounds = document.querySelectorAll(".round-fields");
  const atMinimum = rounds.length <= 1;
  rounds.forEach((round) => {
    const button = round.querySelector(".remove-round");
    button.disabled = atMinimum;
    button.title = atMinimum
      ? "A game needs at least one round"
      : "Remove this round";
  });
}
function bindPreviews() {
  document.querySelectorAll(".preview-link").forEach((button) => {
    if (button.dataset.bound) return;
    button.dataset.bound = "yes";
    button.addEventListener("click", () => {
      const container = button.closest(".car-link");
      const url = container.querySelector('input[type="url"]').value.trim();
      const preview = container.querySelector(".preview-slot");
      if (!marketplace(url)) {
        preview.className = "preview-slot preview-empty";
        preview.textContent = "Please use a full mudah.my or carlist.my link.";
        return;
      }
      const source = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
      preview.className = "preview-slot listing-preview";
      preview.innerHTML = `<div class="listing-preview-head"><b></b><span>EXTERNAL LISTING</span></div><p class="listing-address"></p><p class="listing-preview-note">This marketplace keeps its listing on its own site. Open it to see photos and full details.</p><a target="_blank" rel="noopener">Open listing in a new tab ↗</a>`;
      preview.querySelector("b").textContent =
        `${source[0].toUpperCase()}${source.slice(1)} listing`;
      preview.querySelector(".listing-address").textContent = listingAddress(url);
      preview.querySelector("a").href = url;
    });
  });
}
function bindImagePickers() {
  document.querySelectorAll(".image-input").forEach((input) => {
    if (input.dataset.bound) return;
    input.dataset.bound = "yes";
    const container = input.closest(".car-link");
    container.images = [];
    container.thumbnail = null;
    input.addEventListener("change", async () => {
      await addImages(container, [...input.files]);
      input.value = "";
    });
    container
      .querySelector(".paste-zone")
      .addEventListener("paste", async (event) => {
        const files = [...event.clipboardData.items]
          .filter((item) => item.type.startsWith("image/"))
          .map((item) => item.getAsFile())
          .filter(Boolean);
        if (!files.length) return;
        event.preventDefault();
        await addImages(container, files);
      });
  });
}
function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
// Downscale to a max width and re-encode as JPEG before it ever touches
// localStorage or the server — phone photos routinely arrive at 3-5MB, and
// this typically cuts that by 80-90% with no visible loss at showcase size.
async function compressImage(file, maxWidth = 1600, quality = 0.82) {
  const original = await readAsDataUrl(file);
  try {
    const img = await loadImageElement(original);
    const scale = Math.min(1, maxWidth / img.naturalWidth);
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return original; // fall back to the untouched original if this browser can't decode it
  }
}
async function addImages(container, files) {
  const remaining = 8 - container.images.length;
  if (remaining <= 0) return;
  const data = await Promise.all(
    files.slice(0, remaining).map((file) => compressImage(file)),
  );
  container.images.push(...data);
  if (!container.thumbnail) container.thumbnail = container.images[0];
  renderImageOrder(container);
}
function renderImageOrder(container) {
  const order = container.querySelector(".image-order");
  const images = container.images || [];
  order.innerHTML =
    images
      .map((image, index) => {
        const isThumb = container.thumbnail === image;
        return `<div class="image-thumb"><button type="button" class="thumb-toggle ${isThumb ? "active" : ""}" data-set-thumb="${index}" title="${isThumb ? "This is the thumbnail" : "Set as thumbnail"}" aria-pressed="${isThumb}">${isThumb ? "★ Thumbnail" : "☆ Set thumbnail"}</button><div class="thumb-img-wrap"><img src="${image}" alt="Selected showcase image ${index + 1}" /><span class="thumb-index">${index + 1}</span></div><div class="image-thumb-actions"><button type="button" data-move="left" data-index="${index}" aria-label="Move image ${index + 1} left" ${index === 0 ? "disabled" : ""}>←</button><button type="button" data-remove-image="${index}" aria-label="Remove image ${index + 1}" title="Remove image">×</button><button type="button" data-move="right" data-index="${index}" aria-label="Move image ${index + 1} right" ${index === images.length - 1 ? "disabled" : ""}>→</button></div></div>`;
      })
      .join("") ||
    "<p>No images selected — the listing card will be shown instead.</p>";
  order.querySelectorAll("[data-set-thumb]").forEach((button) =>
    button.addEventListener("click", () => {
      container.thumbnail = images[Number(button.dataset.setThumb)];
      renderImageOrder(container);
    }),
  );
  order.querySelectorAll("[data-remove-image]").forEach((button) =>
    button.addEventListener("click", () => {
      const removed = images.splice(Number(button.dataset.removeImage), 1)[0];
      if (container.thumbnail === removed)
        container.thumbnail = images[0] || null;
      renderImageOrder(container);
    }),
  );
  order.querySelectorAll("[data-move]").forEach((button) =>
    button.addEventListener("click", () => {
      const index = Number(button.dataset.index);
      const swap = button.dataset.move === "left" ? index - 1 : index + 1;
      [images[index], images[swap]] = [images[swap], images[index]];
      renderImageOrder(container);
    }),
  );
}
async function createLobby(event) {
  event.preventDefault();
  const message = document.querySelector("#form-message");
  const rounds = [...document.querySelectorAll(".round-fields")].map(
    (field) => ({
      title: field.querySelector(".round-name").value,
      cars: [
        ...field.querySelectorAll('.car-link > label > input[type="url"]'),
      ].map((input) => input.value.trim()),
      names: [...field.querySelectorAll(".car-name")].map((input) =>
        input.value.trim(),
      ),
      prices: [...field.querySelectorAll(".car-price")].map((input) =>
        input.value.trim(),
      ),
      images: [...field.querySelectorAll(".car-link")].map(
        (container) => container.images || [],
      ),
      thumbnails: [...field.querySelectorAll(".car-link")].map(
        (container) => container.thumbnail || null,
      ),
    }),
  );
  message.textContent = "Creating the lobby…";
  try {
    const response = await fetch("/api/lobbies", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: document.querySelector("#game-name").value,
        rounds,
      }),
    });
    const created = await response.json();
    if (!response.ok) throw new Error(created.error);
    location.assign(
      `/lobby/${created.id}?host=${encodeURIComponent(created.hostToken)}`,
    );
  } catch (error) {
    message.textContent = error.message || "Could not create the lobby.";
  }
}
function listingFrame(car) {
  return car.thumbnail
    ? `<article class="listing-card" style="border:2px solid var(--ink);background:#182128"><img src="${car.thumbnail}" alt="${escapeHtml(car.name || car.source)} listing thumbnail" style="display:block;width:100%;height:auto;max-height:460px;object-fit:contain;background:#182128" /></article>`
    : `<article class="listing-card" style="min-height:180px;display:grid;place-items:center"><span>No showcase image</span></article>`;
}
function carDetails(car) {
  return `<div class="car-details"><b class="car-name">${escapeHtml(car.name || car.source)}</b>${car.price ? `<span class="car-price">${escapeHtml(car.price)}</span>` : ""}</div>`;
}
function listingLink(car) {
  return `<a href="${encodeURI(car.sourceUrl)}" target="_blank" rel="noopener" style="display:inline-block;margin:10px 0 0;color:inherit;font-size:12px;font-weight:600">Open original listing ↗</a>`;
}
function showcasePage(round) {
  const state = round.showcase || { carIndex: 0, imageIndex: 0 };
  const car = round.cars[state.carIndex];
  const images = car.images || [];
  const image = images[state.imageIndex];
  const finalCar = state.carIndex === round.cars.length - 1;
  const fullscreenSource = images.length
    ? images
    : car.thumbnail
      ? [car.thumbnail]
      : [];
  const isLastImage = Boolean(fullscreenSource.length) &&
    (images.length ? state.imageIndex === images.length - 1 : true);
  const carName = car.name || car.source;
  app.innerHTML = `<section class="game-head"><p class="eyebrow">ROUND ${lobby.currentRound + 1} OF ${lobby.rounds.length} · SHOWCASE</p><h1>${escapeHtml(round.title)}</h1><p>No voting yet.</p></section><section class="showcase"><div class="showcase-label"><b>CAR ${state.carIndex + 1} OF 2</b><span>${images.length ? `PHOTO ${state.imageIndex + 1} OF ${images.length}` : "LISTING OVERVIEW"}</span></div><div class="showcase-media">${image ? `<img src="${image}" alt="${escapeHtml(carName)} showcase photo ${state.imageIndex + 1}" />` : listingFrame(car)}${isLastImage ? `<p class="showcase-car-name">${escapeHtml(carName)}</p>` : ""}</div>${isHost ? `<div class="showcase-controls">${fullscreenSource.length ? '<button type="button" class="secondary fullscreen-btn" id="showcase-fullscreen">⛶ Fullscreen</button>' : ""}<button class="secondary" id="showcase-back" ${state.carIndex === 0 && state.imageIndex === 0 ? "disabled" : ""}>← Back</button>${state.imageIndex < images.length - 1 ? '<button class="secondary" id="showcase-image">Next image →</button>' : ""}<button class="primary" id="showcase-car">${finalCar ? "Start voting →" : "Show car 2 →"}</button></div>` : '<p class="wait-note">The host is guiding the showcase.</p>'}</section>`;
  document
    .querySelector("#showcase-fullscreen")
    ?.addEventListener("click", () =>
      openLightbox(
        fullscreenSource,
        images.length ? state.imageIndex : 0,
        carName,
        true,
      ),
    );
  document
    .querySelector("#showcase-back")
    ?.addEventListener("click", () => {
      if (state.imageIndex > 0)
        setShowcaseState({ imageIndex: state.imageIndex - 1 });
      else {
        const previousCarIndex = Math.max(0, state.carIndex - 1);
        const previousImages = round.cars[previousCarIndex].images || [];
        setShowcaseState({
          carIndex: previousCarIndex,
          imageIndex: Math.max(previousImages.length - 1, 0),
        });
      }
    });
  document
    .querySelector("#showcase-image")
    ?.addEventListener("click", () =>
      setShowcaseState({ imageIndex: state.imageIndex + 1 }),
    );
  document
    .querySelector("#showcase-car")
    ?.addEventListener("click", () => {
      if (finalCar) setShowcaseState({ phase: "voting" });
      else
        setShowcaseState({
          carIndex: state.carIndex + 1,
          imageIndex: 0,
        });
    });
}
function setShowcaseState(changes) {
  const round = lobby.rounds[lobby.currentRound];
  const state = round.showcase || { carIndex: 0, imageIndex: 0 };
  return post(`/api/lobbies/${lobby.id}/showcase`, {
    roundId: round.id,
    phase: changes.phase || round.phase,
    carIndex: changes.carIndex ?? state.carIndex,
    imageIndex: changes.imageIndex ?? state.imageIndex,
  });
}
function scoreBoard(round) {
  const total =
    Object.values(round.votes).reduce((sum, count) => sum + count, 0) || 1;
  return `<div class="scores">${round.cars
    .map((car) => {
      const votes = round.votes[car.id] || 0;
      const pct = Math.round((votes / total) * 100);
      return `<div class="score"><div><span>${escapeHtml(car.source)} listing</span><b>${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div><small>${votes} vote${votes === 1 ? "" : "s"}</small></div>`;
    })
    .join("")}</div>`;
}
function finalScoreCard(round, car) {
  const total =
    Object.values(round.votes).reduce((sum, count) => sum + count, 0) || 1;
  const votes = round.votes[car.id] || 0;
  const pct = Math.round((votes / total) * 100);
  return `<div class="score">${carDetails(car)}${listingFrame(car)}${listingLink(car)}<div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:18px"><span style="font-size:13px">${votes} vote${votes === 1 ? "" : "s"}</span><b style="font-family:'DM Mono',monospace">${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div></div>`;
}
function lobbyPage() {
  const current = lobby.rounds[lobby.currentRound];
  if (lobby.status === "lobby") {
    const joinUrl = `${location.origin}/lobby/${encodeURIComponent(lobby.id)}`;
    app.innerHTML = `<section class="lobby-hero"><p class="eyebrow">LOBBY OPEN · ${lobby.rounds.length} ROUND${lobby.rounds.length === 1 ? "" : "S"}</p><h1>${escapeHtml(lobby.title)}</h1><p class="lobby-description">Players scan the code to join. When the gang is assembled, start the showdown.</p></section><section class="lobby-grid"><div class="qr-card"><img src="/api/lobbies/${encodeURIComponent(lobby.id)}/qr" alt="QR code to join this lobby" /><b>SCAN TO JOIN</b><span aria-live="polite">${lobby.players} player${lobby.players === 1 ? "" : "s"} scanned in</span>${isHost ? '<button type="button" class="secondary" id="copy-link">Copy lobby link</button>' : ""}</div><div class="lobby-details"><div class="lobby-details-head"><p class="eyebrow">UP NEXT</p><span class="lobby-player-count" aria-live="polite">${lobby.players} player${lobby.players === 1 ? "" : "s"} scanned in</span></div>${lobby.rounds.map((round, index) => `<div class="round-row"><b>${index + 1}</b><span>${escapeHtml(round.title)}</span></div>`).join("")}${isHost ? '<button class="primary" id="start-game">Start game →</button>' : '<p class="wait-note">You’re in. Hang tight for the host to start the game.</p>'}</div></section>`;
    document
      .querySelector("#start-game")
      ?.addEventListener("click", () => post(`/api/lobbies/${lobby.id}/start`));
    document
      .querySelector("#copy-link")
      ?.addEventListener("click", async (event) => {
        const button = event.currentTarget;
        try {
          await navigator.clipboard.writeText(joinUrl);
          button.textContent = "Copied ✓";
        } catch {
          button.textContent = "Couldn’t copy, long-press to select";
        }
        setTimeout(() => {
          button.textContent = "Copy lobby link";
        }, 2000);
      });
  } else if (lobby.status === "complete") {
    app.innerHTML = `<section class="lobby-hero"><p class="eyebrow">GAME OVER</p><h1>The room has spoken.</h1><p>${escapeHtml(lobby.title)} is complete. Here are the final round results.</p></section><section class="final-rounds">${lobby.rounds.map((round, index) => `<div><h2>${index + 1}. ${escapeHtml(round.title)}</h2><div class="scores">${round.cars.map((car) => finalScoreCard(round, car)).join("")}</div></div>`).join("")}</section>`;
  } else if (current.phase !== "voting") {
    showcasePage(current);
  } else {
    const hasVoted = hasVotedInRound(current.id);
    const votedCount = current.voterCount || 0;
    app.innerHTML = `<section class="game-head"><p class="eyebrow">ROUND ${lobby.currentRound + 1} OF ${lobby.rounds.length} · VOTING OPEN</p><h1>${escapeHtml(current.title)}</h1><p class="voting-instruction">Pick the listing you’d rather take home. <span class="player-total">${lobby.players} player${lobby.players === 1 ? "" : "s"} connected</span></p></section><section class="listing-arena">${current.cars.map((car, index) => `<div>${carDetails(car)}${listingFrame(car)}<div class="listing-actions">${isHost && (car.images?.length || car.thumbnail) ? `<button type="button" class="secondary fullscreen-btn" data-fullscreen-car="${index}" style="margin-top:10px">⛶ Fullscreen</button>` : ""}${listingLink(car)}</div>${isHost || hasVoted ? "" : `<button class="vote-button ${index ? "blue-button" : ""}" data-car="${car.id}">I’d take this one</button>`}</div>`).join('<span class="versus">OR</span>')}</section><section class="game-results" style="margin:48px auto 58px" aria-live="polite"><p class="eyebrow">LIVE VOTE · ${votedCount} OF ${lobby.players} PLAYER${lobby.players === 1 ? "" : "S"} VOTED</p>${scoreBoard(current)}<p id="vote-message" class="small">${!isHost && hasVoted ? "You’ve already voted in this round." : ""}</p>${isHost ? `<button id="next-round" class="secondary">${lobby.currentRound === lobby.rounds.length - 1 ? "Finish game" : "Next round →"}</button>` : ""}</section>`;
    document.querySelectorAll("[data-fullscreen-car]").forEach((button) => {
      const car = current.cars[Number(button.dataset.fullscreenCar)];
      const images = car.images?.length
        ? car.images
        : car.thumbnail
          ? [car.thumbnail]
          : [];
      button.addEventListener("click", () =>
        openLightbox(images, 0, car.name || car.source),
      );
    });
    document
      .querySelectorAll("[data-car]")
      .forEach((button) =>
        button.addEventListener("click", () =>
          vote(current.id, button.dataset.car),
        ),
      );
    document
      .querySelector("#next-round")
      ?.addEventListener("click", () =>
        post(`/api/lobbies/${lobby.id}/next`, {
          expectedRound: lobby.currentRound,
        }),
      );
  }
}
async function post(url, body) {
  if (post.inFlight) return;
  post.inFlight = true;
  const previousMarkup = app.innerHTML;
  const stateBefore = lobbyStateSignature();
  try {
    showLoading("Updating game");
    const headers = body ? { "Content-Type": "application/json" } : {};
    if (hostToken) headers["X-Host-Token"] = hostToken;
    const requestOptions = {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined,
    };
    const response = url.endsWith("/start") ||
      url.endsWith("/showcase") ||
      url.endsWith("/next")
      ? await fetchIdempotentWithRetry(url, requestOptions)
      : await fetch(url, requestOptions);
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || `Update failed (${response.status})`);

    lobby = data?.id ? data : lobby;
    const refreshed = await refreshLobbyWhenAvailable();
    if (!refreshed)
      throw new Error("The game updated, but the latest state was not received.");
  } catch (error) {
    console.warn("Game update response was not received; reconciling:", error);
    showLoading("Confirming game update");
    let updateWasApplied = false;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
      const refreshed = await refreshLobbyWhenAvailable();
      if (refreshed && lobbyStateSignature() !== stateBefore) {
        updateWasApplied = true;
        break;
      }
    }
    if (updateWasApplied) return;

    console.error("Game update failed after reconciliation:", error);
    app.innerHTML = previousMarkup;
    if (lobby) lobbyPage();
    const notice = document.createElement("p");
    notice.className = "action-error";
    notice.setAttribute("role", "alert");
    notice.textContent = `${error.message || "The server is temporarily unreachable."} Please try again.`;
    app.prepend(notice);
  } finally {
    post.inFlight = false;
  }
}
async function fetchIdempotentWithRetry(url, options) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, options);
      if (response.status < 500 || attempt === 2) return response;
      lastError = new Error(`Game update failed (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)));
  }
  throw lastError || new Error("Could not update the game.");
}
function lobbyStateSignature() {
  if (!lobby) return "";
  const round = lobby.rounds?.[lobby.currentRound];
  return JSON.stringify({
    status: lobby.status,
    currentRound: lobby.currentRound,
    phase: round?.phase,
    showcase: round?.showcase,
  });
}
async function refreshLobbyWhenAvailable() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!loadLobby.inFlight) return loadLobby();
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}
async function vote(roundId, carId) {
  const message = document.querySelector("#vote-message");

  message.textContent = "Recording your vote…";

  try {
    const response = await fetch(
      `/api/lobbies/${lobby.id}/rounds/${roundId}/vote`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          carId,
          voterId: getVoterId(),
        }),
        keepalive: true,
      },
    );

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(data.error || "Could not record your vote.");
    }

    markRoundVoted(roundId);

    message.textContent = "Vote recorded.";
  } catch (error) {
    const voterId = getVoterId();
    const queued = sendBeaconJson(
      `/api/lobbies/${lobby.id}/rounds/${roundId}/vote`,
      { carId, voterId },
    );
    const confirmed = queued && await pollConfirmation(
      `/api/lobbies/${lobby.id}/rounds/${roundId}/vote-status?voterId=${encodeURIComponent(voterId)}`,
      (data) => data.recorded && data.carId === carId,
    );
    if (confirmed) {
      markRoundVoted(roundId);
      message.textContent = "Vote recorded.";
    } else message.textContent = error.message;
  }

  await loadLobby();
}
async function loadLobby() {
  if (loadLobby.inFlight) return false;
  loadLobby.inFlight = true;
  if (!hasRenderedLobby) showLoading();
  try {
    const syncQuery = hasRenderedLobby ? "?sync=1" : "";
    const response = await fetchLobbyWithRetry(
      `/api/lobbies/${encodeURIComponent(lobbyId)}${syncQuery}`,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 404) {
        app.innerHTML =
          '<section class="intro"><h1>This lobby has driven away.</h1></section>';
        hasRenderedLobby = true;
        return true;
      }
      throw new Error(data.error || "Could not load the lobby.");
    }
    if (lobby && hasRenderedLobby) {
      data.rounds?.forEach((round) => {
        const previousRound = lobby.rounds?.find((item) => item.id === round.id);
        round.cars?.forEach((car) => {
          const previousCar = previousRound?.cars?.find((item) => item.id === car.id);
          car.images = previousCar?.images || [];
          car.thumbnail = previousCar?.thumbnail || null;
        });
      });
    }
    lobby = data;
    lobbyPage();
    hasRenderedLobby = true;
    syncLightboxToShowcase();
    return true;
  } catch (error) {
    console.error("Lobby refresh failed:", error);
    if (!hasRenderedLobby) {
      app.innerHTML = `<section class="intro"><h1>Reconnecting to the lobby…</h1><p>${escapeHtml(error.message || "The server is temporarily unreachable.")}</p><button class="primary" id="retry-lobby">Try again</button></section>`;
      document.querySelector("#retry-lobby")?.addEventListener("click", loadLobby);
    }
    return false;
  } finally {
    loadLobby.inFlight = false;
  }
}
async function fetchLobbyWithRetry(url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.status < 500 || attempt === 2) return response;
      lastError = new Error(`Lobby refresh failed (${response.status})`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
  }
  throw lastError || new Error("Could not refresh the lobby.");
}
async function joinLobby() {
  if (isHost || joinLobby.confirmed || joinLobby.inFlight)
    return;

  joinLobby.inFlight = true;
  try {
    const response = await fetchWithTimeout(
      `/api/lobbies/${encodeURIComponent(lobbyId)}/join`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: getVoterId() }),
        keepalive: true,
      },
      4500,
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || `Join failed (${response.status})`);

    joinLobby.confirmed = true;
    try {
      sessionStorage.setItem(`joined:${lobbyId}`, "yes");
    } catch {
      // Registration is confirmed by the server; storage is optional.
    }
    await loadLobby();
  } catch (error) {
    const playerId = getVoterId();
    const queued = sendBeaconJson(
      `/api/lobbies/${encodeURIComponent(lobbyId)}/join`,
      { playerId },
    );
    const confirmed = queued && await pollConfirmation(
      `/api/lobbies/${encodeURIComponent(lobbyId)}/join-status?playerId=${encodeURIComponent(playerId)}`,
      (data) => data.joined,
    );
    if (confirmed) {
      joinLobby.confirmed = true;
      await loadLobby();
    } else console.error("Could not join lobby; will retry:", error);
  } finally {
    joinLobby.inFlight = false;
  }
}
async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
function sendBeaconJson(url, body) {
  if (typeof navigator.sendBeacon !== "function") return false;
  try {
    return navigator.sendBeacon(
      url,
      new Blob([JSON.stringify(body)], { type: "application/json" }),
    );
  } catch {
    return false;
  }
}
async function pollConfirmation(url, predicate) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    try {
      const response = await fetchWithTimeout(
        url,
        { cache: "no-store" },
        3500,
      );
      if (response.ok && predicate(await response.json())) return true;
    } catch {
      // The normal three-second loop will retry if confirmation also fails.
    }
  }
  return false;
}
if (lobbyId) {
  void loadLobby();
  void joinLobby();
  setInterval(() => {
    void loadLobby();
    void joinLobby();
  }, 3000);
} else setupPage();
