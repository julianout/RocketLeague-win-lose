const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { AppState } = require("../src/app-state");
const { JsonObjectStream } = require("../src/json-stream");
const { StatsClient } = require("../src/stats-client");

run();

function run() {
  testJsonObjectStream();
  testStatsEndpointParsing();
  withQuietConsole(() => testAppStateResultFlow());
  withQuietConsole(() => testAlreadyEndedMatchIsIgnored());
  withQuietConsole(() => testLifecycleEventMakesMatchEligible());
  console.log("smoke tests OK");
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



function makeUpdateState({ matchGuid, playerTeam, blueScore, orangeScore, winnerTeamNum = null }) {
  return JSON.stringify({
    Event: "UpdateState",
    Data: JSON.stringify({
      MatchGuid: matchGuid,
      WinnerTeamNum: winnerTeamNum,
      Players: [
        {
          Name: "PlayerOne",
          PrimaryId: "Steam|00000000000000000|0",
          Shortcut: 5,
          TeamNum: playerTeam,
          Score: 42
        }
      ],
      Game: {
        Teams: [
          { Name: "Blue", TeamNum: 0, Score: blueScore },
          { Name: "Orange", TeamNum: 1, Score: orangeScore }
        ],
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
