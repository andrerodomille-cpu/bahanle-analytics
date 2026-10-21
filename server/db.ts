// Conexão com o Postgres (Neon em produção), compartilhada por relatórios e usuários.

import pg from "pg";

export type Pool = pg.Pool;

/** Pool do DATABASE_URL; sem ele, null (o app roda sem banco). */
export function poolFromEnv(env: Record<string, string | undefined>): Pool | null {
  const url = env.DATABASE_URL?.trim();
  return url ? new pg.Pool({ connectionString: url, max: 5 }) : null;
}

/**
 * Consulta que garante o esquema antes da primeira execução (CREATE … IF NOT
 * EXISTS); se a criação falhar, tenta de novo na próxima consulta.
 */
export function withSchema(pool: Pool, schema: string) {
  let ready: Promise<unknown> | null = null;
  return async <T extends pg.QueryResultRow>(sql: string, params: unknown[] = []) => {
    ready ??= pool.query(schema).catch((e) => {
      ready = null;
      throw e;
    });
    await ready;
    return pool.query<T>(sql, params);
  };
}
