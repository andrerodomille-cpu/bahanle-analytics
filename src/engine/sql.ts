import type { ColumnType, Row, Table, Value } from "../model/types";
import { isIsoDate, shiftDate, todayIso } from "../model/dates";

/**
 * Mini Spark SQL: o motor dos notebooks, no espírito do Databricks SQL.
 *
 * Três etapas, como num banco de verdade:
 *  1. **Análise léxica e sintática**: texto → tokens → árvore (AST).
 *  2. **Otimização**: filtros do WHERE que só usam uma tabela descem até a
 *     leitura dela (*predicate pushdown*, como o Catalyst do Spark) e junções
 *     por igualdade viram *hash join* em vez de comparar todos com todos.
 *  3. **Execução** operador a operador, medindo linhas e tempo de cada um —
 *     o `EXPLAIN` mostra esse plano (aqui ele executa e mede, como um
 *     EXPLAIN ANALYZE).
 *
 * Suporta SELECT [DISTINCT], FROM com JOIN (INNER/LEFT/RIGHT/FULL/CROSS) e
 * subconsultas, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, UNION [ALL],
 * WITH (CTE), CASE, CAST, IN/BETWEEN/LIKE, funções de janela (OVER) e os
 * comandos CREATE [OR REPLACE] TABLE … AS, CREATE TEMP VIEW, DROP, SHOW
 * TABLES, DESCRIBE e EXPLAIN. Nomes não diferenciam maiúsculas e aceitam
 * acentos; nomes com espaço vão entre crases: `Minha tabela`.
 */

export class SqlError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
  }
}

// ---------------- Análise léxica ----------------

type TokKind = "id" | "qid" | "num" | "str" | "op" | "eof";
interface Tok { k: TokKind; v: string; pos: number }

const OPS = ["<>", "!=", "<=", ">=", "||", "=", "<", ">", "+", "-", "*", "/", "%", "(", ")", ",", ".", ";"];
const NUM_RE = /(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/y;
const ID_RE = /[\p{L}_][\p{L}\p{N}_]*/uy;

export function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "-" && src[i + 1] === "-") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end < 0 ? src.length : end + 2;
      continue;
    }
    const start = i;
    if (c === "'" || c === "\"") {
      let s = "";
      i++;
      for (;;) {
        if (i >= src.length) throw new SqlError("Texto sem aspas de fechamento", start);
        if (src[i] === c) {
          if (src[i + 1] === c) { s += c; i += 2; continue; }
          i++;
          break;
        }
        if (src[i] === "\\" && i + 1 < src.length) { s += src[i + 1]; i += 2; continue; }
        s += src[i++];
      }
      out.push({ k: "str", v: s, pos: start });
      continue;
    }
    if (c === "`") {
      const end = src.indexOf("`", i + 1);
      if (end < 0) throw new SqlError("Nome entre crases sem a crase de fechamento", start);
      out.push({ k: "qid", v: src.slice(i + 1, end), pos: start });
      i = end + 1;
      continue;
    }
    NUM_RE.lastIndex = i;
    const num = /[0-9.]/.test(c) ? NUM_RE.exec(src) : null;
    if (num) {
      out.push({ k: "num", v: num[0], pos: start });
      i += num[0].length;
      continue;
    }
    ID_RE.lastIndex = i;
    const id = ID_RE.exec(src);
    if (id) {
      out.push({ k: "id", v: id[0], pos: start });
      i += id[0].length;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (!op) throw new SqlError(`Caractere inesperado "${c}"`, start);
    out.push({ k: "op", v: op === "!=" ? "<>" : op, pos: start });
    i += op.length;
  }
  out.push({ k: "eof", v: "", pos: src.length });
  return out;
}

// ---------------- Árvore sintática ----------------

export type Expr =
  | { k: "lit"; v: SV }
  | { k: "col"; table?: string; name: string }
  | { k: "star"; table?: string }
  | { k: "bin"; op: string; l: Expr; r: Expr }
  | { k: "un"; op: "NOT" | "-"; e: Expr }
  | { k: "isnull"; e: Expr; not: boolean }
  | { k: "in"; e: Expr; list?: Expr[]; sub?: Query; not: boolean }
  | { k: "between"; e: Expr; lo: Expr; hi: Expr; not: boolean }
  | { k: "like"; e: Expr; pat: Expr; not: boolean; ci: boolean }
  | { k: "case"; base?: Expr; whens: [Expr, Expr][]; else?: Expr }
  | { k: "cast"; e: Expr; to: string; scale?: number; safe: boolean }
  | { k: "fn"; name: string; args: Expr[]; distinct?: boolean; star?: boolean; over?: WindowSpec }
  | { k: "sub"; q: Query };

export interface WindowSpec { partition: Expr[]; order: OrderItem[] }
export interface OrderItem { e: Expr; desc: boolean; nullsFirst?: boolean }
interface SelectItem { e: Expr; alias?: string }
type JoinType = "inner" | "left" | "right" | "full" | "cross";
type FromItem =
  | { k: "table"; name: string; alias?: string }
  | { k: "subq"; q: Query; alias: string }
  | { k: "join"; type: JoinType; l: FromItem; r: FromItem; on?: Expr };
interface Select {
  k: "select"; distinct: boolean; items: SelectItem[]; from?: FromItem; where?: Expr; groupBy?: Expr[]; having?: Expr;
}
type SetExpr = Select | { k: "union"; all: boolean; l: SetExpr; r: SetExpr };
export interface Query { with: { name: string; q: Query }[]; body: SetExpr; order: OrderItem[]; limit?: number; offset?: number }

export type Statement =
  | { k: "query"; q: Query }
  | { k: "createTable"; name: string; replace: boolean; ifNotExists: boolean; q: Query }
  | { k: "createView"; name: string; replace: boolean; q: Query }
  | { k: "drop"; what: "table" | "view"; name: string; ifExists: boolean }
  | { k: "show" }
  | { k: "describe"; name: string }
  | { k: "explain"; s: Statement };

const RESERVED = new Set([
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "HAVING", "ORDER", "LIMIT", "OFFSET", "JOIN", "INNER", "LEFT", "RIGHT", "FULL",
  "OUTER", "CROSS", "ON", "AS", "AND", "OR", "NOT", "IN", "IS", "NULL", "BETWEEN", "LIKE", "ILIKE", "CASE", "WHEN", "THEN",
  "ELSE", "END", "UNION", "ALL", "DISTINCT", "WITH", "ASC", "DESC", "NULLS", "OVER", "PARTITION", "TRUE", "FALSE", "USING",
]);

/** Funções de agregação (sem OVER, resumem um grupo de linhas). */
const AGGREGATES = new Set([
  "COUNT", "SUM", "AVG", "MEAN", "MIN", "MAX", "MEDIAN", "STDDEV", "STDDEV_SAMP", "VARIANCE", "VAR_SAMP", "COUNT_IF",
  "ANY_VALUE", "FIRST", "APPROX_COUNT_DISTINCT",
]);
/** Funções que só existem com OVER. */
const WINDOW_ONLY = new Set(["ROW_NUMBER", "RANK", "DENSE_RANK", "NTILE", "LAG", "LEAD", "FIRST_VALUE", "LAST_VALUE", "PERCENT_RANK"]);

class Parser {
  private i = 0;
  constructor(private t: Tok[]) {}

  private peek(o = 0) { return this.t[Math.min(this.i + o, this.t.length - 1)]; }
  private isKw(w: string, o = 0) {
    const t = this.peek(o);
    return t.k === "id" && t.v.toUpperCase() === w;
  }
  private acceptKw(...ws: string[]) {
    if (ws.every((w, j) => this.isKw(w, j))) {
      this.i += ws.length;
      return true;
    }
    return false;
  }
  private expectKw(w: string) {
    if (!this.acceptKw(w)) this.fail(`Esperava ${w}`);
  }
  private isOp(v: string, o = 0) {
    const t = this.peek(o);
    return t.k === "op" && t.v === v;
  }
  private acceptOp(v: string) {
    if (this.isOp(v)) {
      this.i++;
      return true;
    }
    return false;
  }
  private expectOp(v: string) {
    if (!this.acceptOp(v)) this.fail(`Esperava "${v}"`);
  }
  private fail(msg: string): never {
    const t = this.peek();
    throw new SqlError(`${msg} ${t.k === "eof" ? "no fim do comando" : `perto de "${t.v}"`}`, t.pos);
  }
  private canIdent(o = 0) {
    const t = this.peek(o);
    return t.k === "qid" || (t.k === "id" && !RESERVED.has(t.v.toUpperCase()));
  }
  private ident(what = "um nome"): string {
    if (!this.canIdent()) this.fail(`Esperava ${what}`);
    return this.t[this.i++].v;
  }
  /** catálogo.esquema.tabela → tabela (o catálogo ainda é um só). */
  private tableName(): string {
    let n = this.ident("o nome da tabela");
    while (this.acceptOp(".")) n = this.ident("o nome da tabela");
    return n;
  }

  /** Vários comandos separados por ";", com o trecho de texto de cada um. */
  script(src: string): { s: Statement; text: string }[] {
    const out: { s: Statement; text: string }[] = [];
    while (this.peek().k !== "eof") {
      if (this.acceptOp(";")) continue;
      const start = this.peek().pos;
      const s = this.statement();
      const end = this.peek().pos;
      if (!this.isOp(";") && this.peek().k !== "eof") this.fail("Esperava \";\" ou o fim do comando");
      out.push({ s, text: src.slice(start, end).trim() });
    }
    return out;
  }

