import type { Report, Row, Table } from "./types";

// Gerador pseudoaleatório com semente, para o exemplo ser sempre igual.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const produtos: [string, string, number][] = [
  ["Notebook", "Informática", 4200],
  ["Monitor", "Informática", 1100],
  ["Teclado", "Periféricos", 180],
  ["Mouse", "Periféricos", 90],
  ["Headset", "Periféricos", 320],
  ["Smartphone", "Telefonia", 2600],
  ["Carregador", "Telefonia", 120],
  ["Smart TV", "Eletrônicos", 3100],
  ["Caixa de Som", "Eletrônicos", 450],
  ["Tablet", "Informática", 1900],
];

const lojas: [string, string, string][] = [
  ["Loja Centro", "São Paulo", "Sudeste"],
  ["Loja Paulista", "São Paulo", "Sudeste"],
  ["Loja Copacabana", "Rio de Janeiro", "Sudeste"],
  ["Loja Savassi", "Belo Horizonte", "Sudeste"],
  ["Loja Batel", "Curitiba", "Sul"],
  ["Loja Moinhos", "Porto Alegre", "Sul"],
  ["Loja Boa Viagem", "Recife", "Nordeste"],
  ["Loja Aldeota", "Fortaleza", "Nordeste"],
];

export function sampleReport(): Report {
  const rand = rng(42);

  const tProdutos: Table = {
    name: "Produtos",
    columns: [
      { name: "ProdutoID", type: "number" },
      { name: "Produto", type: "text" },
      { name: "Categoria", type: "text" },
      { name: "Preço", type: "number" },
    ],
    rows: produtos.map(([Produto, Categoria, Preço], i) => ({ ProdutoID: i + 1, Produto, Categoria, Preço })),
  };

  const tLojas: Table = {
    name: "Lojas",
    columns: [
      { name: "LojaID", type: "number" },
      { name: "Loja", type: "text" },
      { name: "Cidade", type: "text" },
      { name: "Região", type: "text" },
    ],
    rows: lojas.map(([Loja, Cidade, Região], i) => ({ LojaID: i + 1, Loja, Cidade, Região })),
  };

  const meses: Row[] = [];
  for (let m = 1; m <= 12; m++) {
    meses.push({
      Mês: `2026-${String(m).padStart(2, "0")}`,
      Ano: 2026,
      Trimestre: `T${Math.ceil(m / 3)}`,
    });
  }
  const tCalendario: Table = {
    name: "Calendário",
    columns: [
      { name: "Mês", type: "text" },
      { name: "Ano", type: "number" },
      { name: "Trimestre", type: "text" },
    ],
    rows: meses,
  };

  const vendas: Row[] = [];
  for (let i = 1; i <= 2000; i++) {
    const p = Math.floor(rand() * produtos.length);
    const l = Math.floor(rand() * lojas.length);
    const mes = 1 + Math.floor(rand() * 12);
    const qtd = 1 + Math.floor(rand() * 4);
    const desconto = 0.85 + rand() * 0.15;
    vendas.push({
      VendaID: i,
      Mês: `2026-${String(mes).padStart(2, "0")}`,
      ProdutoID: p + 1,
      LojaID: l + 1,
      Quantidade: qtd,
      Valor: Math.round(produtos[p][2] * qtd * desconto * 100) / 100,
    });
  }
  const tVendas: Table = {
    name: "Vendas",
    columns: [
      { name: "VendaID", type: "number" },
      { name: "Mês", type: "text" },
      { name: "ProdutoID", type: "number" },
      { name: "LojaID", type: "number" },
      { name: "Quantidade", type: "number" },
      { name: "Valor", type: "number" },
    ],
    rows: vendas,
  };

  return {
    tables: [tVendas, tProdutos, tLojas, tCalendario],
    relationships: [
      { id: "r1", from: { table: "Vendas", column: "ProdutoID" }, to: { table: "Produtos", column: "ProdutoID" } },
      { id: "r2", from: { table: "Vendas", column: "LojaID" }, to: { table: "Lojas", column: "LojaID" } },
      { id: "r3", from: { table: "Vendas", column: "Mês" }, to: { table: "Calendário", column: "Mês" } },
    ],
    measures: [
      { id: "m1", name: "Faturamento", table: "Vendas", expression: "SUM(Vendas[Valor])", format: "currency" },
      { id: "m2", name: "Pedidos", table: "Vendas", expression: "COUNTROWS(Vendas)", format: "number" },
      { id: "m3", name: "Ticket Médio", table: "Vendas", expression: "DIVIDE([Faturamento], [Pedidos])", format: "currency" },
      { id: "m4", name: "Itens Vendidos", table: "Vendas", expression: "SUM(Vendas[Quantidade])", format: "number" },
    ],
    visuals: [
      { id: "v1", type: "card", title: "Faturamento", x: 10, y: 10, w: 220, h: 110, measureIds: ["m1"] },
      { id: "v2", type: "card", title: "Pedidos", x: 240, y: 10, w: 220, h: 110, measureIds: ["m2"] },
      { id: "v3", type: "card", title: "Ticket Médio", x: 470, y: 10, w: 220, h: 110, measureIds: ["m3"] },
      {
        id: "v4", type: "slicer", title: "Região", x: 700, y: 10, w: 220, h: 250,
        axis: { table: "Lojas", column: "Região" }, measureIds: [],
      },
      {
        id: "v5", type: "bar", title: "Faturamento por Categoria", x: 10, y: 130, w: 450, h: 280,
        axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1"],
      },
      {
        id: "v6", type: "pie", title: "Pedidos por Cidade", x: 470, y: 130, w: 220, h: 280,
        axis: { table: "Lojas", column: "Cidade" }, measureIds: ["m2"],
      },
      {
        id: "v7", type: "line", title: "Faturamento por Mês", x: 10, y: 420, w: 680, h: 260,
        axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1"],
      },
      {
        id: "v8", type: "table", title: "Produtos", x: 700, y: 270, w: 220, h: 410,
        axis: { table: "Produtos", column: "Produto" }, measureIds: ["m4", "m1"],
      },
    ],
    filters: [],
  };
}
