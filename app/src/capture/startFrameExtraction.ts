import { ActiveJobExistsError } from '../db/jobs';
import { DEFAULT_BLUR_THRESHOLD } from '../jobs/blurClient';
import { startJob } from '../jobs/runner';

/**
 * 同一動画のactive抽出はcreateJobRecordの単一IndexedDB transactionで拒否される。
 * terminal後の明示的な再実行は許可し、既存activeとの競合だけfalseで返す。
 */
export async function startFrameExtraction(
  projectId: string,
  videoAssetId: string,
  name: string,
): Promise<boolean> {
  try {
    await startJob('extractFrames', projectId, `フレーム抽出: ${name}`, {
      videoAssetId,
      stepMs: 250,
      blurThreshold: DEFAULT_BLUR_THRESHOLD,
    });
    return true;
  } catch (e) {
    if (e instanceof ActiveJobExistsError) return false;
    throw e;
  }
}
