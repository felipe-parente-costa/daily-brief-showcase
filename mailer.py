"""Envio do brief por SMTP do Gmail.

Substitui o conector do Gmail quando o brief roda sem o app do Claude aberto.
Usa a mesma senha de app do newsletters.py.
"""

import smtplib
import ssl
from email.message import EmailMessage

HOST = "smtp.gmail.com"
PORTA = 465


def enviar(usuario, senha, destino, assunto, html, texto, ocultos=None):
    """Manda o email em multipart/alternative - texto puro e HTML.

    `ocultos` e a lista de amigos inscritos pelo formulario. Eles entram so
    no envelope SMTP (via to_addrs), nunca num cabecalho Bcc na mensagem -
    assim ninguem descobre quem mais recebe, e nao dependemos do smtplib
    remover o Bcc por conta propria.
    """
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = usuario
    msg["To"] = destino
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")

    destinatarios = [destino] + [e for e in (ocultos or []) if e and e != destino]

    contexto = ssl.create_default_context()
    with smtplib.SMTP_SSL(HOST, PORTA, context=contexto) as servidor:
        servidor.login(usuario, senha)
        servidor.send_message(msg, to_addrs=destinatarios)
    return destinatarios


def avisar_falha(usuario, senha, destino, data, erro):
    """Email curto quando a coleta quebra inteira - nunca inventar conteudo."""
    assunto = f"Daily Brief {data} - falha na coleta"
    corpo = (
        "O Daily Brief de hoje nao pode ser gerado.\n\n"
        f"Erro: {erro}\n\n"
        "Nenhum conteudo foi inventado. A proxima execucao tenta de novo."
    )
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = usuario
    msg["To"] = destino
    msg.set_content(corpo)

    contexto = ssl.create_default_context()
    with smtplib.SMTP_SSL(HOST, PORTA, context=contexto) as servidor:
        servidor.login(usuario, senha)
        servidor.send_message(msg)
