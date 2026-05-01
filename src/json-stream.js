class JsonObjectStream {
  constructor({ maxBufferBytes = 500000 } = {}) {
    this.buffer = "";
    this.maxBufferBytes = maxBufferBytes;
  }

  push(chunk) {
    this.buffer += chunk.toString("utf8");
    const messages = this.extract();
    const overflow = this.buffer.length > this.maxBufferBytes;

    if (overflow) {
      const preview = this.buffer.slice(0, 120);
      const bytes = this.buffer.length;
      this.buffer = "";
      return { messages, overflow: { bytes, preview } };
    }

    return { messages, overflow: null };
  }

  extract() {
    const messages = [];
    let cursor = 0;
    let depth = 0;
    let start = -1;
    let inString = false;
    let escaped = false;

    for (let index = 0; index < this.buffer.length; index += 1) {
      const char = this.buffer[index];

      if (start === -1 && char !== "{") {
        cursor = index + 1;
        continue;
      }

      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === "\"") inString = false;
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{") {
        if (depth === 0) start = index;
        depth += 1;
        continue;
      }

      if (char === "}") {
        depth -= 1;
        if (depth === 0 && start !== -1) {
          messages.push(this.buffer.slice(start, index + 1));
          cursor = index + 1;
          start = -1;
        } else if (depth < 0) {
          depth = 0;
          start = -1;
          cursor = index + 1;
        }
      }
    }

    if (cursor > 0) this.buffer = this.buffer.slice(cursor);
    return messages;
  }

  reset() {
    this.buffer = "";
  }
}

module.exports = { JsonObjectStream };
