import type { PaneFilter, Report, Row, Table, Visual } from "./types";
import { setColumn } from "./calculated";

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

// Loja, cidade, região, UF, latitude, longitude.
const lojas: [string, string, string, string, number, number][] = [
  ["Loja Centro", "São Paulo", "Sudeste", "SP", -23.545, -46.634],
  ["Loja Paulista", "São Paulo", "Sudeste", "SP", -23.561, -46.656],
  ["Loja Copacabana", "Rio de Janeiro", "Sudeste", "RJ", -22.971, -43.182],
  ["Loja Savassi", "Belo Horizonte", "Sudeste", "MG", -19.938, -43.935],
  ["Loja Batel", "Curitiba", "Sul", "PR", -25.442, -49.288],
  ["Loja Moinhos", "Porto Alegre", "Sul", "RS", -30.025, -51.201],
  ["Loja Boa Viagem", "Recife", "Nordeste", "PE", -8.119, -34.903],
  ["Loja Aldeota", "Fortaleza", "Nordeste", "CE", -3.737, -38.505],
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
      { name: "UF", type: "text" },
      { name: "Latitude", type: "number" },
      { name: "Longitude", type: "number" },
    ],
    rows: lojas.map(([Loja, Cidade, Região, UF, Latitude, Longitude], i) => ({
      LojaID: i + 1, Loja, Cidade, Região, UF, Latitude, Longitude,
    })),
  };

  // Calendário diário de 2025 e 2026: a "tabela de datas" usada pela
  // inteligência de tempo (TOTALYTD, SAMEPERIODLASTYEAR…).
  const dias: Row[] = [];
  for (let t = Date.UTC(2025, 0, 1); t <= Date.UTC(2026, 11, 31); t += 86400000) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    dias.push({
      Data: d.toISOString().slice(0, 10),
      Ano: y,
      Trimestre: `T${Math.ceil(m / 3)}`,
      Mês: `${y}-${String(m).padStart(2, "0")}`,
    });
  }
  const tCalendario: Table = {
    name: "Calendário",
    columns: [
      { name: "Data", type: "date" },
      { name: "Ano", type: "number" },
      { name: "Trimestre", type: "text" },
      { name: "Mês", type: "text" },
    ],
    rows: dias,
  };

  // Vendas de dois anos; 2026 cresce sobre 2025 e o fim de ano vende mais.
  const peso = [0.8, 0.75, 0.9, 0.85, 0.95, 0.9, 0.85, 0.9, 0.95, 1.0, 1.2, 1.5];
  const somaPeso = peso.reduce((a, b) => a + b, 0);
  const sortearMes = () => {
    let r = rand() * somaPeso;
    for (let i = 0; i < 12; i++) if ((r -= peso[i]) < 0) return i + 1;
    return 12;
  };
  const vendas: Row[] = [];
  for (let i = 1; i <= 4200; i++) {
    const ano = rand() < 0.45 ? 2025 : 2026;
    const mes = sortearMes();
    const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const dia = 1 + Math.floor(rand() * ultimoDia);
    const p = Math.floor(rand() * produtos.length);
    const l = Math.floor(rand() * lojas.length);
    const qtd = 1 + Math.floor(rand() * 4);
    const desconto = 0.85 + rand() * 0.15;
    vendas.push({
      VendaID: i,
      Data: `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`,
      ProdutoID: p + 1,
      LojaID: l + 1,
      Quantidade: qtd,
      Valor: Math.round(produtos[p][2] * qtd * desconto * 100) / 100,
    });
  }
  vendas.sort((a, b) => String(a.Data).localeCompare(String(b.Data)));
  vendas.forEach((v, i) => (v.VendaID = i + 1));
  const tVendas: Table = {
    name: "Vendas",
    columns: [
      { name: "VendaID", type: "number" },
      { name: "Data", type: "date" },
      { name: "ProdutoID", type: "number" },
      { name: "LojaID", type: "number" },
      { name: "Quantidade", type: "number" },
      { name: "Valor", type: "number" },
    ],
    rows: vendas,
  };

  // Funil de vendas do ano (etapas comerciais), para o visual de funil.
  const tFunil: Table = {
    name: "Funil",
    columns: [
      { name: "Etapa", type: "text" },
      { name: "Ordem", type: "number" },
      { name: "Quantidade", type: "number" },
    ],
    rows: [
      ["1. Visitantes", 1, 52_000], ["2. Leads", 2, 18_400], ["3. Propostas", 3, 7_900],
      ["4. Negociação", 4, 4_100], ["5. Vendas", 5, 2_357],
    ].map(([Etapa, Ordem, Quantidade]) => ({ Etapa, Ordem, Quantidade })) as Row[],
  };

  // Metas de 2026 por região (lado "um" do relacionamento com Lojas[Região]).
  const tMetas: Table = {
    name: "Metas",
    columns: [{ name: "Região", type: "text" }, { name: "Meta", type: "number" }],
    rows: [
      { Região: "Sudeste", Meta: 3_600_000 }, { Região: "Nordeste", Meta: 2_000_000 }, { Região: "Sul", Meta: 1_900_000 },
    ],
  };

  // Cronograma de um projeto (abertura de uma loja), para o Gantt.
  const tProjetos: Table = {
    name: "Projetos",
    columns: [
      { name: "Tarefa", type: "text" }, { name: "Área", type: "text" },
      { name: "Início", type: "date" }, { name: "Fim", type: "date" }, { name: "Concluído", type: "number" },
    ],
    rows: ([
      ["1. Estudo de mercado", "Planejamento", "2026-07-01", "2026-07-31", 1],
      ["2. Contrato do ponto", "Jurídico", "2026-08-01", "2026-08-20", 1],
      ["3. Reforma da loja", "Obras", "2026-08-21", "2026-10-31", 0.7],
      ["4. Contratação da equipe", "Pessoas", "2026-09-15", "2026-10-30", 0.5],
      ["5. Compra de estoque", "Compras", "2026-10-15", "2026-11-25", 0.2],
      ["6. Treinamento", "Pessoas", "2026-11-01", "2026-11-20", 0],
      ["7. Campanha de lançamento", "Marketing", "2026-11-10", "2026-12-05", 0],
      ["8. Inauguração", "Planejamento", "2026-12-01", "2026-12-05", 0],
    ] as [string, string, string, string, number][]).map(([Tarefa, Área, Início, Fim, Concluído]) => ({ Tarefa, Área, Início, Fim, Concluído })),
  };

  const ano2026 = (id: string, targetId: string): PaneFilter => ({
    id, scope: "visual", targetId, field: { table: "Calendário", column: "Ano" }, values: [2026],
  });

  const report: Report = {
    tables: [tVendas, tProdutos, tLojas, tCalendario, tFunil, tMetas, tProjetos],
    relationships: [
      { id: "r1", from: { table: "Vendas", column: "ProdutoID" }, to: { table: "Produtos", column: "ProdutoID" } },
      { id: "r2", from: { table: "Vendas", column: "LojaID" }, to: { table: "Lojas", column: "LojaID" } },
      { id: "r3", from: { table: "Vendas", column: "Data" }, to: { table: "Calendário", column: "Data" } },
      { id: "r4", from: { table: "Lojas", column: "Região" }, to: { table: "Metas", column: "Região" } },
    ],
    measures: [
      { id: "m1", name: "Faturamento", table: "Vendas", expression: "SUM(Vendas[Valor])", format: "currency" },
      { id: "m2", name: "Pedidos", table: "Vendas", expression: "COUNTROWS(Vendas)", format: "number" },
      { id: "m3", name: "Ticket Médio", table: "Vendas", expression: "DIVIDE([Faturamento], [Pedidos])", format: "currency" },
      { id: "m4", name: "Itens Vendidos", table: "Vendas", expression: "SUM(Vendas[Quantidade])", format: "number" },
      {
        id: "m5", name: "% do Faturamento", table: "Vendas", format: "percent",
        expression: "DIVIDE([Faturamento], CALCULATE([Faturamento], ALL(Produtos)))",
      },
      {
        id: "m6", name: "Faturamento Sudeste", table: "Vendas", format: "currency",
        expression: "CALCULATE([Faturamento], Lojas[Região] = \"Sudeste\")",
      },
      {
        id: "m7", name: "Faturamento Acum. Ano", table: "Vendas", format: "currency",
        expression: "TOTALYTD([Faturamento], Calendário[Data])",
      },
      {
        id: "m8", name: "Faturamento Ano Anterior", table: "Vendas", format: "currency",
        expression: "CALCULATE([Faturamento], SAMEPERIODLASTYEAR(Calendário[Data]))",
      },
      {
        id: "m9", name: "Crescimento %", table: "Vendas", format: "percent",
        expression: "DIVIDE([Faturamento] - [Faturamento Ano Anterior], [Faturamento Ano Anterior])",
      },
      {
        id: "m10", name: "Faturamento a Preço de Tabela", table: "Vendas", format: "currency",
        expression: "SUMX(Vendas, Vendas[Quantidade] * RELATED(Produtos[Preço]))",
      },
      {
        id: "m11", name: "Desconto Médio %", table: "Vendas", format: "percent",
        expression: "1 - DIVIDE([Faturamento], [Faturamento a Preço de Tabela])",
      },
      {
        id: "m12", name: "Vendas Grandes", table: "Vendas", format: "number",
        expression: "COUNTROWS(FILTER(Vendas, Vendas[Valor] >= 5000))",
      },
      {
        id: "m13", name: "Pedidos Ano Anterior", table: "Vendas", format: "number",
        expression: "CALCULATE([Pedidos], SAMEPERIODLASTYEAR(Calendário[Data]))",
      },
      {
        id: "m14", name: "Ticket Médio Ano Anterior", table: "Vendas", format: "currency",
        expression: "CALCULATE([Ticket Médio], SAMEPERIODLASTYEAR(Calendário[Data]))",
      },
      { id: "m15", name: "Oportunidades", table: "Funil", expression: "SUM(Funil[Quantidade])", format: "number" },
      { id: "m18", name: "Meta", table: "Metas", expression: "SUM(Metas[Meta])", format: "currency" },
      // Simulação: [Aumento de preço] e [Elasticidade] são parâmetros "e se" (página Simulação e projetos).
      {
        id: "m19", name: "Pedidos simulados", table: "Vendas", format: "number",
        expression: "[Pedidos] * (1 - [Elasticidade] * [Aumento de preço])",
      },
      {
        id: "m20", name: "Faturamento simulado", table: "Vendas", format: "currency",
        expression: "[Faturamento] * (1 + [Aumento de preço]) * (1 - [Elasticidade] * [Aumento de preço])",
      },
    ],
    pages: [
      { id: "p5", name: "Executivo" },
      { id: "p1", name: "Visão geral" },
      { id: "p2", name: "Detalhes" },
      { id: "p3", name: "Análises" },
      { id: "p4", name: "Tempo" },
      { id: "p6", name: "Avançado" },
      { id: "p7", name: "Geografia" },
      { id: "p8", name: "Exploração" },
      { id: "p9", name: "Detalhe do produto", drillthrough: [{ table: "Produtos", column: "Produto" }] },
      { id: "p10", name: "Monitoramento" },
      { id: "p11", name: "Laboratório" },
      { id: "p12", name: "Simulação e projetos" },
    ],
    visuals: [
      ...overview.map((v) => ({ ...v, pageId: "p1" })),
      ...details.map((v) => ({ ...v, pageId: "p2" })),
      ...analysis.map((v) => ({ ...v, pageId: "p3" })),
      ...time.map((v) => ({ ...v, pageId: "p4" })),
      ...executive.map((v) => ({ ...v, pageId: "p5" })),
      ...advanced.map((v) => ({ ...v, pageId: "p6" })),
      ...geography.map((v) => ({ ...v, pageId: "p7" })),
      ...exploration.map((v) => ({ ...v, pageId: "p8" })),
      ...productDetail.map((v) => ({ ...v, pageId: "p9" })),
      ...monitoring.map((v) => ({ ...v, pageId: "p10" })),
      ...lab.map((v) => ({ ...v, pageId: "p11" })),
      ...simulation.map((v) => ({ ...v, pageId: "p12" })),
    ],
    // A segmentação relativa da página Monitoramento começa em "Este ano" (2026).
    filters: [{
      field: { table: "Calendário", column: "Data" }, values: [],
      range: { min: "2026-01-01", max: "2026-12-31" }, sourceVisualId: "r1",
    }],
    paneFilters: [
      ano2026("f1", "d1"), ano2026("f2", "t1"), ano2026("f3", "t5"), ano2026("f4", "t6"),
      // Página Executivo: tudo em 2026 (filtro de página).
      { ...ano2026("f5", "p5"), scope: "page" },
      ano2026("f6", "lb1"),
    ],
    bookmarks: [],
    theme: { mode: "light", palette: "padrao" },
  };
  report.bookmarks = [{
    id: "b1",
    name: "Visão geral — só Sudeste",
    pageId: "p1",
    filters: [{ field: { table: "Lojas", column: "Região" }, values: ["Sudeste"], sourceVisualId: "v4" }],
    paneFilters: report.paneFilters,
    drills: {},
  }];

  // Colunas calculadas (contexto de linha), gravadas nas linhas da tabela.
  let withColumns = setColumn(report, "Vendas", { name: "Preço Unitário" }, "Vendas[Valor] / Vendas[Quantidade]");
  withColumns = setColumn(withColumns, "Vendas", { name: "Faixa de Valor" },
    'IF(Vendas[Valor] >= 5000, "3. Alto", IF(Vendas[Valor] >= 1000, "2. Médio", "1. Baixo"))');
  withColumns = setColumn(withColumns, "Vendas", { name: "Categoria" }, "RELATED(Produtos[Categoria])");
  return withColumns;
}

