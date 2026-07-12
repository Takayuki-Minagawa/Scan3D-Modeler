import { useCallback, useEffect, useState } from 'react';
import { listAssets } from '../db/assets';
import { listJobs } from '../db/jobs';
import { listStages } from '../db/stages';
import {
  isJobLive,
  onJobsChanged,
  resumeJob,
  startJob,
  stopJob,
} from '../jobs/runner';
import type { JobRecord, Stage, StageKind } from '../types';
import { STAGE_LABEL, STAGE_ORDER } from '../types';
import { Badge, ProgressBar, Section } from '../ui/common';
import { fmtDateTime } from '../ui/misc';
import { DEMO_DEFAULT_PARAMS } from './demoReconstruct';

const JOB_STATUS_LABEL: Record<JobRecord['status'], string> = {
  running: '実行中',
  paused: '一時停止',
  done: '完了',
  failed: '失敗',
  canceled: '中止',
};

/**
 * パイプライン画面(段階データ+ジョブ管理)。
 * 中断したジョブはここから再開できる(1A-4)。
 * SfM以降の実再構成はフェーズ0検証後に実装(未実装表示)。
 * 全体の再読込通知(refreshKey)はProjectPage側で購読している。
 */
export function PipelinePanel(props: { projectId: string }) {
  const [stages, setStages] = useState<Stage[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [imageCount, setImageCount] = useState({ kept: 0, total: 0 });
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    const [st, jb, imgs] = await Promise.all([
      listStages(props.projectId),
      listJobs(props.projectId),
      listAssets(props.projectId, ['image', 'frame']),
    ]);
    setStages(st);
    setJobs(jb);
    setImageCount({ kept: imgs.filter((a) => !a.excluded).length, total: imgs.length });
  }, [props.projectId]);

  useEffect(() => {
    void reload();
    // 進捗バー更新のためprogress通知にも反応するが、対象は自プロジェクトのみ
    return onJobsChanged((ev) => {
      if (ev.projectId === null || ev.projectId === props.projectId) void reload();
    });
  }, [reload, props.projectId]);

  const latestByKind = new Map<StageKind, Stage>();
  for (const s of stages) latestByKind.set(s.kind, s);

  const hasActiveJob = jobs.some((j) => j.status === 'running' || j.status === 'paused');

  async function runDemo() {
    setError('');
    try {
      await startJob(
        'demoReconstruct',
        props.projectId,
        'デモ再構成(合成データ: 穴付きL型ブラケット)',
        { ...DEMO_DEFAULT_PARAMS },
      );
    } catch (e) {
      // 別タブでプロジェクトが削除された直後など
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <Section
        title="パイプライン(段階データ履歴)"
        aside={
          <button className="primary" onClick={() => void runDemo()} disabled={hasActiveJob}>
            デモ生成(合成データ)
          </button>
        }
      >
        {error && <p className="warn-box">{error}</p>}
        <div className="stage-flow">
          <div className="stage-card">
            <div className="stage-name">画像セット</div>
            <div className="stage-status">
              {imageCount.total > 0 ? (
                <Badge tone="ok">採用 {imageCount.kept}枚</Badge>
              ) : (
                <Badge>未取込</Badge>
              )}
            </div>
          </div>
          {STAGE_ORDER.map((kind) => {
            const s = latestByKind.get(kind);
            const notImplemented = kind === 'sparse' || kind === 'cleaned' || kind === 'femShape' || kind === 'mesh';
            return (
              <div key={kind} className="stage-card">
                <div className="stage-name">{STAGE_LABEL[kind]}</div>
                <div className="stage-status">
                  {s ? (
                    <>
                      {s.status === 'ready' && <Badge tone="ok">済 #{s.seq}</Badge>}
                      {s.status === 'running' && <Badge tone="info">実行中</Badge>}
                      {s.status === 'failed' && <Badge tone="err">失敗</Badge>}
                      {s.demo && <Badge tone="demo">デモ</Badge>}
                    </>
                  ) : notImplemented ? (
                    <Badge tone="warn">未実装*</Badge>
                  ) : (
                    <Badge>未作成</Badge>
                  )}
                </div>
                {s?.stats && (
                  <div className="stage-stats">
                    {Object.entries(s.stats)
                      .map(([k, v]) => `${k}: ${v}`)
                      .join(' / ')}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="hint">
          * カメラ位置推定(SfM)以降の実再構成・四面体メッシュ生成は、フェーズ0(WASM移植検証)の
          完了後に実装します(作業計画§3)。それまでは「デモ生成」で後段(ビューア・出力)の動作を
          確認できます。段階データは上書きせず履歴(#連番)として保持されます(使用書§25)。
        </p>
      </Section>

      <Section title="ジョブ(中断しても続きから再開できます)">
        {jobs.length === 0 ? (
          <p className="hint">ジョブはまだありません。</p>
        ) : (
          <ul className="job-list">
            {jobs.slice(0, 12).map((j) => (
              <li key={j.id} className="job-item">
                <div className="job-head">
                  <span className="job-title">{j.title}</span>
                  <Badge
                    tone={
                      j.status === 'done'
                        ? 'ok'
                        : j.status === 'failed'
                          ? 'err'
                          : j.status === 'running'
                            ? 'info'
                            : 'warn'
                    }
                  >
                    {JOB_STATUS_LABEL[j.status]}
                  </Badge>
                  <span className="job-date">{fmtDateTime(j.createdAt)}</span>
                </div>
                {(j.status === 'running' || j.status === 'paused') && (
                  <ProgressBar value={j.progress} />
                )}
                {j.message && <div className="hint">{j.message}</div>}
                {j.error && <div className="warn-box">{j.error}</div>}
                <div className="row">
                  {j.status === 'running' && (
                    <>
                      {/* 停止要求はBroadcastChannelで他タブの実行にも届く */}
                      <button onClick={() => void stopJob(j.id, 'pause', j.runToken)}>
                        一時停止
                      </button>
                      <button
                        className="danger"
                        onClick={() => void stopJob(j.id, 'cancel', j.runToken)}
                      >
                        中止
                      </button>
                      {!isJobLive(j.id) && <span className="hint">別のタブで実行中</span>}
                    </>
                  )}
                  {j.status === 'paused' && (
                    <button className="primary" onClick={() => void resumeJob(j.id)}>
                      続きから再開
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}
