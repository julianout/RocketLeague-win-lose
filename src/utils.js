const fs = require("fs");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function normalize(value) {
  if (value === null || value === undefined) return "";
  return String(value).trim().toLowerCase();
}

function parseTeamNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const teamNum = Number(value);
  return teamNum === 0 || teamNum === 1 ? teamNum : null;
}

function getField(source, ...names) {
  if (!source || typeof source !== "object") return undefined;

  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(source, name)) return source[name];
  }

  const requested = names.map((name) => String(name).toLowerCase());
  const actualKey = Object.keys(source).find((key) => requested.includes(key.toLowerCase()));
  return actualKey ? source[actualKey] : undefined;
}

function parseJsonString(value) {
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;

  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.trim().toLowerCase() === "true";
  return Boolean(value);
}

function asObject(value) {
  const parsed = parseJsonString(value);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
}

function getArrayField(source, ...names) {
  const value = getField(source, ...names);
  return Array.isArray(value) ? value : [];
}

function normalizePlayer(rawPlayer) {
  if (!rawPlayer || typeof rawPlayer !== "object") return null;
  return {
    ...rawPlayer,
    Name: getField(rawPlayer, "Name") || "",
    PrimaryId: getField(rawPlayer, "PrimaryId") || "",
    Shortcut: getField(rawPlayer, "Shortcut"),
    TeamNum: parseTeamNum(getField(rawPlayer, "TeamNum"))
  };
}

function normalizeTeam(rawTeam) {
  if (!rawTeam || typeof rawTeam !== "object") return null;
  return {
    ...rawTeam,
    Name: getField(rawTeam, "Name") || "",
    TeamNum: parseTeamNum(getField(rawTeam, "TeamNum")),
    Score: Number(getField(rawTeam, "Score") || 0),
    ColorPrimary: getField(rawTeam, "ColorPrimary") || "",
    ColorSecondary: getField(rawTeam, "ColorSecondary") || ""
  };
}

function normalizeGame(rawGame) {
  if (!rawGame || typeof rawGame !== "object") return null;
  return {
    ...rawGame,
    Teams: getArrayField(rawGame, "Teams").map(normalizeTeam).filter(Boolean),
    Target: normalizePlayer(getField(rawGame, "Target")),
    Winner: getField(rawGame, "Winner") || "",
    WinnerTeamNum: parseTeamNum(getField(rawGame, "WinnerTeamNum")),
    bHasWinner: parseBoolean(getField(rawGame, "bHasWinner")),
    bHasTarget: parseBoolean(getField(rawGame, "bHasTarget"))
  };
}

function inferWinnerTeamNum(data, game) {
  const direct = parseTeamNum(getField(data, "WinnerTeamNum"));
  if (direct !== null) return direct;

  const gameDirect = parseTeamNum(getField(game, "WinnerTeamNum"));
  if (gameDirect !== null) return gameDirect;

  const winnerName = normalize(getField(data, "Winner") || getField(game, "Winner"));
  if (winnerName === "blue" || winnerName === "bleu") return 0;
  if (winnerName === "orange") return 1;
  return null;
}

function safePreview(value, maxLength = 1200) {
  try {
    return JSON.stringify(value).slice(0, maxLength);
  } catch {
    return String(value).slice(0, maxLength);
  }
}

module.exports = {
  asObject,
  getArrayField,
  getField,
  inferWinnerTeamNum,
  normalize,
  normalizeGame,
  normalizePlayer,
  parseBoolean,
  parseJsonString,
  parseTeamNum,
  readJson,
  safePreview,
  writeJson
};
