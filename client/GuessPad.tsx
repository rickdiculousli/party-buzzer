import { useState } from 'preact/hooks'
import { formatNumber } from '../shared/closest.ts'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫']
/** Digits a guess may hold, before and after the point together. */
const MAX_DIGITS = 12

/** The typed text after one key: digits, one point, and a backspace. */
function press(text: string, key: string): string {
  if (key === '⌫') return text.slice(0, -1)
  if (key === '.') return text.includes('.') ? text : `${text || '0'}.`
  if (text.replace('.', '').length >= MAX_DIGITS) return text
  return text === '0' ? key : text + key
}

/** "1665" as "1,665"; a trailing point or zero after it stays as typed. */
function shown(text: string): string {
  if (!text) return '0'
  const [whole, frac] = text.split('.')
  return frac === undefined ? formatNumber(Number(whole)) : `${formatNumber(Number(whole || '0'))}.${frac}`
}

/**
 * A closest question's number pad: in the app, because a phone's own numeric
 * keyboard is not on every phone and covers half the screen when it is. The
 * typed value is large, with the unit, and a guess is final once locked in.
 */
export function GuessPad({ unit, onGuess }: { unit?: string; onGuess: (n: number) => void }) {
  const [text, setText] = useState('')
  const value = Number(text)
  const ready = text !== '' && Number.isFinite(value)
  return (
    <div class="pad" data-review-id="phone:pad">
      <p class={text ? 'pad__value' : 'pad__value is-empty'}>
        {shown(text)}
        {unit && <span class="pad__unit"> {unit}</span>}
      </p>
      <div class="pad__keys">
        {KEYS.map((k) => (
          <button key={k} class="pad__key" onClick={() => setText((t) => press(t, k))} aria-label={k === '⌫' ? 'Delete' : k}>
            {k}
          </button>
        ))}
      </div>
      <button class="btn btn--primary pad__go" disabled={!ready} onClick={() => ready && onGuess(value)}>
        Lock in
      </button>
    </div>
  )
}
