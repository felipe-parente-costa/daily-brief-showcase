"""Leitura das newsletters assinadas, via IMAP do Gmail.

Substitui o conector do Gmail quando o brief roda sem o app do Claude aberto
(GitHub Actions, agendador local). As buscas sao as mesmas tres rotas descritas
no BRIEF.md - alias, marcador e LinkedIn - expressas em X-GM-RAW, que aceita a
sintaxe de busca do proprio Gmail.

Precisa de uma senha de app do Google (a senha normal da conta nao funciona no
IMAP quando a verificacao em duas etapas esta ligada).
"""

import email
import imaplib
from email.header import decode_header, make_header

HOST = "imap.gmail.com"
TETO_PADRAO = 12
CORPO_MAX = 6000


def _assunto(msg):
    bruto = msg.get("Subject", "")
    try:
        return str(make_header(decode_header(bruto))).strip()
    except Exception:
        return bruto.strip()


def _corpo(msg):
    """Extrai o text/plain. HTML de marketing nao entra: estoura o contexto."""
    if msg.is_multipart():
        for parte in msg.walk():
            if parte.get_content_type() != "text/plain":
                continue
            if "attachment" in str(parte.get("Content-Disposition", "")):
                continue
            carga = parte.get_payload(decode=True)
            if carga:
                return carga.decode(parte.get_content_charset() or "utf-8", "replace")
        return ""
    carga = msg.get_payload(decode=True)
    if not carga:
        return ""
    return carga.decode(msg.get_content_charset() or "utf-8", "replace")


def _limpar(texto):
    linhas = [l.rstrip() for l in texto.splitlines()]
    enxuto, vazias = [], 0
    for linha in linhas:
        if not linha.strip():
            vazias += 1
            if vazias > 1:
                continue
        else:
            vazias = 0
        enxuto.append(linha)
    return "\n".join(enxuto).strip()


def _buscar_query(conexao, query):
    ok, dados = conexao.search(None, "X-GM-RAW", f'"{query}"')
    if ok != "OK" or not dados or not dados[0]:
        return []
    return dados[0].split()


def buscar(usuario, senha, alias, teto=TETO_PADRAO):
    """Devolve [{assunto, remetente, corpo}] das newsletters das ultimas 24h.

    As tres rotas somam, nao se excluem. Falha de rota nao derruba a coleta:
    dia sem newsletter e dia normal, a secao simplesmente nao sai.
    """
    rotas = [
        f"to:{alias} newer_than:1d",
        "label:Brief/Fontes newer_than:1d",
        "from:newsletters-noreply@linkedin.com newer_than:1d",
    ]

    conexao = imaplib.IMAP4_SSL(HOST)
    try:
        conexao.login(usuario, senha)
        conexao.select('"[Gmail]/All Mail"', readonly=True)

        vistos, encontrados = set(), []
        for query in rotas:
            try:
                ids = _buscar_query(conexao, query)
            except Exception:
                continue
            for uid in ids:
                if uid in vistos or len(encontrados) >= teto:
                    continue
                vistos.add(uid)
                ok, dados = conexao.fetch(uid, "(RFC822)")
                if ok != "OK" or not dados or not isinstance(dados[0], tuple):
                    continue
                msg = email.message_from_bytes(dados[0][1])
                corpo = _limpar(_corpo(msg))
                if not corpo:
                    continue
                encontrados.append(
                    {
                        "assunto": _assunto(msg),
                        "remetente": msg.get("From", ""),
                        "corpo": corpo[:CORPO_MAX],
                    }
                )
        return encontrados
    finally:
        try:
            conexao.logout()
        except Exception:
            pass
