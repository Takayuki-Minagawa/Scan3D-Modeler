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
    'project.json が不正です': 'project.json is invalid.',
    'project.json がJSONとして不正です': 'project.json is not valid JSON.',
    'project.json のプロジェクト・段階・アセット構造が不正です':
      'The project, stage, or asset structure in project.json is invalid.',
    'project.json に不正または重複した段階IDがあります':
      'project.json contains an invalid or duplicate stage ID.',
    'project.json に不正または重複したアセットIDがあります':
      'project.json contains an invalid or duplicate asset ID.',
    'このZIPは新しい形式です。アプリを更新してから再度インポートしてください':
      'This ZIP uses a newer format. Update the app and try importing it again.',
    '2点校正の参照元は段階とアセットの両方が必要です':
      'The two-point calibration must reference both its source stage and source asset.',
    '2点校正の参照元段階がZIP内にありません':
      'The source stage for the two-point calibration is missing from the ZIP.',
    '2点校正の参照元アセットがZIP内にありません':
      'The source asset for the two-point calibration is missing from the ZIP.',
    '2点校正の参照元と座標系列が一致しません':
      'The two-point calibration source does not match its coordinate frame.',
    '選択した2点の間隔が小さすぎます。離れた2点を選択してください':
      'The selected points are too close together. Select two points farther apart.',
    '実測距離には0より大きい値を入力してください':
      'Enter a measured distance greater than zero.',
    'スケール校正の元データを特定できません':
      'The source data for the scale calibration could not be identified.',
    'スケール校正の単位がプロジェクトの単位と一致しません':
      'The scale calibration unit does not match the project unit.',
    'スケール倍率が有効範囲を超えています。入力した距離を確認してください':
      'The scale factor is outside the supported range. Check the measured distance.',
    '保存済みのスケール倍率が不正です。校正をやり直してください':
      'The saved scale factor is invalid. Calibrate the scale again.',
    'スケール適用後の座標が有効範囲を超えています。校正をやり直してください':
      'Scaled coordinates exceed the supported range. Calibrate the scale again.',
    'PLYヘッダが不正か長すぎます': 'The PLY header is invalid or too long.',
    'PLYの要素数が不正です': 'The PLY element count is invalid.',
    'PLYの頂点数または面数が上限を超えています':
      'The PLY vertex or face count exceeds the import limit.',
    'STLの面数またはファイル長が不正です':
      'The STL face count or file length is invalid.',
    'STLの構文が不正か、三角面データが不足しています':
      'The STL syntax is invalid or triangle data is incomplete.',
    'STLに不正な数値があります': 'The STL contains an invalid numeric value.',
    '頂点座標は空でないXYZの組で指定してください': 'Vertex coordinates must contain nonempty XYZ triples.',
    '頂点座標に無効な値があります': 'Vertex coordinates contain invalid or nonfinite values.',
    '三角面は空でない3頂点の組で指定してください': 'Mesh indices must contain nonempty triangle triples.',
    '三角面の頂点参照が不正です': 'A triangle references an invalid vertex.',
    '三角面の頂点参照がありません': 'Triangle indices are missing.',
    '点群データの長さが不正です': 'The point-cloud data length is invalid.',
    'メッシュデータのヘッダが不足しています': 'The mesh data header is incomplete.',
    'メッシュデータの頂点数・面数または長さが不正です': 'The mesh vertex count, triangle count or data length is invalid.',
    'PLYの形式指定が不正です': 'The PLY format declaration is invalid.',
    'PLYの要素数または要素名が不正です': 'The PLY element name or count is invalid.',
    'PLYの要素数が上限を超えています': 'The PLY element count exceeds the import limit.',
    'PLYのプロパティ指定が不正です': 'The PLY property declaration is invalid.',
    'PLYヘッダに未対応の項目があります': 'The PLY header contains an unsupported declaration.',
    'PLYの頂点またはプロパティが不足しています': 'PLY vertices or properties are missing.',
    'PLYのXYZ座標が不足しています': 'PLY XYZ coordinate properties are missing.',
    'PLYの面の頂点参照が不正です': 'The PLY face vertex-index property is invalid.',
    'PLYの本体データが不足しています': 'The PLY payload is incomplete.',
    'PLYに不正な数値があります': 'The PLY contains an invalid numeric value.',
    'PLYの整数値が範囲外です': 'A PLY integer is outside its declared range.',
    'PLYのリスト長が範囲外です': 'A PLY list count is outside the supported range.',
    'PLYの面は三角形または四角形にしてください': 'PLY faces must be triangles or quadrilaterals.',
    'PLYの三角面数が上限を超えています': 'The triangulated PLY face count exceeds the import limit.',
    'PLYの要素数と本体データの長さが一致しません': 'The PLY payload does not match its declared element counts.',
    '形状診断が時間切れになりました': 'Geometry inspection timed out. Try a smaller geometry.',
    '形状診断の結果が不正です': 'The geometry inspection result is invalid.',
    '形状診断ワーカーが停止しました': 'The geometry inspection worker stopped.',
    '形状出力が時間切れになりました': 'Geometry export timed out. Try a smaller geometry.',
    '形状出力の結果が不正です': 'The geometry export result is invalid.',
    '形状出力ワーカーが停止しました': 'The geometry export worker stopped.',
    '形状の種類と出力形式の組み合わせが不正です': 'This export format does not support the selected geometry kind.',
    '128MiBを超えるZIPは直接保存に対応したブラウザで出力してください':
      'ZIPs over 128 MiB require a browser that supports direct saving.',
  };
  if (exact[message]) return exact[message];

  if (message.startsWith('復元できるZIPを作成できません:')) {
    const reason = message.slice('復元できるZIPを作成できません: '.length).split('。')[0];
    const reasons: Record<string, string> = {
      'プロジェクト情報が8MiBの上限を超えているか不正です': 'Project metadata is invalid or exceeds 8 MiB.',
      'アセット数が9,999件の上限を超えています': 'The project exceeds 9,999 assets.',
      'アセットIDが不正または重複しています': 'Asset IDs are invalid or duplicated.',
      '1件のアセットが256MiBの上限を超えているかサイズが不正です': 'An asset has an invalid size or exceeds 256 MiB.',
      'ZIP全体が1GiBの上限を超えています': 'The complete ZIP exceeds 1 GiB.',
      'アセット本体と保存サイズが一致しません': 'Stored asset data does not match its recorded size.',
    };
    return `Cannot create a restorable ZIP: ${reasons[reason] ?? 'The project exceeds restore limits.'} Keep the original project.`;
  }

  if (message.startsWith('ZIP内の形状データが不正です:')) {
    return 'The ZIP contains invalid geometry data or could not be validated. Nothing was imported.';
  }
  const missingGeometry = message.match(/^形状「(.+)」の本体データがありません$/);
  if (missingGeometry) return `Geometry “${missingGeometry[1]}” is missing its stored data.`;

  const assetMissing = message.match(/^アセット「(.+)」の本体データが見つかりません/);
  if (assetMissing) {
    return `Asset “${assetMissing[1]}” is missing its data. Export was canceled to avoid producing an incomplete archive.`;
  }
  const timeout = message.match(/^動画の読み込みがタイムアウトしました\((.+)\)$/);
  if (timeout) return `Timed out while loading the video (${timeout[1]}).`;
  if (message.startsWith('ZIP内のアセット本体が欠落・破損しています:')) {
    return 'The ZIP has missing or corrupted asset data. Import was canceled and no data was imported.';
  }
  const invalidManifestValue = message.match(/^project\.json の「(.+)」が不正です$/);
  if (invalidManifestValue) {
    return `project.json contains an invalid value at “${invalidManifestValue[1]}”.`;
  }
  const stageProjectReference = message.match(/^段階「(.+)」のプロジェクト参照が不正です$/);
  if (stageProjectReference) {
    return `Stage “${stageProjectReference[1]}” has an invalid project reference.`;
  }
  const stageSelfReference = message.match(/^段階「(.+)」が自分自身を参照しています$/);
  if (stageSelfReference) {
    return `Stage “${stageSelfReference[1]}” references itself.`;
  }
  const stageSourceReference = message.match(/^段階「(.+)」の参照元がZIP内にありません$/);
  if (stageSourceReference) {
    return `The source of stage “${stageSourceReference[1]}” is missing from the ZIP.`;
  }
  const cyclicStageReference = message.match(/^段階「(.+)」の参照関係が循環しています$/);
  if (cyclicStageReference) {
    return `Stage “${cyclicStageReference[1]}” has a cyclic source reference.`;
  }
  const assetProjectReference = message.match(/^アセット「(.+)」のプロジェクト参照が不正です$/);
  if (assetProjectReference) {
    return `Asset “${assetProjectReference[1]}” has an invalid project reference.`;
  }
  const assetStageReference = message.match(/^アセット「(.+)」の段階参照がZIP内にありません$/);
  if (assetStageReference) {
    return `The stage referenced by asset “${assetStageReference[1]}” is missing from the ZIP.`;
  }
  const assetThumbnailReference = message.match(/^アセット「(.+)」のサムネイル参照が不正です$/);
  if (assetThumbnailReference) {
    return `Asset “${assetThumbnailReference[1]}” has an invalid thumbnail reference.`;
  }
  const thumbnailSourceReference = message.match(/^サムネイル「(.+)」の原画参照が不正です$/);
  if (thumbnailSourceReference) {
    return `Thumbnail “${thumbnailSourceReference[1]}” has an invalid source-image reference.`;
  }
  const unexpectedSourceReference = message.match(/^アセット「(.+)」に不正な原画参照があります$/);
  if (unexpectedSourceReference) {
    return `Asset “${unexpectedSourceReference[1]}” has an unexpected source-image reference.`;
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
