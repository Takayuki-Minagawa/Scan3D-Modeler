/** 取込ファイルの分類とドロップ/フォルダ選択の展開(DOM型だけに依存する純粋処理)。 */

export type ImportFileKind = 'image' | 'video' | 'skip';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'mov', 'webm', 'mkv', 'ogv']);

/** MIMEが空のファイル(OS・ブラウザによりHEIC等で起こる)は拡張子で補う。 */
export function classifyImportFile(file: { name: string; type: string }): ImportFileKind {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type) return 'skip';
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTENSIONS.has(extension)) return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return 'skip';
}

/** 一括取込の順序を安定させる(フォルダ選択・ドロップの列挙順はブラウザ依存)。 */
export function sortImportFiles<T extends { name: string; webkitRelativePath?: string }>(files: T[]): T[] {
  const key = (file: T) => file.webkitRelativePath || file.name;
  return [...files].sort((a, b) => key(a).localeCompare(key(b), undefined, { numeric: true }));
}

async function readDirectory(entry: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = entry.createReader();
  const children: FileSystemEntry[] = [];
  // readEntriesは1回で全件を返さないため、空配列になるまで繰り返す。
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) break;
    children.push(...batch);
  }
  const nested = await Promise.all(children.map(readEntry));
  return nested.flat();
}

async function readEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    return [file];
  }
  if (entry.isDirectory) return readDirectory(entry as FileSystemDirectoryEntry);
  return [];
}

/** ドロップされたファイルとフォルダ(再帰)を平坦なファイル配列にする。 */
export async function filesFromDataTransfer(transfer: DataTransfer): Promise<File[]> {
  const items = Array.from(transfer.items ?? []);
  const entries = items
    .filter((item) => item.kind === 'file')
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (entries.length === 0) return Array.from(transfer.files);
  const nested = await Promise.all(entries.map(readEntry));
  return nested.flat();
}