type Draft = Omit<Visual, "pageId">;

const overview: Draft[] = [
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
];

const details: Draft[] = [
  {
    id: "d1", type: "gauge", title: "Faturamento 2026 x Meta", x: 10, y: 10, w: 300, h: 200,
    measureIds: ["m1"], target: 8_000_000,
  },
  {
    id: "d2", type: "stacked", title: "Faturamento por Trimestre e Região", x: 320, y: 10, w: 600, h: 300,
    axis: { table: "Calendário", column: "Trimestre" }, legend: { table: "Lojas", column: "Região" }, measureIds: ["m1"],
  },
  {
    id: "d3", type: "hbar", title: "Pedidos por Loja", x: 10, y: 220, w: 300, h: 300,
    axis: { table: "Lojas", column: "Loja" }, measureIds: ["m2"],
  },
  {
    id: "d4", type: "matrix", title: "Categoria x Trimestre", x: 320, y: 320, w: 600, h: 200,
    axis: { table: "Produtos", column: "Categoria" }, legend: { table: "Calendário", column: "Trimestre" }, measureIds: ["m1"],
  },
  {
    id: "d5", type: "scatter", title: "Itens x Faturamento por Produto", x: 10, y: 530, w: 450, h: 300,
    axis: { table: "Produtos", column: "Produto" }, measureIds: ["m4", "m1"],
  },
  {
    id: "d6", type: "treemap", title: "Faturamento por Produto", x: 470, y: 530, w: 450, h: 300,
    axis: { table: "Produtos", column: "Produto" }, measureIds: ["m1"],
  },
  {
    id: "d7", type: "area", title: "Ticket Médio por Mês", x: 10, y: 840, w: 910, h: 240,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m3"],
  },
];

