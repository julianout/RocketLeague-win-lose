const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AppState } = require("../src/app-state");
const { JsonObjectStream } = require("../src/json-stream");
const { inferPlaylist } = require("../src/playlist");
const { StatsClient } = require("../src/stats-client");
const { parseTrackerPlaylists } = require("../src/tracker-client");

run();

function run() {
  testJsonObjectStream();
  testStatsEndpointParsing();
  testPlaylistInference();
  testTrackerPlaylistParsing();
  withQuietConsole(() => testAppStateResultFlow());
  withQuietConsole(() => testAppStateRankLookupFlow());
  withQuietConsole(() => testRankLookupWaitsForStartedMatch());
  withQuietConsole(() => testRankPersistsDuringIncompleteState());
  withQuietConsole(() => testRankPersistsBetweenMatches());
  withQuietConsole(() => testAutoDetectionIgnoresSingleUnknownPlayer());
  withQuietConsole(() => testAlreadyEndedMatchIsIgnored());
  withQuietConsole(() => testLifecycleEventMakesMatchEligible());
  console.log("smoke tests OK");
}

function testAppStateRankLookupFlow() {
  withTempPaths((paths) => {
    fs.writeFileSync(paths.configPath, JSON.stringify({
      statsApiUrl: "tcp://127.0.0.1:49123",
      playerName: "PlayerOne"
    }));
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    let lookup = null;
    appState.on("rankLookup", (request) => {
      lookup = request;
    });

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchInitialized",
      Data: { MatchGuid: "rank-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "rank-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 4
    }));

    assert.ok(lookup);
    assert.strictEqual(lookup.playlist.id, 11);
    assert.strictEqual(appState.latestState.playlist.source, "player-count");
    assert.strictEqual(appState.latestState.rank.status, "loading");

    appState.applyRankResult(lookup.signature, {
      status: "ready",
      playlistId: 11,
      playlistName: "Ranked Doubles 2v2",
      playlistShort: "2V2",
      rating: 1440,
      tier: "Grand Champion I",
      division: "Division I",
      updatedAt: new Date().toISOString(),
      error: null
    });

    assert.strictEqual(appState.latestState.rank.rating, 1440);
  });
}

function testRankLookupWaitsForStartedMatch() {
  withTempPaths((paths) => {
    fs.writeFileSync(paths.configPath, JSON.stringify({
      statsApiUrl: "tcp://127.0.0.1:49123",
      playerName: "PlayerOne"
    }));
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    let lookup = null;
    appState.on("rankLookup", (request) => {
      lookup = request;
    });

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchCreated",
      Data: { MatchGuid: "filling-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "filling-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 2
    }));

    assert.strictEqual(lookup, null);
    assert.strictEqual(appState.latestState.playlist.id, null);
    assert.strictEqual(appState.latestState.playlist.source, "waiting-for-start");

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchInitialized",
      Data: { MatchGuid: "filling-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "filling-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 6
    }));

    assert.ok(lookup);
    assert.strictEqual(lookup.playlist.id, 13);
    assert.strictEqual(appState.latestState.playlist.source, "player-count");
  });
}

function testRankPersistsDuringIncompleteState() {
  withTempPaths((paths) => {
    fs.writeFileSync(paths.configPath, JSON.stringify({
      statsApiUrl: "tcp://127.0.0.1:49123",
      playerName: "PlayerOne"
    }));
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    let lookup = null;
    appState.on("rankLookup", (request) => {
      lookup = request;
    });

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchInitialized",
      Data: { MatchGuid: "incomplete-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "incomplete-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 6
    }));

    appState.applyRankResult(lookup.signature, {
      status: "ready",
      playlistId: 13,
      playlistName: "Ranked Standard 3v3",
      playlistShort: "3V3",
      rating: 1233,
      tier: "Champion II",
      division: "Division II",
      updatedAt: new Date().toISOString(),
      error: null
    });

    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "incomplete-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 1,
      playerCount: 0
    }));

    assert.strictEqual(appState.latestState.playerName, "PlayerOne");
    assert.strictEqual(appState.latestState.playerPrimaryId, "Steam|00000000000000000|0");
    assert.strictEqual(appState.latestState.rank.rating, 1233);
    assert.strictEqual(appState.latestState.rank.playlistShort, "3V3");
  });
}

function testRankPersistsBetweenMatches() {
  withTempPaths((paths) => {
    fs.writeFileSync(paths.configPath, JSON.stringify({
      statsApiUrl: "tcp://127.0.0.1:49123",
      playerName: "PlayerOne"
    }));
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    let lookup = null;
    appState.on("rankLookup", (request) => {
      lookup = request;
    });

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchInitialized",
      Data: { MatchGuid: "ranked-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "ranked-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 6
    }));
    appState.applyRankResult(lookup.signature, {
      status: "ready",
      playlistId: 13,
      playlistName: "Ranked Standard 3v3",
      playlistShort: "3V3",
      rating: 1245,
      tier: "Champion II",
      division: "Division II",
      updatedAt: new Date().toISOString(),
      error: null
    });

    appState.handleStatsMessage(JSON.stringify({ Event: "MatchDestroyed", Data: {} }));
    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchCreated",
      Data: { MatchGuid: "next-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "next-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 0
    }));

    assert.strictEqual(appState.latestState.rank.rating, 1245);
    assert.strictEqual(appState.latestState.rank.playlistShort, "3V3");
    assert.strictEqual(appState.latestState.rank.stale, true);
  });
}

