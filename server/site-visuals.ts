// Página "Visuais" do site: uma ficha por componente (o que mostra, quando
// usar, campos e opções) com uma miniatura desenhada. Os campos seguem os
// nomes do painel de propriedades do app.

export interface VisualDoc {
  id: string;
  name: string;
  what: string;
  when: string;
  fields: string[];
  extras?: string[];
}

export const VISUAL_GROUPS: { id: string; name: string; intro: string; items: VisualDoc[] }[] = [
  {
    id: "comparacao", name: "Comparação", intro: "Para comparar valores entre categorias ou ver como um total se forma.",
    items: [
      { id: "bar", name: "Colunas", what: "Uma coluna vertical por categoria; com várias medidas, as colunas ficam lado a lado.",
        when: "Comparar poucas categorias ou períodos curtos (meses de um ano, regiões).",
        fields: ["Eixo: a categoria", "Valores: uma ou mais medidas"],
        extras: ["Ordenação e Top N", "Linhas de referência (meta, média, mediana…)", "Pequenos múltiplos", "Drill-down por níveis"] },
      { id: "hbar", name: "Barras", what: "A mesma ideia das colunas, na horizontal.",
        when: "Rankings e categorias com nomes longos (produtos, lojas, clientes).",
        fields: ["Eixo: a categoria", "Valores: uma ou mais medidas"],
        extras: ["Ordenar do maior para o menor", "Top N", "Linhas de referência"] },
      { id: "stacked", name: "Colunas empilhadas", what: "Cada coluna é dividida em partes, uma por valor da legenda.",
        when: "Ver o total e a contribuição de cada parte ao mesmo tempo.",
        fields: ["Eixo: a categoria", "Legenda: o que divide cada coluna", "Valores: uma medida"] },
      { id: "stacked100", name: "Colunas 100%", what: "Colunas empilhadas em que cada coluna soma 100%.",
        when: "Comparar a composição (a participação) entre categorias, sem o tamanho atrapalhar.",
        fields: ["Eixo X: a categoria", "Legenda: as partes", "Valores: uma medida"],
        extras: ["A dica mostra valor e participação"] },
      { id: "combo", name: "Combo", what: "Colunas e uma linha no mesmo gráfico, cada uma com o seu eixo.",
        when: "Duas medidas de escalas diferentes, como faturamento e crescimento %.",
        fields: ["Eixo: a categoria", "Colunas: a primeira medida", "Linha (eixo direito): a segunda medida"] },
      { id: "waterfall", name: "Cascata", what: "Degraus que sobem e descem do valor inicial até o total.",
        when: "Explicar como um resultado foi formado ou por que mudou de um período para outro.",
        fields: ["Categoria: cada degrau", "Valor atual: a medida", "Valor base (opcional): para mostrar a variação"],
        extras: ["Com duas medidas, verde sobe e vermelho desce"] },
      { id: "pareto", name: "Pareto", what: "Colunas do maior para o menor, a linha do % acumulado e a marca de 80%.",
        when: "Descobrir quais poucos itens fazem a maior parte do resultado.",
        fields: ["Eixo: a categoria", "Valores: uma medida"],
        extras: ["Frase pronta: “N de M fazem 80% do total”"] },
      { id: "funnel", name: "Funil", what: "Etapas de um processo, cada uma mais estreita que a anterior.",
        when: "Conversão em vendas, cadastro, atendimento: onde as pessoas desistem.",
        fields: ["Eixo: as etapas", "Valores: uma medida"],
        extras: ["% em relação ao início e à etapa anterior"] },
      { id: "dumbbell", name: "Haltere", what: "Dois pontos ligados por categoria: antes e depois.",
        when: "Mostrar a mudança entre dois momentos para muitas categorias.",
        fields: ["Categoria: uma linha por valor", "Antes: a primeira medida", "Depois: a segunda medida"],
        extras: ["Variação % em cada linha"] },
    ],
  },
  {
    id: "tempo", name: "Tendência e tempo", intro: "Para acompanhar a evolução ao longo do tempo.",
    items: [
      { id: "line", name: "Linha", what: "A medida ao longo do tempo, ligando os pontos.",
        when: "Tendências, sazonalidade e comparação entre períodos.",
        fields: ["Eixo: o tempo (data, mês, trimestre…)", "Valores: uma ou mais medidas"],
        extras: ["Previsão com faixa de confiança", "Destaque de anomalias", "Linhas de referência", "Pequenos múltiplos"] },
      { id: "area", name: "Área", what: "Uma linha com a área abaixo preenchida.",
        when: "Evolução em que o volume acumulado importa.",
        fields: ["Eixo: o tempo", "Valores: uma ou mais medidas"],
        extras: ["Previsão e anomalias, como na linha"] },
      { id: "area100", name: "Área 100%", what: "Áreas empilhadas que somam 100% em cada período.",
        when: "Como a composição muda com o tempo (participação de cada canal mês a mês).",
        fields: ["Eixo X: o tempo", "Legenda: as partes", "Valores: uma medida"] },
      { id: "bump", name: "Ranking", what: "A posição (1º, 2º, 3º…) de cada série em cada período.",
        when: "Quem subiu e quem caiu no ranking ao longo do tempo.",
        fields: ["Período: o eixo", "Séries: uma linha por valor", "Valores: a medida que define a posição"] },
      { id: "calendar", name: "Calendário de calor", what: "Um quadrado por dia do ano, mais escuro quanto maior o valor.",
        when: "Padrões por dia da semana, feriados e picos diários.",
        fields: ["Data: uma coluna de data", "Valores: uma medida"],
        extras: ["Troca de ano com ‹ ›", "Clicar num dia filtra a página"] },
    ],
  },
  {
    id: "composicao", name: "Composição", intro: "Para mostrar como um todo se divide em partes.",
    items: [
      { id: "pie", name: "Rosca", what: "Um anel dividido pela participação de cada categoria.",
        when: "Poucas partes (até umas 6) de um mesmo total.",
        fields: ["Legenda: a categoria", "Valores: uma medida"] },
      { id: "treemap", name: "Treemap", what: "Retângulos com área proporcional ao valor.",
        when: "Muitas categorias de um total, quando a rosca ficaria poluída.",
        fields: ["Categoria", "Valores: uma medida"] },
      { id: "sunburst", name: "Sunburst", what: "Anéis concêntricos, um por nível da hierarquia.",
        when: "Composição em vários níveis, como categoria › produto.",
        fields: ["Anel interno: o primeiro nível", "Níveis abaixo: os de detalhamento", "Valores: uma medida"],
        extras: ["O centro mostra o total"] },
      { id: "waffle", name: "Waffle", what: "100 quadradinhos coloridos pela participação de cada categoria.",
        when: "Percentuais fáceis de ler, como “3 em cada 10”.",
        fields: ["Categoria", "Valores: uma medida"],
        extras: ["Arredondamento que sempre soma 100"] },
      { id: "pictogram", name: "Pictograma", what: "Ícones repetidos na proporção do valor.",
        when: "Comunicar números para públicos amplos, de forma visual.",
        fields: ["Categoria", "Valores: uma medida"],
        extras: ["Escolha do ícone", "Quanto vale cada ícone (automático ou fixo)"] },
    ],
  },
  {
    id: "distribuicao", name: "Distribuição e relação", intro: "Para entender como os valores se espalham e se relacionam.",
    items: [
      { id: "scatter", name: "Dispersão", what: "Um ponto por item, posicionado por duas medidas.",
        when: "Ver se duas medidas andam juntas e achar itens fora do padrão.",
        fields: ["Detalhes: um ponto por valor", "Eixo X e Eixo Y: duas medidas", "Tamanho (opcional): terceira medida"],
        extras: ["Eixo de reprodução: anima quadro a quadro (ex.: por mês)"] },
      { id: "heatmap", name: "Mapa de calor", what: "Uma grade em que a cor mostra o valor de cada cruzamento.",
        when: "Cruzar duas dimensões, como dia da semana × hora ou região × produto.",
        fields: ["Linhas: uma dimensão", "Colunas: outra dimensão", "Valores: uma medida"] },
      { id: "histogram", name: "Histograma", what: "Quantas linhas caem em cada faixa de valores.",
        when: "Ver a forma da distribuição: concentração, assimetria, extremos.",
        fields: ["Coluna numérica"],
        extras: ["Número de faixas automático ou escolhido", "Clicar numa faixa filtra a página"] },
      { id: "boxplot", name: "Box plot", what: "Uma caixa por categoria com quartis, mediana, média e pontos fora do padrão.",
        when: "Comparar a distribuição entre grupos de forma compacta.",
        fields: ["Categoria: uma caixa por valor", "Coluna numérica"] },
      { id: "violin", name: "Violino", what: "A forma da distribuição em cada categoria, com mediana e quartis por dentro.",
        when: "Quando a forma importa: dois picos, caudas longas.",
        fields: ["Categoria: um violino por valor", "Coluna numérica"] },
      { id: "radar", name: "Radar", what: "Várias medidas em eixos que partem do centro.",
        when: "Comparar perfis (lojas, produtos) em vários critérios ao mesmo tempo.",
        fields: ["Categoria: uma forma por valor", "Valores: várias medidas"],
        extras: ["Escala própria por medida, para comparar grandezas diferentes"] },
      { id: "sankey", name: "Sankey", what: "Fluxos com largura proporcional ao valor, de uma dimensão para outra.",
        when: "Ver de onde vem e para onde vai: canal › região, origem › destino.",
        fields: ["Origem: a primeira dimensão", "Destino: a segunda dimensão", "Valores: uma medida"] },
    ],
  },
  {
    id: "indicadores", name: "Indicadores", intro: "Para destacar os números que importam.",
    items: [
      { id: "card", name: "Cartão", what: "Um número grande, com o nome da medida.",
        when: "O total que precisa ser visto primeiro.",
        fields: ["Valor: uma medida"], extras: ["Regras de cor (verde, amarelo, vermelho)"] },
      { id: "multicard", name: "Cartões", what: "Um bloco por categoria, com várias medidas lado a lado.",
        when: "Resumo de vários indicadores por região, loja ou produto.",
        fields: ["Categoria", "Valores: várias medidas"], extras: ["Regras de cor"] },
      { id: "kpi", name: "KPI", what: "O valor, a variação contra outra medida, a meta e um minigráfico.",
        when: "Acompanhar uma meta e saber de relance se está melhor ou pior.",
        fields: ["Valor: a medida", "Comparar com (opcional): ex.: ano anterior", "Tendência (opcional): o eixo do minigráfico"],
        extras: ["Meta", "Regras de cor"] },
      { id: "gauge", name: "Medidor", what: "Um arco que enche até o valor, com a meta marcada.",
        when: "Quanto falta para a meta de um único indicador.",
        fields: ["Valor: uma medida"], extras: ["Meta"] },
      { id: "bullet", name: "Marcador", what: "Uma barra do realizado sobre faixas ruim/ok/bom e a marca da meta.",
        when: "Realizado × meta para vários itens num espaço pequeno.",
        fields: ["Valor: a medida", "Meta (opcional): segunda medida ou valor fixo", "Categoria (opcional): um marcador por valor"],
        extras: ["Limites das faixas em fração da meta"] },
    ],
  },
  {
    id: "tabelas", name: "Tabelas", intro: "Para quando o detalhe em números é o que importa.",
    items: [
      { id: "table", name: "Tabela", what: "Linhas com as medidas em colunas e o total no fim.",
        when: "Consultar valores exatos e listas de itens.",
        fields: ["Linhas: a categoria", "Valores: uma ou mais medidas"],
        extras: ["Barras de dados e escala de cores", "Regras de cor com ícones", "Coluna de minigráfico", "Ordenar clicando no cabeçalho"] },
      { id: "matrix", name: "Matriz", what: "Uma tabela cruzada: linhas × colunas, com subtotais.",
        when: "Cruzar duas dimensões com números, como região × trimestre.",
        fields: ["Linhas: uma dimensão (e níveis abaixo)", "Colunas (opcional): outra dimensão", "Valores: uma ou mais medidas"],
        extras: ["Linhas hierárquicas que abrem e fecham (+/−)", "Barras de dados e escala de cores"] },
    ],
  },
  {
    id: "analise", name: "Análise inteligente", intro: "Visuais que fazem a análise por você.",
    items: [
      { id: "influencers", name: "Principais influenciadores", what: "Quais valores das dimensões mais aumentam (ou diminuem) a medida.",
        when: "Entender o que está por trás de um resultado alto ou baixo.",
        fields: ["Analisar: a medida", "Explicar por: as dimensões a testar"],
        extras: ["Mostra associação, não causa", "Ignora segmentos pequenos demais"] },
      { id: "decomp", name: "Árvore de decomposição", what: "Parte do total e abre nível a nível pela dimensão que você escolher.",
        when: "Investigar de onde vem um número, clicando no caminho.",
        fields: ["Analisar: a medida", "Níveis: escolhidos durante a exploração"] },
      { id: "narrative", name: "Narrativa automática", what: "Frases escritas a partir dos dados: total, evolução, picos e quem lidera.",
        when: "Um resumo em texto para quem não quer ler gráficos.",
        fields: ["Medida", "Comparar com (opcional)", "Eixo de tempo (opcional)", "Explicar por (opcional)"] },
    ],
  },
  {
    id: "geografia", name: "Geografia", intro: "Para dados com localização no Brasil.",
    items: [
      { id: "map", name: "Mapa do Brasil", what: "Os estados pintados pela medida, com os contornos oficiais do IBGE.",
        when: "Comparar estados ou regiões no mapa.",
        fields: ["Localização: UF, nome do estado, código IBGE ou região", "Cor: uma medida"] },
      { id: "bubblemap", name: "Mapa de bolhas", what: "Uma bolha por local, do tamanho da medida.",
        when: "Lojas, cidades ou clientes no mapa.",
        fields: ["Local: uma bolha por valor", "Tamanho: uma medida", "Cor (opcional): outra medida"],
        extras: ["Latitude e longitude opcionais; sem elas, usa o centro da UF"] },
    ],
  },
  {
    id: "interacao", name: "Interação e layout", intro: "Para filtrar, simular, explicar e navegar.",
    items: [
      { id: "slicer", name: "Segmentação", what: "Um filtro clicável na página.",
        when: "Deixar quem lê escolher o recorte: região, período, produto.",
        fields: ["Campo: a coluna a filtrar"],
        extras: ["Lista, lista suspensa, intervalo “entre” ou data relativa (“últimos 30 dias”)"] },
      { id: "fieldparam", name: "Parâmetro de campo", what: "Botões que trocam o eixo de outros visuais.",
        when: "Um único gráfico que mostra por região, por loja ou por produto.",
        fields: ["Campos oferecidos"], extras: ["Os visuais ligados trocam de eixo juntos"] },
      { id: "whatif", name: "Parâmetro “e se”", what: "Um controle deslizante cujo valor as medidas podem usar.",
        when: "Simular cenários: aumento de preço, desconto, meta.",
        fields: ["Nome, mínimo, máximo e passo"], extras: ["Use [Nome] em qualquer fórmula"] },
      { id: "text", name: "Caixa de texto", what: "Títulos, explicações e números que se atualizam com os filtros.",
        when: "Contextualizar a página e destacar conclusões.",
        fields: ["Texto, com [Medida] para valores dinâmicos"], extras: ["Listas, links, alinhamento e tamanho"] },
      { id: "image", name: "Imagem", what: "Logotipo ou imagem de apoio.",
        when: "Identidade visual e ilustrações.",
        fields: ["Arquivo enviado ou endereço da imagem"], extras: ["Ajustar ou preencher o espaço"] },
      { id: "button", name: "Botão", what: "Leva a outra página ou aplica um indicador salvo.",
        when: "Montar navegação e roteiros de leitura.",
        fields: ["Ação: ir para uma página ou aplicar um indicador"] },
      { id: "gantt", name: "Gantt", what: "Barras de tarefas no tempo, com % concluído e a linha de hoje.",
        when: "Acompanhar cronogramas e projetos.",
        fields: ["Tarefa", "Início e Fim: colunas de data", "% concluído (opcional)"], extras: ["Cor por grupo"] },
    ],
  },
];

