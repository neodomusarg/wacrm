"use client";

import type { Deal, PipelineStage } from "@/types";
import { Calendar, Check, X } from "lucide-react";
import { formatCurrency } from "@/lib/currency";
import { isB2B, recontactStatus } from "@/lib/neodomus";
import { useTranslations } from "next-intl";

interface DealCardProps {
  deal: Deal;
  stage: PipelineStage | null;
  onEdit: (deal: Deal) => void;
  isOverlay?: boolean;
}

function formatDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = y && m && d ? new Date(y, m - 1, d) : new Date(dateStr);
  return date.toLocaleDateString("es-AR", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function initials(name?: string, fallback?: string) {
  const source = (name || fallback || "?").trim();
  if (!source) return "?";
  return source.charAt(0).toUpperCase();
}

export function DealCard({ deal, stage, onEdit, isOverlay }: DealCardProps) {
  const t = useTranslations("Pipelines.card");
  const contactLabel = deal.contact?.name || deal.contact?.phone || t("noContact");
  const assigneeLabel = deal.assignee?.full_name || null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // `onClick` still fires after a non-drag tap because the PointerSensor
        // requires 5px movement before it counts as a drag.
        if (isOverlay) return;
        e.stopPropagation();
        onEdit(deal);
      }}
      className={`group relative w-full cursor-pointer rounded-xl border border-border/50 bg-muted/70 pl-4 pr-3 py-3 text-left shadow-sm transition-all ${
        isOverlay
          ? "shadow-xl"
          : "hover:-translate-y-0.5 hover:border-border hover:bg-muted hover:shadow-lg"
      }`}
    >
      {/* 4px left accent bar using stage color */}
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ backgroundColor: stage?.color ?? "#94a3b8" }}
      />

      <div className="flex items-start justify-between gap-2">
        <h4 className="flex-1 text-sm font-semibold leading-snug text-foreground break-words">
          {deal.title}
        </h4>
        {deal.status === "won" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
            <Check className="h-3 w-3" />
            {t("won")}
          </span>
        )}
        {deal.status === "lost" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
            <X className="h-3 w-3" />
            <span>
              {t("lost")}
              {deal.lost_reason ? ` • ${deal.lost_reason}` : ""}
            </span>
          </span>
        )}
      </div>

      {/* Contact row */}
      <div className="mt-2 flex items-center gap-2">
        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold text-foreground">
          {initials(deal.contact?.name, deal.contact?.phone)}
        </span>
        <span className="truncate text-xs text-muted-foreground">{contactLabel}</span>
      </div>

      {/* Company and Segment chip */}
      {(deal.contact?.company || deal.segment) && (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {deal.contact?.company && (
            <span className="truncate max-w-[150px] font-medium text-foreground/80">
              {deal.contact.company}
            </span>
          )}
          {deal.segment && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-muted border border-border/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              {deal.segment}
            </span>
          )}
        </div>
      )}

      {/* B2B Project Name */}
      {isB2B(deal.segment) && deal.project_name && (
        <p className="mt-1 truncate text-xs text-muted-foreground" title={deal.project_name}>
          {deal.project_name}
        </p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="text-sm font-bold text-primary">
          {formatCurrency(deal.value, deal.currency)}
        </span>
        {deal.status !== "won" && deal.status !== "lost" && deal.recontact_date ? (
          (() => {
            const status = recontactStatus(deal.recontact_date);
            const colorClass =
              status === "overdue"
                ? "text-red-400"
                : status === "today"
                  ? "text-amber-400"
                  : "text-muted-foreground";
            return (
              <span
                className={`flex items-center gap-1 text-[11px] font-medium ${colorClass}`}
                title={t("recontactDateTooltip")}
              >
                <Calendar className="h-3 w-3" />
                {formatDate(deal.recontact_date)}
              </span>
            );
          })()
        ) : deal.expected_close_date ? (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Calendar className="h-3 w-3" />
            {formatDate(deal.expected_close_date)}
          </span>
        ) : null}
      </div>

      {assigneeLabel && (
        <div className="mt-2 flex items-center justify-end">
          <span
            title={assigneeLabel}
            className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary"
          >
            {initials(assigneeLabel)}
          </span>
        </div>
      )}
    </button>
  );
}
