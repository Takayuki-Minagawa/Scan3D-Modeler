import { addAsset } from '../db/assets';
import { uid } from '../db/db';
import { createStage, deleteStageCascade, getStage, setStageStatus } from '../db/stages';
import { encodeMeshBinary } from '../export/formats';
import { throwIfStopped, type JobContext } from '../jobs/runner';
import { makeDemoLMesh } from './demoMesh';

/**
 * デモ再構成エンジン(合成データ)。
 * 実際のSfM/MVSはフェーズ0検証後に実装するため(reconstructStub参照)、
 * ビューア・段階データ・出力・ジョブ再開の動作確認用に、
 * 穴付きL型ブラケットの合成点群+L字サーフェスを生成する。
 *
 * チャンク単位で生成し、チャンク番号をチェックポイント保存する。
 * 再開時は完了済みチャンクを高速再生成(決定論的)して続きから進める。
 *
 * 成果物の保存は次の手順で冪等にする(保存途中に落ちても重複を作らない):
 *   1. stage IDを先に採番してcheckpointへ保存
 *   2. 同IDの作りかけstageが残っていれば掃除(deleteStageCascade)
 *   3. 同IDでstage作成 → アセット保存 → ready
 * 再開時にそのstageがready済みなら、その工程を丸ごとスキップする。
 */
export interface DemoParams {
  chunks: number;
  pointsPerChunk: number;
  seed: number;
  [key: string]: unknown;
}

interface DemoCheckpoint {
  nextChunk: number;
  denseStageId?: string;
  surfaceStageId?: string;
}

export const DEMO_DEFAULT_PARAMS: DemoParams = {
  chunks: 24,
  pointsPerChunk: 3000,
  seed: 20260712,
};

function requestChunk(worker: Worker, chunk: number, n: number, seed: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<{ type: string; chunk: number; points: Float32Array }>) => {
      if (ev.data.type === 'chunk' && ev.data.chunk === chunk) {
        worker.removeEventListener('message', onMessage);
        resolve(ev.data.points);
      }
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', (e) => reject(new Error(e.message)), { once: true });
    worker.postMessage({ type: 'gen', chunk, n, seed });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** stageがready済みか(冪等な再開のスキップ判定) */
async function stageIsReady(stageId: string | undefined): Promise<boolean> {
  if (!stageId) return false;
  return (await getStage(stageId))?.status === 'ready';
}

export async function demoReconstructEngine(
  ctx: JobContext<DemoParams, DemoCheckpoint>,
): Promise<void> {
  const { chunks, pointsPerChunk, seed } = ctx.params;
  const cp: DemoCheckpoint = { nextChunk: 0, ...(ctx.checkpoint ?? {}) };

  // --- 密点群(dense)。保存済みなら点群生成ごとスキップ ---
  if (!(await stageIsReady(cp.denseStageId))) {
    const worker = new Worker(new URL('../workers/demoCloud.worker.ts', import.meta.url), {
      type: 'module',
    });
    try {
      const parts: Float32Array[] = [];
      // 完了済みチャンクの高速再生成(決定論的なので同一結果になる)
      for (let c = 0; c < cp.nextChunk; c++) {
        parts.push(await requestChunk(worker, c, pointsPerChunk, seed));
      }
      for (let c = cp.nextChunk; c < chunks; c++) {
        throwIfStopped(ctx.signal);
        parts.push(await requestChunk(worker, c, pointsPerChunk, seed));
        // 実処理(SfM/MVS)の計算負荷を模した待ち。進捗・一時停止の動作確認用
        await sleep(150);
        cp.nextChunk = c + 1;
        await ctx.saveCheckpoint({ ...cp });
        ctx.report((c + 1) / (chunks + 1), `点群生成 ${c + 1}/${chunks} チャンク(デモ)`);
      }

      // 点群を1つのアセットに結合して保存(内部形式: 生のFloat32 xyz列)
      const total = parts.reduce((s, p) => s + p.length, 0);
      const points = new Float32Array(total);
      let off = 0;
      for (const p of parts) {
        points.set(p, off);
        off += p.length;
      }
      cp.denseStageId ??= uid();
      await ctx.saveCheckpoint({ ...cp });
      const leftover = await getStage(cp.denseStageId);
      if (leftover) await deleteStageCascade(cp.denseStageId); // 前回の作りかけを掃除
      const denseStage = await createStage(ctx.job.projectId, 'dense', {
        id: cp.denseStageId,
        demo: true,
        params: { ...ctx.params },
        note: 'デモ生成(合成データ。実撮影由来ではありません)',
      });
      await ctx.bindStage(denseStage.id);
      await addAsset({
        projectId: ctx.job.projectId,
        stageId: denseStage.id,
        kind: 'pointcloud',
        name: 'demo_dense_points.f32',
        blob: new Blob([points.buffer], { type: 'application/octet-stream' }),
        meta: { count: total / 3, unit: 'mm' },
      });
      await setStageStatus(denseStage.id, 'ready', { 点数: total / 3 });
      ctx.notifyDataChanged(); // 完了前でも点群をビューア等へ反映させる
    } finally {
      worker.terminate();
    }
  }

  throwIfStopped(ctx.signal);

  // --- デモサーフェス(L字押し出し)。同様に冪等 ---
  if (!(await stageIsReady(cp.surfaceStageId))) {
    ctx.report(0.98, 'デモサーフェス生成中');
    const mesh = makeDemoLMesh();
    cp.surfaceStageId ??= uid();
    await ctx.saveCheckpoint({ ...cp });
    const leftover = await getStage(cp.surfaceStageId);
    if (leftover) await deleteStageCascade(cp.surfaceStageId);
    const surfaceStage = await createStage(ctx.job.projectId, 'surface', {
      id: cp.surfaceStageId,
      demo: true,
      sourceStageId: cp.denseStageId ?? null,
      note: 'デモ生成(合成データ)',
    });
    await ctx.bindStage(surfaceStage.id);
    await addAsset({
      projectId: ctx.job.projectId,
      stageId: surfaceStage.id,
      kind: 'mesh',
      name: 'demo_surface.mesh',
      blob: new Blob([encodeMeshBinary(mesh.positions, mesh.indices)], {
        type: 'application/octet-stream',
      }),
      meta: { vertices: mesh.positions.length / 3, triangles: mesh.indices.length / 3, unit: 'mm' },
    });
    await setStageStatus(surfaceStage.id, 'ready', {
      頂点数: mesh.positions.length / 3,
      三角形数: mesh.indices.length / 3,
    });
    ctx.notifyDataChanged();
  }

  // 停止契約: surface保存中(複数await)に届いた停止要求もdone確定前に必ず
  // 観測する。成果物は保存済み+冪等なので、ここで一時停止しても再開時は
  // ready済み工程をスキップしてすぐ完了する
  throwIfStopped(ctx.signal);
}
