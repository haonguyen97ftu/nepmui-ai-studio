import type { SourceRef } from '../worker/contracts'

export function SourceLinks({ sources }: { sources?: SourceRef[] }) {
  if (!sources?.length) return null
  return <ul className="source-links" aria-label="Nguồn tham chiếu">
    {sources.map(source => <li key={source.kind + source.id}>
      <a href={`#${source.kind}/${encodeURIComponent(source.id)}`}>{source.title} <small>v{source.version}</small></a>
    </li>)}
  </ul>
}
