// Site público: páginas de apresentação servidas a quem ainda não entrou (e,
// fora o "/", também a quem já entrou). Cada página tem endereço próprio; o
// topo traz o menu e o "Entrar com Google". Cores da marca: amarelo e vermelho.

import { mini, VISUAL_COUNT, VISUAL_GROUPS } from "./site-visuals.ts";
import { formatPrice, planOfVisual, PLANS, visualsOf } from "../src/model/plans.ts";
import type { VisualType } from "../src/model/types.ts";

/** Nome de cada visual, como nas fichas. */
const VISUAL_NAME = new Map(VISUAL_GROUPS.flatMap((g) => g.items.map((v) => [v.id, v.name] as const)));
const planBadge = (type: string) => {
  const p = planOfVisual(type as VisualType);
  return `<span class="plan-badge p-${p.id}">${p.name}</span>`;
};
const priceTag = (price: number) =>
  price === 0 ? `<b>Grátis</b>` : `<b>${formatPrice(price)}</b><span>/mês</span>`;

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

export interface SiteContext {
  clientId: string;
  /** O que falta configurar no login (vazio = pronto). */
  problems: string[];
  /** Quem já entrou (o topo troca o login por "Abrir meus relatórios"). */
  user?: { name: string } | null;
}

interface Page {
  title: string;
  description: string;
  body: () => string;
}

const MARK = `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true"><rect x="3" y="17" width="7" height="12" rx="1.5"/><rect x="12.5" y="10" width="7" height="19" rx="1.5"/><rect x="22" y="3" width="7" height="26" rx="1.5"/></svg>`;

const ICON: Record<string, string> = {
  upload: '<path d="M12 16V4m0 0L7 9m5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>',
  steps: '<path d="M4 6h10M4 12h16M4 18h7"/><circle cx="18" cy="6" r="2"/><circle cx="15" cy="18" r="2"/>',
  model: '<rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="15" width="7" height="6" rx="1"/><path d="M6.5 10v2.5H12V15m5.5-5v2.5H12"/>',
  formula: '<path d="M8 4c-2 0-2.5 1.5-2.8 3.5L4.5 17C4.2 19 3.5 20 2 20"/><path d="M3 9h7"/><path d="m13 11 7 7m0-7-7 7"/>',
  chart: '<path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/>',
  explore: '<circle cx="11" cy="11" r="6"/><path d="m20 20-4.5-4.5M11 8v6m-3-3h6"/>',
  trend: '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14m6-12v14"/>',
  code: '<path d="m8 8-4 4 4 4m8-8 4 4-4 4M14 5l-4 14"/>',
  spark: '<path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5m7 7L18 18M6 18l2.5-2.5m7-7L18 6"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="m8.2 10.8 7.6-3.6m-7.6 6 7.6 3.6"/>',
  cloud: '<path d="M7 18a4 4 0 0 1-.6-8A6 6 0 0 1 18 9a4.5 4.5 0 0 1-.5 9H7z"/><path d="m9.5 13.5 2 2 3.5-3.5"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7m5.5 8.5a6.5 6.5 0 0 0-4-6"/>',
  gauge: '<path d="M4 18a8 8 0 1 1 16 0"/><path d="m12 18 4-6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1 0 1.5-.8 1.5-1.6 0-1.4-1-1.9-1-3 0-.9.7-1.4 1.6-1.4H17a4 4 0 0 0 4-4c0-4.4-4-8-9-8z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7" r="1"/><circle cx="15" cy="7.5" r="1"/>',
  lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-4"/>',
  phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>',
  filter: '<path d="M4 5h16l-6 8v6l-4-2v-4z"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14m0 3h.01"/>',
};
const icon = (name: string) =>
  `<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

const card = (ic: string, title: string, text: string) => `<article class="feature">${icon(ic)}<h3>${title}</h3><p>${text}</p></article>`;
const head = (eyebrow: string, title: string, lead: string, center = false) =>
  `<div class="head${center ? " center" : ""}"><span class="eyebrow">${eyebrow}</span><h2>${title}</h2><p class="lead">${lead}</p></div>`;
const pageHero = (eyebrow: string, title: string, lead: string) =>
  `<section class="page-hero"><div class="wrap"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p class="lead">${lead}</p></div></section>`;
const cta = (title: string, text: string) => `<section class="final"><div class="wrap">
  <h2>${title}</h2><p class="lead">${text}</p><a class="btn primary" href="#topo" data-login>Entrar com Google</a></div></section>`;

/** Prévia do produto na capa. */
const PREVIEW = `<div class="window" aria-hidden="true">
  <div class="win-bar"><i></i><i></i><i></i><span>Vendas 2026 · Visão geral</span></div>
  <div class="win-body">
    <div class="kpis">
      <div class="kpi"><small>Faturamento</small><b>R$ 7,5 mi</b><em class="up">▲ 26,8%</em></div>
      <div class="kpi"><small>Pedidos</small><b>2.357</b><em class="up">▲ 27,9%</em></div>
      <div class="kpi"><small>Ticket médio</small><b>R$ 3.197</b><em class="down">▼ 0,9%</em></div>
    </div>
    <div class="charts">
      <svg class="chart cols" viewBox="0 0 240 120">
        ${[44, 58, 50, 72, 64, 86, 78, 96, 90, 110].map((h, i) => `<rect x="${8 + i * 23}" y="${116 - h}" width="15" height="${h}" rx="3"/>`).join("")}
        <polyline points="${[30, 40, 36, 52, 48, 62, 58, 72, 70, 84].map((h, i) => `${15.5 + i * 23},${110 - h}`).join(" ")}"/>
      </svg>
      <svg class="chart donut" viewBox="0 0 120 120">
        <circle r="40" cx="60" cy="60" class="d0"/><circle r="40" cx="60" cy="60" class="d1"/><circle r="40" cx="60" cy="60" class="d2"/>
        <text x="60" y="58">42%</text><text x="60" y="74" class="sub">Sudeste</text>
      </svg>
    </div>
    <div class="rows">${[92, 74, 61, 47, 33].map((w, i) => `<div><span>${["SP", "MG", "RJ", "PR", "RS"][i]}</span><i style="width:${w}%"></i></div>`).join("")}</div>
  </div>
