const fs = require("fs");
const http = require("http");
const path = require("path");
const WebSocket = require("ws");

const paths = require("./src/paths");
const { AppState, DEFAULT_CONFIG } = require("./src/app-state");
const { StatsClient } = require("./src/stats-client");
const { parseTeamNum } = require("./src/utils");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon"
};

const appState = new AppState(paths);
let liveServer = null;

const statsClient = new StatsClient({
  getUrl: () => appState.config.statsApiUrl,
  onMessage: (raw) => appState.handleStatsMessage(raw),
  log: (level, message, details) => appState.log(level, message, details),
  emitState: () => appState.emitState()
});

appState.setStatsStatusProvider(() => statsClient.status());

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname.startsWith("/api/")) {
    await handleApi(req, res, url);
    return;
  }

  serveStatic(url.pathname, res);
});

liveServer = new WebSocket.Server({ server, path: "/live" });

liveServer.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "state", payload: appState.buildClientState() }));
});

appState.on("state", (state) => broadcast("state", state));
appState.on("log", (item) => broadcast("log", item));
appState.on("result", (payload) => broadcast("result", payload));

const API_ROUTES = {
  "GET /api/state": (_req, res) => sendState(res),
  "GET /api/logs": (_req, res) => sendJson(res, 200, { logs: appState.logger.items }),
  "POST /api/config": handleConfigUpdate,
  "POST /api/reset": (_req, res) => {
    appState.resetSession();
    sendState(res);
  },
  "POST /api/logs/clear": (_req, res) => {
    appState.clearLogs();
    sendState(res);
  },
  "POST /api/test-connection": (_req, res) => {
    statsClient.runDiagnostics();
    sendState(res, 202);
  },
  "POST /api/undo": (_req, res) => {
    appState.undoLastResult();
    sendState(res);
  },
  "POST /api/manual/win": (_req, res) => {
    recordManualResult("win");
    sendState(res);
  },
  "POST /api/manual/loss": (_req, res) => {
    recordManualResult("loss");
    sendState(res);
  },
  "POST /api/test/win": (_req, res) => {
    recordPreviewResult("win");
    sendState(res);
  },
  "POST /api/test/loss": (_req, res) => {
    recordPreviewResult("loss");
    sendState(res);
  }
};

server.listen(appState.config.serverPort, "0.0.0.0", () => {
  appState.log("info", "Serveur overlay demarre", {
    overlay: `http://localhost:${appState.config.serverPort}/overlay.html`,
    control: `http://localhost:${appState.config.serverPort}/control.html`,
    statsApiUrl: appState.config.statsApiUrl
  });
  statsClient.connect();
});

function broadcast(type, payload) {
  if (!liveServer) return;
  const message = JSON.stringify({ type, payload });

  for (const socket of liveServer.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
}

function serveStatic(requestPath, res) {
  const safePath = requestPath === "/" ? "/overlay.html" : requestPath;
  const filePath = path.normalize(path.join(paths.publicDir, safePath));
  const relativePath = path.relative(paths.publicDir, filePath);

  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  fs.readFile(filePath, (error, buffer) => {
    if (error) {
      sendJson(res, 404, { error: "Not found" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(buffer);
  });
}

async function handleApi(req, res, url) {
  try {
    const route = API_ROUTES[`${req.method} ${url.pathname}`];
    if (route) return await route(req, res, url);

    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode >= 500) {
      appState.log("error", "Erreur API", {
        path: url.pathname,
        error: error && error.message ? error.message : String(error)
      });
    }
    sendJson(res, statusCode, { error: error.message || "Internal server error" });
  }
}

async function handleConfigUpdate(req, res) {
  const body = await readBody(req);
  const result = appState.saveConfig({
    statsApiUrl: String(body.statsApiUrl || appState.config.statsApiUrl || DEFAULT_CONFIG.statsApiUrl),
    playerName: String(body.playerName || "").trim(),
    primaryId: String(body.primaryId || "").trim(),
    manualTeamNum: parseTeamNum(body.manualTeamNum),
    overlayDurationMs: Number(body.overlayDurationMs || appState.config.overlayDurationMs)
  });

  if (result.statsApiUrlChanged) statsClient.connect();
  sendState(res);
}

function recordManualResult(result) {
  const playerTeamNum = parseTeamNum(appState.latestState.playerTeamNum);
  const winnerTeamNum = result === "win" ? playerTeamNum : oppositeTeamNum(playerTeamNum);

  appState.recordResult(result, {
    MatchGuid: appState.latestState.matchGuid || `manual-${Date.now()}`,
    WinnerTeamNum: winnerTeamNum,
    Manual: true
  });
}

function recordPreviewResult(result) {
  const playerTeamNum = parseTeamNum(appState.latestState.playerTeamNum) ?? 0;

  appState.recordResult(result, {
    MatchGuid: `test-${Date.now()}`,
    WinnerTeamNum: result === "win" ? playerTeamNum : oppositeTeamNum(playerTeamNum),
    Preview: true
  });
}

function oppositeTeamNum(teamNum) {
  const parsed = parseTeamNum(teamNum);
  if (parsed === null) return null;
  return parsed === 0 ? 1 : 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let settled = false;

    function fail(message, statusCode = 400) {
      if (settled) return;
      settled = true;
      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    }

    req.on("data", (chunk) => {
      if (settled) return;
      body += chunk;
      if (body.length > 1_000_000) {
        fail("Body too large", 413);
        req.destroy();
      }
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const parsed = body ? JSON.parse(body) : {};
        settled = true;
        resolve(parsed);
      } catch {
        fail("JSON invalide", 400);
      }
    });
    req.on("error", (error) => fail(error.message || "Erreur lecture requete", 400));
  });
}

function sendState(res, statusCode = 200) {
  sendJson(res, statusCode, appState.buildClientState());
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}
