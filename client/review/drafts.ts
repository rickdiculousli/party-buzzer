import type { ReviewDraft } from './model.ts'

type StorageLike = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

type TargetRoot = {
  querySelectorAll(selector: string): { length: number }
}

const keyFor = (workspace: string) => `party-buzzer:review:${workspace}:draft:v1`

export function loadDraft(storage: StorageLike, workspace: string): ReviewDraft {
  const raw = storage.getItem(keyFor(workspace))
  if (!raw) return { version: 1, annotations: [] }
  try {
    const parsed = JSON.parse(raw) as Partial<ReviewDraft>
    if (parsed.version !== 1 || !Array.isArray(parsed.annotations)) {
      return { version: 1, annotations: [] }
    }
    return parsed as ReviewDraft
  } catch {
    return { version: 1, annotations: [] }
  }
}

export function saveDraft(storage: StorageLike, workspace: string, draft: ReviewDraft): void {
  storage.setItem(keyFor(workspace), JSON.stringify(draft))
}

export function locateTarget(
  root: TargetRoot,
  targetId: string,
): 'located' | 'missing' | 'ambiguous' {
  const count = root.querySelectorAll(`[data-review-id="${targetId}"]`).length
  if (count === 0) return 'missing'
  if (count > 1) return 'ambiguous'
  return 'located'
}
