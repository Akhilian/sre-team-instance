import { describe, expect, it } from 'vitest'
import type { Message } from '../shared/types/chat'
import { groupThreads } from '../app/utils/threads'

function msg(id: string, minute: number, parentId?: string): Message {
  const message: Message = {
    id,
    channelId: 'general',
    author: 'Alice',
    text: id,
    createdAt: new Date(Date.UTC(2026, 9, 23, 8, minute)).toISOString(),
  }
  if (parentId !== undefined) message.parentId = parentId
  return message
}

describe('groupThreads', () => {
  it('renvoie une liste vide pour aucun message', () => {
    expect(groupThreads([])).toEqual([])
  })

  it('ordonne les racines chronologiquement', () => {
    const threads = groupThreads([msg('b', 2), msg('a', 1), msg('c', 3)])
    expect(threads.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })

  it('rattache les réponses à leur racine, triées chronologiquement', () => {
    const threads = groupThreads([
      msg('r1', 1),
      msg('r2', 2),
      msg('x3', 5, 'r1'),
      msg('x1', 3, 'r1'),
      msg('y1', 4, 'r2'),
    ])
    expect(threads.map(t => t.id)).toEqual(['r1', 'r2'])
    expect(threads[0]!.replies.map(r => r.id)).toEqual(['x1', 'x3'])
    expect(threads[1]!.replies.map(r => r.id)).toEqual(['y1'])
  })

  it('ignore une réponse orpheline', () => {
    const threads = groupThreads([msg('r1', 1), msg('o', 2, 'absent')])
    expect(threads).toHaveLength(1)
    expect(threads[0]!.replies).toEqual([])
  })

  it('n\'ajoute pas les réponses comme racines', () => {
    const threads = groupThreads([msg('r1', 1), msg('x1', 2, 'r1')])
    expect(threads.map(t => t.id)).toEqual(['r1'])
  })
})
