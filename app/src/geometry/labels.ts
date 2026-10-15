import type { Language, Translate } from '../i18n';
import { fmtDateTime } from '../ui/misc';
import type { GeometryAsset } from './repository';

export function geometryOriginLabel(entry: GeometryAsset, tr: Translate): string {
  if (entry.stage?.demo || entry.stage?.origin === 'demo') return tr('デモ', 'Demo');
  if (entry.stage?.origin === 'external') return tr('外部取込', 'External import');
  return tr('保存データ', 'Stored data');
}

export function geometryKindLabel(entry: GeometryAsset, tr: Translate): string {
  return entry.asset.kind === 'mesh' ? tr('サーフェス', 'Surface') : tr('点群', 'Point cloud');
}

/**
 * 履歴選択の共通表示。seqは種類ごとの採番で点群とサーフェスが同じ番号になり得るため、
 * 保存日時とファイル名を併記して識別できるようにする。
 */
export function geometryHistoryLabel(entry: GeometryAsset, tr: Translate, language: Language): string {
  const seq = entry.stage?.seq ?? '-';
  const when = fmtDateTime(entry.stage?.createdAt ?? entry.asset.createdAt, language);
  return `${geometryOriginLabel(entry, tr)} · ${geometryKindLabel(entry, tr)} #${seq} · ${when} · ${entry.asset.name}`;
}
