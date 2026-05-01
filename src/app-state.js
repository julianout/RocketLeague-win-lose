const crypto = require("crypto");
const EventEmitter = require("events");
const fs = require("fs");

const { Logger } = require("./logger");
const {
  asObject,
  getArrayField,
  getField,
  inferWinnerTeamNum,
  normalize,
  normalizeGame,
  normalizePlayer,
  parseTeamNum,
  readJson,
  safePreview,
  writeJson
} = require("./utils");
const { inferPlaylist, normalizeRankPlaylistId } = require("./playlist");

const DEFAULT_CONFIG = {
  statsApiUrl: "tcp://127.0.0.1:49123",
  serverPort: 5177,
  playerName: "",
  primaryId: "",
  manualTeamNum: null,
  overlayDurationMs: 6500,
  rankEnabled: true,
  rankPlaylistId: "auto"
};

const DEFAULT_SESSION = {
  wins: 0,
  losses: 0,
  streak: 0,
  lastResult: null,
  history: []
};

function createEmptyMatchState() {
  return {
    matchGuid: "",
    playerTeamNum: null,
    playerName: "",
    playerPrimaryId: "",
    winnerTeamNum: null,
    resultEligible: false,
    maxPlayers: 0,
    playlistGuessReady: false,
    playlist: {
      id: null,
      short: "MMR",
      label: "Mode inconnu",
      source: "unknown",
      confidence: "unknown"
    },
    rank: createEmptyRankState(),
    teams: [],
    game: null,
    players: [],
    lastEventAt: null
  };
}

function createEmptyRankState(overrides = {}) {
  return {
    status: "idle",
    signature: "",
    playlistId: null,
    playlistName: "Mode inconnu",
    playlistShort: "MMR",
    rating: null,
    tier: "",
    division: "",
    matchesPlayed: null,
    source: "tracker",
    updatedAt: null,
    error: null,
    ...overrides
  };
}

