// Registre de métriques au format texte Prometheus 0.0.4, sans dépendance (pas de prom-client).
// Compteur, jauge et histogramme avec labels ; le nombre de séries par métrique est plafonné pour qu'un
// label mal choisi ne fasse jamais exploser la mémoire. Module pur (sans auto-import Nuxt), testable avec Vitest.

/** Séries au plus par métrique : au-delà, les nouvelles combinaisons de labels sont ignorées */
export const SERIES_MAX = 200

export type Labels = Readonly<Record<string, string>>

/** Échappement des valeurs de label : antislash, guillemet et saut de ligne */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"')
}

/** Échappement du texte d'un # HELP : antislash et saut de ligne */
function escapeHelp(help: string): string {
  return help.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
}

/** Nombre au format Prometheus */
export function formatNumber(value: number): string {
  if (Number.isNaN(value)) return 'NaN'
  if (value === Infinity) return '+Inf'
  if (value === -Infinity) return '-Inf'
  return String(value)
}

function renderLabels(names: readonly string[], values: readonly string[], extra?: [string, string]): string {
  const pairs = names.map((name, index) => `${name}="${escapeLabelValue(values[index] ?? '')}"`)
  if (extra) pairs.push(`${extra[0]}="${escapeLabelValue(extra[1])}"`)
  return pairs.length === 0 ? '' : `{${pairs.join(',')}}`
}

/** Clé de série : valeurs dans l'ordre des labels déclarés (un label absent vaut une chaîne vide) */
function seriesValues(names: readonly string[], labels: Labels): string[] {
  return names.map(name => labels[name] ?? '')
}

interface Metric {
  name: string
  render: () => string[]
  reset: () => void
}

const NAME_PATTERN = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/

function checkName(name: string, labelNames: readonly string[]) {
  if (!NAME_PATTERN.test(name)) throw new Error(`nom de métrique invalide : ${name}`)
  for (const label of labelNames) {
    if (!NAME_PATTERN.test(label) || label.includes(':') || label === 'le') throw new Error(`nom de label invalide : ${label}`)
  }
}

export interface Counter {
  inc: (labels?: Labels, value?: number) => void
  /** Valeur courante d'une série (0 si elle n'existe pas) : pour les tests */
  get: (labels?: Labels) => number
}

export interface Gauge {
  set: (labels: Labels | undefined, value: number) => void
  get: (labels?: Labels) => number
}

export interface Histogram {
  observe: (labels: Labels | undefined, value: number) => void
  /** Nombre d'observations d'une série : pour les tests */
  count: (labels?: Labels) => number
}

export interface Registry {
  counter: (name: string, help: string, labelNames?: readonly string[]) => Counter
  /** collect : valeur calculée à chaque lecture (ex. participants présents), sans labels */
  gauge: (name: string, help: string, labelNames?: readonly string[], collect?: () => number) => Gauge
  histogram: (name: string, help: string, labelNames: readonly string[], buckets: readonly number[]) => Histogram
  /** Texte Prometheus de toutes les métriques, # HELP et # TYPE une seule fois chacune */
  render: () => string
  /** Remet toutes les séries à zéro (tests) */
  reset: () => void
}

