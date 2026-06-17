// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x1F\x7F-\x9F]/g
const INVISIBLE_CODE_POINTS = [
  0x200b, 0x200c, 0x200d, 0x200e, 0x200f,
  0x202a, 0x202b, 0x202c, 0x202d, 0x202e,
  0x2060, 0xfeff,
]
const INVISIBLE_CHARS = new RegExp(`[${INVISIBLE_CODE_POINTS.map((c) => String.fromCharCode(c)).join('')}]`, 'g')

export function sanitizePrompt(raw: string): string {
  return raw
    .normalize('NFKC') // collapse homoglyph/compatibility unicode tricks
    .replace(CONTROL_CHARS, '')
    .replace(INVISIBLE_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim()
}