function normalizeStatsApiUrl(value) {
  const raw = String(value || DEFAULT_CONFIG.statsApiUrl).trim();
  return raw.replace(/^wss?:\/\//i, "tcp://");
}

class AppState extends EventEmitter {
  constructor(paths) {
    super();
    this.paths = paths;
    this.ensureFiles();

    this.config = this.loadConfig();
    this.session = this.loadSession();
    this.latestState = createEmptyMatchState();
    this.processedMatchEnds = new Set();
    this.statsStatusProvider = () => ({ connection: "starting", connectionMode: "" });

    this.lastEmptyUpdateStateDetailLogAt = 0;
    this.lastMatchSignature = "";
    this.lastScoreSignature = "";
    this.lastWinnerSignature = "";
    this.lastDetectedPlayerSignature = "";
    this.lastManualTeamSignature = "";
    this.lastPlaylistSignature = "";
    this.lastRankRequestKey = "";
    this.missingPlayerConfigLogged = false;
    this.playerNotFoundLogged = false;

    this.logger = new Logger(paths.logPath, (item) => this.emit("log", item));
  }

  ensureFiles() {
    fs.mkdirSync(this.paths.dataDir, { recursive: true });
    if (!fs.existsSync(this.paths.configPath)) {
      fs.copyFileSync(this.paths.exampleConfigPath, this.paths.configPath);
    }
  }

  loadConfig() {
    const config = { ...DEFAULT_CONFIG, ...readJson(this.paths.configPath, {}) };
    return {
      ...config,
      statsApiUrl: normalizeStatsApiUrl(config.statsApiUrl),
      rankEnabled: config.rankEnabled !== false && config.rankEnabled !== "false",
      rankPlaylistId: normalizeRankPlaylistId(config.rankPlaylistId)
    };
  }

  loadSession() {
    return { ...DEFAULT_SESSION, ...readJson(this.paths.sessionPath, {}) };
  }

  saveConfig(nextConfig) {
    const previousStatsUrl = this.config.statsApiUrl;
    const shouldResetMatch =
      normalize(normalizeStatsApiUrl(nextConfig.statsApiUrl)) !== normalize(this.config.statsApiUrl) ||
      normalize(nextConfig.playerName) !== normalize(this.config.playerName) ||
      normalize(nextConfig.primaryId) !== normalize(this.config.primaryId) ||
      normalize(nextConfig.manualTeamNum) !== normalize(this.config.manualTeamNum);
    const rankConfigChanged =
      normalize(nextConfig.rankEnabled) !== normalize(this.config.rankEnabled) ||
      normalize(nextConfig.rankPlaylistId) !== normalize(this.config.rankPlaylistId);

    this.config = {
      ...this.config,
      ...nextConfig,
      statsApiUrl: normalizeStatsApiUrl(nextConfig.statsApiUrl),
      manualTeamNum: parseTeamNum(nextConfig.manualTeamNum),
      rankEnabled: nextConfig.rankEnabled !== false && nextConfig.rankEnabled !== "false",
      rankPlaylistId: normalizeRankPlaylistId(nextConfig.rankPlaylistId),
      serverPort: Number(nextConfig.serverPort || this.config.serverPort || DEFAULT_CONFIG.serverPort),
      overlayDurationMs: Number(nextConfig.overlayDurationMs || this.config.overlayDurationMs || DEFAULT_CONFIG.overlayDurationMs)
    };

    if (shouldResetMatch) this.resetLatestState();
    if (rankConfigChanged) this.resetRankState();
    if (this.config.manualTeamNum !== null) this.latestState.playerTeamNum = this.config.manualTeamNum;

    writeJson(this.paths.configPath, this.config);
    this.log("info", "Configuration sauvegardee", {
      statsApiUrl: this.config.statsApiUrl,
      playerName: this.config.playerName || null,
      primaryId: this.config.primaryId || null,
      manualTeamNum: this.config.manualTeamNum,
      overlayDurationMs: this.config.overlayDurationMs,
      rankEnabled: this.config.rankEnabled,
      rankPlaylistId: this.config.rankPlaylistId
    });
    this.emitState();

    return { statsApiUrlChanged: previousStatsUrl !== this.config.statsApiUrl };
  }

  setStatsStatusProvider(provider) {
    this.statsStatusProvider = provider;
  }

  log(level, message, details = {}) {
    return this.logger.add(level, message, details);
  }

  clearLogs() {
    this.logger.clear();
    this.emitState();
  }

  resetLatestState() {
    this.lastEmptyUpdateStateDetailLogAt = 0;
    this.lastMatchSignature = "";
    this.lastScoreSignature = "";
    this.lastWinnerSignature = "";
    this.lastDetectedPlayerSignature = "";
    this.lastManualTeamSignature = "";
    this.lastPlaylistSignature = "";
    this.lastRankRequestKey = "";
    this.missingPlayerConfigLogged = false;
    this.playerNotFoundLogged = false;
    this.latestState = createEmptyMatchState();
  }

  resetRankState() {
    this.lastRankRequestKey = "";
    this.latestState.rank = createEmptyRankState();
  }

  resetSession() {
    this.session = { ...DEFAULT_SESSION };
    this.processedMatchEnds = new Set();
    writeJson(this.paths.sessionPath, this.session);
    this.log("info", "Session reset");
    this.emitState();
  }

  emitState() {
    this.emit("state", this.buildClientState());
  }

  buildClientState() {
    const stats = this.statsStatusProvider();
    return {
      config: this.config,
      session: this.session,
      latestState: this.latestState,
      connection: stats.connection,
      connectionMode: stats.connectionMode,
      logs: this.logger.items
    };
  }

  handleStatsMessage(raw) {
    let message;
    try {
      message = asObject(JSON.parse(String(raw)));
    } catch {
      this.log("warn", "Message Stats API ignore: JSON invalide");
      return;
    }

    const eventName = getField(message, "Event");
    const data = asObject(getField(message, "Data"));

    switch (eventName) {
      case "UpdateState":
        this.updateFromState(data);
        break;
      case "MatchCreated":
      case "MatchInitialized":
      case "CountdownBegin":
      case "RoundStarted":
        this.handleMatchLifecycle(eventName, data);
        break;
      case "MatchEnded":
        this.handleMatchEnded(data);
        break;
      case "MatchDestroyed":
        this.handleMatchDestroyed();
        break;
      default:
        break;
    }
  }

  handleMatchLifecycle(eventName, data) {
    const matchGuid = getField(data, "MatchGuid") || this.latestState.matchGuid || "";
    const activeRound = eventName === "CountdownBegin" || eventName === "RoundStarted";
    const eventAllowsPlaylistGuess = eventName === "MatchInitialized" || activeRound;
    const sameMatch = !matchGuid || matchGuid === this.latestState.matchGuid;
    const playlistGuessReady = eventAllowsPlaylistGuess || (sameMatch && this.latestState.playlistGuessReady);

    if (matchGuid && matchGuid !== this.latestState.matchGuid) {
      const previousRank = this.latestState.rank || createEmptyRankState();
      this.latestState = {
        ...createEmptyMatchState(),
        matchGuid,
        playerName: this.latestState.playerName || "",
        playerPrimaryId: this.latestState.playerPrimaryId || "",
        playerTeamNum: parseTeamNum(this.config.manualTeamNum),
        resultEligible: activeRound,
        playlistGuessReady,
        rank: hasDisplayableRank(previousRank) ? { ...previousRank, stale: true } : createEmptyRankState()
      };
    } else {
      this.latestState = {
        ...this.latestState,
        matchGuid,
        resultEligible: this.latestState.resultEligible || activeRound,
        playlistGuessReady,
        lastEventAt: new Date().toISOString()
      };
    }

    this.log("info", `${eventName} recu`, {
      matchGuid: matchGuid || null,
      resultEligible: this.latestState.resultEligible
    });
    this.emitState();
  }

  updateFromState(data) {
    const players = getArrayField(data, "Players").map(normalizePlayer).filter(Boolean);
    const game = normalizeGame(getField(data, "Game"));
    const configuredPlayer = this.findConfiguredPlayer(players);
    const knownPlayer = configuredPlayer ? null : this.findKnownPlayer(players);
    const autoPlayer = configuredPlayer || knownPlayer ? null : this.findAutoDetectedPlayer(players, game);
    const player = configuredPlayer || knownPlayer || autoPlayer;
    const manualTeamNum = parseTeamNum(this.config.manualTeamNum);
    const winnerTeamNum = inferWinnerTeamNum(data, game);
    const now = Date.now();
    const isEmptyState = players.length === 0 && !(game && Array.isArray(game.Teams) && game.Teams.length > 0);
    const matchGuid = getField(data, "MatchGuid") || null;
    const previousMatchGuid = this.latestState.matchGuid || "";
    const isNewKnownMatch = Boolean(matchGuid && previousMatchGuid && matchGuid !== previousMatchGuid);
    const previousResultEligible = isNewKnownMatch ? false : this.latestState.resultEligible;
    const resultEligible = previousResultEligible || (players.length > 0 && winnerTeamNum === null);
    const teamCount = game && Array.isArray(game.Teams) ? game.Teams.length : 0;
    const activePlayerCount = countTeamPlayers(players);
    const maxPlayers = isNewKnownMatch ? activePlayerCount : Math.max(this.latestState.maxPlayers || 0, activePlayerCount);
    const playlistGuessReady = isNewKnownMatch ? false : this.latestState.playlistGuessReady;
    const playlist = inferPlaylist({
      data,
      game,
      players,
      maxPlayers,
      configuredPlaylistId: this.config.rankPlaylistId,
      allowPlayerCountGuess: playlistGuessReady
    });
    const playerName = player && player.Name ? player.Name : this.latestState.playerName;
    const playerPrimaryId = player && player.PrimaryId ? player.PrimaryId : this.latestState.playerPrimaryId;
    const playerIdentity = playerPrimaryId ? { Name: playerName, PrimaryId: playerPrimaryId } : null;
    const rank = this.buildRankState(playerIdentity, playlist);

    if (isEmptyState && now - this.lastEmptyUpdateStateDetailLogAt > 60000) {
      this.lastEmptyUpdateStateDetailLogAt = now;
      this.log("warn", "UpdateState vide: detail payload", {
        dataKeys: Object.keys(data || {}),
        gameKeys: game ? Object.keys(game) : [],
        preview: safePreview(data)
      });
    }

    this.logMatchProgress(matchGuid, players.length, teamCount, game, winnerTeamNum);
    this.logMissingPlayerContext(player, players, manualTeamNum, playlistGuessReady);

    this.latestState = {
      matchGuid: matchGuid || this.latestState.matchGuid || "",
      playerTeamNum: player ? Number(player.TeamNum) : manualTeamNum ?? this.latestState.playerTeamNum,
      playerName,
      playerPrimaryId,
      winnerTeamNum: winnerTeamNum ?? this.latestState.winnerTeamNum,
      resultEligible,
      maxPlayers,
      playlistGuessReady,
      playlist,
      rank,
      teams: game && Array.isArray(game.Teams) ? game.Teams : this.latestState.teams,
      game,
      players,
      lastEventAt: new Date().toISOString()
    };

    this.logPlayerDetection(player, configuredPlayer, manualTeamNum);
    this.logPlaylistDetection(playlist);
    this.queueRankLookup(playerIdentity, playlist);
    this.emitState();
  }

  logMatchProgress(matchGuid, playerCount, teamCount, game, winnerTeamNum) {
    const matchSignature = `${matchGuid || "no-guid"}|${playerCount}|${teamCount}`;
    if (matchSignature !== this.lastMatchSignature) {
      this.lastMatchSignature = matchSignature;
      this.log("info", "Match state", {
        matchGuid,
        players: playerCount,
        teams: teamCount
      });
    }

    if (game && Array.isArray(game.Teams) && game.Teams.length) {
      const scoreSignature = game.Teams
        .map((team) => `${team.TeamNum}:${team.Score}`)
        .join("|");
      if (scoreSignature !== this.lastScoreSignature) {
        this.lastScoreSignature = scoreSignature;
        this.log("info", "Score update", {
          blue: this.readScore(game.Teams, 0),
          orange: this.readScore(game.Teams, 1)
        });
      }
    }

    if (winnerTeamNum !== null) {
      const winnerSignature = `${matchGuid || "no-guid"}|${winnerTeamNum}`;
      if (winnerSignature !== this.lastWinnerSignature) {
        this.lastWinnerSignature = winnerSignature;
        this.log("info", "Winner detecte", {
          winnerTeamNum,
          winner: winnerTeamNum === 0 ? "Blue" : "Orange"
        });
      }
    }
  }

  logMissingPlayerContext(player, players, manualTeamNum, playlistGuessReady) {
    const hasKnownPlayer = Boolean(this.latestState.playerName || this.latestState.playerPrimaryId);

    if (!this.config.playerName && !this.config.primaryId && !player && !hasKnownPlayer && playlistGuessReady && players.length > 0 && manualTeamNum === null && !this.missingPlayerConfigLogged) {
      this.missingPlayerConfigLogged = true;
      this.log("warn", "Auto-detection impossible pour l'instant: aucun joueur/cible dans UpdateState. Mets ton pseudo ou une equipe manuelle dans le panneau.");
    }

    if ((this.config.playerName || this.config.primaryId) && !player && manualTeamNum === null && !this.playerNotFoundLogged) {
      this.playerNotFoundLogged = true;
      this.log("warn", "Aucun joueur ne correspond a ta config dans UpdateState", {
        configuredName: this.config.playerName || null,
        configuredPrimaryId: this.config.primaryId || null,
        seenPlayers: players.map((item) => ({ name: item.Name, primaryId: item.PrimaryId, teamNum: item.TeamNum })).slice(0, 12)
      });
    }
  }

  logPlayerDetection(player, configuredPlayer, manualTeamNum) {
    if (player) {
      this.playerNotFoundLogged = false;
      const signature = `${player.Name}|${player.PrimaryId || ""}|${player.TeamNum}`;
      if (signature !== this.lastDetectedPlayerSignature) {
        this.lastDetectedPlayerSignature = signature;
        this.log("info", "Joueur detecte", {
          name: player.Name,
          primaryId: player.PrimaryId || null,
          teamNum: player.TeamNum,
          source: configuredPlayer ? "config" : player.bAutoDetectedKnown ? "known" : player.bAutoDetectedFromTarget ? "target" : "auto"
        });
      }
      return;
    }

    if (manualTeamNum !== null) {
      const signature = `manual|${manualTeamNum}`;
      if (signature !== this.lastManualTeamSignature) {
        this.lastManualTeamSignature = signature;
        this.log("info", "Equipe manuelle utilisee", {
          teamNum: manualTeamNum,
          team: manualTeamNum === 0 ? "Blue" : "Orange"
        });
      }
    }
  }

  logPlaylistDetection(playlist) {
    const signature = `${playlist.id || "unknown"}|${playlist.source}|${playlist.confidence}`;
    if (signature === this.lastPlaylistSignature) return;

    this.lastPlaylistSignature = signature;
    const isPending = playlist.source === "waiting-for-start";
    this.log(isPending || playlist.id !== null ? "info" : "warn", isPending ? "Mode MMR en attente" : playlist.id === null ? "Mode MMR inconnu" : "Mode MMR detecte", {
      playlistId: playlist.id,
      playlist: playlist.label,
      source: playlist.source,
      confidence: playlist.confidence
    });
  }

  buildRankState(player, playlist) {
    if (!this.config.rankEnabled) {
      return createEmptyRankState({
        status: "disabled",
        playlistId: playlist.id,
        playlistName: playlist.label,
        playlistShort: playlist.short
      });
    }

    const signature = this.getRankSignature(player && player.PrimaryId, playlist.id);
    const previousRank = this.latestState.rank || createEmptyRankState();
    if (signature && previousRank.signature === signature) return previousRank;
    if (!signature && hasDisplayableRank(previousRank)) {
      return {
        ...previousRank,
        stale: true
      };
    }

    return createEmptyRankState({
      status: signature ? "idle" : "unavailable",
      signature,
      playlistId: playlist.id,
      playlistName: playlist.label,
      playlistShort: playlist.short,
      error: signature ? null : "missing-player-or-playlist"
    });
  }

  queueRankLookup(player, playlist) {
    if (!this.config.rankEnabled || !player || !player.PrimaryId || playlist.id === null) return;

    const signature = this.getRankSignature(player.PrimaryId, playlist.id);
    const requestKey = `${this.latestState.matchGuid || "no-match"}|${signature}`;
    if (!signature || requestKey === this.lastRankRequestKey) return;

    this.lastRankRequestKey = requestKey;
    this.latestState.rank = {
      ...this.latestState.rank,
      status: "loading",
      signature,
      playlistId: playlist.id,
      playlistName: playlist.label,
      playlistShort: playlist.short,
      error: null
    };
    this.emit("rankLookup", {
      requestKey,
      signature,
      primaryId: player.PrimaryId,
      playerName: player.Name,
      playlist
    });
  }

  applyRankResult(signature, rank) {
    if (!signature || !this.latestState.rank || this.latestState.rank.signature !== signature) return false;

    this.latestState.rank = {
      ...this.latestState.rank,
      ...rank,
      signature
    };
    this.emitState();
    return true;
  }

  getRankSignature(primaryId, playlistId) {
    if (!primaryId || playlistId === null || playlistId === undefined) return "";
    return `${primaryId}|${playlistId}`;
  }

  findConfiguredPlayer(players) {
    const primaryId = normalize(this.config.primaryId);
    const playerName = normalize(this.config.playerName);

    if (primaryId) {
      const byPrimaryId = players.find((player) => normalize(player.PrimaryId) === primaryId);
      if (byPrimaryId) return byPrimaryId;
    }

    if (playerName) {
      const exact = players.find((player) => normalize(player.Name) === playerName);
      if (exact) return exact;

      const partial = players.find((player) => normalize(player.Name).includes(playerName));
      if (partial) return partial;
    }

    return null;
  }

  findKnownPlayer(players) {
    const primaryId = normalize(this.latestState.playerPrimaryId);
    const playerName = normalize(this.latestState.playerName);

    if (primaryId) {
      const byPrimaryId = players.find((player) => normalize(player.PrimaryId) === primaryId);
      if (byPrimaryId) return { ...byPrimaryId, bAutoDetectedKnown: true };
    }

    if (playerName) {
      const byName = players.find((player) => normalize(player.Name) === playerName);
      if (byName) return { ...byName, bAutoDetectedKnown: true };
    }

    return null;
  }

  findAutoDetectedPlayer(players, game) {
    const target = game && game.Target ? game.Target : null;

    if (target && target.Name && target.TeamNum !== null) {
      const byTarget = players.find((player) => {
        const sameName = normalize(player.Name) === normalize(target.Name);
        const sameShortcut = Number(player.Shortcut) === Number(target.Shortcut);
        const sameTeam = Number(player.TeamNum) === Number(target.TeamNum);
        return sameTeam && (sameName || sameShortcut);
      });

      return byTarget || {
        Name: target.Name,
        PrimaryId: "",
        Shortcut: target.Shortcut,
        TeamNum: target.TeamNum,
        bAutoDetectedFromTarget: true
      };
    }

    return null;
  }

  handleMatchEnded(data) {
    const game = normalizeGame(getField(data, "Game")) || this.latestState.game;
    const matchGuid = getField(data, "MatchGuid") || this.latestState.matchGuid || "";
    const winnerTeamNum = inferWinnerTeamNum(data, game) ?? this.latestState.winnerTeamNum;

    this.log("info", "MatchEnded recu", {
      matchGuid: matchGuid || null,
      winnerTeamNum,
      playerTeamNum: this.latestState.playerTeamNum,
      dataKeys: Object.keys(data || {})
    });

    if (!Number.isInteger(winnerTeamNum) || this.latestState.playerTeamNum === null) {
      this.log("warn", "Impossible de calculer WIN/LOSE: winner ou equipe joueur inconnus", {
        winnerTeamNum,
        playerTeamNum: this.latestState.playerTeamNum,
        playerName: this.config.playerName || null,
        primaryId: this.config.primaryId || null,
        manualTeamNum: this.config.manualTeamNum,
        matchEndedPayload: data || {}
      });
      return;
    }

    this.recordResolvedResult(matchGuid, winnerTeamNum, "match-ended", {
      ...data,
      MatchGuid: matchGuid,
      WinnerTeamNum: winnerTeamNum
    });
  }

  handleMatchDestroyed() {
    const fallback = this.inferDestroyedMatchResult();
    this.log("info", "MatchDestroyed recu", {
      matchGuid: this.latestState.matchGuid || null,
      playerTeamNum: this.latestState.playerTeamNum,
      score: `${this.getTeamScore(0)}-${this.getTeamScore(1)}`,
      fallback: fallback.ok ? "score" : fallback.reason
    });

    if (fallback.ok) {
      const fallbackKey = this.getProcessedMatchKey(fallback.matchGuid, fallback.winnerTeamNum);
      if (!this.processedMatchEnds.has(fallbackKey)) {
        this.log("info", "Resultat deduit sur MatchDestroyed", {
          matchGuid: fallback.matchGuid,
          winnerTeamNum: fallback.winnerTeamNum,
          playerTeamNum: this.latestState.playerTeamNum,
          score: `${fallback.blueScore}-${fallback.orangeScore}`
        });
      }
      this.recordResolvedResult(fallback.matchGuid, fallback.winnerTeamNum, "match-destroyed-score", {
        MatchGuid: fallback.matchGuid,
        WinnerTeamNum: fallback.winnerTeamNum,
        MatchDestroyedFallback: true
      });
    }

    this.clearMatchAfterDestroy();
    this.emitState();
  }

  clearMatchAfterDestroy() {
    this.latestState = {
      ...this.latestState,
      matchGuid: "",
      playerTeamNum: parseTeamNum(this.config.manualTeamNum),
      winnerTeamNum: null,
      resultEligible: false,
      maxPlayers: 0,
      playlistGuessReady: false,
      game: null,
      players: []
    };
  }

  inferDestroyedMatchResult() {
    const matchGuid = this.latestState.matchGuid || "";
    const playerTeamNum = parseTeamNum(this.latestState.playerTeamNum);
    const winnerTeamNum = parseTeamNum(this.latestState.winnerTeamNum);
    const blueScore = this.getTeamScore(0);
    const orangeScore = this.getTeamScore(1);

    if (!matchGuid) return { ok: false, reason: "no-match-guid" };
    if (playerTeamNum === null) return { ok: false, reason: "unknown-player-team" };
    if (winnerTeamNum !== null) return { ok: true, matchGuid, winnerTeamNum, blueScore, orangeScore };
    if (!this.latestState.teams || this.latestState.teams.length < 2) return { ok: false, reason: "missing-teams" };
    if (blueScore === orangeScore) return { ok: false, reason: "tied-score" };

    return {
      ok: true,
      matchGuid,
      winnerTeamNum: blueScore > orangeScore ? 0 : 1,
      blueScore,
      orangeScore
    };
  }

  recordResolvedResult(matchGuid, winnerTeamNum, source, sourceData = {}) {
    if (!this.latestState.resultEligible) {
      this.log("warn", "Resultat ignore: match deja termine avant le lancement de l'overlay", {
        matchGuid: matchGuid || null,
        winnerTeamNum,
        source
      });
      return false;
    }

    const key = this.getProcessedMatchKey(matchGuid, winnerTeamNum);
    if (this.processedMatchEnds.has(key)) {
      this.log("info", "Resultat deja traite, ignore", { matchGuid: matchGuid || null, winnerTeamNum, source });
      return false;
    }

    this.processedMatchEnds.add(key);
    if (this.processedMatchEnds.size > 100) {
      this.processedMatchEnds = new Set(Array.from(this.processedMatchEnds).slice(-50));
    }

    this.recordResult(winnerTeamNum === Number(this.latestState.playerTeamNum) ? "win" : "loss", {
      ...sourceData,
      MatchGuid: matchGuid,
      WinnerTeamNum: winnerTeamNum,
      ResultSource: source
    });
    return true;
  }

  getProcessedMatchKey(matchGuid, winnerTeamNum) {
    return matchGuid ? `match:${matchGuid}` : `anonymous:${Date.now()}:${winnerTeamNum}`;
  }

  recordResult(result, sourceData = {}) {
    const historyItem = {
      id: crypto.randomUUID(),
      result,
      at: new Date().toISOString(),
      matchGuid: sourceData.MatchGuid || this.latestState.matchGuid || "",
      winnerTeamNum: sourceData.WinnerTeamNum ?? null,
      playerTeamNum: this.latestState.playerTeamNum,
      score: `${this.getTeamScore(0)}-${this.getTeamScore(1)}`
    };

    if (result === "win") {
      this.session.wins += 1;
      this.session.streak = this.session.streak >= 0 ? this.session.streak + 1 : 1;
    } else if (result === "loss") {
      this.session.losses += 1;
      this.session.streak = this.session.streak <= 0 ? this.session.streak - 1 : -1;
    }

    this.session.lastResult = historyItem;
    this.session.history = [historyItem, ...this.session.history].slice(0, 30);
    writeJson(this.paths.sessionPath, this.session);
    this.log("info", result === "win" ? "Resultat WIN enregistre" : "Resultat LOSE enregistre", historyItem);

    this.emit("result", {
      result,
      session: this.session,
      latestState: this.latestState,
      durationMs: this.config.overlayDurationMs
    });
    this.emitState();
  }

  undoLastResult() {
    const last = this.session.history.shift();
    if (!last) return;

    if (last.result === "win") this.session.wins = Math.max(0, this.session.wins - 1);
    if (last.result === "loss") this.session.losses = Math.max(0, this.session.losses - 1);

    this.recomputeStreakFromHistory();
    this.session.lastResult = this.session.history[0] || null;
    writeJson(this.paths.sessionPath, this.session);
    this.log("info", "Dernier resultat annule", last);
    this.emitState();
  }

  recomputeStreakFromHistory() {
    let streak = 0;
    for (const item of this.session.history) {
      if (!item || !item.result) break;
      if (streak === 0) streak = item.result === "win" ? 1 : -1;
      else if (streak > 0 && item.result === "win") streak += 1;
      else if (streak < 0 && item.result === "loss") streak -= 1;
      else break;
    }
    this.session.streak = streak;
  }

  getTeamScore(teamNum) {
    return this.readScore(this.latestState.teams, teamNum);
  }

  readScore(teams, teamNum) {
    const team = teams.find((item) => Number(item.TeamNum) === teamNum);
    return team ? Number(team.Score || 0) : 0;
  }
}

function countTeamPlayers(players) {
  return players.filter((player) => player && (player.TeamNum === 0 || player.TeamNum === 1)).length;
}

function hasDisplayableRank(rank) {
  if (!rank || rank.status === "disabled") return false;
  if (rank.rating !== null && rank.rating !== undefined) return true;
  return rank.status === "missing" && Boolean(rank.tier);
}

module.exports = {
  AppState,
  DEFAULT_CONFIG
};
