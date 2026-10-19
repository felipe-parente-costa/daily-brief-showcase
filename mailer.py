"""Envio do brief por SMTP do Gmail.

Substitui o conector do Gmail quando o brief roda sem o app do Claude aberto.
Usa a mesma senha de app do newsletters.py.
"""

import imaplib
import smtplib
import ssl
from datetime import date, timedelta
from email.message import EmailMessage

HOST = "smtp.gmail.com"
PORTA = 465
HOST_IMAP = "imap.gmail.com"
PASTA_ENVIADOS = '"[Gmail]/Sent Mail"'
PASTA_LIXEIRA = '"[Gmail]/Trash"'
DIAS_EM_ENVIADOS = 1
# smtplib e imaplib esperam para sempre quando nao recebem timeout: conexao
# aceita e depois muda - a execucao do dia trava ate o GitHub matar o job.
TIMEOUT = 60


NOME_REMETENTE = "Daily Brief"


def _montar(usuario, destino, assunto, html, texto):
    """Monta a mensagem com os cabecalhos que evitam a caixa de spam.

    O envio ja passa em SPF e DKIM (sai autenticado pelo SMTP do proprio
    Gmail), entao o problema nao era autenticacao: era parecer disparo em
    massa. Mensagem identica para dezenas de enderecos, sem nome no remetente
    e sem nenhuma forma de sair da lista, e exatamente o perfil que Gmail e
    Outlook classificam como spam.

    List-Unsubscribe e List-Id sao os cabecalhos que declaram "isto e uma lista
    que a pessoa assinou"; o cliente de email mostra o botao de descadastro
    nativo a partir deles. Nao ha One-Click (List-Unsubscribe-Post) de
    proposito: ele exige um endpoint HTTP que aceite POST, e nao existe
    servidor neste projeto - anunciar suporte e nao honrar o POST piora a
    reputacao em vez de melhorar. O mailto: e valido e gratuito.
    """
    msg = EmailMessage()
    msg["Subject"] = assunto
    msg["From"] = f"{NOME_REMETENTE} <{usuario}>"
    msg["To"] = destino
    msg["Reply-To"] = usuario
    dominio = usuario.partition("@")[2] or "gmail.com"
    msg["List-Id"] = f"Daily Brief <daily-brief.{dominio}>"
    msg["List-Unsubscribe"] = f"<mailto:{usuario}?subject=Descadastrar>"
    msg.set_content(texto)
    msg.add_alternative(html, subtype="html")
    return msg


def enviar(usuario, senha, destino, assunto, html, texto, ocultos=None):
    """Uma mensagem separada por pessoa - nunca uma so com varios no envelope.

    A versao anterior mandava uma unica mensagem e punha os amigos apenas no
    envelope SMTP (to_addrs), sem cabecalho Bcc. Parecia seguro, mas o Gmail
    reconstroi um `Bcc:` com todos os enderecos na copia que fica em Enviados
    - e encaminhar essa copia leva a lista inteira junto. Foi o que aconteceu.

    Com uma mensagem por destinatario nao existe Bcc em lugar nenhum: cada
    copia tem so o proprio endereco no `To`, e encaminhar nao revela ninguem.
    Tambem abre caminho para descadastro individual mais tarde.

    O dono e obrigatorio: se a mensagem dele falhar, o erro sobe. Falha de um
    amigo e registrada e o envio continua - um endereco morto na planilha nao
    pode derrubar a edicao nem impedir o registro em seen.json, que e o que
    evita reenvio em massa na proxima tentativa do cron.
    """
    amigos = [e for e in (ocultos or []) if e and e != destino]
    enviados, falhas = [], []

    contexto = ssl.create_default_context()
    with smtplib.SMTP_SSL(HOST, PORTA, context=contexto, timeout=TIMEOUT) as servidor:
        servidor.login(usuario, senha)

        servidor.send_message(_montar(usuario, destino, assunto, html, texto))
        enviados.append(destino)

        for amigo in amigos:
            try:
                servidor.send_message(_montar(usuario, amigo, assunto, html, texto))
                enviados.append(amigo)
            except Exception as erro:
                falhas.append((amigo, str(erro)))

    return enviados, falhas


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
    with smtplib.SMTP_SSL(HOST, PORTA, context=contexto, timeout=TIMEOUT) as servidor:
        servidor.login(usuario, senha)
        servidor.send_message(msg)


def limpar_enviados(usuario, senha, dias=DIAS_EM_ENVIADOS):
    """Move para a lixeira as copias em Enviados mais velhas que `dias` dia(s).

    Uma mensagem por destinatario (ver enviar()) significa uma copia em
    Enviados por amigo, todo santo dia - e nenhuma delas saia de la sozinha,
    entao a pasta so cresce. Aqui elas saem: ficam visiveis por `dias` dia(s)
    (tempo de sobra para conferir que o envio aconteceu) e depois vao para a
    lixeira, de onde o Gmail as apaga de vez em 30 dias.

    "NOT TO usuario" e o que protege a copia que cai na sua propria Inbox: ela
    tem o mesmo assunto e o mesmo remetente, mas o destinatario e voce mesmo -
    e a unica que precisa ficar. Excluir pelo destinatario, em vez de tentar
    diferenciar por rotulo do Gmail, evita depender de um comportamento de
    IMAP que varia entre provedor e que seria dificil de testar sem arriscar
    apagar a leitura de verdade.

    BEFORE do IMAP exclui o proprio dia informado (so pega o que e anterior).
    Por isso o limite e hoje menos (dias - 1), nao hoje menos dias: com
    dias=1 o alvo e "BEFORE hoje", que pega tudo de ontem para tras - a copia
    de ontem fica visivel o dia inteiro de ontem e some no primeiro run de
    hoje. Descontar so `dias` deixava a copia mais velha um dia a mais do que
    o pedido (pegou isso no teste de 31/08: o lote de 30/08 ficou para tras).
    """
    limite = (date.today() - timedelta(days=dias - 1)).strftime("%d-%b-%Y")
    criterio = f'(BEFORE {limite}) (SUBJECT "Daily Brief") NOT (TO "{usuario}")'

    conexao = imaplib.IMAP4_SSL(HOST_IMAP, timeout=TIMEOUT)
    try:
        conexao.login(usuario, senha)
        conexao.select(PASTA_ENVIADOS)
        ok, dados = conexao.search(None, criterio)
        if ok != "OK" or not dados or not dados[0]:
            return 0

        ids = dados[0].split()
        id_set = b",".join(ids).decode()
        conexao.copy(id_set, PASTA_LIXEIRA)
        conexao.store(id_set, "+FLAGS", r"\Deleted")
        conexao.expunge()
        return len(ids)
    finally:
        try:
            conexao.logout()
        except Exception:
            pass
