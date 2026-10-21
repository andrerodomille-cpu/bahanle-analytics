// Utilitários HTTP comuns ao login e às rotas da API.

import type { IncomingMessage, ServerResponse } from "node:http";

export type Next = (err?: unknown) => void;

// Sem "constructor(public status…)": o Node roda este arquivo só removendo os tipos.
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  res.end(body === undefined ? "" : JSON.stringify(body));
}

/** Lê o corpo do pedido como texto; acima de `limit` bytes, 413. */
export async function readBody(req: IncomingMessage, limit = 16_384): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, `O conteúdo passa do limite de ${(limit / 1_048_576).toFixed(1).replace(".", ",")} MB.`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function readJson<T>(req: IncomingMessage, limit?: number): Promise<T> {
  const text = await readBody(req, limit);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(400, "JSON inválido.");
  }
}
