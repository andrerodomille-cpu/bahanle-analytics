// Mini-DAX: tokenizer + parser recursivo descendente que gera uma AST.
//
// Gramática (da menor para a maior precedência):
//   expr     := compare
//   compare  := concat (('=' | '<>' | '<' | '<=' | '>' | '>=') concat)?
//   concat   := additive ('&' additive)*
//   additive := term (('+' | '-') term)*
//   term     := unary (('*' | '/') unary)*
//   unary    := '-' unary | primary
//   primary  := NUMBER | "texto" | '(' expr ')' | '[' Nome ']' | colref
//             | FUNC '(' args ')'
//   colref   := Tabela '[' Coluna ']'   |   'Tabela Com Espaço' '[' Coluna ']'
//
// Funções:
//   SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT (Tabela[Coluna])
//   COUNTROWS(tabela)          DIVIDE(a, b[, alternativo])
//   SUMX, AVERAGEX, MINX, MAXX, COUNTX (tabela, expressão por linha)
//   tabela := Tabela | FILTER(tabela, condição) | ALL(Tabela)
//   TOTALYTD(expr, Datas[Data])
//   IF(condição, então[, senão])      RELATED(Tabela[Coluna])
//   CALCULATE(expr, filtro, ...) onde filtro é:
//     Tabela[Coluna] = valor | Tabela[Coluna] <> valor
//     Tabela[Coluna] IN { v1, v2, ... }
//     ALL(Tabela) | ALL(Tabela[Coluna]) | REMOVEFILTERS(...)
//     DATESYTD(Datas[Data]) | SAMEPERIODLASTYEAR(Datas[Data])
//     DATEADD(Datas[Data], n, DAY | MONTH | QUARTER | YEAR)

export type Literal = string | number;

export type CompareOp = "=" | "<>" | "<" | "<=" | ">" | ">=";

export type DateShift = "DAY" | "MONTH" | "QUARTER" | "YEAR";

export type CalcArg =
  | { kind: "values"; table: string; column: string; values: Literal[]; negate: boolean }
  | { kind: "all"; table: string; column?: string }
  | { kind: "dates"; fn: "ytd" | "sply" | "dateadd"; table: string; column: string; n?: number; unit?: DateShift };

/** Expressões de tabela (usadas por iteradores e COUNTROWS). */
export type TableExpr =
  | { kind: "table"; name: string }
  | { kind: "all"; name: string }
  | { kind: "filter"; table: TableExpr; cond: Ast };

export type IterFn = "SUMX" | "AVERAGEX" | "MINX" | "MAXX" | "COUNTX";
const ITER_FNS: IterFn[] = ["SUMX", "AVERAGEX", "MINX", "MAXX", "COUNTX"];

export type Ast =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "neg"; arg: Ast }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Ast; right: Ast }
  | { kind: "compare"; op: CompareOp; left: Ast; right: Ast }
  | { kind: "concat"; left: Ast; right: Ast }
  | { kind: "measure"; name: string }
  | { kind: "column"; table: string; column: string }
  | { kind: "related"; table: string; column: string }
  | { kind: "agg"; fn: AggFn; table: string; column: string }
  | { kind: "countrows"; table: TableExpr }
  | { kind: "iter"; fn: IterFn; table: TableExpr; expr: Ast }
  | { kind: "divide"; num: Ast; den: Ast; alt?: Ast }
  | { kind: "if"; cond: Ast; then: Ast; else?: Ast }
  | { kind: "calculate"; expr: Ast; args: CalcArg[] };