function testAutoDetectionIgnoresSingleUnknownPlayer() {
  withTempPaths((paths) => {
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchCreated",
      Data: { MatchGuid: "auto-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "auto-match",
      playerTeam: 0,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 1,
      playerName: "OtherPlayer",
      primaryId: "Epic|other-player|0",
      includeTarget: false
    }));

    assert.strictEqual(appState.latestState.playerName, "");
    assert.strictEqual(appState.latestState.playerPrimaryId, "");
    assert.strictEqual(appState.logger.items.some((item) => item.message.includes("Auto-detection impossible")), false);

    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "auto-match",
      playerTeam: 1,
      blueScore: 0,
      orangeScore: 0,
      playerCount: 2
    }));

    assert.strictEqual(appState.latestState.playerName, "PlayerOne");
    assert.strictEqual(appState.latestState.playerPrimaryId, "Steam|00000000000000000|0");
  });
}

function testPlaylistInference() {
  assert.strictEqual(inferPlaylist({
    data: { PlaylistId: 11 },
    game: {},
    players: [],
    maxPlayers: 0,
    configuredPlaylistId: "auto"
  }).id, 11);

  const guessed = inferPlaylist({
    data: {},
    game: {},
    players: [{}, {}, {}, {}],
    maxPlayers: 4,
    configuredPlaylistId: "auto"
  });
  assert.strictEqual(guessed.id, 11);
  assert.strictEqual(guessed.source, "player-count");

  const pending = inferPlaylist({
    data: {},
    game: {},
    players: [{}, {}, {}, {}],
    maxPlayers: 4,
    configuredPlaylistId: "auto",
    allowPlayerCountGuess: false
  });
  assert.strictEqual(pending.id, null);
  assert.strictEqual(pending.source, "waiting-for-start");

  assert.strictEqual(inferPlaylist({
    data: {},
    game: {},
    players: [],
    maxPlayers: 0,
    configuredPlaylistId: 13
  }).id, 13);
}

function testTrackerPlaylistParsing() {
  const parsed = parseTrackerPlaylists([
    {
      type: "playlist",
      attributes: { playlistId: 11 },
      stats: {
        rating: { value: 1440 },
        tier: { metadata: { name: "Grand Champion I" } },
        division: { metadata: { name: "Division I" } },
        matchesPlayed: { value: 21 }
      }
    }
  ]);

  assert.strictEqual(parsed[11].rating, 1440);
  assert.strictEqual(parsed[11].tier, "Grand Champion I");
  assert.strictEqual(parsed[11].division, "Division I");
}

function testJsonObjectStream() {
  const stream = new JsonObjectStream({ maxBufferBytes: 80 });

  assert.deepStrictEqual(stream.push(Buffer.from("noise")).messages, []);
  assert.deepStrictEqual(stream.push(Buffer.from('{"a":1}{"b":"{still string}"}')).messages, [
    '{"a":1}',
    '{"b":"{still string}"}'
  ]);

  assert.deepStrictEqual(stream.push(Buffer.from('{"split":')).messages, []);
  assert.deepStrictEqual(stream.push(Buffer.from('true}')).messages, ['{"split":true}']);

  const overflow = stream.push(Buffer.from(`{"tooLarge":"${"x".repeat(100)}`)).overflow;
  assert.ok(overflow.bytes > 80);
  assert.strictEqual(stream.buffer, "");
}

function testStatsEndpointParsing() {
  const cases = [
    ["tcp://127.0.0.1:49123", { host: "127.0.0.1", port: 49123 }],
    ["ws://127.0.0.1:49123", { host: "127.0.0.1", port: 49123 }],
    ["127.0.0.1:49123", { host: "127.0.0.1", port: 49123 }],
    ["49124", { host: "127.0.0.1", port: 49124 }]
  ];

  for (const [url, expected] of cases) {
    const client = new StatsClient({
      getUrl: () => url,
      onMessage: () => {},
      log: () => {},
      emitState: () => {}
    });
    assert.deepStrictEqual(client.getEndpoint(), expected);
  }
}