</div>`;

const FLOW: [string, string, string, string[]][] = [
  ["upload", "Obter", "Traga os dados de onde eles estão.", ["CSV, Excel e JSON", "Tipos detectados automaticamente"]],
  ["steps", "Preparar", "Limpe uma vez, reaplique sempre.", ["Etapas aplicadas em ordem", "Filtrar, substituir, remover duplicadas"]],
  ["model", "Modelar", "Ligue as tabelas num modelo estrela.", ["Relacionamentos", "Colunas calculadas"]],
  ["formula", "Calcular", "Medidas que respondem aos filtros.", ["CALCULATE e iteradores", "Acumulado no ano e ano anterior"]],
  ["chart", "Visualizar", `Páginas interativas com ${VISUAL_COUNT} visuais.`, ["Filtro cruzado e drill-down", "Previsão e anomalias"]],
  ["share", "Compartilhar", "Leve o resultado para quem decide.", ["PNG, PDF e HTML publicado", "Layout para celular"]],
];

const SQL = `<pre aria-label="Exemplo de SQL"><span class="c">-- Faturamento mensal por região, com acumulado e ano anterior</span>
<span class="k">CREATE OR REPLACE TABLE</span> gold_vendas_mensais <span class="k">AS</span>
<span class="k">WITH</span> mensal <span class="k">AS</span> (
  <span class="k">SELECT</span> <span class="f">DATE_TRUNC</span>('month', v.Data) <span class="k">AS</span> mes, l.Região <span class="k">AS</span> regiao,
         <span class="f">SUM</span>(v.Valor) <span class="k">AS</span> faturamento
  <span class="k">FROM</span> Vendas v <span class="k">JOIN</span> Lojas l <span class="k">ON</span> v.LojaID = l.LojaID
  <span class="k">GROUP BY</span> 1, 2
)
<span class="k">SELECT</span> mes, regiao, faturamento,
  <span class="f">SUM</span>(faturamento) <span class="k">OVER</span> (<span class="k">PARTITION BY</span> regiao, <span class="f">YEAR</span>(mes) <span class="k">ORDER BY</span> mes) <span class="k">AS</span> acumulado_ano,
  <span class="f">LAG</span>(faturamento, 12) <span class="k">OVER</span> (<span class="k">PARTITION BY</span> regiao <span class="k">ORDER BY</span> mes) <span class="k">AS</span> ano_anterior
