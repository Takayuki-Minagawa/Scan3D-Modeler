import { useEffect, useRef, useState } from 'react';
import { addAsset, listAssets } from '../db/assets';
import { listJobs } from '../db/jobs';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import { onJobsChanged, startJob } from '../jobs/runner';
import { jobText } from '../jobs/text';
import type { AssetMeta } from '../types';
import { Section } from '../ui/common';
import { startFrameExtraction } from './startFrameExtraction';

type ActiveExtractStatus = 'running' | 'paused';
type LocalizedMessage = { ja: string; en: string };

function isActiveExtractStatus(status: string): status is ActiveExtractStatus {
  return status === 'running' || status === 'paused';
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
  const { tr } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<LocalizedMessage | null>(null);
  const [videos, setVideos] = useState<AssetMeta[]>([]);
  const [activeExtractJobs, setActiveExtractJobs] = useState<
    Record<string, ActiveExtractStatus>
  >({});
  // state反映前のダブルクリックも同期的に遮断する。
  const startingVideoIdsRef = useRef(new Set<string>());
  const [startingVideoIds, setStartingVideoIds] = useState<Set<string>>(new Set());

  function setVideoStarting(videoAssetId: string, starting: boolean) {
    const next = new Set(startingVideoIdsRef.current);
    if (starting) next.add(videoAssetId);
    else next.delete(videoAssetId);
    startingVideoIdsRef.current = next;
    setStartingVideoIds(next);
  }

  // 保存済み動画の一覧(取込時に抽出を見送っても、ここから後で実行できる)
  useEffect(() => {
    let alive = true;
    void listAssets(props.projectId, ['video']).then((v) => {
      if (alive) setVideos(v);
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
          setStatus({
            ja: `抽出ジョブを確認できません: ${reason.ja}`,
            en: `Could not check extraction jobs: ${reason.en}`,
          });
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

  async function extractFrom(v: AssetMeta) {
    if (startingVideoIdsRef.current.has(v.id) || activeExtractJobs[v.id]) return;
    setVideoStarting(v.id, true);
    try {
      const started = await startFrameExtraction(props.projectId, v.id, v.name);
      setActiveExtractJobs(await loadActiveExtractJobs(props.projectId));
      setStatus(
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
      setStatus({
        ja: `フレーム抽出を開始できません: ${reason.ja}`,
        en: `Could not start keyframe extraction: ${reason.en}`,
      });
    } finally {
      setVideoStarting(v.id, false);
    }
  }

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    try {
      let images = 0;
      const videos: Array<{ id: string; name: string }> = [];
      for (const file of Array.from(files)) {
        if (file.type.startsWith('image/')) {
          await addAsset({
            projectId: props.projectId,
            kind: 'image',
            name: file.name,
            blob: file,
            meta: { source: 'file' },
          });
          images++;
        } else if (file.type.startsWith('video/')) {
          const asset = await addAsset({
            projectId: props.projectId,
            kind: 'video',
            name: file.name,
            blob: file,
            meta: { source: 'file' },
          });
          videos.push({ id: asset.id, name: asset.name });
        }
      }
      setStatus({
        ja: `取込完了: 画像${images}枚 / 動画${videos.length}本`,
        en: `Import complete: ${images} image(s) / ${videos.length} video(s)`,
      });
      props.onImported();

      if (images > 0) {
        // 取込画像の画質(ブレ)判定をバックグラウンドで実行
        await startJob(
          'scoreImages',
          props.projectId,
          jobText('title.scoreImages', { count: images }),
          {},
        );
      }
      for (const v of videos) {
        if (
          window.confirm(
            tr(
              `動画「${v.name}」からキーフレーム抽出を開始しますか?`,
              `Start keyframe extraction from “${v.name}”?`,
            ),
          )
        ) {
          setVideoStarting(v.id, true);
          try {
            await startFrameExtraction(props.projectId, v.id, v.name);
          } finally {
            setVideoStarting(v.id, false);
          }
        }
      }
    } catch (e) {
      // 別タブでプロジェクトが削除された直後など
      const reason = localizeError(e);
      setStatus({
        ja: `取込に失敗しました: ${reason.ja}`,
        en: `Import failed: ${reason.en}`,
      });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Section
      title={tr('ファイル取込(静止画一括 / 動画)', 'File import (still images / videos)')}
    >
      <div className="row wrap">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          disabled={busy}
          aria-label={tr('取り込む画像・動画を選択', 'Choose images or videos to import')}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {busy && <span className="hint">{tr('取込中…', 'Importing…')}</span>}
      </div>
      {status && <p className="hint">{tr(status.ja, status.en)}</p>}
      {videos.length > 0 && (
        <div>
          <p className="hint">
            {tr(
              '保存済みの動画(後からでもフレーム抽出を実行できます):',
              'Saved videos (you can extract frames later):',
            )}
          </p>
          <ul className="job-list">
            {videos.map((v) => (
              <li key={v.id} className="job-item">
                <div className="row wrap">
                  <span>
                    {v.name}({(v.size / (1024 * 1024)).toFixed(1)}MB)
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
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">
        {tr(
          '取り込んだ画像は自動でブレ判定されます。動画はキーフレーム抽出(中断・再開可能)にかけられます。',
          'Imported images are checked for blur automatically. Videos can be processed for keyframe extraction (pause and resume supported).',
        )}
      </p>
    </Section>
  );
}