const analysis: Draft[] = [
  {
    id: "a1", type: "table", title: "Participação por Categoria", x: 10, y: 10, w: 450, h: 220,
    axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1", "m5"], dataBars: true,
  },
  { id: "a2", type: "card", title: "Faturamento Sudeste (CALCULATE)", x: 470, y: 10, w: 260, h: 110, measureIds: ["m6"] },
  {
    id: "a3", type: "slicer", title: "Região", x: 740, y: 10, w: 180, h: 220,
    axis: { table: "Lojas", column: "Região" }, measureIds: [],
  },
  {
    id: "a4", type: "bar", title: "Pedidos por Faixa de Valor (coluna calculada)", x: 470, y: 130, w: 260, h: 260,
    axis: { table: "Vendas", column: "Faixa de Valor" }, measureIds: ["m2"], sort: { by: "category", desc: false },
  },
  {
    id: "a5", type: "hbar", title: "Top 5 Produtos", x: 10, y: 240, w: 450, h: 250,
    axis: { table: "Produtos", column: "Produto" }, measureIds: ["m1"], topN: 5,
  },
  {
    id: "a6", type: "matrix", title: "Faixa de Valor x Região", x: 470, y: 400, w: 450, h: 200,
    axis: { table: "Vendas", column: "Faixa de Valor" }, legend: { table: "Lojas", column: "Região" },
    measureIds: ["m2"], dataBars: true,
  },
];

