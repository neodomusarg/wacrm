import { describe, expect, it } from 'vitest'
import { messageStatusesBefore } from './message-status'

describe('messageStatusesBefore', () => {
  it('only allows forward moves along the ladder', () => {
    expect(messageStatusesBefore('sent')).toEqual(['sending'])
    expect(messageStatusesBefore('delivered')).toEqual(['sending', 'sent'])
    expect(messageStatusesBefore('read')).toEqual(['sending', 'sent', 'delivered'])
  })

  it('never lets a late delivered overwrite read', () => {
    expect(messageStatusesBefore('delivered')).not.toContain('read')
  })

  it('accepts failed only before delivery', () => {
    expect(messageStatusesBefore('failed')).toEqual(['sending', 'sent'])
  })

  it('writes nothing for unknown or initial statuses', () => {
    expect(messageStatusesBefore('sending')).toEqual([])
    expect(messageStatusesBefore('deleted')).toEqual([])
  })
})
