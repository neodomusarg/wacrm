import { describe, expect, it } from "vitest";
import {
  BUSINESS_LINES,
  LEAD_SOURCES,
  LOST_REASONS,
  ONLINE_PIPELINE,
  PIPELINE_BLUEPRINTS,
  PROJECTS_PIPELINE,
  SEGMENTS,
  businessLineForIntent,
  businessLineOf,
  closedAtOf,
  formatLeadProfile,
  mergeLeadProfile,
  sanitizeLeadProfile,
  stageRowsFor,
} from "./neodomus";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("pipeline blueprints", () => {
  it.each(Object.values(PIPELINE_BLUEPRINTS))("$name has contiguous positions and one lost stage", (bp) => {
    expect(bp.stages.map((s) => s.position)).toEqual(bp.stages.map((_, i) => i));
    expect(bp.stages.filter((s) => s.stage_type === "lost")).toHaveLength(1);
    expect(bp.stages.some((s) => s.stage_type === "won")).toBe(true);
    // The first stage is where new leads land (lead routing picks it).
    expect(bp.stages[0].stage_type).toBe("active");
  });

  it("stage keys are unique per pipeline (uq_pipeline_stages_stage_key)", () => {
    for (const bp of [ONLINE_PIPELINE, PROJECTS_PIPELINE]) {
      const keys = bp.stages.map((s) => s.stage_key);
      expect(keys.every(Boolean)).toBe(true);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("stageRowsFor builds insert rows for the pipeline", () => {
    const rows = stageRowsFor("p-1", "online");
    expect(rows).toHaveLength(ONLINE_PIPELINE.stages.length);
    expect(rows[0]).toMatchObject({ pipeline_id: "p-1", stage_key: "online_inquiry", stage_type: "active" });
  });

  it("businessLineOf falls back to general", () => {
    expect(businessLineOf({ business_line: "online" })).toBe("online");
    expect(businessLineOf({ business_line: "projects" })).toBe("projects");
    expect(businessLineOf({})).toBe("general");
    expect(businessLineOf(null)).toBe("general");
    expect(BUSINESS_LINES).toContain("general");
  });
});

describe("DB CHECK parity (migration 044)", () => {
  const sql = readFileSync(
    join(process.cwd(), "supabase", "migrations", "044_dual_pipelines_automation_events.sql"),
    "utf8",
  );
  const checkBody = (name: string) => {
    const m = sql.match(new RegExp(`ADD CONSTRAINT ${name} CHECK \\(([\\s\\S]*?)\\n\\);`));
    if (!m) throw new Error(`constraint ${name} not found`);
    return m[1];
  };

  it.each([
    ["deals_segment_check", SEGMENTS],
    ["deals_lead_source_check", LEAD_SOURCES],
    ["deals_lost_reason_check", LOST_REASONS],
  ] as const)("%s lists exactly the TS values", (name, values) => {
    const body = checkBody(name);
    const inSql = [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(inSql)).toEqual(new Set(values));
  });
});

describe("lead profile", () => {
  it("keeps only known fields with the right types", () => {
    expect(
      sanitizeLeadProfile({
        intent: "project",
        city: "  Villa Allende ",
        products: ["Interruptor Zigbee", 3, ""],
        has_neutral: "no",
        evil: "<script>",
        budget: 12,
      }),
    ).toEqual({
      intent: "project",
      city: "Villa Allende",
      products: ["Interruptor Zigbee"],
      has_neutral: "no",
    });
  });

  it("rejects non-objects and unknown intents", () => {
    expect(sanitizeLeadProfile(null)).toBeNull();
    expect(sanitizeLeadProfile([1])).toBeNull();
    expect(sanitizeLeadProfile({ intent: "hack" })).toBeNull();
  });

  it("merges without erasing earlier answers and dedupes products", () => {
    expect(
      mergeLeadProfile(
        { intent: "online", city: "Rosario", products: ["Foco"] },
        { province: "Santa Fe", products: ["Foco", "Sensor"] },
      ),
    ).toEqual({ intent: "online", city: "Rosario", province: "Santa Fe", products: ["Foco", "Sensor"] });
    expect(mergeLeadProfile(null, null)).toBeNull();
  });

  it("maps intents to funnels", () => {
    expect(businessLineForIntent("online")).toBe("online");
    expect(businessLineForIntent("project")).toBe("projects");
    expect(businessLineForIntent("reseller")).toBe("projects");
    expect(businessLineForIntent(undefined)).toBeNull();
  });

  it("formats a one-line handoff summary", () => {
    expect(
      formatLeadProfile({ intent: "project", city: "Córdoba", province: "Córdoba", has_neutral: "no_sabe" }),
    ).toBe("Proyecto / instalación · 📍 Córdoba, Córdoba · Neutro: no sabe");
    expect(formatLeadProfile(null)).toBe("");
  });
});

describe("closedAtOf", () => {
  it("prefers closed_at over updated_at", () => {
    expect(closedAtOf({ closed_at: "2026-09-01", updated_at: "2026-10-10" })).toBe("2026-09-01");
    expect(closedAtOf({ updated_at: "2026-10-10" })).toBe("2026-10-10");
  });
});

describe("seed_dual_pipelines.sql parity", () => {
  it("lists exactly the blueprint stages", () => {
    const sql = readFileSync(join(process.cwd(), "supabase", "neodomus", "seed_dual_pipelines.sql"), "utf8");
    const rows = [
      ...sql.matchAll(/\('(online|projects)',\s*(\d+), '([^']+)',\s*'(#[0-9a-f]{6})', '(\w+)',\s*'(\w+)'\)/g),
    ].map(([, line, pos, name, color, type, key]) => ({ line, pos: Number(pos), name, color, type, key }));
    for (const bp of [ONLINE_PIPELINE, PROJECTS_PIPELINE]) {
      expect(rows.filter((r) => r.line === bp.business_line)).toEqual(
        bp.stages.map((s) => ({
          line: bp.business_line,
          pos: s.position,
          name: s.name,
          color: s.color,
          type: s.stage_type,
          key: s.stage_key,
        })),
      );
    }
  });
});