const time: Draft[] = [
  { id: "t1", type: "card", title: "Crescimento 2026 x 2025", x: 10, y: 10, w: 220, h: 110, measureIds: ["m9"] },
  { id: "t2", type: "card", title: "Desconto médio (SUMX)", x: 240, y: 10, w: 220, h: 110, measureIds: ["m11"] },
  { id: "t3", type: "card", title: "Vendas ≥ R$ 5 mil (FILTER)", x: 470, y: 10, w: 220, h: 110, measureIds: ["m12"] },
  {
    id: "t8", type: "slicer", title: "Ano", x: 700, y: 10, w: 220, h: 110,
    axis: { table: "Calendário", column: "Ano" }, measureIds: [],
  },
  {
    id: "t4", type: "bar", title: "Faturamento por Data (drill: clique numa coluna)", x: 10, y: 130, w: 450, h: 300,
    axis: { table: "Calendário", column: "Data" }, measureIds: ["m1"], drillMode: true,
  },
  {
    id: "t5", type: "line", title: "2026 x Ano Anterior", x: 470, y: 130, w: 450, h: 300,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1", "m8"],
  },
  {
    id: "t6", type: "table", title: "Acumulado no Ano (2026)", x: 10, y: 440, w: 450, h: 330,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1", "m7", "m9"], dataBars: true,
    sort: { by: "category", desc: false },
  },
  {
    id: "t7", type: "matrix", title: "Categoria › Produto x Ano (drill)", x: 470, y: 440, w: 450, h: 330,
    axis: { table: "Produtos", column: "Categoria" }, drillFields: [{ table: "Produtos", column: "Produto" }],
    legend: { table: "Calendário", column: "Ano" }, measureIds: ["m1"], drillMode: true,
  },
];

