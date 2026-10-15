import type { ApproxSize } from '../types';

export type ProjectValidationError = 'nameRequired' | 'objectNameRequired' | 'sizeNotNumber' | 'sizeNotPositive';

export interface ProjectFormInput {
  name: string;
  objectName: string;
  w: string;
  h: string;
  d: string;
}

export type ProjectValidation =
  | { ok: true; value: { name: string; objectName: string; approxSize: ApproxSize } }
  | { ok: false; errors: ProjectValidationError[] };

/** 概算寸法は後段(校正後寸法との整合確認)に使うため、3辺とも正の有限値を必須にする。 */
export function validateProjectInput(input: ProjectFormInput): ProjectValidation {
  const errors: ProjectValidationError[] = [];
  const name = input.name.trim();
  const objectName = input.objectName.trim();
  if (!name) errors.push('nameRequired');
  if (!objectName) errors.push('objectNameRequired');
  const sizes = [input.w, input.h, input.d].map((raw) => (raw.trim() ? Number(raw) : Number.NaN));
  if (sizes.some((value) => !Number.isFinite(value))) errors.push('sizeNotNumber');
  else if (sizes.some((value) => value <= 0)) errors.push('sizeNotPositive');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { name, objectName, approxSize: { w: sizes[0], h: sizes[1], d: sizes[2] } } };
}

/**
 * 診断で得た外接箱の最大辺と、作成時の概算寸法の最大辺の比。
 * 10倍以上食い違う場合に単位・校正の確認を促す。概算寸法が未設定(0)なら判定しない。
 */
export function approxSizeMismatchRatio(approx: ApproxSize, measuredSize: readonly number[]): number | null {
  const expected = Math.max(approx.w, approx.h, approx.d);
  const measured = Math.max(...measuredSize);
  if (!(expected > 0) || !(measured > 0) || !Number.isFinite(expected) || !Number.isFinite(measured)) return null;
  const ratio = measured / expected;
  return ratio >= 10 || ratio <= 0.1 ? ratio : null;
}
