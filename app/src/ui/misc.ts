export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function fmtDateTime(t: number, language: 'ja' | 'en' = 'ja'): string {
  return new Intl.DateTimeFormat(language === 'ja' ? 'ja-JP' : 'en-GB', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t));
}

/** ジョブの経過時間など、秒〜時間の大まかな表示。 */
export function fmtDuration(ms: number, language: 'ja' | 'en' = 'ja'): string {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return language === 'ja' ? `${seconds.toFixed(1)}秒` : `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return language === 'ja' ? `${minutes}分${rest}秒` : `${minutes} min ${rest} s`;
  const hours = Math.floor(minutes / 60);
  return language === 'ja' ? `${hours}時間${minutes % 60}分` : `${hours} h ${minutes % 60} min`;
}

export function timestampName(): string {
  const d = new Date();
  const p = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
