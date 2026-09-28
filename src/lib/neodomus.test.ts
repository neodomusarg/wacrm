import { describe, expect, it } from "vitest";
import type { PipelineStage } from "@/types";
import {
  countsTowardActiveValue,
  isB2B,
  recontactStatus,
  stageTypeOf,
  statusForStageType,
} from "./neodomus";

describe("isB2B", () => {
  it("identifies B2B segments correctly", () => {
    expect(isB2B("Constructora")).toBe(true);
    expect(isB2B("Estudio de arquitectura")).toBe(true);
    expect(isB2B("Desarrollista")).toBe(true);
  });

  it("identifies B2C segments as not B2B", () => {
    expect(isB2B("Familia / Hogar")).toBe(false);
    expect(isB2B("Vivienda en obra / remodelación")).toBe(false);
    expect(isB2B("Alquiler temporario (Airbnb)")).toBe(false);
    expect(isB2B("Oficina / Comercio")).toBe(false);
  });

  it("handles null, undefined and empty strings", () => {
    expect(isB2B(null)).toBe(false);
    expect(isB2B(undefined)).toBe(false);
    expect(isB2B("")).toBe(false);
    expect(isB2B("Unknown segment")).toBe(false);
  });
});

describe("stageTypeOf", () => {
  it("returns stage_type when defined", () => {
    expect(stageTypeOf({ stage_type: "active" })).toBe("active");
    expect(stageTypeOf({ stage_type: "paused" })).toBe("paused");
    expect(stageTypeOf({ stage_type: "won" })).toBe("won");
    expect(stageTypeOf({ stage_type: "lost" })).toBe("lost");
  });

  it("falls back to 'active' when stage_type is undefined or stage is null/undefined", () => {
    expect(stageTypeOf(undefined)).toBe("active");
    expect(stageTypeOf(null)).toBe("active");
    expect(stageTypeOf({})).toBe("active");
  });
});

describe("statusForStageType", () => {
  it("maps stage types to deal status matching the DB trigger", () => {
    expect(statusForStageType("won")).toBe("won");
    expect(statusForStageType("lost")).toBe("lost");
    expect(statusForStageType("active")).toBe("open");
    expect(statusForStageType("paused")).toBe("open");
  });
});

describe("countsTowardActiveValue", () => {
  const stageMap = new Map<string, PipelineStage>([
    [
      "stage-active",
      {
        id: "stage-active",
        pipeline_id: "p1",
        name: "En conversación",
        position: 2,
        color: "#8b5cf6",
        stage_type: "active",
        created_at: "2026-01-01",
      },
    ],
    [
      "stage-paused",
      {
        id: "stage-paused",
        pipeline_id: "p1",
        name: "En pausa / Recontactar",
        position: 5,
        color: "#64748b",
        stage_type: "paused",
        created_at: "2026-01-01",
      },
    ],
    [
      "stage-won",
      {
        id: "stage-won",
        pipeline_id: "p1",
        name: "Ganado",
        position: 6,
        color: "#059669",
        stage_type: "won",
        created_at: "2026-01-01",
      },
    ],
    [
      "stage-lost",
      {
        id: "stage-lost",
        pipeline_id: "p1",
        name: "Perdido",
        position: 7,
        color: "#e11d48",
        stage_type: "lost",
        created_at: "2026-01-01",
      },
    ],
  ]);

  it("returns true only for open deals in active stages", () => {
    expect(
      countsTowardActiveValue(
        { status: "open", stage_id: "stage-active" },
        stageMap,
      ),
    ).toBe(true);

    // Default status is open
    expect(
      countsTowardActiveValue({ stage_id: "stage-active" }, stageMap),
    ).toBe(true);
  });

  it("returns false for paused, won, or lost stages even if status is open", () => {
    expect(
      countsTowardActiveValue(
        { status: "open", stage_id: "stage-paused" },
        stageMap,
      ),
    ).toBe(false);

    expect(
      countsTowardActiveValue(
        { status: "open", stage_id: "stage-won" },
        stageMap,
      ),
    ).toBe(false);

    expect(
      countsTowardActiveValue(
        { status: "open", stage_id: "stage-lost" },
        stageMap,
      ),
    ).toBe(false);
  });

  it("returns false if deal status is not open", () => {
    expect(
      countsTowardActiveValue(
        { status: "won", stage_id: "stage-active" },
        stageMap,
      ),
    ).toBe(false);

    expect(
      countsTowardActiveValue(
        { status: "lost", stage_id: "stage-active" },
        stageMap,
      ),
    ).toBe(false);
  });
});

describe("recontactStatus", () => {
  const referenceDate = new Date(2026, 4, 18, 14, 0, 0); // 2026-05-18 local

  it("returns null when date is empty or missing", () => {
    expect(recontactStatus(null, referenceDate)).toBeNull();
    expect(recontactStatus(undefined, referenceDate)).toBeNull();
    expect(recontactStatus("", referenceDate)).toBeNull();
  });

  it("returns 'overdue' for past dates", () => {
    expect(recontactStatus("2026-05-17", referenceDate)).toBe("overdue");
    expect(recontactStatus("2026-01-01", referenceDate)).toBe("overdue");
  });

  it("returns 'today' for the current local date", () => {
    expect(recontactStatus("2026-05-18", referenceDate)).toBe("today");
  });

  it("returns 'upcoming' for future dates", () => {
    expect(recontactStatus("2026-05-19", referenceDate)).toBe("upcoming");
    expect(recontactStatus("2026-06-01", referenceDate)).toBe("upcoming");
  });
});
