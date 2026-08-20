const app = document.querySelector("#app");
const lobbyId = location.pathname.match(/^\/lobby\/([^/]+)/)?.[1];
const isHost = new URLSearchParams(location.search).get("host") === "1";
let lobby;

const themeToggle = document.querySelector("#theme-toggle");
function applyTheme(isDark) {
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle?.setAttribute("aria-pressed", String(isDark));
  if (themeToggle) themeToggle.textContent = isDark ? "Light mode" : "Dark mode";
}
applyTheme(localStorage.getItem("theme") === "dark");
themeToggle?.addEventListener("click", () => {
  const isDark = document.documentElement.dataset.theme !== "dark";
  applyTheme(isDark);
  localStorage.setItem("theme", isDark ? "dark" : "light");
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
function getVoterId() {
  let id = localStorage.getItem("voterId");
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : `v-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("voterId", id);
  }
  return id;
}
const lightbox = document.querySelector("#lightbox");
const lightboxImg = document.querySelector("#lightbox-img");
const lightboxCaption = document.querySelector("#lightbox-caption");
const lightboxPrevBtn = document.querySelector("#lightbox-prev");
const lightboxNextBtn = document.querySelector("#lightbox-next");
let lightboxImages = [];
let lightboxIndex = 0;
let lightboxTitle = "";
function renderLightbox() {
  lightboxImg.src = lightboxImages[lightboxIndex];
  lightboxCaption.innerHTML = `<span class="lightbox-title">${lightboxTitle ? escapeHtml(lightboxTitle) : ""}</span><span class="lightbox-photo-count">Photo ${lightboxIndex + 1} of ${lightboxImages.length}</span>`;
  lightboxPrevBtn.disabled = lightboxIndex === 0;
  lightboxNextBtn.disabled = lightboxIndex === lightboxImages.length - 1;
}
function openLightbox(images, startIndex, title) {
  if (!images.length) return;
  lightboxImages = images;
  lightboxIndex = Math.max(0, Math.min(startIndex, images.length - 1));
  lightboxTitle = title || "";
  renderLightbox();
  lightbox.hidden = false;
  lightbox.requestFullscreen?.().catch(() => {});
}
function closeLightbox() {
  if (document.fullscreenElement === lightbox) document.exitFullscreen?.();
  lightbox.hidden = true;
}
lightboxPrevBtn.addEventListener("click", () => {
  if (lightboxIndex > 0) {
    lightboxIndex -= 1;
    renderLightbox();
  }
});
lightboxNextBtn.addEventListener("click", () => {
  if (lightboxIndex < lightboxImages.length - 1) {
    lightboxIndex += 1;
    renderLightbox();
  }
});
document.querySelector("#lightbox-close").addEventListener("click", closeLightbox);
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
  `<div class="car-link"><label>Car name <input class="car-name" required maxlength="80" placeholder="e.g. 2020 Mazda MX-5" /></label><label>Price <input class="car-price" maxlength="40" placeholder="Optional · e.g. RM 154,000" /></label><label>Listing link <input required type="url" placeholder="https://www.mudah.my/... or carlist.my/..." /></label><label class="image-picker">Showcase photos <input class="image-input" type="file" accept="image/*" multiple /></label><div class="paste-zone" tabindex="0" role="button">Click here, then paste an image</div><p class="image-help">Select or paste up to 8 images, then arrange them below.</p><div class="image-order" aria-live="polite"></div></div>`;
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
    bindRoundControls();
  });
  bindImagePickers();
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
      const url = container.querySelector("input").value.trim();
      const preview = container.querySelector(".preview-empty");
      if (!marketplace(url)) {
        preview.textContent = "Please use a full mudah.my or carlist.my link.";
        return;
      }
      const source = new URL(url).hostname.replace(/^www\./, "").split(".")[0];
      preview.replaceWith(
        Object.assign(document.createElement("div"), {
          className: "listing-preview",
          innerHTML: `<div class="listing-preview-head"><b></b><span>EXTERNAL LISTING</span></div><p class="listing-address"></p><p class="listing-preview-note">This marketplace keeps its listing on its own site. Open it to see photos and full details.</p><a target="_blank" rel="noopener">Open listing in a new tab ↗</a>`,
        }),
      );
      const card = container.querySelector(".listing-preview");
      card.querySelector("b").textContent =
        `${source[0].toUpperCase()}${source.slice(1)} listing`;
      card.querySelector(".listing-address").textContent = listingAddress(url);
      card.querySelector("a").href = url;
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
async function addImages(container, files) {
  const remaining = 8 - container.images.length;
  if (remaining <= 0) return;
  const data = await Promise.all(
    files.slice(0, remaining).map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        }),
    ),
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
    location.assign(`/lobby/${created.id}?host=1`);
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
  return `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:14px;margin-bottom:9px"><b style="font-size:17px">${escapeHtml(car.name || car.source)}</b>${car.price ? `<span style="font:13px 'DM Mono',monospace">${escapeHtml(car.price)}</span>` : ""}</div>`;
}
function listingLink(car) {   
  return `<a href="${encodeURI(car.sourceUrl)}" target="_blank" rel="noopener" style="display:inline-block;;margin:10px 0 0;color:inherit;font-size:12px;font-weight:600">Open original listing ↗</a>`; 
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
  app.innerHTML = `<section class="game-head"><p class="eyebrow">ROUND ${lobby.currentRound + 1} OF ${lobby.rounds.length} · SHOWCASE</p><h1>${escapeHtml(round.title)}</h1><p>${escapeHtml(car.name || car.source)} is on the floor. No voting yet.</p></section><section class="showcase"><div class="showcase-label"><b>CAR ${state.carIndex + 1} OF 2</b><span>${images.length ? `PHOTO ${state.imageIndex + 1} OF ${images.length}` : "LISTING OVERVIEW"}</span></div>${image ? `<img src="${image}" alt="${escapeHtml(car.name || car.source)} showcase photo ${state.imageIndex + 1}" />` : listingFrame(car)}${isHost ? `<div class="showcase-controls">${fullscreenSource.length ? '<button type="button" class="secondary fullscreen-btn" id="showcase-fullscreen">⛶ Fullscreen</button>' : ""}<button class="secondary" id="showcase-back" ${state.carIndex === 0 && state.imageIndex === 0 ? "disabled" : ""}>← Back</button>${state.imageIndex < images.length - 1 ? '<button class="secondary" id="showcase-image">Next image →</button>' : ""}<button class="primary" id="showcase-car">${finalCar ? "Start voting →" : "Show car 2 →"}</button></div>` : '<p class="wait-note">The host is guiding the showcase.</p>'}</section>`;
  document
    .querySelector("#showcase-fullscreen")
    ?.addEventListener("click", () =>
      openLightbox(
        fullscreenSource,
        images.length ? state.imageIndex : 0,
        car.name || car.source,
      ),
    );
  document
    .querySelector("#showcase-back")
    ?.addEventListener("click", () =>
      post(`/api/lobbies/${lobby.id}/showcase/back`),
    );
  document
    .querySelector("#showcase-image")
    ?.addEventListener("click", () =>
      post(`/api/lobbies/${lobby.id}/showcase/image`),
    );
  document
    .querySelector("#showcase-car")
    ?.addEventListener("click", () =>
      post(`/api/lobbies/${lobby.id}/showcase/car`),
    );
}
function scoreBoard(round) {
  const total =
    Object.values(round.votes).reduce((sum, count) => sum + count, 0) || 1;
  return `<div class="scores">${round.cars
    .map((car) => {
      const votes = round.votes[car.id] || 0;
      const pct = Math.round((votes / total) * 100);
      return `<div class="score"><div><span>${escapeHtml(car.source)} listing</span><b>${pct}%</b></div><div class="bar"><i style="width:${pct}%"></i></div><small>${votes} votes</small></div>`;
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
    app.innerHTML = `<section class="lobby-hero"><p class="eyebrow">LOBBY OPEN · ${lobby.rounds.length} ROUND${lobby.rounds.length === 1 ? "" : "S"}</p><h1>${escapeHtml(lobby.title)}</h1><p>Players scan the code to join. When the gang is assembled, start the showdown.</p></section><section class="lobby-grid"><div class="qr-card"><img src="/api/lobbies/${encodeURIComponent(lobby.id)}/qr" alt="QR code to join this lobby" /><b>SCAN TO JOIN</b><span>${lobby.players} player${lobby.players === 1 ? "" : "s"} in the lobby</span></div><div class="lobby-details"><p class="eyebrow">UP NEXT</p>${lobby.rounds.map((round, index) => `<div class="round-row"><b>${index + 1}</b><span>${escapeHtml(round.title)}</span></div>`).join("")}${isHost ? '<button class="primary" id="start-game">Start game →</button>' : '<p class="wait-note">You’re in. Hang tight for the host to start the game.</p>'}</div></section>`;
    document
      .querySelector("#start-game")
      ?.addEventListener("click", () => post(`/api/lobbies/${lobby.id}/start`));
  } else if (lobby.status === "complete") {
    app.innerHTML = `<section class="lobby-hero"><p class="eyebrow">GAME OVER</p><h1>The room has spoken.</h1><p>${escapeHtml(lobby.title)} is complete. Here are the final round results.</p></section><section class="final-rounds">${lobby.rounds.map((round, index) => `<div><h2>${index + 1}. ${escapeHtml(round.title)}</h2><div class="scores">${round.cars.map((car) => finalScoreCard(round, car)).join("")}</div></div>`).join("")}</section>`;
  } else if (current.phase !== "voting") {
    showcasePage(current);
  } else {
    const hasVoted = current.voters?.includes(getVoterId());
    app.innerHTML = `<section class="game-head"><p class="eyebrow">ROUND ${lobby.currentRound + 1} OF ${lobby.rounds.length} · VOTING OPEN</p><h1>${escapeHtml(current.title)}</h1><p>Pick the listing you’d rather take home.</p></section><section class="listing-arena">${current.cars.map((car, index) => `<div>${carDetails(car)}${listingFrame(car)}<div class="listing-actions">${isHost && (car.images?.length || car.thumbnail) ? `<button type="button" class="secondary fullscreen-btn" data-fullscreen-car="${index}" style="margin-top:10px">⛶ Fullscreen</button>` : ""}${listingLink(car)}</div>${isHost || hasVoted ? "" : `<button class="vote-button ${index ? "blue-button" : ""}" data-car="${car.id}">I’d take this one</button>`}</div>`).join('<span class="versus">OR</span>')}</section><section class="game-results" style="margin:48px auto 58px"><p class="eyebrow">LIVE VOTE</p>${scoreBoard(current)}<p id="vote-message" class="small">${!isHost && hasVoted ? "You’ve already voted in this round." : ""}</p>${isHost ? `<button id="next-round" class="secondary">${lobby.currentRound === lobby.rounds.length - 1 ? "Finish game" : "Next round →"}</button>` : ""}</section>`;
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
      ?.addEventListener("click", () => post(`/api/lobbies/${lobby.id}/next`));
  }
}
async function post(url, body) {
  await fetch(url, {
    method: "POST",
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  await loadLobby();
}
async function vote(roundId, carId) {
  const message = document.querySelector("#vote-message");
  message.textContent = "Recording your vote…";
  try {
    const response = await fetch(
      `/api/lobbies/${lobby.id}/rounds/${roundId}/vote`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ carId, voterId: getVoterId() }),
      },
    );
    const data = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(data.error || "Could not record your vote.");
    message.textContent = "Vote recorded.";
  } catch (error) {
    message.textContent = error.message;
  }
  await loadLobby();
}
async function loadLobby() {
  const response = await fetch(`/api/lobbies/${encodeURIComponent(lobbyId)}`);
  if (!response.ok) {
    app.innerHTML =
      '<section class="intro"><h1>This lobby has driven away.</h1></section>';
    return;
  }
  lobby = await response.json();
  lobbyPage();
}
if (lobbyId) {
  if (!isHost && !sessionStorage.getItem(`joined:${lobbyId}`)) {
    sessionStorage.setItem(`joined:${lobbyId}`, "yes");
    fetch(`/api/lobbies/${encodeURIComponent(lobbyId)}/join`, {
      method: "POST",
    }).finally(loadLobby);
  } else loadLobby();
  setInterval(loadLobby, 3000);
} else setupPage();
