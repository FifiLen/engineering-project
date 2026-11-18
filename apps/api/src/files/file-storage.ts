import { Readable } from 'node:stream';
import { DeleteObjectCommand, GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

/** Obiekt odczytany z magazynu: strumień do odpowiedzi HTTP. */
export interface StoredObject {
  body: Readable;
  sizeBytes: number | null;
}

/**
 * Port magazynu plików (ADR 0057). Klucz wybiera API, a metadane (cel, typ, właściciel) są w tabeli `files`;
 * magazyn przechowuje tylko bajty. Brak obiektu przy odczycie to `null`, a usunięcie brakującego niczego nie psuje.
 */
export interface FileStorage {
  readonly name: 's3' | 'memory';
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');

/** SeaweedFS przez bramę S3 (ADR 0024): adres ścieżkowy (`forcePathStyle`), bo brama nie obsługuje subdomen kubełków. */
export class S3FileStorage implements FileStorage {
  readonly name = 's3' as const;
  private readonly client: S3Client;

  constructor(
    private readonly options: {
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    },
  ) {
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
      }),
    );
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.options.bucket, Key: key }));
      if (!result.Body) return null;
      return { body: result.Body as Readable, sizeBytes: result.ContentLength ?? null };
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  close(): void {
    this.client.destroy();
  }
}

/** Magazyn w pamięci procesu dla testów API (`FILE_STORAGE=memory`). */
export class MemoryFileStorage implements FileStorage {
  readonly name = 'memory' as const;
  readonly objects = new Map<string, { body: Buffer; contentType: string }>();

  put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
    return Promise.resolve();
  }

  get(key: string): Promise<StoredObject | null> {
    const object = this.objects.get(key);
    return Promise.resolve(object ? { body: Readable.from(object.body), sizeBytes: object.body.length } : null);
  }

  delete(key: string): Promise<void> {
    this.objects.delete(key);
    return Promise.resolve();
  }
}
