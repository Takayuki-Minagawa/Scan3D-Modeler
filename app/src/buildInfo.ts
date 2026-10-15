/** vite.config.ts の define で埋め込まれるビルド識別情報。 */
declare const __BUILD_INFO__: { commit: string; builtAt: string };

export const BUILD_INFO: { commit: string; builtAt: string } =
  typeof __BUILD_INFO__ === 'undefined' ? { commit: 'dev', builtAt: '' } : __BUILD_INFO__;
