import Busboy from "busboy";

import { ImportError } from "@/lib/imports/contracts";

export const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export interface ParsedImportMultipart {
  templateVersion: string;
  files: File[];
}

export async function parseImportMultipart(request: Request): Promise<ParsedImportMultipart> {
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > MAX_IMPORT_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
    throw new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED");
  }
  if (!request.body) throw new ImportError(400, "IMPORT_FILES_INVALID");

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(request.headers),
      limits: {
        files: 4,
        fields: 2,
        parts: 6,
        fieldSize: 1024,
        fileSize: MAX_IMPORT_FILE_BYTES + 1,
      },
    });
  } catch {
    throw new ImportError(400, "IMPORT_FILES_INVALID");
  }

  const fields = new Map<string, string>();
  const uploads: Array<{ name: string; type: string; chunks: Buffer[] }> = [];
  let totalBytes = 0;
  let failure: ImportError | undefined;
  parser.on("field", (name, value, info) => {
    if (name !== "templateVersion" || info.valueTruncated || fields.has(name)) {
      failure = new ImportError(400, "IMPORT_FILES_INVALID");
    } else fields.set(name, value);
  });
  parser.on("file", (field, stream, info) => {
    if (field !== "files") {
      failure = new ImportError(400, "IMPORT_FILES_INVALID");
      stream.resume();
      return;
    }
    const upload = { name: info.filename, type: info.mimeType, chunks: [] as Buffer[] };
    uploads.push(upload);
    stream.on("data", (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > MAX_IMPORT_FILE_BYTES) failure = new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED");
      else upload.chunks.push(Buffer.from(chunk));
    });
    stream.once("limit", () => { failure = new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED"); });
    stream.on("error", () => { /* parser abort is handled by the request loop */ });
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) {
    parser.once(event, () => { failure = new ImportError(400, "IMPORT_FILES_INVALID"); });
  }

  const completed = new Promise<void>((resolve, reject) => {
    parser.once("finish", resolve);
    parser.once("error", reject);
  });
  void completed.catch(() => undefined);
  const reader = request.body.getReader();
  let receivedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      receivedBytes += value.byteLength;
      if (receivedBytes > MAX_IMPORT_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES) {
        await reader.cancel();
        parser.destroy();
        throw new ImportError(413, "IMPORT_TOTAL_SIZE_EXCEEDED");
      }
      parser.write(Buffer.from(value));
      if (failure) {
        await reader.cancel();
        parser.destroy();
        throw failure;
      }
    }
    parser.end();
    await completed;
  } catch (error) {
    if (error instanceof ImportError) throw error;
    throw new ImportError(400, "IMPORT_FILES_INVALID");
  } finally {
    reader.releaseLock();
  }
  if (failure) throw failure;
  const templateVersion = fields.get("templateVersion")?.trim();
  if (!templateVersion || uploads.length === 0) {
    throw new ImportError(400, "IMPORT_FILES_INVALID");
  }
  return {
    templateVersion,
    files: uploads.map(({ name, type, chunks }) =>
      new File([Buffer.concat(chunks)], name, { type })),
  };
}
