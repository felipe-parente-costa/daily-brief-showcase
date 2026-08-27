# Perfil editorial do Daily Brief

## Leitor

Um leitor só: o dono da caixa de entrada. Lê no celular, tomando café, entre 5 e 8 minutos.
Quer chegar na primeira reunião do dia sabendo o que mudou desde ontem — e, principalmente,
**por que aquilo importa**. Não quer recomendação de investimento, quer contexto.

## Temas cobertos (nesta ordem no email)

1. **Brasil** — Copom/Selic, IPCA, câmbio, Ibovespa, fiscal, decisões de governo com efeito econômico.
2. **Global** — Fed/BCE, treasuries, S&P/Nasdaq, dólar, petróleo, ouro, resultados corporativos grandes.
3. **Mundo** — geopolítica, conflitos, eleições, comércio internacional, regulação com impacto econômico.
4. **Tech, IA e Cripto** — movimentos de big techs, lançamentos e funding relevantes, regulação de IA, mercado cripto.
5. **Newsletters do dia** — o que as fontes assinadas trouxeram de tese, dado ou análise que não é notícia de agência.

## Tom

- Direto e adulto. Frases curtas. Nada de "em um cenário cada vez mais dinâmico".
- Sempre ancorar em número quando existir número: "o dólar subiu 0,2%, a R$ 5,16" vale mais que "o dólar subiu".
- Cada item termina respondendo *e daí?* — o efeito prático, não a manchete repetida.
- Português do Brasil. Termo técnico em inglês só quando é o nome consagrado (treasury, payroll, guidance).
- Incerteza é dita, não maquiada: "ainda sem confirmação oficial" é uma frase válida.

## O que descartar sem dó

- Conteúdo promocional, patrocinado ou de assessoria disfarçado de notícia.
- Listas de recomendação ("5 ações para comprar", "onde investir em setembro").
- Release corporativo recauchutado sem fato novo.
- Notícia de celebridade, esporte, entretenimento — salvo se virar fato econômico (ex.: aquisição bilionária de um estúdio).
- Manchete que só repete, com outras palavras, o que já foi ao ar nos últimos 7 dias (ver `data/seen.json`).
- Previsão de analista sem método declarado.

## Destaque em negrito

Marque com `**assim**`. O negrito existe para o olho pousar no número que decide a
leitura — não para dar ênfase retórica. Se tudo é importante, nada é.

- **Teto**: 1 destaque na abertura, 2 por item, zero nos títulos (já são negrito).
  `python pipeline.py --validar` recusa o brief que passar disso.
- **O que destacar**: o indicador e o número dele — `**IPCA-15**` ... `**-0,40%**`.
  Ou o único número que muda a leitura do item.
- **O que nunca destacar**: adjetivo, verbo, nome de empresa, frase inteira, opinião.
- **Nem número que já está na tabela de mercado ou no título do item.** Ali o negrito
  é repetição, não ênfase — e é o que mais polui. Destaque o dado que só existe no texto.
- **Item sem número quase sempre fica sem destaque.** Quatro destaques bem colocados
  no email inteiro chamam mais atenção que doze espalhados.

## Regras de curadoria

- **Teto por seção**: 3 a 5 itens. Se sobrar coisa boa, escolha a de maior efeito prático — o brief não cresce.
- **Uma fonte não faz item**: se um fato aparece em uma fonte só e é extraordinário, marque como não confirmado.
- **Não inventar**: se o dado não está no material coletado, ele não entra. Nunca estimar número de cabeça.
- **Não dar conselho financeiro**: descrever o que aconteceu e o mecanismo, nunca sugerir o que comprar ou vender.
- **Seção vazia é aceitável**: dia fraco em geopolítica é dia sem seção Mundo. Encher com ruído é pior.
