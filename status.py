"""Monta o site publico de status do Daily Brief.

Le o que o projeto ja produziu - as edicoes em data/briefs, a coleta em
data/raw, o registro de entregas, a config de fontes - e escreve uma pasta
pronta para publicar:

    site_build/
      index.html, *.css, *.js   copia de site/
      status.json               numeros agregados, lidos pela pagina
      edicoes/AAAA-MM-DD.html   cada edicao re-renderizada

As edicoes sao RE-RENDERIZADAS a partir do JSON, nunca copiadas de
data/briefs/*.html: aquele HTML e a copia do dono e carrega o email dele no
link de descadastro (run_brief.py chama render.renderizar com contato=...).
Aqui o contato e None de proposito, o que gera o rodape sem endereco.

Nenhum email entra no resultado, so contagens. O passo final varre tudo o que
foi escrito procurando endereco, mailto: e o id da planilha, e aborta se achar
- este script publica num repositorio publico, entao a checagem vale mais que
a conveniencia de ignora-la.

Uso:
    python status.py                      # escreve em site_build/
    python status.py --saida /tmp/x       # outra pasta
    python status.py --leitores 13        # numero de leitores a publicar
    python status.py --sem-newsletters    # omite o ranking de newsletters
"""

import argparse
import html
import json
import os
import re
import shutil
import sys
from collections import Counter
from datetime import date, datetime
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))

import render  # noqa: E402

BRIEFS = BASE / "data" / "briefs"
CONFIG = BASE / "config" / "sources.json"
ENTREGAS = BASE / "data" / "entregas.json"
AVISO_FALHA = BASE / "data" / "ultimo_aviso_falha.txt"
FONTE_SITE = BASE / "site"
SAIDA_PADRAO = BASE / "site_build"

JANELA_SAUDE = 30
TETO_FONTES = 14
TETO_NEWSLETTERS = 10

