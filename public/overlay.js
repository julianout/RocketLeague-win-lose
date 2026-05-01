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
  hudWins: document.getElementById("hudWins"),
  hudLosses: document.getElementById("hudLosses"),
  hudStreak: document.getElementById("hudStreak"),
  hudStreakTag: document.getElementById("hudStreakTag"),
  streakRow: document.getElementById("streakRow")
};

let hideTimer = null;

el.sessionHud.style.display = settings.showHud ? "grid" : "none";
document.body.classList.toggle("hud-hidden", !settings.showHud);
if (params.get("demo") === "1") renderSession({ wins: 6, losses: 0, streak: 0 });
connect();

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

  clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    el.resultBanner.classList.add("is-hidden");
  }, durationMs);
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
