const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// One request at a time, with separate drafts and fields ready to be saved.
export class CardAutosave {
  constructor(data, { persist, onStatus, onError, onSaved, delay = 1000 }) {
    this.persist = persist;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onSaved = onSaved;
    this.delay = delay;
    this.timers = new Map();
    this.ready = new Map();
    this.inFlightKeys = new Set();
    this.reset(data, false);
  }

  reset(data, notify = true) {
    this.clearTimers();
    this.ready.clear();
    const { version, ...fields } = data;
    this.version = version;
    this.saved = structuredClone(fields);
    this.draft = structuredClone(fields);
    this.paused = false;
    if (notify) this.onStatus("saved");
  }

  dirty() {
    return (
      !!this.flight ||
      Object.keys(this.draft).some(
        (key) => !equal(this.draft[key], this.saved[key]),
      )
    );
  }

  clearTimers() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  change(key, value, deferred = false) {
    this.draft[key] = structuredClone(value);
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.ready.delete(key);
    this.onStatus(this.paused ? "error" : "pending");
    if (deferred) {
      this.timers.set(
        key,
        setTimeout(() => this.finish(key), this.delay),
      );
    } else {
      this.finish(key);
    }
  }

  finish(key) {
    clearTimeout(this.timers.get(key));
    this.timers.delete(key);
    this.ready.set(key, structuredClone(this.draft[key]));
    return this.pump();
  }

  pump() {
    if (this.flight) return this.flight;
    if (this.paused || this.disposed) return Promise.resolve(false);
    if (!this.ready.size) return Promise.resolve(true);
    this.flight = Promise.resolve().then(async () => {
      try {
        while (this.ready.size && !this.disposed) {
          const fields = Object.fromEntries(
            [...this.ready].filter(
              ([key, value]) => !equal(value, this.saved[key]),
            ),
          );
          this.ready.clear();
          if (!Object.keys(fields).length) continue;
          this.inFlightKeys = new Set(Object.keys(fields));
          this.onStatus("saving");
          try {
            this.version = await this.persist(fields, this.version);
            Object.assign(this.saved, structuredClone(fields));
            if (!this.disposed) this.onSaved(this.version);
          } catch (error) {
            this.ready = new Map([...Object.entries(fields), ...this.ready]);
            this.paused = true;
            if (!this.disposed) this.onError(error);
            return false;
          } finally {
            this.inFlightKeys.clear();
          }
        }
        return !this.disposed;
      } finally {
        this.flight = null;
        if (!this.disposed)
          this.onStatus(
            this.paused ? "error" : this.dirty() ? "pending" : "saved",
          );
      }
    });
    return this.flight;
  }

  flush() {
    this.clearTimers();
    for (const key of Object.keys(this.draft)) {
      if (
        !equal(this.draft[key], this.saved[key]) ||
        this.inFlightKeys.has(key)
      ) {
        this.ready.set(key, structuredClone(this.draft[key]));
      }
    }
    return this.pump();
  }

  retry() {
    this.paused = false;
    return this.flush();
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
    this.ready.clear();
  }
}