  private statement(): Statement {
    if (this.acceptKw("EXPLAIN")) {
      this.acceptKw("ANALYZE") || this.acceptKw("EXTENDED") || this.acceptKw("FORMATTED");
      return { k: "explain", s: this.statement() };
    }
    if (this.acceptKw("CREATE")) {
      const replace = this.acceptKw("OR", "REPLACE");
      const temp = this.acceptKw("TEMPORARY") || this.acceptKw("TEMP");
      if (this.acceptKw("VIEW")) {
        const name = this.tableName();
        this.expectKw("AS");
        return { k: "createView", name, replace, q: this.query() };
      }
      if (temp) this.fail("Esperava VIEW (só visões podem ser temporárias)");
      this.expectKw("TABLE");
      const ifNotExists = this.acceptKw("IF", "NOT", "EXISTS");
      const name = this.tableName();
      // "USING DELTA": aqui toda tabela é do mesmo tipo.
      if (this.acceptKw("USING")) this.ident("o formato");
      this.expectKw("AS");
      return { k: "createTable", name, replace, ifNotExists, q: this.query() };
    }
    if (this.acceptKw("DROP")) {
      const what = this.acceptKw("VIEW") ? "view" : (this.expectKw("TABLE"), "table");
      const ifExists = this.acceptKw("IF", "EXISTS");
      return { k: "drop", what, name: this.tableName(), ifExists };
    }
    if (this.acceptKw("SHOW")) {
      this.expectKw("TABLES");
      return { k: "show" };
    }
    if (this.acceptKw("DESCRIBE") || this.acceptKw("DESC")) {
      this.acceptKw("TABLE");
      return { k: "describe", name: this.tableName() };
    }
    if (this.isKw("SELECT") || this.isKw("WITH") || this.isOp("(")) return { k: "query", q: this.query() };
    this.fail("Comando desconhecido: esperava SELECT, WITH, CREATE, DROP, SHOW, DESCRIBE ou EXPLAIN");
  }

  query(): Query {
    const w: Query["with"] = [];
    if (this.acceptKw("WITH")) {
      do {
        const name = this.ident("o nome da CTE");
        this.expectKw("AS");
        this.expectOp("(");
        const q = this.query();
        this.expectOp(")");
        w.push({ name, q });
      } while (this.acceptOp(","));
    }
    let body: SetExpr = this.setTerm();
    while (this.acceptKw("UNION")) {
      const all = this.acceptKw("ALL");
      if (!all) this.acceptKw("DISTINCT");
      body = { k: "union", all, l: body, r: this.setTerm() };
    }
    const order = this.acceptKw("ORDER", "BY") ? this.orderList() : [];
    let limit: number | undefined;
    let offset: number | undefined;
    if (this.acceptKw("LIMIT")) limit = this.intLit("LIMIT");
    if (this.acceptKw("OFFSET")) offset = this.intLit("OFFSET");
    return { with: w, body, order, limit, offset };
  }

  private intLit(what: string) {
    const t = this.peek();
    if (t.k !== "num" || !/^\d+$/.test(t.v)) this.fail(`${what} precisa de um número inteiro`);
    this.i++;
    return Number(t.v);
  }

  private setTerm(): SetExpr {
    if (this.isOp("(")) {
      this.i++;
      const q = this.query();
      this.expectOp(")");
      return { k: "select", distinct: false, items: [{ e: { k: "star" } }], from: { k: "subq", q, alias: "__u" } };
    }
    return this.select();
  }

  private select(): Select {
    this.expectKw("SELECT");
    const distinct = this.acceptKw("DISTINCT");
    if (!distinct) this.acceptKw("ALL");
    const items: SelectItem[] = [];
    do {
      if (this.acceptOp("*")) {
        items.push({ e: { k: "star" } });
        continue;
      }
      if (this.canIdent() && this.isOp(".", 1) && this.isOp("*", 2)) {
        const table = this.ident();
        this.i += 2;
        items.push({ e: { k: "star", table } });
        continue;
      }
      const e = this.expr();
      const alias = this.acceptKw("AS") ? this.ident("o apelido") : this.canIdent() ? this.ident() : undefined;
      items.push({ e, alias });
    } while (this.acceptOp(","));
    const s: Select = { k: "select", distinct, items };
    if (this.acceptKw("FROM")) s.from = this.fromClause();
    if (this.acceptKw("WHERE")) s.where = this.expr();
    if (this.acceptKw("GROUP", "BY")) {
      s.groupBy = [];
      do s.groupBy.push(this.expr()); while (this.acceptOp(","));
    }
    if (this.acceptKw("HAVING")) s.having = this.expr();
    return s;
  }

  private fromClause(): FromItem {
    let left = this.fromPrimary();
    for (;;) {
      let type: JoinType;
      if (this.acceptOp(",") || this.acceptKw("CROSS", "JOIN")) type = "cross";
      else if (this.acceptKw("JOIN") || this.acceptKw("INNER", "JOIN")) type = "inner";
      else if (this.acceptKw("LEFT")) { this.acceptKw("OUTER"); this.expectKw("JOIN"); type = "left"; }
      else if (this.acceptKw("RIGHT")) { this.acceptKw("OUTER"); this.expectKw("JOIN"); type = "right"; }
      else if (this.acceptKw("FULL")) { this.acceptKw("OUTER"); this.expectKw("JOIN"); type = "full"; }
      else break;
      const r = this.fromPrimary();
      let on: Expr | undefined;
      if (type !== "cross") {
        this.expectKw("ON");
        on = this.expr();
      }
      left = { k: "join", type, l: left, r, on };
    }
    return left;
  }

  private fromPrimary(): FromItem {
    if (this.acceptOp("(")) {
      const q = this.query();
      this.expectOp(")");
      this.acceptKw("AS");
      return { k: "subq", q, alias: this.ident("um apelido para a subconsulta, ex.: (SELECT …) AS t") };
    }
    const name = this.tableName();
    const alias = this.acceptKw("AS") ? this.ident("o apelido") : this.canIdent() ? this.ident() : undefined;
    return { k: "table", name, alias };
  }

  private orderList(): OrderItem[] {
    const out: OrderItem[] = [];
    do {
      const e = this.expr();
      const desc = this.acceptKw("DESC") ? true : (this.acceptKw("ASC"), false);
      let nullsFirst: boolean | undefined;
      if (this.acceptKw("NULLS")) nullsFirst = this.acceptKw("FIRST") ? true : (this.expectKw("LAST"), false);
      out.push({ e, desc, nullsFirst });
    } while (this.acceptOp(","));
    return out;
  }

  // Precedência: OR < AND < NOT < comparações < || < + - < * / % < unário.
  expr(): Expr {
    let l = this.and();
    while (this.acceptKw("OR")) l = { k: "bin", op: "OR", l, r: this.and() };
    return l;
  }
  private and(): Expr {
    let l = this.not();
    while (this.acceptKw("AND")) l = { k: "bin", op: "AND", l, r: this.not() };
    return l;
  }
  private not(): Expr {
    if (this.acceptKw("NOT")) return { k: "un", op: "NOT", e: this.not() };
    return this.predicate();
  }
  private predicate(): Expr {
    let l = this.concat();
    for (;;) {
      const t = this.peek();
      if (t.k === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(t.v)) {
        this.i++;
        l = { k: "bin", op: t.v, l, r: this.concat() };
        continue;
      }
      if (this.acceptKw("IS")) {
        const not = this.acceptKw("NOT");
        this.expectKw("NULL");
        l = { k: "isnull", e: l, not };
        continue;
      }
      const not = this.isKw("NOT") && ["IN", "BETWEEN", "LIKE", "ILIKE"].some((w) => this.isKw(w, 1));
      if (not) this.i++;
      if (this.acceptKw("IN")) {
        this.expectOp("(");
        if (this.isKw("SELECT") || this.isKw("WITH")) {
          const sub = this.query();
          this.expectOp(")");
          l = { k: "in", e: l, sub, not };
        } else {
          const list: Expr[] = [];
          do list.push(this.expr()); while (this.acceptOp(","));
          this.expectOp(")");
          l = { k: "in", e: l, list, not };
        }
        continue;
      }
      if (this.acceptKw("BETWEEN")) {
        const lo = this.concat();
        this.expectKw("AND");
        l = { k: "between", e: l, lo, hi: this.concat(), not };
        continue;
      }
      const ci = this.isKw("ILIKE");
      if (this.acceptKw("LIKE") || this.acceptKw("ILIKE")) {
        l = { k: "like", e: l, pat: this.concat(), not, ci };
        continue;
      }
      if (not) this.fail("Esperava IN, BETWEEN ou LIKE depois de NOT");
      return l;
    }
  }
  private concat(): Expr {
    let l = this.additive();
    while (this.acceptOp("||")) l = { k: "bin", op: "||", l, r: this.additive() };
    return l;
  }
  private additive(): Expr {
    let l = this.term();
    for (;;) {
      if (this.acceptOp("+")) l = { k: "bin", op: "+", l, r: this.term() };
      else if (this.acceptOp("-")) l = { k: "bin", op: "-", l, r: this.term() };
      else return l;
    }
  }
  private term(): Expr {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.k === "op" && (t.v === "*" || t.v === "/" || t.v === "%")) {
        this.i++;
        l = { k: "bin", op: t.v, l, r: this.unary() };
      } else return l;
    }
  }
  private unary(): Expr {
    if (this.acceptOp("-")) {
      const e = this.unary();
      return e.k === "lit" && typeof e.v === "number" ? { k: "lit", v: -e.v } : { k: "un", op: "-", e };
    }
    if (this.acceptOp("+")) return this.unary();
    return this.primary();
  }

  private primary(): Expr {
    const t = this.peek();
    if (t.k === "num") {
      this.i++;
      return { k: "lit", v: Number(t.v) };
    }
    if (t.k === "str") {
      this.i++;
      return { k: "lit", v: t.v };
    }
    if (t.k === "op" && t.v === "(") {
      this.i++;
      if (this.isKw("SELECT") || this.isKw("WITH")) {
        const q = this.query();
        this.expectOp(")");
        return { k: "sub", q };
      }
      const e = this.expr();
      this.expectOp(")");
      return e;
    }
    if (t.k === "qid") {
      this.i++;
      return this.columnRest(t.v);
    }
    if (t.k !== "id") this.fail("Esperava uma expressão");
    const up = t.v.toUpperCase();
    if (up === "NULL") { this.i++; return { k: "lit", v: null }; }
    if (up === "TRUE" || up === "FALSE") { this.i++; return { k: "lit", v: up === "TRUE" }; }
    if (up === "CASE") { this.i++; return this.caseExpr(); }
    if ((up === "CAST" || up === "TRY_CAST") && this.isOp("(", 1)) {
      this.i += 2;
      const e = this.expr();
      this.expectKw("AS");
      const to = this.ident("o tipo").toUpperCase();
      let scale: number | undefined;
      if (this.acceptOp("(")) {
        this.intLit("precisão");
        if (this.acceptOp(",")) scale = this.intLit("escala");
        this.expectOp(")");
      }
      this.expectOp(")");
      return { k: "cast", e, to, scale, safe: up === "TRY_CAST" };
    }
    // DATE '2026-01-31'
    if (up === "DATE" && this.peek(1).k === "str") {
      this.i += 2;
      return { k: "cast", e: { k: "lit", v: this.t[this.i - 1].v }, to: "DATE", safe: false };
    }
    if ((up === "CURRENT_DATE" || up === "CURRENT_TIMESTAMP") && !this.isOp("(", 1)) {
      this.i++;
      return { k: "fn", name: up, args: [] };
    }
    if (RESERVED.has(up)) this.fail("Esperava uma expressão");
    this.i++;
    if (this.isOp("(")) return this.call(up);
    return this.columnRest(t.v);
  }

  private columnRest(first: string): Expr {
    if (this.acceptOp(".")) return { k: "col", table: first, name: this.ident("o nome da coluna") };
    return { k: "col", name: first };
  }

  private call(name: string): Expr {
    this.expectOp("(");
    const fn: Extract<Expr, { k: "fn" }> = { k: "fn", name, args: [] };
    if (this.acceptOp("*")) fn.star = true;
    else if (!this.isOp(")")) {
      fn.distinct = this.acceptKw("DISTINCT");
      do fn.args.push(this.expr()); while (this.acceptOp(","));
    }
    this.expectOp(")");
    if (this.acceptKw("OVER")) {
      this.expectOp("(");
      const spec: WindowSpec = { partition: [], order: [] };
      if (this.acceptKw("PARTITION", "BY")) {
        do spec.partition.push(this.expr()); while (this.acceptOp(","));
      }
      if (this.acceptKw("ORDER", "BY")) spec.order = this.orderList();
      if (this.isKw("ROWS") || this.isKw("RANGE")) this.fail("Molduras (ROWS/RANGE BETWEEN) ainda não são suportadas");
      this.expectOp(")");
      fn.over = spec;
    } else if (WINDOW_ONLY.has(name)) {
      this.fail(`${name}() precisa de OVER (…)`);
    }
    return fn;
  }

  private caseExpr(): Expr {
    const base = this.isKw("WHEN") ? undefined : this.expr();
    const whens: [Expr, Expr][] = [];
    while (this.acceptKw("WHEN")) {
      const w = this.expr();
      this.expectKw("THEN");
      whens.push([w, this.expr()]);
    }
    if (!whens.length) this.fail("CASE precisa de ao menos um WHEN");
    const otherwise = this.acceptKw("ELSE") ? this.expr() : undefined;
    this.expectKw("END");
    return { k: "case", base, whens, else: otherwise };
  }
}

