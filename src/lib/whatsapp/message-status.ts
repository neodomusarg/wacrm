// messages.status ladder (CHECK in migration 001). `sending` is our own
// pre-ack state; Meta never sends it.
const MESSAGE_STATUS_LADDER = ['sending', 'sent', 'delivered', 'read'] as const

/**
 * The `messages.status` values from which a move to `incoming` is a
 * forward transition — i.e. the WHERE filter for the webhook's
 * conditional status update. Meta delivers statuses out of order (`read`
 * often lands before `delivered`) and replays them on retry, so the write
 * must never move a message backwards.
 *
 *   - Along the ladder, only forward moves.
 *   - `failed` only from `sending` / `sent` — once delivered or read, a
 *     late failure is ignored.
 *   - Unknown statuses → empty list → the caller skips the write.
 */
export function messageStatusesBefore(incoming: string): string[] {
  if (incoming === 'failed') return ['sending', 'sent']
  const idx = (MESSAGE_STATUS_LADDER as readonly string[]).indexOf(incoming)
  if (idx <= 0) return []
  return MESSAGE_STATUS_LADDER.slice(0, idx)
}
