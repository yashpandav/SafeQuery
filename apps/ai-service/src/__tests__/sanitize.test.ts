import { describe, it, expect } from 'vitest'
import { sanitizePrompt } from '../lib/sanitize'

describe('sanitizePrompt', () => {
  it('collapses whitespace and trims', () => {
    expect(sanitizePrompt('  show   me   customers  ')).toBe('show me customers')
  })

  it('strips control characters', () => {
    expect(sanitizePrompt('show\x00me\x07customers')).toBe('showmecustomers')
  })

  it('strips zero-width and bidi-override characters used to hide instructions', () => {
    const withZeroWidth = 'show​me‍customers﻿'
    expect(sanitizePrompt(withZeroWidth)).toBe('showmecustomers')
  })

  it('normalizes unicode compatibility forms (homoglyph defense)', () => {
    expect(sanitizePrompt('ｓhow me')).toBe('show me')
  })

  it('returns empty string for input that is only whitespace/control chars', () => {
    expect(sanitizePrompt('   \x00\x01  ')).toBe('')
  })

  it('preserves ordinary punctuation and case', () => {
    expect(sanitizePrompt("Show me Bob's orders from 2024.")).toBe("Show me Bob's orders from 2024.")
  })
})
