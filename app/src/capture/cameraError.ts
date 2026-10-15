type LocalizedMessage = { ja: string; en: string };

export type CameraErrorCause = 'insecure' | 'unsupported' | 'denied' | 'notFound' | 'inUse' | 'constraints' | 'unknown';

/** getUserMedia の失敗を、利用者が取るべき対処ごとに分類する。 */
export function classifyCameraError(
  error: unknown,
  environment: { secureContext: boolean; mediaDevices: boolean },
): CameraErrorCause {
  if (!environment.secureContext) return 'insecure';
  if (!environment.mediaDevices) return 'unsupported';
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'denied';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'inUse';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'constraints';
    default:
      return 'unknown';
  }
}

const GUIDANCE: Record<CameraErrorCause, LocalizedMessage> = {
  insecure: {
    ja: 'このページは安全な接続ではありません。カメラはHTTPSまたはlocalhostでのみ使用できます。',
    en: 'This page is not a secure context. Camera access requires HTTPS or localhost.',
  },
  unsupported: {
    ja: 'このブラウザはカメラAPIに対応していません。',
    en: 'This browser does not support the camera API.',
  },
  denied: {
    ja: 'カメラの使用が許可されていません。アドレスバーのサイト設定(鍵アイコン等)でカメラを「許可」にしてから、もう一度起動してください。',
    en: 'Camera permission was denied. Allow the camera in the site settings (e.g. the lock icon in the address bar), then start it again.',
  },
  notFound: {
    ja: 'カメラが見つかりません。カメラの接続とOSのプライバシー設定を確認してください。',
    en: 'No camera was found. Check the camera connection and the operating system privacy settings.',
  },
  inUse: {
    ja: 'カメラを開けませんでした。他のアプリやタブが使用中の可能性があります。終了してから再試行してください。',
    en: 'The camera could not be opened. Another app or tab may be using it; close it and try again.',
  },
  constraints: {
    ja: '選択したカメラが要求した条件に対応していません。別のカメラを選んでください。',
    en: 'The selected camera does not support the requested settings. Choose another camera.',
  },
  unknown: {
    ja: 'カメラを起動できない原因を特定できませんでした。ブラウザの権限設定とカメラの接続を確認してください。',
    en: 'The cause could not be identified. Check browser permissions and the camera connection.',
  },
};

export function cameraErrorGuidance(cause: CameraErrorCause): LocalizedMessage {
  return GUIDANCE[cause];
}
