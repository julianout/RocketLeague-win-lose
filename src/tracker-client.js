const { getPlaylist } = require("./playlist");

const PROFILE_TTL_MS = 5 * 60 * 1000;
const ERROR_TTL_MS = 60 * 1000;

class TrackerClient {
  constructor({ log }) {
    this.log = log;
    this.profileCache = new Map();
  }

  async getPlaylistRank({ primaryId, playerName, playlistId }) {
    const playlist = getPlaylist(playlistId);
    const profileTarget = parsePrimaryId(primaryId, playerName);

    if (!playlist || !profileTarget) {
      return {
        status: "unavailable",
        playlistId: playlist ? playlist.id : null,
        playlistName: playlist ? playlist.label : "Mode inconnu",
        playlistShort: playlist ? playlist.short : "MMR",
        rating: null,
        tier: "",
        division: "",
        error: "missing-player-or-playlist",
        updatedAt: new Date().toISOString()
      };
    }

    try {
      const profile = await this.getProfile(profileTarget);
      const rank = profile.playlists[playlist.id];

      if (!rank) {
        return {
          status: "missing",
          playlistId: playlist.id,
          playlistName: playlist.label,
          playlistShort: playlist.short,
          rating: null,
          tier: "Unranked",
          division: "",
          error: null,
          updatedAt: profile.updatedAt
        };
      }

      return {
        status: "ready",
        playlistId: playlist.id,
        playlistName: playlist.label,
        playlistShort: playlist.short,
        rating: rank.rating,
        tier: rank.tier,
        division: rank.division,
        matchesPlayed: rank.matchesPlayed,
        error: null,
        updatedAt: profile.updatedAt
      };
    } catch (error) {
      return {
        status: "error",
        playlistId: playlist.id,
        playlistName: playlist.label,
        playlistShort: playlist.short,
        rating: null,
        tier: "",
        division: "",
        error: error && error.message ? error.message : String(error),
        updatedAt: new Date().toISOString()
      };
    }
  }

  async getProfile(profileTarget) {
    const key = `${profileTarget.slug}:${profileTarget.target}`;
    const cached = this.profileCache.get(key);
    const now = Date.now();

    if (cached && cached.expiresAt > now) {
      if (cached.promise) return cached.promise;
      if (cached.error) throw cached.error;
      return cached.value;
    }

    const promise = fetchTrackerProfile(profileTarget)
      .then((value) => {
        this.profileCache.set(key, {
          value,
          error: null,
          promise: null,
          expiresAt: Date.now() + PROFILE_TTL_MS
        });
        return value;
      })
      .catch((error) => {
        this.profileCache.set(key, {
          value: null,
          error,
          promise: null,
          expiresAt: Date.now() + ERROR_TTL_MS
        });
        throw error;
      });

    this.profileCache.set(key, {
      value: null,
      error: null,
      promise,
      expiresAt: now + ERROR_TTL_MS
    });

    return promise;
  }
}

function parsePrimaryId(primaryId, playerName) {
  if (!primaryId || !String(primaryId).includes("|")) return null;

  const [platformRaw, id] = String(primaryId).split("|");
  const platform = String(platformRaw || "").toLowerCase();
  const slugByPlatform = {
    steam: "steam",
    epic: "epic",
    xboxone: "xbl",
    xbl: "xbl",
    ps4: "psn",
    psn: "psn",
    switch: "switch"
  };
  const slug = slugByPlatform[platform];
  if (!slug) return null;

  const target = slug === "steam" ? id : playerName;
  if (!target) return null;

  return { slug, target: String(target) };
}

function fetchTrackerProfile(profileTarget) {
  const encodedTarget = encodeURIComponent(profileTarget.target);
  const url = `https://api.tracker.gg/api/v2/rocket-league/standard/profile/${profileTarget.slug}/${encodedTarget}`;

  return requestJson(url).then((payload) => {
    const data = payload && payload.data;
    if (!data || typeof data !== "object") throw new Error("Tracker profile missing data");

    return {
      player: data.platformInfo || {},
      playlists: parseTrackerPlaylists(data.segments || []),
      updatedAt: new Date().toISOString()
    };
  });
}

async function requestJson(url) {
  if (typeof fetch !== "function") {
    throw new Error("Node.js fetch indisponible");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      },
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`Tracker HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") throw new Error("Tracker timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function parseTrackerPlaylists(segments) {
  const playlists = {};

  for (const segment of segments) {
    if (!segment || segment.type !== "playlist") continue;
    const playlistId = Number(segment.attributes && segment.attributes.playlistId);
    if (!Number.isInteger(playlistId)) continue;

    const stats = segment.stats || {};
    playlists[playlistId] = {
      rating: readStatValue(stats.rating),
      tier: readStatName(stats.tier) || "Unranked",
      division: readStatName(stats.division) || "",
      matchesPlayed: readStatValue(stats.matchesPlayed)
    };
  }

  return playlists;
}

function readStatValue(stat) {
  const value = stat && stat.value;
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function readStatName(stat) {
  return stat && stat.metadata && stat.metadata.name ? String(stat.metadata.name) : "";
}

module.exports = {
  TrackerClient,
  parsePrimaryId,
  parseTrackerPlaylists
};
