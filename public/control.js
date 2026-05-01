const el = {
  connectionState: document.getElementById("connectionState"),
  connectionMode: document.getElementById("connectionMode"),
  connectionPill: document.getElementById("connectionPill"),
  detectedPlayer: document.getElementById("detectedPlayer"),
  detectedTeam: document.getElementById("detectedTeam"),
  currentScore: document.getElementById("currentScore"),
  currentWinner: document.getElementById("currentWinner"),
  sessionWins: document.getElementById("sessionWins"),
  sessionLosses: document.getElementById("sessionLosses"),
  sessionStreak: document.getElementById("sessionStreak"),
  historyList: document.getElementById("historyList"),
  logList: document.getElementById("logList"),
  configForm: document.getElementById("configForm"),
  statsApiUrl: document.getElementById("statsApiUrl"),
  playerName: document.getElementById("playerName"),
  primaryId: document.getElementById("primaryId"),
  manualTeamNum: document.getElementById("manualTeamNum"),
  overlayDurationMs: document.getElementById("overlayDurationMs")
};

let configDirty = false;

bindActions();
connectLiveSocket();

function bindActions() {
  bindPost("testConnection", "/api/test-connection");
  bindPost("manualWin", "/api/manual/win");
  bindPost("manualLoss", "/api/manual/loss");
  bindPost("testWin", "/api/test/win");
  bindPost("testLoss", "/api/test/loss");
  bindPost("undoLast", "/api/undo");
  bindPost("clearLogs", "/api/logs/clear");

  document.getElementById("resetSession").addEventListener("click", () => {
    if (window.confirm("Reset la session win/loss ?")) post("/api/reset");
  });

  el.configForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const state = await post("/api/config", {
      statsApiUrl: el.statsApiUrl.value,
      playerName: el.playerName.value,
      primaryId: el.primaryId.value,
      manualTeamNum: el.manualTeamNum.value,
      overlayDurationMs: Number(el.overlayDurationMs.value || 6500)
    });
    if (state) {
      configDirty = false;
      renderConfig(state.config || {});
    }
  });

  el.configForm.addEventListener("input", () => {
    configDirty = true;
  });
}

function bindPost(id, url) {
  document.getElementById(id).addEventListener("click", () => post(url));
}

async function post(url, body = {}) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    const payload = await response.json();

    if (!response.ok) {
      prependLog({
        at: new Date().toISOString(),
        level: "error",
        message: payload.error || "Erreur API",
        details: { url, status: response.status }
      });
      return null;
    }

    renderState(payload);
    return payload;
  } catch (error) {
    prependLog({
      at: new Date().toISOString(),
      level: "error",
      message: "Dashboard deconnecte du serveur",
      details: { url, error: error && error.message ? error.message : String(error) }
    });
    return null;
  }
}

function connectLiveSocket() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const socket = new WebSocket(`${protocol}//${window.location.host}/live`);

  socket.addEventListener("message", (event) => {
    const message = parseSocketMessage(event.data);
    if (!message) return;
    if (message.type === "state") renderState(message.payload);
    if (message.type === "log") prependLog(message.payload);
  });

  socket.addEventListener("close", () => {
    el.connectionState.textContent = "control disconnected";
    setConnectionPill("disconnected");
    window.setTimeout(connectLiveSocket, 1200);
  });
}

function renderState(state) {
  const config = state.config || {};
  const session = state.session || {};
  const latest = state.latestState || {};

  renderConnection(state);
  renderLiveMatch(latest);
  renderSession(session);
  if (!configDirty) renderConfig(config);
  renderHistory(session.history || []);
  renderLogs(state.logs || []);
}

function renderConnection(state) {
  el.connectionState.textContent = state.connection || "unknown";
  el.connectionMode.textContent = state.connectionMode || "-";
  setConnectionPill(state.connection || "unknown");
}

function renderLiveMatch(latest) {
  el.detectedPlayer.textContent = latest.playerName || "-";
  el.detectedTeam.textContent = formatTeam(latest.playerTeamNum);
  el.currentScore.textContent = formatScore(latest.teams || []);
  el.currentWinner.textContent = formatTeam(latest.winnerTeamNum);
}

function renderSession(session) {
  el.sessionWins.textContent = session.wins || 0;
  el.sessionLosses.textContent = session.losses || 0;
  el.sessionStreak.textContent = formatStreak(session.streak || 0);
}

function renderConfig(config) {
  el.statsApiUrl.value = config.statsApiUrl || "";
  el.playerName.value = config.playerName || "";
  el.primaryId.value = config.primaryId || "";
  el.manualTeamNum.value = config.manualTeamNum === 0 || config.manualTeamNum === 1 ? String(config.manualTeamNum) : "";
  el.overlayDurationMs.value = config.overlayDurationMs || 6500;
}

function setConnectionPill(status) {
  el.connectionPill.textContent = status;
  el.connectionPill.className = `status-pill ${status}`;
}

function renderHistory(history) {
  if (!history.length) {
    el.historyList.innerHTML = '<div class="empty-state">Aucun match enregistre.</div>';
    return;
  }

  el.historyList.innerHTML = history.map((item) => {
    const result = item.result === "win" ? "WIN" : "LOSE";
    const date = item.at ? new Date(item.at).toLocaleTimeString() : "";
    return `
      <div class="history-item">
        <span class="history-result ${escapeHtml(item.result)}">${result}</span>
        <span>${escapeHtml(item.score || "-")}</span>
        <span>${escapeHtml(formatTeam(item.playerTeamNum))}</span>
        <span>${escapeHtml(date)}</span>
      </div>
    `;
  }).join("");
}

function renderLogs(logs) {
  if (!logs.length) {
    el.logList.innerHTML = '<div class="empty-state">Aucun log pour le moment.</div>';
    return;
  }

  el.logList.innerHTML = logs.map(renderLogItem).join("");
}

function prependLog(item) {
  if (!item) return;
  const empty = el.logList.querySelector(".empty-state");
  if (empty) el.logList.innerHTML = "";
  el.logList.insertAdjacentHTML("afterbegin", renderLogItem(item));

  while (el.logList.children.length > 200) {
    el.logList.removeChild(el.logList.lastElementChild);
  }
}

function renderLogItem(item) {
  const level = item.level || "info";
  const time = item.at ? new Date(item.at).toLocaleTimeString() : "";
  const details = item.details && Object.keys(item.details).length ? JSON.stringify(item.details) : "";
  return `
    <div class="log-item ${escapeHtml(level)}">
      <span class="log-time">${escapeHtml(time)}</span>
      <span class="log-level">${escapeHtml(level.toUpperCase())}</span>
      <span class="log-message">${escapeHtml(item.message || "")}</span>
      ${details ? `<code>${escapeHtml(details)}</code>` : ""}
    </div>
  `;
}

function parseSocketMessage(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function formatScore(teams) {
  const blue = teams.find((team) => Number(team.TeamNum) === 0);
  const orange = teams.find((team) => Number(team.TeamNum) === 1);
  return `${blue ? Number(blue.Score || 0) : 0}-${orange ? Number(orange.Score || 0) : 0}`;
}

function formatTeam(teamNum) {
  if (teamNum === 0 || teamNum === "0") return "Blue";
  if (teamNum === 1 || teamNum === "1") return "Orange";
  return "-";
}

function formatStreak(streak) {
  if (streak > 0) return `Win streak ${streak}`;
  if (streak < 0) return `Lose streak ${Math.abs(streak)}`;
  return "Streak 0";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
