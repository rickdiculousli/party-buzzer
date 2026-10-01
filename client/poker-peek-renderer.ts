import { POKER_PRINT_GEOMETRY, POKER_PRINT_VERSIONS } from './poker-prints.generated.ts'
import type { Point } from './poker.ts'
import type { BendProfile } from './poker-bend.ts'
import { BEND_ANGLE, BEND_ELEVATION, BEND_TABLE_SEGMENTS, bendTable } from './poker-bend.ts'

export type PeekPose = { w: number; h: number; left: number; top: number; cos: number; sin: number }
export type PeekBounds = { x: number; y: number; w: number; h: number }
const BANDS = 48
const MAX_PIXELS = 1_500_000

const VERTEX = `
precision highp float;
attribute vec2 a_uv;
uniform vec4 u_box;
uniform vec4 u_pose; // centre x/y, rotation cos/sin
uniform vec2 u_size;
uniform vec4 u_other_pose;
uniform vec2 u_other_size;
uniform vec2 u_crease;
uniform vec2 u_normal;
uniform vec2 u_profile; // depth, length
uniform vec4 u_span; // across min/max, flat endpoint, raised endpoint
uniform vec2 u_arc[${BEND_TABLE_SEGMENTS + 1}];
uniform float u_layer;
uniform float u_shadow;
varying vec2 v_uv;
varying vec2 v_other_uv;
varying float v_depth;
varying float v_material;
void main() {
  vec2 tangent = vec2(-u_normal.y, u_normal.x);
  float material = a_uv.y < 0.0 ? u_span.z : (a_uv.y > 1.0 ? u_span.w : a_uv.y * u_profile.y);
  vec2 rest = u_crease + tangent * mix(u_span.x, u_span.y, a_uv.x) - u_normal * material;
  vec2 delta = rest - u_pose.xy;
  vec2 uv = vec2(delta.x * u_pose.z + delta.y * u_pose.w, -delta.x * u_pose.w + delta.y * u_pose.z) / u_size + 0.5;
  float s = max(0.0, material);
  float length = max(0.001, u_profile.y);
  float t = clamp(s / length, 0.0, 1.0);
  float index = t * ${BEND_TABLE_SEGMENTS}.0;
  int i = int(min(floor(index), ${BEND_TABLE_SEGMENTS - 1}.0));
  vec2 arc = mix(u_arc[i], u_arc[i + 1], index - float(i)) * length;
  arc += max(0.0, s - length) * vec2(${-Math.cos(BEND_ANGLE)}, ${Math.sin(BEND_ANGLE)});
  float theta = ${BEND_ANGLE} * t*t*t * (t*(6.0*t-15.0)+10.0);
  vec2 projected = rest + u_normal * (s + arc.x);
  float height = arc.y + u_layer * cos(theta);
  if (u_shadow > 0.5) {
    // One common affine projection anchored at contact. Its height-dependent spread
    // begins at the crease, rather than extrapolating an offset raised plane.
    projected = u_crease + tangent * dot(rest - u_crease, tangent)
      + (-u_normal * 0.32 + vec2(0.1, 0.14)) * material;
    height = 0.0;
  } else {
    // Stack separation follows the surface normal, reversing naturally through the turn.
    // Subtract its resting projection so the native and GPU flat edges coincide exactly.
    projected += u_normal * (u_layer * sin(theta));
    projected.y -= ${BEND_ELEVATION} * (height - u_layer);
  }
  vec2 screen = (projected - u_box.xy) / u_box.zw;
  gl_Position = vec4(screen.x * 2.0 - 1.0, 1.0 - screen.y * 2.0, -height / 1024.0, 1.0);
  v_uv = uv;
  vec2 other = rest - u_other_pose.xy;
  v_other_uv = vec2(other.x * u_other_pose.z + other.y * u_other_pose.w,
    -other.x * u_other_pose.w + other.y * u_other_pose.z) / u_other_size + 0.5;
  v_depth = s;
  v_material = material;
}`

