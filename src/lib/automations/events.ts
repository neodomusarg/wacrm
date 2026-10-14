import type { AutomationTriggerType, WindowExpiringTriggerConfig } from '@/types'
import { supabaseAdmin } from './admin-client'
import {
  runAutomationsForTrigger,
  windowMinutesOf,
  type AutomationContext,
} from './engine'

// ------------------------------------------------------------
// Database-originated automation triggers (migration 044).
//
// Deal moves and conversation assignments mostly happen in the browser,
// straight against Supabase — there is no server request to hook a
// dispatch into. Postgres triggers write them to `automation_event_queue`
// instead (an outbox: the event exists iff the change committed), and
// the automations cron drains it here. The same cron scans for 24 h
// windows about to close.
// ------------------------------------------------------------

interface QueuedEvent {
  id: string
  account_id: string
  trigger_type: string
  contact_id: string | null
  payload: Record<string, unknown> | null
  attempts: number
}

const MAX_ATTEMPTS = 3

/**
 * Claim and dispatch due events. Claiming goes through
 * `claim_automation_events` (FOR UPDATE SKIP LOCKED), so overlapping cron
 * runs never process the same row twice.
 */
export async function drainAutomationEvents(limit = 50): Promise<{
  processed: number
  failed: number
}> {
  const db = supabaseAdmin()
  const { data, error } = await db.rpc('claim_automation_events', { p_limit: limit })
  if (error) {
    console.error('[automation-events] claim failed:', error)
    return { processed: 0, failed: 0 }
  }

  let processed = 0
  let failed = 0
  for (const event of (data ?? []) as QueuedEvent[]) {
    try {
      const context = await buildEventContext(event)
      if (!context) {
        await finishEvent(event.id, 'skipped', 'referenced row no longer exists')
        continue
      }
      await runAutomationsForTrigger({
        accountId: event.account_id,
        triggerType: event.trigger_type as AutomationTriggerType,
        contactId: event.contact_id,
        context,
      })
      await finishEvent(event.id, 'done', null)
      processed++
    } catch (err) {
      // runAutomationsForTrigger never throws, so this is the context
      // build (a DB hiccup). Retry a couple of times, then give up loudly.
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[automation-events] event failed:', event.id, msg)
      if (event.attempts < MAX_ATTEMPTS) {
        await db
          .from('automation_event_queue')
          .update({
            status: 'pending',
            last_error: msg,
            run_at: new Date(Date.now() + 5 * 60_000).toISOString(),
          })
          .eq('id', event.id)
      } else {
        await finishEvent(event.id, 'failed', msg)
      }
      failed++
    }
  }
  return { processed, failed }
}

async function finishEvent(
  id: string,
  status: 'done' | 'failed' | 'skipped',
  lastError: string | null,
) {
  const { error } = await supabaseAdmin()
    .from('automation_event_queue')
    .update({ status, last_error: lastError })
    .eq('id', id)
  if (error) console.error('[automation-events] finish failed:', id, error)
}

/**
 * Turn a queued payload into the engine context, including the
 * `{{deal.*}}` / `{{stage.*}}` / `{{pipeline.*}}` placeholder values so a
 * "pedido despachado" template can carry the tracking code. Returns null
 * when the deal was deleted before the cron got to it.
 */
