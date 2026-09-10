import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationOwner, getConversation, listConversations, saveConversation } from './ai-conversations.mjs'

test('assistant conversations persist per site and owner without leaking messages', () => {
  const db = {}
  const owner = conversationOwner({ userId: 'user-1', role: 'client' })
  const other = conversationOwner({ userId: 'user-2', role: 'client' })
  const saved = saveConversation({
    db,
    site: 'escarlet',
    ownerId: owner,
    conversation: {
      id: 'conversation-1',
      title: 'Idea de diseño',
      messages: [
        { role: 'assistant', text: 'Hola' },
        { role: 'user', text: 'Quiero escribir sobre diseño y tecnología.' }
      ]
    }
  })

  assert.equal(saved.messageCount, 2)
  assert.equal(listConversations({ db, site: 'escarlet', ownerId: owner }).length, 1)
  assert.equal(listConversations({ db, site: 'mariamorales', ownerId: owner }).length, 0)
  assert.equal(listConversations({ db, site: 'escarlet', ownerId: other }).length, 0)
  assert.equal(getConversation({ db, site: 'escarlet', ownerId: owner, id: saved.id }).messages[1].text, 'Quiero escribir sobre diseño y tecnología.')
})
