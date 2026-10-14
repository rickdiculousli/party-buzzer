import { useState } from 'preact/hooks'
import { formatNumber } from '../shared/closest.ts'

/** Three rows of four, so a short phone keeps keys a thumb can hit. */
const KEYS = ['1', '2', '3', '⌫', '4', '5', '6', '.', '7', '8', '9', '0']
/** Digits a guess may hold, before and after the point together. */
const MAX_DIGITS = 12

/** The typed text after one key: digits, one point, and a backspace. */
function press(text: string, key: string): string {
  if (key === '⌫') return text.slice(0, -1)
  if (key === '.') return text.includes('.') ? text : `${text || '0'}.`
  if (text.replace('.', '').length >= MAX_DIGITS) return text
  return text === '0' ? key : text + key
}

/** "1665" as "1,665" (or as typed, for a year); a trailing point or zero after it stays as typed. */
function shown(text: string, plain: boolean): string {
  if (!text) return '0'
  const [whole, frac] = text.split('.')
  const w = formatNumber(Number(whole || '0'), plain)
  return frac === undefined ? w : `${w}.${frac}`
}

/**
 * A closest question's number pad: in the app, because a phone's own numeric
 * keyboard is not on every phone and covers half the screen when it is. The
 * typed value is large, with the unit, and a guess is final once locked in.
 */
export function GuessPad({ unit, plain = false, onGuess }: { unit?: string; plain?: boolean; onGuess: (n: number) => void }) {
  const [text, setText] = useState('')
  const value = Number(text)
  const ready = text !== '' && Number.isFinite(value)
  const typed = shown(text, plain)
  return (
    <div class="pad" data-review-id="phone:pad">
      {/* Lock in beside the number, not under the keys: a short phone has no row to spare. */}
      <div class="pad__top">
        {/* The type shrinks with the number, so a long one still shows its last digits and its unit. */}
        <p class={text ? 'pad__value' : 'pad__value is-empty'} style={{ '--len': Math.max(5, typed.length + (unit ? unit.length * 0.5 + 0.5 : 0)) }}>
          <span class="pad__digits">
            {typed}
            {unit && <span class="pad__unit"> {unit}</span>}
          </span>
        </p>
        <button class="btn btn--primary pad__go" disabled={!ready} onClick={() => ready && onGuess(value)}>
          Lock in
        </button>
      </div>
      <div class="pad__keys">
        {KEYS.map((k) => (
          <button key={k} class="pad__key" onClick={() => setText((t) => press(t, k))} aria-label={k === '⌫' ? 'Delete' : k}>
            {k === '⌫' ? (
              // Drawn: the display face has no erase glyph.
              <svg class="pad__erase" viewBox="0 0 24 16" aria-hidden="true">
                <path d="M7 1 H22 V15 H7 L1 8 Z M11 5 L17 11 M17 5 L11 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" />
              </svg>
            ) : (
              k
            )}
          </button>
        ))}
      </div>
    </div>
  )
}
