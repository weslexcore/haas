import type { SettingsStore } from "../core/services";

const PREFIX = "photo:";

/** Preferences in localStorage. Small and synchronous underneath; async so it can become IndexedDB or a server. */
export class LocalSettingsStore implements SettingsStore {
  async get<T>(key: string): Promise<T | undefined> {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw === null ? undefined : (JSON.parse(raw) as T);
    } catch {
      return undefined;
    }
  }

  async set<T>(key: string, value: T): Promise<void> {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    localStorage.removeItem(PREFIX + key);
  }
}

export class MemorySettingsStore implements SettingsStore {
  private data = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.data.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}
