// Mini-DAX: tokenizer + parser recursivo descendente que gera uma AST.
//
// Gramática:
//   expr    := term (('+' | '-') term)*
//   term    := unary (('*' | '/') unary)*
//   unary   := '-' unary | primary
//   primary := NUMBER | '(' expr ')' | '[' Medida ']'
//            | FUNC '(' args ')'
//   colref  := Tabela '[' Coluna ']'   |   'Tabela Com Espaço' '[' Coluna ']'
//
// Funções: SUM, AVERAGE, MIN, MAX, COUNT, DISTINCTCOUNT (recebem coluna),
//          COUNTROWS (recebe tabela), DIVIDE(a, b[, alternativo]).

export type Ast =
  | { kind: "number"; value: number }
  | { kind: "neg"; arg: Ast }
  | { kind: "binary"; op: "+" | "-" | "*" | "/"; left: Ast; right: Ast }
  | { kind: "measure"; name: string }
  | { kind: "agg"; fn: AggFn; table: string; column: string }
  | { kind: "countrows"; table: string }
  | { kind: "divide"; num: Ast; den: Ast; alt?: Ast };

export type AggFn = "SUM" | "AVERAGE" | "MIN" | "MAX" | "COUNT" | "DISTINCTCOUNT";
const AGG_FNS: AggFn[] = ["SUM", "AVERAGE", "MIN", "MAX", "COUNT", "DISTINCTCOUNT"];

type Token =
  | { t: "num"; v: number }
  | { t: "ident"; v: string }
  | { t: "quoted"; v: string }
  | { t: "bracket"; v: string }
  | { t: "op"; v: string }
  | { t: "eof" };

export class ExprError extends Error {}

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
    } else if (c === "'" || c === "[") {
      const close = c === "'" ? "'" : "]";
      const j = src.indexOf(close, i + 1);
      if (j < 0) throw new ExprError(`Faltou fechar ${c}`);
      out.push({ t: c === "'" ? "quoted" : "bracket", v: src.slice(i + 1, j) });
      i = j + 1;
    } else if ("+-*/(),".includes(c)) {
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
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];
  const isOp = (v: string) => {
    const tk = peek();
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

  const expr = (): Ast => {
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

  const primary = (): Ast => {
    const tk = peek();
    if (tk.t === "num") {
      pos++;
      return { kind: "number", value: tk.v };
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
    if (tk.t === "ident") {
      const fn = tk.v.toUpperCase();
      pos++;
      expectOp("(");
      let node: Ast;
      if ((AGG_FNS as string[]).includes(fn)) {
        const ref = columnRef();
        node = { kind: "agg", fn: fn as AggFn, ...ref };
      } else if (fn === "COUNTROWS") {
        node = { kind: "countrows", table: tableName() };
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
