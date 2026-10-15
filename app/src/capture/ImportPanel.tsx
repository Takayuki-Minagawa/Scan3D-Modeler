import { useEffect, useRef, useState, type DragEvent } from 'react';
import { addAsset, deleteVideoAsset, framesOfVideo, listAssets } from '../db/assets';
import { listJobs } from '../db/jobs';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import { onJobsChanged, startJob } from '../jobs/runner';
import { jobText } from '../jobs/text';
import type { AssetMeta } from '../types';
import { Section } from '../ui/common';
import { useConfirm } from '../ui/ConfirmDialog';
import { fmtBytes, fmtDateTime } from '../ui/misc';
import { prepareImageAsset } from './imageUtil';
import { classifyImportFile, filesFromDataTransfer, sortImportFiles } from './importFiles';
import { startFrameExtraction } from './startFrameExtraction';

type ActiveExtractStatus = 'running' | 'paused';
type LocalizedMessage = { ja: string; en: string };
type ImportLogEntry = { id: number; at: number; message: LocalizedMessage; warn?: boolean };

const AUTO_EXTRACT_KEY = 'scan2fem:autoExtractFrames';
const IMPORT_LOG_LIMIT = 5;

function isActiveExtractStatus(status: string): status is ActiveExtractStatus {
  return status === 'running' || status === 'paused';
}

function readAutoExtract(): boolean {
  try {
    return window.localStorage.getItem(AUTO_EXTRACT_KEY) !== 'false';
  } catch {
    return true;
  }
}

async function loadActiveExtractJobs(projectId: string) {
  const active: Record<string, ActiveExtractStatus> = {};
  for (const job of await listJobs(projectId)) {
    const videoAssetId = job.params.videoAssetId;
    if (
      job.type === 'extractFrames' &&
      isActiveExtractStatus(job.status) &&
      typeof videoAssetId === 'string' &&
      // runningを優先表示する。旧データに重複があっても安全側で無効化する。
      (active[videoAssetId] === undefined || job.status === 'running')
    ) {
      active[videoAssetId] = job.status;
    }
  }
  return active;
}

