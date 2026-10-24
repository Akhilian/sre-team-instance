import { DEFAULT_ROLE_ID } from '~~/shared/onboarding/roles'

// Participants présents (tous canaux) avec leur rôle, pour la section « Participants et rôles » de /admin
export default defineEventHandler((event) => {
  if (!isFacilitatorCode(getHeader(event, 'x-facilitator-code'))) {
    throw createError({ statusCode: 401, message: 'Code animateur invalide' })
  }
  const present = presentParticipants(Date.now())
  const names = present.map(participant => participant.name)
  const roles = rolesOf(names)
  return {
    participants: present.map(participant => ({ ...participant, role: roles[participant.name] ?? DEFAULT_ROLE_ID })),
    hasIncidentCommander: hasIncidentCommander(names),
  }
})
