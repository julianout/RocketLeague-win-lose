const fs = require("fs");

class Logger {
  constructor(logPath, onLog) {
    this.logPath = logPath;
    this.onLog = onLog;
    this.items = [];
  }

  add(level, message, details = {}) {
    const item = {
      at: new Date().toISOString(),
      level,
      message,
      details
    };

    this.items = [item, ...this.items].slice(0, 200);
    this.writeLine(item);
    this.onLog(item);
    return item;
  }

  clear() {
    this.items = [];
    try {
      fs.writeFileSync(this.logPath, "");
    } catch {
      // Logging should never break the dashboard.
    }
    this.add("info", "Logs effaces");
  }

  writeLine(item) {
    const details = Object.keys(item.details).length ? ` ${JSON.stringify(item.details)}` : "";
    const line = `[${item.at}] ${item.level.toUpperCase()} ${item.message}${details}\n`;
    fs.appendFile(this.logPath, line, () => {});
    console.log(line.trim());
  }
}

module.exports = { Logger };
