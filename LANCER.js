const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rootDir = __dirname;
const isWindows = process.platform === "win32";

process.chdir(rootDir);

console.log("");
console.log("Rocket League Win/Lose Overlay");
console.log("");

if (!commandExists("node")) {
  console.error("Node.js n'est pas installe. Installe Node.js LTS puis relance ce fichier.");
  console.error("https://nodejs.org/");
  waitBeforeExit(1);
}

if (!fs.existsSync(path.join(rootDir, "node_modules"))) {
  console.log("Installation des dependances...");
  run("npm", ["install"]);
}

openUrl("http://localhost:5177/control.html");

console.log("Overlay OBS lance.");
console.log("Panneau: http://localhost:5177/control.html");
console.log("OBS:     http://localhost:5177/overlay.html");
console.log("");
console.log("Laisse cette fenetre ouverte pendant que tu joues.");
console.log("Ctrl+C pour arreter.");
console.log("");

const server = spawn("node", ["server.js"], {
  cwd: rootDir,
  stdio: "inherit",
  shell: isWindows
});

server.on("exit", (code) => {
  process.exit(code || 0);
});

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: "inherit",
    shell: isWindows
  });

  if (result.status !== 0) {
    console.error("");
    console.error(`Echec: ${command} ${args.join(" ")}`);
    waitBeforeExit(result.status || 1);
  }
}

function commandExists(command) {
  const result = spawnSync(isWindows ? "where" : "command", isWindows ? [command] : ["-v", command], {
    stdio: "ignore",
    shell: isWindows
  });
  return result.status === 0;
}

function openUrl(url) {
  if (isWindows) {
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }

  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

function waitBeforeExit(code) {
  if (!isWindows) process.exit(code);

  console.log("");
  console.log("Appuie sur Entree pour fermer.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(code));
}
