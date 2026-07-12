import type { Language } from '../i18n';
import type { JobRecord, JobText, JobTextKey } from '../types';

/**
 * IndexedDB に保存するジョブ文言は表示言語ではなくキーと値で保持する。
 * これにより、保存済みジョブも言語を切り替えた時点の表示言語で描画できる。
 */
export function jobText(
  key: JobTextKey,
  values?: Record<string, string | number>,
): JobText {
  return values ? { key, values } : { key };
}

function stringValue(text: JobText, key: string, fallback = ''): string {
  const value = text.values?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : fallback;
}

function numberValue(text: JobText, key: string, fallback = 0): number {
  const value = text.values?.[key];
  return typeof value === 'number' ? value : typeof value === 'string' ? Number(value) || fallback : fallback;
}

/** Render a persisted, language-neutral job text descriptor. */
export function formatJobText(text: JobText, language: Language): string {
  const ja = language === 'ja';
  switch (text.key) {
    case 'title.extractFrames': {
      const name = stringValue(text, 'name');
      return ja ? `フレーム抽出: ${name}` : `Keyframe extraction: ${name}`;
    }
    case 'title.scoreImages': {
      const rawCount = text.values?.count;
      if (typeof rawCount !== 'string' && typeof rawCount !== 'number') {
        return ja ? '画質判定' : 'Image quality check';
      }
      const count = numberValue(text, 'count');
      return ja ? `画質判定(${count}枚)` : `Image quality check (${count} image(s))`;
    }
    case 'title.demoReconstruct':
      return ja
        ? 'デモ再構成(合成データ: 穴付きL型ブラケット)'
        : 'Demo reconstruction (synthetic L-bracket)';
    case 'message.resumed':
      return ja ? '再開しました' : 'Resumed.';
    case 'message.runningInAnotherTab':
      return ja ? '別のタブで実行中です' : 'Running in another tab.';
    case 'message.pausing':
      return ja ? '一時停止しています…' : 'Pausing…';
    case 'message.canceling':
      return ja ? '中止しています…' : 'Canceling…';
    case 'message.paused':
      return ja ? '一時停止中(再開できます)' : 'Paused (ready to resume).';
    case 'message.canceled':
      return ja ? '中止しました' : 'Canceled.';
    case 'message.completed':
      return ja ? '完了' : 'Completed.';
    case 'message.interrupted':
      return ja
        ? '実行が中断されました(続きから再開できます)'
        : 'The run was interrupted (ready to resume).';
    case 'message.frameProgress': {
      const kept = numberValue(text, 'kept');
      const scanned = numberValue(text, 'scanned');
      return ja
        ? `${kept}枚採用 / ${scanned}コマ検査(ブレ・重複は除外)`
        : `${kept} kept / ${scanned} frame(s) checked (blurred and duplicate frames excluded)`;
    }
    case 'message.scoreProgress': {
      const done = numberValue(text, 'done');
      const total = numberValue(text, 'total');
      return ja ? `${done}/${total} 枚を判定` : `Checked ${done}/${total} image(s)`;
    }
    case 'message.demoCloudProgress': {
      const chunk = numberValue(text, 'chunk');
      const total = numberValue(text, 'total');
      return ja
        ? `点群生成 ${chunk}/${total} チャンク(デモ)`
        : `Generating point cloud: chunk ${chunk}/${total} (demo)`;
    }
    case 'message.demoSurface':
      return ja ? 'デモサーフェス生成中' : 'Generating demo surface…';
    case 'error.engineNotRegistered': {
      const type = stringValue(text, 'type');
      return ja ? `エンジン未登録: ${type}` : `No engine is registered for: ${type}`;
    }
    case 'error.videoNotFound':
      return ja ? '動画データが見つかりません' : 'The video data could not be found.';
    case 'error.videoDurationUnavailable':
      return ja ? '動画の長さを取得できません' : 'Could not determine the video duration.';
    case 'error.canvasUnavailable':
      return ja ? 'canvas 2Dコンテキストを取得できません' : 'Could not obtain a 2D canvas context.';
    case 'error.videoLoadTimeout': {
      const event = stringValue(text, 'event');
      return ja
        ? `動画の読み込みがタイムアウトしました(${event})`
        : `Timed out while loading the video (${event}).`;
    }
    case 'error.videoUnsupported':
      return ja
        ? '動画を読み込めません(未対応の形式の可能性)'
        : 'Could not load the video (the format may be unsupported).';
    case 'error.demoWorker':
      return ja ? 'デモ点群生成ワーカーでエラーが発生しました' : 'The demo point-cloud worker failed.';
    case 'error.unexpected':
      return ja ? 'ジョブの実行中に予期しないエラーが発生しました' : 'An unexpected error occurred while running the job.';
  }
}

/** An engine can throw this to keep its persisted failure message language-neutral. */
export class JobTextError extends Error {
  constructor(public readonly text: JobText) {
    super(formatJobText(text, 'ja'));
    this.name = 'JobTextError';
  }
}

