import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AssetMeta, JobRecord, Project, Stage } from '../types';

/**
 * ローカル保存(IndexedDB)。静的アプリのためサーバは持たない(作業計画 §2.1)。
 * blobはメタデータと分離して保存し、一覧表示時に画像本体を読まずに済むようにする。
 */
interface Scan2FemDB extends DBSchema {
  projects: { key: string; value: Project };
  stages: {
    key: string;
    value: Stage;
    indexes: { byProject: string; byProjectKindSeq: [string, string, number] };
  };
  assets: { key: string; value: AssetMeta; indexes: { byProject: string; byStage: string } };
  blobs: { key: string; value: { assetId: string; blob: Blob } };
  jobs: { key: string; value: JobRecord; indexes: { byProject: string; byStatus: string } };
}

let dbPromise: Promise<IDBPDatabase<Scan2FemDB>> | null = null;

export function db(): Promise<IDBPDatabase<Scan2FemDB>> {
  dbPromise ??= openDB<Scan2FemDB>('scan2fem', 2, {
    upgrade(d, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        d.createObjectStore('projects', { keyPath: 'id' });
        const stages = d.createObjectStore('stages', { keyPath: 'id' });
        stages.createIndex('byProject', 'projectId');
        const assets = d.createObjectStore('assets', { keyPath: 'id' });
        assets.createIndex('byProject', 'projectId');
        assets.createIndex('byStage', 'stageId');
        d.createObjectStore('blobs', { keyPath: 'assetId' });
        const jobs = d.createObjectStore('jobs', { keyPath: 'id' });
        jobs.createIndex('byProject', 'projectId');
        jobs.createIndex('byStatus', 'status');
      }
      if (oldVersion < 2) {
        // v2: seq採番の一意性をDB側でも保証する(採番はcreateStageの
        // 単一トランザクション内で行うが、その安全網)
        tx.objectStore('stages').createIndex(
          'byProjectKindSeq',
          ['projectId', 'kind', 'seq'],
          { unique: true },
        );
      }
    },
    blocking() {
      // 新しいバージョンのアプリを開いた別タブのDB更新を妨げないよう、
      // この接続を閉じてリロードする(実行中ジョブはcheckpointから再開できる)
      void dbPromise?.then((d) => d.close());
      dbPromise = null;
      window.location.reload();
    },
  });
  return dbPromise;
}

export const uid = (): string => crypto.randomUUID();
export const now = (): number => Date.now();
