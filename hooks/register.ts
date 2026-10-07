import type { EngineInterface, Register } from 'claude-code'

const eta = (iso: string | undefined, now: number) => {
  const s = Math.floor((Date.parse(iso ?? '') - now) / 1000)
  if (!(s > 0)) return ''
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return ` ↻${d > 0 ? `${d}d${h}h` : `${h}h${m}m`}`
}
const pretty = (id: string) => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?/.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}` : id
}
const k = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`)

type Usage = { cost?: { usd: number }; context: { percent?: number; tokens?: number; window?: number }; rateLimits: { kind: string; percentUsed: number; resetsAt?: string }[] }

// ponytail: module vars, so a hot reload zeroes the hit rate; move to $.state if that bites
let read = 0, total = 0

const resets: Record<string, string> = {}

export const line = (u: Usage, model: string, now: number) => {
  for (const r of u.rateLimits) if (r.resetsAt) resets[r.kind] = r.resetsAt
  const lim = (label: string, kind: string) => {
    const r = u.rateLimits.find(l => l.kind === kind)
    return r ? `${label} ${Math.round(r.percentUsed)}%${eta(r.resetsAt ?? resets[kind], now)}` : undefined
  }
  const c = u.context
  const pct = c.percent ?? 0
  const on = Math.min(10, Math.round(pct / 10))
  const dot = pct < 30 ? '🟢' : pct <= 70 ? '🟡' : '🔴' // status text is one fixed color; emoji carry the color
  const ctx = c.percent === undefined ? undefined : `${dot} ctx ${'▰'.repeat(on)}${'▱'.repeat(10 - on)} ${Math.round(pct)}% ${k(c.tokens ?? 0)}/${k(c.window ?? 0)}`
  const hit = total ? `cache ${Math.round((100 * read) / total)}%` : undefined
  const cost = u.cost ? `$${u.cost.usd.toFixed(2)}` : undefined
  return [pretty(model), ctx, hit, cost, lim('5h', 'five_hour'), lim('7d', 'seven_day')].filter(Boolean).join(' · ')
}

async function draw($: EngineInterface) {
  $.ui.status(line(await $.session.usage(), (await $.session.model()) || '', await $.clock.now()))
}

export const register: Register = on => {
  on('session.start', ($, e, next) => {
    $.clock.every(30_000, () => void draw($)) // limits move between turns; ponytail: poll, no push event
    void draw($)
    return next(e)
  })
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const u = r.usage
    if (u) {
      read += u.cache_read_input_tokens
      total += u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
    }
    return r
  })
  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    $.ui.status(line(e, (await $.session.model()) || '', await $.clock.now())) // measure carries resetsAt
    return r
  })
}