export type AggFn = "SUM" | "AVERAGE" | "MIN" | "MAX" | "COUNT" | "DISTINCTCOUNT";
const AGG_FNS: AggFn[] = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "DISTINCTCOUNT"];

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  | { t: "ident"; v: string }
  | { t: "quoted"; v: string }
  | { t: "bracket"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

export class ExprError extends Error {}

const TWO_CHAR_OPS = ["<>", "<=", ">="];
const ONE_CHAR_OPS = "+-*/(),=<>&{}";

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      const v = Number(src.slice(i, j));
      if (Number.isNaN(v)) throw new ExprError(`Número inválido: ${src.slice(i, j)}`);
      out.push({ t: "num", v });
      i = j;
    } else if (/[A-Za-zÀ-ÿ_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-zÀ-ÿ0-9_]/.test(src[j])) j++;
      out.push({ t: "ident", v: src.slice(i, j) });
      i = j;
    } else if (c === '"') {
      // Texto entre aspas duplas; "" dentro do texto vira uma aspa, como no DAX.
      let j = i + 1;
      let v = "";
      for (;;) {
        if (j >= src.length) throw new ExprError("Faltou fechar o texto com \"");
        if (src[j] === '"') {
          if (src[j + 1] === '"') {
            v += '"';
            j += 2;
            continue;
          }
          break;
        }
        v += src[j++];
      }
      out.push({ t: "str", v });
      i = j + 1;
    } else if (c === "'" || c === "[") {
      const close = c === "'" ? "'" : "]";
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw new ExprError(`Faltou fechar ${c}`);
      out.push({ t: c === "'" ? "quoted" : "bracket", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if (TWO_CHAR_OPS.includes(src.slice(i, i + 2))) {
      out.push({ t: "op", v: src.slice(i, i + 2) });
      i += 2;
    } else if (ONE_CHAR_OPS.includes(c)) {
      out.push({ t: "op", v: c });
      i++;
    } else {
      throw new ExprError(`Caractere inesperado: ${c}`);
    }
  }
  out.push({ t: "eof" });
  return out;
}

export function parse(src: string): Ast {
  const tokens = tokenize(src);
  let pos = 0;
  const peek = (k = 0) => tokens[pos + k];
  const next = () => tokens[pos++];
  const isOp = (v: string, k = 0) => {
    const tk = peek(k);
    return tk.t === "op" && tk.v === v;
  };
  const expectOp = (v: string) => {
    if (!isOp(v)) throw new ExprError(`Esperava "${v}"`);
    pos++;
  };

  const tableName = (): string => {
    const tk = next();
    if (tk.t === "ident" || tk.t === "quoted") return tk.v;
    throw new ExprError("Esperava nome de tabela");
  };

  const columnRef = (): { table: string; column: string } => {
    const table = tableName();
    const col = next();
    if (col.t !== "bracket") throw new ExprError(`Esperava ${table}[Coluna]`);
    return { table, column: col.v };
  };

  const literal = (): Literal => {
    let sign = 1;
    if (isOp("-")) {
      pos++;
      sign = -1;
    }
    const tk = next();
    if (tk.t === "num") return sign * tk.v;
    if (tk.t === "str" && sign === 1) return tk.v;
    throw new ExprError("Esperava um número ou \"texto\"");
  };

  const expr = (): Ast => compare();

  const compare = (): Ast => {
    const left = concat();
    const tk = peek();
    if (tk.t === "op" && ["=", "<>", "<", "<=", ">", ">="].includes(tk.v)) {
      pos++;
      return { kind: "compare", op: tk.v as CompareOp, left, right: concat() };
    }
    return left;
  };

  const concat = (): Ast => {
    let left = additive();
    while (isOp("&")) {
      pos++;
      left = { kind: "concat", left, right: additive() };
    }
    return left;
  };

  const additive = (): Ast => {
    let left = term();
    while (isOp("+") || isOp("-")) {
      const op = (next() as { v: "+" | "-" }).v;
      left = { kind: "binary", op, left, right: term() };
    }
    return left;
  };

  const term = (): Ast => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const op = (next() as { v: "*" | "/" }).v;
      left = { kind: "binary", op, left, right: unary() };
    }
    return left;
  };

  const unary = (): Ast => {
    if (isOp("-")) {
      pos++;
      return { kind: "neg", arg: unary() };
    }
    return primary();
  };

  /** Tabela | FILTER(tabela, condição) | ALL(Tabela) */
  const tableExpr = (): TableExpr => {
    const tk = peek();
    if (tk.t === "ident" && isOp("(", 1)) {
      const fn = tk.v.toUpperCase();
      if (fn === "FILTER") {
        pos += 2;
        const table = tableExpr();
        expectOp(",");
        const cond = expr();
        expectOp(")");
        return { kind: "filter", table, cond };
      }
      if (fn === "ALL") {
        pos += 2;
        const name = tableName();
        expectOp(")");
        return { kind: "all", name };
      }
      throw new ExprError(`Esperava uma tabela, FILTER(...) ou ALL(...), não ${tk.v}(...)`);
    }
    return { kind: "table", name: tableName() };
  };

  /** Argumento de filtro do CALCULATE. */
  const calcArg = (): CalcArg => {
    const tk = peek();
    if (tk.t === "ident" && isOp("(", 1)) {
      const fn = tk.v.toUpperCase();
      if (fn === "DATESYTD" || fn === "SAMEPERIODLASTYEAR") {
        pos += 2;
        const ref = columnRef();
        expectOp(")");
        return { kind: "dates", fn: fn === "DATESYTD" ? "ytd" : "sply", ...ref };
      }
      if (fn === "DATEADD") {
        pos += 2;
        const ref = columnRef();
        expectOp(",");
        const n = literal();
        if (typeof n !== "number") throw new ExprError("DATEADD: o deslocamento precisa ser um número");
        expectOp(",");
        const u = next();
        const unit = u.t === "ident" ? u.v.toUpperCase() : "";
        if (!["DAY", "MONTH", "QUARTER", "YEAR"].includes(unit)) {
          throw new ExprError("DATEADD: use DAY, MONTH, QUARTER ou YEAR");
        }
        expectOp(")");
        return { kind: "dates", fn: "dateadd", ...ref, n, unit: unit as DateShift };
      }
      if (fn === "FILTER") {
        throw new ExprError("FILTER como filtro do CALCULATE não é suportado; use Tabela[Coluna] = valor");
      }
    }
    if (tk.t === "ident" && ["ALL", "REMOVEFILTERS"].includes(tk.v.toUpperCase()) && isOp("(", 1)) {
      pos += 2;
      const table = tableName();
      let column: string | undefined;
      if (peek().t === "bracket") column = (next() as { v: string }).v;
      expectOp(")");
      return { kind: "all", table, column };
    }
    const ref = columnRef();
    const op = peek();
    if (op.t === "ident" && op.v.toUpperCase() === "IN") {
      pos++;
      expectOp("{");
      const values: Literal[] = [literal()];
      while (isOp(",")) {
        pos++;
        values.push(literal());
      }
      expectOp("}");
      return { kind: "values", ...ref, values, negate: false };
    }
    if (isOp("=") || isOp("<>")) {
      const negate = (next() as { v: string }).v === "<>";
      return { kind: "values", ...ref, values: [literal()], negate };
    }
    throw new ExprError(`Filtro do CALCULATE: use ${ref.table}[${ref.column}] = valor, <> valor, IN { ... } ou ALL(...)`);
  };

  const primary = (): Ast => {
    const tk = peek();
    if (tk.t === "num") {
      pos++;
      return { kind: "number", value: tk.v };
    }
    if (tk.t === "str") {
      pos++;
      return { kind: "string", value: tk.v };
    }
    if (tk.t === "bracket") {
      pos++;
      return { kind: "measure", name: tk.v };
    }
    if (isOp("(")) {
      pos++;
      const e = expr();
      expectOp(")");
      return e;
    }
    // Tabela[Coluna] solta (sem agregação): usada em colunas calculadas.
    if ((tk.t === "ident" || tk.t === "quoted") && peek(1).t === "bracket") {
      return { kind: "column", ...columnRef() };
    }
    if (tk.t === "ident") {
      const fn = tk.v.toUpperCase();
      pos++;
      expectOp("(");
      let node: Ast;
      if ((AGG_FNS as string[]).includes(fn)) {
        node = { kind: "agg", fn: fn as AggFn, ...columnRef() };
      } else if (fn === "COUNTROWS") {
        node = { kind: "countrows", table: tableExpr() };
      } else if ((ITER_FNS as string[]).includes(fn)) {
        const table = tableExpr();
        expectOp(",");
        node = { kind: "iter", fn: fn as IterFn, table, expr: expr() };
      } else if (fn === "TOTALYTD") {
        const inner = expr();
        expectOp(",");
        const ref = columnRef();
        node = { kind: "calculate", expr: inner, args: [{ kind: "dates", fn: "ytd", ...ref }] };
      } else if (fn === "RELATED") {
        node = { kind: "related", ...columnRef() };
      } else if (fn === "DIVIDE") {
        const num = expr();
        expectOp(",");
        const den = expr();
        let alt: Ast | undefined;
        if (isOp(",")) {
          pos++;
          alt = expr();
        }
        node = { kind: "divide", num, den, alt };
      } else if (fn === "IF") {
        const cond = expr();
        expectOp(",");
        const then = expr();
        let otherwise: Ast | undefined;
        if (isOp(",")) {
          pos++;
          otherwise = expr();
        }
        node = { kind: "if", cond, then, else: otherwise };
      } else if (fn === "CALCULATE") {
        const inner = expr();
        const args: CalcArg[] = [];
        while (isOp(",")) {
          pos++;
          args.push(calcArg());
        }
        node = { kind: "calculate", expr: inner, args };
      } else if (fn === "ALL" || fn === "REMOVEFILTERS") {
        throw new ExprError(`${fn} só pode ser usado dentro de CALCULATE ou como tabela de um iterador`);
      } else if (["DATESYTD", "SAMEPERIODLASTYEAR", "DATEADD"].includes(fn)) {
        throw new ExprError(`${fn} só pode ser usado como filtro dentro de CALCULATE`);
      } else if (fn === "FILTER") {
        throw new ExprError("FILTER devolve uma tabela: use-o dentro de SUMX, COUNTROWS etc.");
      } else {
        throw new ExprError(`Função desconhecida: ${tk.v}`);
      }
      expectOp(")");
      return node;
    }
    throw new ExprError("Expressão incompleta");
  };

  const ast = expr();
  if (peek().t !== "eof") throw new ExprError("Sobrou texto no fim da expressão");
  return ast;
}
