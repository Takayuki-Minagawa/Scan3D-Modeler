import { extractFramesEngine, scoreImagesEngine } from '../capture/frameExtract';
import { demoReconstructEngine } from '../pipeline/demoReconstruct';
import { registerEngine } from './runner';

/** アプリ起動時に全ジョブエンジンを登録する(main.tsxから呼ぶ) */
export function registerAllEngines(): void {
  registerEngine('extractFrames', extractFramesEngine);
  registerEngine('scoreImages', scoreImagesEngine);
  registerEngine('demoReconstruct', demoReconstructEngine);
}
