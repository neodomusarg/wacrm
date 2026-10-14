import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'follow_up_reminder'
  | NeoDomusTemplateSlug

export type NeoDomusTemplateSlug =
  | 'nd_welcome_router'
  | 'nd_route_online'
  | 'nd_route_project'
  | 'nd_route_professional'
  | 'nd_order_shipped'
  | 'nd_install_scheduled'
  | 'nd_window_nudge'

/** Reply ids of the Neo Domus welcome menu (stable — routing keys). */
export const ND_REPLY_IDS = {
  online: 'nd_online',
  project: 'nd_project',
  professional: 'nd_professional',
} as const

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<
  Exclude<TemplateSlug, NeoDomusTemplateSlug>,
  AutomationTemplateDefinition
> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  follow_up_reminder: {
    slug: 'follow_up_reminder',
    name: 'Follow-up Reminder',
    description: 'Send a nudge if a contact has not replied within 24 hours.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'wait',
        step_config: { amount: 1, unit: 'days' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Just circling back — did you have any other questions for us? Happy to help!",
        },
      },
    ],
  },
}

// ------------------------------------------------------------
// Neo Domus — routing + notification templates.
//
// The pipeline / stage / tag / template fields are left blank on purpose:
// they are per-account ids, chosen in the builder after cloning
// (activation validation refuses to switch one on until they're set).
// ------------------------------------------------------------
export const NEODOMUS_AUTOMATION_TEMPLATES: Record<NeoDomusTemplateSlug, AutomationTemplateDefinition> = {
  nd_welcome_router: {
    slug: 'nd_welcome_router',
    name: 'Neo Domus · Bienvenida y derivación',
    description:
      'Primer mensaje del cliente → menú con 3 opciones: compra online, proyecto/instalación o profesional/revendedor.',
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_buttons',
        step_config: {
          kind: 'buttons',
          header: 'Neo Domus 🏠',
          body:
            '¡Hola! 👋 Gracias por escribirle a Neo Domus. Para ayudarte mejor, contanos qué estás buscando:',
          footer: 'Domótica y tecnología para tu hogar',
          buttons: [
            { id: ND_REPLY_IDS.online, title: 'Comprar online' },
            { id: ND_REPLY_IDS.project, title: 'Proyecto/instalación' },
            { id: ND_REPLY_IDS.professional, title: 'Soy profesional' },
          ],
        },
      },
    ],
  },
  nd_route_online: {
    slug: 'nd_route_online',
    name: 'Neo Domus · Ruta compra online',
    description:
      'Tocó "Comprar online": envía el catálogo, crea el deal en Ventas Online y etiqueta el contacto.',
    trigger_type: 'interactive_reply',
    trigger_config: { reply_ids: [ND_REPLY_IDS.online] },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            '¡Genial! 🛒 Podés ver todo el catálogo y comprar con envío a todo el país acá: https://TU-TIENDA.mitiendanube.com\n\n¿Qué producto te interesa o qué querés automatizar? Te ayudo a elegir el que sea compatible con tu instalación.',
        },
      },
      {
        step_type: 'create_deal',
        step_config: { pipeline_id: '', stage_id: '', title: 'Consulta online — {{contact.name}}', value: 0 },
      },
      { step_type: 'add_tag', step_config: { tag_id: '' } },
    ],
  },
  nd_route_project: {
    slug: 'nd_route_project',
    name: 'Neo Domus · Ruta proyecto / instalación',
    description:
      'Tocó "Proyecto/instalación": pide los datos clave, crea el deal en Proyectos B2B y asigna un asesor.',
    trigger_type: 'interactive_reply',
    trigger_config: { reply_ids: [ND_REPLY_IDS.project] },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            '¡Excelente! 🏠 Para armarte una propuesta contanos:\n1️⃣ ¿En qué ciudad/barrio está la propiedad?\n2️⃣ ¿Es casa, depto u oficina? ¿Obra nueva, en construcción o ya terminada?\n3️⃣ ¿Qué te gustaría automatizar? (luces, persianas, cerraduras, cámaras, climatización…)\n\nSi tenés planos, podés mandarlos por acá 📐',
        },
      },
      {
        step_type: 'create_deal',
        step_config: { pipeline_id: '', stage_id: '', title: 'Proyecto — {{contact.name}}', value: 0 },
      },
      { step_type: 'add_tag', step_config: { tag_id: '' } },
      { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    ],
  },
  nd_route_professional: {
    slug: 'nd_route_professional',
    name: 'Neo Domus · Ruta profesional / revendedor',
    description:
      'Tocó "Soy profesional": pide rubro y zona, crea el deal en Proyectos B2B y asigna un asesor.',
    trigger_type: 'interactive_reply',
    trigger_config: { reply_ids: [ND_REPLY_IDS.professional] },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            '¡Bienvenido! 🤝 Trabajamos con arquitectos, constructoras, desarrollistas e instaladores. Contanos:\n• Tu rubro y empresa/estudio\n• En qué zona trabajás\n• Si tenés un proyecto en curso o querés sumarte a la red de partners\n\nUn asesor te contacta a la brevedad.',
        },
      },
      {
        step_type: 'create_deal',
        step_config: { pipeline_id: '', stage_id: '', title: 'Partner — {{contact.name}}', value: 0 },
      },
      { step_type: 'add_tag', step_config: { tag_id: '' } },
      { step_type: 'assign_conversation', step_config: { mode: 'round_robin' } },
    ],
  },
  nd_order_shipped: {
    slug: 'nd_order_shipped',
    name: 'Neo Domus · Pedido despachado',
    description:
      'El deal entra en "Despachado" → plantilla de Meta (categoría Utilidad) con transportista y código de seguimiento.',
    trigger_type: 'deal_stage_changed',
    trigger_config: { pipeline_id: '', stage_ids: [] },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: '',
          language: 'es_AR',
          variables: {
            '1': '{{contact.first_name}}',
            '2': '{{deal.order_ref}}',
            '3': '{{deal.shipping_carrier}}',
            '4': '{{deal.tracking_code}}',
          },
        },
      },
    ],
  },
  nd_install_scheduled: {
    slug: 'nd_install_scheduled',
    name: 'Neo Domus · Instalación agendada',
    description:
      'El deal entra en "Obra / Instalación agendada" → plantilla de confirmación con la fecha, y recordatorio interno.',
    trigger_type: 'deal_stage_changed',
    trigger_config: { pipeline_id: '', stage_ids: [] },
    steps: [
      {
        step_type: 'send_template',
        step_config: {
          template_name: '',
          language: 'es_AR',
          variables: {
            '1': '{{contact.first_name}}',
            '2': '{{deal.installation_date}}',
          },
        },
      },
    ],
  },
  nd_window_nudge: {
    slug: 'nd_window_nudge',
    name: 'Neo Domus · Reactivación antes de 24 h',
    description:
      'Si el cliente nos dejó en visto, 2 h antes de que cierre la ventana de 24 h se le envía un recordatorio (en horario comercial).',
    trigger_type: 'conversation_window_expiring',
    trigger_config: { minutes_before: 120, only_if_awaiting_customer: true },
    steps: [
      {
        step_type: 'condition',
        step_config: { subject: 'time_of_day', operand: '09:00-21:00' },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            '¡Hola {{contact.first_name}}! 👋 ¿Pudiste ver lo que te pasamos? Si te quedó alguna duda sobre compatibilidad, instalación o envío, escribinos y lo resolvemos.',
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
}

export const NEODOMUS_TEMPLATE_ORDER: NeoDomusTemplateSlug[] = [
  'nd_welcome_router',
  'nd_route_online',
  'nd_route_project',
  'nd_route_professional',
  'nd_order_shipped',
  'nd_install_scheduled',
  'nd_window_nudge',
]

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return (
    AUTOMATION_TEMPLATES[slug as Exclude<TemplateSlug, NeoDomusTemplateSlug>] ??
    NEODOMUS_AUTOMATION_TEMPLATES[slug as NeoDomusTemplateSlug] ??
    null
  )
}
