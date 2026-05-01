const params = new URLSearchParams(window.location.search);
const demoMode = params.get("demo") === "1";

const el = {
  connectionState: document.getElementById("connectionState"),
  connectionMode: document.getElementById("connectionMode"),
  connectionPill: document.getElementById("connectionPill"),
  detectedPlayer: document.getElementById("detectedPlayer"),
  detectedTeam: document.getElementById("detectedTeam"),
  currentScore: document.getElementById("currentScore"),
  currentWinner: document.getElementById("currentWinner"),
  currentPlaylist: document.getElementById("currentPlaylist"),
  currentRank: document.getElementById("currentRank"),
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
  rankEnabled: document.getElementById("rankEnabled"),
  rankPlaylistId: document.getElementById("rankPlaylistId"),
  overlayDurationMs: document.getElementById("overlayDurationMs")
};

let configDirty = false;

bindActions();
if (demoMode) {
  renderState(createDemoState());
} else {
  connectLiveSocket();
}

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
      rankEnabled: el.rankEnabled.value === "true",
      rankPlaylistId: el.rankPlaylistId.value,
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

function createDemoState() {
  const now = Date.now();
  return {
    config: {
      statsApiUrl: "tcp://127.0.0.1:49123",
      playerName: "",
      primaryId: "",
      manualTeamNum: null,
      rankEnabled: true,
      rankPlaylistId: "auto",
      overlayDurationMs: 6500
    },
    session: {
      wins: 12,
      losses: 5,
      streak: 3,
      history: [
        { result: "win", score: "2-4", playerTeamNum: 1, at: new Date(now - 120000).toISOString() },
        { result: "win", score: "3-1", playerTeamNum: 0, at: new Date(now - 620000).toISOString() },
        { result: "loss", score: "1-2", playerTeamNum: 1, at: new Date(now - 1140000).toISOString() }
      ]
    },
    latestState: {
      playerName: "PlayerOne",
      playerTeamNum: 1,
      winnerTeamNum: null,
      teams: [
        { TeamNum: 0, Score: 2 },
        { TeamNum: 1, Score: 4 }
      ],
      playlist: {
        id: 13,
        short: "3V3",
        label: "Ranked Standard 3v3",
        source: "player-count",
        confidence: "guess"
      },
      rank: {
        status: "ready",
        playlistShort: "3V3",
        playlistName: "Ranked Standard 3v3",
        rating: 1245,
        tier: "Champion II",
        division: "Division II"
      }
    },
    connection: "connected",
    connectionMode: "tcp",
    logs: [
      {
        at: new Date(now - 8000).toISOString(),
        level: "info",
        message: "MMR Tracker recu",
        details: { playlist: "Ranked Standard 3v3", rating: 1245, tier: "Champion II" }
      },
      {
        at: new Date(now - 13000).toISOString(),
        level: "info",
        message: "Mode MMR detecte",
        details: { playlist: "Ranked Standard 3v3", source: "player-count" }
      },
      {
        at: new Date(now - 17000).toISOString(),
        level: "info",
        message: "Joueur detecte",
        details: { name: "PlayerOne", teamNum: 1, source: "auto" }
      },
      {
        at: new Date(now - 22000).toISOString(),
        level: "info",
        message: "Stats API connectee en TCP",
        details: { host: "127.0.0.1", port: 49123 }
      }
    ]
  };
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
  el.currentPlaylist.textContent = formatPlaylist(latest.playlist);
  el.currentRank.textContent = formatRank(latest.rank);
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
  el.rankEnabled.value = config.rankEnabled === false ? "false" : "true";
  el.rankPlaylistId.value = config.rankPlaylistId === undefined || config.rankPlaylistId === null ? "auto" : String(config.rankPlaylistId);
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

function formatPlaylist(playlist) {
  if (!playlist || playlist.id === null || playlist.id === undefined) return "-";
  const source = playlist.source === "player-count" ? " auto" : "";
  return `${playlist.short || playlist.label}${source}`;
}

function formatRank(rank) {
  if (!rank || rank.status === "idle" || rank.status === "unavailable") return "-";
  if (rank.status === "disabled") return "off";
  if (rank.status === "loading") return "loading";
  if (rank.status === "error") return "error";
  if (rank.rating !== null && rank.rating !== undefined) return String(rank.rating);
  return rank.tier || "-";
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
