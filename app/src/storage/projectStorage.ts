import { db } from '../db/db';
import { summarizeProjectAssetSizes, type ProjectStorageSummary } from './metrics';

/**
 * Read only asset metadata in one transaction. Blob bodies stay untouched, so this remains cheap
 * even for projects containing many full-resolution captures.
 */
export async function getProjectStorageSummaries(
  projectIds: readonly string[],
): Promise<Record<string, ProjectStorageSummary>> {
  const d = await db();
  const tx = d.transaction('assets', 'readonly');
  const assets = await tx.store.getAll();
  await tx.done;
  return summarizeProjectAssetSizes(assets, projectIds);
}
