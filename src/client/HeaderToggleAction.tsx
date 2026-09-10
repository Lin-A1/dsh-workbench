import { toggleWorkbench } from './column.ts'
import { SidebarPanelIcon } from './icons.tsx'

export function HeaderToggleAction(): JSX.Element {
  return (
    <button
      type="button"
      className="wb-header-toggle-btn"
      onClick={() => { toggleWorkbench() }}
      title="显示协同工作台（终端 / 网页 / Git / 动态）"
    >
      <SidebarPanelIcon size={14} />
      <span>工作台</span>
    </button>
  )
}
