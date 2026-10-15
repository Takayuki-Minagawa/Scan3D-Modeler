export const PROJECT_TABS = ['capture', 'images', 'pipeline', 'viewer', 'diagnostics', 'export'] as const;
export type ProjectTab = (typeof PROJECT_TABS)[number];

export type HashRoute = { kind: 'list' } | { kind: 'project'; id: string; tab: ProjectTab };

function isProjectTab(value: string | undefined): value is ProjectTab {
  return (PROJECT_TABS as readonly string[]).includes(value ?? '');
}

/** `#/p/<id>/<tab>`。タブ省略・不明なタブは「取込」として扱う。 */
export function parseHashRoute(hash: string): HashRoute {
  const match = hash.match(/^#\/p\/([0-9a-f-]+)(?:\/([a-z]+))?\/?$/i);
  if (!match) return { kind: 'list' };
  return { kind: 'project', id: match[1], tab: isProjectTab(match[2]?.toLowerCase()) ? (match[2].toLowerCase() as ProjectTab) : 'capture' };
}

export function projectHash(id: string, tab: ProjectTab = 'capture'): string {
  return tab === 'capture' ? `#/p/${id}` : `#/p/${id}/${tab}`;
}