/** Keep raw implementation errors out of an English job card while retaining known detail. */
export function errorToJobText(error: unknown): JobText {
  return error instanceof JobTextError ? error.text : jobText('error.unexpected');
}

function legacyJobTitle(job: JobRecord): JobText {
  if (job.type === 'demoReconstruct') return jobText('title.demoReconstruct');
  if (job.type === 'scoreImages') {
    const count = job.title.match(/(?:画質判定|Quality check)\s*\((\d+)/)?.[1];
    return count ? jobText('title.scoreImages', { count: Number(count) }) : jobText('title.scoreImages');
  }
  const name = job.title
    .replace(/^(?:フレーム抽出|Keyframe extraction):\s*/, '')
    .trim();
  return jobText('title.extractFrames', { name });
}

function legacyJobMessage(message: string): JobText | null {
  const exact: Record<string, JobTextKey> = {
    再開しました: 'message.resumed',
    別のタブで実行中です: 'message.runningInAnotherTab',
    '一時停止しています…': 'message.pausing',
    '中止しています…': 'message.canceling',
    '一時停止中(再開できます)': 'message.paused',
    中止しました: 'message.canceled',
    完了: 'message.completed',
    '実行が中断されました(続きから再開できます)': 'message.interrupted',
    デモサーフェス生成中: 'message.demoSurface',
  };
  const key = exact[message];
  if (key) return jobText(key);

  const frame = message.match(/^(\d+)枚採用\s*\/\s*(\d+)コマ検査/);
  if (frame) return jobText('message.frameProgress', { kept: Number(frame[1]), scanned: Number(frame[2]) });
  const score = message.match(/^(\d+)\/(\d+)\s*枚を判定$/);
  if (score) return jobText('message.scoreProgress', { done: Number(score[1]), total: Number(score[2]) });
  const cloud = message.match(/^点群生成\s*(\d+)\/(\d+)\s*チャンク/);
  if (cloud) {
    return jobText('message.demoCloudProgress', {
      chunk: Number(cloud[1]),
      total: Number(cloud[2]),
    });
  }
  return null;
}

function legacyJobError(error: string): JobText | null {
  if (error === '動画データが見つかりません') return jobText('error.videoNotFound');
  if (error === '動画の長さを取得できません') return jobText('error.videoDurationUnavailable');
  if (error === 'canvas 2Dコンテキストを取得できません') return jobText('error.canvasUnavailable');
  if (error === '動画を読み込めません(未対応の形式の可能性)') return jobText('error.videoUnsupported');
  const timeout = error.match(/^動画の読み込みがタイムアウトしました\((.+)\)$/);
  if (timeout) return jobText('error.videoLoadTimeout', { event: timeout[1] });
  if (error.startsWith('エンジン未登録: ')) {
    return jobText('error.engineNotRegistered', { type: error.slice('エンジン未登録: '.length) });
  }
  return null;
}

export function formatJobTitle(job: JobRecord, language: Language): string {
  return formatJobText(job.titleText ?? legacyJobTitle(job), language);
}

export function formatJobMessage(job: JobRecord, language: Language): string | null {
  const text = job.messageText ?? (job.message ? legacyJobMessage(job.message) : null);
  if (text) return formatJobText(text, language);
  if (!job.message) return null;
  // Historical, unknown Japanese messages have no structured source. Avoid mixing them into English UI.
  return language === 'ja' ? job.message : 'Working…';
}

export function formatJobError(job: JobRecord, language: Language): string | null {
  const text = job.errorText ?? (job.error ? legacyJobError(job.error) : null);
  if (text) return formatJobText(text, language);
  if (!job.error) return null;
  // Preserve old content for Japanese users; use a stable English fallback where it cannot be translated safely.
  return language === 'ja' ? job.error : formatJobText(jobText('error.unexpected'), language);
}

/** Translate the generated stage statistics currently visible in the pipeline. */
export function formatStageStats(
  stats: Record<string, string | number>,
  language: Language,
): string {
  const labels: Record<string, [string, string]> = {
    採用枚数: ['採用枚数', 'Kept frames'],
    検査コマ数: ['検査コマ数', 'Frames checked'],
    点数: ['点数', 'Points'],
    頂点数: ['頂点数', 'Vertices'],
    三角形数: ['三角形数', 'Triangles'],
    備考: ['備考', 'Note'],
  };
  const failedNotes: Record<string, [string, string]> = {
    ジョブ中止により未完了: ['ジョブ中止により未完了', 'Incomplete because the job was canceled'],
    ジョブ失敗により未完了: ['ジョブ失敗により未完了', 'Incomplete because the job failed'],
  };
  return Object.entries(stats)
    .map(([key, value]) => {
      const label = labels[key]?.[language === 'ja' ? 0 : 1] ?? key;
      const renderedValue =
        typeof value === 'string' && failedNotes[value]
          ? failedNotes[value][language === 'ja' ? 0 : 1]
          : value;
      return `${label}: ${renderedValue}`;
    })
    .join(' / ');
}
