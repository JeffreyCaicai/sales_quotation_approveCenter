import { XMLParser, XMLValidator } from "fast-xml-parser";
import yauzl, { type Entry, type ZipFile } from "yauzl";

import { ImportError } from "@/lib/imports/contracts";

const MAX_ENTRIES = 2048;
const MAX_ENTRY_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_COMPRESSION_RATIO = 1000;
const NORMAL_WORKBOOK_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";
const CONTENT_TYPES = "[Content_Types].xml";
const WORKBOOK = "xl/workbook.xml";
const WORKBOOK_RELS = "xl/_rels/workbook.xml.rels";

function invalid(): ImportError {
  return new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
}

function openZip(body: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(body),
      { lazyEntries: true, autoClose: false, validateEntrySizes: true },
      (error, zip) => error || !zip ? reject(invalid()) : resolve(zip),
    );
  });
}

function unsafePath(name: string): boolean {
  if (name.includes("\\") || name.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(name)) return true;
  return name.split("/").some((part) => part === "..");
}

function prohibitedPart(normalized: string): boolean {
  return normalized.endsWith("/vbaproject.bin") ||
    normalized === "vbaproject.bin" ||
    normalized.includes("/embeddings/") ||
    normalized.includes("/externallinks/") ||
    normalized.includes("/activex/") ||
    normalized.includes("oleobject");
}

async function readEntry(
  zip: ZipFile,
  entry: Entry,
  aggregate: { bytes: number },
  capture: boolean,
): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(invalid());
      const chunks: Buffer[] = [];
      let actual = 0;
      stream.on("data", (chunk: Buffer) => {
        actual += chunk.length;
        aggregate.bytes += chunk.length;
        const ratio = actual / Math.max(entry.compressedSize, 1);
        if (
          actual > MAX_ENTRY_BYTES ||
          aggregate.bytes > MAX_UNCOMPRESSED_BYTES ||
          ratio > MAX_COMPRESSION_RATIO
        ) {
          stream.destroy(invalid());
        } else if (capture) chunks.push(Buffer.from(chunk));
      });
      stream.once("error", () => reject(invalid()));
      stream.once("end", () => resolve(capture ? Buffer.concat(chunks) : undefined));
    });
  });
}

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  removeNSPrefix: true,
  processEntities: false,
  parseTagValue: false,
  allowBooleanAttributes: false,
});

function parseXml(buffer: Buffer): Record<string, unknown> {
  const text = buffer.toString("utf8");
  if (XMLValidator.validate(text) !== true) throw invalid();
  const parsed = xmlParser.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw invalid();
  return parsed as Record<string, unknown>;
}

function array(value: unknown): Array<Record<string, unknown>> {
  const values = Array.isArray(value) ? value : value ? [value] : [];
  return values.filter((item): item is Record<string, unknown> =>
    Boolean(item) && typeof item === "object" && !Array.isArray(item));
}

function validateXmlParts(parts: Map<string, Buffer>): void {
  const types = parseXml(parts.get(CONTENT_TYPES)!);
  const typesRoot = types.Types;
  if (!typesRoot || typeof typesRoot !== "object" || Array.isArray(typesRoot)) throw invalid();
  const workbookOverrides = array((typesRoot as Record<string, unknown>).Override)
    .filter((override) => override.PartName === "/xl/workbook.xml");
  if (
    workbookOverrides.length !== 1 ||
    workbookOverrides[0].ContentType !== NORMAL_WORKBOOK_TYPE
  ) throw invalid();

  const workbook = parseXml(parts.get(WORKBOOK)!);
  if (!workbook.workbook || typeof workbook.workbook !== "object" || Array.isArray(workbook.workbook)) {
    throw invalid();
  }

  const relationshipsBuffer = parts.get(WORKBOOK_RELS);
  if (!relationshipsBuffer) return;
  const relationships = parseXml(relationshipsBuffer);
  const root = relationships.Relationships;
  if (!root || typeof root !== "object" || Array.isArray(root)) throw invalid();
  for (const relationship of array((root as Record<string, unknown>).Relationship)) {
    const type = String(relationship.Type ?? "").toLowerCase();
    const target = String(relationship.Target ?? "").toLowerCase();
    if (
      String(relationship.TargetMode ?? "").toLowerCase() === "external" ||
      /externallink|oleobject|vba|package|activex|attachedtoolbars/u.test(type) ||
      /externallinks|embeddings|vbaproject|oleobject|activex/u.test(target)
    ) throw invalid();
  }
}

export async function inspectXlsxContainer(body: Uint8Array): Promise<void> {
  let zip: ZipFile | undefined;
  try {
    zip = await openZip(body);
    const seen = new Set<string>();
    const parts = new Map<string, Buffer>();
    const aggregate = { bytes: 0 };
    let entries = 0;
    await new Promise<void>((resolve, reject) => {
      zip!.once("error", () => reject(invalid()));
      zip!.once("end", resolve);
      zip!.on("entry", (entry: Entry) => {
        void (async () => {
          entries += 1;
          const name = entry.fileName;
          const normalized = name.toLowerCase();
          if (
            entries > MAX_ENTRIES ||
            seen.has(normalized) ||
            unsafePath(name) ||
            prohibitedPart(normalized)
          ) throw invalid();
          seen.add(normalized);
          const capture = name === CONTENT_TYPES || name === WORKBOOK || name === WORKBOOK_RELS;
          const captured = await readEntry(zip!, entry, aggregate, capture);
          if (capture && captured) parts.set(name, captured);
          zip!.readEntry();
        })().catch(reject);
      });
      zip!.readEntry();
    });
    if (!parts.has(CONTENT_TYPES) || !parts.has(WORKBOOK)) throw invalid();
    validateXmlParts(parts);
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw invalid();
  } finally {
    zip?.close();
  }
}
