// Cartes d'alerte façon connecteur Teams « Alerting » : sévérités, statuts, libellés FR et couleurs.
// Module pur, partagé entre le store (validation), le front (affichage) et les tests.
export const ALERT_SEVERITIES = ['SEV1', 'SEV2', 'SEV3'] as const
export type AlertSeverity = typeof ALERT_SEVERITIES[number]

export const ALERT_STATUSES = ['triggered', 'acknowledged', 'resolved'] as const
export type AlertStatus = typeof ALERT_STATUSES[number]

export const ALERT_TITLE_MAX_LENGTH = 120
export const ALERT_SERVICE_MAX_LENGTH = 60

export const ALERT_SEVERITY_LABELS: Record<AlertSeverity, string> = {
  SEV1: 'SEV1 · Critique',
  SEV2: 'SEV2 · Majeure',
  SEV3: 'SEV3 · Mineure',
}

/** Couleur de la bande gauche de la carte : rouge, orange, ambre */
export const ALERT_SEVERITY_COLORS: Record<AlertSeverity, string> = {
  SEV1: '#c4314b',
  SEV2: '#e97548',
  SEV3: '#d69a00',
}

export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  triggered: 'Déclenchée',
  acknowledged: 'Acquittée',
  resolved: 'Résolue',
}

export function isAlertSeverity(value: unknown): value is AlertSeverity {
  return typeof value === 'string' && (ALERT_SEVERITIES as readonly string[]).includes(value)
}

export function isAlertStatus(value: unknown): value is AlertStatus {
  return typeof value === 'string' && (ALERT_STATUSES as readonly string[]).includes(value)
}

/** Transitions autorisées : triggered → acknowledged, triggered|acknowledged → resolved */
export function canTransition(from: AlertStatus, to: AlertStatus): boolean {
  if (to === 'acknowledged') return from === 'triggered'
  if (to === 'resolved') return from !== 'resolved'
  return false
}
