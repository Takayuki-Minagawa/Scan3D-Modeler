import type { ReactNode } from 'react';

export function Section(props: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <div className="card-head">
        <h2>{props.title}</h2>
        {props.aside && <div className="card-aside">{props.aside}</div>}
      </div>
      {props.children}
    </section>
  );
}

export function ProgressBar(props: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, props.value)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
      <span className="progress-label">{pct}%</span>
    </div>
  );
}

export function Badge(props: { tone?: 'ok' | 'warn' | 'err' | 'info' | 'demo'; children: ReactNode }) {
  return <span className={`badge badge-${props.tone ?? 'info'}`}>{props.children}</span>;
}
