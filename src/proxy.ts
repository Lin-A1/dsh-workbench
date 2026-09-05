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
