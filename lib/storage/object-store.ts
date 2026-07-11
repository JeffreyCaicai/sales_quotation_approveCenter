export interface ObjectStore {
  putImmutable(
    key: string,
    body: Uint8Array,
    contentType: string,
    sha256: string,
  ): Promise<void>;
  deleteUncommitted(key: string): Promise<void>;
  getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string>;
}