// ---------------- Miniaturas ----------------
// Classes: y = amarelo, r = vermelho, s = amarelo claro, n = neutro, l = traço.

const W = 120;
const H = 72;
const svg = (body: string) => `<svg class="mini" viewBox="0 0 ${W} ${H}" aria-hidden="true">${body}</svg>`;
const rect = (x: number, y: number, w: number, h: number, c: string, rx = 2) =>
  `<rect class="${c}" x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}"/>`;
const circle = (x: number, y: number, r: number, c: string) => `<circle class="${c}" cx="${x}" cy="${y}" r="${r}"/>`;
const poly = (pts: number[][], c: string) => `<polyline class="${c}" points="${pts.map((p) => p.join(",")).join(" ")}"/>`;
const path = (d: string, c: string) => `<path class="${c}" d="${d}"/>`;
const text = (x: number, y: number, t: string, c: string, size = 10) =>
  `<text class="${c}" x="${x}" y="${y}" font-size="${size}" text-anchor="middle">${t}</text>`;

const V = [30, 44, 36, 52, 46, 60];
const cols = (vals: number[], c = (i: number) => (i % 2 ? "s" : "y")) =>
  vals.map((v, i) => rect(12 + i * 17, 66 - v, 12, v, c(i))).join("");
const linePts = (vals: number[]) => vals.map((v, i) => [12 + i * 19, 66 - v]);
const arc = (r: number, a0: number, a1: number, cx = 60, cy = 36) => {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  return `M${x0.toFixed(1)} ${y0.toFixed(1)} A${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`;
};
const ring = (r: number, w: number, parts: [number, string][], cx = 60, cy = 36) => {
  let a = -Math.PI / 2;
  return parts.map(([f, c]) => {
    const a1 = a + f * 2 * Math.PI;
    const d = arc(r, a, a1 - 0.04, cx, cy);
    a = a1;
    return `<path class="${c} ring" stroke-width="${w}" d="${d}"/>`;
  }).join("");
};

