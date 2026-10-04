/** Shared limits for project ZIP restoration and export preflight. */
export const MAX_ZIP_BYTES = 1024 * 1024 * 1024;
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 1024 * 1024 * 1024;
export const MAX_IN_MEMORY_IMPORT_BYTES = 64 * 1024 * 1024;
export const MAX_IN_MEMORY_EXPORT_BYTES = 128 * 1024 * 1024;
export const MAX_ENTRIES = 10_000;
export const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
export const MAX_CENTRAL_DIRECTORY_BYTES = 16 * 1024 * 1024;

export function allowedEntryName(name: string): boolean {
  if (name === 'project.json') return true;
  if (!name.startsWith('assets/')) return false;
  const id = name.slice('assets/'.length);
  return id.length >= 1 && id.length <= 128 && !/[^A-Za-z0-9_-]/.test(id);
}

interface ExportAssetSize {
  id: string;
  size: number;
}

export interface ZipExportLayout {
  entryCount: number;
  expandedBytes: number;
  zipBytes: number;
}

function cannotExport(reason: string): never {
  throw new Error(`復元できるZIPを作成できません: ${reason}。元のプロジェクトは削除しないでください`);
}

/**
 * Calculate the exact size of streamSnapshot's uncompressed ZIP without reading asset bodies.
 * Each ZipPassThrough entry has a 30-byte local header, a 16-byte data descriptor,
 * and a 46-byte central-directory record. Names occur twice; EOCD adds 22 bytes.
 * This assumes no entry comments or extra fields, as in streamSnapshot.
 */
export function validateZipExportLayout(
  manifestByteLength: number,
  assets: readonly ExportAssetSize[],
): ZipExportLayout {
  if (!Number.isSafeInteger(manifestByteLength) || manifestByteLength <= 0 ||
      manifestByteLength > MAX_MANIFEST_BYTES) {
    cannotExport('プロジェクト情報が8MiBの上限を超えているか不正です');
  }
  const entryCount = assets.length + 1;
  if (entryCount > MAX_ENTRIES) cannotExport('アセット数が9,999件の上限を超えています');

  const manifestNameLength = 'project.json'.length;
  let expandedBytes = manifestByteLength;
  let zipBytes = 22 + manifestByteLength + 92 + 2 * manifestNameLength;
  const names = new Set<string>();
  for (const asset of assets) {
    const name = `assets/${asset.id}`;
    if (!allowedEntryName(name) || names.has(name)) {
      cannotExport('アセットIDが不正または重複しています');
    }
    names.add(name);
    if (!Number.isSafeInteger(asset.size) || asset.size < 0 || asset.size > MAX_ENTRY_BYTES) {
      cannotExport('1件のアセットが256MiBの上限を超えているかサイズが不正です');
    }
    // Allowed entry names are ASCII, so their UTF-8 byte length equals string.length.
    expandedBytes += asset.size;
    zipBytes += asset.size + 92 + 2 * name.length;
  }
  if (expandedBytes > MAX_EXPANDED_BYTES || zipBytes > MAX_ZIP_BYTES) {
    cannotExport('ZIP全体が1GiBの上限を超えています');
  }
  return { entryCount, expandedBytes, zipBytes };
}