<span class="k">FROM</span> mensal</pre>`;

const FAQ: [string, string][] = [
  ["Preciso instalar alguma coisa?", "Não. Tudo roda no navegador: importar, modelar, calcular e visualizar. Basta entrar com a sua conta Google."],
  ["Como consigo acesso?", "É só entrar com a sua conta Google: no primeiro acesso a sua conta é criada na hora, no plano gratuito, sem esperar aprovação."],
  ["Onde ficam os meus relatórios?", "Na sua conta, num banco de dados. Cada pessoa vê só os próprios relatórios, e cada alteração é salva sozinha em poucos segundos."],
  ["Quais arquivos posso importar?", "CSV (o separador é detectado), Excel .xlsx (todas as planilhas) e JSON (listas de objetos; campos aninhados viram colunas como endereco.cidade)."],
  ["Preciso saber programar?", "Não. Visuais, filtros e a maioria das medidas se montam pela tela. Fórmulas e SQL estão lá para quem quiser ir além, e a IA monta painéis a partir de um pedido em texto."],
  ["A IA envia meus dados para fora?", "Não. O assistente usa um modelo que roda no seu computador (Ollama) e recebe só a estrutura do modelo — nomes de tabelas, colunas e medidas."],
  ["Posso compartilhar um painel com quem não usa a ferramenta?", "Sim. Publique o relatório como um arquivo HTML único: quem recebe abre no navegador, filtra e navega, sem poder editar. Também dá para exportar a página em PNG ou PDF."],
  ["Funciona no celular?", "O relatório tem um layout para celular, com os visuais empilhados na ordem de leitura. O relatório publicado troca para ele sozinho em telas pequenas."],
  ["Posso desfazer um erro?", "Sim: Ctrl+Z e Ctrl+Y desfazem e refazem até 100 passos. Tudo o que a IA cria entra como um passo só."],
  ["O que acontece se eu abrir o mesmo relatório em duas abas?", "O salvamento automático percebe que a outra aba salvou antes e para; ao salvar, o app pergunta se você quer sobrescrever."],
];

// ---------------- Páginas ----------------

const PAGES: Record<string, Page> = {
  "/": {
    title: "Dantreun Analytics · Análise de dados e dashboards no navegador",
    description: "Importe, modele, calcule e visualize seus dados em dashboards interativos, direto do navegador.",
    body: () => `
  <section class="hero">
    <div class="wrap hero-grid">
      <div>
        <span class="eyebrow">Análise de dados no navegador</span>
        <h1>Seus dados viram <em>decisões</em>.</h1>
        <p class="lead">Importe planilhas, modele as tabelas, crie medidas e monte dashboards interativos — sem instalar nada. Seus relatórios ficam salvos na sua conta.</p>
        <div class="cta">
          <a class="btn primary" href="#topo" data-login>Entrar com Google</a>
          <a class="btn" href="/recursos">Conhecer os recursos →</a>
        </div>
        <div class="stats">
          <div><b>${VISUAL_COUNT}</b><span>tipos de visual</span></div>
          <div><b>0</b><span>instalação</span></div>
          <div><b>IA</b><span>que monta o painel</span></div>
          <div><b>27</b><span>UFs no mapa do Brasil</span></div>
        </div>
      </div>
      <div>${PREVIEW}</div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      ${head("Como funciona", "Do dado bruto à decisão, num lugar só", "Seis etapas, todas na mesma ferramenta.", true)}
      <ol class="steps">${FLOW.map(([ic, t, p, items]) => `<li class="reveal">${icon(ic)}<h3>${t}</h3><p>${p}</p><ul>${items.map((x) => `<li>${x}</li>`).join("")}</ul></li>`).join("")}</ol>
    </div>
  </section>
  <section>
    <div class="wrap">
      ${head("Explore", "Conheça cada parte da ferramenta", "Escolha por onde começar.", true)}
      <div class="tiles">
        ${[
          ["/recursos", "chart", "Recursos", "Importação, modelagem, fórmulas, análises, notebooks SQL e publicação."],
          ["/visuais", "trend", `${VISUAL_COUNT} visuais`, "Cada componente explicado: o que mostra, quando usar e quais campos preencher."],
          ["/ia", "spark", "Assistente de IA", "Peça o painel em português e veja a IA montar página, medidas e visuais."],
          ["/seguranca", "lock", "Segurança e acesso", "Login com Google, conta criada na hora e relatórios separados por pessoa."],
          ["/planos", "cloud", "Planos", "Do gratuito ao avançado: o que cada plano libera e quanto custa."],
          ["/duvidas", "question", "Dúvidas", "Instalação, arquivos aceitos, celular, compartilhamento e mais."],
        ].map(([href, ic, t, d]) => `<a class="tile reveal" href="${href}">${icon(ic)}<span><strong>${t}</strong><span>${d}</span></span><b aria-hidden="true">→</b></a>`).join("")}
      </div>
    </div>
  </section>
  ${cta("Comece a analisar os seus dados", "Entre com a sua conta Google: a sua conta gratuita é criada na hora.")}`,
  },

  "/recursos": {
    title: "Recursos · Dantreun Analytics",
    description: "Importação, preparação, modelagem, fórmulas, análises, notebooks SQL e publicação.",
    body: () => `
  ${pageHero("Recursos", "Tudo o que um time de dados precisa", "Da importação ao compartilhamento, com análises avançadas e um assistente de IA — tudo no navegador.")}
  <section>
    <div class="wrap">
      ${head("Dados", "Traga e prepare os dados", "Importe arquivos e deixe as tabelas prontas para analisar, com etapas que se repetem a cada atualização.")}
      <div class="grid">
        ${card("upload", "Importação", "CSV com separador detectado, Excel com todas as planilhas e JSON com campos aninhados achatados (endereco.cidade).")}
        ${card("steps", "Editor de consultas", "Etapas aplicadas: tipo detectado, renomear, mudar tipo, remover coluna, filtrar linhas, substituir valores, remover duplicadas e linhas em branco.")}
        ${card("filter", "Etapas sob controle", "Exclua qualquer etapa e a tabela é refeita na hora; etapas com erro ficam marcadas, com o motivo.")}
      </div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      ${head("Modelagem e fórmulas", "Um modelo que entende o seu negócio", "Ligue as tabelas e crie medidas que se recalculam a cada filtro.")}
      <div class="grid">
        ${card("model", "Relacionamentos", "Tabelas de fatos e de dimensões ligadas muitos-para-um; os filtros fluem da dimensão para os fatos.")}
        ${card("formula", "Medidas", "SUM, AVERAGE, DISTINCTCOUNT, DIVIDE, IF, CALCULATE com ALL e filtros, e iteradores como SUMX e FILTER.")}
        ${card("trend", "Inteligência de tempo", "Acumulado no ano, mesmo período do ano anterior e deslocamentos de dia, mês, trimestre ou ano.")}
        ${card("steps", "Colunas calculadas", "Valores calculados linha a linha, inclusive buscando dados de outra tabela com RELATED.")}
        ${card("gauge", "Parâmetros “e se”", "Um controle deslizante cujo valor entra nas fórmulas: simule aumento de preço, desconto ou meta.")}
        ${card("chart", "Hierarquia de datas", "Toda coluna de data vira ano › trimestre › mês › dia, pronta para o drill-down.")}
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      ${head("Exploração e análises", "Pergunte e aprofunde direto nos gráficos", "Interações que respondem na hora e análises que fariam um analista perder horas.")}
      <div class="grid">
        ${card("explore", "Filtro cruzado e drill", "Clique num gráfico para filtrar os outros; desça de ano para mês com drill-down; abra a página de detalhe de um item com drill-through.")}
        ${card("filter", "Painel de filtros", "Filtros para um visual, para a página ou para o relatório inteiro, por lista de valores ou por intervalo.")}
        ${card("trend", "Previsão e anomalias", "Projete a série com faixa de 80, 90 ou 95% e destaque pontos fora da tendência.")}
        ${card("spark", "Influenciadores e decomposição", "Descubra o que mais pesa num resultado e abra o total nível a nível, do jeito que quiser.")}
        ${card("chart", "Linhas de referência", "Meta, média, mediana, mínimo ou máximo desenhados sobre colunas, barras, linhas e áreas.")}
        ${card("map", "Mapas do Brasil", "Estados pintados pela medida, com os contornos oficiais do IBGE, e mapas de bolhas por cidade ou loja.")}
      </div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap split">
      <div>
        <span class="eyebrow">Notebooks SQL</span>
        <h2>SQL de verdade, sobre o seu modelo</h2>
        <p class="lead">Células de SQL e de texto executadas sobre as tabelas do relatório, com resultado em tabela, gráfico ou plano de execução.</p>
        <ul class="checks"><li>JOIN, GROUP BY, funções de janela e CTE</li><li>CREATE TABLE … AS grava uma tabela nova no modelo</li><li>A tabela criada vira campo para qualquer visual</li></ul>
      </div>
      ${SQL}
    </div>
  </section>
  <section>
    <div class="wrap">
      ${head("Compartilhar e trabalhar em equipe", "Do painel para quem decide", "Publique, exporte e mantenha cada relatório salvo e organizado.")}
      <div class="grid">
        ${card("share", "Publicação", "Um arquivo HTML único, somente leitura, que abre em qualquer navegador — com filtros e navegação funcionando.")}
        ${card("phone", "Layout para celular", "Os visuais empilhados na ordem de leitura; o relatório publicado troca para ele sozinho em telas pequenas.")}
        ${card("upload", "PNG e PDF", "Exporte a página como imagem ou imprima em PDF, sem os botões de edição.")}
        ${card("cloud", "Salvo na sua conta", "Relatórios na nuvem com salvamento automático; abra de qualquer computador.")}
        ${card("users", "Gestão de usuários", "Cadastro na hora com a conta Google, planos por conta, administradores e bloqueio imediato.")}
        ${card("palette", "Temas e indicadores", "Tema claro ou escuro, paletas de cores e indicadores que guardam filtros e drill.")}
        ${card("gauge", "Analisador de desempenho", "Tempo, linhas percorridas e acertos de cache de cada visual da página.")}
        ${card("undo", "Desfazer e refazer", "Até 100 passos, com arrastos e digitação agrupados num passo só.")}
        ${card("chart", "Organizar a página", "Seleção múltipla, alinhar, distribuir, igualar tamanhos e agrupar visuais.")}
      </div>
    </div>
  </section>
  ${cta("Veja tudo isso com os seus dados", "Entre com a sua conta Google — é gratuito — e comece por um relatório em branco ou pelo modelo de vendas.")}`,
  },

  "/visuais": {
    title: "Visuais · Dantreun Analytics",
    description: `Os ${VISUAL_COUNT} visuais explicados: o que cada um mostra, quando usar e quais campos preencher.`,
    body: () => `
  ${pageHero("Visualizações", `${VISUAL_COUNT} visuais, cada um explicado`, "Para cada componente: o que ele mostra, quando usar, quais campos preencher no painel de propriedades e as opções extras. Todos são interativos — clique para filtrar os outros visuais e exporte os dados de cada um.")}
  <nav class="subnav" aria-label="Grupos de visuais"><div class="wrap">
    ${VISUAL_GROUPS.map((g) => `<a href="#${g.id}">${g.name} <small>${g.items.length}</small></a>`).join("")}
  </div></nav>
  ${VISUAL_GROUPS.map((g, gi) => `<section id="${g.id}" class="${gi % 2 ? "alt " : ""}vsec">
    <div class="wrap">
      <div class="head"><h2>${g.name}</h2><p class="lead">${g.intro}</p></div>
      <div class="vgrid">
        ${g.items.map((v) => `<article class="vcard reveal" id="v-${v.id}">
          <div class="vart">${mini(v.id)}</div>
          <div class="vbody">
            <h3>${v.name} ${planBadge(v.id)}</h3>
            <p>${v.what}</p>
            <p class="when"><strong>Quando usar:</strong> ${v.when}</p>
            <div class="fields"><span>Campos</span><ul>${v.fields.map((f) => {
              const [k, ...rest] = f.split(": ");
              return `<li>${rest.length ? `<b>${k}</b>: ${rest.join(": ")}` : f}</li>`;
            }).join("")}</ul></div>
            ${v.extras?.length ? `<div class="extras">${v.extras.map((x) => `<span>${x}</span>`).join("")}</div>` : ""}
          </div>
        </article>`).join("")}
      </div>
    </div>
  </section>`).join("")}
  <section>
    <div class="wrap">
      ${head("Em todos os visuais", "O que vale para qualquer componente", "Recursos do cabeçalho de cada visual e do painel de filtros.", true)}
      <div class="grid">
        ${card("explore", "Filtro cruzado", "Clique num ponto, barra ou fatia para filtrar a página; Ctrl+clique acumula seleções.")}
        ${card("chart", "Mostrar como tabela", "Troque o gráfico pelos números que ele desenha, e volte com um clique.")}
        ${card("upload", "Exportar dados", "Baixe em CSV os dados agregados que o visual mostra.")}
        ${card("filter", "Filtros do visual", "Restrinja só aquele visual, por lista de valores ou por intervalo.")}
        ${card("trend", "Modo foco", "Abra o visual na área inteira do relatório para ler os detalhes.")}
        ${card("palette", "Formatação condicional", "Barras de dados, escala de cores e regras com ícones em tabelas, matrizes e cartões.")}
      </div>
    </div>
  </section>
  ${cta("Monte o seu primeiro painel", "Entre com a sua conta Google e arraste os campos para os visuais.")}`,
  },

  "/ia": {
    title: "Assistente de IA · Dantreun Analytics",
    description: "Peça o painel em português: a IA cria medidas, escolhe os visuais e organiza a página.",
    body: () => `
  ${pageHero("Assistente de IA", "Peça o painel em português", "Escreva o que quer ver e a IA monta a página: cria as medidas que faltam, escolhe os visuais e organiza o layout.")}
  <section>
    <div class="wrap split">
      <div>
        <span class="eyebrow">Exemplo</span>
        <h2>“Total de vendas por estado”</h2>
        <p class="lead">Em segundos, uma página nova com os cartões dos totais, o mapa do Brasil e o ranking dos estados — tudo ligado ao seu modelo.</p>
        <ul class="checks"><li>Confere cada tabela, coluna e fórmula antes de criar</li><li>Corrige sozinha o que não bater com o modelo</li><li>Um Ctrl+Z desfaz tudo o que ela criou</li></ul>
      </div>
      <div class="chat" aria-hidden="true">
        <div class="bubble me">Total de vendas por estado</div>
        <div class="bubble ai">Montei um painel com o total de vendas e a distribuição por estado.
          <ul><li>Medida [Total de Vendas] = SUM(Vendas[Valor])</li><li>Página “Vendas por Estado”</li><li>Cartões: Total de Vendas, Pedidos</li><li>Mapa do Brasil e ranking por UF</li></ul>
        </div>
      </div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      ${head("Como funciona", "Quatro passos, do pedido ao painel", "A IA planeja; o app confere e monta.", true)}
      <ol class="steps four">
        <li class="reveal">${icon("question")}<h3>Você pede</h3><p>Em português, do jeito que falaria com um analista.</p></li>
        <li class="reveal">${icon("spark")}<h3>A IA planeja</h3><p>Com base nas tabelas, colunas e medidas do seu modelo, devolve um plano de página.</p></li>
        <li class="reveal">${icon("lock")}<h3>O app confere</h3><p>Cada campo e cada fórmula é validado; o que não existe volta para a IA corrigir.</p></li>
        <li class="reveal">${icon("chart")}<h3>Pronto</h3><p>A página aparece montada e organizada, e continua editável como qualquer outra.</p></li>
      </ol>
    </div>
  </section>
  <section>
    <div class="wrap">
      ${head("Privacidade", "Seus dados não saem do seu computador", "O assistente usa um modelo de linguagem que roda localmente, com o Ollama.", true)}
      <div class="grid">
        ${card("lock", "Roda localmente", "O modelo fica no seu computador; nenhum serviço externo de IA recebe o seu pedido.")}
        ${card("model", "Só a estrutura", "A IA vê nomes de tabelas, colunas e medidas e alguns exemplos de valores de texto — não as suas linhas de dados.")}
        ${card("spark", "Modelos abertos", "Funciona com modelos como Qwen e Llama; os de 7 bilhões de parâmetros ou mais acertam bem mais os campos.")}
      </div>
    </div>
  </section>
  ${cta("Experimente com os seus dados", "Entre com a sua conta Google e use o botão ✨ IA no editor.")}`,
  },

  "/seguranca": {
    title: "Segurança e acesso · Dantreun Analytics",
    description: "Login com Google, conta criada na hora, relatórios separados por pessoa e bloqueio imediato.",
    body: () => `
  ${pageHero("Segurança e acesso", "Cada pessoa no seu lugar", "Login com Google, conta criada na hora e relatórios separados por pessoa — com administradores de olho.")}
  <section>
    <div class="wrap">
      <div class="grid">
        ${card("lock", "Login com Google", "A conta é verificada pelo Google; ninguém precisa criar nem guardar uma senha nova.")}
        ${card("users", "Conta na hora", "Quem entra com o Google pela primeira vez ganha uma conta gratuita na hora, sem formulário.")}
        ${card("cloud", "Relatórios por conta", "Cada pessoa vê e edita só os próprios relatórios, de qualquer computador.")}
        ${card("filter", "Bloqueio imediato", "Tirar o acesso de alguém derruba a sessão dela no pedido seguinte, mesmo com o app aberto.")}
        ${card("model", "Planos e papéis", "Cada conta tem um plano (do Gratuito ao Avançado); administradores gerenciam as pessoas e os planos.")}
        ${card("share", "Publicação controlada", "Só quem publica decide o que vai no HTML de leitura; o resto continua protegido pelo login.")}
      </div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      ${head("Primeiro acesso", "Como alguém novo entra", "Sem formulário e sem esperar aprovação.", true)}
      <ol class="steps four">
        <li class="reveal">${icon("users")}<h3>Entra com Google</h3><p>A pessoa usa o botão do topo com a conta dela.</p></li>
        <li class="reveal">${icon("cloud")}<h3>Conta criada</h3><p>Na hora, no plano gratuito, com o nome e a foto da conta Google.</p></li>
        <li class="reveal">${icon("chart")}<h3>Primeiro relatório</h3><p>Em branco ou a partir do modelo de vendas, salvo sozinho na conta.</p></li>
        <li class="reveal">${icon("lock")}<h3>Sob controle</h3><p>Administradores trocam o papel ou bloqueiam pela tela Usuários.</p></li>
      </ol>
    </div>
  </section>
  ${cta("Pronto para entrar?", "Use a sua conta Google: a sua conta gratuita é criada na hora.")}`,
  },

  "/planos": {
    title: "Planos · Dantreun Analytics",
    description: "Gratuito, Iniciante, Intermediário e Avançado: os visuais de cada plano e os preços.",
    body: () => `
  ${pageHero("Planos", "Escolha o plano do tamanho da sua análise", "Comece grátis e libere mais visuais quando precisar. Os planos são acumulativos: cada um traz tudo o que o anterior tem.")}
  <section>
    <div class="wrap">
      <div class="plans">
        ${PLANS.map((p, i) => `<article class="plan p-${p.id}${i === PLANS.length - 1 ? " top" : ""}">
          ${i === PLANS.length - 1 ? '<span class="plan-flag">Completo</span>' : ""}
          <h3>${p.name}</h3>
          <div class="price">${priceTag(p.price)}</div>
          <p class="tag">${p.tagline}</p>
          <div class="count"><b>${visualsOf(p.id).length}</b> de ${VISUAL_COUNT} visuais</div>
          <a class="btn ${i === 0 ? "primary" : ""}" href="#topo" data-login>${i === 0 ? "Começar grátis" : "Entrar com Google"}</a>
          <div class="includes">
            <span>${i === 0 ? "Visuais incluídos" : "Tudo do " + PLANS[i - 1].name + ", mais"}</span>
            <ul>${p.adds.map((t) => `<li>${VISUAL_NAME.get(t) ?? t}</li>`).join("")}</ul>
          </div>
        </article>`).join("")}
      </div>
      <p class="plans-note">Valores mensais. Por enquanto, a mudança de plano é feita por um administrador; o pagamento pelo próprio site chega em breve.</p>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      ${head("Em todos os planos", "O que todo mundo tem", "Os planos mudam os visuais disponíveis; o resto da ferramenta é igual para todos.", true)}
      <div class="grid">
        ${card("upload", "Dados e preparo", "Importação de CSV, Excel e JSON e editor de consultas com etapas aplicadas.")}
        ${card("formula", "Modelo e fórmulas", "Relacionamentos, colunas calculadas, medidas e inteligência de tempo.")}
        ${card("explore", "Exploração", "Filtro cruzado, drill-down, drill-through e painel de filtros.")}
        ${card("cloud", "Salvo na sua conta", "Relatórios na nuvem com salvamento automático.")}
        ${card("share", "Publicação", "PNG, PDF e HTML de leitura, com layout para celular.")}
        ${card("spark", "Assistente de IA", "Monta painéis com os visuais do seu plano.")}
      </div>
    </div>
  </section>
  <section>
    <div class="wrap">
      ${head("Comparação", "Todos os visuais, plano a plano", "✓ indica a partir de qual plano o visual fica disponível.", true)}
      <div class="compare-wrap">
        <table class="compare">
          <thead><tr><th>Visual</th>${PLANS.map((p) => `<th>${p.name}<small>${p.price ? formatPrice(p.price) : "Grátis"}</small></th>`).join("")}</tr></thead>
          ${VISUAL_GROUPS.map((g) => `<tbody><tr class="group"><th colspan="${PLANS.length + 1}">${g.name}</th></tr>
            ${g.items.map((v) => {
              const from = PLANS.indexOf(planOfVisual(v.id as VisualType));
              return `<tr><td><a href="/visuais#v-${v.id}">${v.name}</a></td>${PLANS.map((_, i) => `<td>${i >= from ? '<span class="yes" aria-label="incluído">✓</span>' : '<span class="no" aria-label="não incluído">—</span>'}</td>`).join("")}</tr>`;
            }).join("")}</tbody>`).join("")}
        </table>
      </div>
    </div>
  </section>
  <section class="alt">
    <div class="wrap">
      <div class="faq">
        <details open><summary>Posso começar sem pagar?</summary><p>Sim. Toda conta nova começa no plano Gratuito, com 9 visuais e todos os outros recursos da ferramenta.</p></details>
        <details><summary>O que acontece com um relatório que usa visuais de outro plano?</summary><p>Ele continua abrindo e funcionando normalmente. Só não dá para adicionar novos visuais fora do seu plano — eles aparecem com um cadeado no editor.</p></details>
        <details><summary>Como mudo de plano?</summary><p>Por enquanto, um administrador muda o plano da sua conta. A troca vale na hora, sem precisar sair e entrar de novo.</p></details>
      </div>
    </div>
  </section>
  ${cta("Comece pelo plano Gratuito", "Entre com a sua conta Google: a sua conta é criada na hora.")}`,
  },

  "/duvidas": {
    title: "Dúvidas · Dantreun Analytics",
    description: "Perguntas frequentes sobre instalação, arquivos, celular, IA, compartilhamento e acesso.",
    body: () => `
  ${pageHero("Dúvidas frequentes", "Perguntas e respostas", "O que mais nos perguntam sobre a ferramenta.")}
  <section>
    <div class="wrap">
      <div class="faq">${FAQ.map(([q, a], i) => `<details${i === 0 ? " open" : ""}><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
    </div>
  </section>
  ${cta("Ainda com dúvida?", "O melhor jeito de conhecer é usar: entre com a sua conta Google.")}`,
  },
};