function testAppStateResultFlow() {
  withTempPaths((paths) => {
    fs.writeFileSync(paths.configPath, JSON.stringify({ statsApiUrl: "ws://127.0.0.1:49123" }));

    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    assert.strictEqual(appState.config.statsApiUrl, "tcp://127.0.0.1:49123");

    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "ff-match",
      playerTeam: 1,
      blueScore: 2,
      orangeScore: 0
    }));
    assert.strictEqual(appState.latestState.playerName, "PlayerOne");
    assert.strictEqual(appState.latestState.playerTeamNum, 1);

    appState.handleStatsMessage(JSON.stringify({ Event: "MatchDestroyed", Data: {} }));
    assert.strictEqual(appState.session.wins, 0);
    assert.strictEqual(appState.session.losses, 1);
    assert.strictEqual(appState.session.streak, -1);

    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "win-match",
      playerTeam: 1,
      blueScore: 1,
      orangeScore: 3
    }));
    appState.handleStatsMessage(JSON.stringify({
      Event: "MatchEnded",
      Data: {
        MatchGuid: "win-match",
        WinnerTeamNum: 1
      }
    }));

    assert.strictEqual(appState.session.wins, 1);
    assert.strictEqual(appState.session.losses, 1);
    assert.strictEqual(appState.session.streak, 1);
    assert.strictEqual(appState.session.history[0].result, "win");
  });
}

function testAlreadyEndedMatchIsIgnored() {
  withTempPaths((paths) => {
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "stale-ended-match",
      playerTeam: 1,
      blueScore: 2,
      orangeScore: 5,
      winnerTeamNum: 1
    }));
    appState.handleStatsMessage(JSON.stringify({ Event: "MatchDestroyed", Data: {} }));

    assert.strictEqual(appState.session.wins, 0);
    assert.strictEqual(appState.session.losses, 0);
    assert.strictEqual(appState.session.history.length, 0);
  });
}

function testLifecycleEventMakesMatchEligible() {
  withTempPaths((paths) => {
    const appState = new AppState(paths);
    appState.setStatsStatusProvider(() => ({ connection: "connected", connectionMode: "tcp" }));

    appState.handleStatsMessage(JSON.stringify({
      Event: "RoundStarted",
      Data: { MatchGuid: "live-match" }
    }));
    appState.handleStatsMessage(makeUpdateState({
      matchGuid: "live-match",
      playerTeam: 1,
      blueScore: 1,
      orangeScore: 2,
      winnerTeamNum: 1
    }));
    appState.handleStatsMessage(JSON.stringify({ Event: "MatchDestroyed", Data: {} }));

    assert.strictEqual(appState.session.wins, 1);
    assert.strictEqual(appState.session.losses, 0);
    assert.strictEqual(appState.session.history.length, 1);
  });
}



function makeUpdateState({
  matchGuid,
  playerTeam,
  blueScore,
  orangeScore,
  winnerTeamNum = null,
  playerCount = 1,
  playerName = "PlayerOne",
  primaryId = "Steam|00000000000000000|0",
  includeTarget = true
}) {
  const players = [];

  if (playerCount > 0) {
    players.push({
      Name: playerName,
      PrimaryId: primaryId,
      Shortcut: 5,
      TeamNum: playerTeam,
      Score: 42
    });
  }

  for (let index = 1; index < playerCount; index += 1) {
    players.push({
      Name: `Player${index + 1}`,
      PrimaryId: `Epic|test-player-${index}|0`,
      Shortcut: index + 1,
      TeamNum: index % 2,
      Score: 0
    });
  }

  const target = includeTarget && players[0]
    ? {
      Name: players[0].Name,
      PrimaryId: players[0].PrimaryId,
      Shortcut: players[0].Shortcut,
      TeamNum: players[0].TeamNum
    }
    : null;

  return JSON.stringify({
    Event: "UpdateState",
    Data: JSON.stringify({
      MatchGuid: matchGuid,
      WinnerTeamNum: winnerTeamNum,
      Players: players,
      Game: {
        Teams: [
          { Name: "Blue", TeamNum: 0, Score: blueScore },
          { Name: "Orange", TeamNum: 1, Score: orangeScore }
        ],
        Target: target,
        bHasTarget: Boolean(target),
        bHasWinner: false,
        Winner: ""
      }
    })
  });
}

function withTempPaths(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rl-overlay-"));
  const paths = {
    rootDir: root,
    publicDir: path.join(root, "public"),
    dataDir: path.join(root, "data"),
    configPath: path.join(root, "config.json"),
    exampleConfigPath: path.join(root, "config.example.json"),
    sessionPath: path.join(root, "data", "session.json"),
    logPath: path.join(root, "data", "overlay.log")
  };

  fs.mkdirSync(paths.publicDir, { recursive: true });
  fs.mkdirSync(paths.dataDir, { recursive: true });
  fs.writeFileSync(paths.exampleConfigPath, JSON.stringify({ statsApiUrl: "tcp://127.0.0.1:49123" }));

  try {
    callback(paths);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function withQuietConsole(callback) {
  const originalLog = console.log;
  console.log = () => {};

  try {
    callback();
  } finally {
    console.log = originalLog;
  }
}
