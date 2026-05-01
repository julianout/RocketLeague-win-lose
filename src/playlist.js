const { getField, normalize } = require("./utils");

const PLAYLISTS = {
  0: { id: 0, short: "CAS", label: "Casual" },
  10: { id: 10, short: "1V1", label: "Ranked Duel 1v1" },
  11: { id: 11, short: "2V2", label: "Ranked Doubles 2v2" },
  13: { id: 13, short: "3V3", label: "Ranked Standard 3v3" },
  27: { id: 27, short: "HPS", label: "Hoops" },
  28: { id: 28, short: "RMB", label: "Rumble" },
  29: { id: 29, short: "DRP", label: "Dropshot" },
  30: { id: 30, short: "SNW", label: "Snowday" },
  34: { id: 34, short: "TRN", label: "Tournament" },
  61: { id: 61, short: "4V4", label: "Ranked 4v4" },
  63: { id: 63, short: "HSK", label: "Heatseeker" }
};

function normalizeRankPlaylistId(value) {
  if (value === null || value === undefined || value === "" || normalize(value) === "auto") return "auto";
  const numeric = Number(value);
  return PLAYLISTS[numeric] ? numeric : "auto";
}

function getPlaylist(value) {
  const id = Number(value);
  return PLAYLISTS[id] || null;
}

function createUnknownPlaylist(overrides = {}) {
  return {
    id: null,
    short: "MMR",
    label: "Mode inconnu",
    source: "unknown",
    confidence: "unknown",
    ...overrides
  };
}

function inferPlaylist({ data, game, players, maxPlayers, configuredPlaylistId, allowPlayerCountGuess = true }) {
  const configured = normalizeRankPlaylistId(configuredPlaylistId);
  if (configured !== "auto") return withSource(getPlaylist(configured), "manual", "exact");

  const exactId = readPlaylistId(data) ?? readPlaylistId(game);
  if (exactId !== null) return withSource(getPlaylist(exactId), "stats-api", "exact");

  const namedId = readPlaylistName(data) ?? readPlaylistName(game);
  if (namedId !== null) return withSource(getPlaylist(namedId), "stats-api-name", "exact");

  if (!allowPlayerCountGuess) {
    return createUnknownPlaylist({
      source: "waiting-for-start",
      confidence: "pending"
    });
  }

  const inferredId = inferPlaylistFromPlayerCount(maxPlayers || (players ? players.length : 0));
  if (inferredId !== null) return withSource(getPlaylist(inferredId), "player-count", "guess");

  return createUnknownPlaylist();
}

function withSource(playlist, source, confidence) {
  if (!playlist) return createUnknownPlaylist();
  return {
    ...playlist,
    source,
    confidence
  };
}

function readPlaylistId(source) {
  const raw = getField(
    source,
    "PlaylistId",
    "PlaylistID",
    "Playlist",
    "OnlinePlaylistId",
    "OnlinePlaylistID",
    "GamePlaylistId",
    "GamePlaylistID",
    "PlaylistNum",
    "GameModeId"
  );
  const id = Number(raw);
  return PLAYLISTS[id] ? id : null;
}

function readPlaylistName(source) {
  const value = normalize(getField(source, "PlaylistName", "GameMode", "GameModeName", "Mode", "MatchType"));
  if (!value) return null;

  if (value.includes("casual") || value.includes("unranked")) return 0;
  if (value.includes("duel") || value.includes("1v1")) return 10;
  if (value.includes("double") || value.includes("2v2")) return 11;
  if (value.includes("standard") || value.includes("3v3")) return 13;
  if (value.includes("hoop")) return 27;
  if (value.includes("rumble")) return 28;
  if (value.includes("drop")) return 29;
  if (value.includes("snow")) return 30;
  if (value.includes("tournament")) return 34;
  if (value.includes("4v4") || value.includes("quad")) return 61;
  if (value.includes("heat")) return 63;

  return null;
}

function inferPlaylistFromPlayerCount(playerCount) {
  if (playerCount === 2) return 10;
  if (playerCount === 4) return 11;
  if (playerCount === 6) return 13;
  if (playerCount === 8) return 61;
  return null;
}

module.exports = {
  PLAYLISTS,
  getPlaylist,
  inferPlaylist,
  normalizeRankPlaylistId
};