export function parseScript(src: string) {
  return new Parser(tokenize(src)).script(src);
}

// ---------------- Valores ----------------

/** Valor durante a execução: os de tabela mais verdadeiro/falso. */
type SV = Value | boolean;

interface ColInfo { name: string; table?: string; type?: ColumnType }
interface Rel { cols: ColInfo[]; rows: SV[][] }

export interface PlanNode { op: string; detail?: string; rows: number; ms: number; children: PlanNode[] }

const collator = new Intl.Collator("pt-BR", { numeric: true });
const lower = (s: string) => s.toLocaleLowerCase("pt-BR");

function toNum(v: SV, what = "valor"): number | null {
  if (v === null) return null;
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  const t = v.trim();
  if (t !== "" && !Number.isNaN(Number(t))) return Number(t);
  throw new SqlError(`"${v}" não é um número (${what}); use TRY_CAST para virar NULL`);
}

function toStr(v: SV): string | null {
  if (v === null) return null;
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Comparação de ordem; null só aparece aqui em ORDER BY (tratado antes). */
function cmp(a: SV, b: SV): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" || typeof b === "boolean") return Number(a) - Number(b);
  if (typeof a === "number" || typeof b === "number") {
    const na = Number(a);
    const nb = Number(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  }
  return collator.compare(String(a), String(b));
}

function eq(a: SV, b: SV): boolean | null {
  if (a === null || b === null) return null;
  return cmp(a, b) === 0;
}

/** Chave para hash join, GROUP BY e DISTINCT: 1 e "1" caem no mesmo balde. */
const hashKey = (v: SV) => (v === null ? "\u0000" : String(v));

const isTrue = (v: SV) => v === true || (typeof v === "number" && v !== 0);

function toDate(v: SV): string | null {
  if (v === null) return null;
  const s = String(v).trim();
  if (isIsoDate(s)) return s;
  const m = /^(\d{4}-\d{2}-\d{2})[ T]/.exec(s);
  if (m) return m[1];
  return null;
}

function dateArg(v: SV, fn: string): string | null {
  if (v === null) return null;
  const d = toDate(v);
  if (!d) throw new SqlError(`${fn}: "${v}" não é uma data (AAAA-MM-DD)`);
  return d;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86_400_000);

function castTo(v: SV, to: string, scale?: number): SV {
  if (v === null) return null;
  switch (to) {
    case "INT": case "INTEGER": case "BIGINT": case "SMALLINT": case "TINYINT": case "LONG": {
      const n = toNum(v, "CAST");
      return n === null ? null : Math.trunc(n);
    }
    case "DOUBLE": case "FLOAT": case "REAL": case "NUMERIC":
      return toNum(v, "CAST");
    case "DECIMAL": case "DEC": {
      const n = toNum(v, "CAST");
      return n === null ? null : roundHalfUp(n, scale ?? 0);
    }
    case "STRING": case "VARCHAR": case "CHAR": case "TEXT":
      return toStr(v);
    case "DATE": {
      const d = toDate(v);
      if (!d) throw new SqlError(`"${v}" não é uma data (AAAA-MM-DD)`);
      return d;
    }
    case "BOOLEAN": case "BOOL": {
      if (typeof v === "boolean") return v;
      if (typeof v === "number") return v !== 0;
      const s = v.trim().toLowerCase();
      if (s === "true" || s === "false") return s === "true";
      throw new SqlError(`"${v}" não é verdadeiro/falso`);
    }
  }
  throw new SqlError(`Tipo desconhecido em CAST: ${to}`);
}

function roundHalfUp(n: number, d: number) {
  const f = 10 ** d;
  return (Math.sign(n) * Math.round(Math.abs(n) * f + 1e-9)) / f;
}

function likeRegex(pat: string, ci: boolean) {
  const re = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".");
  return new RegExp(`^${re}$`, ci ? "is" : "s");
}

function formatDate(iso: string, fmt: string) {
  return fmt
    .replace(/yyyy/g, iso.slice(0, 4))
    .replace(/yy/g, iso.slice(2, 4))
    .replace(/MM/g, iso.slice(5, 7))
    .replace(/dd/g, iso.slice(8, 10));
}

