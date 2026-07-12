import { strToU8, strFromU8, unzip, zip, type Zippable } from 'fflate';
import { db, uid, now } from '../db/db';
import type { AssetMeta, Project, Stage } from '../types';

/**
 * プロジェクトZIP入出力(作業計画 1A-3)。
 * スマホで撮影 → ZIPで持ち出し → PCブラウザで処理継続、という
 * 端末間の引き継ぎ経路を兼ねる(リスクR1/R2対策)。
 *
 * ZIP構成:
 *   project.json     … マニフェスト(プロジェクト+段階+アセットメタ)
 *   assets/<id>      … 各アセットのバイナリ
 *
 * ジョブ実行状態(checkpoint含む)は端末ローカルの実行状態のため含めない。
 * したがって実行中(running)のstageは、取り込み先で再開できず永久に
 * 実行中のまま残ってしまうため、エクスポート対象から除外する。
 */
interface Manifest {
  format: 'scan2fem-project';
  version: 1;
  exportedAt: number;
  project: Project;
  stages: Stage[];
  assets: AssetMeta[];
}

export interface ExportZipResult {
  blob: Blob;
  /** 実行中(未完了)のため除外した段階数 */
  excludedRunningStages: number;
}

function zipAsync(data: Zippable): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    zip(data, { level: 0 }, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

function unzipAsync(data: Uint8Array): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    unzip(data, (err, out) => (err ? reject(err) : resolve(out)));
  });
}

export async function exportProjectZip(projectId: string): Promise<ExportZipResult> {
  const d = await db();
  // 実行中ジョブはstage/assetを書き換え続けるため、まず停止を求める
  const jobs = await d.getAllFromIndex('jobs', 'byProject', projectId);
  if (jobs.some((j) => j.status === 'running')) {
    throw new Error(
      '実行中のジョブがあります。一時停止または完了させてからエクスポートしてください',
    );
  }

  // 単一トランザクションで読み出し、途中で変更が入らない一貫した
  // スナップショットを取る(stage参照切れ・blob欠落の混入防止)。
  // 注意: このトランザクション内でIndexedDB以外のawaitを挟まないこと
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs']);
  const project = await tx.objectStore('projects').get(projectId);
  if (!project) throw new Error('プロジェクトが見つかりません');
  const allStages = await tx.objectStore('stages').index('byProject').getAll(projectId);
  const allAssets = await tx.objectStore('assets').index('byProject').getAll(projectId);
  const stages = allStages.filter((s) => s.status !== 'running');
  const stageIds = new Set(stages.map((s) => s.id));
  const assets = allAssets.filter((a) => a.stageId === null || stageIds.has(a.stageId));
  const blobs = new Map<string, Blob>();
  for (const a of assets) {
    const rec = await tx.objectStore('blobs').get(a.id);
    if (!rec) {
      throw new Error(
        `アセット「${a.name}」の本体データが見つかりません(データ破損の可能性)。エクスポートを中止しました`,
      );
    }
    blobs.set(a.id, rec.blob);
  }
  await tx.done;

  const manifest: Manifest = {
    format: 'scan2fem-project',
    version: 1,
    exportedAt: now(),
    project,
    stages,
    assets,
  };
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify(manifest, null, 1)),
  };
  for (const a of assets) {
    const blob = blobs.get(a.id);
    if (blob) files[`assets/${a.id}`] = new Uint8Array(await blob.arrayBuffer());
  }
  const out = await zipAsync(files);
  const buf = new ArrayBuffer(out.byteLength);
  new Uint8Array(buf).set(out);
  return {
    blob: new Blob([buf], { type: 'application/zip' }),
    excludedRunningStages: allStages.length - stages.length,
  };
}

/** インポート。ID衝突を避けるため全IDを振り直して新規プロジェクトとして取り込む */
export async function importProjectZip(file: Blob): Promise<Project> {
  const entries = await unzipAsync(new Uint8Array(await file.arrayBuffer()));
  const manifestRaw = entries['project.json'];
  if (!manifestRaw) throw new Error('project.json がありません(scan2femのZIPではありません)');
  const manifest = JSON.parse(strFromU8(manifestRaw)) as Manifest;
  if (manifest.format !== 'scan2fem-project') {
    throw new Error('対応していない形式です');
  }

  const idMap = new Map<string, string>();
  const remap = (oldId: string): string => {
    let v = idMap.get(oldId);
    if (!v) {
      v = uid();
      idMap.set(oldId, v);
    }
    return v;
  };

  const t = now();
  const project: Project = {
    ...manifest.project,
    id: remap(manifest.project.id),
    name: `${manifest.project.name}(インポート)`,
    updatedAt: t,
  };
  const stages: Stage[] = manifest.stages.map((s) => ({
    ...s,
    id: remap(s.id),
    projectId: project.id,
    sourceStageId: s.sourceStageId ? remap(s.sourceStageId) : null,
    // 旧形式ZIPに実行中stageが含まれる場合、ジョブ実行状態(checkpoint)は
    // 引き継げないため失敗扱いに変換する(永久に実行中のまま残るのを防ぐ)
    ...(s.status === 'running'
      ? {
          status: 'failed' as const,
          note: [s.note, '実行途中に出力されたZIPのため中断扱い'].filter(Boolean).join(' / '),
        }
      : null),
  }));
  const assets: Array<{ meta: AssetMeta; oldId: string }> = manifest.assets.map((a) => ({
    oldId: a.id,
    meta: {
      ...a,
      id: remap(a.id),
      projectId: project.id,
      stageId: a.stageId ? remap(a.stageId) : null,
    },
  }));

  const d = await db();
  const tx = d.transaction(['projects', 'stages', 'assets', 'blobs'], 'readwrite');
  const puts: Promise<unknown>[] = [tx.objectStore('projects').put(project)];
  for (const s of stages) puts.push(tx.objectStore('stages').put(s));
  for (const { meta, oldId } of assets) {
    puts.push(tx.objectStore('assets').put(meta));
    const data = entries[`assets/${oldId}`];
    if (data) {
      const buf = new ArrayBuffer(data.byteLength);
      new Uint8Array(buf).set(data);
      puts.push(
        tx
          .objectStore('blobs')
          .put({ assetId: meta.id, blob: new Blob([buf], { type: meta.mime }) }),
      );
    }
  }
  await Promise.all(puts);
  await tx.done;
  return project;
}
