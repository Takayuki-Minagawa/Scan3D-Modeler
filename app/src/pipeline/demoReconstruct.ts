import { addAsset } from '../db/assets';
import { createStage, setStageStatus } from '../db/stages';
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
 */
export interface DemoParams {
  chunks: number;
  pointsPerChunk: number;
  seed: number;
  [key: string]: unknown;
}

interface DemoCheckpoint {
  nextChunk: number;
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

export async function demoReconstructEngine(
  ctx: JobContext<DemoParams, DemoCheckpoint>,
): Promise<void> {
  const { chunks, pointsPerChunk, seed } = ctx.params;
  const startChunk = ctx.checkpoint?.nextChunk ?? 0;
  const worker = new Worker(new URL('../workers/demoCloud.worker.ts', import.meta.url), {
    type: 'module',
  });
  try {
    const parts: Float32Array[] = [];
    // 完了済みチャンクの高速再生成(決定論的なので同一結果になる)
    for (let c = 0; c < startChunk; c++) {
      parts.push(await requestChunk(worker, c, pointsPerChunk, seed));
    }
    for (let c = startChunk; c < chunks; c++) {
      throwIfStopped(ctx.signal);
      parts.push(await requestChunk(worker, c, pointsPerChunk, seed));
      // 実処理(SfM/MVS)の計算負荷を模した待ち。進捗・一時停止の動作確認用
      await sleep(150);
      await ctx.saveCheckpoint({ nextChunk: c + 1 });
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
    const denseStage = await createStage(ctx.job.projectId, 'dense', {
      demo: true,
      params: { ...ctx.params },
      note: 'デモ生成(合成データ。実撮影由来ではありません)',
    });
    await addAsset({
      projectId: ctx.job.projectId,
      stageId: denseStage.id,
      kind: 'pointcloud',
      name: 'demo_dense_points.f32',
      blob: new Blob([points.buffer], { type: 'application/octet-stream' }),
      meta: { count: total / 3, unit: 'mm' },
    });
    await setStageStatus(denseStage.id, 'ready', { 点数: total / 3 });

    // デモサーフェス(L字押し出し)
    ctx.report(0.98, 'デモサーフェス生成中');
    const mesh = makeDemoLMesh();
    const surfaceStage = await createStage(ctx.job.projectId, 'surface', {
      demo: true,
      sourceStageId: denseStage.id,
      note: 'デモ生成(合成データ)',
    });
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
  } finally {
    worker.terminate();
  }
}