export function createRegistry(): Registry {
  const metrics = new Map<string, Metric>()

  function register(metric: Metric) {
    if (metrics.has(metric.name)) throw new Error(`métrique déjà déclarée : ${metric.name}`)
    metrics.set(metric.name, metric)
  }

  function header(name: string, help: string, type: string): string[] {
    return [`# HELP ${name} ${escapeHelp(help)}`, `# TYPE ${name} ${type}`]
  }

  return {
    counter(name, help, labelNames = []) {
      checkName(name, labelNames)
      const series = new Map<string, { values: string[], value: number }>()
      register({
        name,
        render() {
          const lines = header(name, help, 'counter')
          for (const entry of series.values()) lines.push(`${name}${renderLabels(labelNames, entry.values)} ${formatNumber(entry.value)}`)
          return lines
        },
        reset: () => series.clear(),
      })
      return {
        inc(labels = {}, value = 1) {
          if (!(value >= 0)) return
          const values = seriesValues(labelNames, labels)
          const key = values.join('\u0000')
          const entry = series.get(key)
          if (entry) entry.value += value
          else if (series.size < SERIES_MAX) series.set(key, { values, value })
        },
        get: (labels = {}) => series.get(seriesValues(labelNames, labels).join('\u0000'))?.value ?? 0,
      }
    },

    gauge(name, help, labelNames = [], collect) {
      checkName(name, labelNames)
      const series = new Map<string, { values: string[], value: number }>()
      register({
        name,
        render() {
          const lines = header(name, help, 'gauge')
          if (collect) lines.push(`${name} ${formatNumber(collect())}`)
          else for (const entry of series.values()) lines.push(`${name}${renderLabels(labelNames, entry.values)} ${formatNumber(entry.value)}`)
          return lines
        },
        reset: () => series.clear(),
      })
      return {
        set(labels = {}, value) {
          const values = seriesValues(labelNames, labels)
          const key = values.join('\u0000')
          const entry = series.get(key)
          if (entry) entry.value = value
          else if (series.size < SERIES_MAX) series.set(key, { values, value })
        },
        get: (labels = {}) => collect ? collect() : series.get(seriesValues(labelNames, labels).join('\u0000'))?.value ?? 0,
      }
    },

    histogram(name, help, labelNames, buckets) {
      checkName(name, labelNames)
      const bounds = [...buckets].sort((a, b) => a - b)
      // counts[i] : observations dont la valeur est ≤ bounds[i] (cumul fait au rendu), dernier : toutes
      const series = new Map<string, { values: string[], counts: number[], sum: number, count: number }>()
      register({
        name,
        render() {
          const lines = header(name, help, 'histogram')
          for (const entry of series.values()) {
            let cumulative = 0
            bounds.forEach((bound, index) => {
              cumulative += entry.counts[index]!
              lines.push(`${name}_bucket${renderLabels(labelNames, entry.values, ['le', formatNumber(bound)])} ${cumulative}`)
            })
            lines.push(`${name}_bucket${renderLabels(labelNames, entry.values, ['le', '+Inf'])} ${entry.count}`)
            lines.push(`${name}_sum${renderLabels(labelNames, entry.values)} ${formatNumber(entry.sum)}`)
            lines.push(`${name}_count${renderLabels(labelNames, entry.values)} ${entry.count}`)
          }
          return lines
        },
        reset: () => series.clear(),
      })
      return {
        observe(labels = {}, value) {
          if (!Number.isFinite(value) || value < 0) return
          const values = seriesValues(labelNames, labels)
          const key = values.join('\u0000')
          let entry = series.get(key)
          if (!entry) {
            if (series.size >= SERIES_MAX) return
            entry = { values, counts: bounds.map(() => 0), sum: 0, count: 0 }
            series.set(key, entry)
          }
          const index = bounds.findIndex(bound => value <= bound)
          if (index >= 0) entry.counts[index]! += 1
          entry.sum += value
          entry.count += 1
        },
        count: (labels = {}) => series.get(seriesValues(labelNames, labels).join('\u0000'))?.count ?? 0,
      }
    },

    render() {
      return `${[...metrics.values()].flatMap(metric => metric.render()).join('\n')}\n`
    },

    reset() {
      for (const metric of metrics.values()) metric.reset()
    },
  }
}

/** Valeur du label route pour tout ce qui n'est pas une route d'API connue (pages, assets, 404) */
export const OTHER_ROUTE = 'other'

const KNOWN_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

/** Méthode HTTP bornée : une méthode fantaisiste d'un client devient OTHER */
export function normalizeMethod(method: string | undefined): string {
  const upper = (method ?? '').toUpperCase()
  return KNOWN_METHODS.has(upper) ? upper : 'OTHER'
}

/**
 * Motif de route pour le label route, à partir du motif apparié par Nitro (event.context.matchedRoute.route),
 * jamais de l'URL brute : `/api/channels/[id]/messages` ou `/api/channels/:id/messages` →
 * `/api/channels/:id/messages`. Pas de motif, motif générique (`/**`, rendu des pages) ou hors /api/ → `other`.
 */
export function normalizeRoute(pattern: string | undefined): string {
  if (!pattern || !pattern.startsWith('/api/') || pattern.includes('*') || pattern.length > 80) return OTHER_ROUTE
  const route = pattern.split('?')[0]!
    .replace(/\[\.\.\.[^\]/]*\]/g, ':rest')
    .replace(/\[([^\]/]+)\]/g, ':id')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':id')
  return /^[A-Za-z0-9/:_-]+$/.test(route) ? route : OTHER_ROUTE
}

/** 2xx, 3xx, 4xx, 5xx ; 1xx ou hors plage → other */
export function statusClass(status: number): string {
  const hundreds = Math.floor(status / 100)
  return hundreds >= 2 && hundreds <= 5 ? `${hundreds}xx` : 'other'
}
