import type { AssetMeta } from '../types';

/** Warn before the browser origin is close enough to its quota to make writes unreliable. */
export const STORAGE_WARNING_THRESHOLD = 0.8;

export interface StorageEstimateLike {
  usage?: number;
  quota?: number;
}

export interface NormalizedStorageEstimate {
  usage: number | null;
  quota: number | null;
  /** `usage / quota`; null when the browser did not return usable values. */
  ratio: number | null;
  warning: boolean;
}

export interface ProjectStorageSummary {
  bytes: number;
  assetCount: number;
}

type AssetSizeRecord = Pick<AssetMeta, 'projectId' | 'size'>;

/** Treat corrupt/legacy size values as zero instead of poisoning totals with NaN. */
export function normalizeByteSize(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

export function calculateStorageRatio(usage: unknown, quota: unknown): number | null {
  if (typeof usage !== 'number' || !Number.isFinite(usage) || usage < 0) return null;
  if (typeof quota !== 'number' || !Number.isFinite(quota) || quota <= 0) return null;
  return usage / quota;
}

export function isStorageWarning(
  ratio: number | null,
  threshold = STORAGE_WARNING_THRESHOLD,
): boolean {
  return ratio !== null && Number.isFinite(ratio) && ratio >= threshold;
}

/** Pure normalization used by the browser adapter and independently testable. */
export function normalizeStorageEstimate(
  estimate: StorageEstimateLike,
  threshold = STORAGE_WARNING_THRESHOLD,
): NormalizedStorageEstimate {
  const usage =
    typeof estimate.usage === 'number' && Number.isFinite(estimate.usage) && estimate.usage >= 0
      ? estimate.usage
      : null;
  const quota =
    typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) && estimate.quota > 0
      ? estimate.quota
      : null;
  const ratio = calculateStorageRatio(usage, quota);
  return { usage, quota, ratio, warning: isStorageWarning(ratio, threshold) };
}

/**
 * Sum asset metadata by project. The metadata size mirrors the stored Blob size, while avoiding
 * loading large Blobs into memory merely to render the project list.
 */
export function summarizeProjectAssetSizes(
  assets: readonly AssetSizeRecord[],
  projectIds?: readonly string[],
): Record<string, ProjectStorageSummary> {
  const summaries: Record<string, ProjectStorageSummary> = Object.create(null) as Record<
    string,
    ProjectStorageSummary
  >;
  const requestedProjects = projectIds ? new Set(projectIds) : null;

  for (const projectId of projectIds ?? []) {
    summaries[projectId] = { bytes: 0, assetCount: 0 };
  }
  for (const asset of assets) {
    if (requestedProjects && !requestedProjects.has(asset.projectId)) continue;
    const current = summaries[asset.projectId] ?? { bytes: 0, assetCount: 0 };
    summaries[asset.projectId] = {
      bytes: current.bytes + normalizeByteSize(asset.size),
      assetCount: current.assetCount + 1,
    };
  }
  return summaries;
}

/** IEC-sized display with familiar short labels (B, KB, MB, GB, TB). */
export function formatBytes(bytes: unknown, language: 'ja' | 'en'): string {
  const safeBytes = normalizeByteSize(bytes);
  if (safeBytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.max(
    0,
    Math.min(Math.floor(Math.log(safeBytes) / Math.log(1024)), units.length - 1),
  );
  const value = safeBytes / 1024 ** unitIndex;
  const maximumFractionDigits = unitIndex === 0 || value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const formatted = new Intl.NumberFormat(language === 'ja' ? 'ja-JP' : 'en-US', {
    maximumFractionDigits,
  }).format(value);
  return `${formatted} ${units[unitIndex]}`;
}

export function formatStoragePercent(ratio: number): string {
  return `${Math.round(Math.max(0, ratio) * 100)}%`;
}