const MINI: Record<string, () => string> = {
  bar: () => cols(V),
  hbar: () => [52, 44, 36, 28, 18].map((v, i) => rect(10, 8 + i * 12, v * 1.8, 8, i ? "s" : "y")).join(""),
  stacked: () => V.map((v, i) => rect(12 + i * 17, 66 - v, 12, v * 0.55, "y") + rect(12 + i * 17, 66 - v * 0.45, 12, v * 0.45, "r")).join(""),
  stacked100: () => [0.6, 0.45, 0.7, 0.5, 0.35, 0.55].map((f, i) => rect(12 + i * 17, 6, 12, 60 * f, "y") + rect(12 + i * 17, 6 + 60 * f, 12, 60 * (1 - f), "r")).join(""),
  combo: () => cols(V, () => "s") + poly(linePts([20, 34, 28, 46, 40, 54]).map(([x, y]) => [x + 3, y]), "lr"),
  waterfall: () => rect(10, 26, 14, 40, "y") + rect(28, 14, 14, 12, "y") + rect(46, 14, 14, 18, "r") + rect(64, 6, 14, 26, "y") + rect(82, 6, 14, 8, "r") + rect(100, 14, 14, 52, "n"),
  pareto: () => cols([58, 44, 30, 20, 12, 8]) + poly([[18, 40], [35, 26], [52, 17], [69, 12], [86, 9], [103, 7]], "lr") + `<line class="dash" x1="8" x2="114" y1="14" y2="14"/>`,
  funnel: () => [100, 78, 56, 36].map((w, i) => rect(60 - w / 2, 6 + i * 16, w, 12, i % 2 ? "s" : "y")).join(""),
  dumbbell: () => [[20, 70], [36, 58], [28, 90], [50, 80]].map(([a, b], i) => `<line class="l" x1="${a}" x2="${b}" y1="${12 + i * 16}" y2="${12 + i * 16}"/>` + circle(a, 12 + i * 16, 4, "n") + circle(b, 12 + i * 16, 4, "r")).join(""),
  line: () => poly(linePts([18, 30, 24, 40, 34, 52]), "lr") + linePts([18, 30, 24, 40, 34, 52]).map(([x, y]) => circle(x, y, 2.5, "r")).join(""),
  area: () => path(`M12 66 L${linePts([18, 30, 24, 40, 34, 52]).map((p) => p.join(" ")).join(" L")} L107 66 Z`, "s") + poly(linePts([18, 30, 24, 40, 34, 52]), "ly"),
  area100: () => path("M12 66 L12 30 L31 36 L50 26 L69 32 L88 22 L107 28 L107 66 Z", "y") + path("M12 6 L107 6 L107 28 L88 22 L69 32 L50 26 L31 36 L12 30 Z", "r"),
  bump: () => poly([[12, 12], [40, 30], [68, 20], [100, 12]], "lr") + poly([[12, 30], [40, 12], [68, 40], [100, 30]], "ly") + poly([[12, 48], [40, 48], [68, 12], [100, 48]], "ln"),
  calendar: () => Array.from({ length: 7 * 12 }, (_, i) => rect(8 + Math.floor(i / 7) * 9, 6 + (i % 7) * 9, 7, 7, ["s", "y", "s", "r", "y", "s", "n"][(i * 5) % 7], 1.5)).join(""),
  pie: () => ring(24, 12, [[0.45, "y"], [0.3, "r"], [0.25, "n"]]),
  treemap: () => rect(8, 6, 56, 60, "y") + rect(66, 6, 46, 34, "r") + rect(66, 42, 24, 24, "s") + rect(92, 42, 20, 24, "n"),
  sunburst: () => ring(14, 10, [[0.55, "y"], [0.45, "r"]]) + ring(27, 9, [[0.3, "s"], [0.25, "y"], [0.25, "r"], [0.2, "n"]]),
  waffle: () => Array.from({ length: 50 }, (_, i) => rect(20 + (i % 10) * 8.5, 6 + Math.floor(i / 10) * 12.5, 7, 10.5, i < 28 ? "y" : i < 40 ? "r" : "n", 1.5)).join(""),
  pictogram: () => Array.from({ length: 12 }, (_, i) => {
    const x = 18 + (i % 6) * 17;
    const y = 18 + Math.floor(i / 6) * 28;
    const c = i < 9 ? (i < 6 ? "y" : "r") : "n";
    return circle(x, y - 5, 4, c) + path(`M${x - 6} ${y + 9} Q${x} ${y - 4} ${x + 6} ${y + 9} Z`, c);
  }).join(""),
  scatter: () => [[20, 50, 4], [30, 40, 6], [44, 44, 3], [52, 30, 5], [64, 34, 7], [76, 22, 4], [88, 18, 6], [100, 12, 3], [40, 22, 3]]
    .map(([x, y, r], i) => circle(x, y, r, i === 8 ? "r" : "y")).join(""),
  heatmap: () => Array.from({ length: 30 }, (_, i) => rect(10 + (i % 6) * 17, 6 + Math.floor(i / 6) * 12.5, 15, 11, ["s", "y", "r", "n", "y", "s"][(i * 7) % 6], 1.5)).join(""),
  histogram: () => [8, 18, 34, 54, 44, 26, 12].map((v, i) => rect(10 + i * 14.5, 66 - v, 14, v, "y", 0)).join(""),
  boxplot: () => [[22, 30, 18, 46, 10, 56], [60, 22, 12, 38, 6, 50], [98, 34, 24, 52, 16, 62]].map(([x, q1, med, q3, lo, hi]) =>
    `<line class="l" x1="${x}" x2="${x}" y1="${lo}" y2="${hi}"/>` + rect(x - 10, med, 20, q3 - med, "s", 2) + `<line class="lr" x1="${x - 10}" x2="${x + 10}" y1="${q1}" y2="${q1}"/>`).join(""),
  violin: () => [24, 60, 96].map((x, i) => path(`M${x} 6 C${x + 12 + i * 3} 20 ${x + 4} 40 ${x + 14 - i * 2} 54 C${x + 6} 62 ${x} 66 ${x} 66 C${x} 66 ${x - 6} 62 ${x - 14 + i * 2} 54 C${x - 4} 40 ${x - 12 - i * 3} 20 ${x} 6 Z`, i === 1 ? "r" : "y")).join(""),
  radar: () => {
    const pt = (r: number, k: number) => [60 + r * Math.cos(-Math.PI / 2 + k * Math.PI * 2 / 5), 38 + r * Math.sin(-Math.PI / 2 + k * Math.PI * 2 / 5)];
    const shape = (rs: number[], c: string) => `<polygon class="${c}" points="${rs.map((r, k) => pt(r, k).join(",")).join(" ")}"/>`;
    return shape([30, 30, 30, 30, 30], "grid") + shape([26, 18, 28, 14, 22], "sr") + shape([16, 28, 14, 26, 18], "sy");
  },
  sankey: () => path("M14 8 C60 8 60 14 106 14 L106 30 C60 30 60 28 14 28 Z", "y") + path("M14 30 C60 30 60 46 106 46 L106 64 C60 64 60 50 14 50 Z", "r") + path("M14 52 C60 52 60 32 106 32 L106 44 C60 44 60 64 14 64 Z", "s"),
  card: () => text(60, 44, "R$ 7,5 mi", "big", 18) + text(60, 60, "Faturamento", "small", 8),
  multicard: () => [0, 1, 2].map((i) => rect(6 + i * 38, 14, 34, 44, "card", 4) + text(23 + i * 38, 38, ["12,4", "8,1", "5,7"][i], "num", 10) + text(23 + i * 38, 50, ["Sul", "Norte", "Leste"][i], "small", 6)).join(""),
  kpi: () => text(38, 32, "2.357", "big", 16) + text(38, 46, "▲ 27,9%", "up", 9) + poly([[74, 54], [82, 46], [90, 50], [98, 36], [108, 30]], "lr") + rect(14, 58, 60, 4, "n", 2) + rect(14, 58, 48, 4, "y", 2),
  gauge: () => `<path class="n ring" stroke-width="12" d="${arc(32, Math.PI, 2 * Math.PI, 60, 58)}"/><path class="y ring" stroke-width="12" d="${arc(32, Math.PI, 1.7 * Math.PI, 60, 58)}"/>` +
    `<line class="lr" x1="${60 + 26 * Math.cos(1.85 * Math.PI)}" y1="${58 + 26 * Math.sin(1.85 * Math.PI)}" x2="${60 + 40 * Math.cos(1.85 * Math.PI)}" y2="${58 + 40 * Math.sin(1.85 * Math.PI)}"/>` + text(60, 58, "84%", "num", 11),
  bullet: () => [0, 1, 2].map((i) => rect(10, 10 + i * 20, 100, 12, "n", 1) + rect(10, 10 + i * 20, 70, 12, "s", 1) + rect(10, 13 + i * 20, [62, 84, 48][i], 6, "y", 1) + `<line class="lr" x1="${[80, 76, 70][i]}" x2="${[80, 76, 70][i]}" y1="${8 + i * 20}" y2="${24 + i * 20}"/>`).join(""),
  table: () => rect(8, 6, 104, 12, "y", 2) + [0, 1, 2, 3].map((i) => rect(8, 22 + i * 11, 104, 9, i % 2 ? "card" : "n", 1) + rect(70, 24 + i * 11, [36, 26, 18, 10][i], 5, "r", 1)).join(""),
  matrix: () => rect(8, 6, 104, 10, "y", 2) + rect(8, 18, 30, 48, "s", 2) + Array.from({ length: 12 }, (_, i) => rect(42 + (i % 3) * 23, 18 + Math.floor(i / 3) * 12, 21, 10, ["n", "r", "n", "y"][(i * 3) % 4], 1)).join(""),
  influencers: () => [50, 38, 28, 18].map((w, i) => text(26, 15 + i * 15, ["Sul", "Promo", "Sáb.", "Novo"][i], "small", 7) + rect(44, 8 + i * 15, w * 1.3, 9, i ? "s" : "r", 2)).join(""),
  decomp: () => rect(8, 30, 22, 12, "y", 2) + [0, 1, 2].map((i) => `<path class="l fl" d="M30 36 C40 36 40 ${14 + i * 22} 50 ${14 + i * 22}"/>` + rect(50, 8 + i * 22, [30, 22, 14][i], 12, i ? "s" : "r", 2)).join("") +
    `<path class="l fl" d="M80 14 C88 14 88 14 96 14"/>` + rect(96, 8, 16, 12, "y", 2),
  narrative: () => [96, 80, 100, 70, 88].map((w, i) => rect(10, 10 + i * 11, w, 5, i === 1 ? "r" : i === 3 ? "y" : "n", 2.5)).join(""),
  map: () => path("M40 8 L66 6 L84 16 L100 18 L104 30 L92 44 L80 60 L64 66 L54 56 L44 44 L28 38 L18 24 Z", "s") +
    path("M66 6 L84 16 L100 18 L104 30 L88 30 L74 22 Z", "y") + path("M64 44 L80 44 L80 60 L64 66 L56 56 Z", "r"),
  bubblemap: () => path("M40 8 L66 6 L84 16 L100 18 L104 30 L92 44 L80 60 L64 66 L54 56 L44 44 L28 38 L18 24 Z", "n") +
    [[72, 48, 9, "r"], [86, 26, 6, "y"], [50, 24, 4, "y"], [64, 60, 5, "r"], [38, 32, 3, "y"]].map(([x, y, r, c]) => circle(x as number, y as number, r as number, `${c} op`)).join(""),
  slicer: () => [0, 1, 2, 3].map((i) => rect(14, 8 + i * 15, 9, 9, i === 1 || i === 2 ? "y" : "card", 2) + rect(30, 10 + i * 15, [50, 38, 60, 30][i], 5, "n", 2.5)).join(""),
  fieldparam: () => ["Região", "Loja", "Produto"].map((t, i) => rect(6 + i * 37, 24, 34, 22, i === 0 ? "r" : "card", 11) + text(23 + i * 37, 38, t, i === 0 ? "inv" : "small", 7)).join(""),
  whatif: () => text(60, 22, "Aumento de preço: 8%", "small", 8) + rect(12, 36, 96, 6, "n", 3) + rect(12, 36, 46, 6, "y", 3) + circle(58, 39, 7, "r") + text(60, 62, "0%   ·   20%", "small", 7),
  text: () => text(60, 22, "Resultado 2026", "big", 11) + rect(16, 32, 88, 5, "n", 2.5) + rect(16, 42, 70, 5, "n", 2.5) + rect(16, 52, 40, 5, "y", 2.5),
  image: () => rect(14, 8, 92, 56, "s", 6) + circle(40, 28, 7, "y") + path("M14 58 L44 36 L62 50 L78 38 L106 60 L106 64 L14 64 Z", "r"),
  button: () => rect(22, 24, 76, 24, "r", 12) + text(60, 40, "Ver detalhes →", "inv", 9),
  gantt: () => [[10, 40, "y"], [30, 34, "r"], [52, 44, "y"], [74, 34, "s"]].map(([x, w, c], i) => rect(x as number, 8 + i * 14, w as number, 9, c as string, 2)).join("") +
    `<line class="dash" x1="64" x2="64" y1="4" y2="68"/>`,
};

export function mini(id: string): string {
  return svg((MINI[id] ?? MINI.bar)());
}

export const VISUAL_COUNT = VISUAL_GROUPS.reduce((n, g) => n + g.items.length, 0);