const FRAGMENT = `
precision highp float;
uniform vec4 u_print;
uniform vec2 u_other_size;
uniform sampler2D u_face;
uniform sampler2D u_back;
uniform vec2 u_size;
uniform vec2 u_profile;
uniform float u_shadow;
varying vec2 v_uv;
varying vec2 v_other_uv;
varying float v_depth;
varying float v_material;
float shadowOutline(vec2 uv, vec2 size) {
  float corner = size.x * 0.056;
  vec2 delta = abs((uv - 0.5) * size) - size * 0.5 + corner;
  float edge = length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - corner;
  // Near cloth the occlusion is tight; elevated stock spreads the penumbra.
  float blur = size.x * 0.012 + max(0.0, v_material) * 0.23;
  return (1.0 - smoothstep(-blur, blur, edge)) * smoothstep(-blur, blur, v_material);
}
void main() {
  if (u_shadow > 0.5) {
    // Same lamp, opaque stock: union coverage before blending onto the felt once.
    float coverage = max(shadowOutline(v_uv, u_size), shadowOutline(v_other_uv, u_other_size));
    float alpha = coverage * min(0.38, u_profile.x / u_size.x * 0.45);
    gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
    return;
  }
  vec2 texUV = v_uv * u_print.xy + u_print.zw;
  if (texUV.x < 0.0 || texUV.x > 1.0 || texUV.y < 0.0 || texUV.y > 1.0) discard;
  // At rest the printed back faces the viewer. Its opposite uses mirrored face UVs.
  vec4 print = gl_FrontFacing ? texture2D(u_back, texUV) : texture2D(u_face, vec2(1.0 - texUV.x, texUV.y));
  if (print.a < 0.01) discard;
  float t = clamp(v_depth / max(0.001, u_profile.y), 0.0, 1.0);
  float theta = ${BEND_ANGLE} * t*t*t * (t*(6.0*t-15.0)+10.0);
  float sine = sin(theta);
  float light = 0.22 * sine - 0.32 * sine*sine*sine*sine - 0.1 * v_depth / max(0.001, u_profile.x);
  print.rgb = light > 0.0 ? mix(print.rgb, vec3(1.0), light) : print.rgb * (1.0 + light);
  gl_FragColor = print;
}`

/** Two whole textured cards. No DOM paint, buffer allocation or texture upload on drag frames.
 * The caller owns input, rAF and native/GPU visibility. This renderer has no animation clock.
 */
export class PokerPeekRenderer {
  ready = false
  private disposed = false
  private program: WebGLProgram | null = null
  private shaders: WebGLShader[] = []
  private buffers: WebGLBuffer[] = []
  private textures: WebGLTexture[] = []
  private images: HTMLImageElement[] = []
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private poses: { size: Float32Array; pose: Float32Array }[] = []
  private bounds: PeekBounds | null = null
  private corners: Point[] = []
  private readonly count = (BANDS + 2) * 6

  private constructor(private canvas: HTMLCanvasElement, private gl: WebGLRenderingContext, private unavailable: () => void) {
    canvas.addEventListener('webglcontextlost', this.lost)
    canvas.addEventListener('webglcontextrestored', this.restored)
  }

  static create(canvas: HTMLCanvasElement, cards: readonly string[], unavailable: () => void) {
    const gl = canvas.getContext('webgl', { alpha: true, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: false })
    if (!gl) return null
    const renderer = new PokerPeekRenderer(canvas, gl, unavailable)
    void renderer.prepare(cards)
    return renderer
  }

  private async prepare(cards: readonly string[]) {
    try {
      const images = await Promise.all([...cards, 'back'].map(async (card) => {
        const image = new Image()
        image.src = `/poker/prints/${card}.webp?v=${POKER_PRINT_VERSIONS[card]}`
        await image.decode()
        return image
      }))
      if (this.disposed) return
      this.images = images
      if (!this.gl.isContextLost()) this.initialize()
    } catch {
      if (!this.disposed) { this.release(); this.unavailable() }
    }
  }

