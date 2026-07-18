export type RuntimeIsolationStatus =
  | 'active'
  | 'installing'
  | 'unavailable'
  | 'failed'
  | 'update'
  | 'reload';

const STATUS_EVENT = 'scan2fem-runtime-status';
const READY_TIMEOUT_MS = 15_000;
let waitingRegistration: ServiceWorkerRegistration | null = null;
let reloadForRequestedUpdate = false;
let reloadRequired = false;
let setupState: 'idle' | 'installing' | 'failed' = 'idle';
let registrationStarted = false;

function emitStatus(): void {
  window.dispatchEvent(new Event(STATUS_EVENT));
}

function waitForServiceWorkerReady(timeoutMs: number): Promise<ServiceWorkerRegistration> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error('Service Worker activation timed out')),
      timeoutMs,
    );
    navigator.serviceWorker.ready.then(
      (registration) => {
        window.clearTimeout(timer);
        resolve(registration);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function requestOldCacheCleanup(): Promise<void> {
  // This page still runs an older hashed bundle until the user approves a reload.
  const controller = navigator.serviceWorker.controller;
  if (reloadRequired || !controller) return Promise.resolve();
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = window.setTimeout(resolve, 2_000);
    channel.port1.onmessage = () => {
      window.clearTimeout(timer);
      channel.port1.close();
      resolve();
    };
    controller.postMessage({ type: 'cleanupOldCaches' }, [channel.port2]);
  });
}

/**
 * GitHub Pages のようにレスポンスヘッダーを設定できない配信先では、
 * Service Worker が同一オリジン応答へ COOP/COEP を付与する。
 * 開発時は Vite の server.headers を使い、キャッシュが開発を妨げないよう
 * Service Worker を登録しない。
 */
export async function registerPwa(): Promise<void> {
  if (registrationStarted) return;
  registrationStarted = true;
  if (import.meta.env.DEV) {
    emitStatus();
    return;
  }
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    emitStatus();
    return;
  }

  const scriptUrl = new URL(`${import.meta.env.BASE_URL}coi-serviceworker.js`, window.location.href);
  const scopeUrl = new URL(import.meta.env.BASE_URL, window.location.href);

  setupState = 'installing';
  emitStatus();

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    setupState = 'idle';
    if (reloadForRequestedUpdate && !reloading) {
      reloading = true;
      window.location.reload();
      return;
    }
    // 初回導入や別タブからの更新では、録画・フォーム入力を破棄しない。
    // 分離実行は次回navigationから有効になるため、明示的な再読込を案内する。
    reloadRequired = true;
    emitStatus();
  });
  // If other tabs postpone an update, their old shell remains cached. Once this becomes the
  // sole visible page, a focus retry lets the active worker remove those no-longer-used builds.
  window.addEventListener('focus', () => void requestOldCacheCleanup());

  try {
    const registration = await navigator.serviceWorker.register(scriptUrl, {
      scope: scopeUrl.pathname,
      updateViaCache: 'none',
    });
    emitStatus();

    const observeWaitingWorker = (worker: ServiceWorker | null): void => {
      if (!worker) return;
      const updateState = () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          waitingRegistration = registration;
          emitStatus();
        } else if (
          worker.state === 'redundant' &&
          !navigator.serviceWorker.controller &&
          !window.crossOriginIsolated
        ) {
          setupState = 'failed';
          emitStatus();
        }
      };
      worker.addEventListener('statechange', updateState);
      updateState();
    };
    if (registration.waiting) {
      waitingRegistration = registration;
      emitStatus();
    }
    observeWaitingWorker(registration.installing);
    registration.addEventListener('updatefound', () => observeWaitingWorker(registration.installing));

    await waitForServiceWorkerReady(READY_TIMEOUT_MS);
    setupState = 'idle';
    emitStatus();
    await requestOldCacheCleanup();
    registration.update().catch(() => undefined);
  } catch (error) {
    if (!navigator.serviceWorker.controller && !window.crossOriginIsolated) {
      setupState = 'failed';
    }
    console.warn('PWA Service Worker registration failed', error);
    emitStatus();
  }
}

export function getRuntimeIsolationStatus(): RuntimeIsolationStatus {
  if (waitingRegistration?.waiting) return 'update';
  if (reloadRequired) return 'reload';
  if (window.crossOriginIsolated) return 'active';
  if (setupState === 'failed') return 'failed';
  if (window.isSecureContext && 'serviceWorker' in navigator) {
    if (setupState === 'installing' || !navigator.serviceWorker.controller) return 'installing';
    return 'unavailable';
  }
  return 'unavailable';
}

/** 録画・入力中の強制再読込を避け、ユーザー操作時だけ待機中SWへ切り替える。 */
export function activatePwaUpdate(): void {
  const waiting = waitingRegistration?.waiting;
  if (!waiting) return;
  reloadForRequestedUpdate = true;
  waiting.postMessage({ type: 'activateUpdate' });
}

/** 初回導入・別タブ更新後に、ユーザーの明示操作で安全にnavigationする。 */
export function reloadForPwaActivation(): void {
  window.location.reload();
}

export function onRuntimeIsolationStatusChange(listener: () => void): () => void {
  window.addEventListener(STATUS_EVENT, listener);
  navigator.serviceWorker?.addEventListener('controllerchange', listener);
  return () => {
    window.removeEventListener(STATUS_EVENT, listener);
    navigator.serviceWorker?.removeEventListener('controllerchange', listener);
  };
}
