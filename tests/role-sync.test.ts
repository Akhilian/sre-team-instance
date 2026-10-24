import { describe, expect, it } from 'vitest'
import { decideRoleSync } from '../shared/onboarding/role-sync'

describe('decideRoleSync', () => {
  it('ne laisse pas le rôle du serveur écraser un choix en attente, et le renvoie', () => {
    expect(decideRoleSync({ pending: 'scribe', local: 'scribe', server: 'equipier' })).toEqual({ type: 'push', role: 'scribe' })
    expect(decideRoleSync({ pending: 'scribe', local: 'scribe', server: undefined })).toEqual({ type: 'push', role: 'scribe' })
  })

  it('une fois confirmé, le rôle du serveur fait foi', () => {
    expect(decideRoleSync({ pending: null, local: 'scribe', server: 'communication' })).toEqual({ type: 'adopt', role: 'communication' })
    expect(decideRoleSync({ pending: null, local: 'scribe', server: 'scribe' })).toEqual({ type: 'none' })
  })

  it('renvoie le rôle local inconnu du serveur', () => {
    expect(decideRoleSync({ pending: null, local: 'scribe', server: undefined })).toEqual({ type: 'push', role: 'scribe' })
    expect(decideRoleSync({ pending: null, local: '', server: undefined })).toEqual({ type: 'none' })
  })
})
