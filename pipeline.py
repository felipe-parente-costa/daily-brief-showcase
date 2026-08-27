"""Estagio 1 do Daily Brief: coleta determinista.

Uso:
    python pipeline.py            coleta o dia e grava data/raw/AAAA-MM-DD.json
    python pipeline.py --check    testa todas as fontes e imprime um relatorio
    python pipeline.py --marcar data/briefs/AAAA-MM-DD.json
                                  registra os links ja publicados em data/seen.json

O LLM nao roda nada disso: aqui e so buscar, normalizar e gravar.
"""

import argparse
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from collectors import feeds, markets  # noqa: E402

BASE = Path(__file__).parent
CONFIG = BASE / "config" / "sources.json"
RAW = BASE / "data" / "raw"
SEEN = BASE / "data" / "seen.json"
DIAS_DE_MEMORIA = 7
NEGRITO_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)


def carregar_config():
    return json.loads(CONFIG.read_text(encoding="utf-8"))


def carregar_vistos():
    """Links publicados nos ultimos dias, ja podados pela janela de memoria."""
    if not SEEN.exists():
        return {}
    registro = json.loads(SEEN.read_text(encoding="utf-8"))
    corte = (date.today() - timedelta(days=DIAS_DE_MEMORIA)).isoformat()
    return {dia: links for dia, links in registro.items() if dia >= corte}


def _links_do_brief(brief):
    for secao in brief.get("secoes", []):
        for item in secao.get("itens", []):
            for link in item.get("links", []):
                if link:
                    yield secao.get("id", "?"), item.get("titulo", ""), link


TETO_DESTAQUES = {"abertura": 1, "texto": 2, "titulo": 0}


def _checar_destaques(brief):
    """Aplica o teto de negritos. Destaque demais polui e perde o efeito."""
    alertas = []
    n = len(NEGRITO_RE.findall(brief.get("abertura", "")))
    if n > TETO_DESTAQUES["abertura"]:
        alertas.append(f'abertura: {n} destaques (teto {TETO_DESTAQUES["abertura"]})')
    for secao in brief.get("secoes", []):
        for item in secao.get("itens", []):
            for campo in ("titulo", "texto"):
                n = len(NEGRITO_RE.findall(item.get(campo, "")))
                if n > TETO_DESTAQUES[campo]:
                    alertas.append(
                        f'[{secao.get("id")}] {item.get("titulo", "")[:40]} '
                        f'- {campo}: {n} destaques (teto {TETO_DESTAQUES[campo]})'
                    )
    return alertas


def validar(caminho_brief):
    """Confere links e teto de destaques do brief.

    Guarda-corpo contra link inventado ou colado do item errado: e o tipo de
    erro que passa despercebido na leitura e so aparece quando o leitor clica.
    """
    brief = json.loads(Path(caminho_brief).read_text(encoding="utf-8"))
    raw = RAW / f"{brief['data']}.json"
    if not raw.exists():
        print(f"FALHOU: coleta {raw.name} nao encontrada")
        return 1
    validos = {i["link"] for i in json.loads(raw.read_text(encoding="utf-8"))["itens"]}
    problemas = [(s, t, l) for s, t, l in _links_do_brief(brief) if l not in validos]
    total = sum(1 for _ in _links_do_brief(brief))
    for secao, titulo, link in problemas:
        print(f"FALHOU [{secao}] {titulo[:45]} -> {link}")
    print(f"{total - len(problemas)}/{total} links conferem com a coleta do dia")

    alertas = _checar_destaques(brief)
    for alerta in alertas:
        print(f"FALHOU destaque {alerta}")
    print(f"{len(alertas)} item(ns) acima do teto de destaques")
    return 1 if problemas or alertas else 0


def marcar_vistos(caminho_brief):
    """Le um brief pronto e registra todos os links dele como ja publicados."""
    brief = json.loads(Path(caminho_brief).read_text(encoding="utf-8"))
    links = {l for _, _, l in _links_do_brief(brief)}
    registro = carregar_vistos()
    hoje = date.today().isoformat()
    registro[hoje] = sorted(set(registro.get(hoje, [])) | links)
    SEEN.write_text(json.dumps(registro, ensure_ascii=False, indent=2), encoding="utf-8")
    return len(links)


