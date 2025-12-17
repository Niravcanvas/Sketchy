import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * jsdom (unlike real browsers) doesn't implement ResizeObserver, but
 * `<Sketch>` (src/components/sketch/sketch.tsx) uses it to redraw when its
 * parent resizes. Stub a no-op implementation so components that render
 * `<Sketch>` can mount under vitest + jsdom.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

/**
 * Node 22+ ships its own (Web Storage API) `localStorage` global, and once
 * Vitest's jsdom environment merges `window` into `globalThis` it wins over
 * jsdom's own implementation — but it's non-functional without a
 * `--localstorage-file` flag (every method is `undefined`). `session-store`
 * (src/stores/session-store.ts) needs a real, working `localStorage` to
 * persist the guest session against, so swap in a small in-memory
 * implementation whenever the ambient one isn't actually usable.
 */
class MemoryStorage implements Storage {
  #data = new Map<string, string>();

  get length(): number {
    return this.#data.size;
  }

  clear(): void {
    this.#data.clear();
  }

  getItem(key: string): string | null {
    return this.#data.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#data.set(key, String(value));
  }
}

if (typeof globalThis.localStorage?.setItem !== 'function') {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}

/**
 * `test.globals` is off (conventions.md prefers explicit imports over
 * ambient test globals), so testing-library's automatic per-test `cleanup()`
 * — which only self-registers when it detects a global `afterEach` — never
 * fires. Register it explicitly so DOM from one test doesn't leak into the next.
 */
afterEach(() => {
  cleanup();
});
