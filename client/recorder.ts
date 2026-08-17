/**
 * Buffered mic capture for push-to-talk.
 *
 * The worklet runs from the moment the player locks in — not from pointerdown —
 * so an answer that starts with the finger keeps its first syllable.
 * pointerdown only marks; pointerup cuts from the mark to now.
 *
 * The worklet source rides a blob URL: no build plumbing, no extra asset, and
 * the whole thing is the twenty lines below.
 */
const WORKLET = `
registerProcessor('pb-recorder', class extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0]
    if (ch) this.port.postMessage(ch.slice(0))
    return true
  }
})`

export class Recorder {
  private ctx: AudioContext | undefined
  private node: AudioWorkletNode | undefined
  private chunks: Float32Array[] = []
  private buffered = 0
  private markAt = 0
  private rate = 48000

  /** Start buffering. The stream is the caller's — permission came at join. */
  async start(stream: MediaStream): Promise<void> {
    this.stop()
    const ctx = new AudioContext()
    this.ctx = ctx
    this.rate = ctx.sampleRate
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const source = ctx.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(ctx, 'pb-recorder')
    this.chunks = []
    this.buffered = 0
    this.markAt = 0
    this.node.port.onmessage = (e) => {
      const chunk = e.data as Float32Array
      this.chunks.push(chunk)
      this.buffered += chunk.length
      // Keep the last ~10s: an answer never needs more, and a lock-in the host
      // stalls on should not grow a buffer for the whole stall.
      while (this.buffered > this.rate * 10 && this.chunks.length > 1) {
        const dropped = this.chunks.shift()!
        this.buffered -= dropped.length
        this.markAt = Math.max(0, this.markAt - dropped.length)
      }
    }
    source.connect(this.node)
    // Nothing to the destination: capture, not monitoring.
  }

  /** pointerdown. */
  mark(): void {
    this.markAt = this.buffered
  }

  /** pointerup: everything since the mark, and the rate it was captured at. */
  cut(): { samples: Float32Array; rate: number } {
    const all = new Float32Array(this.buffered)
    let off = 0
    for (const c of this.chunks) {
      all.set(c, off)
      off += c.length
    }
    return { samples: all.slice(this.markAt), rate: this.rate }
  }

  stop(): void {
    this.node?.disconnect()
    this.node = undefined
    void this.ctx?.close()
    this.ctx = undefined
  }
}
