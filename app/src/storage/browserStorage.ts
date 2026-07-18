import { normalizeStorageEstimate, type NormalizedStorageEstimate } from './metrics';

export interface BrowserStorageSnapshot extends NormalizedStorageEstimate {
  estimateSupported: boolean;
  persistenceSupported: boolean;
  /** null means that the state is unsupported or could not be read. */
  persisted: boolean | null;
}

function getStorageManager(): StorageManager | null {
  if (typeof navigator === 'undefined' || !navigator.storage) return null;
  return navigator.storage;
}

/** Read browser-origin quota and persistence without failing application startup. */
export async function readBrowserStorage(): Promise<BrowserStorageSnapshot> {
  const manager = getStorageManager();
  const estimateSupported = typeof manager?.estimate === 'function';
  const persistenceSupported = typeof manager?.persist === 'function';

  let estimate: StorageEstimate = {};
  if (manager && estimateSupported) {
    try {
      estimate = await manager.estimate();
    } catch {
      // Quota access may be denied in privacy-restricted contexts; render an unavailable state.
    }
  }

  let persisted: boolean | null = null;
  if (manager && typeof manager.persisted === 'function') {
    try {
      persisted = await manager.persisted();
    } catch {
      // Keep quota information usable even when the persistence state cannot be queried.
    }
  }

  return {
    ...normalizeStorageEstimate(estimate),
    estimateSupported,
    persistenceSupported,
    persisted,
  };
}

/**
 * Request persistent origin storage. Call this from a direct user action because some browsers
 * reject or ignore persistence requests that are not associated with a user gesture.
 */
export async function requestPersistentStorage(): Promise<boolean | null> {
  const manager = getStorageManager();
  if (typeof manager?.persist !== 'function') return null;
  return manager.persist();
}
