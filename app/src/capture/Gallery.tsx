import { useEffect, useMemo, useState } from 'react';
import { deleteAsset, getAssetBlob, listAssets, updateAsset } from '../db/assets';
import { useI18n } from '../i18n';
import type { AssetMeta } from '../types';
import { Badge, Section } from '../ui/common';

type Filter = 'all' | 'kept' | 'excluded';

/**
 * 画像一覧(1B-4)。撮影/取込画像とキーフレームを一覧し、
 * ブレスコア表示・採用/除外の切り替え・一括除外を行う。
 */
export function Gallery(props: { projectId: string; refreshKey: number; onChanged: () => void }) {
  const { tr } = useI18n();
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    (async () => {
      const list = await listAssets(props.projectId, ['image', 'frame']);
      if (!alive) return;
      setAssets(list);
      const map = new Map<string, string>();
      for (const a of list) {
        const blob = await getAssetBlob(a.id);
        if (!alive) break;
        if (blob) {
          const url = URL.createObjectURL(blob);
          created.push(url);
          map.set(a.id, url);
        }
      }
      if (alive) setUrls(new Map(map));
    })();
    return () => {
      alive = false;
      created.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [props.projectId, props.refreshKey]);

  const shown = useMemo(
    () =>
      assets.filter((a) =>
        filter === 'all' ? true : filter === 'kept' ? !a.excluded : !!a.excluded,
      ),
    [assets, filter],
  );
  const keptCount = assets.filter((a) => !a.excluded).length;

  async function toggle(a: AssetMeta) {
    await updateAsset(a.id, { excluded: !a.excluded });
    setAssets((prev) => prev.map((x) => (x.id === a.id ? { ...x, excluded: !a.excluded } : x)));
    props.onChanged();
  }

  async function excludeBlurry() {
    const targets = assets.filter((a) => a.quality?.sharp === false && !a.excluded);
    for (const t of targets) await updateAsset(t.id, { excluded: true });
    setAssets((prev) =>
      prev.map((x) => (x.quality?.sharp === false ? { ...x, excluded: true } : x)),
    );
    props.onChanged();
  }

  async function remove(a: AssetMeta) {
    if (
      !window.confirm(
        tr(
          `「${a.name}」を削除しますか?(元に戻せません)`,
          `Delete “${a.name}”? This cannot be undone.`,
        ),
      )
    ) {
      return;
    }
    await deleteAsset(a.id);
    setAssets((prev) => prev.filter((x) => x.id !== a.id));
    props.onChanged();
  }

  return (
    <Section
      title={tr(
        `画像セット(採用 ${keptCount} / 全 ${assets.length}枚)`,
        `Image set (kept ${keptCount} / ${assets.length} total)`,
      )}
      aside={
        <div className="row">
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
            <option value="all">{tr('すべて', 'All')}</option>
            <option value="kept">{tr('採用のみ', 'Kept')}</option>
            <option value="excluded">{tr('除外のみ', 'Excluded')}</option>
          </select>
          <button onClick={() => void excludeBlurry()}>
            {tr('ブレ画像を一括除外', 'Exclude blurry images')}
          </button>
        </div>
      }
    >
      {assets.length === 0 ? (
        <p className="hint">
          {tr(
            '画像がまだありません。「取込」タブでカメラ撮影またはファイル取込を行ってください。',
            'No images yet. Use the Import tab to capture images with a camera or import files.',
          )}
        </p>
      ) : (
        <div className="gallery">
          {shown.map((a) => (
            <figure
              key={a.id}
              className={`shot ${a.excluded ? 'excluded' : ''}`}
            >
              <button
                type="button"
                className="shot-toggle"
                onClick={() => void toggle(a)}
                aria-label={tr(
                  a.excluded ? `「${a.name}」を採用に戻す` : `「${a.name}」を除外する`,
                  a.excluded ? `Mark “${a.name}” as kept` : `Exclude “${a.name}”`,
                )}
                title={tr(
                  `${a.name}(採用/除外を切替)`,
                  `${a.name} (toggle kept/excluded)`,
                )}
              >
                {urls.get(a.id) ? (
                  <img src={urls.get(a.id)} alt={a.name} loading="lazy" />
                ) : (
                  <div className="shot-loading">…</div>
                )}
              </button>
              <figcaption>
                {a.kind === 'frame' ? 'F' : 'P'}
                {a.quality?.blur !== undefined && (
                  <Badge tone={a.quality.sharp ? 'ok' : 'warn'}>{a.quality.blur}</Badge>
                )}
                {a.excluded && <Badge tone="err">{tr('除外', 'Excluded')}</Badge>}
                <button
                  className="mini danger"
                  aria-label={tr(`「${a.name}」を削除`, `Delete “${a.name}”`)}
                  title={tr(`「${a.name}」を削除`, `Delete “${a.name}”`)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void remove(a);
                  }}
                >
                  ✕
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <p className="hint">
        {tr(
          '数値はブレ判定スコア(ラプラシアン分散。大きいほど鮮明)。P=撮影/取込画像、F=動画からの抽出フレーム。',
          'Numbers are blur-detection scores (Laplacian variance; higher is sharper). P = captured/imported image, F = frame extracted from a video.',
        )}
      </p>
    </Section>
  );
}
