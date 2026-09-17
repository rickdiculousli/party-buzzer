import test from 'node:test'
import assert from 'node:assert/strict'

class MemoryStorage {
  private values = new Map<string, string>()
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

test('review drafts persist annotations without changing submitted data', async () => {
  const mod = await import('./review/drafts.ts').catch(() => ({})) as {
    saveDraft?: (storage: MemoryStorage, workspace: string, draft: unknown) => void
    loadDraft?: (storage: MemoryStorage, workspace: string) => unknown
  }
  assert.equal(typeof mod.saveDraft, 'function')
  assert.equal(typeof mod.loadDraft, 'function')
  const storage = new MemoryStorage()
  const draft = {
    version: 1,
    annotations: [{
      id: 'note-1', scenarioId: 'open', surface: 'phone', playerId: 'ada',
      text: 'Make this clearer', targetId: 'phone:buzzer',
      bounds: { x: 10, y: 20, width: 30, height: 40 }, scroll: { x: 0, y: 100 },
      status: 'open',
    }],
  }
  mod.saveDraft!(storage, 'party-buzzer', draft)
  assert.deepEqual(mod.loadDraft!(storage, 'party-buzzer'), draft)
})

test('target lookup distinguishes missing, unique, and ambiguous ids', async () => {
  const { locateTarget } = await import('./review/drafts.ts')
  const root = (length: number) => ({ querySelectorAll: () => ({ length }) })
  assert.equal(locateTarget(root(0), 'phone:buzzer'), 'missing')
  assert.equal(locateTarget(root(1), 'phone:buzzer'), 'located')
  assert.equal(locateTarget(root(2), 'phone:buzzer'), 'ambiguous')
})
