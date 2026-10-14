/**
 * NeoDomus — valores de negocio de los pipelines de ventas.
 * Deben coincidir 1:1 con los CHECK de las migraciones 043 y 044.
 * Son datos (se guardan en la DB), no textos de UI: no se traducen.
 */
import type { DealStatus, PipelineStage, StageType } from "@/types";

export const NEODOMUS_PIPELINE_NAME = "NeoDomus Ventas";

export const B2B_SEGMENTS = [
  "Constructora",
  "Estudio de arquitectura",
  "Desarrollista",
  "Instalador / Electricista",
  "Revendedor / Partner",
] as const;

export const B2C_SEGMENTS = [
  "Familia / Hogar",
  "Vivienda en obra / remodelación",
  "Alquiler temporario (Airbnb)",
  "Oficina / Comercio",
  "Comprador online",
] as const;

export const SEGMENTS = [...B2B_SEGMENTS, ...B2C_SEGMENTS] as const;
export type Segment = (typeof SEGMENTS)[number];

export const LEAD_SOURCES = [
  "WhatsApp en frío",
  "WhatsApp entrante",
  "Instagram",
  "Referido",
  "Web",
  "Tienda Nube",
  "MercadoLibre",
  "Google Maps",
  "Visita a obra",
  "Cliente anterior",
  "Otro",
] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const LOST_REASONS = [
  "Precio",
  "Timing de obra",
  "No le interesa",
  "Eligió competencia",
  "No responde",
  "Sin stock",
  "Costo / plazo de envío",
  "Pago no concretado",
  "Incompatibilidad técnica",
  "Fuera de zona",
  "Otro",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export const BUILD_STAGES = [
  "En plano",
  "Estructura",
  "Obra gruesa / instalaciones",
  "Terminaciones",
  "Terminada",
] as const;
export type BuildStage = (typeof BUILD_STAGES)[number];

/** Provincias argentinas (+ CABA), para normalizar la ubicación. */
export const AR_PROVINCES = [
  "Córdoba",
  "Buenos Aires",
  "CABA",
  "Santa Fe",
  "Mendoza",
  "Tucumán",
  "Entre Ríos",
  "Salta",
  "Misiones",
  "Chaco",
  "Corrientes",
  "Santiago del Estero",
  "San Juan",
  "Jujuy",
  "Río Negro",
  "Neuquén",
  "Formosa",
  "Chubut",
  "San Luis",
  "Catamarca",
  "La Rioja",
  "La Pampa",
  "Santa Cruz",
  "Tierra del Fuego",
] as const;

export const SHIPPING_CARRIERS = [
  "Correo Argentino",
  "Andreani",
  "OCA",
  "Mercado Envíos",
  "Moto / cadete (Córdoba)",
  "Retiro en local",
  "Otro",
] as const;

// ------------------------------------------------------------
// Líneas de negocio y plantillas de embudo (migración 044)
// ------------------------------------------------------------

export const BUSINESS_LINES = ["general", "online", "projects"] as const;
export type BusinessLine = (typeof BUSINESS_LINES)[number];

export interface StageBlueprint {
  name: string;
  color: string;
  position: number;
  stage_type: StageType;
  /** Slug estable: las automatizaciones y la IA lo usan en vez del nombre. */
  stage_key?: string;
}

export interface PipelineBlueprint {
  business_line: BusinessLine;
  name: string;
  stages: ReadonlyArray<StageBlueprint>;
}

/** Embudo heredado (043). Se mantiene para la línea "general". */
export const NEODOMUS_DEFAULT_STAGES: ReadonlyArray<StageBlueprint> = [
  { name: "Por contactar", color: "#4f46e5", position: 0, stage_type: "active" },
  { name: "Primer mensaje enviado", color: "#0284c7", position: 1, stage_type: "active" },
  { name: "En conversación", color: "#8b5cf6", position: 2, stage_type: "active" },
  { name: "Reunión agendada", color: "#d97706", position: 3, stage_type: "active" },
  { name: "Presupuesto enviado", color: "#d946ef", position: 4, stage_type: "active" },
  { name: "En pausa / Recontactar", color: "#64748b", position: 5, stage_type: "paused" },
  { name: "Ganado", color: "#059669", position: 6, stage_type: "won" },
  { name: "Perdido", color: "#e11d48", position: 7, stage_type: "lost" },
];

/**
 * Embudo 1 — Ventas Online (B2C, todo el país). Ciclo corto, orientado a
 * conversión. El pedido se considera ganado cuando el pago está
 * confirmado; las etapas posteriores siguen siendo "won" y sirven para el
 * seguimiento logístico y las notificaciones automáticas al cliente.
 */
export const ONLINE_PIPELINE: PipelineBlueprint = {
  business_line: "online",
  name: "Ventas Online (B2C)",
  stages: [
    { name: "Consulta entrante", color: "#6366f1", position: 0, stage_type: "active", stage_key: "online_inquiry" },
    { name: "Carrito / Cotización enviada", color: "#0ea5e9", position: 1, stage_type: "active", stage_key: "online_quote_sent" },
    { name: "Pago pendiente", color: "#f59e0b", position: 2, stage_type: "active", stage_key: "online_payment_pending" },
    { name: "En pausa / Recontactar", color: "#64748b", position: 3, stage_type: "paused", stage_key: "online_paused" },
    { name: "Compra confirmada / En preparación", color: "#10b981", position: 4, stage_type: "won", stage_key: "online_confirmed" },
    { name: "Despachado", color: "#14b8a6", position: 5, stage_type: "won", stage_key: "online_shipped" },
    { name: "Entregado / Postventa", color: "#059669", position: 6, stage_type: "won", stage_key: "online_delivered" },
    { name: "Perdido", color: "#e11d48", position: 7, stage_type: "lost", stage_key: "online_lost" },
  ],
};

/**
 * Embudo 2 — Proyectos e Instalaciones (B2B / Córdoba). Venta consultiva
 * de ciclo largo. Ganado = obra cobrada; "Fidelización / Red" sigue
 * siendo ganado y agrupa a clientes que ya instalaron y a partners
 * activos (fuente de referidos y reventa).
 */
export const PROJECTS_PIPELINE: PipelineBlueprint = {
  business_line: "projects",
  name: "Proyectos e Instalaciones (B2B Córdoba)",
  stages: [
    { name: "Lead nuevo", color: "#4f46e5", position: 0, stage_type: "active", stage_key: "proj_new_lead" },
    { name: "Relevamiento técnico / Planos", color: "#0284c7", position: 1, stage_type: "active", stage_key: "proj_survey" },
    { name: "Propuesta técnica enviada", color: "#d946ef", position: 2, stage_type: "active", stage_key: "proj_proposal_sent" },
    { name: "Negociación / Ajuste", color: "#d97706", position: 3, stage_type: "active", stage_key: "proj_negotiation" },
    { name: "En pausa / Recontactar", color: "#64748b", position: 4, stage_type: "paused", stage_key: "proj_paused" },
    { name: "Obra / Instalación agendada", color: "#8b5cf6", position: 5, stage_type: "active", stage_key: "proj_install_scheduled" },
    { name: "Instalación finalizada / Cobrado", color: "#059669", position: 6, stage_type: "won", stage_key: "proj_installed_paid" },
    { name: "Fidelización / Red de revendedores", color: "#0d9488", position: 7, stage_type: "won", stage_key: "proj_loyalty" },
    { name: "Perdido", color: "#e11d48", position: 8, stage_type: "lost", stage_key: "proj_lost" },
  ],
};

export const GENERAL_PIPELINE: PipelineBlueprint = {
  business_line: "general",
  name: NEODOMUS_PIPELINE_NAME,
  stages: NEODOMUS_DEFAULT_STAGES,
};

export const PIPELINE_BLUEPRINTS: Record<BusinessLine, PipelineBlueprint> = {
  general: GENERAL_PIPELINE,
  online: ONLINE_PIPELINE,
  projects: PROJECTS_PIPELINE,
};

export function businessLineOf(pipeline?: { business_line?: string | null } | null): BusinessLine {
  const line = pipeline?.business_line;
  return line === "online" || line === "projects" ? line : "general";
}

/** Payload de inserción de etapas para un pipeline recién creado. */
export function stageRowsFor(pipelineId: string, line: BusinessLine) {
  return PIPELINE_BLUEPRINTS[line].stages.map((s) => ({
    pipeline_id: pipelineId,
    name: s.name,
    color: s.color,
    position: s.position,
    stage_type: s.stage_type,
    stage_key: s.stage_key ?? null,
  }));
}

/** Segmento por defecto al crear un deal en cada embudo. */
export function defaultSegmentFor(line: BusinessLine): Segment | "" {
  return line === "online" ? "Comprador online" : "";
}

export function isB2B(segment?: string | null): boolean {
  return !!segment && (B2B_SEGMENTS as readonly string[]).includes(segment);
}

/** Etapas anteriores a 043 (o sin cargar) se consideran activas. */
export function stageTypeOf(stage?: Pick<PipelineStage, "stage_type"> | null): StageType {
  return stage?.stage_type ?? "active";
}

/** Espejo en cliente del trigger sync_deal_status_from_stage (migración 043). */
export function statusForStageType(type: StageType): DealStatus {
  if (type === "won") return "won";
  if (type === "lost") return "lost";
  return "open";
}

/** Solo las etapas activas suman al valor del pipeline. */
export function countsTowardActiveValue(
  deal: { status?: DealStatus; stage_id: string },
  stageById: Map<string, PipelineStage>,
): boolean {
  return (
    (deal.status ?? "open") === "open" &&
    stageTypeOf(stageById.get(deal.stage_id)) === "active"
  );
}

/**
 * Fecha a usar para "ganados / perdidos este mes". closed_at (044) es la
 * correcta; updated_at queda como respaldo para deals anteriores a 044.
 */
export function closedAtOf(deal: {
  closed_at?: string | null;
  updated_at?: string | null;
  created_at?: string | null;
}): string | null {
  return deal.closed_at ?? deal.updated_at ?? deal.created_at ?? null;
}

/** "vencido" | "hoy" | "próximo" | null para la fecha de recontacto (YYYY-MM-DD). */
export function recontactStatus(
  date?: string | null,
  today: Date = new Date(),
): "overdue" | "today" | "upcoming" | null {
  if (!date) return null;
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  const t = `${year}-${month}-${day}`;
  if (date < t) return "overdue";
  if (date === t) return "today";
  return "upcoming";
}

// ------------------------------------------------------------
// Perfil de lead que extrae el agente de IA (conversations.ai_lead_profile)
// ------------------------------------------------------------

/** Lo que el cliente quiere: comprar online, un proyecto con
 *  instalación, o sumarse como profesional / revendedor. */
export const LEAD_INTENTS = ["online", "project", "reseller"] as const;
export type LeadIntent = (typeof LEAD_INTENTS)[number];

export interface LeadProfile {
  intent?: LeadIntent;
  name?: string;
  city?: string;
  province?: string;
  /** Casa, depto, oficina, obra nueva, Airbnb… (texto libre). */
  property_type?: string;
  /** Obra nueva / remodelación / ya construida. */
  project_stage?: string;
  /** Productos o soluciones de interés. */
  products?: string[];
  /** Ecosistema actual o preferido (Zigbee, WiFi, Matter, Alexa, Google…). */
  ecosystem?: string;
  /** Si la instalación eléctrica tiene neutro en las cajas de llave. */
  has_neutral?: "si" | "no" | "no_sabe";
  /** Rubro si es profesional (arquitecto, constructora, electricista…). */
  company_or_trade?: string;
  budget?: string;
  timeline?: string;
  notes?: string;
}

const LEAD_STRING_FIELDS = [
  "name",
  "city",
  "province",
  "property_type",
  "project_stage",
  "ecosystem",
  "company_or_trade",
  "budget",
  "timeline",
  "notes",
] as const;

const MAX_LEAD_FIELD_LEN = 200;

/**
 * Valida y normaliza lo que devuelve el modelo. Todo lo que no sea un
 * campo conocido con el tipo correcto se descarta: el JSON viene de un
 * LLM que lee mensajes de clientes, así que se trata como no confiable.
 */
export function sanitizeLeadProfile(raw: unknown): LeadProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  const out: LeadProfile = {};

  if (typeof src.intent === "string" && (LEAD_INTENTS as readonly string[]).includes(src.intent)) {
    out.intent = src.intent as LeadIntent;
  }
  for (const key of LEAD_STRING_FIELDS) {
    const v = src[key];
    if (typeof v === "string" && v.trim()) {
      out[key] = v.trim().slice(0, MAX_LEAD_FIELD_LEN);
    }
  }
  if (src.has_neutral === "si" || src.has_neutral === "no" || src.has_neutral === "no_sabe") {
    out.has_neutral = src.has_neutral;
  }
  if (Array.isArray(src.products)) {
    const products = src.products
      .filter((p): p is string => typeof p === "string" && p.trim() !== "")
      .map((p) => p.trim().slice(0, 80))
      .slice(0, 15);
    if (products.length > 0) out.products = products;
  }

  return Object.keys(out).length > 0 ? out : null;
}

