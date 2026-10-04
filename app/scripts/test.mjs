import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(appDir, '.test-build');
const entry = {
  formats: path.join(appDir, 'src/export/formats.ts'),
  scale: path.join(appDir, 'src/viewer/scale.ts'),
  externalGeometry: path.join(appDir, 'src/import/externalGeometry.ts'),
  stl: path.join(appDir, 'src/import/stl.ts'),
  diagnostics: path.join(appDir, 'src/geometry/diagnostics.ts'),
  validation: path.join(appDir, 'src/geometry/validation.ts'),
  report: path.join(appDir, 'src/geometry/report.ts'),
  workerClient: path.join(appDir, 'src/geometry/workerClient.ts'),
  geometryExportClient: path.join(appDir, 'src/export/geometryWorkerClient.ts'),
  geometryExportWorker: path.join(appDir, 'src/export/geometry.worker.ts'),
  zipLimits: path.join(appDir, 'src/export/zipLimits.ts'),
};

// Bundle TypeScript with the application's existing compiler. Node 20.19+ can
// execute these modules without experimental TypeScript stripping or a loader.
try {
  const tests = (await readdir(path.join(appDir, 'tests')))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => path.join(appDir, 'tests', name));
  if (tests.length === 0) throw new Error('No test files found in app/tests.');

  await build({
    root: appDir,
    configFile: false,
    logLevel: 'warn',
    worker: { format: 'es' },
    build: {
      outDir: buildDir,
      emptyOutDir: true,
      target: 'node20',
      minify: false,
      lib: {
        entry,
        formats: ['es'],
        fileName: (_format, name) => `${name}.mjs`,
      },
      rollupOptions: {
        external: [...builtinModules, ...builtinModules.map((name) => `node:${name}`)],
        output: { chunkFileNames: '[name]-[hash].mjs' },
      },
    },
  });

  process.exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--test', ...tests], {
      cwd: appDir,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
} finally {
  await rm(buildDir, { recursive: true, force: true });
}