function dateTrunc(unit: string, iso: string) {
  const y = iso.slice(0, 4);
  const m = Number(iso.slice(5, 7));
  switch (unit.toUpperCase()) {
    case "YEAR": case "YYYY": case "YY": return `${y}-01-01`;
    case "QUARTER": return `${y}-${String(Math.floor((m - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
    case "MONTH": case "MM": case "MON": return `${iso.slice(0, 7)}-01`;
    case "WEEK": {
      // Semana começando na segunda-feira, como no Spark.
      const dow = (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
      return shiftDate(iso, -dow, "DAY");
    }
    case "DAY": case "DD": return iso;
  }
  throw new SqlError(`Unidade de data desconhecida: ${unit}`);
}

// ---------------- Funções escalares ----------------

type Scalar = (args: SV[]) => SV;
const str1 = (f: (s: string) => SV): Scalar => ([a]) => (a === null ? null : f(toStr(a)!));
const num1 = (f: (n: number) => number): Scalar => ([a]) => {
  const n = toNum(a);
  return n === null ? null : f(n);
};
const date1 = (name: string, f: (d: string) => SV): Scalar => ([a]) => {
  const d = dateArg(a, name);
  return d === null ? null : f(d);
};

const SCALARS: Record<string, Scalar> = {
  UPPER: str1((s) => s.toLocaleUpperCase("pt-BR")),
  UCASE: str1((s) => s.toLocaleUpperCase("pt-BR")),
  LOWER: str1((s) => s.toLocaleLowerCase("pt-BR")),
  LCASE: str1((s) => s.toLocaleLowerCase("pt-BR")),
  INITCAP: str1((s) => s.toLocaleLowerCase("pt-BR").replace(/(^|\s)(\p{L})/gu, (_, a, b) => a + b.toLocaleUpperCase("pt-BR"))),
  LENGTH: str1((s) => [...s].length),
  CHAR_LENGTH: str1((s) => [...s].length),
  TRIM: str1((s) => s.trim()),
  LTRIM: str1((s) => s.trimStart()),
  RTRIM: str1((s) => s.trimEnd()),
  REVERSE: str1((s) => [...s].reverse().join("")),
  CONCAT: (args) => (args.some((a) => a === null) ? null : args.map(toStr).join("")),
  CONCAT_WS: ([sep, ...rest]) => (sep === null ? null : rest.filter((a) => a !== null).map(toStr).join(toStr(sep)!)),
  SUBSTRING: ([s, pos, len]) => {
    if (s === null || pos === null) return null;
    const chars = [...toStr(s)!];
    let p = toNum(pos)!;
    p = p > 0 ? p - 1 : p < 0 ? chars.length + p : 0;
    const n = len === undefined || len === null ? chars.length : toNum(len)!;
    return chars.slice(p, p + Math.max(0, n)).join("");
  },
  LEFT: ([s, n]) => (s === null || n === null ? null : [...toStr(s)!].slice(0, toNum(n)!).join("")),
  RIGHT: ([s, n]) => (s === null || n === null ? null : toNum(n)! <= 0 ? "" : [...toStr(s)!].slice(-toNum(n)!).join("")),
  REPLACE: ([s, a, b]) => (s === null || a === null ? null : toStr(s)!.split(toStr(a)!).join(b === undefined || b === null ? "" : toStr(b)!)),
  LPAD: ([s, n, p]) => (s === null || n === null ? null : toStr(s)!.padStart(toNum(n)!, p === undefined || p === null ? " " : toStr(p)!).slice(0, toNum(n)!)),
  RPAD: ([s, n, p]) => (s === null || n === null ? null : toStr(s)!.padEnd(toNum(n)!, p === undefined || p === null ? " " : toStr(p)!).slice(0, toNum(n)!)),
  INSTR: ([s, sub]) => (s === null || sub === null ? null : toStr(s)!.indexOf(toStr(sub)!) + 1),
  SPLIT_PART: ([s, d, n]) => (s === null || d === null || n === null ? null : toStr(s)!.split(toStr(d)!)[toNum(n)! - 1] ?? ""),
  COALESCE: (args) => args.find((a) => a !== null) ?? null,
  IFNULL: ([a, b]) => (a === null ? b : a),
  NVL: ([a, b]) => (a === null ? b : a),
  NULLIF: ([a, b]) => (eq(a, b) === true ? null : a),
  GREATEST: (args) => args.filter((a) => a !== null).reduce<SV>((m, a) => (m === null || cmp(a, m) > 0 ? a : m), null),
  LEAST: (args) => args.filter((a) => a !== null).reduce<SV>((m, a) => (m === null || cmp(a, m) < 0 ? a : m), null),
  ROUND: ([a, d]) => {
    const n = toNum(a);
    return n === null ? null : roundHalfUp(n, d === undefined ? 0 : toNum(d) ?? 0);
  },
  FLOOR: num1(Math.floor),
  CEIL: num1(Math.ceil),
  CEILING: num1(Math.ceil),
  ABS: num1(Math.abs),
  SIGN: num1(Math.sign),
  SQRT: num1(Math.sqrt),
  EXP: num1(Math.exp),
  LN: num1(Math.log),
  LOG10: num1(Math.log10),
  POWER: ([a, b]) => (a === null || b === null ? null : toNum(a)! ** toNum(b)!),
  POW: ([a, b]) => (a === null || b === null ? null : toNum(a)! ** toNum(b)!),
  MOD: ([a, b]) => (a === null || b === null || toNum(b) === 0 ? null : toNum(a)! % toNum(b)!),
  TRY_DIVIDE: ([a, b]) => (a === null || b === null || toNum(b) === 0 ? null : toNum(a)! / toNum(b)!),
  YEAR: date1("YEAR", (d) => Number(d.slice(0, 4))),
  MONTH: date1("MONTH", (d) => Number(d.slice(5, 7))),
  DAY: date1("DAY", (d) => Number(d.slice(8, 10))),
  DAYOFMONTH: date1("DAYOFMONTH", (d) => Number(d.slice(8, 10))),
  QUARTER: date1("QUARTER", (d) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1),
  // 1 = domingo … 7 = sábado, como no Spark.
  DAYOFWEEK: date1("DAYOFWEEK", (d) => new Date(`${d}T00:00:00Z`).getUTCDay() + 1),
  LAST_DAY: date1("LAST_DAY", (d) => shiftDate(shiftDate(`${d.slice(0, 7)}-01`, 1, "MONTH"), -1, "DAY")),
  TO_DATE: ([a]) => (a === null ? null : toDate(a)),
  DATE_TRUNC: ([u, d]) => (u === null || d === null ? null : dateTrunc(toStr(u)!, dateArg(d, "DATE_TRUNC")!)),
  TRUNC: ([d, u]) => (u === null || d === null ? null : dateTrunc(toStr(u)!, dateArg(d, "TRUNC")!)),
  DATE_FORMAT: ([d, f]) => (d === null || f === null ? null : formatDate(dateArg(d, "DATE_FORMAT")!, toStr(f)!)),
  DATE_ADD: ([d, n]) => (d === null || n === null ? null : shiftDate(dateArg(d, "DATE_ADD")!, toNum(n)!, "DAY")),
  DATE_SUB: ([d, n]) => (d === null || n === null ? null : shiftDate(dateArg(d, "DATE_SUB")!, -toNum(n)!, "DAY")),
  ADD_MONTHS: ([d, n]) => (d === null || n === null ? null : shiftDate(dateArg(d, "ADD_MONTHS")!, toNum(n)!, "MONTH")),
  DATEDIFF: ([a, b]) => (a === null || b === null ? null : daysBetween(dateArg(a, "DATEDIFF")!, dateArg(b, "DATEDIFF")!)),
  CURRENT_DATE: () => todayIso(),
  CURRENT_TIMESTAMP: () => new Date().toISOString().replace("T", " ").slice(0, 19),
};

// ---------------- Agregações ----------------

interface Acc { add(v: SV): void; result(): SV }

function accumulator(name: string, distinct: boolean): Acc {
  const seen = new Set<string>();
  let n = 0;
  let sum = 0;
  let best: SV = null;
  const values: number[] = [];
  let first: SV = null;
  return {
    add(v) {
      if (v === null) return;
      if (distinct) {
        const k = hashKey(v);
        if (seen.has(k)) return;
        seen.add(k);
      }
      switch (name) {
        case "COUNT": case "APPROX_COUNT_DISTINCT": n++; break;
        case "COUNT_IF": if (isTrue(v)) n++; break;
        case "SUM": case "AVG": case "MEAN": sum += toNum(v, name)!; n++; break;
        case "MIN": if (best === null || cmp(v, best) < 0) best = v; break;
        case "MAX": if (best === null || cmp(v, best) > 0) best = v; break;
        case "MEDIAN": case "STDDEV": case "STDDEV_SAMP": case "VARIANCE": case "VAR_SAMP": values.push(toNum(v, name)!); break;
        case "ANY_VALUE": case "FIRST": if (n++ === 0) first = v; break;
      }
    },
    result() {
      switch (name) {
        case "COUNT": case "COUNT_IF": case "APPROX_COUNT_DISTINCT": return n;
        case "SUM": return n ? sum : null;
        case "AVG": case "MEAN": return n ? sum / n : null;
        case "MIN": case "MAX": return best;
        case "MEDIAN": {
          if (!values.length) return null;
          const s = [...values].sort((a, b) => a - b);
          const mid = s.length / 2;
          return s.length % 2 ? s[Math.floor(mid)] : (s[mid - 1] + s[mid]) / 2;
        }
        case "STDDEV": case "STDDEV_SAMP": case "VARIANCE": case "VAR_SAMP": {
          if (values.length < 2) return null;
          const mean = values.reduce((a, b) => a + b, 0) / values.length;
          const v = values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1);
          return name.startsWith("VAR") ? v : Math.sqrt(v);
        }
        case "ANY_VALUE": case "FIRST": return first;
      }
      return null;
    },
  };
}

// ---------------- Texto das expressões (nomes de colunas e planos) ----------------

export function exprText(e: Expr): string {
  const wrap = (x: Expr, op: string) => (x.k === "bin" && x.op !== op ? `(${exprText(x)})` : exprText(x));
  switch (e.k) {
    case "lit": return e.v === null ? "NULL" : typeof e.v === "string" ? `'${e.v.replace(/'/g, "''")}'` : String(e.v);
    case "col": return e.table ? `${e.table}.${e.name}` : e.name;
    case "star": return e.table ? `${e.table}.*` : "*";
    case "bin": return `${wrap(e.l, e.op)} ${e.op} ${wrap(e.r, e.op)}`;
    case "un": return e.op === "NOT" ? `NOT ${exprText(e.e)}` : `-${exprText(e.e)}`;
    case "isnull": return `${exprText(e.e)} IS ${e.not ? "NOT " : ""}NULL`;
    case "in": return `${exprText(e.e)} ${e.not ? "NOT " : ""}IN (${e.list ? e.list.map(exprText).join(", ") : "subconsulta"})`;
    case "between": return `${exprText(e.e)} ${e.not ? "NOT " : ""}BETWEEN ${exprText(e.lo)} AND ${exprText(e.hi)}`;
    case "like": return `${exprText(e.e)} ${e.not ? "NOT " : ""}${e.ci ? "ILIKE" : "LIKE"} ${exprText(e.pat)}`;
    case "case": return "CASE … END";
    case "cast": return `CAST(${exprText(e.e)} AS ${e.to})`;
    case "sub": return "(subconsulta)";
    case "fn": {
      const args = e.star ? "*" : `${e.distinct ? "DISTINCT " : ""}${e.args.map(exprText).join(", ")}`;
      let s = `${e.name.toLowerCase()}(${args})`;
      if (e.over) {
        const parts = [];
        if (e.over.partition.length) parts.push(`PARTITION BY ${e.over.partition.map(exprText).join(", ")}`);
        if (e.over.order.length) parts.push(`ORDER BY ${e.over.order.map((o) => exprText(o.e) + (o.desc ? " DESC" : "")).join(", ")}`);
        s += ` OVER (${parts.join(" ")})`;
      }
      return s;
    }
  }
}

// ---------------- Resolução de nomes ----------------

function findCol(cols: ColInfo[], table: string | undefined, name: string): number | "ambiguous" | -1 {
  const n = lower(name);
  const t = table ? lower(table) : undefined;
  let found = -1;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (lower(c.name) !== n) continue;
    if (t !== undefined && (c.table === undefined || lower(c.table) !== t)) continue;
    if (found >= 0) return "ambiguous";
    found = i;
  }
  return found;
}

function resolveCol(cols: ColInfo[], e: { table?: string; name: string }): number {
  const i = findCol(cols, e.table, e.name);
  const label = e.table ? `${e.table}.${e.name}` : e.name;
  if (i === "ambiguous") throw new SqlError(`A coluna "${label}" é ambígua: existe em mais de uma tabela. Use apelido.coluna`);
  if (i < 0) {
    const similar = cols.filter((c) => lower(c.name).includes(lower(e.name).slice(0, 3))).slice(0, 4)
      .map((c) => (c.table ? `${c.table}.${c.name}` : c.name));
    throw new SqlError(`Coluna "${label}" não encontrada${similar.length ? `. Você quis dizer: ${similar.join(", ")}?` : ""}`);
  }
  return i;
}

/** Visita a expressão sem entrar em subconsultas (que têm escopo próprio). */
function walk(e: Expr, f: (x: Expr) => boolean | void) {
  if (f(e) === false) return;
  switch (e.k) {
    case "bin": walk(e.l, f); walk(e.r, f); break;
    case "un": case "isnull": case "cast": walk(e.e, f); break;
    case "in": walk(e.e, f); e.list?.forEach((x) => walk(x, f)); break;
    case "between": walk(e.e, f); walk(e.lo, f); walk(e.hi, f); break;
    case "like": walk(e.e, f); walk(e.pat, f); break;
    case "case":
      if (e.base) walk(e.base, f);
      e.whens.forEach(([a, b]) => { walk(a, f); walk(b, f); });
      if (e.else) walk(e.else, f);
      break;
    case "fn":
      e.args.forEach((x) => walk(x, f));
      e.over?.partition.forEach((x) => walk(x, f));
      e.over?.order.forEach((o) => walk(o.e, f));
      break;
  }
}

const isAggCall = (e: Expr) => e.k === "fn" && !e.over && AGGREGATES.has(e.name);

function hasAggregate(e: Expr): boolean {
  let found = false;
  walk(e, (x) => {
    if (isAggCall(x)) found = true;
    return !found;
  });
  return found;
}