async function buildEventContext(event: QueuedEvent): Promise<AutomationContext | null> {
  const payload = event.payload ?? {}

  if (event.trigger_type === 'deal_stage_changed') {
    const dealId = String(payload.deal_id ?? '')
    const { data: deal, error } = await supabaseAdmin()
      .from('deals')
      .select(
        'id, title, value, currency, order_ref, tracking_code, shipping_carrier, city, province, installation_date, pipeline_id, stage_id, pipeline:pipelines(name, business_line), stage:pipeline_stages(name, stage_key, stage_type)',
      )
      .eq('id', dealId)
      .eq('account_id', event.account_id)
      .maybeSingle()
    if (error) throw new Error(`deal lookup failed: ${error.message}`)
    if (!deal) return null

    const pipeline = one(deal.pipeline) as { name?: string; business_line?: string } | null
    const stage = one(deal.stage) as { name?: string; stage_key?: string; stage_type?: string } | null
    return {
      deal_id: deal.id,
      pipeline_id: String(payload.pipeline_id ?? deal.pipeline_id),
      from_stage_id: (payload.from_stage_id as string | null) ?? null,
      to_stage_id: String(payload.to_stage_id ?? deal.stage_id),
      data: {
        deal: {
          title: deal.title ?? null,
          value: deal.value ?? null,
          currency: deal.currency ?? null,
          order_ref: deal.order_ref ?? null,
          tracking_code: deal.tracking_code ?? null,
          shipping_carrier: deal.shipping_carrier ?? null,
          city: deal.city ?? null,
          province: deal.province ?? null,
          installation_date: formatDate(deal.installation_date),
        },
        stage: {
          name: stage?.name ?? null,
          key: stage?.stage_key ?? null,
          type: stage?.stage_type ?? null,
        },
        pipeline: {
          name: pipeline?.name ?? null,
          business_line: pipeline?.business_line ?? null,
        },
      },
    }
  }

  if (event.trigger_type === 'conversation_assigned') {
    const conversationId = String(payload.conversation_id ?? '')
    const agentId = String(payload.agent_id ?? '')
    const { data: agent } = await supabaseAdmin()
      .from('profiles')
      .select('full_name')
      .eq('user_id', agentId)
      .maybeSingle()
    return {
      conversation_id: conversationId || undefined,
      agent_id: agentId || undefined,
      data: { agent: { name: agent?.full_name ?? null } },
    }
  }

  // Unknown trigger type in the queue (a newer migration than this code):
  // pass the payload through untouched.
  return payload as AutomationContext
}

/** PostgREST returns a to-one embed as an object, older versions as [obj]. */
function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null
  return v ?? null
}

/** YYYY-MM-DD → DD/MM/YYYY for customer-facing messages. */
function formatDate(d: string | null | undefined): string | null {
  if (!d) return null
  const [y, m, day] = d.split('-')
  return y && m && day ? `${day}/${m}/${y}` : d
}

/**
 * For every account with an active `conversation_window_expiring`
 * automation, claim the conversations whose window closes within that
 * automation's `minutes_before`, and dispatch. The claim marks
 * `window_nudge_for` atomically, so each inbound cycle is nudged at most
 * once even with overlapping cron runs.
 */
export async function scanExpiringWindows(): Promise<number> {
  const db = supabaseAdmin()
  const { data: automations, error } = await db
    .from('automations')
    .select('account_id, trigger_config')
    .eq('trigger_type', 'conversation_window_expiring')
    .eq('is_active', true)
  if (error) {
    console.error('[window-expiring] automations fetch failed:', error)
    return 0
  }

  // One scan per (account, minutes_before) bucket.
  const buckets = new Map<string, { accountId: string; minutes: number; awaiting: boolean }>()
  for (const a of (automations ?? []) as {
    account_id: string
    trigger_config: Partial<WindowExpiringTriggerConfig> | null
  }[]) {
    const minutes = windowMinutesOf(a.trigger_config)
    const key = `${a.account_id}:${minutes}`
    const awaiting = a.trigger_config?.only_if_awaiting_customer !== false
    const prev = buckets.get(key)
    buckets.set(key, {
      accountId: a.account_id,
      minutes,
      awaiting: prev ? prev.awaiting || awaiting : awaiting,
    })
  }

  let fired = 0
  for (const { accountId, minutes, awaiting } of buckets.values()) {
    const { data: rows, error: claimErr } = await db.rpc('claim_expiring_conversations', {
      p_account_id: accountId,
      p_minutes_before: minutes,
      p_only_awaiting_customer: awaiting,
      p_limit: 50,
    })
    if (claimErr) {
      console.error('[window-expiring] claim failed:', accountId, claimErr)
      continue
    }
    for (const row of (rows ?? []) as { conversation_id: string; contact_id: string }[]) {
      await runAutomationsForTrigger({
        accountId,
        triggerType: 'conversation_window_expiring',
        contactId: row.contact_id,
        context: { conversation_id: row.conversation_id, minutes_before: minutes },
      })
      fired++
    }
  }
  return fired
}
