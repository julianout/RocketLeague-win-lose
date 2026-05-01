const params = new URLSearchParams(window.location.search);
const settings = {
  showHud: params.get("hud") !== "0",
  durationMs: readPositiveNumber(params.get("duration"), 6500)
};

const el = {
  resultBanner: document.getElementById("resultBanner"),
  resultWord: document.getElementById("resultWord"),
  resultScore: document.getElementById("resultScore"),
  resultSession: document.getElementById("resultSession"),
  resultStreak: document.getElementById("resultStreak"),
  sessionHud: document.getElementById("sessionHud"),
  hudRankMode: document.getElementById("hudRankMode"),
  hudMmr: document.getElementById("hudMmr"),
  hudWins: document.getElementById("hudWins"),
  hudLosses: document.getElementById("hudLosses"),
  hudStreak: document.getElementById("hudStreak"),
  hudStreakTag: document.getElementById("hudStreakTag"),
  streakRow: document.getElementById("streakRow")
};

let hideTimer = null;

document.body.classList.toggle("preview-mode", params.get("preview") === "1");
el.sessionHud.style.display = settings.showHud ? "grid" : "none";
document.body.classList.toggle("hud-hidden", !settings.showHud);
if (params.get("demo") === "1") {
  renderSession({ wins: 12, losses: 5, streak: 3 });
  renderRank({ status: "ready", playlistShort: "3V3", rating: 1245 });
} else {
  connect();
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/live`);

  socket.addEventListener("message", (event) => {
    const message = parseSocketMessage(event.data);
    if (!message) return;
    if (message.type === "state") renderState(message.payload);
    if (message.type === "result") renderResult(message.payload);
  });

  socket.addEventListener("close", () => {
    window.setTimeout(connect, 1200);
  });
}

function renderState(state) {
  renderSession(state.session || {});
  renderRank((state.latestState && state.latestState.rank) || null);
}

function renderResult(payload) {
  const session = payload.session || {};
  const result = payload.result === "win" ? "win" : "loss";
  const score = session.lastResult && session.lastResult.score ? session.lastResult.score : "-";
  const durationMs = readPositiveNumber(payload.durationMs, settings.durationMs);

  showResultToast(result);

  el.resultWord.textContent = result === "win" ? "WIN" : "LOSE";
  el.resultScore.textContent = score;
  el.resultSession.textContent = `${session.wins || 0}W ${session.losses || 0}L`;
  el.resultStreak.textContent = formatStreakValue(session.streak || 0);
  renderSession(session);
  renderRank(payload.latestState && payload.latestState.rank);

  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.resultBanner.classList.add("is-hidden");
  }, durationMs);
}

function renderRank(rank) {
  if (!rank || rank.status === "disabled") {
    el.hudRankMode.textContent = "MMR";
    el.hudMmr.textContent = "-";
    return;
  }

  el.hudRankMode.textContent = rank.playlistShort || "MMR";

  if (rank.status === "loading") {
    el.hudMmr.textContent = "...";
  } else if (rank.status === "ready" && rank.rating !== null && rank.rating !== undefined) {
    el.hudMmr.textContent = String(rank.rating);
  } else if (rank.status === "missing") {
    el.hudMmr.textContent = "UR";
  } else if (rank.status === "error") {
    el.hudMmr.textContent = "--";
  } else {
    el.hudMmr.textContent = "-";
  }
}

function renderSession(session) {
  const wins = Number(session.wins || 0);
  const losses = Number(session.losses || 0);

  el.hudWins.textContent = wins;
  el.hudLosses.textContent = losses;

  const streak = Number(session.streak || 0);
  el.hudStreak.textContent = formatStreakValue(streak);
  setStreakClass(el.hudStreakTag, streak);
  setStreakClass(el.streakRow, streak);
}

function showResultToast(result) {
  el.resultBanner.classList.remove("is-win", "is-loss", "is-hidden", "pulse");
  void el.resultBanner.offsetWidth;
  el.resultBanner.classList.add(result === "win" ? "is-win" : "is-loss", "pulse");
}

function setStreakClass(node, streak) {
  node.classList.toggle("win", streak > 0);
  node.classList.toggle("loss", streak < 0);
  node.classList.toggle("neutral", streak === 0);
}

function formatStreakValue(streak) {
  if (streak > 0) return `+${streak}`;
  if (streak < 0) return `${streak}`;
  return "0";
}

function readPositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function parseSocketMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