function windowCalls(e: Expr, out: Extract<Expr, { k: "fn" }>[]) {
  walk(e, (x) => {
    if (x.k === "fn" && x.over) {
      out.push(x);
      return false;
    }
  });
}

function colRefs(e: Expr): { table?: string; name: string }[] {
  const out: { table?: string; name: string }[] = [];
  walk(e, (x) => {
    if (x.k === "col") out.push(x);
    if (x.k === "sub" || (x.k === "in" && x.sub)) return;
  });
  return out;
}

function conjuncts(e: Expr | undefined): Expr[] {
  if (!e) return [];
  if (e.k === "bin" && e.op === "AND") return [...conjuncts(e.l), ...conjuncts(e.r)];
  return [e];
}

const andAll = (es: Expr[]): Expr | undefined =>
  es.reduce<Expr | undefined>((a, b) => (a ? { k: "bin", op: "AND", l: a, r: b } : b), undefined);

// ---------------- Avaliação ----------------

interface Env {
  session: Session;
  ctes: Map<string, Rel>;
  subCache: Map<Query, Rel>;
}

interface Ctx {
  cols: ColInfo[];
  row: SV[];
  env: Env;
  /** Modo agrupado: as linhas do grupo e os valores das expressões do GROUP BY. */
  group?: SV[][];
  groupKeys?: Map<string, SV>;
  keyOf?: (e: Expr) => string;
  /** Agregações já calculadas para este grupo (por expressão normalizada). */
  aggs?: Map<string, SV>;
  /** Resultados já calculados das funções de janela desta linha. */
  win?: Map<Expr, SV>;
}

function subquery(q: Query, env: Env): Rel {
  let r = env.subCache.get(q);
  if (!r) {
    r = execQuery(q, env).rel;
    env.subCache.set(q, r);
  }
  return r;
}

/** Posição já resolvida de cada referência de coluna (o nome é procurado uma vez, não por linha). */
const colCache = new WeakMap<Expr, { cols: ColInfo[]; i: number }>();

function evaluate(e: Expr, ctx: Ctx): SV {
  if (ctx.win && e.k === "fn" && e.over) {
    const v = ctx.win.get(e);
    if (v !== undefined) return v;
  }
  if (ctx.groupKeys && e.k !== "lit") {
    const key = ctx.keyOf!(e);
    if (ctx.groupKeys.has(key)) return ctx.groupKeys.get(key)!;
    const agg = ctx.aggs?.get(key);
    if (agg !== undefined) return agg;
  }
  switch (e.k) {
    case "lit": return e.v;
    case "col": {
      if (ctx.group) {
        throw new SqlError(`A coluna "${exprText(e)}" precisa estar no GROUP BY ou dentro de uma agregação (SUM, COUNT, MAX…)`);
      }
      const hit = colCache.get(e);
      if (hit && hit.cols === ctx.cols) return ctx.row[hit.i];
      const i = resolveCol(ctx.cols, e);
      colCache.set(e, { cols: ctx.cols, i });
      return ctx.row[i];
    }
    case "star": throw new SqlError("* só pode aparecer na lista do SELECT ou em COUNT(*)");
    case "un": {
      const v = evaluate(e.e, ctx);
      if (v === null) return null;
      return e.op === "NOT" ? !isTrue(v) : -toNum(v)!;
    }
    case "isnull": return (evaluate(e.e, ctx) === null) !== e.not;
    case "bin": return binary(e, ctx);
    case "in": {
      const v = evaluate(e.e, ctx);
      if (v === null) return null;
      const options = e.sub ? subquery(e.sub, ctx.env).rows.map((r) => r[0]) : e.list!.map((x) => evaluate(x, ctx));
      let sawNull = false;
      for (const o of options) {
        const r = eq(v, o);
        if (r === true) return !e.not;
        if (r === null) sawNull = true;
      }
      return sawNull ? null : e.not;
    }
    case "between": {
      const v = evaluate(e.e, ctx);
      const lo = evaluate(e.lo, ctx);
      const hi = evaluate(e.hi, ctx);
      if (v === null || lo === null || hi === null) return null;
      return (cmp(v, lo) >= 0 && cmp(v, hi) <= 0) !== e.not;
    }
    case "like": {
      const v = evaluate(e.e, ctx);
      const p = evaluate(e.pat, ctx);
      if (v === null || p === null) return null;
      return likeRegex(toStr(p)!, e.ci).test(toStr(v)!) !== e.not;
    }
    case "case": {
      const base = e.base ? evaluate(e.base, ctx) : undefined;
      for (const [w, then] of e.whens) {
        const ok = base !== undefined ? eq(base, evaluate(w, ctx)) === true : isTrue(evaluate(w, ctx));
        if (ok) return evaluate(then, ctx);
      }
      return e.else ? evaluate(e.else, ctx) : null;
    }
    case "cast": {
      const v = evaluate(e.e, ctx);
      if (!e.safe) return castTo(v, e.to, e.scale);
      try {
        return castTo(v, e.to, e.scale);
      } catch {
        return null;
      }
    }
    case "sub": {
      const r = subquery(e.q, ctx.env);
      if (r.cols.length !== 1) throw new SqlError("A subconsulta escalar precisa devolver uma única coluna");
      if (r.rows.length > 1) throw new SqlError("A subconsulta escalar devolveu mais de uma linha");
      return r.rows[0]?.[0] ?? null;
    }
    case "fn": return call(e, ctx);
  }
}

function binary(e: Extract<Expr, { k: "bin" }>, ctx: Ctx): SV {
  if (e.op === "AND" || e.op === "OR") {
    const a = evaluate(e.l, ctx);
    const and = e.op === "AND";
    if (a !== null && isTrue(a) !== and) return !and;
    const b = evaluate(e.r, ctx);
    if (b !== null && isTrue(b) !== and) return !and;
    return a === null || b === null ? null : and;
  }
  const a = evaluate(e.l, ctx);
  const b = evaluate(e.r, ctx);
  if (a === null || b === null) return null;
  switch (e.op) {
    case "=": return cmp(a, b) === 0;
    case "<>": return cmp(a, b) !== 0;
    case "<": return cmp(a, b) < 0;
    case "<=": return cmp(a, b) <= 0;
    case ">": return cmp(a, b) > 0;
    case ">=": return cmp(a, b) >= 0;
    case "||": return toStr(a)! + toStr(b)!;
  }
  // data ± número de dias, como date_add.
  if ((e.op === "+" || e.op === "-") && typeof a === "string" && isIsoDate(a) && typeof b === "number") {
    return shiftDate(a, e.op === "+" ? b : -b, "DAY");
  }
  const x = toNum(a, e.op)!;
  const y = toNum(b, e.op)!;
  switch (e.op) {
    case "+": return x + y;
    case "-": return x - y;
    case "*": return x * y;
    // Divisão por zero dá NULL (como try_divide), em vez de derrubar a consulta.
    case "/": return y === 0 ? null : x / y;
    case "%": return y === 0 ? null : x % y;
  }
  throw new SqlError(`Operador desconhecido ${e.op}`);
}

function call(e: Extract<Expr, { k: "fn" }>, ctx: Ctx): SV {
  if (AGGREGATES.has(e.name) && !e.over) {
    if (!ctx.group) throw new SqlError(`${e.name}() só pode ser usada no SELECT, HAVING ou ORDER BY (no WHERE, use HAVING)`);
    const acc = accumulator(e.name, !!e.distinct);
    const countRows = e.star || (e.name === "COUNT" && e.args.length === 0);
    if (!countRows && hasAggregate(e.args[0])) throw new SqlError("Agregação dentro de agregação não é permitida");
    for (const row of ctx.group) acc.add(countRows ? 1 : evaluate(e.args[0], { cols: ctx.cols, row, env: ctx.env }));
    return acc.result();
  }
  if (e.over) throw new SqlError(`Função de janela ${e.name}() fora do SELECT/ORDER BY`);
  // IF/IIF avaliam só o ramo escolhido (IF(x = 0, NULL, 1 / x) não divide por zero).
  if (e.name === "IF" || e.name === "IIF") {
    if (e.args.length < 2) throw new SqlError("IF(condição, se verdadeiro, se falso)");
    return isTrue(evaluate(e.args[0], ctx)) ? evaluate(e.args[1], ctx) : e.args[2] ? evaluate(e.args[2], ctx) : null;
  }
  const f = SCALARS[e.name];
  if (!f) throw new SqlError(`Função desconhecida: ${e.name.toLowerCase()}()`);
  return f(e.args.map((a) => evaluate(a, ctx)));
}

// ---------------- Execução ----------------

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

function timed<T>(f: () => T): [T, number] {
  const t = now();
  const r = f();
  return [r, now() - t];
}

const rowsCache = new WeakMap<Table, SV[][]>();
function tableRows(t: Table): SV[][] {
  let rows = rowsCache.get(t);
  if (!rows) {
    rows = t.rows.map((r) => t.columns.map((c) => r[c.name] ?? null));
    rowsCache.set(t, rows);
  }
  return rows;
}

interface Leaf { item: FromItem; rel: Rel; plan: PlanNode; eligible: boolean }

/** Lê as folhas do FROM (tabelas, CTEs, visões, subconsultas). */
function scan(item: Extract<FromItem, { k: "table" | "subq" }>, env: Env): { rel: Rel; plan: PlanNode } {
  if (item.k === "subq") {
    const r = execQuery(item.q, env);
    return {
      rel: { cols: r.rel.cols.map((c) => ({ ...c, table: item.alias })), rows: r.rel.rows },
      plan: { op: "Subconsulta", detail: item.alias, rows: r.rel.rows.length, ms: r.plan.ms, children: [r.plan] },
    };
  }
  const key = lower(item.name);
  const q = item.alias ?? item.name;
  const cte = env.ctes.get(key);
  if (cte) {
    return {
      rel: { cols: cte.cols.map((c) => ({ ...c, table: q })), rows: cte.rows },
      plan: { op: "Leitura da CTE", detail: item.name, rows: cte.rows.length, ms: 0, children: [] },
    };
  }
  const view = env.session.views.get(key);
  if (view) {
    const r = execQuery(view, { ...env, ctes: new Map() });
    return {
      rel: { cols: r.rel.cols.map((c) => ({ ...c, table: q })), rows: r.rel.rows },
      plan: { op: "Visão temporária", detail: item.name, rows: r.rel.rows.length, ms: r.plan.ms, children: [r.plan] },
    };
  }
  const t = env.session.table(item.name);
  if (!t) {
    const names = env.session.tables.map((x) => x.name);
    throw new SqlError(`Tabela ou visão "${item.name}" não encontrada. Disponíveis: ${names.join(", ")}`);
  }
  const [rows, ms] = timed(() => tableRows(t));
  return {
    rel: { cols: t.columns.map((c) => ({ name: c.name, table: q, type: c.type })), rows },
    plan: { op: "Leitura", detail: t.name + (item.alias ? ` AS ${item.alias}` : ""), rows: rows.length, ms, children: [] },
  };
}

