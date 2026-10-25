// 044 : les SLO Sloth du paging (observability/sloth/paging-*.yaml) ne citent que des métriques,
// labels et buckets déclarés dans server/utils/paging-metrics.ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = join(__dirname, '..')
const SLO_DIR = join(ROOT, 'observability/sloth')

interface Declared { labels: string[], buckets: string[] }

function list(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?|'([^']*)'/g)].map(m => m[1] ?? m[0])
}

export function declaredMetrics(source: string): Map<string, Declared> {
  const constants = new Map<string, string[]>()
  for (const m of source.matchAll(/^const (\w+) = (\[[^\]]*\])/gm)) constants.set(m[1]!, list(m[2]!))
  const resolve = (token: string | undefined): string[] => {
    if (!token) return []
    return token.trim().startsWith('[') ? list(token) : (constants.get(token.trim()) ?? [])
  }
  const metrics = new Map<string, Declared>()
  for (const line of source.split('\n')) {
    const head = /registry\.(counter|gauge|histogram)\('(paging_\w+)'/.exec(line)
    if (!head) continue
    // après la description (chaîne simple, échappements possibles) : labels puis buckets
    const rest = line.slice(head.index + head[0].length).replace(/^,\s*'(?:[^'\\]|\\.)*'/, '')
    const args = [...rest.matchAll(/,\s*(\[[^\]]*\]|[A-Z_]+)(?=\s*[,)])/g)].map(m => m[1])
    metrics.set(head[2]!, { labels: resolve(args[0]), buckets: head[1] === 'histogram' ? resolve(args[1]) : [] })
  }
  return metrics
}

export function checkQueries(yaml: string, metrics: Map<string, Declared>): string[] {
  const errors: string[] = []
  const queries = yaml.split('\n').filter(l => !l.trim().startsWith('#')).join('\n')
  for (const m of queries.matchAll(/\b(paging_\w+?)(_bucket|_count|_sum)?(?:\{([^}]*)\})?(?![\w])/g)) {
    const [, base, suffix, selector] = m
    const name = metrics.has(base!) ? base! : `${base}${suffix ?? ''}`
    const declared = metrics.get(name)
    if (!declared) { errors.push(`métrique inconnue : ${name}`); continue }
    const isHistogram = declared.buckets.length > 0
    if (suffix && !isHistogram) errors.push(`suffixe ${suffix} sur une métrique sans histogramme : ${name}`)
    for (const l of (selector ?? '').matchAll(/(\w+)\s*(?:=~|!~|!=|=)\s*"([^"]*)"/g)) {
      const [, label, value] = l
      if (label === 'le') {
        if (suffix !== '_bucket') errors.push(`le hors _bucket sur ${name}`)
        else if (!declared.buckets.includes(value!)) errors.push(`bucket le="${value}" absent de ${name}`)
      }
      else if (!declared.labels.includes(label!)) errors.push(`label ${label} absent de ${name}`)
    }
  }
  return errors
}

const metrics = declaredMetrics(readFileSync(join(ROOT, 'server/utils/paging-metrics.ts'), 'utf8'))
const files = readdirSync(SLO_DIR).filter(f => /^paging-.*\.yaml$/.test(f))

describe('SLO Sloth du paging', () => {
  it('lit les métriques déclarées', () => {
    expect(metrics.get('paging_http_request_duration_seconds')).toEqual({ labels: ['method', 'route'], buckets: ['0.01', '0.05', '0.1', '0.25', '0.5', '1', '2.5', '5'] })
    expect(metrics.get('paging_npc_llm_effective_tokens_per_second')?.labels).toEqual(['engine', 'model'])
  })

  it('contient les 6 fichiers attendus', () => {
    expect(files.sort()).toEqual(['availability', 'latency', 'llm-deadline', 'llm-throughput', 'npc-fallback', 'npc-generation'].map(n => `paging-${n}.yaml`))
  })

  it.each(files)('%s : métriques, labels et buckets existent', (file) => {
    const yaml = readFileSync(join(SLO_DIR, file), 'utf8')
    expect(yaml).toMatch(/paging_/)
    expect(checkQueries(yaml, metrics)).toEqual([])
    expect(yaml).not.toMatch(/workshop-platform/)
    expect(yaml).toContain(`kubectl apply -n sre-teams -f observability/sloth/${file}`)
  })

  it('détecte une métrique, un label ou un bucket absent', () => {
    expect(checkQueries('sum(rate(paging_inconnue_total[5m]))', metrics)).toHaveLength(1)
    expect(checkQueries('paging_http_requests_total{foo="x"}', metrics)).toHaveLength(1)
    expect(checkQueries('paging_http_request_duration_seconds_bucket{le="0.3"}', metrics)).toHaveLength(1)
    expect(checkQueries('paging_http_request_duration_seconds_bucket{le="0.25",route="/x"}', metrics)).toEqual([])
  })
})