# O que nunca pode aparecer no que for publicado.
PADROES_PROIBIDOS = [
    ("endereco de email", re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
    ("link mailto:", re.compile(r"mailto:", re.I)),
    ("alias das newsletters", re.compile(r"\+brief", re.I)),
]
# O id da planilha vem do ambiente, nunca escrito aqui: este arquivo tambem
# vai para o repositorio publico, e a lista de proibidos nao pode ser ela
# mesma o vazamento.
if os.environ.get("BRIEF_SUBSCRIBERS_SHEET_ID"):
    PADROES_PROIBIDOS.append(
        ("id da planilha de inscritos", re.compile(re.escape(os.environ["BRIEF_SUBSCRIBERS_SHEET_ID"])))
    )


# ----------------------------------------------------------------- leitura


def _edicoes():
    """Todas as edicoes gravadas, em ordem de data."""
    saida = []
    for arquivo in sorted(BRIEFS.glob("*.json")):
        try:
            brief = json.loads(arquivo.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as erro:
            print(f"aviso: {arquivo.name} ilegivel ({erro}) - fora do site")
            continue
        saida.append((arquivo.stem, brief))
    return saida


def _carregar(caminho, padrao):
    try:
        return json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return padrao


def _itens(brief):
    return [i for s in brief.get("secoes", []) for i in s.get("itens", [])]


def _nome_newsletter(rotulo):
    """"McKinsey - titulo da edicao" -> "McKinsey"."""
    for separador in (" - ", " — ", " – ", ": "):
        if separador in rotulo:
            return rotulo.split(separador)[0].strip()
    return rotulo.strip()


# ----------------------------------------------------------------- agregacao


def agregar(edicoes, leitores=None, com_newsletters=True):
    config = _carregar(CONFIG, {"feeds": [], "mercado": {}, "janela_horas": 30})
    entregas = _carregar(ENTREGAS, {})

    indicadores = [item for grupo in config.get("mercado", {}).values() for item in grupo]

    fontes = Counter()
    newsletters = Counter()
    secoes = Counter()
    historico = []
    falhas = Counter()
    dias_de_falha = 0

    recentes = edicoes[-JANELA_SAUDE:]
    nomes_recentes = {d for d, _ in recentes}

    for dia, brief in edicoes:
        itens = _itens(brief)
        for secao in brief.get("secoes", []):
            secoes[secao.get("id") or "sem-id"] += len(secao.get("itens", []))
        for item in itens:
            for fonte in item.get("fontes", []) or []:
                fontes[fonte.strip()] += 1
        for rotulo in brief.get("newsletters_lidas", []) or []:
            newsletters[_nome_newsletter(rotulo)] += 1

        # Saude das fontes: so a janela recente, senao uma fonte que caiu em
        # agosto e voltou continua marcada como problema para sempre.
        if dia in nomes_recentes:
            dias_de_falha += 1
            vistas = set()
            for erro in brief.get("fontes_com_erro", []) or []:
                nome = (erro.get("fonte") if isinstance(erro, dict) else str(erro)) or ""
                nome = nome.strip()
                if nome and nome not in vistas:
                    vistas.add(nome)
                    falhas[nome] += 1

        registro = entregas.get(dia) or {}
        historico.append({
            "data": dia,
            "itens": len(itens),
            "secoes": {s.get("id"): len(s.get("itens", [])) for s in brief.get("secoes", [])},
            "newsletters": len(brief.get("newsletters_lidas", []) or []),
            "destinatarios": registro.get("destinatarios"),
            "curado_por": brief.get("curado_por") or registro.get("curado_por"),
        })

    saude = []
    for fonte in config.get("feeds", []):
        saude.append({
            "nome": fonte["nome"],
            "secao": fonte.get("secao"),
            "tipo": "feed",
            "falhas": falhas.get(fonte["nome"], 0),
            "dias": dias_de_falha,
        })
    for indicador in indicadores:
        saude.append({
            "nome": indicador["nome"],
            "secao": indicador.get("grupo"),
            "tipo": "mercado",
            "falhas": falhas.get(indicador["nome"], 0),
            "dias": dias_de_falha,
        })
    saude.sort(key=lambda s: (-s["falhas"], s["nome"]))

    hoje = date.today().isoformat()
    ultima_data, ultima = edicoes[-1] if edicoes else (None, {})
    registro_hoje = entregas.get(hoje) or {}
    aviso = ""
    try:
        aviso = AVISO_FALHA.read_text(encoding="utf-8").strip()
    except OSError:
        pass

    total_itens = sum(h["itens"] for h in historico)

    return {
        "gerado_em": datetime.now().astimezone().isoformat(timespec="seconds"),
        "projeto": {
            "primeira_edicao": edicoes[0][0] if edicoes else None,
            "edicoes": len(edicoes),
            "itens_curados": total_itens,
            "feeds": len(config.get("feeds", [])),
            "indicadores": len(indicadores),
            "janela_horas": config.get("janela_horas"),
            "leitores": leitores,
            "sequencia": _sequencia(historico),
        },
        "hoje": {
            "data": hoje,
            "entregue": ultima_data == hoje,
            "aviso_de_falha": aviso == hoje,
            "destinatarios": registro_hoje.get("destinatarios"),
            "hora": registro_hoje.get("hora") or (ultima.get("gerado_em") or "")[-5:],
            "curado_por": ultima.get("curado_por") or registro_hoje.get("curado_por"),
        },
        "ultima_edicao": {
            "data": ultima_data,
            "numero": len(edicoes),
            "assunto": ultima.get("assunto"),
            "abertura": ultima.get("abertura"),
            "itens": len(_itens(ultima)),
            "secoes": [
                {"titulo": s.get("titulo"), "itens": len(s.get("itens", []))}
                for s in ultima.get("secoes", [])
            ],
            "newsletters": len(ultima.get("newsletters_lidas", []) or []),
        },
        "mercado": [
            {
                "nome": m.get("nome"),
                "grupo": m.get("grupo"),
                "valor": m.get("valor"),
                "variacao_pct": m.get("variacao_pct"),
            }
            for m in ultima.get("mercado", []) or []
        ],
        "secoes": dict(secoes),
        "fontes": [
            {"nome": n, "citacoes": c} for n, c in fontes.most_common(TETO_FONTES)
        ],
        "newsletters": (
            [{"nome": n, "edicoes": c} for n, c in newsletters.most_common(TETO_NEWSLETTERS)]
            if com_newsletters else []
        ),
        "saude_fontes": saude,
        "historico": historico,
        "edicoes": [
            {
                "data": dia,
                "assunto": brief.get("assunto"),
                "itens": len(_itens(brief)),
                "arquivo": f"edicoes/{dia}.html",
            }
            for dia, brief in edicoes
        ],
    }


def _sequencia(historico):
    """Quantos dias seguidos, contando de hoje para tras, tiveram edicao."""
    dias = {h["data"] for h in historico}
    hoje = date.today()
    conta = 0
    cursor = hoje
    # Hoje ainda pode nao ter saido; nesse caso a sequencia conta de ontem.
    if cursor.isoformat() not in dias:
        cursor = date.fromordinal(cursor.toordinal() - 1)
    while cursor.isoformat() in dias:
        conta += 1
        cursor = date.fromordinal(cursor.toordinal() - 1)
    return conta


# ----------------------------------------------------------------- escrita


MOLDE_EDICAO = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Daily Brief - {titulo}</title>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700&display=swap">
<style>
  body {{ margin: 0; background: #f4f6f8; }}
  /* Barra do leitor, no visual da pagina de status. O corpo abaixo e o
     email exatamente como os inscritos receberam, com o estilo dele. */
  .barra {{
    background: #0b0c13;
    border-bottom: 1px solid #242737;
    font: 700 10.5px/1 "JetBrains Mono", ui-monospace, Menlo, monospace;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }}
  .barra-grade {{
    max-width: 640px;
    margin: 0 auto;
    padding: 13px 20px;
    display: flex;
    flex-wrap: wrap;
    gap: 10px 18px;
    align-items: center;
    justify-content: space-between;
  }}
  .barra a {{ color: #e0864a; text-decoration: none; }}
  .barra a:hover {{ color: #f0a46c; }}
  .barra .edicao {{ color: #686879; font-weight: 400; }}
  .sigla {{
    display: inline-block;
    background: #e0864a;
    color: #0b0c13;
    padding: 3px 5px;
    margin-right: 8px;
    letter-spacing: -0.03em;
  }}
</style>
</head>
<body>
<nav class="barra">
  <div class="barra-grade">
    <span><span class="sigla">DB</span><a href="../index.html">&larr; Status</a></span>
    <span class="edicao">N&ordm; {numero} &middot; {titulo}</span>
  </div>
</nav>
{corpo}
</body>
</html>
"""


def escrever(dados, edicoes, saida):
    saida = Path(saida)
    if saida.exists():
        shutil.rmtree(saida)
    saida.mkdir(parents=True)

    if FONTE_SITE.is_dir():
        for item in FONTE_SITE.iterdir():
            destino = saida / item.name
            if item.is_dir():
                shutil.copytree(item, destino)
            else:
                shutil.copy2(item, destino)
    else:
        print(f"aviso: {FONTE_SITE.name}/ nao existe - saindo so com status.json e edicoes/")

    (saida / "status.json").write_text(
        json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8"
    )

    pasta = saida / "edicoes"
    pasta.mkdir(exist_ok=True)
    for numero, (dia, brief) in enumerate(edicoes, start=1):
        # contato=None: sem link de descadastro, logo sem email no HTML.
        corpo = render.renderizar(brief, contato=None)
        pagina = MOLDE_EDICAO.format(
            titulo=html.escape(render.data_extensa(brief.get("data") or dia)),
            numero=numero,
            corpo=corpo,
        )
        (pasta / f"{dia}.html").write_text(pagina, encoding="utf-8")
    return saida


def conferir(saida):
    """Varre tudo o que vai ser publicado procurando dado pessoal."""
    problemas = []
    for arquivo in sorted(Path(saida).rglob("*")):
        if not arquivo.is_file():
            continue
        try:
            texto = arquivo.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for rotulo, padrao in PADROES_PROIBIDOS:
            achado = padrao.search(texto)
            if achado:
                problemas.append(
                    f"{arquivo.relative_to(saida)}: {rotulo} -> {achado.group(0)[:60]}"
                )
    return problemas


def _contar_inscritos():
    """Ultimo recurso: conta a planilha, se o id estiver no ambiente.

    So enquanto nenhuma entrega foi registrada ainda - dali em diante o
    numero vem de data/entregas.json, que e o que de fato saiu. Conta e
    descarta: a lista de enderecos nao sai desta funcao.
    """
    sheet = os.environ.get("BRIEF_SUBSCRIBERS_SHEET_ID")
    if not sheet:
        return None
    try:
        import subscribers
        dono = os.environ.get("BRIEF_TO") or os.environ.get("GMAIL_USER") or ""
        # +1: o dono recebe o brief mesmo sem estar na planilha.
        return len(subscribers.buscar(sheet, excluir=[dono])) + 1
    except Exception as erro:
        print(f"aviso: nao consegui contar os inscritos ({erro})")
        return None


def main():
    p = argparse.ArgumentParser(description="monta o site de status do Daily Brief")
    p.add_argument("--saida", default=str(SAIDA_PADRAO))
    p.add_argument("--leitores", type=int, default=None,
                   help="numero de leitores a publicar (padrao: a ultima "
                        "entrega registrada em data/entregas.json)")
    p.add_argument("--sem-newsletters", action="store_true",
                   help="omite o ranking de newsletters mais lidas")
    argumentos = p.parse_args()

    edicoes = _edicoes()
    if not edicoes:
        print("FALHOU: nenhuma edicao em data/briefs")
        return 1

    leitores = argumentos.leitores
    if leitores is None:
        # Sem --leitores, usa o ultimo envio registrado. E o numero que de
        # fato recebeu, e evita uma segunda leitura da planilha so para
        # contar linhas.
        entregas = _carregar(ENTREGAS, {})
        for dia in sorted(entregas, reverse=True):
            if entregas[dia].get("destinatarios"):
                leitores = entregas[dia]["destinatarios"]
                break
    if leitores is None:
        leitores = _contar_inscritos()

    dados = agregar(
        edicoes,
        leitores=leitores,
        com_newsletters=not argumentos.sem_newsletters,
    )
    saida = escrever(dados, edicoes, argumentos.saida)

    problemas = conferir(saida)
    if problemas:
        print(f"FALHOU: {len(problemas)} vazamento(s) de dado pessoal na saida:")
        for linha in problemas[:20]:
            print(f"  {linha}")
        return 1

    print(f"site em {saida}")
    print(f"  {dados['projeto']['edicoes']} edicoes, "
          f"{dados['projeto']['itens_curados']} itens, "
          f"sequencia de {dados['projeto']['sequencia']} dia(s)")
    print(f"  {len(dados['fontes'])} fontes no ranking, "
          f"{len(dados['newsletters'])} newsletters, "
          f"{len(dados['saude_fontes'])} fontes monitoradas")
    print("  nenhum dado pessoal encontrado na varredura")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
