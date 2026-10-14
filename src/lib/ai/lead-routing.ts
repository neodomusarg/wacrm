import type { supabaseAdmin } from './admin-client'
import {
  businessLineForIntent,
  formatLeadProfile,
  type LeadProfile,
  type Segment,
} from '@/lib/neodomus'

type AdminClient = ReturnType<typeof supabaseAdmin>

const INTENT_TITLE: Record<NonNullable<LeadProfile['intent']>, string> = {
  online: 'Consulta online',
  project: 'Proyecto domótica',
  reseller: 'Partner / revendedor',
}

function segmentForIntent(intent: LeadProfile['intent']): Segment | null {
  if (intent === 'online') return 'Comprador online'
  if (intent === 'reseller') return 'Revendedor / Partner'
  return null // proyecto: el asesor define si es familia, constructora, etc.
}

/**
 * Lleva un lead calificado por la IA al embudo que le corresponde:
 *   intent "online"            → pipeline con business_line 'online'
 *   intent "project"/"reseller" → pipeline con business_line 'projects'
 *
 * Crea un deal en la primera etapa activa SOLO si el contacto no tiene ya
 * un deal abierto en ese pipeline (idempotente: el modelo reporta el
 * mismo intent en cada respuesta). Sin pipelines con línea de negocio
 * (cuenta sin migración 044 o sin embudos duales) no hace nada.
 *
 * Best-effort: nunca lanza. Un fallo acá no debe costar la respuesta al
 * cliente.
 */
export async function routeLeadToPipeline(
  db: AdminClient,
  args: {
    accountId: string
    contactId: string
    /** user_id de auditoría para el INSERT (el dueño del config de WhatsApp). */
    userId: string
    profile: LeadProfile
  },
): Promise<'created' | 'exists' | 'skipped'> {
  const { accountId, contactId, userId, profile } = args
  try {
    const line = businessLineForIntent(profile.intent)
    if (!line || !profile.intent) return 'skipped'

    const { data: pipeline } = await db
      .from('pipelines')
      .select('id')
      .eq('account_id', accountId)
      .eq('business_line', line)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (!pipeline) return 'skipped'

    const { data: openDeals } = await db
      .from('deals')
      .select('id')
      .eq('account_id', accountId)
      .eq('contact_id', contactId)
      .eq('pipeline_id', pipeline.id)
      .eq('status', 'open')
      .limit(1)
    if (openDeals && openDeals.length > 0) return 'exists'

    const { data: stages } = await db
      .from('pipeline_stages')
      .select('id, stage_type, position')
      .eq('pipeline_id', pipeline.id)
      .order('position', { ascending: true })
    const firstStage = (stages ?? []).find(
      (s: { stage_type?: string | null }) => (s.stage_type ?? 'active') === 'active',
    )
    if (!firstStage) return 'skipped'

    const [{ data: account }, { data: contact }] = await Promise.all([
      db.from('accounts').select('default_currency').eq('id', accountId).maybeSingle(),
      db.from('contacts').select('name, phone').eq('id', contactId).maybeSingle(),
    ])

    const who = profile.name || contact?.name || contact?.phone || 'cliente'
    const { error } = await db.from('deals').insert({
      account_id: accountId,
      user_id: userId,
      pipeline_id: pipeline.id,
      stage_id: firstStage.id,
      contact_id: contactId,
      title: `${INTENT_TITLE[profile.intent]} — ${who}`.slice(0, 200),
      value: 0,
      currency: account?.default_currency ?? 'ARS',
      status: 'open',
      segment: segmentForIntent(profile.intent),
      lead_source: 'WhatsApp entrante',
      province: profile.province ?? null,
      city: profile.city ?? null,
      notes: `🤖 Calificado por IA: ${formatLeadProfile(profile)}`,
    })
    if (error) {
      console.error('[ai lead-routing] deal insert failed:', error.message)
      return 'skipped'
    }
    return 'created'
  } catch (err) {
    console.error('[ai lead-routing] failed:', err)
    return 'skipped'
  }
}
