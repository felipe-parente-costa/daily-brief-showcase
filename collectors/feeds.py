"""Coleta de RSS/Atom usando apenas a biblioteca padrao.

Nenhuma dependencia externa: urllib + xml.etree dao conta dos feeds em
config/sources.json. Uma fonte que falha nao derruba a coleta - o erro e
registrado e o pipeline segue com o resto.
"""

import codecs
import gzip
import html
import re
import time
import zlib
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from xml.etree import ElementTree

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DailyBrief/1.0"
TIMEOUT = 20
ATOM = "{http://www.w3.org/2005/Atom}"
TAG_RE = re.compile(r"<[^>]+>")
WS_RE = re.compile(r"\s+")


def descomprimir(dados, content_encoding=""):
    """Descomprime a resposta quando vem gzip ou deflate.

    Alguns servidores (o do G1, por exemplo) mandam gzip de forma intermitente,
    mesmo sem `Accept-Encoding` no pedido e as vezes sem declarar no cabecalho.
    Por isso a checagem tambem olha os bytes magicos, nao so o header.
    """
    if dados[:2] == b"\x1f\x8b":
        return gzip.decompress(dados)
    if "deflate" in content_encoding:
        return zlib.decompress(dados, -zlib.MAX_WBITS)
    return dados


def buscar(url, timeout=TIMEOUT, tentativas=3):
    """Baixa a URL, descomprime se preciso, e devolve os bytes crus.

    Com retry para falha transitoria de rede: sem ele uma fonte some do brief
    sem explicacao nenhuma.
    """
    ultimo_erro = None
    for tentativa in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return descomprimir(resp.read(), resp.headers.get("Content-Encoding", ""))
        except Exception as exc:
            ultimo_erro = exc
            if tentativa < tentativas - 1:
                time.sleep(1.5 * (tentativa + 1))
    raise ultimo_erro


def limpar(texto, limite=400):
    """Tira tags HTML, normaliza espacos e corta no limite."""
    if not texto:
        return ""
    texto = html.unescape(TAG_RE.sub(" ", texto))
    texto = WS_RE.sub(" ", texto).strip()
    if len(texto) > limite:
        texto = texto[:limite].rsplit(" ", 1)[0] + "..."
    return texto


def _data(bruta):
    """Converte pubDate (RFC 822) ou published (ISO 8601) em datetime UTC."""
    if not bruta:
        return None
    bruta = bruta.strip()
    try:
        dt = parsedate_to_datetime(bruta)
    except (TypeError, ValueError):
        try:
            dt = datetime.fromisoformat(bruta.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _texto(elem, *tags):
    """Primeiro texto nao vazio entre as tags candidatas."""
    for tag in tags:
        achado = elem.find(tag)
        if achado is not None:
            if achado.text and achado.text.strip():
                return achado.text
            # Atom guarda o link em atributo, nao em texto
            if achado.get("href"):
                return achado.get("href")
    return ""


def _entradas(raiz):
    """Devolve os itens do feed, seja RSS 2.0 ou Atom."""
    itens = raiz.findall(".//item")
    if itens:
        return itens, False
    return raiz.findall(f".//{ATOM}entry"), True


def normalizar_bytes(conteudo):
    """Remove BOM e espacos antes do XML - o feed do Fed vem com BOM UTF-8."""
    return conteudo.lstrip(codecs.BOM_UTF8).lstrip()


def parsear(conteudo):
    """Converte os bytes do feed numa lista de dicionarios normalizados."""
    raiz = ElementTree.fromstring(normalizar_bytes(conteudo))
    entradas, atom = _entradas(raiz)
    saida = []
    for e in entradas:
        if atom:
            titulo = _texto(e, f"{ATOM}title")
            link = _texto(e, f"{ATOM}link")
            data = _texto(e, f"{ATOM}published", f"{ATOM}updated")
            resumo = _texto(e, f"{ATOM}summary", f"{ATOM}content")
        else:
            titulo = _texto(e, "title")
            link = _texto(e, "link", "guid")
            data = _texto(e, "pubDate", "{http://purl.org/dc/elements/1.1/}date")
            resumo = _texto(e, "description", "{http://purl.org/rss/1.0/modules/content/}encoded")
        titulo = limpar(titulo, 300)
        if not titulo:
            continue
        publicado = _data(data)
        saida.append({
            "titulo": titulo,
            "link": (link or "").strip(),
            "publicado": publicado.isoformat() if publicado else None,
            "_dt": publicado,
            "resumo": limpar(resumo),
        })
    return saida


def coletar(feed, janela_horas=30):
    """Coleta um feed da config e devolve o resultado com status."""
    resultado = {
        "id": feed["id"],
        "nome": feed["nome"],
        "secao": feed["secao"],
        "ok": False,
        "erro": None,
        "itens": [],
    }
    try:
        conteudo = normalizar_bytes(buscar(feed["url"]))
        if conteudo[:1] != b"<":
            amostra = conteudo[:120].decode("utf-8", "replace").strip()
            raise ValueError(f"resposta nao e XML: {amostra!r}")
        itens = parsear(conteudo)
    except urllib.error.HTTPError as exc:
        resultado["erro"] = f"HTTP {exc.code}"
        return resultado
    except Exception as exc:  # rede, XML malformado, timeout
        resultado["erro"] = f"{type(exc).__name__}: {exc}"
        return resultado

    corte = datetime.now(timezone.utc) - timedelta(hours=janela_horas)
    recentes = [i for i in itens if i["_dt"] is None or i["_dt"] >= corte]
    # Sem data valida em nenhum item: confia na ordem do feed em vez de descartar tudo
    if not recentes:
        recentes = itens[: feed.get("max_itens", 15)]
    recentes.sort(key=lambda i: i["_dt"] or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

    for item in recentes[: feed.get("max_itens", 15)]:
        item.pop("_dt", None)
        item["fonte"] = feed["nome"]
        item["secao"] = feed["secao"]
        resultado["itens"].append(item)

    resultado["ok"] = True
    return resultado
