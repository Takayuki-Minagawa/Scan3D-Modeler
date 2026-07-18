import { useEffect, useState } from 'react';
import { useI18n } from '../i18n';
import { Badge } from '../ui/common';
import {
  readBrowserStorage,
  requestPersistentStorage,
  type BrowserStorageSnapshot,
} from './browserStorage';
import { formatBytes, formatStoragePercent } from './metrics';

type PersistenceRequestState = 'idle' | 'requesting' | 'denied' | 'failed';

export function StoragePanel(props: { refreshKey: number; onManageStorage: () => void }) {
  const { language, tr } = useI18n();
  const [snapshot, setSnapshot] = useState<BrowserStorageSnapshot | null>(null);
  const [requestState, setRequestState] = useState<PersistenceRequestState>('idle');

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const next = await readBrowserStorage();
      if (active) setSnapshot(next);
    };
    const onFocus = () => void refresh();

    void refresh();
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.removeEventListener('focus', onFocus);
    };
  }, [props.refreshKey]);

  async function requestPersistence() {
    setRequestState('requesting');
    try {
      const granted = await requestPersistentStorage();
      setRequestState(granted ? 'idle' : 'denied');
      const next = await readBrowserStorage();
      setSnapshot(granted ? { ...next, persisted: true } : next);
    } catch {
      setRequestState('failed');
    }
  }

  const ratioWidth =
    snapshot?.ratio === null || snapshot?.ratio === undefined
      ? 0
      : Math.min(100, Math.max(0, snapshot.ratio * 100));
  const hasEstimate = Boolean(snapshot && snapshot.usage !== null && snapshot.quota !== null);

  return (
    <section
      className={`card storage-card${snapshot?.warning ? ' storage-card-warning' : ''}`}
      aria-labelledby="storage-card-title"
    >
      <div className="card-head storage-card-head">
        <div>
          <h2 id="storage-card-title">{tr('端末ストレージ', 'Device storage')}</h2>
          <p className="hint">
            {tr(
              'このサイトがブラウザ内で使用している保存領域です。プロジェクトデータはサーバへ送信されません。',
              'Storage used by this site in your browser. Project data is not uploaded to a server.',
            )}
          </p>
        </div>
        {snapshot?.persisted === true ? (
          <Badge tone="ok">{tr('永続保存 有効', 'Persistent storage on')}</Badge>
        ) : snapshot?.persisted === false ? (
          <Badge tone="warn">{tr('永続保存 未許可', 'Persistent storage off')}</Badge>
        ) : snapshot?.persistenceSupported ? (
          <Badge tone="info">{tr('永続保存 状態不明', 'Persistence status unknown')}</Badge>
        ) : snapshot ? (
          <Badge tone="info">{tr('永続保存 非対応', 'Persistence unavailable')}</Badge>
        ) : null}
      </div>

      {!snapshot ? (
        <p className="hint">{tr('容量を確認中…', 'Checking storage…')}</p>
      ) : hasEstimate ? (
        <>
          <div className="storage-usage-line">
            <strong>
              {formatBytes(snapshot.usage, language)} / {formatBytes(snapshot.quota, language)}
            </strong>
            {snapshot.ratio !== null && <span>{formatStoragePercent(snapshot.ratio)}</span>}
          </div>
          <div
            className="storage-meter"
            role="progressbar"
            aria-label={tr('ストレージ使用率', 'Storage usage')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(ratioWidth)}
          >
            <span style={{ width: `${ratioWidth}%` }} />
          </div>
        </>
      ) : (
        <p className="hint">
          {snapshot.estimateSupported
            ? tr(
                'ブラウザから容量情報を取得できませんでした。',
                'The browser did not provide storage capacity information.',
              )
            : tr(
                'このブラウザは容量情報の取得に対応していません。',
                'This browser does not support storage capacity estimates.',
              )}
        </p>
      )}

      {snapshot?.warning && (
        <div className="storage-warning" role="alert">
          <div>
            <strong>{tr('ストレージ使用率が80%以上です。', 'Storage usage is at least 80%.')}</strong>
            <div>
              {tr(
                'プロジェクトを開いて「出力」からZIPで退避してから削除し、空き容量を確保してください。',
                'Open a project and export it as a ZIP from Export, then delete it to free space.',
              )}
            </div>
          </div>
          <button type="button" className="mini" onClick={props.onManageStorage}>
            {tr('プロジェクト別内訳へ', 'View project breakdown')}
          </button>
        </div>
      )}

      {snapshot && snapshot.persisted !== true && snapshot.persistenceSupported && (
        <div className="storage-persistence-row">
          <p className="hint">
            {requestState === 'denied'
              ? tr(
                  'ブラウザが永続保存を許可しませんでした。重要なデータはZIPでも保管してください。',
                  'The browser did not grant persistence. Also keep important data in ZIP backups.',
                )
              : requestState === 'failed'
                ? tr(
                    '永続保存を要求できませんでした。重要なデータはZIPでも保管してください。',
                    'Persistent storage could not be requested. Also keep important data in ZIP backups.',
                  )
                : tr(
                    '永続保存を許可すると、ブラウザ都合の自動削除からデータを守りやすくなります。ZIPバックアップの代わりにはなりません。',
                    'Persistence helps protect data from automatic browser eviction, but it does not replace ZIP backups.',
                  )}
          </p>
          <button
            type="button"
            onClick={() => void requestPersistence()}
            disabled={requestState === 'requesting'}
          >
            {requestState === 'requesting'
              ? tr('要求中…', 'Requesting…')
              : tr('永続保存を要求', 'Request persistent storage')}
          </button>
        </div>
      )}
    </section>
  );
}