/** Folhas do FROM; `eligible` = recebe filtros empurrados (não está no lado opcional de um OUTER JOIN). */
function collectLeaves(item: FromItem, eligible: boolean, out: Extract<FromItem, { k: "table" | "subq" }>[], flags: boolean[]) {
  if (item.k !== "join") {
    out.push(item);
    flags.push(eligible);
    return;
  }
  const leftOk = eligible && (item.type === "inner" || item.type === "cross" || item.type === "left");
  const rightOk = eligible && (item.type === "inner" || item.type === "cross" || item.type === "right");
  collectLeaves(item.l, leftOk, out, flags);
  collectLeaves(item.r, rightOk, out, flags);
}

function filterRel(rel: Rel, cond: Expr, env: Env): Rel {
  return { cols: rel.cols, rows: rel.rows.filter((row) => isTrue(evaluate(cond, { cols: rel.cols, row, env }))) };
}

/** Resolve todas as colunas da expressão nestas colunas (sem ambiguidade)? */
function resolvesIn(e: Expr, cols: ColInfo[]) {
  return colRefs(e).every((r) => typeof findCol(cols, r.table, r.name) === "number" && findCol(cols, r.table, r.name) !== -1);
}

function join(type: JoinType, l: { rel: Rel; plan: PlanNode }, r: { rel: Rel; plan: PlanNode }, on: Expr | undefined, env: Env) {
  const cols = [...l.rel.cols, ...r.rel.cols];
  const start = now();
  // Igualdades "coluna da esquerda = coluna da direita" viram chaves do hash join.
  const keys: [Expr, Expr][] = [];
  const residual: Expr[] = [];
  for (const c of conjuncts(on)) {
    if (c.k === "bin" && c.op === "=" && colRefs(c.l).length && colRefs(c.r).length) {
      if (resolvesIn(c.l, l.rel.cols) && resolvesIn(c.r, r.rel.cols)) { keys.push([c.l, c.r]); continue; }
      if (resolvesIn(c.r, l.rel.cols) && resolvesIn(c.l, r.rel.cols)) { keys.push([c.r, c.l]); continue; }
    }
    residual.push(c);
  }
  const rest = andAll(residual);
  const nullsL = l.rel.cols.map(() => null);
  const nullsR = r.rel.cols.map(() => null);
  const rows: SV[][] = [];
  const matchedR = new Uint8Array(r.rel.rows.length);
  const ok = (row: SV[]) => !rest || isTrue(evaluate(rest, { cols, row, env }));

  if (keys.length) {
    // Constrói a tabela hash com o lado direito e percorre o esquerdo uma vez só.
    const keyOf = (row: SV[], rel: Rel, side: 0 | 1) => {
      const parts = keys.map((k) => evaluate(k[side], { cols: rel.cols, row, env }));
      return parts.some((p) => p === null) ? null : parts.map(hashKey).join("\u0001");
    };
    const table = new Map<string, number[]>();
    r.rel.rows.forEach((row, i) => {
      const k = keyOf(row, r.rel, 1);
      if (k === null) return;
      const list = table.get(k);
      if (list) list.push(i);
      else table.set(k, [i]);
    });
    for (const lrow of l.rel.rows) {
      const k = keyOf(lrow, l.rel, 0);
      let any = false;
      for (const i of (k === null ? undefined : table.get(k)) ?? []) {
        const row = [...lrow, ...r.rel.rows[i]];
        if (!ok(row)) continue;
        rows.push(row);
        matchedR[i] = 1;
        any = true;
      }
      if (!any && (type === "left" || type === "full")) rows.push([...lrow, ...nullsR]);
    }
  } else {
    for (const lrow of l.rel.rows) {
      let any = false;
      r.rel.rows.forEach((rrow, i) => {
        const row = [...lrow, ...rrow];
        if (type !== "cross" && !ok(row)) return;
        rows.push(row);
        matchedR[i] = 1;
        any = true;
      });
      if (!any && (type === "left" || type === "full")) rows.push([...lrow, ...nullsR]);
    }
  }
  if (type === "right" || type === "full") {
    r.rel.rows.forEach((rrow, i) => {
      if (!matchedR[i]) rows.push([...nullsL, ...rrow]);
    });
  }
  const label = type === "cross" ? "CROSS" : type.toUpperCase();
  const detail = keys.length
    ? `${keys.map(([a, b]) => `${exprText(a)} = ${exprText(b)}`).join(" AND ")} · tabela hash com ${r.rel.rows.length.toLocaleString("pt-BR")} linhas` +
      (rest ? ` · depois: ${exprText(rest)}` : "")
    : on ? `${exprText(on)} · compara ${(l.rel.rows.length * r.rel.rows.length).toLocaleString("pt-BR")} pares` : "todas as combinações";
  return {
    rel: { cols, rows },
    plan: {
      op: keys.length ? `Hash join ${label}` : type === "cross" ? "Produto cartesiano" : `Nested loop join ${label}`,
      detail, rows: rows.length, ms: now() - start, children: [l.plan, r.plan],
    },
  };
}

/** FROM + WHERE: lê as folhas, empurra filtros para elas e faz as junções. */
function execFrom(from: FromItem, where: Expr | undefined, env: Env): { rel: Rel; plan: PlanNode; rest?: Expr } {
  const items: Extract<FromItem, { k: "table" | "subq" }>[] = [];
  const flags: boolean[] = [];
  collectLeaves(from, true, items, flags);
  const leaves: Leaf[] = items.map((item, i) => ({ item, eligible: flags[i], ...scan(item, env) }));

  // Predicate pushdown: um filtro que só usa colunas de uma folha é aplicado na leitura dela.
  const rest: Expr[] = [];
  const pushed = new Map<Leaf, Expr[]>();
  for (const c of conjuncts(where)) {
    const refs = colRefs(c);
    let target: Leaf | null = null;
    let pushable = refs.length > 0 && !hasAggregate(c);
    walk(c, (x) => {
      if (x.k === "fn" && x.over) pushable = false;
    });
    for (const ref of refs) {
      if (!pushable) break;
      const owners = leaves.filter((lf) => findCol(lf.rel.cols, ref.table, ref.name) !== -1);
      if (owners.length !== 1 || (target && target !== owners[0])) pushable = false;
      else target = owners[0];
    }
    if (pushable && target && target.eligible && leaves.length > 1) {
      pushed.set(target, [...(pushed.get(target) ?? []), c]);
    } else rest.push(c);
  }
  for (const [leaf, cs] of pushed) {
    const cond = andAll(cs)!;
    const [rel, ms] = timed(() => filterRel(leaf.rel, cond, env));
    leaf.plan = { op: "Filtro empurrado (pushdown)", detail: exprText(cond), rows: rel.rows.length, ms, children: [leaf.plan] };
    leaf.rel = rel;
  }

  let n = 0;
  const build = (item: FromItem): { rel: Rel; plan: PlanNode } => {
    if (item.k !== "join") {
      const lf = leaves[n++];
      return { rel: lf.rel, plan: lf.plan };
    }
    const l = build(item.l);
    const r = build(item.r);
    return join(item.type, l, r, item.on, env);
  };
  const out = build(from);
  return { ...out, rest: andAll(rest) };
}

interface SelectOut { rel: Rel; plan: PlanNode }

function compareKeys(order: OrderItem[]) {
  return (a: SV[], b: SV[]) => {
    for (let i = 0; i < order.length; i++) {
      const x = a[i];
      const y = b[i];
      const { desc } = order[i];
      // Padrão do Spark: NULL primeiro no ASC e por último no DESC.
      const nullsFirst = order[i].nullsFirst ?? !desc;
      if (x === null || y === null) {
        if (x === y) continue;
        return (x === null) === nullsFirst ? -1 : 1;
      }
      const c = cmp(x, y);
      if (c !== 0) return desc ? -c : c;
    }
    return 0;
  };
}

/** Calcula as funções de janela para todas as linhas (ou grupos) de entrada. */
function computeWindows(calls: Extract<Expr, { k: "fn" }>[], ctxs: Ctx[]) {
  for (const c of ctxs) c.win ??= new Map();
  for (const w of calls) {
    const spec = w.over!;
    const parts = new Map<string, number[]>();
    ctxs.forEach((ctx, i) => {
      const k = spec.partition.map((p) => hashKey(evaluate(p, ctx))).join("\u0001");
      const list = parts.get(k);
      if (list) list.push(i);
      else parts.set(k, [i]);
    });
    const byOrder = compareKeys(spec.order);
    for (const idx of parts.values()) {
      const keys = new Map(idx.map((i) => [i, spec.order.map((o) => evaluate(o.e, ctxs[i]))]));
      idx.sort((a, b) => byOrder(keys.get(a)!, keys.get(b)!) || a - b);
      const peer = (a: number, b: number) => spec.order.length > 0 && byOrder(keys.get(a)!, keys.get(b)!) === 0;
      const set = (pos: number, v: SV) => ctxs[idx[pos]].win!.set(w, v);
      const arg = (pos: number, n = 0) => (w.args[n] ? evaluate(w.args[n], ctxs[idx[pos]]) : null);
      const n = idx.length;
      switch (w.name) {
        case "ROW_NUMBER":
          idx.forEach((_, p) => set(p, p + 1));
          break;
        case "RANK": case "DENSE_RANK": case "PERCENT_RANK": {
          let rank = 0;
          let dense = 0;
          idx.forEach((_, p) => {
            if (p === 0 || !peer(idx[p - 1], idx[p])) { rank = p + 1; dense++; }
            set(p, w.name === "RANK" ? rank : w.name === "DENSE_RANK" ? dense : n > 1 ? (rank - 1) / (n - 1) : 0);
          });
          break;
        }
        case "NTILE": {
          const buckets = Math.max(1, toNum(arg(0)) ?? 1);
          idx.forEach((_, p) => set(p, Math.floor((p * buckets) / n) + 1));
          break;
        }
        case "LAG": case "LEAD": {
          const off = w.args[1] ? toNum(evaluate(w.args[1], ctxs[idx[0]])) ?? 1 : 1;
          idx.forEach((_, p) => {
            const q = w.name === "LAG" ? p - off : p + off;
            set(p, q >= 0 && q < n ? arg(q) : w.args[2] ? arg(p, 2) : null);
          });
          break;
        }
        default: {
          // Agregações e FIRST/LAST_VALUE: sem ORDER BY, a partição toda; com ORDER BY,
          // acumulado até a linha atual incluindo empates (moldura RANGE padrão do Spark).
          const isFirstLast = w.name === "FIRST_VALUE" || w.name === "LAST_VALUE";
          if (!isFirstLast && !AGGREGATES.has(w.name)) throw new SqlError(`${w.name}() não é uma função de janela`);
          const acc = isFirstLast ? null : accumulator(w.name, !!w.distinct);
          let first: SV = null;
          let last: SV = null;
          let p = 0;
          while (p < n) {
            let end = p;
            if (spec.order.length) while (end + 1 < n && peer(idx[p], idx[end + 1])) end++;
            else end = n - 1;
            for (let q = p; q <= end; q++) {
              const v = w.star ? 1 : arg(q);
              if (acc) acc.add(v);
              if (q === 0) first = v;
              last = v;
            }
            const v = acc ? acc.result() : w.name === "FIRST_VALUE" ? first : last;
            for (let q = p; q <= end; q++) set(q, v);
            p = end + 1;
          }
        }
      }
    }
  }
}

