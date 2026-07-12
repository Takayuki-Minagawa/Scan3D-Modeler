import type { Language } from './i18n';
import { formatJobText, JobTextError } from './jobs/text';

const containsJapanese = (value: string): boolean => /[\u3040-\u30ff\u3400-\u9fff]/.test(value);

function rawError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Keep internal Japanese errors from leaking into English UI. Known errors preserve their
 * actionable detail; unknown Japanese implementation errors get a safe, coherent fallback.
 */
export function formatAppError(error: unknown, language: Language): string {
  if (error instanceof JobTextError) return formatJobText(error.text, language);

  const message = rawError(error);
  if (language === 'ja') return message;

  const exact: Record<string, string> = {
    'プロジェクトが見つかりません': 'The project could not be found.',
    'プロジェクトが見つかりません(削除された可能性があります)':
      'The project could not be found. It may have been deleted.',
    'この動画のフレーム抽出はすでに実行中または一時停止中です':
      'Keyframe extraction for this video is already running or paused.',
    '動画データが見つかりません': 'The video data could not be found.',
    '動画の長さを取得できません': 'Could not determine the video duration.',
    'canvas 2Dコンテキストを取得できません': 'Could not obtain a 2D canvas context.',
    '画像のエンコードに失敗しました': 'Could not encode the image.',
    '動画を読み込めません(未対応の形式の可能性)':
      'Could not load the video (the format may be unsupported).',
    '実行中のジョブがあります。一時停止または完了させてからエクスポートしてください':
      'There are running jobs. Pause or complete them before exporting.',
    'project.json がありません(scan2femのZIPではありません)':
      'This ZIP does not contain project.json and is not a Scan2FEM project archive.',
    '対応していない形式です': 'This project archive format is not supported.',
  };
  if (exact[message]) return exact[message];

  const assetMissing = message.match(/^アセット「(.+)」の本体データが見つかりません/);
  if (assetMissing) {
    return `Asset “${assetMissing[1]}” is missing its data. Export was canceled to avoid producing an incomplete archive.`;
  }
  const timeout = message.match(/^動画の読み込みがタイムアウトしました\((.+)\)$/);
  if (timeout) return `Timed out while loading the video (${timeout[1]}).`;
  if (message.startsWith('ZIP内のアセット本体が欠落・破損しています:')) {
    return 'The ZIP has missing or corrupted asset data. Import was canceled and no data was imported.';
  }
  const pointMissing = message.match(/^点群「(.+)」の本体データがありません$/);
  if (pointMissing) return `Point-cloud asset “${pointMissing[1]}” is missing its data.`;
  const surfaceMissing = message.match(/^サーフェス「(.+)」の本体データがありません$/);
  if (surfaceMissing) return `Surface asset “${surfaceMissing[1]}” is missing its data.`;

  return containsJapanese(message) ? 'An unexpected error occurred.' : message || 'An unexpected error occurred.';
}

export type LocalizedError = { ja: string; en: string };

export function localizeError(error: unknown): LocalizedError {
  return {
    ja: formatAppError(error, 'ja'),
    en: formatAppError(error, 'en'),
  };
}
