import type { Vec2 } from '../bow/types.ts'
import { mulberry32 } from '../bow/world.ts'
import { CELL, COLS, ROWS } from './types.ts'

/** Point-symmetric pairs around the field center. */
export const SPAWNS: Vec2[] = [
  { x: 100, y: 100 }, { x: 1500, y: 800 },
  { x: 1500, y: 100 }, { x: 100, y: 800 },
  { x: 800, y: 100 }, { x: 800, y: 800 },
  { x: 100, y: 450 }, { x: 1500, y: 450 },
]

const SPAWN_CLEARANCE = 90

export function createCover(seed: number, spawns: Vec2[]): Uint8Array {
  const random = mulberry32(seed)
  const cover = new Uint8Array(COLS * ROWS)
  for (let cluster = 0; cluster < 7; cluster++) {
    const width = 4 + Math.floor(random() * 9)
    const height = 3 + Math.floor(random() * 8)
    const col = Math.floor(random() * (COLS - width))
    const row = Math.floor(random() * (ROWS - height))
    for (let r = row; r < row + height; r++) {
      for (let c = col; c < col + width; c++) {
        cover[r * COLS + c] = 1
        cover[(ROWS - 1 - r) * COLS + (COLS - 1 - c)] = 1
      }
    }
  }
  for (let i = 0; i < cover.length; i++) {
    const x = (i % COLS + 0.5) * CELL
    const y = (Math.floor(i / COLS) + 0.5) * CELL
    if (spawns.some((spawn) => Math.hypot(spawn.x - x, spawn.y - y) < SPAWN_CLEARANCE)) cover[i] = 0
  }
  return cover
}

/** Indices of in-field cells whose rectangle the circle reaches. */
function cellsTouching(center: Vec2, radius: number): number[] {
  const cells: number[] = []
  const c0 = Math.max(0, Math.floor((center.x - radius) / CELL))
  const c1 = Math.min(COLS - 1, Math.floor((center.x + radius) / CELL))
  const r0 = Math.max(0, Math.floor((center.y - radius) / CELL))
  const r1 = Math.min(ROWS - 1, Math.floor((center.y + radius) / CELL))
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const nx = Math.max(c * CELL, Math.min(center.x, (c + 1) * CELL))
      const ny = Math.max(r * CELL, Math.min(center.y, (r + 1) * CELL))
      if (Math.hypot(center.x - nx, center.y - ny) < radius) cells.push(r * COLS + c)
    }
  }
  return cells
}

export function circleHitsCover(cover: Uint8Array, center: Vec2, radius: number): boolean {
  return cellsTouching(center, radius).some((index) => cover[index] === 1)
}

export function carve(cover: Uint8Array, center: Vec2, radius: number): number[] {
  const cleared = cellsTouching(center, radius).filter((index) => cover[index] === 1)
  for (const index of cleared) cover[index] = 0
  return cleared
}

export const encodeCover = (cover: Uint8Array): string => cover.join('')
