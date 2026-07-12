import { useEffect, useRef, useState } from 'react';
import { addAsset, listAssets } from '../db/assets';
import { startJob } from '../jobs/runner';
import { DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import type { AssetMeta } from '../types';
import { Section } from '../ui/common';

/** ファイル取込(1B-2)。デジカメ・スマホで撮影済みの静止画/動画のアップロード */
export function ImportPanel(props: {
  projectId: string;
  refreshKey: number;
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [videos, setVideos] = useState<AssetMeta[]>([]);

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

  async function extractFrom(v: AssetMeta) {
    try {
      await startJob('extractFrames', props.projectId, `フレーム抽出: ${v.name}`, {
        videoAssetId: v.id,
        stepMs: 250,
        blurThreshold: DEFAULT_BLUR_THRESHOLD,
      });
      setStatus(`「${v.name}」のフレーム抽出を開始しました(パイプラインタブで進捗を確認できます)`);
    } catch (e) {
      setStatus(`フレーム抽出を開始できません: ${e instanceof Error ? e.message : String(e)}`);
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
      setStatus(`取込完了: 画像${images}枚 / 動画${videos.length}本`);
      props.onImported();

      if (images > 0) {
        // 取込画像の画質(ブレ)判定をバックグラウンドで実行
        await startJob('scoreImages', props.projectId, `画質判定(${images}枚)`, {});
      }
      for (const v of videos) {
        if (window.confirm(`動画「${v.name}」からキーフレーム抽出を開始しますか?`)) {
          await startJob('extractFrames', props.projectId, `フレーム抽出: ${v.name}`, {
            videoAssetId: v.id,
            stepMs: 250,
            blurThreshold: DEFAULT_BLUR_THRESHOLD,
          });
        }
      }
    } catch (e) {
      // 別タブでプロジェクトが削除された直後など
      setStatus(`取込に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Section title="ファイル取込(静止画一括 / 動画)">
      <div className="row wrap">
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          multiple
          disabled={busy}
          onChange={(e) => void handleFiles(e.target.files)}
        />
        {busy && <span className="hint">取込中…</span>}
      </div>
      {status && <p className="hint">{status}</p>}
      {videos.length > 0 && (
        <div>
          <p className="hint">保存済みの動画(後からでもフレーム抽出を実行できます):</p>
          <ul className="job-list">
            {videos.map((v) => (
              <li key={v.id} className="job-item">
                <div className="row wrap">
                  <span>
                    {v.name}({(v.size / (1024 * 1024)).toFixed(1)}MB)
                  </span>
                  <button onClick={() => void extractFrom(v)}>フレーム抽出</button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="hint">
        取り込んだ画像は自動でブレ判定されます。動画はキーフレーム抽出(中断・再開可能)にかけられます。
      </p>
    </Section>
  );
}
