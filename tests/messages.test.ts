import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types/chat'
import { mergeMessages } from '../app/utils/messages'

function message(id: string, rev: number, createdAt = `2026-10-23T08:00:0${rev % 10}.000Z`, text = id): Message {
  return { id, channelId: 'general', author: 'Alice', text, createdAt, rev }
}

describe('mergeMessages', () => {
  it('remplace un message connu sur place et ajoute les nouveaux à la fin', () => {
    const current = [message('a', 1), message('b', 2)]
    const merged = mergeMessages(current, [message('c', 3), message('a', 4, current[0]!.createdAt, 'modifié')], 2000)
    expect(merged.map(m => m.id)).toEqual(['a', 'b', 'c'])
    expect(merged[0]!.text).toBe('modifié')
    expect(current[0]!.text).toBe('a')
  })

  it('ajoute les nouveaux messages dans l\'ordre de création, pas de révision', () => {
    // b créé avant c, mais modifié après (réaction) : rev plus haut
    const merged = mergeMessages([], [message('c', 3, '2026-10-23T08:00:02.000Z'), message('b', 4, '2026-10-23T08:00:01.000Z')], 2000)
    expect(merged.map(m => m.id)).toEqual(['b', 'c'])
  })

  it('ne garde que les max derniers', () => {
    const merged = mergeMessages([message('a', 1), message('b', 2)], [message('c', 3)], 2)
    expect(merged.map(m => m.id)).toEqual(['b', 'c'])
  })
})
