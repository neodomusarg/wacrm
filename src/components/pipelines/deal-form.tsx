"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { CURRENCIES } from "@/lib/currency";
import type {
  Contact,
  Conversation,
  Deal,
  PipelineStage,
  Profile,
} from "@/types";
import {
  AR_PROVINCES,
  B2B_SEGMENTS,
  B2C_SEGMENTS,
  BUILD_STAGES,
  LEAD_SOURCES,
  LOST_REASONS,
  SHIPPING_CARRIERS,
  defaultSegmentFor,
  isB2B,
  stageTypeOf,
  type BusinessLine,
  type BuildStage,
  type LeadSource,
  type LostReason,
  type Segment,
} from "@/lib/neodomus";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Check,
  X,
  Trash2,
  MessageSquare,
  DollarSign,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";

interface DealFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deal?: Deal | null;
  pipelineId: string;
  /** Línea de negocio del pipeline: decide qué secciones extra se muestran. */
  businessLine?: BusinessLine;
  stages: PipelineStage[];
  defaultStageId?: string;
  onSaved: () => void;
}

export function DealForm({
  open,
  onOpenChange,
  deal,
  pipelineId,
  businessLine = "general",
  stages,
  defaultStageId,
  onSaved,
}: DealFormProps) {
  const t = useTranslations("Pipelines.form");
  const supabase = createClient();
  const { accountId, defaultCurrency } = useAuth();

  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [currency, setCurrency] = useState(defaultCurrency);
  const [contactId, setContactId] = useState("");
  const [company, setCompany] = useState("");
  const [segment, setSegment] = useState<Segment | "">("");
  const [leadSource, setLeadSource] = useState<LeadSource | "">("");
  const [projectName, setProjectName] = useState("");
  const [buildStage, setBuildStage] = useState<BuildStage | "">("");
  const [units, setUnits] = useState("");
  const [squareMeters, setSquareMeters] = useState("");
  const [stageId, setStageId] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [expectedCloseDate, setExpectedCloseDate] = useState("");
  const [lostReason, setLostReason] = useState<LostReason | "">("");
  const [recontactDate, setRecontactDate] = useState("");
  const [notes, setNotes] = useState("");
  const [orderRef, setOrderRef] = useState("");
  const [trackingCode, setTrackingCode] = useState("");
  const [shippingCarrier, setShippingCarrier] = useState("");
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [installationDate, setInstallationDate] = useState("");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [linkedConversation, setLinkedConversation] =
    useState<Conversation | null>(null);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Reset the form fields every time the sheet opens or its input
  // props change. This is a legitimate prop-driven sync; the rule is
  // over-cautious here, hence the block-level disable.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!open) return;
    setConfirmDelete(false);
    if (deal) {
      setTitle(deal.title);
      setValue(String(deal.value ?? ""));
      setCurrency(deal.currency || defaultCurrency);
      setContactId(deal.contact_id ?? "");
      setCompany(deal.contact?.company ?? "");
      setSegment(deal.segment ?? "");
      setLeadSource(deal.lead_source ?? "");
      setProjectName(deal.project_name ?? "");
      setBuildStage((deal.build_stage as BuildStage) ?? "");
      setUnits(deal.units != null ? String(deal.units) : "");
      setSquareMeters(deal.square_meters != null ? String(deal.square_meters) : "");
      setStageId(deal.stage_id);
      setAssignedTo(deal.assigned_to ?? "");
      setExpectedCloseDate(deal.expected_close_date ?? "");
      setLostReason(deal.lost_reason ?? "");
      setRecontactDate(deal.recontact_date ?? "");
      setNotes(deal.notes ?? "");
      setOrderRef(deal.order_ref ?? "");
      setTrackingCode(deal.tracking_code ?? "");
      setShippingCarrier(deal.shipping_carrier ?? "");
      setProvince(deal.province ?? "");
      setCity(deal.city ?? "");
      setInstallationDate(deal.installation_date ?? "");
    } else {
      setTitle("");
      setValue("");
      setCurrency(defaultCurrency);
      setContactId("");
      setCompany("");
      setSegment(defaultSegmentFor(businessLine));
      setLeadSource("");
      setProjectName("");
      setBuildStage("");
      setUnits("");
      setSquareMeters("");
      setStageId(defaultStageId || stages[0]?.id || "");
      setAssignedTo("");
      setExpectedCloseDate("");
      setLostReason("");
      setRecontactDate("");
      setNotes("");
      setOrderRef("");
      setTrackingCode("");
      setShippingCarrier("");
      setProvince(businessLine === "projects" ? "Córdoba" : "");
      setCity("");
      setInstallationDate("");
    }
  }, [open, deal, defaultStageId, stages, defaultCurrency, businessLine]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Load supporting data once the sheet is open
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("contacts").select("*").order("name"),
        supabase.from("profiles").select("*").order("full_name"),
      ]);
      if (cancelled) return;
      setContacts((c.data ?? []) as Contact[]);
      setProfiles((p.data ?? []) as Profile[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, supabase]);

  // Fetch linked conversation for the selected contact (newest open one).
  useEffect(() => {
    if (!open || !contactId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLinkedConversation(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("conversations")
        .select("*")
        .eq("contact_id", contactId)
        .order("last_message_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      setLinkedConversation((data as Conversation | null) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, contactId, supabase]);

  const selectedStage = stages.find((s) => s.id === stageId);
  const currentStageType = stageTypeOf(selectedStage);
  const isB2BClient = isB2B(segment);
  const isOnline = businessLine === "online";
  const showBuildSection = isB2BClient || businessLine === "projects";

  const isSaveDisabled =
    saving ||
    !title.trim() ||
    !contactId ||
    !stageId ||
    !segment ||
    (isB2BClient && !company.trim()) ||
    (currentStageType === "lost" && !lostReason) ||
    (currentStageType === "paused" && !recontactDate);

  async function handleSave() {
    if (!title.trim() || !contactId || !stageId) {
      toast.error(t("toastRequired"));
      return;
    }
    if (!segment) {
      toast.error(t("toastSegmentRequired"));
      return;
    }
    if (isB2BClient && !company.trim()) {
      toast.error(t("toastCompanyRequiredForB2B"));
      return;
    }
    if (currentStageType === "lost" && !lostReason) {
      toast.error(t("toastLostReasonRequired"));
      return;
    }
    if (currentStageType === "paused" && !recontactDate) {
      toast.error(t("toastRecontactDateRequired"));
      return;
    }

    setSaving(true);

    const b2b = showBuildSection;
    const parsedUnits = units.trim() !== "" ? Math.max(0, parseInt(units, 10)) : null;
    const parsedSqm = squareMeters.trim() !== "" ? Math.max(0, parseFloat(squareMeters)) : null;

    const payload = {
      title: title.trim(),
      value: parseFloat(value) || 0,
      currency,
      contact_id: contactId,
      pipeline_id: pipelineId,
      stage_id: stageId,
      assigned_to: assignedTo || null,
      notes: notes.trim() || null,
      expected_close_date: expectedCloseDate || null,
      segment: segment || null,
      lead_source: leadSource || null,
      project_name: b2b && projectName.trim() ? projectName.trim() : null,
      build_stage: b2b && buildStage ? buildStage : null,
      units: b2b && parsedUnits !== null && !isNaN(parsedUnits) ? parsedUnits : null,
      square_meters: b2b && parsedSqm !== null && !isNaN(parsedSqm) ? parsedSqm : null,
      lost_reason: currentStageType === "lost" && lostReason ? lostReason : null,
      recontact_date: recontactDate || null,
      // Columnas de la migración 044: solo existen en pipelines con línea
      // de negocio, así que en un pipeline "general" no se envían.
      ...(businessLine !== "general" && {
        province: province || null,
        city: city.trim() || null,
        order_ref: isOnline && orderRef.trim() ? orderRef.trim() : null,
        tracking_code: isOnline && trackingCode.trim() ? trackingCode.trim() : null,
        shipping_carrier: isOnline && shippingCarrier ? shippingCarrier : null,
        installation_date: !isOnline && installationDate ? installationDate : null,
      }),
    };

    if (deal) {
      const { error } = await supabase
        .from("deals")
        .update(payload)
        .eq("id", deal.id);
      if (error) {
        toast.error(t("toastFailedSave"));
        setSaving(false);
        return;
      }
    } else {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) {
        toast.error(t("toastNotSignedIn"));
        setSaving(false);
        return;
      }
      if (!accountId) {
        toast.error(t("toastNotLinked"));
        setSaving(false);
        return;
      }
      const { error } = await supabase
        .from("deals")
        .insert({ ...payload, user_id: user.id, account_id: accountId });
      if (error) {
        toast.error(t("toastFailedCreate"));
        setSaving(false);
        return;
      }
    }

    // Sync company to contact if changed
    const currentContact = contacts.find((c) => c.id === contactId);
    const originalCompany = currentContact?.company ?? "";
    const trimmedCompany = company.trim();
    if (trimmedCompany !== originalCompany) {
      const { error: companyError } = await supabase
        .from("contacts")
        .update({ company: trimmedCompany || null })
        .eq("id", contactId);
      if (companyError) {
        toast.warning(t("toastCompanyUpdateWarning"));
      }
    }

    setSaving(false);
    toast.success(deal ? t("toastUpdated") : t("toastCreated"));
    onOpenChange(false);
    onSaved();
  }

  async function handleDelete() {
    if (!deal) return;
    setDeleting(true);
    const { error } = await supabase.from("deals").delete().eq("id", deal.id);
    setDeleting(false);
    if (error) {
      toast.error(t("toastFailedDelete"));
      return;
    }
    toast.success(t("toastDeleted"));
    setConfirmDelete(false);
    onOpenChange(false);
    onSaved();
  }

  const wonStage = stages.find((s) => stageTypeOf(s) === "won");
  const lostStage = stages.find((s) => stageTypeOf(s) === "lost");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="bg-popover border-border text-popover-foreground sm:max-w-lg w-full p-0"
      >
        <div className="flex h-full flex-col">
          <SheetHeader className="border-b border-border/50 p-4">
            <SheetTitle className="text-popover-foreground">
              {deal ? t("editDeal") : t("newDeal")}
            </SheetTitle>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* 1. Title */}
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("title")}</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={t("titlePlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {/* 2. Contact + Company */}
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("contact")}</Label>
              <select
                value={contactId}
                onChange={(e) => {
                  const nextId = e.target.value;
                  setContactId(nextId);
                  const sel = contacts.find((c) => c.id === nextId);
                  if (sel) {
                    setCompany(sel.company ?? "");
                  }
                }}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                <option value="">{t("selectContact")}</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name || c.phone}
                  </option>
                ))}
              </select>

              {linkedConversation && (
                <Link
                  href="/inbox"
                  className="mt-1 inline-flex items-center gap-1.5 self-start rounded-md bg-primary/10 px-2 py-1 text-xs text-primary hover:bg-primary/20"
                >
                  <MessageSquare className="h-3 w-3" />
                  {t("linkToConversation")}
                </Link>
              )}
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("company")}</Label>
              <Input
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t("companyPlaceholder")}
                className="border-border bg-muted text-foreground"
              />
            </div>

            {/* 3. Segment + Lead Source */}
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("segment")} *</Label>
                <select
                  value={segment}
                  onChange={(e) => setSegment(e.target.value as Segment)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{t("selectSegment")}</option>
                  <optgroup label="B2B">
                    {B2B_SEGMENTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="B2C">
                    {B2C_SEGMENTS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("leadSource")}</Label>
                <select
                  value={leadSource}
                  onChange={(e) => setLeadSource(e.target.value as LeadSource)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{t("selectLeadSource")}</option>
                  {LEAD_SOURCES.map((ls) => (
                    <option key={ls} value={ls}>
                      {ls}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 3b. Ubicación (embudos Online / Proyectos) */}
            {businessLine !== "general" && (
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("province")}</Label>
                  <select
                    value={province}
                    onChange={(e) => setProvince(e.target.value)}
                    className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                  >
                    <option value="">{t("selectProvince")}</option>
                    {AR_PROVINCES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("city")}</Label>
                  <Input
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    placeholder={t("cityPlaceholder")}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>
            )}

            {/* 3c. Pedido online */}
            {isOnline && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("orderSection")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("orderRef")}</Label>
                    <Input
                      value={orderRef}
                      onChange={(e) => setOrderRef(e.target.value)}
                      placeholder="#1234"
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("shippingCarrier")}</Label>
                    <select
                      value={shippingCarrier}
                      onChange={(e) => setShippingCarrier(e.target.value)}
                      className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{t("selectCarrier")}</option>
                      {SHIPPING_CARRIERS.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid gap-2">
                  <Label className="text-muted-foreground">{t("trackingCode")}</Label>
                  <Input
                    value={trackingCode}
                    onChange={(e) => setTrackingCode(e.target.value)}
                    className="border-border bg-muted text-foreground"
                  />
                </div>
              </div>
            )}

            {/* 4. Construction section if B2B / Proyectos */}
            {showBuildSection && (
              <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t("buildSection")}
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("projectName")}</Label>
                    <Input
                      value={projectName}
                      onChange={(e) => setProjectName(e.target.value)}
                      placeholder={t("projectNamePlaceholder")}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("buildStage")}</Label>
                    <select
                      value={buildStage}
                      onChange={(e) => setBuildStage(e.target.value as BuildStage)}
                      className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                    >
                      <option value="">{t("selectBuildStage")}</option>
                      {BUILD_STAGES.map((bs) => (
                        <option key={bs} value={bs}>
                          {bs}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("units")}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      value={units}
                      onChange={(e) => setUnits(e.target.value)}
                      placeholder="0"
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("squareMeters")}</Label>
                    <Input
                      type="number"
                      min="0"
                      step="any"
                      value={squareMeters}
                      onChange={(e) => setSquareMeters(e.target.value)}
                      placeholder="0"
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                </div>
                {businessLine === "projects" && (
                  <div className="grid gap-2">
                    <Label className="text-muted-foreground">{t("installationDate")}</Label>
                    <Input
                      type="date"
                      value={installationDate}
                      onChange={(e) => setInstallationDate(e.target.value)}
                      className="border-border bg-muted text-foreground"
                    />
                  </div>
                )}
              </div>
            )}

            {/* 5. Value + Currency, Close Date, Stage, Assigned To */}
            <div className="grid grid-cols-[1fr_110px] gap-3">
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("value")}</Label>
                <div className="relative">
                  <DollarSign className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    type="number"
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    placeholder="0"
                    className="border-border bg-muted pl-7 text-foreground"
                  />
                </div>
              </div>
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("currency")}</Label>
                <select
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  {CURRENCIES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("expectedCloseDate")}</Label>
              <Input
                type="date"
                value={expectedCloseDate}
                onChange={(e) => setExpectedCloseDate(e.target.value)}
                className="border-border bg-muted text-foreground"
              />
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("stage")}</Label>
              <select
                value={stageId}
                onChange={(e) => setStageId(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                {stages.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("assignedTo")}</Label>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
              >
                <option value="">{t("unassigned")}</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name || p.email}
                  </option>
                ))}
              </select>
            </div>

            {/* 6. Conditionals by stage type */}
            {currentStageType === "lost" && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("lostReason")} *</Label>
                <select
                  value={lostReason}
                  onChange={(e) => setLostReason(e.target.value as LostReason)}
                  className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary"
                >
                  <option value="">{t("selectLostReason")}</option>
                  {LOST_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentStageType === "paused" && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("recontactDate")} *</Label>
                <Input
                  type="date"
                  value={recontactDate}
                  onChange={(e) => setRecontactDate(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            )}

            {currentStageType !== "lost" && currentStageType !== "paused" && (
              <div className="grid gap-2">
                <Label className="text-muted-foreground">{t("nextFollowUp")}</Label>
                <Input
                  type="date"
                  value={recontactDate}
                  onChange={(e) => setRecontactDate(e.target.value)}
                  className="border-border bg-muted text-foreground"
                />
              </div>
            )}

            {/* 7. Notes */}
            <div className="grid gap-2">
              <Label className="text-muted-foreground">{t("notes")}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t("notesPlaceholder")}
                className="min-h-[100px] border-border bg-muted text-foreground"
              />
            </div>

            {/* Status section (quick move to won/lost stage) */}
            {deal && (wonStage || lostStage) && (
              <div className="space-y-2 rounded-lg border border-border bg-muted/50 p-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  {t("status")}
                </p>
                <div className="flex gap-2">
                  {wonStage && (
                    <Button
                      type="button"
                      onClick={() => setStageId(wonStage.id)}
                      disabled={stageId === wonStage.id}
                      className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    >
                      <Check className="mr-1 h-4 w-4" />
                      {t("markAsWon")}
                    </Button>
                  )}
                  {lostStage && (
                    <Button
                      type="button"
                      onClick={() => setStageId(lostStage.id)}
                      disabled={stageId === lostStage.id}
                      className="flex-1 bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      <X className="mr-1 h-4 w-4" />
                      {t("markAsLost")}
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-border/50 bg-popover/80 p-4">
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="flex-1 border-border bg-transparent text-muted-foreground hover:bg-muted"
              >
                {t("cancel")}
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaveDisabled}
                className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                {saving ? t("saving") : deal ? t("saveChanges") : t("createDeal")}
              </Button>
            </div>

            {deal &&
              (confirmDelete ? (
                <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
                  <span className="text-red-300">{t("deletePrompt")}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      disabled={deleting}
                      className="rounded px-2 py-1 text-muted-foreground hover:bg-muted"
                    >
                      {t("cancel")}
                    </button>
                    <button
                      type="button"
                      onClick={handleDelete}
                      disabled={deleting}
                      className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      {deleting ? t("deleting") : t("confirm")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="mt-3 flex w-full items-center justify-center gap-1 text-xs text-red-400 hover:text-red-300"
                >
                  <Trash2 className="h-3 w-3" />
                  {t("deleteDeal")}
                </button>
              ))}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
