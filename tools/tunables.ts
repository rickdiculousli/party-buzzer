export function setConstant(src: string, key: string, value: string): string | null {
  if (!/^-?\d+(\.\d+)?$/.test(value)) return null
  const [name, field, index, ...rest] = key.split('.')
  if (!/^\w+$/.test(name ?? '') || !/^\w+$/.test(field ?? '') || rest.length) return null
  const start = src.indexOf(`export const ${name} = {\n`)
  if (start < 0) return null
  const end = src.indexOf('\n}', start)
  if (end < 0) return null
  const block = src.slice(start, end)
  const line = new RegExp(`^( {2}${field}: )(.+?)(,?)$`, 'm').exec(block)
  if (!line) return null
  const [whole, head, old, comma] = line
  let next: string
  if (index === undefined) {
    if (!/^-?[\d.]+$/.test(old)) return null
    next = value
  } else {
    const range = /^\[(.*)\]( as const)?$/.exec(old)
    const ends = range?.[1].split(',').map((s) => s.trim())
    const i = Number(index)
    if (!range || !ends || !Number.isInteger(i) || i < 0 || i >= ends.length) return null
    ends[i] = value
    next = `[${ends.join(', ')}]${range[2] ?? ''}`
  }
  const at = start + line.index
  return src.slice(0, at) + head + next + comma + src.slice(at + whole.length)
}
