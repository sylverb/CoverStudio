// rate-limiter.js — proactive per-minute throttling (sliding 60s window)

// Sleep that rejects immediately if the signal is aborted.
function abortableSleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(resolve, ms);
    if (signal) {
      signal.addEventListener(
        "abort",
        () => { clearTimeout(id); reject(new DOMException("Aborted", "AbortError")); },
        { once: true }
      );
    }
  });
}

export class RateLimiter {
  constructor(maxPerMin) {
    this.max = Math.max(1, maxPerMin | 0);
    this.calls = [];
  }

  async acquire(signal) {
    while (true) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const now = Date.now();
      this.calls = this.calls.filter((t) => now - t < 60000);
      if (this.calls.length < this.max) {
        this.calls.push(Date.now());
        return;
      }
      await abortableSleep(Math.min(60000 - (now - this.calls[0]), 60000), signal);
    }
  }
}
