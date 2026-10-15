import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyImportFile, sortImportFiles } from '../.test-build/importFiles.mjs';
import { classifyCameraError, cameraErrorGuidance } from '../.test-build/cameraError.mjs';
import { framesOfVideo } from '../.test-build/videoFrames.mjs';

test('classifyImportFile uses MIME first and falls back to the extension only when MIME is empty', () => {
  assert.equal(classifyImportFile({ name: 'a.jpg', type: 'image/jpeg' }), 'image');
  assert.equal(classifyImportFile({ name: 'a.mp4', type: 'video/mp4' }), 'video');
  assert.equal(classifyImportFile({ name: 'notes.txt', type: 'text/plain' }), 'skip');
  // A text file renamed .jpg still carries its real MIME and must not be treated as an image.
  assert.equal(classifyImportFile({ name: 'fake.jpg', type: 'text/plain' }), 'skip');
  assert.equal(classifyImportFile({ name: 'IMG_0001.HEIC', type: '' }), 'image');
  assert.equal(classifyImportFile({ name: 'clip.MOV', type: '' }), 'video');
  assert.equal(classifyImportFile({ name: 'README', type: '' }), 'skip');
});

test('sortImportFiles orders by relative path with numeric awareness and does not mutate input', () => {
  const input = [
    { name: 'img_10.jpg', webkitRelativePath: 'set/img_10.jpg' },
    { name: 'img_2.jpg', webkitRelativePath: 'set/img_2.jpg' },
    { name: 'img_1.jpg' },
  ];
  const sorted = sortImportFiles(input);
  assert.deepEqual(sorted.map((f) => f.name), ['img_1.jpg', 'img_2.jpg', 'img_10.jpg']);
  assert.equal(input[0].name, 'img_10.jpg');
});

test('classifyCameraError separates permission denial from insecure context and device problems', () => {
  const secure = { secureContext: true, mediaDevices: true };
  const named = (name) => Object.assign(new Error(name), { name });
  assert.equal(classifyCameraError(named('NotAllowedError'), secure), 'denied');
  assert.equal(classifyCameraError(named('NotFoundError'), secure), 'notFound');
  assert.equal(classifyCameraError(named('NotReadableError'), secure), 'inUse');
  assert.equal(classifyCameraError(named('OverconstrainedError'), secure), 'constraints');
  assert.equal(classifyCameraError(named('TypeError'), secure), 'unknown');
  assert.equal(classifyCameraError(named('NotAllowedError'), { secureContext: false, mediaDevices: true }), 'insecure');
  assert.equal(classifyCameraError(undefined, { secureContext: true, mediaDevices: false }), 'unsupported');
  assert.match(cameraErrorGuidance('denied').ja, /許可/);
  assert.doesNotMatch(cameraErrorGuidance('denied').ja, /HTTPS/);
  assert.match(cameraErrorGuidance('insecure').en, /HTTPS/);
});

test('framesOfVideo matches by sourceAssetId, and by name only when the name is unambiguous', () => {
  const video = { id: 'v1', kind: 'video', name: 'clip.webm' };
  const assets = [
    video,
    { id: 'f1', kind: 'frame', name: 'frame_1.jpg', sourceAssetId: 'v1' },
    { id: 'f2', kind: 'frame', name: 'frame_2.jpg', meta: { video: 'clip.webm' } },
    { id: 'f3', kind: 'frame', name: 'frame_3.jpg', sourceAssetId: 'v2' },
    { id: 'i1', kind: 'image', name: 'clip.webm' },
  ];
  assert.deepEqual(framesOfVideo(video, assets).map((a) => a.id), ['f1', 'f2']);
  const duplicate = { id: 'v9', kind: 'video', name: 'clip.webm' };
  assert.deepEqual(framesOfVideo(video, [...assets, duplicate]).map((a) => a.id), ['f1']);
});
