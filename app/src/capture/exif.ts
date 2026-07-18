import type { CameraIntrinsicsHint, ImageAssetMetadata } from '../types';

/** 自前パーサが扱う、JPEGのEXIF/TIFFから直接読んだ値。 */
export interface ParsedExif {
  widthPx?: number;
  heightPx?: number;
  capturedAt?: string;
  cameraMake?: string;
  cameraModel?: string;
  orientation?: number;
  focalLengthMm?: number;
  focalLength35mm?: number;
  focalPlaneXResolution?: number;
  focalPlaneYResolution?: number;
  focalPlaneResolutionUnit?: number;
}

const EXIF_SCAN_LIMIT = 512 * 1024;
const FULL_FRAME_DIAGONAL_MM = Math.hypot(36, 24);

function finitePositive(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function normalizeExifDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.trim().match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!match) return undefined;
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}`;
}

function resolutionUnitMm(code: number | undefined): number | undefined {
  switch (code) {
    case 2:
      return 25.4; // inch
    case 3:
      return 10; // centimetre
    case 4:
      return 1; // millimetre
    case 5:
      return 0.001; // micrometre
    default:
      return undefined;
  }
}

/**
 * EXIF値と実際のデコード寸法から、将来SfMへ渡せる焦点距離(px)候補を組み立てる。
 * 純粋関数として分離し、実画像やDOMなしで検証できるようにしている。
 */
export function buildImageMetadata(
  exif: ParsedExif,
  decodedWidth: number,
  decodedHeight: number,
): ImageAssetMetadata {
  // 表示寸法はブラウザが実際にデコードした値を正本とする。EXIFのPixelX/YDimensionは
  // Orientationを反映しないことがあり、縦位置画像で幅・高さを逆表示してしまうため。
  const widthPx = finitePositive(decodedWidth) ? Math.round(decodedWidth) : undefined;
  const heightPx = finitePositive(decodedHeight) ? Math.round(decodedHeight) : undefined;
  const rawWidth = finitePositive(exif.widthPx) ? Math.round(exif.widthPx) : undefined;
  const rawHeight = finitePositive(exif.heightPx) ? Math.round(exif.heightPx) : undefined;
  const rotated = exif.orientation !== undefined && exif.orientation >= 5 && exif.orientation <= 8;
  const dimensionsAgree =
    rawWidth === undefined ||
    rawHeight === undefined ||
    widthPx === undefined ||
    heightPx === undefined ||
    (Math.abs((rotated ? rawHeight : rawWidth) - widthPx) <= 2 &&
      Math.abs((rotated ? rawWidth : rawHeight) - heightPx) <= 2);
  const sensorPixelWidth = dimensionsAgree ? rawWidth : undefined;
  const sensorPixelHeight = dimensionsAgree ? rawHeight : undefined;
  const intrinsics: CameraIntrinsicsHint = {};

  if (finitePositive(exif.focalLengthMm)) intrinsics.focalLengthMm = exif.focalLengthMm;
  if (finitePositive(exif.focalLength35mm)) {
    intrinsics.focalLength35mm = exif.focalLength35mm;
  }

  const unitMm = resolutionUnitMm(exif.focalPlaneResolutionUnit);
  if (unitMm && finitePositive(exif.focalPlaneXResolution) && sensorPixelWidth) {
    const sensorWidthMm = (sensorPixelWidth / exif.focalPlaneXResolution) * unitMm;
    if (sensorWidthMm >= 1 && sensorWidthMm <= 100) intrinsics.sensorWidthMm = sensorWidthMm;
  }
  if (unitMm && finitePositive(exif.focalPlaneYResolution) && sensorPixelHeight) {
    const sensorHeightMm = (sensorPixelHeight / exif.focalPlaneYResolution) * unitMm;
    if (sensorHeightMm >= 1 && sensorHeightMm <= 100) intrinsics.sensorHeightMm = sensorHeightMm;
  }

  if (
    intrinsics.focalLengthMm &&
    intrinsics.sensorWidthMm &&
    intrinsics.sensorHeightMm &&
    widthPx &&
    heightPx
  ) {
    // Orientationに依存しない対角長で、デコード後の座標系に合う焦点距離を求める。
    intrinsics.focalPx =
      (intrinsics.focalLengthMm * Math.hypot(widthPx, heightPx)) /
      Math.hypot(intrinsics.sensorWidthMm, intrinsics.sensorHeightMm);
    intrinsics.focalPxSource = 'exifFocalPlaneResolution';
  } else if (intrinsics.focalLengthMm && intrinsics.sensorWidthMm && sensorPixelWidth) {
    intrinsics.focalPx =
      (intrinsics.focalLengthMm * sensorPixelWidth) / intrinsics.sensorWidthMm;
    intrinsics.focalPxSource = 'exifFocalPlaneResolution';
  } else if (intrinsics.focalLength35mm && widthPx && heightPx) {
    // 35mm換算値は画角(対角)基準なので、アスペクト比に依存しない対角長で換算する。
    intrinsics.focalPx =
      (intrinsics.focalLength35mm * Math.hypot(widthPx, heightPx)) / FULL_FRAME_DIAGONAL_MM;
    intrinsics.focalPxSource = 'exif35mmEquivalent';
  }

  if (intrinsics.focalPx) intrinsics.focalPx = Math.round(intrinsics.focalPx * 100) / 100;
  if (intrinsics.sensorWidthMm) {
    intrinsics.sensorWidthMm = Math.round(intrinsics.sensorWidthMm * 1000) / 1000;
  }
  if (intrinsics.sensorHeightMm) {
    intrinsics.sensorHeightMm = Math.round(intrinsics.sensorHeightMm * 1000) / 1000;
  }

  return {
    widthPx,
    heightPx,
    capturedAt: exif.capturedAt,
    cameraMake: exif.cameraMake,
    cameraModel: exif.cameraModel,
    orientation: exif.orientation,
    intrinsics: Object.keys(intrinsics).length > 0 ? intrinsics : undefined,
  };
}

type TiffValue = number | string;

/**
 * JPEG APP1内のTIFF IFDを境界検査しながら読む軽量EXIFパーサ。
 * C-6で必要なタグだけを扱い、不正な入力は例外ではなく空結果へフォールバックする。
 */
export function parseExif(bytes: Uint8Array): ParsedExif {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return {};
  let cursor = 2;
  while (cursor + 4 <= bytes.length) {
    while (cursor < bytes.length && bytes[cursor] === 0xff) cursor++;
    if (cursor >= bytes.length) break;
    const marker = bytes[cursor++];
    if (marker === 0xda || marker === 0xd9) break;
    // SOI/TEM/RSTマーカーには長さフィールドがない。
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (cursor + 2 > bytes.length) break;
    const segmentLength = (bytes[cursor] << 8) | bytes[cursor + 1];
    if (segmentLength < 2 || cursor + segmentLength > bytes.length) break;
    const payload = cursor + 2;
    if (
      marker === 0xe1 &&
      segmentLength >= 8 &&
      bytes[payload] === 0x45 &&
      bytes[payload + 1] === 0x78 &&
      bytes[payload + 2] === 0x69 &&
      bytes[payload + 3] === 0x66 &&
      bytes[payload + 4] === 0 &&
      bytes[payload + 5] === 0
    ) {
      return parseTiff(bytes, payload + 6, cursor + segmentLength);
    }
    cursor += segmentLength;
  }
  return {};
}

function parseTiff(bytes: Uint8Array, start: number, end: number): ParsedExif {
  try {
    if (start + 8 > end) return {};
    const little = bytes[start] === 0x49 && bytes[start + 1] === 0x49;
    const big = bytes[start] === 0x4d && bytes[start + 1] === 0x4d;
    if (!little && !big) return {};
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const u16 = (at: number) => (at + 2 <= end ? view.getUint16(at, little) : undefined);
    const u32 = (at: number) => (at + 4 <= end ? view.getUint32(at, little) : undefined);
    const i32 = (at: number) => (at + 4 <= end ? view.getInt32(at, little) : undefined);
    if (u16(start + 2) !== 42) return {};

    const typeSize: Record<number, number> = {
      1: 1,
      2: 1,
      3: 2,
      4: 4,
      5: 8,
      7: 1,
      9: 4,
      10: 8,
    };

    const readIfd = (relativeOffset: number): Map<number, TiffValue> => {
      const result = new Map<number, TiffValue>();
      const base = start + relativeOffset;
      const count = u16(base);
      if (count === undefined || count > 1024 || base + 2 + count * 12 > end) return result;
      for (let index = 0; index < count; index++) {
        const entry = base + 2 + index * 12;
        const tag = u16(entry);
        const type = u16(entry + 2);
        const itemCount = u32(entry + 4);
        if (tag === undefined || type === undefined || itemCount === undefined) continue;
        const size = typeSize[type];
        if (!size || itemCount === 0 || itemCount > 1_000_000) continue;
        const byteLength = size * itemCount;
        const valueOffset = byteLength <= 4 ? entry + 8 : start + (u32(entry + 8) ?? end);
        if (valueOffset < start || valueOffset + byteLength > end) continue;

        let value: TiffValue | undefined;
        if (type === 2) {
          let text = '';
          for (let i = 0; i < itemCount && bytes[valueOffset + i] !== 0; i++) {
            const code = bytes[valueOffset + i];
            text += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : ' ';
          }
          value = text.trim();
        } else if (type === 3) {
          value = u16(valueOffset);
        } else if (type === 4) {
          value = u32(valueOffset);
        } else if (type === 9) {
          value = i32(valueOffset);
        } else if (type === 5 || type === 10) {
          const numerator = type === 5 ? u32(valueOffset) : i32(valueOffset);
          const denominator = type === 5 ? u32(valueOffset + 4) : i32(valueOffset + 4);
          if (numerator !== undefined && denominator) value = numerator / denominator;
        } else {
          value = bytes[valueOffset];
        }
        if (value !== undefined && value !== '') result.set(tag, value);
      }
      return result;
    };

    const firstIfdOffset = u32(start + 4);
    if (firstIfdOffset === undefined) return {};
    const ifd0 = readIfd(firstIfdOffset);
    const exifOffset = ifd0.get(0x8769);
    const exifIfd = typeof exifOffset === 'number' ? readIfd(exifOffset) : new Map<number, TiffValue>();
    const numberTag = (ifd: Map<number, TiffValue>, tag: number) => {
      const value = ifd.get(tag);
      return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    };
    const stringTag = (ifd: Map<number, TiffValue>, tag: number) => {
      const value = ifd.get(tag);
      return typeof value === 'string' ? value : undefined;
    };

    return {
      widthPx: numberTag(exifIfd, 0xa002) ?? numberTag(ifd0, 0x0100),
      heightPx: numberTag(exifIfd, 0xa003) ?? numberTag(ifd0, 0x0101),
      capturedAt: normalizeExifDate(
        stringTag(exifIfd, 0x9003) ??
          stringTag(exifIfd, 0x9004) ??
          stringTag(ifd0, 0x0132),
      ),
      cameraMake: stringTag(ifd0, 0x010f),
      cameraModel: stringTag(ifd0, 0x0110),
      orientation: numberTag(ifd0, 0x0112),
      focalLengthMm: numberTag(exifIfd, 0x920a),
      focalLength35mm: numberTag(exifIfd, 0xa405),
      focalPlaneXResolution: numberTag(exifIfd, 0xa20e),
      focalPlaneYResolution: numberTag(exifIfd, 0xa20f),
      focalPlaneResolutionUnit: numberTag(exifIfd, 0xa210),
    };
  } catch {
    return {};
  }
}

/** EXIF APP1は通常先頭64KiB以内。巨大画像を全読込せず必要十分な範囲だけ調べる。 */
export async function readExif(blob: Blob): Promise<ParsedExif> {
  const bytes = new Uint8Array(await blob.slice(0, EXIF_SCAN_LIMIT).arrayBuffer());
  return parseExif(bytes);
}