const NAV: [string, string][] = [["/", "Início"], ["/recursos", "Recursos"], ["/visuais", "Visuais"], ["/ia", "IA"], ["/planos", "Planos"], ["/seguranca", "Segurança"], ["/duvidas", "Dúvidas"]];

/** Endereços que o site atende. */
export const SITE_PATHS = new Set(Object.keys(PAGES));

export function sitePage(path: string, ctx: SiteContext): string {
  const page = PAGES[path] ?? PAGES["/"];
  const signedIn = !!ctx.user;
  const signIn = signedIn
    ? `<a class="btn primary small" href="/">Abrir meus relatórios →</a>`
    : ctx.problems.length
      ? `<span class="cfg">Login não configurado</span>`
      : `<div id="g_id_onload" data-client_id="${esc(ctx.clientId)}" data-callback="onGoogleLogin" data-auto_prompt="false"></div>
       <div class="g_id_signin full" data-type="standard" data-shape="pill" data-theme="filled_black" data-size="medium"
         data-text="signin_with" data-logo_alignment="left" data-locale="pt-BR"></div>
       <div class="g_id_signin compact" data-type="standard" data-shape="pill" data-theme="filled_black" data-size="small"
         data-text="signin" data-logo_alignment="left" data-locale="pt-BR"></div>`;
  const banner = !signedIn && ctx.problems.length
    ? `<div class="banner" role="alert"><strong>O login ainda não está configurado.</strong> ${ctx.problems.map(esc).join(" ")}
       Preencha o <code>.env</code> (veja <code>.env.example</code>) e reinicie o servidor.</div>`
    : `<div id="msg" class="banner" role="alert" hidden></div>`;
  // Quem já entrou: os botões "Entrar" do meio da página levam direto ao app.
  const body = signedIn ? page.body().replace(/href="#topo" data-login>[^<]*/g, 'href="/">Abrir meus relatórios') : page.body();

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${page.title}</title>
<meta name="description" content="${esc(page.description)}" />
<style>${CSS}</style>
${!signedIn && !ctx.problems.length ? '<script src="https://accounts.google.com/gsi/client" async></script>' : ""}
</head>
<body>
<header id="topo">
  <nav class="wrap nav" aria-label="Principal">
    <a class="logo" href="/">${MARK}<div>Dantreun <span>Analytics</span></div></a>
    <div class="links" id="links">
      ${NAV.map(([href, label]) => `<a href="${href}"${href === path || (!PAGES[path] && href === "/") ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    </div>
    <button class="menu-btn" id="menu" aria-label="Abrir menu" aria-expanded="false" aria-controls="links">☰</button>
    <div class="signin" id="signin">${signedIn ? "" : '<span class="label">Já tem acesso?</span>'}${signIn}</div>
  </nav>
</header>
${banner}
<main>${body}</main>
<footer>
  <div class="wrap">
    <a class="logo" href="/">${MARK}<div>Dantreun <span>Analytics</span></div></a>
    <nav aria-label="Rodapé">${NAV.map(([href, label]) => `<a href="${href}">${label}</a>`).join("")}</nav>
    <span>© ${new Date().getFullYear()} Dantreun Analytics</span>
  </div>
</footer>
<script>${SCRIPT}</script>
</body>
</html>`;
}

// ---------------- Estilo (amarelo e vermelho) ----------------

const CSS = `
  :root {
    color-scheme: light dark;
    --bg: #faf8f5; --bg2: #f3efe9; --card: #ffffff; --text: #1d1a17; --muted: #6b645d; --line: #e8e2da;
    --yellow: #f2c811; --yellow-soft: #fdf1c2; --yellow-ink: #8a6a00;
    --red: #d7263d; --red-dark: #b01e31; --red-soft: #fde4e7;
    --neutral: #e6e0d8; --ink: #1b1816; --shadow: 0 18px 50px rgba(40, 20, 10, .12);
  }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #131110; --bg2: #1a1715; --card: #211d1a; --text: #f5f1ec; --muted: #aaa29a; --line: #332d28;
      --yellow-soft: #4a3d10; --yellow-ink: #f2c811; --red: #ff4d5e; --red-dark: #ff6b79; --red-soft: #3d1a1f;
      --neutral: #3a342f; --shadow: 0 18px 50px rgba(0, 0, 0, .5); }
  }
  * { box-sizing: border-box; }
  html { scroll-padding-top: 150px; }
  html:has(.subnav) { scroll-padding-top: 190px; }
  @media (prefers-reduced-motion: no-preference) { html { scroll-behavior: smooth; } }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 "Segoe UI Variable Text", "Segoe UI", system-ui, -apple-system, sans-serif; }
  a { color: inherit; }
  .wrap { width: min(1160px, 100% - 40px); margin: 0 auto; }
  section { padding: 88px 0; }
  .alt { background: var(--bg2); }
  .eyebrow { display: inline-block; font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--red); margin-bottom: 12px; }
  h1, h2, h3 { letter-spacing: -.02em; line-height: 1.12; margin: 0; }
  h2 { font-size: clamp(28px, 3.4vw, 40px); margin-bottom: 14px; }
  .lead { color: var(--muted); font-size: 18px; max-width: 46rem; margin: 0; }
  .head { margin-bottom: 40px; } .head.center { text-align: center; } .head.center .lead { margin: 0 auto; }

  header { position: sticky; top: 0; z-index: 20; background: color-mix(in srgb, var(--bg) 85%, transparent);
    backdrop-filter: saturate(160%) blur(14px); border-bottom: 1px solid var(--line); }
  header::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: linear-gradient(90deg, var(--yellow), var(--red)); }
  .nav { height: 64px; display: flex; align-items: center; gap: 24px; }
  .logo { display: flex; align-items: center; gap: 10px; font-weight: 650; font-size: 17px; text-decoration: none; white-space: nowrap; }
  .logo span { font-weight: 400; color: var(--muted); }
  .mark { width: 26px; height: 26px; fill: var(--yellow); } .mark rect:last-child { fill: var(--red); }
  .links { display: flex; gap: 2px; margin-right: auto; }
  .links a { text-decoration: none; color: var(--muted); font-size: 15px; padding: 6px 12px; border-radius: 999px; }
  .links a:hover { color: var(--text); background: var(--bg2); }
  .links a[aria-current="page"] { color: var(--text); font-weight: 600; background: var(--yellow-soft); }
  .signin { display: flex; align-items: center; gap: 12px; min-height: 40px; }
  .signin .label { font-size: 14px; color: var(--muted); }
  .g_id_signin { color-scheme: light; } .g_id_signin iframe { color-scheme: normal; } .g_id_signin.compact { display: none; }
  .cfg { font-size: 13px; color: var(--red); }
  .menu-btn { display: none; margin-left: auto; width: 40px; height: 40px; border: 1px solid var(--line); border-radius: 10px; background: var(--card); color: var(--text); font-size: 18px; }
  .banner { position: sticky; top: 66px; z-index: 19; padding: 12px 20px; text-align: center; font-size: 15px; background: var(--red-soft); color: var(--red-dark); }
  .banner.info { background: var(--yellow-soft); color: var(--yellow-ink); }

  .btn { display: inline-flex; align-items: center; gap: 8px; padding: 12px 22px; border-radius: 999px; font-weight: 600; font-size: 15px; text-decoration: none;
    border: 1px solid var(--line); background: var(--card); color: var(--text); cursor: pointer; transition: transform .15s, box-shadow .15s, background .15s; }
  .btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(0, 0, 0, .1); }
  .btn.primary { background: var(--red); color: #fff; border-color: var(--red); }
  .btn.primary:hover { background: var(--red-dark); border-color: var(--red-dark); }
  .btn.small { padding: 8px 16px; font-size: 14px; }

  .hero { padding: 72px 0 88px; position: relative; overflow: hidden; }
  .hero::before { content: ""; position: absolute; inset: -30% -10% auto auto; width: 70%; height: 120%; z-index: -1;
    background: radial-gradient(closest-side, rgba(242, 200, 17, .28), transparent), radial-gradient(closest-side at 35% 75%, rgba(215, 38, 61, .16), transparent); }
  .hero-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr); gap: 56px; align-items: center; }
  .hero h1, .page-hero h1 { font-size: clamp(38px, 5.2vw, 62px); margin-bottom: 20px; }
  h1 em { font-style: normal; background: linear-gradient(90deg, #e9b800, #f2c811 40%, var(--red)); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .cta { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 32px; }
  .stats { display: flex; gap: 32px; margin-top: 44px; flex-wrap: wrap; }
  .stats b { display: block; font-size: 26px; letter-spacing: -.02em; } .stats div:nth-child(odd) b { color: var(--red); }
  .stats span { color: var(--muted); font-size: 14px; }
  .page-hero { padding: 72px 0 56px; background: radial-gradient(800px 300px at 90% 0%, rgba(242, 200, 17, .22), transparent 70%),
    radial-gradient(600px 300px at 0% 100%, rgba(215, 38, 61, .10), transparent 70%); border-bottom: 1px solid var(--line); }
  .page-hero h1 { font-size: clamp(34px, 4.4vw, 54px); margin-bottom: 14px; }

  .window { background: var(--card); border: 1px solid var(--line); border-radius: 16px; box-shadow: var(--shadow); overflow: hidden; transform: perspective(1400px) rotateY(-6deg) rotateX(3deg); }
  .win-bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; background: #1b1816; color: #cfc8c0; font-size: 12px; }
  .win-bar i { width: 10px; height: 10px; border-radius: 50%; background: #3b3531; } .win-bar i:first-child { background: var(--red); } .win-bar i:nth-child(2) { background: var(--yellow); }
  .win-bar span { margin-left: 8px; }
  .win-body { padding: 16px; display: grid; gap: 12px; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .kpi { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
  .kpi small { display: block; color: var(--muted); font-size: 11px; } .kpi b { display: block; font-size: 18px; letter-spacing: -.01em; }
  .kpi em { font-style: normal; font-size: 11px; font-weight: 600; } .up { color: #2e9d47; } .down { color: var(--red); }
  .charts { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; }
  .chart { width: 100%; height: auto; border: 1px solid var(--line); border-radius: 10px; padding: 8px; }
  .cols rect { fill: var(--yellow); } .cols rect:nth-child(even) { fill: color-mix(in srgb, var(--yellow) 55%, transparent); }
  .cols polyline { fill: none; stroke: var(--red); stroke-width: 2.5; stroke-linejoin: round; }
  .donut circle { fill: none; stroke-width: 14; transform: rotate(-90deg); transform-origin: 60px 60px; }
  .d0 { stroke: var(--yellow); stroke-dasharray: 105.6 251.3; } .d1 { stroke: var(--red); stroke-dasharray: 80 251.3; stroke-dashoffset: -105.6; }
  .d2 { stroke: var(--neutral); stroke-dasharray: 65.7 251.3; stroke-dashoffset: -185.6; }
  .donut text { text-anchor: middle; font-size: 18px; font-weight: 700; fill: var(--text); } .donut .sub { font-size: 10px; font-weight: 400; fill: var(--muted); }
  .rows { display: grid; gap: 6px; } .rows div { display: grid; grid-template-columns: 26px 1fr; align-items: center; gap: 8px; font-size: 11px; color: var(--muted); }
  .rows i { display: block; height: 8px; border-radius: 4px; background: linear-gradient(90deg, var(--red), var(--yellow)); }

  .steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; counter-reset: s; }
  .steps.four { grid-template-columns: repeat(4, 1fr); }
  .steps > li { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 24px; counter-increment: s; }
  .steps > li::after { content: counter(s); position: absolute; top: 18px; right: 20px; font-size: 32px; font-weight: 800; color: var(--yellow-soft); line-height: 1; }
  .steps h3 { font-size: 19px; margin: 12px 0 6px; } .steps p { margin: 0; color: var(--muted); }
  .steps ul { margin: 12px 0 0; padding-left: 18px; color: var(--muted); font-size: 14.5px; }
  .ico { width: 40px; height: 40px; padding: 8px; border-radius: 10px; background: var(--yellow-soft); color: var(--yellow-ink); }
  .steps > li:nth-child(even) .ico, .feature:nth-child(even) .ico { background: var(--red-soft); color: var(--red); }

  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .feature { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 22px; transition: transform .2s, box-shadow .2s; }
  .feature:hover { transform: translateY(-3px); box-shadow: var(--shadow); }
  .feature .ico { margin-bottom: 14px; } .feature h3 { font-size: 17px; margin-bottom: 6px; } .feature p { margin: 0; color: var(--muted); font-size: 14.5px; }

  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 14px; }
  .tile { display: flex; align-items: center; gap: 16px; padding: 20px; border-radius: 16px; background: var(--card); border: 1px solid var(--line); text-decoration: none;
    transition: border-color .2s, transform .2s, box-shadow .2s; }
  .tile:hover { border-color: var(--red); transform: translateY(-2px); box-shadow: var(--shadow); }
  .tile > span { display: flex; flex-direction: column; flex: 1; } .tile strong { font-size: 17px; } .tile span span { color: var(--muted); font-size: 14.5px; }
  .tile b { color: var(--red); font-size: 20px; }

  .split { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }
  .checks { list-style: none; padding: 0; margin: 20px 0 0; display: grid; gap: 10px; }
  .checks li { display: flex; gap: 10px; align-items: center; }
  .checks li::before { content: "✓"; display: grid; place-items: center; width: 22px; height: 22px; border-radius: 50%; font-size: 12px; font-weight: 700;
    background: var(--red-soft); color: var(--red); flex: none; }
  pre { margin: 0; background: #1b1816; color: #ece6df; border-radius: 16px; padding: 22px; overflow: auto; font: 13.5px/1.7 "Cascadia Code", Consolas, monospace; box-shadow: var(--shadow); border-top: 3px solid var(--red); }
  pre .k { color: #f2c811; } pre .f { color: #ff8a95; } pre .c { color: #8f867d; }
  .chat { background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 20px; box-shadow: var(--shadow); display: grid; gap: 12px; }
  .bubble { padding: 12px 14px; border-radius: 14px; max-width: 85%; font-size: 15px; }
  .bubble.me { justify-self: end; background: var(--red); color: #fff; border-bottom-right-radius: 4px; }
  .bubble.ai { background: var(--yellow-soft); border-bottom-left-radius: 4px; }
  .bubble.ai ul { margin: 8px 0 0; padding-left: 18px; font-size: 14px; color: var(--muted); }

  /* Visuais */
  .subnav { position: sticky; top: 66px; z-index: 15; background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(10px); border-bottom: 1px solid var(--line); }
  .subnav .wrap { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 0; }
  .subnav a { flex: none; text-decoration: none; padding: 6px 14px; border-radius: 999px; border: 1px solid var(--line); background: var(--card); font-size: 14px; color: var(--muted); }
  .subnav a:hover, .subnav a.active { color: var(--text); border-color: var(--red); }
  .subnav small { color: var(--red); font-weight: 700; margin-left: 4px; }
  .vsec { padding: 64px 0; }
  .vgrid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; }
  .vcard { display: grid; grid-template-columns: 150px 1fr; gap: 20px; padding: 20px; border-radius: 16px; background: var(--card); border: 1px solid var(--line); scroll-margin-top: 190px; }
  .vart { border-radius: 12px; background: var(--bg2); display: grid; place-items: center; padding: 10px; align-self: start; aspect-ratio: 5 / 3; }
  .alt .vart { background: var(--bg); }
  .vbody h3 { font-size: 19px; margin-bottom: 6px; } .vbody p { margin: 0 0 8px; color: var(--muted); font-size: 15px; }
  .vbody .when { color: var(--text); } .vbody .when strong { color: var(--red); }
  .fields { margin-top: 10px; padding: 10px 12px; border-radius: 10px; background: var(--yellow-soft); font-size: 14px; }
  .fields > span { display: block; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--yellow-ink); margin-bottom: 4px; }
  .fields ul { margin: 0; padding-left: 18px; } .fields b { font-weight: 600; }
  .extras { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  .extras span { font-size: 12.5px; padding: 3px 10px; border-radius: 999px; background: var(--red-soft); color: var(--red-dark); }

  .mini { width: 100%; height: auto; overflow: visible; }
  .mini .y { fill: var(--yellow); } .mini .s { fill: color-mix(in srgb, var(--yellow) 45%, var(--card)); } .mini .r { fill: var(--red); }
  .mini .n { fill: var(--neutral); } .mini .card { fill: var(--card); stroke: var(--line); }
  .mini .l, .mini .ln { stroke: var(--muted); stroke-width: 1.5; fill: none; } .mini .lr { stroke: var(--red); stroke-width: 2.5; fill: none; stroke-linejoin: round; }
  .mini .ly { stroke: var(--yellow); stroke-width: 2.5; fill: none; } .mini .dash { stroke: var(--red); stroke-width: 1.5; stroke-dasharray: 3 3; }
  .mini .ring { fill: none; } .mini .ring.y { stroke: var(--yellow); } .mini .ring.r { stroke: var(--red); } .mini .ring.n { stroke: var(--neutral); }
  .mini .ring.s { stroke: color-mix(in srgb, var(--yellow) 45%, var(--card)); }
  .mini .grid { fill: none; stroke: var(--neutral); } .mini .sr { fill: color-mix(in srgb, var(--red) 30%, transparent); stroke: var(--red); stroke-width: 1.5; }
  .mini .sy { fill: color-mix(in srgb, var(--yellow) 35%, transparent); stroke: var(--yellow); stroke-width: 1.5; }
  .mini .fl { fill: none; } .mini .op { opacity: .85; }
  .mini text { font-family: inherit; } .mini .big { fill: var(--text); font-weight: 700; } .mini .num { fill: var(--text); font-weight: 700; }
  .mini .small { fill: var(--muted); } .mini .up { fill: #2e9d47; font-weight: 700; } .mini .inv { fill: #fff; font-weight: 600; }

  /* Planos */
  .plans { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; align-items: start; }
  .plan { position: relative; background: var(--card); border: 1px solid var(--line); border-radius: 18px; padding: 24px; display: flex; flex-direction: column; gap: 10px; }
  .plan.top { border: 2px solid var(--red); box-shadow: var(--shadow); }
  .plan-flag { position: absolute; top: -12px; left: 24px; padding: 3px 12px; border-radius: 999px; background: var(--red); color: #fff; font-size: 12px; font-weight: 700; }
  .plan h3 { font-size: 20px; }
  .plan .price b { font-size: 34px; letter-spacing: -.02em; } .plan .price span { color: var(--muted); margin-left: 2px; }
  .plan .tag { margin: 0; color: var(--muted); font-size: 14.5px; min-height: 3em; }
  .plan .count { font-size: 14px; } .plan .count b { color: var(--red); font-size: 18px; }
  .plan .btn { justify-content: center; }
  .includes { border-top: 1px solid var(--line); padding-top: 12px; font-size: 14px; }
  .includes > span { display: block; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--yellow-ink); margin-bottom: 6px; }
  .includes ul { margin: 0; padding-left: 18px; color: var(--muted); display: grid; gap: 2px; }
  .plans-note { text-align: center; color: var(--muted); font-size: 14px; margin: 24px 0 0; }
  .plan-badge { display: inline-block; vertical-align: middle; margin-left: 6px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .02em; }
  .plan-badge.p-free { background: var(--neutral); color: var(--text); }
  .plan-badge.p-iniciante { background: var(--yellow-soft); color: var(--yellow-ink); }
  .plan-badge.p-intermediario { background: var(--red-soft); color: var(--red-dark); }
  .plan-badge.p-avancado { background: var(--red); color: #fff; }
  .compare-wrap { overflow-x: auto; border: 1px solid var(--line); border-radius: 16px; background: var(--card); }
  .compare { width: 100%; border-collapse: collapse; font-size: 15px; min-width: 620px; }
  .compare th, .compare td { padding: 10px 14px; text-align: center; border-bottom: 1px solid var(--line); }
  .compare th:first-child, .compare td:first-child { text-align: left; }
  .compare thead th { position: sticky; top: 0; background: var(--card); font-size: 15px; }
  .compare thead small { display: block; font-weight: 400; color: var(--muted); font-size: 12px; }
  .compare tr.group th { background: var(--bg2); text-align: left; font-size: 12px; letter-spacing: .06em; text-transform: uppercase; color: var(--red); }
  .compare td a { text-decoration: none; } .compare td a:hover { color: var(--red); }
  .compare .yes { color: var(--red); font-weight: 800; } .compare .no { color: var(--line); }

  .faq { max-width: 780px; margin: 0 auto; display: grid; gap: 10px; }
  details { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 4px 20px; }
  details[open] { border-color: color-mix(in srgb, var(--red) 40%, var(--line)); }
  summary { cursor: pointer; padding: 14px 0; font-weight: 600; list-style: none; display: flex; justify-content: space-between; gap: 12px; }
  summary::-webkit-details-marker { display: none; }
  summary::after { content: "+"; color: var(--red); font-size: 22px; line-height: 1; transition: transform .2s; }
  details[open] summary::after { transform: rotate(45deg); }
  details p { margin: 0 0 16px; color: var(--muted); }

  .final { text-align: center; padding: 80px 0; background: linear-gradient(135deg, #b01e31 0%, #d7263d 45%, #e6a400 100%); color: #fff; }
  .final h2 { color: #fff; } .final .lead { color: rgba(255, 255, 255, .9); margin: 0 auto 28px; }
  .final .btn.primary { background: #fff; color: #b01e31; border-color: #fff; }
  footer { padding: 32px 0; color: var(--muted); font-size: 14px; border-top: 1px solid var(--line); }
  footer .wrap { display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
  footer nav { display: flex; gap: 16px; flex-wrap: wrap; } footer nav a { text-decoration: none; } footer nav a:hover { color: var(--red); }

  .anim .reveal { opacity: 0; transform: translateY(14px); transition: opacity .5s ease, transform .5s ease; }
  .anim .reveal.shown { opacity: 1; transform: none; }
  @media (prefers-reduced-motion: reduce) { .anim .reveal { opacity: 1; transform: none; } }

  /* Topo em telas médias: menu mais justo e sem a frase ao lado do login. */
  @media (max-width: 1180px) {
    .signin .label { display: none; }
    .nav { gap: 16px; }
    .links a { padding: 6px 9px; font-size: 14.5px; }
  }
  @media (max-width: 900px) {
    .logo span { display: none; }
  }
  @media (max-width: 1020px) {
    .grid, .plans { grid-template-columns: repeat(2, 1fr); }
    .steps, .steps.four { grid-template-columns: repeat(2, 1fr); }
    .hero-grid, .split { grid-template-columns: 1fr; gap: 40px; }
    .window { transform: none; }
    .vgrid { grid-template-columns: 1fr; }
  }
  @media (max-width: 760px) {
    section { padding: 60px 0; } .vsec { padding: 48px 0; }
    .links { display: none; position: absolute; top: 66px; left: 0; right: 0; flex-direction: column; gap: 0; padding: 8px 12px 14px;
      background: var(--bg); border-bottom: 1px solid var(--line); }
    .links.open { display: flex; }
    .links a { padding: 12px; border-radius: 10px; }
    .menu-btn { display: block; }
    .nav { gap: 12px; }
    .signin .label, .logo span, .g_id_signin.full { display: none; }
    .g_id_signin.compact { display: block; }
    .hero { padding: 40px 0 56px; } .page-hero { padding: 44px 0 36px; }
    .hero::before { inset: -20% -50% auto auto; width: 140%; height: 70%; opacity: .6; }
    .grid, .steps, .steps.four, .plans { grid-template-columns: 1fr; }
    .vcard { grid-template-columns: 1fr; } .vart { max-width: 240px; }
    .subnav .wrap { flex-wrap: nowrap; overflow-x: auto; scrollbar-width: none; }
    .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } .kpi b { font-size: 14px; }
    .btn.small { padding: 7px 12px; font-size: 13px; }
  }
`;

// ---------------- Comportamento ----------------

const SCRIPT = `
  // Login: o botão do Google fica no topo; a resposta vira um aviso logo abaixo dele.
  async function onGoogleLogin(r) {
    const msg = document.getElementById("msg");
    const show = (text, info) => { msg.textContent = text; msg.className = info ? "banner info" : "banner"; msg.hidden = false; };
    msg.hidden = true;
    try {
      const res = await fetch("/api/auth/google", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ credential: r.credential }) });
      if (res.ok) return location.assign("/");
      const data = await res.json();
      show(data.error || "Acesso negado.", data.pending);
    } catch { show("Sem conexão com o servidor. Tente de novo."); }
  }

  // "Entrar com Google" no meio da página: sobe até o topo e destaca o botão de lá.
  document.querySelectorAll("[data-login]").forEach((a) => a.addEventListener("click", () => {
    document.getElementById("signin").animate([{ transform: "scale(1)" }, { transform: "scale(1.08)" }, { transform: "scale(1)" }], { duration: 600, delay: 350 });
  }));

  // Menu no celular.
  const menu = document.getElementById("menu"), links = document.getElementById("links");
  menu.addEventListener("click", () => menu.setAttribute("aria-expanded", String(links.classList.toggle("open"))));

  // Página de visuais: destaca o grupo visível no submenu.
  const sub = [...document.querySelectorAll(".subnav a")];
  if (sub.length) {
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) sub.forEach((a) => a.classList.toggle("active", a.hash === "#" + e.target.id));
    }, { rootMargin: "-40% 0px -55% 0px" });
    document.querySelectorAll("section.vsec").forEach((s) => spy.observe(s));
  }

  // Entrada suave (e, por garantia, tudo visível depois de 2,5 s).
  document.documentElement.classList.add("anim");
  setTimeout(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("shown")), 2500);
  const reveal = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add("shown"); reveal.unobserve(e.target); }
  }, { threshold: .1 });
  document.querySelectorAll(".reveal").forEach((el) => reveal.observe(el));
`;
