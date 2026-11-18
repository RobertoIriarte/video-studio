// Interfaz estrecha compatible con R2 nativo; ningún SDK ni clave privada en browser.
export interface MediaBucket {
  put(key: string, bytes: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType: string } }): Promise<unknown>;
  get(key: string): Promise<{ body: ReadableStream<Uint8Array>; arrayBuffer(): Promise<ArrayBuffer>; size: number } | null>;
}
