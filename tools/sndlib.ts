/**
 * The pure half of the sound library middleware.
 *
 * Everything here is a decision — is this path safe, is this name allowed, what
 * exactly does ffmpeg get told — and nothing here touches the disk or spawns
 * anything. That is what makes it testable from Node in a few lines, and it is
 * why the Vite plugin that uses it stays a thin shell.
 */
import { basename, resolve } from 'node:path'

const AUDIO = /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i

/**
 * A raw file's absolute path, or null if the name has no business being served.
 *
 * A name is refused outright if it is not already its own basename — silently
 * reducing `nested/../../out.wav` to the harmless `out.wav` would still serve
 * a file, just not the one the caller thinks it named. The resolved-path
 * prefix check stays as a second line of defence for whatever that basename
 * comparison did not think of.
 */
export function safeRaw(root: string, name: string): string | null {
  const base = basename(name)
  if (!base || base !== name || base.startsWith('.') || !AUDIO.test(base)) return null
  const full = resolve(root, base)
  return full.startsWith(resolve(root) + '/') ? full : null
}

export type AdoptOpts = {
  preset: 'one-shot' | 'bed'
  input: string
  output: string
  /**
   * The dialled trim, in ms. `headMs` is where in the input to start; `cutMs`
   * is how long the *output* runs from there, the same meaning `play()` and the
   * harness's audition give it. `cutMs: 0` means the whole file.
   */
  headMs: number
  cutMs: number
  rate: number
}

/** How long the cut takes to fall silent, matching `RELEASE_MS` in sound.ts. */
const FADE_S = 0.04

/** An adopted file's name. Narrow on purpose: this becomes a path we write. */
export function safeOut(name: string): string | null {
  return /^[a-z0-9-]+\.(wav|ogg)$/.test(name) ? name : null
}

/**
 * The exact argument list, so the credits row can quote what actually ran.
 *
 * One-shot bakes the dialled trim and rate into PCM. Rate is `asetrate` plus
 * `aresample` rather than `atempo`, because speed and pitch are one knob at
 * runtime and the baked file has to match what you heard while dialling it.
 *
 * ponytail: one input file. Muxing several is not built — layers already mix at
 * play time, and a baked mix would be an OfflineAudioContext render rather than
 * an ffmpeg graph.
 */
export function ffmpegArgs(o: AdoptOpts): string[] {
  if (o.preset === 'bed')
    return ['-y', '-i', o.input, '-c:a', 'libopus', '-b:a', '64k', '-ac', '1', o.output]

  const head = o.headMs / 1000
  const cut = o.cutMs / 1000
  const rate = Math.max(0.05, o.rate)
  // `cut` is output length, so the span of input it takes is `cut * rate`:
  // asetrate plays the trimmed span faster, and atrim's second argument is an
  // absolute timestamp in the input rather than a duration.
  const end = Number((head + cut * rate).toFixed(6))
  const chain = [cut > 0 ? `atrim=${head}:${end}` : `atrim=${head}`, 'asetpts=N/SR/TB']
  if (rate !== 1) chain.push(`asetrate=${Math.round(44100 * rate)}`, 'aresample=44100')
  // Only a known end can be faded against; `cut: 0` is the whole file, whose
  // length this function does not know and should not go and read.
  if (cut > 0) {
    // `cut` seconds of output by construction, whatever the rate did to the input.
    const st = Math.max(0, cut - FADE_S)
    chain.push(`afade=t=out:st=${Number(st.toFixed(4))}:d=${FADE_S}`)
  }
  return ['-y', '-i', o.input, '-af', chain.join(','), '-ac', '1', '-ar', '44100', o.output]
}

/** One row of CREDITS.md, trailing newline included. */
export function creditsRow(o: {
  out: string
  role: string
  source: string
  command: string
}): string {
  return `| \`${o.out}\` | ${o.role} | From \`${o.source}\` via \`${o.command}\` |\n`
}
