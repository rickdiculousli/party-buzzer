import { render } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { loadDraft, saveDraft } from './drafts.ts'
import type { Annotation, ReviewScenario, ReviewSelection } from './model.ts'

const WORKSPACE = 'party-buzzer'
const THREAD_KEY = 'party-buzzer:review:codex-thread'

type Session = {
  delivery: 'codex' | 'clipboard'
  batchRoot: string
}

type Delivery = {
  batchId: string
  status: 'submitting' | 'submitted' | 'delivery-uncertain' | 'delivery-failed' | 'acknowledged' | 'ready' | 'blocked'
  message?: string
}

function frameUrl(scenario: string, surface: 'board' | 'phone', player?: string, revision = 0) {
  const params = new URLSearchParams({ scenario, surface })
  if (player) params.set('player', player)
  params.set('revision', String(revision))
  return `/review-frame.html?${params}`
}

function Workbench() {
  const [scenarios, setScenarios] = useState<ReviewScenario[]>([])
  const [selected, setSelected] = useState(() => new URLSearchParams(location.search).get('scenario') ?? '')
  const [player, setPlayer] = useState('')
  const [draft, setDraft] = useState(() => loadDraft(localStorage, WORKSPACE))
  const [threadId, setThreadId] = useState(() => localStorage.getItem(THREAD_KEY) ?? '')
  const [session, setSession] = useState<Session>({ delivery: 'clipboard', batchRoot: '' })
  const [handoff, setHandoff] = useState('')
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    void fetch('/__review/scenarios')
      .then((response) => response.json())
      .then(({ scenarios: loaded }: { scenarios: ReviewScenario[] }) => {
        setScenarios(loaded)
        const scenario = loaded.find((item) => item.id === selected) ?? loaded[0]
        setSelected(scenario?.id ?? '')
        setPlayer(scenario?.phones[0]?.playerId ?? '')
      })
    void fetch('/__review/session')
      .then((response) => response.json())
      .then(({ threadId: detected, delivery: mode, batchRoot }: Session & { threadId: string }) => {
        setSession({ delivery: mode, batchRoot })
        if (!detected || threadId) return
        setThreadId(detected)
        localStorage.setItem(THREAD_KEY, detected)
      })
  }, [])

  useEffect(() => {
    if (!delivery || !['submitted', 'acknowledged'].includes(delivery.status)) return
    const timer = setInterval(() => {
      void fetch(`/__review/batches/${delivery.batchId}`)
        .then((response) => response.json())
        .then((next: Delivery) => {
          // The agent has the batch: the paste line is spent.
          if (next.status !== 'submitted') setHandoff('')
          if (next.status !== 'ready' && next.status !== 'blocked') {
            setDelivery(next)
            return
          }
          setDelivery(null)
          changeDraft((current) => ({
            ...current,
            annotations: current.annotations.map((note) => note.batchId === next.batchId
              ? { ...note, status: 'resolved' as const, outcome: next.status, message: next.message }
              : note),
          }))
        })
    }, 1_500)
    return () => clearInterval(timer)
  }, [delivery?.batchId, delivery?.status])

  /** After the next render puts it on screen. */
  const focusNote = (id: string) => requestAnimationFrame(() => {
    document.getElementById(`note-${id}`)?.focus()
  })

  const changeDraft = (change: (current: typeof draft) => typeof draft) => {
    setDraft((current) => {
      const next = change(current)
      saveDraft(localStorage, WORKSPACE, next)
      return next
    })
  }

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.origin !== location.origin) return
      const data = event.data as { type?: string; selection?: ReviewSelection }
      if (data.type !== 'review:select' || !data.selection) return
      const pick = data.selection
      const same = (note: Annotation) => note.status === 'open'
        && note.scenarioId === pick.scenarioId
        && note.surface === pick.surface
        && note.playerId === pick.playerId
        && (note.targetId ?? note.targetText) === (pick.targetId ?? pick.targetText)
      const annotation: Annotation = { ...pick, id: crypto.randomUUID(), text: '', status: 'open' }
      changeDraft((current) => {
        const existing = current.annotations.find(same)
        focusNote(existing?.id ?? annotation.id)
        return existing ? current : { ...current, annotations: [...current.annotations, annotation] }
      })
    }
    addEventListener('message', receive)
    return () => removeEventListener('message', receive)
  }, [])

  const scenario = scenarios.find((item) => item.id === selected)
  const select = (id: string) => {
    const next = scenarios.find((item) => item.id === id)
    setSelected(id)
    setPlayer(next?.phones[0]?.playerId ?? '')
    history.replaceState(null, '', `?scenario=${encodeURIComponent(id)}`)
  }
  const edit = (id: string, changes: Partial<Annotation>) => {
    changeDraft((current) => ({
      ...current,
      annotations: current.annotations.map((note) => note.id === id ? { ...note, ...changes } : note),
    }))
  }
  const remove = (id: string) => {
    changeDraft((current) => ({
      ...current,
      annotations: current.annotations.filter((note) => note.id !== id),
    }))
  }
  const send = async () => {
    const annotations = draft.annotations.filter((note) => note.status === 'open' && note.text.trim())
    const clipboard = session.delivery === 'clipboard'
    if ((!clipboard && !threadId.trim()) || annotations.length === 0) return
    const batchId = crypto.randomUUID()
    setDelivery({ batchId, status: 'submitting' })
    setHandoff('')
    localStorage.setItem(THREAD_KEY, threadId.trim())
    try {
      const response = await fetch('/__review/batches', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ batchId, threadId: threadId.trim(), annotations }),
        // A dev-server restart during capture leaves the request hanging; fail instead of waiting forever.
        signal: AbortSignal.timeout(120_000),
      })
      const result = await response.json() as Delivery & { error?: string }
      if (!response.ok) throw new Error(result.error ?? `Submission failed (${response.status})`)
      setDelivery(result)
      const sent = new Set(annotations.map((note) => note.id))
      changeDraft((current) => ({
        ...current,
        annotations: current.annotations.map((note) =>
          sent.has(note.id) ? { ...note, status: 'sent' as const, batchId } : note),
      }))
      if (clipboard) {
        const message = `Review batch ${batchId}. Read ${session.batchRoot}/${batchId}/request.md.`
        setHandoff(message)
        void navigator.clipboard?.writeText(message).catch(() => {})
      }
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError'
      setDelivery({
        batchId,
        status: 'delivery-failed',
        message: timedOut
          ? 'The review server never answered. Your notes are untouched; dismiss this and press Send again.'
          : (error as Error).message,
      })
    }
  }
  const open = draft.annotations.filter((note) => note.status === 'open')
  const done = draft.annotations.filter((note) => note.status !== 'open')
  const sendable = open.filter((note) => note.text.trim()).length

  return (
    <main class="review">
      <aside class="review__panel">
        <p class="eyebrow">Review workbench</p>
        <h1>Frozen views</h1>
        <label class="review__field">
          Scenario
          <select value={selected} onChange={(event) => select(event.currentTarget.value)}>
            {scenarios.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label class="review__field">
          Phone
          <select value={player} onChange={(event) => setPlayer(event.currentTarget.value)}>
            {scenario?.phones.map((phone) => (
              <option key={phone.playerId} value={phone.playerId}>{phone.label}</option>
            ))}
          </select>
        </label>
        <p class="review__hint">Click anything in a preview to attach a suggestion.</p>
        {session.delivery === 'codex' && (
          <label class="review__field">
            Codex conversation
            <input
              value={threadId}
              placeholder="Exact thread UUID"
              onInput={(event) => setThreadId(event.currentTarget.value)}
            />
          </label>
        )}
        <div class="review__actions">
          <button
            class="btn btn--primary"
            disabled={
              (session.delivery === 'codex' && !threadId.trim())
              || sendable === 0
              || delivery?.status === 'submitting'
            }
            onClick={() => void send()}
          >
            Send {sendable} {sendable === 1 ? 'note' : 'notes'}
          </button>
          <button class="btn" onClick={() => setRefresh((value) => value + 1)}>Refresh previews</button>
        </div>
        {delivery && (
          <div class="review__delivery" role="status">
            <span class="chip">{delivery.status}</span>
            <span class="readout">{delivery.batchId.slice(0, 8)}</span>
            <button class="btn review__dismiss" aria-label="Dismiss" onClick={() => {
              setDelivery(null)
              setHandoff('')
            }}>×</button>
            {delivery.message && <p>{delivery.message}</p>}
            {handoff && (
              <>
                <p>Copied. Paste this into the agent conversation and press enter.</p>
                <textarea class="review__handoff" readOnly rows={3} value={handoff} />
              </>
            )}
          </div>
        )}
        <div class="review__notes">
          {open.map((note, index) => (
            <article key={note.id} class={note.status === 'resolved' ? 'review__note is-resolved' : 'review__note'}>
              <p class="eyebrow">{index + 1} · {note.surface} · {note.targetId ?? note.targetText ?? 'region'}</p>
              <textarea
                id={`note-${note.id}`}
                aria-label={`Suggestion ${index + 1}`}
                value={note.text}
                placeholder="Describe what should change"
                onInput={(event) => edit(note.id, { text: event.currentTarget.value })}
              />
              <div class="review__note-actions">
                <button class="btn" onClick={() => edit(note.id, { status: 'resolved' })}>Resolve</button>
                <button class="btn" onClick={() => remove(note.id)}>Remove</button>
              </div>
            </article>
          ))}
        </div>
        {done.length > 0 && (
          <details class="review__done">
            <summary>Done ({done.length})</summary>
            {done.map((note) => (
              <article key={note.id} class="review__note is-resolved">
                <p class="eyebrow">
                  {note.surface} · {note.targetId ?? note.targetText ?? 'region'}
                  {note.batchId && <span class="readout"> {note.batchId.slice(0, 8)}</span>}
                  {' '}<span class="chip">{note.outcome ?? note.status}</span>
                </p>
                <p>{note.text}</p>
                {note.message && <p class="review__note-message">{note.message}</p>}
                <div class="review__note-actions">
                  <button class="btn" onClick={() => edit(note.id, { status: 'open' })}>Reopen</button>
                  <button class="btn" onClick={() => remove(note.id)}>Remove</button>
                </div>
              </article>
            ))}
            <button class="btn" onClick={() => changeDraft((current) => ({
              ...current,
              annotations: current.annotations.filter((note) => note.status === 'open'),
            }))}>Clear done</button>
          </details>
        )}
      </aside>
      {scenario ? (
        <section class="review__previews">
          <article class="review__preview review__preview--board">
            <p class="eyebrow">Board</p>
            <iframe key={`board:${refresh}`} title="Board preview" src={frameUrl(scenario.id, 'board', undefined, refresh)} />
          </article>
          <article class="review__preview review__preview--phone">
            <p class="eyebrow">Phone</p>
            <iframe key={`phone:${player}:${refresh}`} title="Phone preview" src={frameUrl(scenario.id, 'phone', player, refresh)} />
          </article>
        </section>
      ) : <p class="review__loading">Loading scenarios</p>}
    </main>
  )
}

render(<Workbench />, document.getElementById('app')!)