  private initialize() {
    const gl = this.gl
    this.ready = false
    try {
      const shader = (kind: number, source: string) => {
        const result = gl.createShader(kind)
        if (!result) throw new Error('No shader')
        this.shaders.push(result)
        gl.shaderSource(result, source); gl.compileShader(result)
        if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(result) ?? 'Shader failed')
        return result
      }
      const vertex = shader(gl.VERTEX_SHADER, VERTEX), fragment = shader(gl.FRAGMENT_SHADER, FRAGMENT)
      this.program = gl.createProgram()
      if (!this.program) throw new Error('No program')
      gl.attachShader(this.program, vertex); gl.attachShader(this.program, fragment); gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(this.program) ?? 'Link failed')
      gl.useProgram(this.program)
      for (const name of ['box', 'pose', 'size', 'other_pose', 'other_size', 'crease', 'normal', 'profile', 'span', 'arc', 'layer', 'shadow', 'print', 'face', 'back']) {
        this.uniforms[name] = gl.getUniformLocation(this.program, `u_${name === 'arc' ? 'arc[0]' : name}`)
      }
      // Crease-aligned bands: only material depth bends. Flat and raised planes need one band each.
      const rows = [-1, ...Array.from({ length: BANDS + 1 }, (_, i) => i / BANDS), 2]
      const vertices = new Float32Array(rows.flatMap(s => [0, s, 1, s]))
      const indices = new Uint16Array(this.count)
      for (let y = 0; y < rows.length - 1; y++) {
        const a = y * 2
        indices.set([a, a + 1, a + 2, a + 1, a + 3, a + 2], y * 6)
      }
      const buffer = (target: number, data: Float32Array | Uint16Array) => {
        const result = gl.createBuffer()
        if (!result) throw new Error('No buffer')
        this.buffers.push(result); gl.bindBuffer(target, result); gl.bufferData(target, data, gl.STATIC_DRAW)
      }
      buffer(gl.ARRAY_BUFFER, vertices); buffer(gl.ELEMENT_ARRAY_BUFFER, indices)
      const uv = gl.getAttribLocation(this.program, 'a_uv')
      gl.enableVertexAttribArray(uv); gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 0)
      for (const image of this.images) {
        const texture = gl.createTexture()
        if (!texture) throw new Error('No texture')
        this.textures.push(texture); gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      }
      gl.uniform2fv(this.uniforms.arc, bendTable())
      const { width, height, padding } = POKER_PRINT_GEOMETRY
      gl.uniform4f(this.uniforms.print, (width - padding * 2) / width, (height - padding * 2) / height, padding / width, padding / height)
      gl.uniform1i(this.uniforms.face, 0); gl.uniform1i(this.uniforms.back, 1)
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.textures[2])
      gl.enable(gl.BLEND); gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
      gl.frontFace(gl.CW); gl.depthFunc(gl.LEQUAL); gl.clearColor(0, 0, 0, 0)
      if (this.bounds) this.viewport(this.bounds)
      this.ready = true
    } catch (error) { console.warn('Poker peek renderer unavailable:', error); this.release(); this.unavailable() }
  }

  configure(poses: readonly PeekPose[], bounds: PeekBounds) {
    this.poses = poses.map(p => ({ size: new Float32Array([p.w, p.h]), pose: new Float32Array([p.left + p.w / 2, p.top + p.h / 2, p.cos, p.sin]) }))
    this.corners = poses.flatMap(p => [{ x: 0, y: 0 }, { x: p.w, y: 0 }, { x: p.w, y: p.h }, { x: 0, y: p.h }].map(q => {
      const x = q.x - p.w / 2, y = q.y - p.h / 2
      return { x: p.left + p.w / 2 + x * p.cos - y * p.sin, y: p.top + p.h / 2 + x * p.sin + y * p.cos }
    }))
    this.bounds = bounds
    this.viewport(bounds)
  }

  private viewport(bounds: PeekBounds) {
    const ratio = Math.min(devicePixelRatio || 1, 3, Math.sqrt(MAX_PIXELS / (bounds.w * bounds.h)))
    const width = Math.max(1, Math.floor(bounds.w * ratio)), height = Math.max(1, Math.floor(bounds.h * ratio))
    if (this.canvas.width !== width) this.canvas.width = width
    if (this.canvas.height !== height) this.canvas.height = height
    Object.assign(this.canvas.style, { left: `${bounds.x}px`, top: `${bounds.y}px`, width: `${bounds.w}px`, height: `${bounds.h}px` })
    this.gl.viewport(0, 0, width, height)
  }

  draw(crease: Point, normal: Point, profile: BendProfile) {
    if (!this.ready || !this.bounds || this.poses.length !== 2) return false
    const gl = this.gl, u = this.uniforms, b = this.bounds
    gl.uniform4f(u.box, b.x, b.y, b.w, b.h)
    gl.uniform2f(u.crease, crease.x, crease.y); gl.uniform2f(u.normal, normal.x, normal.y)
    gl.uniform2f(u.profile, profile.depth, profile.length)
    gl.uniform4fv(u.other_pose, this.poses[1].pose); gl.uniform2fv(u.other_size, this.poses[1].size)
    let acrossMin = Infinity, acrossMax = -Infinity, flat = 0
    for (const point of this.corners) {
      const x = point.x - crease.x, y = point.y - crease.y
      const across = -normal.y * x + normal.x * y
      acrossMin = Math.min(acrossMin, across); acrossMax = Math.max(acrossMax, across)
      flat = Math.min(flat, -normal.x * x - normal.y * y)
    }
    // Cover the widest penumbra as well as the print, so softness is never cut by mesh bounds.
    const padding = this.poses[0].size[0] * 0.1 + profile.depth * 0.3
    gl.uniform4f(u.span, acrossMin - padding, acrossMax + padding, flat - padding, profile.depth + padding)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    const pair = () => {
      for (let k = 0; k < 2; k++) {
        gl.uniform2fv(u.size, this.poses[k].size); gl.uniform4fv(u.pose, this.poses[k].pose)
        gl.uniform1f(u.layer, k * 0.45)
        gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.textures[k])
        gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0)
      }
    }
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.uniform1f(u.shadow, 1)
    gl.uniform2fv(u.size, this.poses[0].size); gl.uniform4fv(u.pose, this.poses[0].pose)
    gl.uniform1f(u.layer, 0); gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_SHORT, 0)
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true); gl.uniform1f(u.shadow, 0); pair()
    return true
  }

  private lost = (event: Event) => {
    event.preventDefault()
    this.ready = false
    // Lost-context objects are invalid; restoration builds a fresh, bounded resource set.
    this.program = null; this.shaders = []; this.buffers = []; this.textures = []
    this.unavailable()
  }
  private restored = () => { if (!this.disposed && this.images.length === 3) this.initialize() }

  private release() {
    this.ready = false
    for (const texture of this.textures) this.gl.deleteTexture(texture)
    for (const buffer of this.buffers) this.gl.deleteBuffer(buffer)
    for (const shader of this.shaders) this.gl.deleteShader(shader)
    if (this.program) this.gl.deleteProgram(this.program)
    this.textures = []; this.buffers = []; this.shaders = []; this.program = null
  }

  dispose() {
    this.disposed = true
    this.canvas.removeEventListener('webglcontextlost', this.lost)
    this.canvas.removeEventListener('webglcontextrestored', this.restored)
    this.release(); this.images = []
    // Connected canvases may be reused when artwork/showdown state changes. Keep their context usable.
    if (!this.canvas.isConnected) this.gl.getExtension('WEBGL_lose_context')?.loseContext()
    else { this.canvas.width = 1; this.canvas.height = 1 }
  }
}
