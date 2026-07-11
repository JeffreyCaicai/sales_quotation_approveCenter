import { createHash } from "node:crypto";

import { z } from "zod";

import { importDataTypes } from "@/db/enums";

const jsonSchema = z.json();

export const normalizedImportSchema = z.object({
  dataType: z.enum(importDataTypes),
  templateVersion: z.string().trim().min(1).max(100),
  checksum: z.string().regex(/^[a-fA-F0-9]{64}$/),
  payload: jsonSchema,
}).strict();

export interface ChecksumEnvelope {
  dataType: (typeof importDataTypes)[number];
  templateVersion: string;
  payload: z.infer<typeof jsonSchema>;
}

export function canonicalJson(value: z.infer<typeof jsonSchema>): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Non-finite JSON number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const entries = Object.entries(value).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}

export function normalizedChecksum(input: ChecksumEnvelope): string {
  return createHash("sha256").update(canonicalJson({
    dataType: input.dataType,
    templateVersion: input.templateVersion,
    payload: input.payload,
  })).digest("hex");
}
