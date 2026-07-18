import { useEffect, useMemo, useRef, useState } from 'react';
import {
  attachAssetThumbnail,
  deleteAsset,
  getAssetBlob,
  listAssets,
  updateAsset,
} from '../db/assets';
import { useI18n } from '../i18n';
import type { AssetMeta } from '../types';
import { Badge, Section } from '../ui/common';
import { prepareImageAsset } from './imageUtil';

type Filter = 'all' | 'kept' | 'excluded';

function legacyNumber(asset: AssetMeta, key: string): number | undefined {
  const value = asset.meta?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function imageDimensions(asset: AssetMeta): { width?: number; height?: number } {
  return {
    width: asset.image?.widthPx ?? legacyNumber(asset, 'width'),
    height: asset.image?.heightPx ?? legacyNumber(asset, 'height'),
  };
}

function localCaptureTime(value: string | undefined): string | undefined {
  // EXIF日時には通常タイムゾーンがない。Dateへ変換せず、撮影機器のローカル値を表示する。
  return value?.replace('T', ' ');
}

function ImageDetailDialog(props: { asset: AssetMeta; onClose: () => void }) {
  const { tr } = useI18n();
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let createdUrl: string | undefined;
    setUrl(null);
    setFailed(false);
    void getAssetBlob(props.asset.id)
      .then((blob) => {
        if (!alive) return;
        if (!blob) {
          setFailed(true);
          return;
        }
        createdUrl = URL.createObjectURL(blob);
        setUrl(createdUrl);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [props.asset.id]);

  useEffect(() => {
    restoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        props.onClose();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(
        dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [props.onClose]);

  const { width, height } = imageDimensions(props.asset);
  const image = props.asset.image;
  const intrinsics = image?.intrinsics;
  return (
    <div className="manual-backdrop" role="presentation" onMouseDown={props.onClose}>
      <div
        ref={dialogRef}
        className="manual-dialog image-detail-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="image-detail-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="manual-head">
          <div>
            <p className="eyebrow">{tr('原画', 'Original image')}</p>
            <h2 id="image-detail-title">{props.asset.name}</h2>
          </div>
          <button ref={closeRef} type="button" className="mini" onClick={props.onClose}>
            {tr('閉じる', 'Close')}
          </button>
        </div>
        <div className="image-detail-content">
          <div className="image-detail-preview">
            {url ? (
              <img src={url} alt={props.asset.name} />
            ) : failed ? (
              <p className="warn-box">
                {tr('原画を読み込めませんでした。', 'The original image could not be loaded.')}
              </p>
            ) : (
              <p className="hint">{tr('原画を読み込み中…', 'Loading original image…')}</p>
            )}
          </div>
          <dl className="image-metadata">
            {width !== undefined && height !== undefined && (
              <>
                <dt>{tr('画像寸法', 'Dimensions')}</dt>
                <dd>{Math.round(width)} × {Math.round(height)} px</dd>
              </>
            )}
            {image?.capturedAt && (
              <>
                <dt>{tr('撮影日時', 'Captured')}</dt>
                <dd>
                  {localCaptureTime(image.capturedAt)} (
                  {tr('機器のローカル時刻', 'device local time')})
                </dd>
              </>
            )}
            {(image?.cameraMake || image?.cameraModel) && (
              <>
                <dt>{tr('カメラ', 'Camera')}</dt>
                <dd>{[image.cameraMake, image.cameraModel].filter(Boolean).join(' ')}</dd>
              </>
            )}
            {intrinsics?.focalLengthMm !== undefined && (
              <>
                <dt>{tr('焦点距離', 'Focal length')}</dt>
                <dd>{intrinsics.focalLengthMm.toFixed(2).replace(/\.00$/, '')} mm</dd>
              </>
            )}
            {intrinsics?.focalLength35mm !== undefined && (
              <>
                <dt>{tr('35mm換算', '35mm equivalent')}</dt>
                <dd>{intrinsics.focalLength35mm.toFixed(1).replace(/\.0$/, '')} mm</dd>
              </>
            )}
            {(intrinsics?.sensorWidthMm !== undefined ||
              intrinsics?.sensorHeightMm !== undefined) && (
              <>
                <dt>{tr('撮像素子の推定寸法', 'Estimated sensor size')}</dt>
                <dd>
                  {intrinsics.sensorWidthMm?.toFixed(2) ?? '?'} ×{' '}
                  {intrinsics.sensorHeightMm?.toFixed(2) ?? '?'} mm
                </dd>
              </>
            )}
            {intrinsics?.focalPx !== undefined && (
              <>
                <dt>{tr('焦点距離の初期値候補', 'Focal-length hint')}</dt>
                <dd>
                  {Math.round(intrinsics.focalPx)} px (
                  {intrinsics.focalPxSource === 'exifFocalPlaneResolution'
                    ? tr('EXIF撮像面解像度から推定', 'estimated from EXIF focal-plane resolution')
                    : tr('35mm換算値から推定', 'estimated from 35mm equivalent')}
                  )
                </dd>
              </>
            )}
            {image?.orientation !== undefined && (
              <>
                <dt>{tr('EXIF向き', 'EXIF orientation')}</dt>
                <dd>{image.orientation}</dd>
              </>
            )}
          </dl>
        </div>
      </div>
    </div>
  );
}

/**
 * 画像一覧(1B-4)。一覧では256px JPEGサムネイルだけを読み、原画は詳細表示時だけ読む。
 * 旧DB/旧ZIPにサムネイルがなければ一度だけ原画から生成し、次回以降は同じ経路に揃える。
 */
export function Gallery(props: { projectId: string; refreshKey: number; onChanged: () => void }) {
  const { tr } = useI18n();
  const [assets, setAssets] = useState<AssetMeta[]>([]);
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<AssetMeta | null>(null);
  const [thumbnailFailures, setThumbnailFailures] = useState(0);

  useEffect(() => {
    let alive = true;
    const createdUrls: string[] = [];
    void (async () => {
      const list = await listAssets(props.projectId, ['image', 'frame']);
      if (!alive) return;
      setAssets(list);
      setUrls(new Map());
      setThumbnailFailures(0);
      const map = new Map<string, string>();
      const resolved = new Map<string, AssetMeta>();
      let failures = 0;

      for (const initial of list) {
        if (!alive) break;
        let asset = initial;
        let thumbnailBlob = asset.thumbnailAssetId
          ? await getAssetBlob(asset.thumbnailAssetId)
          : undefined;
        if (!alive) break;
        if (!thumbnailBlob) {
          // 後方互換: 旧ZIP/DBだけを一度読み、サムネイルを永続化する。
          try {
            const original = await getAssetBlob(asset.id);
            if (!alive) break;
            if (original) {
              const generated = await prepareImageAsset(original);
              if (!alive) break;
              asset =
                (await attachAssetThumbnail(asset.id, {
                  blob: generated.thumbnail.blob,
                  width: generated.thumbnail.width,
                  height: generated.thumbnail.height,
                })) ?? asset;
              if (!alive) break;
              if (!asset.image) {
                const meta = {
                  ...asset.meta,
                  width: generated.image.widthPx,
                  height: generated.image.heightPx,
                };
                await updateAsset(asset.id, { image: generated.image, meta });
                if (!alive) break;
                asset = { ...asset, image: generated.image, meta };
              }
              thumbnailBlob = asset.thumbnailAssetId
                ? await getAssetBlob(asset.thumbnailAssetId)
                : undefined;
              if (!alive) break;
            }
          } catch {
            // 1件の未知画像形式で、他の画像一覧まで失敗させない。
          }
        }
        if (!alive) break;
        resolved.set(asset.id, asset);
        if (thumbnailBlob) {
          const url = URL.createObjectURL(thumbnailBlob);
          createdUrls.push(url);
          map.set(asset.id, url);
        } else {
          failures++;
        }
      }

      if (alive) {
        setAssets((current) =>
          current.map((asset) => {
            const migrated = resolved.get(asset.id);
            return migrated
              ? {
                  ...asset,
                  thumbnailAssetId: migrated.thumbnailAssetId,
                  image: migrated.image,
                  meta: migrated.meta,
                }
              : asset;
          }),
        );
        setUrls(new Map(map));
        setThumbnailFailures(failures);
      }
    })().catch(() => {
      // 一覧構築が途中で失敗した場合、まだstateへ渡していないURLもその場で破棄する。
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
      createdUrls.length = 0;
      if (alive) setThumbnailFailures((count) => Math.max(1, count));
    });
    return () => {
      alive = false;
      createdUrls.forEach((url) => URL.revokeObjectURL(url));
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
    for (const target of targets) await updateAsset(target.id, { excluded: true });
    setAssets((prev) =>
      prev.map((asset) =>
        asset.quality?.sharp === false ? { ...asset, excluded: true } : asset,
      ),
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
    if (selected?.id === a.id) setSelected(null);
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
          <select
            value={filter}
            aria-label={tr('画像の表示フィルター', 'Image display filter')}
            onChange={(e) => setFilter(e.target.value as Filter)}
          >
            <option value="all">{tr('すべて', 'All')}</option>
            <option value="kept">{tr('採用のみ', 'Kept')}</option>
            <option value="excluded">{tr('除外のみ', 'Excluded')}</option>
          </select>
          <button type="button" onClick={() => void excludeBlurry()}>
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
          {shown.map((a) => {
            const { width, height } = imageDimensions(a);
            const intrinsics = a.image?.intrinsics;
            return (
              <figure key={a.id} className={`shot ${a.excluded ? 'excluded' : ''}`}>
                <button
                  type="button"
                  className="shot-toggle"
                  onClick={() => setSelected(a)}
                  aria-haspopup="dialog"
                  aria-label={tr(
                    `「${a.name}」の原画と情報を表示`,
                    `View original image and details for “${a.name}”`,
                  )}
                  title={tr(`${a.name}(詳細を表示)`, `${a.name} (view details)`)}
                >
                  {urls.get(a.id) ? (
                    <img src={urls.get(a.id)} alt={a.name} loading="lazy" />
                  ) : (
                    <div className="shot-loading">…</div>
                  )}
                </button>
                <figcaption>
                  <div className="shot-caption-row">
                    <span>{a.kind === 'frame' ? 'F' : 'P'}</span>
                    {a.quality?.blur !== undefined && (
                      <Badge tone={a.quality.sharp ? 'ok' : 'warn'}>{a.quality.blur}</Badge>
                    )}
                    {a.excluded && <Badge tone="err">{tr('除外', 'Excluded')}</Badge>}
                    <button
                      type="button"
                      className="mini"
                      aria-label={tr(
                        a.excluded ? `「${a.name}」を採用に戻す` : `「${a.name}」を除外する`,
                        a.excluded ? `Mark “${a.name}” as kept` : `Exclude “${a.name}”`,
                      )}
                      onClick={() => void toggle(a)}
                    >
                      {a.excluded ? tr('採用', 'Keep') : tr('除外', 'Exclude')}
                    </button>
                    <button
                      type="button"
                      className="mini danger"
                      aria-label={tr(`「${a.name}」を削除`, `Delete “${a.name}”`)}
                      title={tr(`「${a.name}」を削除`, `Delete “${a.name}”`)}
                      onClick={() => void remove(a)}
                    >
                      ✕
                    </button>
                  </div>
                  <div className="shot-meta">
                    {width !== undefined && height !== undefined && (
                      <span>{Math.round(width)} × {Math.round(height)} px</span>
                    )}
                    {(intrinsics?.focalLengthMm !== undefined ||
                      intrinsics?.focalLength35mm !== undefined) && (
                      <span>
                        {intrinsics.focalLengthMm !== undefined
                          ? `${tr('焦点', 'Focal')} ${intrinsics.focalLengthMm
                              .toFixed(2)
                              .replace(/\.00$/, '')} mm`
                          : tr('焦点距離', 'Focal length')}
                        {intrinsics.focalLength35mm !== undefined
                          ? ` (${tr('35mm換算', '35mm eq.')} ${intrinsics.focalLength35mm.toFixed(1).replace(/\.0$/, '')} mm)`
                          : ''}
                      </span>
                    )}
                    {(intrinsics?.sensorWidthMm !== undefined ||
                      intrinsics?.sensorHeightMm !== undefined) && (
                      <span>
                        {tr('推定撮像素子', 'Estimated sensor')}{' '}
                        {intrinsics.sensorWidthMm?.toFixed(2) ?? '?'} ×{' '}
                        {intrinsics.sensorHeightMm?.toFixed(2) ?? '?'} mm
                      </span>
                    )}
                    {a.image?.capturedAt && <span>{localCaptureTime(a.image.capturedAt)}</span>}
                  </div>
                </figcaption>
              </figure>
            );
          })}
        </div>
      )}
      {thumbnailFailures > 0 && (
        <p className="warn-box">
          {tr(
            `${thumbnailFailures}枚のサムネイルを作成できませんでした。カードから原画の読込を試せます。`,
            `Could not create ${thumbnailFailures} thumbnail(s). You can still try opening the original from the card.`,
          )}
        </p>
      )}
      <p className="hint">
        {tr(
          'カードを選ぶと原画と撮影情報を表示します。数値はブレ判定スコア(大きいほど鮮明)。P=撮影/取込画像、F=動画からの抽出フレーム。',
          'Select a card to view the original and capture details. The number is a blur score (higher is sharper). P = captured/imported image; F = extracted video frame.',
        )}
      </p>
      {selected && <ImageDetailDialog asset={selected} onClose={() => setSelected(null)} />}
    </Section>
  );
}
