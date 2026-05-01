const path = require("path");

const rootDir = path.join(__dirname, "..");

module.exports = {
  rootDir,
  publicDir: path.join(rootDir, "public"),
  dataDir: path.join(rootDir, "data"),
  configPath: path.join(rootDir, "config.json"),
  exampleConfigPath: path.join(rootDir, "config.example.json"),
  sessionPath: path.join(rootDir, "data", "session.json"),
  logPath: path.join(rootDir, "data", "overlay.log")
};
