/**
 * NeoDomus — valores de negocio del pipeline de ventas.
 * Deben coincidir 1:1 con los CHECK de la migración 043.
 * Son datos (se guardan en la DB), no textos de UI: no se traducen.
 */
import type { DealStatus, PipelineStage, StageType } from "@/types";

export const NEODOMUS_PIPELINE_NAME = "NeoDomus Ventas";

export const B2B_SEGMENTS = [
  "Constructora",
  "Estudio de arquitectura",
  "Desarrollista",
] as const;

export const B2C_SEGMENTS = [
  "Familia / Hogar",
  "Vivienda en obra / remodelación",
  "Alquiler temporario (Airbnb)",
  "Oficina / Comercio",
] as const;

export const SEGMENTS = [...B2B_SEGMENTS, ...B2C_SEGMENTS] as const;
export type Segment = (typeof SEGMENTS)[number];

export const LEAD_SOURCES = [
  "WhatsApp en frío",
  "Instagram",
  "Referido",
  "Web",
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

export const NEODOMUS_DEFAULT_STAGES: ReadonlyArray<{
  name: string;
  color: string;
  position: number;
  stage_type: StageType;
}> = [
  { name: "Por contactar", color: "#4f46e5", position: 0, stage_type: "active" },
  { name: "Primer mensaje enviado", color: "#0284c7", position: 1, stage_type: "active" },
  { name: "En conversación", color: "#8b5cf6", position: 2, stage_type: "active" },
  { name: "Reunión agendada", color: "#d97706", position: 3, stage_type: "active" },
  { name: "Presupuesto enviado", color: "#d946ef", position: 4, stage_type: "active" },
  { name: "En pausa / Recontactar", color: "#64748b", position: 5, stage_type: "paused" },
  { name: "Ganado", color: "#059669", position: 6, stage_type: "won" },
  { name: "Perdido", color: "#e11d48", position: 7, stage_type: "lost" },
];

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

/** Solo las etapas activas (1–5) suman al valor del pipeline. */
export function countsTowardActiveValue(
  deal: { status?: DealStatus; stage_id: string },
  stageById: Map<string, PipelineStage>,
): boolean {
  return (
    (deal.status ?? "open") === "open" &&
    stageTypeOf(stageById.get(deal.stage_id)) === "active"
  );
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
