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

function isExternalWebUrl(url: string): boolean {
  if (!url || url === 'about:blank') return false
  if (url.startsWith('file://') || /^[a-zA-Z]:[\\/]/.test(url) || url.startsWith('/')) return false
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.toLowerCase()
    return !(
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host.endsWith('.local') ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
    )
  }
  catch {
    return false
  }
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
          <p className="wb-start-group-label">快速直达 · 本地开发服务</p>
          <div className="wb-start-grid">
            {[
              { label: 'Harness 控制台', port: '3080', url: 'http://127.0.0.1:3080', desc: '本应用' },
              { label: 'React / CRA', port: '3000', url: 'http://localhost:3000', desc: '前端默认' },
              { label: 'Vite Dev', port: '5173', url: 'http://localhost:5173', desc: '热更新' },
              { label: 'Webpack / Java', port: '8080', url: 'http://localhost:8080', desc: '通用服务' },
              { label: 'Python / FastAPI', port: '8000', url: 'http://localhost:8000', desc: '后端 API' },
              { label: 'Storybook', port: '6006', url: 'http://localhost:6006', desc: '组件预览' },
            ].map(item => (
              <button key={item.port} type="button" className="wb-start-card" onClick={() => handleQuickLaunch(item.url)}>
                <span className="wb-start-card-port">{item.port}</span>
                <span className="wb-start-card-label">{item.label}</span>
                <span className="wb-start-card-desc">{item.desc}</span>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* 加载进度条 */}
          {loading ? <div className="wb-browser-progress" /> : null}

          {/* 外网跨域限制提示条 */}
          {isExternalWebUrl(currentUrl) && (
            <div className="wb-browser-external-tip">
              <span>💡 公网站点常限制 iframe 嵌入（X-Frame-Options），如遇空白或拒绝连接：</span>
              <button type="button" className="wb-browser-external-link" onClick={handleOpenExternal}>
                在新窗口打开 ↗
              </button>
            </div>
          )}

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
