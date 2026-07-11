import yauzl, { type Entry, type ZipFile } from "yauzl";

import { ImportError } from "@/lib/imports/contracts";

const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
const MAX_CONTENT_TYPES_BYTES = 2 * 1024 * 1024;
const NORMAL_WORKBOOK_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml";

function invalid(): ImportError {
  return new ImportError(400, "IMPORT_FILE_SIGNATURE_INVALID");
}

function openZip(body: Uint8Array): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(Buffer.from(body), { lazyEntries: true, validateEntrySizes: true },
      (error, zip) => error || !zip ? reject(invalid()) : resolve(zip));
  });
}

function readEntry(zip: ZipFile, entry: Entry): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(invalid());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_CONTENT_TYPES_BYTES) stream.destroy(invalid());
        else chunks.push(chunk);
      });
      stream.once("error", () => reject(invalid()));
      stream.once("end", () => resolve(Buffer.concat(chunks)));
    });
  });
}

function unsafePath(name: string): boolean {
  if (name.includes("\\") || name.startsWith("/") || /[\u0000-\u001f\u007f]/u.test(name)) return true;
  return name.split("/").some((part) => part === "..");
}

export async function inspectXlsxContainer(body: Uint8Array): Promise<void> {
  let zip: ZipFile | undefined;
  try {
    zip = await openZip(body);
    let total = 0;
    let hasWorkbook = false;
    let contentTypes: Entry | undefined;
    await new Promise<void>((resolve, reject) => {
      zip!.once("error", () => reject(invalid()));
      zip!.on("entry", (entry: Entry) => {
        const name = entry.fileName;
        total += entry.uncompressedSize;
        if (unsafePath(name) || total > MAX_UNCOMPRESSED_BYTES) return reject(invalid());
        const normalized = name.toLowerCase();
        if (normalized.endsWith("/vbaproject.bin") || normalized === "vbaproject.bin") return reject(invalid());
        if (name === "xl/workbook.xml") hasWorkbook = true;
        if (name === "[Content_Types].xml") contentTypes = entry;
        zip!.readEntry();
      });
      zip!.once("end", resolve);
      zip!.readEntry();
    });
    if (!hasWorkbook || !contentTypes) throw invalid();
    const xml = (await readEntry(zip, contentTypes)).toString("utf8");
    if (
      !xml.includes(NORMAL_WORKBOOK_TYPE) ||
      /sheet\.macroenabled\.main\+xml/i.test(xml)
    ) throw invalid();
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw invalid();
  } finally {
    zip?.close();
  }
}