const executive: Draft[] = [
  {
    id: "e1", type: "text", title: "Cabeçalho", x: 10, y: 10, w: 660, h: 80, measureIds: [],
    text: "# Resultado 2026\nFaturamento de **[Faturamento]** em **[Pedidos]** pedidos — crescimento de **[Crescimento %]** sobre 2025.",
  },
  { id: "e2", type: "button", title: "Ver análise de tempo ›", x: 680, y: 15, w: 240, h: 32, measureIds: [], action: { kind: "page", pageId: "p4" } },
  { id: "e3", type: "button", title: "Visão geral só do Sudeste ›", x: 680, y: 53, w: 240, h: 32, measureIds: [], action: { kind: "bookmark", bookmarkId: "b1" } },
  {
    id: "e4", type: "kpi", title: "Faturamento", x: 10, y: 100, w: 300, h: 170,
    measureIds: ["m1", "m8"], axis: { table: "Calendário", column: "Mês" }, target: 8_000_000,
  },
  {
    id: "e5", type: "kpi", title: "Pedidos", x: 320, y: 100, w: 300, h: 170,
    measureIds: ["m2", "m13"], axis: { table: "Calendário", column: "Mês" },
  },
  {
    id: "e6", type: "kpi", title: "Ticket médio", x: 630, y: 100, w: 290, h: 170,
    measureIds: ["m3", "m14"], axis: { table: "Calendário", column: "Mês" },
  },
  {
    id: "e7", type: "combo", title: "Faturamento e crescimento por mês", x: 10, y: 280, w: 450, h: 290,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1", "m9"], sort: { by: "category", desc: false },
  },
  {
    id: "e8", type: "waterfall", title: "De 2025 para 2026, por categoria", x: 470, y: 280, w: 450, h: 290,
    axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1", "m8"],
  },
  {
    id: "e9", type: "heatmap", title: "Faturamento por loja e trimestre", x: 10, y: 580, w: 910, h: 280,
    axis: { table: "Lojas", column: "Loja" }, legend: { table: "Calendário", column: "Trimestre" }, measureIds: ["m1"],
  },
  {
    id: "e10", type: "narrative", title: "Resumo automático", x: 10, y: 870, w: 910, h: 150,
    measureIds: ["m1", "m8"], axis: { table: "Calendário", column: "Mês" },
    explainBy: [{ table: "Produtos", column: "Categoria" }, { table: "Lojas", column: "Região" }],
  },
];

