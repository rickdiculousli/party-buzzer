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
