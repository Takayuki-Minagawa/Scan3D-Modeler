import { useEffect, useState } from 'react';
import { reconcileJobsOnStartup } from './db/jobs';
import { ProjectList } from './ui/ProjectList';
import { ProjectPage } from './ui/ProjectPage';

function useHashRoute(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const hash = useHashRoute();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // 前回セッションで実行中だったジョブを「一時停止(再開可能)」へ整合させる
    void reconcileJobsOnStartup().finally(() => setReady(true));
  }, []);

  if (!ready) return null;

  const m = hash.match(/^#\/p\/([0-9a-f-]+)/i);
  if (m) {
    return (
      <ProjectPage
        projectId={m[1]}
        onBack={() => {
          window.location.hash = '#/';
        }}
      />
    );
  }
  return (
    <ProjectList
      onOpen={(id) => {
        window.location.hash = `#/p/${id}`;
      }}
    />
  );
}
