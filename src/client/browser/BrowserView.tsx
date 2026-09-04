/**
 * High-fidelity In-App Browser & Document Preview View component.
 * Exact match to modern AI IDE preview panels with omnibox, history navigation,
 * local HTML / localhost previewing, and external window launching.
 * @module dsh-workbench/client/browser/BrowserView
 */

import { useEffect, useRef, useState } from 'react'
import type { WorkbenchBrowserTab } from '../../protocol.ts'
import { ArrowLeftIcon, ArrowRightIcon, CopyIcon, ExternalLinkIcon, GlobeIcon, ReloadIcon } from '../icons.tsx'

export interface BrowserViewProps {
  tab: WorkbenchBrowserTab
  onNavigate?: (url: string) => void
}

function resolveFrameUrl(raw: string): string {
  if (!raw || raw === 'about:blank') return 'about:blank'
  // Map local files to the secure preview route
  if (raw.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(raw) || raw.startsWith('/')) {
    return `/dsh-workbench/preview?file=${encodeURIComponent(raw)}`
  }
  return raw
}

export function BrowserView({ tab, onNavigate }: BrowserViewProps): JSX.Element {
  const [inputUrl, setInputUrl] = useState(tab.url)
  const [currentUrl, setCurrentUrl] = useState(tab.url)
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const isStartPage = !tab.url || tab.url === 'about:blank'

  useEffect(() => {
    setInputUrl(tab.url)
    setCurrentUrl(tab.url)
    setLoading(!isStartPage)
  }, [tab.id, tab.url, isStartPage])

  // The start page invites typing: park the caret in the omnibox
  useEffect(() => {
    if (isStartPage) inputRef.current?.focus()
  }, [isStartPage])

  const handleCommitUrl = () => {
    let target = inputUrl.trim()
    if (!target) return
    if (!target.startsWith('http://') && !target.startsWith('https://') && !target.startsWith('file://') && !/^[a-zA-Z]:[\\/]/.test(target)) {
      if (/^\d{4,5}$/.test(target)) {
        target = `http://localhost:${target}`
      }
      else {
        target = `http://${target}`
      }
    }
    setInputUrl(target)
    setCurrentUrl(target)
    onNavigate?.(target)
    setLoading(true)
  }

  const handleReload = () => {
    if (iframeRef.current) {
      setLoading(true)
      iframeRef.current.src = resolveFrameUrl(currentUrl)
    }
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    catch {
      // ignore clipboard error
    }
  }

  const handleOpenExternal = () => {
    window.open(resolveFrameUrl(currentUrl), '_blank', 'noopener,noreferrer')
  }

  const handleQuickLaunch = (url: string) => {
    setInputUrl(url)
    setCurrentUrl(url)
    onNavigate?.(url)
    setLoading(true)
  }

  return (
    <div className="wb-browser-root">
      {/* 浏览器控制与地址栏 (Omnibox) */}
      <div className="wb-browser-toolbar">
        <div className="wb-browser-nav-btns">
          <button
            type="button"
            className="wb-tool-btn"
            title="后退"
            onClick={() => {
              try { iframeRef.current?.contentWindow?.history.back() } catch { /* ignore */ }
            }}
          >
            <ArrowLeftIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-tool-btn"
            title="前进"
            onClick={() => {
              try { iframeRef.current?.contentWindow?.history.forward() } catch { /* ignore */ }
            }}
          >
            <ArrowRightIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-tool-btn"
            title="刷新页面"
            onClick={handleReload}
          >
            <ReloadIcon size={13} />
          </button>
        </div>

        {/* 地址栏输入框 */}
        <div className="wb-browser-omnibox">
          <GlobeIcon size={13} className="wb-omnibox-icon" />
          <input
            ref={inputRef}
            type="text"
            className="wb-omnibox-input"
            value={inputUrl}
            placeholder="输入 URL 或本地路径 (如 http://localhost:3000 或 D:/docs/page.html)"
            onChange={e => setInputUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCommitUrl()
            }}
          />
        </div>

        {/* 外部操作按钮 */}
        <div className="wb-browser-actions">
          <button
            type="button"
            className="wb-tool-btn"
            title={copied ? '已复制！' : '复制网页地址'}
            onClick={handleCopy}
          >
            <CopyIcon size={13} />
          </button>
          <button
            type="button"
            className="wb-tool-btn"
            title="在新窗口打开"
            onClick={handleOpenExternal}
          >
            <ExternalLinkIcon size={13} />
          </button>
        </div>
      </div>

      {/* 起始页：不加载 iframe，杜绝死链白屏 */}
      {isStartPage ? (
        <div className="wb-start-page">
          <div className="wb-start-mark"><GlobeIcon size={26} /></div>
          <h4 className="wb-start-title">协同浏览器</h4>
          <p className="wb-start-hint">在上方地址栏输入网址或本地文件路径，人机共用同一视图</p>
          <div className="wb-start-chips">
            <button type="button" className="wb-start-chip" onClick={() => handleQuickLaunch('http://127.0.0.1:3080')}>
              Harness 控制台
            </button>
            <button type="button" className="wb-start-chip" onClick={() => handleQuickLaunch('http://localhost:3000')}>
              localhost:3000
            </button>
            <button type="button" className="wb-start-chip" onClick={() => handleQuickLaunch('http://localhost:5173')}>
              localhost:5173
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* 加载进度条 */}
          {loading ? <div className="wb-browser-progress" /> : null}

          {/* 主视口 iframe */}
          <div className="wb-browser-viewport">
            <iframe
              ref={iframeRef}
              src={resolveFrameUrl(currentUrl)}
              className="wb-browser-iframe"
              sandbox="allow-scripts allow-forms allow-same-origin allow-popups"
              onLoad={() => setLoading(false)}
              title={tab.title}
            />
          </div>
        </>
      )}
    </div>
  )
}