/** Merge acumulativo: un dato nuevo pisa al anterior, nunca lo borra. */
export function mergeLeadProfile(
  prev: LeadProfile | null | undefined,
  next: LeadProfile | null | undefined,
): LeadProfile | null {
  if (!next) return prev ?? null;
  if (!prev) return next;
  const products = Array.from(new Set([...(prev.products ?? []), ...(next.products ?? [])])).slice(0, 15);
  const merged: LeadProfile = { ...prev, ...next };
  if (products.length > 0) merged.products = products;
  return merged;
}

/** Embudo que corresponde a cada intención del cliente. */
export function businessLineForIntent(intent?: LeadIntent): BusinessLine | null {
  if (intent === "online") return "online";
  if (intent === "project" || intent === "reseller") return "projects";
  return null;
}

/** Resumen de una línea para la nota interna de traspaso a un humano. */
export function formatLeadProfile(profile: LeadProfile | null | undefined): string {
  if (!profile) return "";
  const intentLabel: Record<LeadIntent, string> = {
    online: "Compra online",
    project: "Proyecto / instalación",
    reseller: "Profesional / revendedor",
  };
  const parts: string[] = [];
  if (profile.intent) parts.push(intentLabel[profile.intent]);
  const where = [profile.city, profile.province].filter(Boolean).join(", ");
  if (where) parts.push(`📍 ${where}`);
  if (profile.property_type) parts.push(profile.property_type);
  if (profile.project_stage) parts.push(profile.project_stage);
  if (profile.company_or_trade) parts.push(profile.company_or_trade);
  if (profile.products?.length) parts.push(`Interés: ${profile.products.join(", ")}`);
  if (profile.ecosystem) parts.push(`Ecosistema: ${profile.ecosystem}`);
  if (profile.has_neutral) {
    parts.push(`Neutro: ${profile.has_neutral === "no_sabe" ? "no sabe" : profile.has_neutral}`);
  }
  if (profile.budget) parts.push(`Presupuesto: ${profile.budget}`);
  if (profile.timeline) parts.push(`Plazo: ${profile.timeline}`);
  return parts.join(" · ");
}