/** ファイル取込(1B-2)。デジカメ・スマホで撮影済みの静止画/動画のアップロード */
export function ImportPanel(props: {
  projectId: string;
  refreshKey: number;
  onImported: () => void;
}) {
  const { language, tr } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; name: string } | null>(null);
  const cancelRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [log, setLog] = useState<ImportLogEntry[]>([]);
  const logSequence = useRef(0);
  const [autoExtract, setAutoExtract] = useState(readAutoExtract);
  const [videos, setVideos] = useState<AssetMeta[]>([]);
  const [mediaAssets, setMediaAssets] = useState<AssetMeta[]>([]);
  const [activeExtractJobs, setActiveExtractJobs] = useState<
    Record<string, ActiveExtractStatus>
  >({});
  const [confirmDialog, confirm] = useConfirm();
  // state反映前のダブルクリックも同期的に遮断する。
  const startingVideoIdsRef = useRef(new Set<string>());
  const [startingVideoIds, setStartingVideoIds] = useState<Set<string>>(new Set());

  function pushLog(message: LocalizedMessage, warn = false) {
    const entry = { id: ++logSequence.current, at: Date.now(), message, warn };
    setLog((current) => [entry, ...current].slice(0, IMPORT_LOG_LIMIT));
  }

  function setVideoStarting(videoAssetId: string, starting: boolean) {
    const next = new Set(startingVideoIdsRef.current);
    if (starting) next.add(videoAssetId);
    else next.delete(videoAssetId);
    startingVideoIdsRef.current = next;
    setStartingVideoIds(next);
  }

  // フォルダ選択はReactの型に無い属性のため、DOMへ直接設定する。
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '');
  }, []);

  // 保存済み動画の一覧(取込時に抽出を見送っても、ここから後で実行・削除できる)
  useEffect(() => {
    let alive = true;
    void listAssets(props.projectId, ['video', 'frame']).then((list) => {
      if (!alive) return;
      setVideos(list.filter((asset) => asset.kind === 'video'));
      setMediaAssets(list);
    });
    return () => {
      alive = false;
    };
  }, [props.projectId, props.refreshKey]);

  // 同一プロジェクトの状態遷移を購読し、別タブの開始・一時停止・完了にも追従する。
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      try {
        const active = await loadActiveExtractJobs(props.projectId);
        if (alive) setActiveExtractJobs(active);
      } catch (e) {
        if (alive) {
          const reason = localizeError(e);
          pushLog({
            ja: `抽出ジョブを確認できません: ${reason.ja}`,
            en: `Could not check extraction jobs: ${reason.en}`,
          }, true);
        }
      }
    };
    void refresh();
    const unsubscribe = onJobsChanged((ev) => {
      if (
        ev.kind === 'change' &&
        (ev.projectId === null || ev.projectId === props.projectId)
      ) {
        void refresh();
      }
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [props.projectId, props.refreshKey]);

  // テキスト入力中を除き、クリップボードの画像貼付けを取込として扱う。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      const files = Array.from(event.clipboardData?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      void handleFiles(files);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  function changeAutoExtract(next: boolean) {
    setAutoExtract(next);
    try {
      window.localStorage.setItem(AUTO_EXTRACT_KEY, String(next));
    } catch {
      // 保存できない環境では、この画面の間だけ設定を保つ。
    }
  }

  async function extractFrom(v: AssetMeta) {
    if (startingVideoIdsRef.current.has(v.id) || activeExtractJobs[v.id]) return;
    setVideoStarting(v.id, true);
    try {
      const started = await startFrameExtraction(props.projectId, v.id, v.name);
      setActiveExtractJobs(await loadActiveExtractJobs(props.projectId));
      pushLog(
        started
          ? {
              ja: `「${v.name}」のフレーム抽出を開始しました(パイプラインタブで進捗を確認できます)`,
              en: `Keyframe extraction started for “${v.name}” (check progress in the Pipeline tab).`,
            }
          : {
              ja: `「${v.name}」のフレーム抽出はすでに実行中または一時停止中です`,
              en: `Keyframe extraction for “${v.name}” is already running or paused.`,
            },
      );
    } catch (e) {
      const reason = localizeError(e);
      pushLog({
        ja: `フレーム抽出を開始できません: ${reason.ja}`,
        en: `Could not start keyframe extraction: ${reason.en}`,
      }, true);
    } finally {
      setVideoStarting(v.id, false);
    }
  }

  async function removeVideo(v: AssetMeta) {
    const related = framesOfVideo(v, mediaAssets);
    const answer = await confirm({
      title: tr('動画を削除', 'Delete video'),
      message: (
        <p>
          {tr(
            `「${v.name}」(${fmtBytes(v.size)})を削除します。元に戻せません。`,
            `Delete “${v.name}” (${fmtBytes(v.size)})? This cannot be undone.`,
          )}
          {related.length > 0 &&
            tr(
              ` この動画から抽出したフレームが${related.length}枚あります。残したフレームは画像タブで引き続き利用できます。`,
              ` ${related.length} frame(s) were extracted from it. Frames you keep remain available in Images.`,
            )}
        </p>
      ),
      confirmLabel: tr('削除する', 'Delete'),
      danger: true,
      checkbox:
        related.length > 0
          ? { label: tr(`抽出済みフレーム${related.length}枚も削除する`, `Also delete ${related.length} extracted frame(s)`) }
          : undefined,
    });
    if (!answer) return;
    try {
      const result = await deleteVideoAsset(v.id, { deleteFrames: answer.checked });
      pushLog(
        answer.checked && result.frames > 0
          ? { ja: `動画「${v.name}」と抽出フレーム${result.frames}枚を削除しました`, en: `Deleted video “${v.name}” and ${result.frames} frame(s)` }
          : { ja: `動画「${v.name}」を削除しました`, en: `Deleted video “${v.name}”` },
      );
      props.onImported();
    } catch (e) {
      const reason = localizeError(e);
      pushLog({ ja: `動画を削除できません: ${reason.ja}`, en: `Could not delete the video: ${reason.en}` }, true);
    }
  }

  async function handleFiles(input: FileList | File[] | null) {
    if (!input || input.length === 0 || busy) return;
    const files = sortImportFiles(Array.from(input));
    cancelRef.current = false;
    setBusy(true);
    setProgress({ done: 0, total: files.length, name: '' });
    try {
      let images = 0;
      let skipped = 0;
      let processed = 0;
      const videos: Array<{ id: string; name: string }> = [];
      const thumbnailFallbacks: string[] = [];
      const failedFiles: string[] = [];
      for (const file of files) {
        if (cancelRef.current) break;
        setProgress({ done: processed, total: files.length, name: file.name });
        const kind = classifyImportFile(file);
        try {
          if (kind === 'image') {
            let prepared: Awaited<ReturnType<typeof prepareImageAsset>> | undefined;
            try {
              prepared = await prepareImageAsset(file);
            } catch {
              // HEIC等の未対応形式でも原画自体は保持し、将来の再処理・ZIP退避を可能にする。
              thumbnailFallbacks.push(file.name);
            }
            await addAsset({
              projectId: props.projectId,
              kind: 'image',
              name: file.name,
              blob: file,
              thumbnail: prepared?.thumbnail,
              image: prepared?.image,
              meta: {
                source: 'file',
                width: prepared?.image.widthPx,
                height: prepared?.image.heightPx,
              },
            });
            images++;
          } else if (kind === 'video') {
            const asset = await addAsset({
              projectId: props.projectId,
              kind: 'video',
              name: file.name,
              blob: file,
              meta: { source: 'file' },
            });
            videos.push({ id: asset.id, name: asset.name });
          } else {
            skipped++;
          }
        } catch {
          // 1件の失敗で、同じ選択に含まれる他ファイルと先行保存済みデータを隠さない。
          failedFiles.push(file.name);
        }
        processed++;
      }
      const canceled = cancelRef.current && processed < files.length;
      const warn = thumbnailFallbacks.length > 0 || failedFiles.length > 0 || canceled;
      pushLog({
        ja:
          `${canceled ? `取込を中止(${processed}/${files.length}件処理済み)` : '取込完了'}: 画像${images}枚 / 動画${videos.length}本` +
          (skipped > 0 ? ` / 対象外${skipped}件をスキップ` : '') +
          (thumbnailFallbacks.length > 0
            ? ` / サムネイル未作成${thumbnailFallbacks.length}枚(原画は保存済み): ${thumbnailFallbacks.join('、')}`
            : '') +
          (failedFiles.length > 0 ? ` / 失敗${failedFiles.length}件: ${failedFiles.join('、')}` : ''),
        en:
          `${canceled ? `Import canceled (${processed}/${files.length} processed)` : 'Import complete'}: ${images} image(s) / ${videos.length} video(s)` +
          (skipped > 0 ? ` / ${skipped} unsupported file(s) skipped` : '') +
          (thumbnailFallbacks.length > 0
            ? ` / ${thumbnailFallbacks.length} without thumbnails (originals saved): ${thumbnailFallbacks.join(', ')}`
            : '') +
          (failedFiles.length > 0 ? ` / ${failedFiles.length} failed: ${failedFiles.join(', ')}` : ''),
      }, warn);
      if (images > 0 || videos.length > 0) props.onImported();

      if (images > 0) {
        // 取込画像の画質(ブレ)判定をバックグラウンドで実行
        await startJob(
          'scoreImages',
          props.projectId,
          jobText('title.scoreImages', { count: images }),
          {},
        );
      }
      if (autoExtract) {
        for (const v of videos) {
          setVideoStarting(v.id, true);
          try {
            await startFrameExtraction(props.projectId, v.id, v.name);
          } finally {
            setVideoStarting(v.id, false);
          }
        }
        if (videos.length > 0) {
          pushLog({
            ja: `動画${videos.length}本のフレーム抽出を開始しました(パイプラインタブで進捗を確認できます)`,
            en: `Started keyframe extraction for ${videos.length} video(s) (see the Pipeline tab).`,
          });
        }
      }
    } catch (e) {
      // 別タブでプロジェクトが削除された直後など
      const reason = localizeError(e);
      pushLog({
        ja: `取込に失敗しました: ${reason.ja}`,
        en: `Import failed: ${reason.en}`,
      }, true);
    } finally {
      setBusy(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
    }
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    if (!Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    setDragging(true);
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    try {
      await handleFiles(await filesFromDataTransfer(event.dataTransfer));
    } catch (e) {
      const reason = localizeError(e);
      pushLog({ ja: `ドロップされた項目を読めません: ${reason.ja}`, en: `Could not read dropped items: ${reason.en}` }, true);
    }
  }

  return (
    <Section
      title={tr('ファイル取込(静止画一括 / 動画)', 'File import (still images / videos)')}
    >
      <div
        className={`dropzone${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
        data-testid="import-dropzone"
        onDragOver={onDragOver}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => void onDrop(event)}
      >
        <p>
          <strong>
            {tr('ここに画像・動画・フォルダをドロップ', 'Drop images, videos or folders here')}
          </strong>
          <br />
          <span className="hint">
            {tr('画面上での貼り付け(Ctrl/⌘+V)にも対応しています。', 'You can also paste images (Ctrl/⌘+V).')}
          </span>
        </p>
        <div className="row wrap">
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*,.heic,.heif"
            multiple
            disabled={busy}
            className="hidden"
            data-testid="import-files"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <input
            ref={folderRef}
            type="file"
            multiple
            disabled={busy}
            className="hidden"
            data-testid="import-folder"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <button type="button" className="primary" disabled={busy} onClick={() => inputRef.current?.click()}>
            {tr('ファイルを選択', 'Choose files')}
          </button>
          <button type="button" disabled={busy} onClick={() => folderRef.current?.click()}>
            {tr('フォルダを選択', 'Choose folder')}
          </button>
          <label className="check">
            <input
              type="checkbox"
              checked={autoExtract}
              onChange={(event) => changeAutoExtract(event.target.checked)}
            />
            {tr('動画は取込後に自動でフレーム抽出', 'Extract frames from videos after import')}
          </label>
        </div>
        <p className="hint">
          {tr(
            '対応形式: 画像はJPEG / PNG / WebPなどブラウザで表示できる形式(HEIC等は原画のみ保存しサムネイルなし)、動画はこのブラウザで再生できる形式(MP4 / WebMなど)。それ以外のファイルはスキップします。',
            'Supported: images the browser can display (JPEG / PNG / WebP, etc.; HEIC and similar are stored as originals without thumbnails) and videos this browser can play (MP4 / WebM, etc.). Other files are skipped.',
          )}
        </p>
      </div>
      {progress && (
        <div className="import-progress">
          <div
            className="progress"
            role="progressbar"
            aria-label={tr('取込の進捗', 'Import progress')}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div
              className="progress-fill"
              style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }}
            />
            <span className="progress-label">
              {progress.done}/{progress.total}
            </span>
          </div>
          <span className="hint">
            {tr(`取込中… ${progress.name}`, `Importing… ${progress.name}`)}
          </span>
          <button type="button" className="mini" onClick={() => { cancelRef.current = true; }}>
            {tr('中止', 'Cancel')}
          </button>
        </div>
      )}
      <ul className="import-log" role="status" aria-live="polite" aria-label={tr('直近の取込結果', 'Recent import results')}>
        {log.map((entry) => (
          <li key={entry.id} className={entry.warn ? 'warn' : ''}>
            <span className="job-date">{fmtDateTime(entry.at, language)}</span>{' '}
            {tr(entry.message.ja, entry.message.en)}
          </li>
        ))}
      </ul>
      {videos.length > 0 && (
        <div>
          <p className="hint">
            {tr(
              '保存済みの動画(後からでもフレーム抽出・削除ができます):',
              'Saved videos (you can extract frames or delete them later):',
            )}
          </p>
          <ul className="job-list">
            {videos.map((v) => {
              const frameCount = framesOfVideo(v, mediaAssets).length;
              return (
                <li key={v.id} className="job-item">
                  <div className="row wrap">
                    <span>
                      {v.name}({fmtBytes(v.size)}
                      {frameCount > 0 && tr(` / 抽出フレーム${frameCount}枚`, ` / ${frameCount} frame(s)`)})
                    </span>
                    <button
                      onClick={() => void extractFrom(v)}
                      disabled={startingVideoIds.has(v.id) || !!activeExtractJobs[v.id]}
                    >
                      {startingVideoIds.has(v.id)
                        ? tr('開始中…', 'Starting…')
                        : activeExtractJobs[v.id] === 'running'
                          ? tr('抽出中', 'Extracting')
                          : activeExtractJobs[v.id] === 'paused'
                            ? tr('一時停止中', 'Paused')
                            : tr('フレーム抽出', 'Extract frames')}
                    </button>
                    <button
                      className="mini danger"
                      disabled={startingVideoIds.has(v.id) || !!activeExtractJobs[v.id]}
                      title={
                        activeExtractJobs[v.id]
                          ? tr('抽出ジョブを中止してから削除できます', 'Cancel the extraction job before deleting')
                          : undefined
                      }
                      aria-label={tr(`動画「${v.name}」を削除`, `Delete video “${v.name}”`)}
                      onClick={() => void removeVideo(v)}
                    >
                      {tr('削除', 'Delete')}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="hint">
        {tr(
          '取り込んだ画像は自動でブレ判定されます。動画はキーフレーム抽出(中断・再開可能)にかけられます。',
          'Imported images are checked for blur automatically. Videos can be processed for keyframe extraction (pause and resume supported).',
        )}
      </p>
      {confirmDialog}
    </Section>
  );
}
