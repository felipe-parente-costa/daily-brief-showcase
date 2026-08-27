# Daily Brief

Resumo diário por email: mercado, notícias mundiais e as newsletters que você assina.
Chega às 07:00, em cinco seções — números, Brasil, Global, Mundo, Tech e Cripto.

> **Este repositório é vitrine.** O código é o real, roda de verdade — mas a instância
> que efetivamente me envia o email todo dia mora num repositório privado (tem meu
> email e o histórico das minhas leituras, por isso fica fora daqui). Aqui você encontra
> o mecanismo completo, o workflow e uma amostra real de saída (`data/`, 26/08/2026).
> A [página de inscrição](https://felipe-parente-costa.github.io/daily-brief-showcase/) está no ar via GitHub Pages, servida a partir de `docs/index.html`.
>
> **Quer sua própria instância?** É só clonar, seguir a seção *Rodar na nuvem* e
> cadastrar seus próprios secrets. Nada aqui depende de mim rodando.

## Como funciona

Quatro estágios. Só um deles usa modelo de linguagem, e é o único que precisa de julgamento.

| Estágio | Quem faz | O quê |
|---|---|---|
| 1. Coleta | `pipeline.py` | 16 feeds RSS + 13 indicadores de mercado → `data/raw/AAAA-MM-DD.json` |
| 2. Curadoria | Claude | lê o raw + as newsletters, filtra, escreve → `data/briefs/AAAA-MM-DD.json` |
| 3. Render | `render.py` | brief JSON → HTML e TXT do email |
| 4. Envio | Claude ou `mailer.py` | manda para a sua caixa e registra o que saiu |

Buscar feed e cotação é trabalho de script: mais barato, mais rápido, e quando quebra
você vê exatamente onde. O modelo entra só na triagem e na redação.

### Duas rotas para os estágios 2 e 4

| | Interativa | Autônoma |
|---|---|---|
| Quem executa | Claude Code, seguindo `BRIEF.md` | `run_brief.py` |
| Curadoria | sua assinatura do Claude | API do Gemini ou da Anthropic (`curator.py`) |
| Lê newsletters | conector do Gmail | IMAP (`newsletters.py`) |
| Envia | conector do Gmail | SMTP (`mailer.py`) |
| Precisa do app aberto | sim | não |
| Custo | incluso na assinatura | zero no Gemini Flash; por uso na Anthropic |

As duas produzem o mesmo `data/briefs/AAAA-MM-DD.json` e seguem o mesmo
`config/profile.md`. A rota autônoma existe para rodar no GitHub Actions às 07:00
sem ninguém por perto — veja *Rodar na nuvem*, abaixo.

**Dependências.** A rota interativa usa só a biblioteca padrão do Python (testado no
3.14). A autônoma acrescenta uma: o SDK do provedor que você escolher.

### Qual provedor usar na rota autônoma

`BRIEF_PROVIDER` decide. O padrão é `gemini`, porque é o que sai de graça.

| | `gemini` (padrão) | `anthropic` |
|---|---|---|
| Modelo padrão | `gemini-3.7-flash` | `claude-opus-5` |
| Custo | zero — os modelos Flash têm free tier, sem cartão | por token |
| Privacidade | **o Google usa o conteúdo para treinar** no free tier | não é usado para treino |
| Qualidade editorial | menor: Flash é um modelo mais leve | maior |
| SDK | `google-genai` | `anthropic` |

Para trocar: mude `BRIEF_PROVIDER` no workflow, descomente a linha correspondente em
`requirements.txt` e cadastre a chave daquele provedor. Nada mais muda — as regras de
curadoria e o `config/profile.md` são os mesmos nos dois.

Uma assinatura consumidora do Gemini (Google AI Pro/Plus) **não** cobre a API: ela vale
dentro do AI Studio. O free tier da API é outra coisa, e independe de assinatura.

## Rodar na mão

```bash
cd "/caminho/do/seu/projeto" && python pipeline.py --check
```

Testa as 29 fontes e imprime o status de cada uma. Rode isto primeiro sempre que
algo parecer errado, e sempre depois de adicionar fonte nova.

```bash
cd "/caminho/do/seu/projeto" && python pipeline.py
```

Coleta o dia e grava em `data/raw/`.

```bash
cd "/caminho/do/seu/projeto" && python render.py data/briefs/2026-08-26.json
```

Gera o `.html` e o `.txt` do email a partir de um brief já curado.

Para o ciclo completo (coleta → curadoria → email), peça ao Claude:
*"execute o BRIEF.md"*.

## Rodar na nuvem

`run_brief.py` faz o ciclo inteiro sozinho, e `.github/workflows/daily-brief.yml`
dispara ele todo dia às 10:07 UTC (07:07 em Brasília). O repositório **precisa ser
privado**: `BRIEF.md` e o histórico em `data/` trazem o seu endereço de email.

Os secrets ficam em *Settings → Secrets and variables → Actions*:

| Secret | O que é |
|---|---|
| `GEMINI_API_KEY` | chave em aistudio.google.com — grátis, sem cartão |
| `GMAIL_USER` | a conta que lê as newsletters e envia o brief |
| `GMAIL_APP_PASSWORD` | senha de app do Google, 16 caracteres, **não** a senha da conta |
| `BRIEF_TO` | opcional; destinatário, se for diferente de `GMAIL_USER` |
| `ANTHROPIC_API_KEY` | só se trocar `BRIEF_PROVIDER` para `anthropic` |

A senha de app sai de `myaccount.google.com/apppasswords` e exige verificação em
duas etapas ligada. É ela que abre o IMAP (ler newsletters) e o SMTP (enviar) —
o Google bloqueia a senha normal da conta nos dois.

**Custo total: zero.** O plano Free do GitHub dá 2.000 minutos por mês em repositório
privado; este job gasta uns 150. Se acabasse, o Actions bloqueia — não cobra, desde que
não haja cartão cadastrado. A curadoria no Gemini Flash está no free tier.

O passo final do workflow commita `data/` de volta. Sem isso o `seen.json` volta ao
estado do repositório a cada execução e o brief de amanhã repete as manchetes de hoje.

Para testar antes do primeiro disparo: aba *Actions* → *Daily Brief* → *Run workflow*.

### O que a rota autônoma faz de diferente

Sem humano no loop não existe "corrija antes de renderizar". `run_brief.py` poda o
brief antes de validar: link que não saiu da coleta do dia é removido, item que fica
sem link nenhum é descartado, e destaque acima do teto é desmarcado. Se depois disso
o `--validar` ainda reprovar, nada é enviado — chega um email curto avisando da falha.
Newsletter é bônus: se o IMAP não responder, a edição sai sem a seção.

## Configuração das newsletters — falta você fazer

O agente lê as newsletters do **seu Gmail**, não do LinkedIn. Raspar o LinkedIn viola
os Termos de Uso e arrisca sua conta; entrega por email dá o mesmo conteúdo sem risco.

**Assine tudo usando o alias `seuemail+brief@gmail.com`.** O Gmail entrega
qualquer coisa endereçada a `seuendereco+qualquercoisa@gmail.com` na sua caixa normal,
e o agente acha essas mensagens com uma busca `to:`. Assim **não é preciso criar filtro
nem marcador nenhum** — o alias já é a etiqueta.

Se algum site recusar o `+` no campo de email (acontece), assine com o endereço normal
e crie um filtro para aquele remetente com o marcador `Brief/Fontes`: o agente procura
pelas duas rotas e junta o resultado.

**No LinkedIn**: não há rota. Procuramos em 26/08/2026 e a opção de entrega por email
por newsletter não existe mais na interface — o menu "⋯" da newsletter só oferece
compartilhar e denunciar, e *Configurações → Notificações → Notícias e relatórios* trata
do conteúdo editorial do próprio LinkedIn, não das newsletters que você assina. As que
só existem lá dentro (Dalio, El-Erian, Ágora, XP Asset, Fronteconômico, Pulso Rio Bravo,
MAG In-sights, Private em Foco, Spotlight on, The Red Thread, In Context) ficam de fora
do brief até o LinkedIn devolver a opção. O agente ainda procura por
`newsletters-noreply@linkedin.com`, caso volte.

Enquanto nada chegar, o brief sai normalmente — só sem a seção de newsletters.

## Newsletters sugeridas

Assine com o alias `+brief`. Comece por 8–10, não por 25: newsletter demais entope a
seção e o teto de itens por seção continua valendo — o excesso é descartado, não lido.
Prefira 2 ou 3 diárias e o resto semanal.

**Gestoras e bancos** (o núcleo, e o que faltava na primeira lista)

| Fonte | O que é | Cadência | Link |
|---|---|---|---|
| Apollo — The Daily Spark | Torsten Sløk, gráfico + parágrafo por dia. Denso e sem enrolação. | diária | [assinar](https://www.apolloacademy.com/daily-spark/subscription/) |
| Goldman Sachs — Briefings | Mercados, setores e economia global. | semanal (sexta) | [assinar](https://www.goldmansachs.com/briefings) |
| J.P. Morgan — Eye on the Market | Michael Cembalest. Longo, opinativo, bem argumentado. | periódica | [página](https://am.jpmorgan.com/us/en/asset-management/institutional/insights/market-insights/eye-on-the-market/) |
| Oaktree — memos do Howard Marks | Raro e denso. Ciclo de crédito e risco. | esporádica | [página](https://www.oaktreecapital.com/insights/memos) |
| KKR — Insights / Global Macro Trends | Henry McVey, alocação e macro. | periódica | [página](https://www.kkr.com/insights) |
| BlackRock Investment Institute | Comentário semanal de mercado. | semanal | confirmar na página |
| PIMCO — Economic and Market Commentary | Renda fixa e juros. | periódica | confirmar na página |
| Morgan Stanley — Thoughts on the Market | Episódio curto diário, com transcrição. | diária | confirmar na página |

Verifiquei os dois primeiros links direto na página de assinatura. Os demais têm página
pública confirmada, mas o caminho exato do cadastro de email pode ter mudado — os marcados
como "confirmar na página" eu não verifiquei.

**Consultorias**: McKinsey Insights, BCG Perspectives, Bain Insights, Deloitte Insights.
Cadência semanal ou quinzenal, bom para tese setorial — fraco para o dia a dia.

**Brasil**: The Brief (Exame), XP Expert, Itaú Macro Visão.
Brazil Journal, NeoFeed e Turim (View of the Week) **não precisam de assinatura** — entram por RSS.
O feed do Turim fica em `/publicacoes/insights/feed/`; a raiz do site devolve feed vazio.

**Tech e IA**: Stratechery (pago, mas o melhor do gênero), a16z, Import AI, Ben's Bites.

## Adicionar ou trocar fontes

Edite `config/sources.json`:

- **Feed novo** — acrescente em `feeds` com `id`, `nome`, `secao` (`brasil`, `global`,
  `mundo` ou `tech`), `url` e `max_itens`. Rode `python pipeline.py --check` para
  confirmar que responde e traz itens.
- **Indicador novo** — em `mercado`, sob o provedor certo. Yahoo aceita qualquer
  ticker (`PETR4.SA`, `^FTSE`, `EURUSD=X`); BCB aceita qualquer série do SGS.
- **Recorte editorial** — `config/profile.md` controla tom, temas e o que descartar.
  É o arquivo para mexer quando o email vier bom demais para um lado ou chato demais.

## Estrutura

```
BRIEF.md              instruções do estágio 2 — autocontido, é o que a tarefa agendada roda
config/sources.json   feeds, tickers e séries
config/profile.md     perfil editorial: tom, temas, o que descartar
collectors/feeds.py   RSS/Atom via xml.etree, com retry e tolerância a BOM
collectors/markets.py Yahoo, AwesomeAPI, CoinGecko, BCB
pipeline.py           orquestra a coleta (--check, --validar, --marcar)
render.py             brief JSON → HTML e TXT do email
data/raw/             coleta bruta por dia
data/briefs/          brief curado + HTML + TXT por dia
data/seen.json        links dos últimos 7 dias, para não repetir manchete

rota autônoma (não usada pela execução interativa)
run_brief.py          ciclo completo sem humano: coleta → curadoria → poda → envio
curator.py            estágio 2 por API (Gemini ou Anthropic); carrega config/profile.md
newsletters.py        as três rotas de busca do BRIEF.md, via IMAP
mailer.py             envio por SMTP, e o aviso curto quando a coleta quebra
.github/workflows/    o cron do GitHub Actions
```

## Detalhes que custaram tempo (não desfaça sem ler)

- **Fechamento anterior do Yahoo**: `previousClose` vem nulo e `chartPreviousClose`
  é o fechamento anterior à *janela* pedida (5 dias atrás), não à véspera. A variação
  correta sai do penúltimo fechamento da série. Ver `collectors/markets.py`.
- **Gzip não declarado**: o servidor do G1 devolve gzip de forma intermitente, mesmo
  sem `Accept-Encoding` no pedido e sem declarar no cabeçalho. A coleta sniffa os
  bytes mágicos antes de parsear — sem isso a fonte falha em dias aleatórios.
- **CoinGecko em lote**: a API gratuita responde 429 com poucas chamadas por minuto.
  As duas moedas vêm numa requisição só; não separe.
- **BOM UTF-8**: o feed do Federal Reserve começa com BOM. É removido antes do parse.
- **Reuters e Stooq ficaram de fora**: o feed da Reuters responde 404 e o Stooq não
  serve os índices que interessam. Se voltarem, entram por `config/sources.json`.
- **`--validar`**: confere se todo link do brief saiu mesmo da coleta do dia. Link
  trocado entre itens não aparece na leitura — só quando alguém clica.
- **WSJ mudou de host**: `feeds.a.dj.com` responde 200 mas está congelado em jan/2025.
  O host vivo é `feeds.content.dowjones.io` — o mesmo do MarketWatch.
- **FT, WSJ e Economist são pagos**: o RSS entrega título e resumo, que bastam para o
  brief, mas o link pode bater em paywall. É esperado, não é defeito.

## Limitação do agendamento

Vale só para a **rota interativa**: a tarefa agendada dentro do Claude Code roda
enquanto o app estiver aberto. Se estiver fechado às 07:00, ela executa na próxima vez
que você abrir — o email atrasa, não some.

A rota do GitHub Actions não tem essa limitação (nem precisa do seu computador ligado),
mas o cron do Actions não é pontual: em horário de pico o disparo costuma atrasar
alguns minutos. Rodar as duas ao mesmo tempo manda dois emails — escolha uma.
