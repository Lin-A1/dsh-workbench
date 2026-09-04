import type { ActivityEntry, TerminalCollaborationView } from '../types.ts'
import { ActivityIcon, TerminalIcon } from './icons.tsx'

export function ActivityFeed({ feed, terminals }: {
  feed: (ActivityEntry & { id: string })[]
  terminals: TerminalCollaborationView[]
}): JSX.Element {
  if (feed.length === 0) {
    return (
      <div className="wb-empty-feed">
        <ActivityIcon size={28} className="wb-empty-icon" />
        <p className="wb-empty-title">暂无人机协作输入记录</p>
        <p className="wb-hint">当人类在终端键入命令，或 AI 智能体执行指令时，操作将实时流式归属记录于此。</p>
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
        <div key={`${entry.id}-${entry.at}-${idx}`} className={`wb-activity-item src-${entry.source}`}>
          <div className="wb-activity-meta">
            <span className={`wb-badge ${entry.source}`}>
              {entry.source === 'human' ? '人' : 'AI'}
            </span>
            <span className="wb-term-name">
              <TerminalIcon size={10} />
              <span>{nameOf(entry.id)}</span>
            </span>
            <span className="wb-activity-time">{new Date(entry.at).toTimeString().slice(0, 8)}</span>
          </div>
          <code className="wb-activity-code"><span className="wb-prompt-token">$ </span>{entry.text.replace(/\n+/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, (c) => `^${String.fromCharCode(c.charCodeAt(0) + 64)}`)}</code>
        </div>
      ))}
    </div>
  )
}