function expandStars(items: SelectItem[], cols: ColInfo[]): SelectItem[] {
  return items.flatMap((it) => {
    if (it.e.k !== "star") return [it];
    const t = it.e.table ? lower(it.e.table) : undefined;
    const picked = cols.map((c, i) => [c, i] as const).filter(([c]) => !t || (c.table && lower(c.table) === t));
    if (t && !picked.length) throw new SqlError(`Tabela ou apelido "${it.e.table}" não está no FROM`);
    return picked.map(([c]) => ({ e: { k: "col", table: c.table, name: c.name } as Expr, alias: c.name }));
  });
}

function execSelect(s: Select, env: Env, order: OrderItem[]): SelectOut {
  // FROM e WHERE
  let rel: Rel = { cols: [], rows: [[]] };
  let plan: PlanNode = { op: "Uma linha (sem FROM)", rows: 1, ms: 0, children: [] };
  let where = s.where;
  if (s.from) {
    const f = execFrom(s.from, s.where, env);
    rel = f.rel;
    plan = f.plan;
    where = f.rest;
  }
  if (where) {
    if (hasAggregate(where)) throw new SqlError("Agregações não podem ser usadas no WHERE; use HAVING");
    const cond = where;
    const [out, ms] = timed(() => filterRel(rel, cond, env));
    plan = { op: "Filtro", detail: exprText(cond), rows: out.rows.length, ms, children: [plan] };
    rel = out;
  }

  const items = expandStars(s.items, rel.cols);
  const names = items.map((it) => it.alias ?? (it.e.k === "col" ? it.e.name : exprText(it.e)));
  const grouped = !!s.groupBy || items.some((it) => hasAggregate(it.e)) || (!!s.having) ||
    order.some((o) => hasAggregate(o.e) && !(o.e.k === "col"));

  let ctxs: Ctx[];
  if (grouped) {
    const start = now();
    // GROUP BY aceita posição (GROUP BY 1) e apelido do SELECT.
    const groupExprs = (s.groupBy ?? []).map((g) => {
      if (g.k === "lit" && typeof g.v === "number") {
        const it = items[g.v - 1];
        if (!it) throw new SqlError(`GROUP BY ${g.v}: o SELECT só tem ${items.length} colunas`);
        return it.e;
      }
      if (g.k === "col" && !g.table && findCol(rel.cols, undefined, g.name) === -1) {
        const i = names.findIndex((n) => lower(n) === lower(g.name));
        if (i >= 0) return items[i].e;
      }
      return g;
    });
    for (const g of groupExprs) if (hasAggregate(g)) throw new SqlError("Agregações não podem estar no GROUP BY");
    const cache = new WeakMap<Expr, string>();
    const keyOf = (e: Expr) => {
      let k = cache.get(e);
      if (k === undefined) {
        try {
          k = JSON.stringify(e, (_, v) => (v && typeof v === "object" && v.k === "col" ? `#${resolveCol(rel.cols, v)}` : v));
        } catch {
          k = JSON.stringify(e);
        }
        cache.set(e, k);
      }
      return k;
    };
    const groupKeyStrings = groupExprs.map(keyOf);
    const groups = new Map<string, { rows: SV[][]; values: SV[] }>();
    for (const row of rel.rows) {
      const ctx: Ctx = { cols: rel.cols, row, env };
      const values = groupExprs.map((g) => evaluate(g, ctx));
      const k = values.map(hashKey).join("\u0001");
      const g = groups.get(k);
      if (g) g.rows.push(row);
      else groups.set(k, { rows: [row], values });
    }
    // Sem GROUP BY, a tabela inteira é um grupo (mesmo vazia: COUNT(*) = 0).
    if (!s.groupBy && groups.size === 0) groups.set("", { rows: [], values: [] });
    ctxs = [...groups.values()].map((g) => ({
      cols: rel.cols, row: g.rows[0] ?? [], env, group: g.rows, keyOf,
      groupKeys: new Map(groupKeyStrings.map((k, i) => [k, g.values[i]])),
    }));
    // Cada agregação distinta é calculada uma vez por grupo, aqui — e não de novo
    // na projeção, na janela ou na ordenação.
    const calls = new Map<string, Expr>();
    for (const e of [...items.map((it) => it.e), ...(s.having ? [s.having] : []), ...order.map((o) => o.e)]) {
      walk(e, (x) => {
        if (isAggCall(x)) {
          calls.set(keyOf(x), x);
          return false;
        }
      });
    }
    for (const c of ctxs) c.aggs = new Map([...calls].map(([k, x]) => [k, call(x as Extract<Expr, { k: "fn" }>, c)]));
    if (s.having) {
      const having = s.having;
      ctxs = ctxs.filter((c) => isTrue(evaluate(having, c)));
    }
    const aggs = [...new Set([...calls.values()].map(exprText))];
    plan = {
      op: "Agregação",
      detail: [groupExprs.length ? `GROUP BY ${groupExprs.map(exprText).join(", ")}` : "tabela inteira", aggs.join(", "),
        s.having ? `HAVING ${exprText(s.having)}` : ""].filter(Boolean).join(" · "),
      rows: ctxs.length, ms: now() - start, children: [plan],
    };
  } else {
    ctxs = rel.rows.map((row) => ({ cols: rel.cols, row, env }));
  }

  // Funções de janela (depois do GROUP BY, antes do ORDER BY — como no SQL).
  const windows: Extract<Expr, { k: "fn" }>[] = [];
  for (const it of items) windowCalls(it.e, windows);
  for (const o of order) windowCalls(o.e, windows);
  if (windows.length) {
    const [, ms] = timed(() => computeWindows(windows, ctxs));
    plan = { op: "Janela", detail: windows.map(exprText).join(", "), rows: ctxs.length, ms, children: [plan] };
  }

  // Projeção (e as chaves de ordenação, que podem usar colunas fora do SELECT).
  const start = now();
  const out: { row: SV[]; keys: SV[] }[] = ctxs.map((ctx) => {
    const row = items.map((it) => evaluate(it.e, ctx));
    const keys = order.map((o) => {
      if (o.e.k === "lit" && typeof o.e.v === "number") {
        if (o.e.v < 1 || o.e.v > row.length) throw new SqlError(`ORDER BY ${o.e.v}: o SELECT só tem ${row.length} colunas`);
        return row[o.e.v - 1];
      }
      if (o.e.k === "col" && !o.e.table) {
        const i = names.findIndex((n) => lower(n) === lower((o.e as { name: string }).name));
        if (i >= 0) return row[i];
      }
      return evaluate(o.e, ctx);
    });
    return { row, keys };
  });
  const cols: ColInfo[] = names.map((name, i) => ({ name, type: items[i].e.k === "col" ? colType(rel.cols, items[i].e) : undefined }));
  plan = { op: "Projeção", detail: names.join(", "), rows: out.length, ms: now() - start, children: [plan] };

  let rows = out;
  if (s.distinct) {
    const t = now();
    const seen = new Set<string>();
    rows = rows.filter((r) => {
      const k = r.row.map(hashKey).join("\u0001");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    plan = { op: "Distinct", rows: rows.length, ms: now() - t, children: [plan] };
  }
  if (order.length) {
    const t = now();
    const by = compareKeys(order);
    rows = rows.map((r, i) => ({ ...r, i })).sort((a, b) => by(a.keys, b.keys) || a.i - b.i);
    plan = { op: "Ordenação", detail: order.map((o) => exprText(o.e) + (o.desc ? " DESC" : "")).join(", "), rows: rows.length, ms: now() - t, children: [plan] };
  }
  return { rel: { cols, rows: rows.map((r) => r.row) }, plan };
}

function colType(cols: ColInfo[], e: Expr & { k: "col" }) {
  const i = findCol(cols, e.table, e.name);
  return typeof i === "number" && i >= 0 ? cols[i].type : undefined;
}

function execSet(body: SetExpr, env: Env, order: OrderItem[]): SelectOut {
  if (body.k === "select") return execSelect(body, env, order);
  const l = execSet(body.l, env, []);
  const r = execSet(body.r, env, []);
  if (l.rel.cols.length !== r.rel.cols.length) {
    throw new SqlError(`UNION com número de colunas diferente (${l.rel.cols.length} e ${r.rel.cols.length})`);
  }
  const start = now();
  let rows = [...l.rel.rows, ...r.rel.rows];
  if (!body.all) {
    const seen = new Set<string>();
    rows = rows.filter((row) => {
      const k = row.map(hashKey).join("\u0001");
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  }
  let rel: Rel = { cols: l.rel.cols.map((c) => ({ name: c.name, type: c.type })), rows };
  let plan: PlanNode = { op: body.all ? "Union all" : "Union (sem repetidos)", rows: rows.length, ms: now() - start, children: [l.plan, r.plan] };
  if (order.length) {
    const t = now();
    const ctxs = rel.rows.map((row) => ({ cols: rel.cols, row, env }));
    const keyed = ctxs.map((ctx, i) => ({
      row: ctx.row, i,
      keys: order.map((o) => (o.e.k === "lit" && typeof o.e.v === "number" ? ctx.row[o.e.v - 1] : evaluate(o.e, ctx))),
    }));
    const by = compareKeys(order);
    keyed.sort((a, b) => by(a.keys, b.keys) || a.i - b.i);
    rel = { cols: rel.cols, rows: keyed.map((k) => k.row) };
    plan = { op: "Ordenação", detail: order.map((o) => exprText(o.e) + (o.desc ? " DESC" : "")).join(", "), rows: rel.rows.length, ms: now() - t, children: [plan] };
  }
  return { rel, plan };
}

function execQuery(q: Query, outer: Env): SelectOut {
  const env: Env = { ...outer, ctes: new Map(outer.ctes) };
  const ctePlans: PlanNode[] = [];
  for (const c of q.with) {
    const r = execQuery(c.q, env);
    env.ctes.set(lower(c.name), { cols: r.rel.cols.map((x) => ({ name: x.name, type: x.type })), rows: r.rel.rows });
    ctePlans.push({ op: "CTE", detail: c.name, rows: r.rel.rows.length, ms: r.plan.ms, children: [r.plan] });
  }
  let { rel, plan } = execSet(q.body, env, q.order);
  if (q.offset || q.limit !== undefined) {
    const from = q.offset ?? 0;
    const rows = rel.rows.slice(from, q.limit === undefined ? undefined : from + q.limit);
    plan = {
      op: "Limite", detail: [q.limit !== undefined ? `LIMIT ${q.limit}` : "", q.offset ? `OFFSET ${q.offset}` : ""].filter(Boolean).join(" "),
      rows: rows.length, ms: 0, children: [plan],
    };
    rel = { cols: rel.cols, rows };
  }
  if (ctePlans.length) plan = { ...plan, children: [...plan.children, ...ctePlans] };
  return { rel, plan };
}

// ---------------- Sessão (o "cluster" do notebook) ----------------

export interface SqlColumn { name: string; type: ColumnType }

export interface StatementResult {
  text: string;
  columns: SqlColumn[];
  rows: Value[][];
  message?: string;
  plan?: PlanNode;
  ms: number;
  /** Efeitos no modelo do relatório (aplicados pelo notebook). */
  effect?: { kind: "createTable"; table: Table } | { kind: "dropTable"; name: string };
}

export interface RunResult { results: StatementResult[]; error?: { message: string; pos?: number; statement: number } }

/** Tipo de cada coluna a partir dos valores: número, data (AAAA-MM-DD) ou texto. */
export function inferType(values: Value[]): ColumnType {
  let sawNumber = false;
  let sawDate = false;
  for (const v of values) {
    if (v === null) continue;
    if (typeof v === "number") sawNumber = true;
    else if (isIsoDate(v)) sawDate = true;
    else return "text";
    if (sawNumber && sawDate) return "text";
  }
  return sawDate ? "date" : sawNumber ? "number" : "text";
}

/** Tipo no estilo do Spark para o DESCRIBE. */
function sparkType(t: ColumnType, values: Value[]) {
  if (t === "date") return "date";
  if (t === "text") return "string";
  return values.every((v) => v === null || Number.isInteger(v)) ? "bigint" : "double";
}

function output(rel: Rel): { columns: SqlColumn[]; rows: Value[][] } {
  const rows: Value[][] = rel.rows.map((r) => r.map((v) => (typeof v === "boolean" ? (v ? "true" : "false") : v)));
  const columns = rel.cols.map((c, i) => ({ name: c.name, type: inferType(rows.map((r) => r[i])) }));
  return { columns, rows };
}

/** Nomes repetidos no resultado ganham sufixo (uma tabela não pode ter duas colunas iguais). */
function uniqueNames(names: string[]) {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const k = lower(n);
    const c = seen.get(k) ?? 0;
    seen.set(k, c + 1);
    return c ? `${n}_${c + 1}` : n;
  });
}

export function planText(p: PlanNode): string {
  const fmt = (ms: number) => `${ms < 1 ? ms.toFixed(2) : ms.toFixed(1)} ms`.replace(".", ",");
  const lines: string[] = [];
  const visit = (n: PlanNode, prefix: string, childPrefix: string) => {
    lines.push(`${prefix}${n.op}${n.detail ? ` [${n.detail}]` : ""} · ${n.rows.toLocaleString("pt-BR")} linhas · ${fmt(n.ms)}`);
    n.children.forEach((c, i) => {
      const last = i === n.children.length - 1;
      visit(c, childPrefix + (last ? "└─ " : "├─ "), childPrefix + (last ? "   " : "│  "));
    });
  };
  visit(p, "", "");
  return lines.join("\n");
}

/**
 * A sessão guarda as tabelas do modelo e as visões temporárias (que, como no
 * Databricks, somem ao reiniciar a sessão). CREATE TABLE devolve um efeito
 * para o notebook gravar a tabela no modelo do relatório.
 */
export class Session {
  views = new Map<string, Query>();
  constructor(public tables: Table[]) {}

  table(name: string) {
    const n = lower(name);
    return this.tables.find((t) => lower(t.name) === n);
  }

  run(src: string): RunResult {
    const results: StatementResult[] = [];
    let parsed: { s: Statement; text: string }[];
    try {
      parsed = parseScript(src);
    } catch (e) {
      return { results, error: { message: e instanceof Error ? e.message : String(e), pos: e instanceof SqlError ? e.pos : undefined, statement: 0 } };
    }
    for (let i = 0; i < parsed.length; i++) {
      try {
        const start = now();
        const r = this.exec(parsed[i].s, parsed[i].text);
        results.push({ ...r, text: parsed[i].text, ms: now() - start });
      } catch (e) {
        return { results, error: { message: e instanceof Error ? e.message : String(e), statement: i } };
      }
    }
    return { results };
  }

  private env(): Env {
    return { session: this, ctes: new Map(), subCache: new Map() };
  }

  private exec(s: Statement, text: string): Omit<StatementResult, "text" | "ms"> {
    switch (s.k) {
      case "query": {
        const r = execQuery(s.q, this.env());
        return { ...output(r.rel), plan: r.plan };
      }
      case "explain": {
        const inner = s.s.k === "query" || s.s.k === "createTable" || s.s.k === "createView" ? s.s.q : null;
        if (!inner) throw new SqlError("EXPLAIN funciona com consultas (SELECT/WITH) e CREATE … AS");
        const r = execQuery(inner, this.env());
        return {
          columns: [{ name: "plano", type: "text" }],
          rows: planText(r.plan).split("\n").map((l) => [l]),
          plan: r.plan,
          message: "Plano executado e medido (de baixo para cima: leitura → filtros → junções → agregação → projeção).",
        };
      }
      case "createTable": {
        const exists = this.table(s.name);
        if (exists && s.ifNotExists) return { columns: [], rows: [], message: `A tabela ${exists.name} já existe; nada foi feito.` };
        if (exists && !s.replace) throw new SqlError(`A tabela "${exists.name}" já existe. Use CREATE OR REPLACE TABLE`);
        const r = execQuery(s.q, this.env());
        const o = output(r.rel);
        const names = uniqueNames(o.columns.map((c) => c.name));
        const table: Table = {
          name: exists?.name ?? s.name,
          columns: o.columns.map((c, i) => ({ name: names[i], type: c.type })),
          rows: o.rows.map((row) => Object.fromEntries(names.map((n, i) => [n, row[i]])) as Row),
          sql: text,
        };
        this.tables = [...this.tables.filter((t) => t !== exists), table];
        return {
          ...o, plan: r.plan, effect: { kind: "createTable", table },
          message: `Tabela ${table.name} ${exists ? "substituída" : "criada"} no modelo: ${table.rows.length.toLocaleString("pt-BR")} linhas, ${table.columns.length} colunas.`,
        };
      }
      case "createView": {
        const key = lower(s.name);
        if (this.views.has(key) && !s.replace) throw new SqlError(`A visão "${s.name}" já existe. Use CREATE OR REPLACE TEMP VIEW`);
        // Valida agora (erros aparecem na criação, não no primeiro uso).
        execQuery(s.q, this.env());
        this.views.set(key, s.q);
        return { columns: [], rows: [], message: `Visão temporária ${s.name} criada (vale até reiniciar a sessão).` };
      }
      case "drop": {
        if (s.what === "view") {
          const ok = this.views.delete(lower(s.name));
          if (!ok && !s.ifExists) throw new SqlError(`Visão "${s.name}" não encontrada`);
          return { columns: [], rows: [], message: ok ? `Visão ${s.name} removida.` : "Nada a remover." };
        }
        const t = this.table(s.name);
        if (!t) {
          if (s.ifExists) return { columns: [], rows: [], message: "Nada a remover." };
          throw new SqlError(`Tabela "${s.name}" não encontrada`);
        }
        this.tables = this.tables.filter((x) => x !== t);
        return { columns: [], rows: [], effect: { kind: "dropTable", name: t.name }, message: `Tabela ${t.name} removida do modelo.` };
      }
      case "show": {
        const rows: Value[][] = [
          ...this.tables.map((t) => [t.name, t.sql ? "SQL (notebook)" : t.query ? `importada (${t.query.origin})` : "modelo", t.rows.length, "false"]),
          ...[...this.views.keys()].map((v) => [v, "visão temporária", null, "true"]),
        ];
        return {
          columns: [{ name: "tabela", type: "text" }, { name: "origem", type: "text" }, { name: "linhas", type: "number" }, { name: "temporária", type: "text" }],
          rows,
        };
      }
      case "describe": {
        const view = this.views.get(lower(s.name));
        let cols: { name: string; type: ColumnType; values: Value[] }[];
        if (view) {
          const o = output(execQuery(view, this.env()).rel);
          cols = o.columns.map((c, i) => ({ ...c, values: o.rows.map((r) => r[i]) }));
        } else {
          const t = this.table(s.name);
          if (!t) throw new SqlError(`Tabela ou visão "${s.name}" não encontrada`);
          cols = t.columns.map((c) => ({ name: c.name, type: c.type, values: t.rows.map((r) => r[c.name] ?? null) }));
        }
        return {
          columns: [{ name: "coluna", type: "text" }, { name: "tipo", type: "text" }, { name: "nulos", type: "number" }, { name: "distintos", type: "number" }],
          rows: cols.map((c) => [c.name, sparkType(c.type, c.values), c.values.filter((v) => v === null).length, new Set(c.values.map(hashKey)).size]),
        };
      }
    }
  }
}