const regiao = { table: "Lojas", column: "Região" };
const categoria = { table: "Produtos", column: "Categoria" };
const valorVenda = { table: "Vendas", column: "Valor" };

const advanced: Draft[] = [
  {
    id: "x1", type: "line", title: "Faturamento mensal com previsão de 6 meses", x: 10, y: 10, w: 600, h: 300,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1"],
    forecast: { periods: 6, method: "linear", confidence: 0.95 },
    refLines: [{ id: "r1", kind: "average" }],
  },
  {
    id: "x2", type: "hbar", title: "Faturamento por loja x meta", x: 620, y: 10, w: 300, h: 300,
    axis: { table: "Lojas", column: "Loja" }, measureIds: ["m1"],
    refLines: [{ id: "r2", kind: "constant", value: 1_700_000, label: "Meta" }],
  },
  {
    id: "x3", type: "histogram", title: "Distribuição do valor das vendas", x: 10, y: 320, w: 450, h: 280,
    valueField: valorVenda, bins: 20, measureIds: [],
  },
  {
    id: "x4", type: "boxplot", title: "Valor das vendas por categoria", x: 470, y: 320, w: 450, h: 280,
    axis: categoria, valueField: valorVenda, measureIds: [],
  },
  {
    id: "x5", type: "influencers", title: "O que influencia o ticket médio", x: 10, y: 610, w: 450, h: 400,
    measureIds: ["m3"],
    explainBy: [regiao, { table: "Lojas", column: "Cidade" }, categoria, { table: "Calendário", column: "Trimestre" }],
  },
  {
    id: "x6", type: "decomp", title: "Decomposição do faturamento", x: 470, y: 610, w: 450, h: 400,
    measureIds: ["m1"],
    explainBy: [regiao, { table: "Lojas", column: "Loja" }, categoria, { table: "Produtos", column: "Produto" }],
    decomp: [{ field: regiao, value: "Sudeste" }, { field: categoria }],
  },
];

/** Logotipo de exemplo (SVG embutido): mostra o visual de imagem sem depender da internet. */
const LOGO = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80">' +
  '<rect width="200" height="80" rx="12" fill="#252423"/>' +
  '<rect x="18" y="44" width="12" height="20" fill="#f2c811"/><rect x="36" y="30" width="12" height="34" fill="#f2c811"/>' +
  '<rect x="54" y="18" width="12" height="46" fill="#f2c811"/>' +
  '<text x="80" y="52" font-family="Segoe UI, sans-serif" font-size="26" font-weight="700" fill="#fff">Mini BI</text></svg>',
);

const lojasField = (column: string) => ({ table: "Lojas", column });

const geography: Draft[] = [
  {
    id: "g5", type: "image", title: "Logotipo", x: 10, y: 10, w: 200, h: 90, measureIds: [],
    image: { src: LOGO, fit: "contain", alt: "Mini BI" },
  },
  {
    id: "g4", type: "text", title: "Como ler", x: 220, y: 10, w: 700, h: 90, measureIds: [],
    text: "## Vendas pelo Brasil\n- Os mapas aceitam **UF**, **nome do estado**, **código do IBGE** ou **região**.\n" +
      "- Contornos: [malhas territoriais do IBGE](https://www.ibge.gov.br/geociencias/organizacao-do-territorio/malhas-territoriais.html).",
  },
  {
    id: "g1", type: "map", title: "Faturamento por estado", x: 10, y: 110, w: 450, h: 420,
    axis: lojasField("UF"), measureIds: ["m1"],
  },
  {
    id: "g2", type: "map", title: "Faturamento por região", x: 470, y: 110, w: 450, h: 420,
    axis: lojasField("Região"), measureIds: ["m1"],
  },
  {
    id: "g3", type: "bubblemap", title: "Lojas: faturamento (tamanho) e ticket médio (cor)", x: 10, y: 540, w: 450, h: 420,
    axis: lojasField("Loja"), latField: lojasField("Latitude"), lonField: lojasField("Longitude"), measureIds: ["m1", "m3"],
  },
  {
    id: "g6", type: "table", title: "Faturamento por UF", x: 470, y: 540, w: 450, h: 420,
    axis: lojasField("UF"), measureIds: ["m1", "m2", "m3"], colorScale: true,
  },
];

