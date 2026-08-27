"""Coleta de indicadores de mercado a partir de APIs publicas.

Fontes: Yahoo Finance (chart v8), AwesomeAPI (cambio), CoinGecko (cripto)
e Banco Central / SGS (Selic e IPCA). Cada fetcher e isolado: se um cai,
os outros continuam e o indicador ausente aparece como erro no relatorio.
"""

import json
import urllib.parse

from collectors.feeds import buscar


def formatar(valor, casas=2, prefixo="", sufixo=""):
    """Formata numero no padrao brasileiro: 1.234,56"""
    if valor is None:
        return "-"
    texto = f"{valor:,.{casas}f}".replace(",", "\x00").replace(".", ",").replace("\x00", ".")
    return f"{prefixo}{texto}{sufixo}"


def _variacao(atual, anterior):
    if atual is None or not anterior:
        return None
    return round((atual - anterior) / anterior * 100, 2)


def _registro(cfg, valor, variacao, fonte, referencia=None):
    return {
        "nome": cfg["nome"],
        "grupo": cfg["grupo"],
        "valor": formatar(valor, cfg.get("casas", 2), cfg.get("prefixo", ""), cfg.get("sufixo", "")),
        "valor_num": valor,
        "variacao_pct": variacao,
        "fonte": fonte,
        "referencia": referencia,
    }


def yahoo(cfg):
    """Indices, juros e commodities via Yahoo Finance chart API.

    Atencao ao fechamento anterior: `previousClose` vem nulo e
    `chartPreviousClose` e o fechamento anterior a JANELA pedida (5 dias atras),
    nao a vespera. O valor certo e o penultimo fechamento da serie - funciona
    tanto com mercado aberto (penultimo = vespera) quanto fechado.
    """
    simbolo = urllib.parse.quote(cfg["simbolo"], safe="")
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{simbolo}?interval=1d&range=5d"
    dados = json.loads(buscar(url))
    resultado = (dados.get("chart") or {}).get("result")
    if not resultado:
        raise ValueError((dados.get("chart") or {}).get("error") or "resposta vazia")
    serie = resultado[0]
    meta = serie["meta"]
    fechamentos = [c for c in serie["indicators"]["quote"][0]["close"] if c is not None]
    atual = meta.get("regularMarketPrice") or (fechamentos[-1] if fechamentos else None)
    if len(fechamentos) >= 2:
        anterior = fechamentos[-2]
    else:
        anterior = meta.get("chartPreviousClose")
    return _registro(cfg, atual, _variacao(atual, anterior), "Yahoo Finance")


def awesomeapi(cfg):
    """Cambio via AwesomeAPI - ja entrega a variacao do dia."""
    par = cfg["par"]
    dados = json.loads(buscar(f"https://economia.awesomeapi.com.br/last/{par}"))
    bloco = dados[par.replace("-", "")]
    return _registro(cfg, float(bloco["bid"]), round(float(bloco["pctChange"]), 2), "AwesomeAPI")


def coingecko_lote(cfgs):
    """Cripto via CoinGecko, com variacao de 24h.

    Em lote de proposito: a API gratuita responde 429 com poucas chamadas por
    minuto, e uma requisicao por moeda derruba a coleta quando o --check roda
    junto com a coleta do dia.
    """
    ids = ",".join(c["id"] for c in cfgs)
    url = (
        "https://api.coingecko.com/api/v3/simple/price"
        f"?ids={ids}&vs_currencies=usd&include_24hr_change=true"
    )
    dados = json.loads(buscar(url))
    saida = []
    for cfg in cfgs:
        bloco = dados[cfg["id"]]
        saida.append(_registro(cfg, bloco["usd"], round(bloco["usd_24h_change"], 2), "CoinGecko"))
    return saida


def bcb(cfg):
    """Series do SGS/Banco Central. Sem variacao: sao niveis, nao precos."""
    serie = cfg["serie"]
    url = f"https://api.bcb.gov.br/dados/serie/bcdata.sgs.{serie}/dados/ultimos/1?formato=json"
    ponto = json.loads(buscar(url))[0]
    reg = _registro(cfg, float(ponto["valor"]), None, "Banco Central", ponto.get("data"))
    reg["casas_forcadas"] = True
    return reg


COLETORES = {"yahoo": yahoo, "awesomeapi": awesomeapi, "bcb": bcb}
# Provedores que buscam a lista inteira numa requisicao so
COLETORES_LOTE = {"coingecko": coingecko_lote}


def coletar(config_mercado):
    """Roda todos os fetchers configurados. Devolve (indicadores, erros)."""
    indicadores, erros = [], []
    for provedor, entradas in config_mercado.items():
        em_lote = COLETORES_LOTE.get(provedor)
        if em_lote is not None:
            try:
                indicadores.extend(em_lote(entradas))
            except Exception as exc:
                erros.append({"fonte": provedor, "erro": f"{type(exc).__name__}: {exc}"})
            continue

        funcao = COLETORES.get(provedor)
        if funcao is None:
            erros.append({"fonte": provedor, "erro": "provedor desconhecido"})
            continue
        for cfg in entradas:
            rotulo = cfg.get("nome", cfg.get("simbolo", provedor))
            try:
                indicadores.append(funcao(cfg))
            except Exception as exc:
                erros.append({"fonte": rotulo, "erro": f"{type(exc).__name__}: {exc}"})
    return indicadores, erros
