import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('desktop-only responsive contract', () => {
  const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8')

  it('hides the complete interactive workbench and shows the notice at 800px', () => {
    expect(css).toMatch(/@media\s*\(max-width:\s*1023px\)/)
    expect(css).toMatch(/\.ontology-interaction-canvas,[\s\S]*display:\s*none\s*!important/)
    expect(css).toMatch(/\.mobile-viewport-notice\s*{[\s\S]*display:\s*flex/)
  })

  it('leaves 1024px outside the narrow-screen breakpoint', () => {
    expect(css).not.toMatch(/@media\s*\(max-width:\s*1024px\)/)
    expect(css).not.toMatch(/@media\s*\(min-width:\s*1025px\)/)
  })
})
