/**
 * Reader-proxy HTML rewriting for the collaborative browser.
 * External sites usually ship X-Frame-Options / CSP frame-ancestors, so a
 * plain iframe cannot display them. The gateway fetches the page server-side
 * and this module cooks the HTML into a same-origin "reader" document:
 * scripts stripped, links and GET forms routed back through the proxy,
 * relative subresources resolved via <base>. Pure functions — unit tested.
 * @module dsh-workbench/proxy
 */

export const PROXY_ROUTE = '/dsh-workbench/proxy'

/** Wrap an absolute URL into a proxy route URL. */
export function proxyUrl(target: string): string {
  return `${PROXY_ROUTE}?url=${encodeURIComponent(target)}`
}

/** Resolve one href against the page base; returns null for non-navigable values. */
export function absolutize(href: string, base: URL): string | null {
  const raw = href.trim()
  if (raw === '' || raw.startsWith('#')) return null
  if (/^(javascript|mailto|tel|data|blob):/i.test(raw)) return null
  try {
    return new URL(raw, base).toString()
  }
  catch {
    return null
  }
}

const SCRIPT_BLOCK = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi
const SCRIPT_SELF_CLOSING = /<script\b[^>]*\/>/gi
const CSP_META = /<meta\s+http-equiv=["']?content-security-policy["']?[^>]*>/gi
const NOSCRIPT_WRAP = /<\/?noscript\b[^>]*>/gi

/**
 * Rewrite one attribute-bearing tag list. `pattern` must expose a single
 * capture for the URL value; `isContent` marks navigational (proxied) vs
 * passive (kept absolute) attributes.
 */
function rewriteAttr(html: string, tag: 'a' | 'form' | 'iframe', attr: 'href' | 'action' | 'src', base: URL, mode: 'proxy' | 'absolute'): string {
  const re = new RegExp(`(<${tag}\\b[^>]*?\\s${attr}=)(["'])(.*?)\\2`, 'gi')
  return html.replace(re, (full, lead: string, quote: string, value: string) => {
    const abs = absolutize(value, base)
    if (abs === null) return full
    const rewritten = mode === 'proxy' ? proxyUrl(abs) : abs
    return `${lead}${quote}${rewritten.replace(/\$/g, '$$')}${quote}`
  })
}

/** Strip scripts and CSP metas, route navigation through the proxy, anchor subresources to the origin page. */
export function rewriteHtml(html: string, pageUrl: string): string {
  const base = new URL(pageUrl)
  let out = html
    .replace(SCRIPT_BLOCK, '')
    .replace(SCRIPT_SELF_CLOSING, '')
    .replace(CSP_META, '')
    .replace(NOSCRIPT_WRAP, '')

  out = rewriteAttr(out, 'a', 'href', base, 'proxy')
  out = rewriteAttr(out, 'form', 'action', base, 'proxy')
  out = rewriteAttr(out, 'iframe', 'src', base, 'proxy')

  const baseTag = `<base href="${base.href.replace(/"/g, '&quot;')}">`
  if (/<head\b[^>]*>/i.test(out)) {
    out = out.replace(/<head\b[^>]*>/i, (m) => `${m}${baseTag}`)
  }
  else {
    out = `${baseTag}${out}`
  }
  return out
}

/** Extract a text/html charset from a Content-Type header; defaults to utf-8. */
export function charsetFromContentType(contentType: string | undefined): string {
  const m = /charset=["']?([\w-]+)/i.exec(contentType ?? '')
  return m?.[1] ?? 'utf-8'
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

/**
 * Detect client-side redirects inside a fetched page: `<meta http-equiv=
 * "refresh">`, computed protocol rewrites (`location.href.replace(a, b)` —
 * the classic bot-shell pattern), and literal `location.replace`/`location.href`
 * assignments. Returns an absolute URL when the page bounces elsewhere.
 */
export function extractRedirectTarget(raw: string, currentUrl: string): string | undefined {
  const base = new URL(currentUrl)
  const meta = /http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["']?[^"'>]*url=([^"'>\s]+)/i.exec(raw)
  if (meta) {
    try {
      const u = new URL(decodeHtmlEntities(meta[1]).trim(), base)
      if (u.toString() !== base.toString()) return u.toString()
    }
    catch { /* fall through */ }
  }
  const computed = /location\.href\.replace\(\s*["']([^"']+)["']\s*,\s*["']([^"']+)["']\s*\)/.exec(raw)
  if (computed) {
    const u = currentUrl.replace(computed[1], computed[2])
    if (u !== currentUrl) return u
  }
  const literal = /location\.(?:replace\(\s*|href\s*=\s*)["'](https?:\/\/[^"'\s]+)["']/i.exec(raw)
  if (literal && literal[1] !== currentUrl) return literal[1]
  return undefined
}

/**
 * True when `to` is the same destination on a less secure scheme.
 *
 * A reader proxy must not follow these: it is a security retreat on any
 * network, and frequently a dead end on this one. www.baidu.com answers an
 * HTTPS fetch with a 227-byte `location.href.replace("https://","http://")`
 * shell, and its downgraded host resolves into the local proxy's fake-IP range
 * where a port-80 connection gets an empty reply — so following the bounce both
 * weakened the request and discarded a page already in hand. (Plain HTTP is not
 * blocked here in general; example.com, baidu.com, and m.baidu.com all answer
 * over http.)
 * @param from - URL the page was served from.
 * @param to - URL the page asks to navigate to.
 */
export function isProtocolDowngrade(from: string, to: string): boolean {
  try {
    return new URL(from).protocol === 'https:' && new URL(to).protocol === 'http:'
  }
  catch {
    return false
  }
}

/** True when the page IS nothing but a protocol-downgrade stub. */
export function isDowngradeStub(html: string, pageUrl: string): boolean {
  const target = extractRedirectTarget(html, pageUrl)
  return target !== undefined && isProtocolDowngrade(pageUrl, target)
}

/**
 * The mobile host for a URL, or `undefined` when there is nothing to try.
 *
 * Sites that refuse their desktop HTTPS page commonly still serve the mobile
 * one, and a reader pane is a narrow column anyway — baidu is exactly this
 * shape (`www` → downgrade stub, `m` → the real page).
 */
export function mobileHostVariant(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl)
    const host = url.hostname.toLowerCase()
    if (host.startsWith('m.') || host.startsWith('wap.') || host.startsWith('mobile.')) return undefined
    const bare = host.replace(/^www\./, '')
    if (bare.length === 0) return undefined
    const candidate = new URL(url.toString())
    candidate.hostname = `m.${bare}`
    return candidate.toString()
  }
  catch {
    return undefined
  }
}

/**
 * Prefix a fixed notice bar onto an already-cooked reader document, so the
 * human can see that what they are reading is not the page they asked for.
 */
export function withReaderNotice(html: string, text: string): string {
  const bar = `<div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;`
    + 'font:12px/1.5 -apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;'
    + 'padding:7px 12px;background:#1f2328;color:#d9dadd;border-bottom:1px solid rgba(255,255,255,.14)">'
    + `${text.replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c] ?? c)}</div>`
  if (/<body\b[^>]*>/i.test(html)) return html.replace(/<body\b[^>]*>/i, m => `${m}${bar}`)
  return `${bar}${html}`
}
