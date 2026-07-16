// 8 pastel Post-It note colors, auto-assigned to tasks in rotation.
export const POSTIT_COLORS = [
  '#FFF6A5', // classic yellow
  '#FFD9A8', // peach
  '#FFB9C2', // rose
  '#F6C6EA', // pink
  '#DCC9F7', // lavender
  '#BDE0FE', // sky blue
  '#B7F0DA', // mint
  '#D5EFA9', // green
] as const;

export function postItColor(index: number): string {
  return POSTIT_COLORS[((index % POSTIT_COLORS.length) + POSTIT_COLORS.length) % POSTIT_COLORS.length];
}
