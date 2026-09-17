import { render } from 'preact'
import { Board } from '../Board.tsx'
import { Player } from '../Player.tsx'
import type { ReviewScenario } from './model.ts'

function installPicker(selection: { scenarioId: string; surface: 'board' | 'phone'; playerId?: string }) {
  const highlight = document.createElement('div')
  highlight.style.cssText = [
    'position:fixed', 'pointer-events:none', 'z-index:2147483646',
    'border:2px solid #00e5ff', 'box-shadow:0 0 0 1px #0b0a08', 'display:none',
  ].join(';')
  const picker = document.createElement('div')
  picker.setAttribute('aria-label', 'Select an element to annotate')
  picker.style.cssText = [
    'position:fixed', 'inset:0', 'z-index:2147483647', 'cursor:crosshair', 'background:transparent',
  ].join(';')
  document.body.append(highlight, picker)

  const targetAt = (x: number, y: number) => {
    picker.style.pointerEvents = 'none'
    const raw = document.elementFromPoint(x, y) as HTMLElement | null
    picker.style.pointerEvents = 'auto'
    return raw?.closest<HTMLElement>('[data-review-id],button,img,p,li,section,aside,main') ?? null
  }
  const show = (target: HTMLElement | null) => {
    if (!target) {
      highlight.style.display = 'none'
      return
    }
    const rect = target.getBoundingClientRect()
    highlight.style.display = 'block'
    highlight.style.left = `${rect.left}px`
    highlight.style.top = `${rect.top}px`
    highlight.style.width = `${rect.width}px`
    highlight.style.height = `${rect.height}px`
  }
  picker.addEventListener('pointermove', (event) => show(targetAt(event.clientX, event.clientY)))
  picker.addEventListener('pointerleave', () => show(null))
  picker.addEventListener('click', (event) => {
    event.preventDefault()
    const target = targetAt(event.clientX, event.clientY)
    if (!target) return
    const rect = target.getBoundingClientRect()
    parent.postMessage({
      type: 'review:select',
      selection: {
        ...selection,
        targetId: target.dataset.reviewId,
        targetText: (target.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 160),
        bounds: {
          x: rect.left + scrollX,
          y: rect.top + scrollY,
          width: rect.width,
          height: rect.height,
        },
        scroll: { x: scrollX, y: scrollY },
      },
    }, location.origin)
  })
}

async function start() {
  const response = await fetch('/__review/scenarios')
  if (!response.ok) throw new Error(`Could not load review scenarios (${response.status})`)
  const { scenarios } = await response.json() as { scenarios: ReviewScenario[] }
  const params = new URLSearchParams(location.search)
  const scenario = scenarios.find((item) => item.id === params.get('scenario')) ?? scenarios[0]
  if (!scenario) throw new Error('No review scenarios are available')
  const surface = params.get('surface') === 'phone' ? 'phone' : 'board'
  const presentation = scenario.presentation
  let selectedPlayerId: string | undefined

  if (surface === 'board') {
    render(
      <Board preview={{
        socket: { state: scenario.board, connected: true, now: presentation.now, frame: scenario.boardFrame },
        open: presentation.open,
        delay: presentation.delay,
        settled: presentation.settled,
        retired: presentation.retired,
      }} />,
      document.getElementById('app')!,
    )
  } else {
    const phone = scenario.phones.find((item) => item.playerId === params.get('player')) ?? scenario.phones[0]
    if (!phone) throw new Error('This review scenario has no phone')
    selectedPlayerId = phone.playerId
    render(
      <Player preview={{
        socket: {
          state: phone.state,
          playerId: phone.playerId,
          connected: true,
          now: presentation.now,
          frame: phone.frame,
        },
        open: presentation.open,
        delay: presentation.delay,
        pressed: phone.pressed,
      }} />,
      document.getElementById('app')!,
    )
  }

  await document.fonts.ready
  installPicker({ scenarioId: scenario.id, surface, playerId: selectedPlayerId })
  document.documentElement.dataset.reviewReady = 'true'
}

void start().catch((error: Error) => {
  document.getElementById('app')!.textContent = error.message
  document.documentElement.dataset.reviewReady = 'error'
})
