import { useCallback, useEffect, useState } from 'react';
import { listAssets } from '../db/assets';
import { listJobs } from '../db/jobs';
import { listStages } from '../db/stages';
import { localizeError } from '../errorText';
import { useI18n } from '../i18n';
import {
  isJobLive,
  onJobsChanged,
  resumeJob,
  startJob,
  stopJob,
} from '../jobs/runner';
import { formatJobError, formatJobMessage, formatJobTitle, formatStageStats, jobText } from '../jobs/text';
import type { JobRecord, Stage, StageKind } from '../types';
import { STAGE_ORDER } from '../types';
import { Badge, ProgressBar, Section } from '../ui/common';
import { fmtDateTime } from '../ui/misc';
import { DEMO_DEFAULT_PARAMS } from './demoReconstruct';

/**
 * パイプライン画面(段階データ+ジョブ管理)。
 * 中断したジョブはここから再開できる(1A-4)。
 * SfM以降の実再構成はフェーズ0検証後に実装(未実装表示)。
 * 全体の再読込通知(refreshKey)はProjectPage側で購読している。
 */
export function PipelinePanel(props: { projectId: string }) {
  const { language, tr } = useI18n();
  const [stages, setStages] = useState<Stage[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [imageCount, setImageCount] = useState({ kept: 0, total: 0 });
  const [error, setError] = useState<{ ja: string; en: string } | null>(null);
  const stageLabels: Record<StageKind, string> = {
    frames: tr('キーフレーム', 'Key frames'),
    sparse: tr('カメラ位置推定(SfM)', 'Camera poses (SfM)'),
    dense: tr('密点群', 'Dense point cloud'),
    surface: tr('サーフェス', 'Surface'),
    cleaned: tr('クリーニング済み', 'Cleaned'),
    femShape: tr('FEM用形状', 'FEM shape'),
    mesh: tr('四面体メッシュ', 'Tetrahedral mesh'),
  };
  const jobStatusLabels: Record<JobRecord['status'], string> = {
    running: tr('実行中', 'Running'),
    paused: tr('一時停止', 'Paused'),
    done: tr('完了', 'Completed'),
    failed: tr('失敗', 'Failed'),
    canceled: tr('中止', 'Canceled'),
  };

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
    setError(null);
    try {
      await startJob(
        'demoReconstruct',
        props.projectId,
        jobText('title.demoReconstruct'),
        { ...DEMO_DEFAULT_PARAMS },
      );
    } catch (e) {
      // 別タブでプロジェクトが削除された直後など
      const reason = localizeError(e);
      setError({
        ja: `デモ再構成を開始できません: ${reason.ja}`,
        en: `Could not start the demo reconstruction: ${reason.en}`,
      });
    }
  }

  return (
    <>
      <Section
        title={tr('パイプライン(段階データ履歴)', 'Pipeline (stage history)')}
        aside={
          <button className="primary" onClick={() => void runDemo()} disabled={hasActiveJob}>
            {tr('デモ生成(合成データ)', 'Generate demo (synthetic data)')}
          </button>
        }
      >
        {error && <p className="warn-box">{tr(error.ja, error.en)}</p>}
        <div className="stage-flow">
          <div className="stage-card">
            <div className="stage-name">{tr('画像セット', 'Image set')}</div>
            <div className="stage-status">
              {imageCount.total > 0 ? (
                <Badge tone="ok">{tr(`採用 ${imageCount.kept}枚`, `${imageCount.kept} kept`)}</Badge>
              ) : (
                <Badge>{tr('未取込', 'Not imported')}</Badge>
              )}
            </div>
          </div>
          {STAGE_ORDER.map((kind) => {
            const s = latestByKind.get(kind);
            const notImplemented = kind === 'sparse' || kind === 'cleaned' || kind === 'femShape' || kind === 'mesh';
            return (
              <div key={kind} className="stage-card">
                <div className="stage-name">{stageLabels[kind]}</div>
                <div className="stage-status">
                  {s ? (
                    <>
                      {s.status === 'ready' && <Badge tone="ok">{tr(`済 #${s.seq}`, `Done #${s.seq}`)}</Badge>}
                      {s.status === 'running' && <Badge tone="info">{tr('実行中', 'Running')}</Badge>}
                      {s.status === 'failed' && <Badge tone="err">{tr('失敗', 'Failed')}</Badge>}
                      {s.demo && <Badge tone="demo">{tr('デモ', 'Demo')}</Badge>}
                    </>
                  ) : notImplemented ? (
                    <Badge tone="warn">{tr('未実装*', 'Not implemented*')}</Badge>
                  ) : (
                    <Badge>{tr('未作成', 'Not created')}</Badge>
                  )}
                </div>
                {s?.stats && (
                  <div className="stage-stats">
                    {formatStageStats(s.stats, language)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p className="hint">
          {tr(
            '* カメラ位置推定(SfM)以降の実再構成と四面体メッシュ生成は、フェーズ0のWASM実現性検証の完了後に実装します。それまでは「デモ生成」で後段のビューア・出力の流れを確認できます。段階データは上書きせず履歴として保持されます。',
            '* Real reconstruction from camera-pose estimation (SfM) onward and tetrahedral meshing are planned after the Phase 0 WASM feasibility work. Until then, Generate demo lets you verify the downstream viewer and export flow. Stage data is kept as history instead of being overwritten.',
          )}
        </p>
      </Section>

      <Section title={tr('ジョブ(中断しても続きから再開できます)', 'Jobs (pause and resume anytime)')}>
        {jobs.length === 0 ? (
          <p className="hint">{tr('ジョブはまだありません。', 'No jobs yet.')}</p>
        ) : (
          <ul className="job-list">
            {jobs.slice(0, 12).map((j) => {
              const message = formatJobMessage(j, language);
              const errorMessage = formatJobError(j, language);
              return (
              <li key={j.id} className="job-item">
                <div className="job-head">
                  <span className="job-title">{formatJobTitle(j, language)}</span>
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
                    {jobStatusLabels[j.status]}
                  </Badge>
                  <span className="job-date">{fmtDateTime(j.createdAt, language)}</span>
                </div>
                {(j.status === 'running' || j.status === 'paused') && (
                  <ProgressBar value={j.progress} />
                )}
                {message && <div className="hint">{message}</div>}
                {errorMessage && <div className="warn-box">{errorMessage}</div>}
                <div className="row">
                  {j.status === 'running' && (
                    <>
                      {/* 停止要求はBroadcastChannelで他タブの実行にも届く */}
                      <button onClick={() => void stopJob(j.id, 'pause', j.runToken)}>
                        {tr('一時停止', 'Pause')}
                      </button>
                      <button
                        className="danger"
                        onClick={() => void stopJob(j.id, 'cancel', j.runToken)}
                      >
                        {tr('中止', 'Cancel')}
                      </button>
                      {!isJobLive(j.id) && <span className="hint">{tr('別のタブで実行中', 'Running in another tab')}</span>}
                    </>
                  )}
                  {j.status === 'paused' && (
                    <button className="primary" onClick={() => void resumeJob(j.id)}>
                      {tr('続きから再開', 'Resume')}
                    </button>
                  )}
                </div>
              </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}
