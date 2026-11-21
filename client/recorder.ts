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

  async start(stream: MediaStream, ctx: AudioContext): Promise<void> {
    this.stop()
    this.ctx = ctx
    if (ctx.state === 'suspended') await ctx.resume()
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
      while (this.buffered > this.rate * 10 && this.chunks.length > 1) {
        const dropped = this.chunks.shift()!
        this.buffered -= dropped.length
        this.markAt = Math.max(0, this.markAt - dropped.length)
      }
    }
    source.connect(this.node)
  }

  mark(): void {
    this.markAt = this.buffered
  }

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
    this.ctx = undefined
  }
}
