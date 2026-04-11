import '@testing-library/jest-dom/vitest';

// ── localStorage / sessionStorage mock ────────────────────────────────────────
// Vitest 4 + JSDOM 29 can emit a `--localstorage-file` warning that leaves the
// Storage API in a non-functional state (clear/setItem become undefined).
// Providing a reliable in-memory implementation here fixes the issue globally
// without breaking any test that relies on actual storage behaviour.

const createStorageMock = () => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string): string | null => key in store ? store[key] : null,
    setItem: (key: string, value: string): void => { store[key] = String(value); },
    removeItem: (key: string): void => { delete store[key]; },
    clear: (): void => { store = {}; },
    key: (index: number): string | null => Object.keys(store)[index] ?? null,
    get length(): number { return Object.keys(store).length; },
  };
};

Object.defineProperty(global, 'localStorage', {
  value: createStorageMock(),
  writable: true,
});

Object.defineProperty(global, 'sessionStorage', {
  value: createStorageMock(),
  writable: true,
});