const produto = { table: "Produtos", column: "Produto" };

const exploration: Draft[] = [
  {
    id: "s1", type: "slicer", title: "Período", x: 10, y: 10, w: 450, h: 110,
    axis: { table: "Calendário", column: "Data" }, slicerStyle: "between", measureIds: [],
  },
  {
    id: "s2", type: "slicer", title: "Valor da venda (R$)", x: 470, y: 10, w: 450, h: 110,
    axis: { table: "Vendas", column: "Valor" }, slicerStyle: "between", measureIds: [],
  },
  {
    id: "s3", type: "pareto", title: "Pareto do faturamento por produto", x: 10, y: 130, w: 450, h: 300,
    axis: produto, measureIds: ["m1"],
  },
  {
    id: "s4", type: "line", title: "Faturamento mensal com anomalias", x: 470, y: 130, w: 450, h: 300,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1"], anomalies: { sensitivity: 2 },
  },
  {
    id: "s5", type: "table", title: "Produtos (selecione e use ↗ para detalhar)", x: 10, y: 440, w: 450, h: 330,
    axis: produto, measureIds: ["m1", "m2", "m3"], dataBars: true,
  },
  {
    id: "s6", type: "slicer", title: "Região", x: 470, y: 440, w: 450, h: 70,
    axis: { table: "Lojas", column: "Região" }, slicerStyle: "dropdown", measureIds: [],
  },
  {
    id: "s7", type: "narrative", title: "O que os dados dizem", x: 470, y: 520, w: 450, h: 250,
    measureIds: ["m1"], explainBy: [produto, { table: "Lojas", column: "Loja" }],
  },
];

/** Página de destino do drill-through: tudo aqui fica filtrado pelo produto escolhido. */
const productDetail: Draft[] = [
  {
    id: "dp1", type: "text", title: "Cabeçalho", x: 10, y: 10, w: 910, h: 80, measureIds: [],
    text: "# Detalhe do produto\nFaturamento de **[Faturamento]** em **[Pedidos]** pedidos — ticket médio de **[Ticket Médio]**.",
  },
  {
    id: "dp2", type: "kpi", title: "Faturamento", x: 10, y: 100, w: 300, h: 160,
    measureIds: ["m1", "m8"], axis: { table: "Calendário", column: "Mês" },
  },
  {
    id: "dp3", type: "line", title: "Faturamento por mês", x: 320, y: 100, w: 600, h: 280,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1"], refLines: [{ id: "dr1", kind: "average" }],
  },
  {
    id: "dp4", type: "hbar", title: "Faturamento por loja", x: 10, y: 270, w: 300, h: 320,
    axis: { table: "Lojas", column: "Loja" }, measureIds: ["m1"],
  },
  {
    id: "dp5", type: "map", title: "Faturamento por estado", x: 320, y: 390, w: 600, h: 300,
    axis: { table: "Lojas", column: "UF" }, measureIds: ["m1"],
  },
];

/** Regras do crescimento: ≥ 20% bom, entre 0 e 20% atenção, negativo ruim. */
const growthRules = (measure: number): Visual["rules"] => [
  { id: `g${measure}a`, measure, op: ">=", value: 0.2, style: "good", icon: true },
  { id: `g${measure}b`, measure, op: "<", value: 0, style: "bad", icon: true },
  { id: `g${measure}c`, measure, op: "between", value: 0, value2: 0.2, style: "warn", icon: true },
];