def coletar(config):
    """Roda feeds e mercado em paralelo e devolve o pacote bruto do dia."""
    janela = config.get("janela_horas", 30)
    erros = []

    with ThreadPoolExecutor(max_workers=8) as pool:
        futuro_mercado = pool.submit(markets.coletar, config["mercado"])
        resultados = list(pool.map(lambda f: feeds.coletar(f, janela), config["feeds"]))

    indicadores, erros_mercado = futuro_mercado.result()
    erros.extend(erros_mercado)

    # Dedupe so contra edicoes ANTERIORES. Incluir o dia de hoje faria uma
    # recoleta apos o --marcar apagar os proprios itens do brief que acabou de sair.
    hoje = date.today().isoformat()
    vistos = {l for dia, links in carregar_vistos().items() if dia < hoje for l in links}
    itens, repetidos = [], 0
    for r in resultados:
        if not r["ok"]:
            erros.append({"fonte": r["nome"], "erro": r["erro"]})
            continue
        for item in r["itens"]:
            if item["link"] and item["link"] in vistos:
                repetidos += 1
                continue
            itens.append(item)

    itens.sort(key=lambda i: i["publicado"] or "", reverse=True)
    return {
        "data": date.today().isoformat(),
        "gerado_em": datetime.now().astimezone().isoformat(timespec="seconds"),
        "janela_horas": janela,
        "mercado": indicadores,
        "itens": itens,
        "descartados_por_repeticao": repetidos,
        "fontes_com_erro": erros,
    }


def mesclar_coleta_do_dia(pacote, destino):
    """Soma a coleta nova a que ja existia para o mesmo dia.

    Feed e janela deslizante: uma materia da manha pode ter saido do RSS ao meio-dia.
    Sem a mescla, rodar o pipeline duas vezes no mesmo dia apaga itens que o brief
    ja citou - e o --validar passa a acusar link valido como inventado.
    Cotacao nao se mescla: vale sempre a leitura mais recente.
    """
    if not destino.exists():
        return 0
    anterior = json.loads(destino.read_text(encoding="utf-8"))
    conhecidos = {i["link"] for i in pacote["itens"] if i["link"]}
    reaproveitados = [i for i in anterior.get("itens", []) if i["link"] not in conhecidos]
    pacote["itens"].extend(reaproveitados)
    pacote["itens"].sort(key=lambda i: i["publicado"] or "", reverse=True)
    return len(reaproveitados)


def checar(config):
    """Testa cada fonte isoladamente e imprime status - use ao adicionar feed novo."""
    print(f"{'FONTE':<22} {'STATUS':<8} DETALHE")
    print("-" * 62)
    falhas = 0
    with ThreadPoolExecutor(max_workers=8) as pool:
        for r in pool.map(lambda f: feeds.coletar(f, config.get("janela_horas", 30)), config["feeds"]):
            status = "ok" if r["ok"] else "FALHOU"
            falhas += 0 if r["ok"] else 1
            detalhe = f"{len(r['itens'])} itens" if r["ok"] else r["erro"]
            print(f"{r['nome']:<22} {status:<8} {detalhe}")
    indicadores, erros = markets.coletar(config["mercado"])
    for i in indicadores:
        print(f"{i['nome']:<22} {'ok':<8} {i['valor']}")
    for e in erros:
        falhas += 1
        print(f"{e['fonte']:<22} {'FALHOU':<8} {e['erro']}")
    print("-" * 62)
    print("todas as fontes responderam" if not falhas else f"{falhas} fonte(s) com problema")
    return 0 if not falhas else 1


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="Coleta do Daily Brief")
    parser.add_argument("--check", action="store_true", help="testa as fontes sem gravar nada")
    parser.add_argument("--validar", metavar="BRIEF", help="confere se os links do brief vieram da coleta")
    parser.add_argument("--marcar", metavar="BRIEF", help="registra os links de um brief em seen.json")
    args = parser.parse_args()

    config = carregar_config()

    if args.check:
        return checar(config)

    if args.validar:
        return validar(args.validar)

    if args.marcar:
        total = marcar_vistos(args.marcar)
        print(f"{total} links registrados em {SEEN}")
        return 0

    pacote = coletar(config)
    RAW.mkdir(parents=True, exist_ok=True)
    destino = RAW / f"{pacote['data']}.json"
    reaproveitados = mesclar_coleta_do_dia(pacote, destino)
    destino.write_text(json.dumps(pacote, ensure_ascii=False, indent=2), encoding="utf-8")

    print(f"gravado: {destino}")
    print(f"  {len(pacote['itens'])} itens de {len(config['feeds'])} feeds"
          + (f" ({reaproveitados} de coleta anterior de hoje)" if reaproveitados else ""))
    print(f"  {len(pacote['mercado'])} indicadores de mercado")
    print(f"  {pacote['descartados_por_repeticao']} itens descartados por repeticao")
    if pacote["fontes_com_erro"]:
        print("  fontes com erro:")
        for e in pacote["fontes_com_erro"]:
            print(f"    - {e['fonte']}: {e['erro']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
