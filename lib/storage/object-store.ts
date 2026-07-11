export interface PendingObject {
  key: string;
  attemptId: string;
  versionId?: string;
}

export interface ObjectStore {
  readImmutable(key: string, sha256: string): Promise<Uint8Array>;
  putImmutable(
    key: string,
    body: Uint8Array,
    contentType: string,
    sha256: string,
    attemptId: string,
  ): Promise<PendingObject>;
  cleanupPending(object: PendingObject): Promise<"deleted" | "not_owned">;
  commitPending(object: PendingObject): Promise<void>;
  listPendingObjects(): Promise<PendingObject[]>;
  getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string>;
}
