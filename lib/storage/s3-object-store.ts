import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { ImportError } from "@/lib/imports/contracts";
import type { ObjectStore } from "@/lib/storage/object-store";

export interface S3ObjectStoreConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
}

type Presign = (
  client: S3Client,
  command: GetObjectCommand,
  options: { expiresIn: number },
) => Promise<string>;

export class S3ObjectStore implements ObjectStore {
  constructor(
    private readonly config: S3ObjectStoreConfig,
    private readonly client: S3Client = new S3Client(S3ObjectStore.clientConfig(config)),
    private readonly presign: Presign = getSignedUrl,
  ) {}

  static fromEnv(
    env: Readonly<Record<string, string | undefined>> = process.env,
  ): S3ObjectStore {
    const values = {
      endpoint: env.S3_ENDPOINT,
      region: env.S3_REGION,
      bucket: env.S3_BUCKET,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    };
    if (Object.values(values).some((value) => !value?.trim())) {
      throw new ImportError(500, "STORAGE_CONFIGURATION_ERROR");
    }
    try {
      new URL(values.endpoint!);
    } catch {
      throw new ImportError(500, "STORAGE_CONFIGURATION_ERROR");
    }
    return new S3ObjectStore(values as S3ObjectStoreConfig);
  }

  private static clientConfig(config: S3ObjectStoreConfig): S3ClientConfig {
    return {
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    };
  }

  async putImmutable(
    key: string,
    body: Uint8Array,
    contentType: string,
    sha256: string,
  ): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
        Metadata: { sha256 },
        IfNoneMatch: "*",
      }),
    );
  }

  async deleteUncommitted(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.bucket, Key: key }),
    );
  }

  async getSignedDownloadUrl(key: string, expiresSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 1 || expiresSeconds > 3600) {
      throw new ImportError(400, "STORAGE_EXPIRY_INVALID");
    }
    return this.presign(
      this.client,
      new GetObjectCommand({ Bucket: this.config.bucket, Key: key }),
      { expiresIn: expiresSeconds },
    );
  }
}