const monitoring: Draft[] = [
  {
    id: "r1", type: "slicer", title: "Período (relativo)", x: 10, y: 10, w: 450, h: 90,
    axis: { table: "Calendário", column: "Data" }, slicerStyle: "relative", measureIds: [],
    relative: { kind: "this", unit: "year", anchor: "data" },
  },
  {
    id: "r2", type: "fieldparam", title: "Ver por", x: 470, y: 10, w: 450, h: 90, measureIds: [],
    paramFields: [
      { table: "Lojas", column: "Região" }, { table: "Lojas", column: "Loja" },
      { table: "Produtos", column: "Categoria" }, { table: "Produtos", column: "Produto" },
    ],
    paramIndex: 0,
  },
  {
    id: "r3", type: "bar", title: "Faturamento (eixo pelo parâmetro)", x: 10, y: 110, w: 450, h: 300,
    axis: { table: "Lojas", column: "Região" }, axisParam: "r2", measureIds: ["m1"],
  },
  {
    id: "r4", type: "multicard", title: "Resultado x ano anterior", x: 470, y: 110, w: 450, h: 300,
    axis: { table: "Lojas", column: "Região" }, axisParam: "r2", measureIds: ["m1", "m9"], rules: growthRules(1),
  },
  {
    id: "r5", type: "funnel", title: "Funil comercial", x: 10, y: 420, w: 450, h: 300,
    axis: { table: "Funil", column: "Etapa" }, measureIds: ["m15"],
  },
  {
    id: "r6", type: "table", title: "Produtos: crescimento com regras", x: 470, y: 420, w: 450, h: 300,
    axis: { table: "Produtos", column: "Produto" }, measureIds: ["m1", "m9"], rules: growthRules(1),
  },
];

const lab: Draft[] = [
  {
    id: "lb1", type: "bullet", title: "2026: faturamento x meta por região", x: 10, y: 10, w: 450, h: 200,
    axis: { table: "Metas", column: "Região" }, measureIds: ["m1", "m18"], bands: [0.6, 0.9],
  },
  {
    id: "lb2", type: "radar", title: "Categorias em três medidas (escala relativa)", x: 470, y: 10, w: 450, h: 300,
    axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1", "m2", "m3"],
  },
  {
    id: "lb3", type: "line", title: "Faturamento mensal — pequenos múltiplos por região", x: 10, y: 220, w: 450, h: 300,
    axis: { table: "Calendário", column: "Mês" }, measureIds: ["m1"], multiples: { table: "Lojas", column: "Região" },
  },
  {
    id: "lb4", type: "bar", title: "Faturamento por categoria (passe o mouse)", x: 470, y: 320, w: 450, h: 200,
    axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1"],
    tooltipMeasures: ["m2", "m3"], tooltipTrend: { table: "Calendário", column: "Mês" },
  },
  {
    id: "lb5", type: "calendar", title: "Pedidos por dia", x: 10, y: 530, w: 910, h: 230,
    axis: { table: "Calendário", column: "Data" }, measureIds: ["m2"],
  },
];

const simulation: Draft[] = [
  {
    id: "sm1", type: "whatif", title: "E se o preço subir…", x: 10, y: 10, w: 300, h: 110, measureIds: [],
    whatif: { name: "Aumento de preço", min: 0, max: 0.3, step: 0.01, value: 0.1, format: "percent" },
  },
  {
    id: "sm2", type: "whatif", title: "…e a demanda reagir assim (elasticidade)", x: 320, y: 10, w: 300, h: 110, measureIds: [],
    whatif: { name: "Elasticidade", min: 0, max: 3, step: 0.1, value: 1.2, format: "number" },
  },
  {
    id: "sm3", type: "kpi", title: "Faturamento simulado", x: 630, y: 10, w: 290, h: 170, measureIds: ["m20", "m1"],
  },
  {
    id: "sm4", type: "bar", title: "Atual x simulado por categoria", x: 10, y: 130, w: 610, h: 240,
    axis: { table: "Produtos", column: "Categoria" }, measureIds: ["m1", "m20"],
  },
  {
    id: "sm5", type: "kpi", title: "Pedidos simulados", x: 630, y: 190, w: 290, h: 180, measureIds: ["m19", "m2"],
  },
  {
    id: "sm6", type: "sankey", title: "Faturamento: região → categoria", x: 10, y: 380, w: 450, h: 320,
    axis: { table: "Lojas", column: "Região" }, legend: { table: "Produtos", column: "Categoria" }, measureIds: ["m1"],
  },
  {
    id: "sm7", type: "gantt", title: "Projeto: nova loja em Campinas", x: 470, y: 380, w: 450, h: 320, measureIds: [],
    axis: { table: "Projetos", column: "Tarefa" }, legend: { table: "Projetos", column: "Área" },
    startField: { table: "Projetos", column: "Início" }, endField: { table: "Projetos", column: "Fim" },
    progressField: { table: "Projetos", column: "Concluído" },
  },
];
