import { toggleSidebarColumn } from './column.ts'
import { SidebarPanelIcon } from './icons.tsx'

export function HeaderToggleAction(): JSX.Element {
  return (
    <button
      type="button"
      className="wb-header-toggle-btn"
      onClick={() => { void toggleSidebarColumn() }}
      title="切换协同工作台侧栏"
    >
      <SidebarPanelIcon size={14} />
      <span>工作台</span>
    </button>
  )
}
