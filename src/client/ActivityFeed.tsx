import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'

export function ActivityFeed({ feed, terminals }: {
  feed: (ActivityEntry & { id: string })[]
  terminals: TerminalCollaborationView[]
}): JSX.Element {
  if (feed.length === 0) {
    return (
      <div className="wb-empty-feed">
        <p>暂无协同输入记录</p>
        <p className="wb-hint">当人类在终端敲下命令，或 AI 调用工具执行操作时，记录会归属并按时间序列实时显示在此处。</p>
      </div>
    )
  }

  const nameOf = (id: string): string => {
    const t = terminals.find(candidate => candidate.terminalId === id)
    return t?.name ?? (t?.kind === 'ssh' ? `${t.user}@${t.host}` : '本地终端')
  }

  return (
    <div className="wb-activity-list">
      {feed.map((entry, idx) => (
        <div key={`${entry.id}-${entry.at}-${idx}`} className="wb-activity-item">
          <span className={`wb-badge ${entry.source}`}>{entry.source === 'human' ? '人' : 'AI'}</span>
          <span className="wb-activity-content">
            <strong className="wb-term-name">[{nameOf(entry.id)}]</strong>
            <code>$ {entry.text.replace(/\n+/g, ' ⏎ ')}</code>
          </span>
          <span className="wb-activity-time">{new Date(entry.at).toTimeString().slice(0, 8)}</span>
        </div>
      ))}
    </div>
  )
}
