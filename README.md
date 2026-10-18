# Mini BI

Um "mini Power BI" feito do zero para estudo: modelo de dados com
relacionamentos, medidas numa linguagem no estilo DAX, canvas de relatório e
filtro cruzado entre visuais. Nenhum código do Power BI foi usado — só os
conceitos públicos.

```bash
npm install
npm run dev     # abre em http://localhost:5173
npm test        # testes do motor
```

## Como o Power BI funciona (e onde isso está aqui)

| Conceito do Power BI | Onde está | O que estudar |
| --- | --- | --- |
| Power Query (importar e tipar dados) | `src/model/csv.ts` | Detecção de tipo por coluna, números pt-BR |
| Modelo semântico (tabelas, relacionamentos) | `src/model/types.ts` | Esquema estrela: fato `Vendas` + dimensões |
| Propagação de filtros | `Engine.rows` / `Engine.resolve` em `src/engine/query.ts` | Filtros fluem do lado "um" para o "muitos", nunca o contrário |
| DAX (medidas) | `src/engine/expr.ts` (parser) e `Engine.evaluate` | Tokenizer → AST → avaliação no contexto de filtro |
| BLANK | `Engine.evaluate` | `BLANK + 1 = 1`, `BLANK * 2 = BLANK`, `DIVIDE` com alternativo |
| Contexto de filtro de cada ponto do gráfico | `runVisual` | Cada categoria = contexto do relatório + filtro da categoria |
| Filtro cruzado / destaque | `contextFor` + `toggleFilter` em `src/model/store.ts` | O visual de origem destaca; os outros filtram |
| Canvas do relatório | `src/components/Canvas.tsx` | Arrastar/redimensionar com grade |

### O fluxo de uma consulta

1. O visual "Faturamento por Categoria" pede: eixo `Produtos[Categoria]`,
   medida `[Faturamento]`.
2. `runVisual` monta o **contexto de filtro** com os filtros cruzados de
   outros visuais (ex.: `Lojas[Região] = Sul`).
3. Para cada categoria distinta, acrescenta `Produtos[Categoria] = X`.
4. `SUM(Vendas[Valor])` pega as linhas de `Vendas` que passam em todos os
   filtros. Para checar `Lojas[Região]` a partir de uma venda, o motor segue
   o relacionamento `Vendas[LojaID] → Lojas[LojaID]` (como `RELATED`).
5. Categorias em que todas as medidas dão BLANK somem, como no Power BI.

O cache de linhas filtradas é incremental: o contexto comum é calculado uma
vez e cada categoria só filtra o que sobrou.

## Exercícios sugeridos

1. **CALCULATE**: implemente `CALCULATE([Medida], Tabela[Coluna] = "valor")`,
   que substitui o filtro daquela coluna no contexto.
2. **Hierarquia de datas**: drill-down Ano → Trimestre → Mês.
3. **Relacionamento bidirecional**: uma opção por relacionamento para o filtro
   fluir nos dois sentidos (e veja por que gera ambiguidade).
4. **Armazenamento colunar**: troque `rows: Row[]` por colunas + dicionário de
   valores (a ideia do VertiPaq) e meça a diferença com 1 milhão de linhas.
5. **Matriz**: visual com linhas e colunas e subtotais.
6. **Formatação condicional** na tabela.

## Limitações conhecidas

- Os dados ficam em memória e no `localStorage`; CSVs grandes podem não caber
  no armazenamento (o app continua funcionando, só não salva).
- Relacionamentos só muitos-para-um e em direção única.
- `1.234` num CSV é lido como mil duzentos e trinta e quatro (padrão pt-BR).
