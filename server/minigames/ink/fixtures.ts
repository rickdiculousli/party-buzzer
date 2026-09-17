import type { InkCards } from './cards.ts'

export const CARDS: InkCards = {
  prompts: Array.from({ length: 20 }, (_, i) => `Prompt ${i}`),
  words: [['Apple', 'Calendar', 'Snowman', 'Chili', 'Fox', 'Table']],
}
