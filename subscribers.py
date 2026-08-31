"""Lista de amigos inscritos, lida direto da planilha do Google Forms.

Sem autenticacao: a planilha esta compartilhada como "qualquer pessoa com o
link, leitor", entao o export CSV responde a um GET simples. E por isso que
esta lista nao precisa de secret nenhum - o link em si nao da acesso de
escrita a nada, so leitura do que ja e publico.

Formulario e planilha ficam fora deste repositorio (Google Forms + Sheets).
O `pipeline.py` e o `curator.py` nao entram aqui: inscricao e distribuicao,
nao curadoria.
"""

import csv
import io
import re
import urllib.request

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
TIMEOUT = 15

# O formulario e publico: qualquer um pode enviar quantos enderecos quiser.
# Este teto e o limite de estrago se alguem despejar lixo la - o envio para
# de crescer em vez de virar centenas de mensagens num dia so (e a conta
# gratuita do Gmail corta em ~500/dia de qualquer forma). Passar do teto e
# sinal de abuso, nao de sucesso: melhor cortar e avisar no log.
TETO_INSCRITOS = 100


def _url_csv(sheet_id):
    return f"https://docs.google.com/spreadsheets/d/{sheet_id}/export?format=csv"


def _coluna_email(campos):
    """Acha a coluna certa mesmo se o titulo da pergunta mudar de caixa."""
    for nome in campos:
        if nome.strip().lower() == "email":
            return nome
    return None


def buscar(sheet_id, excluir=(), teto=TETO_INSCRITOS):
    """Baixa a planilha e devolve uma lista de emails validos e unicos.

    `excluir` tira o dono do brief da lista de amigos, caso ele mesmo
    preencha o formulario por engano - ele ja recebe pelo envio principal.

    `teto` corta a lista se ela passar do limite: o formulario e publico e
    aceita qualquer coisa, entao um pico anormal e mais provavelmente abuso
    que crescimento real. Corta e avisa, em vez de disparar em massa.
    """
    excluir = {e.strip().lower() for e in excluir if e}
    req = urllib.request.Request(_url_csv(sheet_id), headers={"User-Agent": "daily-brief/1.0"})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resposta:
        bruto = resposta.read().decode("utf-8-sig")

    leitor = csv.DictReader(io.StringIO(bruto))
    coluna = _coluna_email(leitor.fieldnames or [])
    if not coluna:
        raise ValueError(f"planilha sem coluna 'Email' - colunas encontradas: {leitor.fieldnames}")

    vistos, emails = set(), []
    for linha in leitor:
        candidato = (linha.get(coluna) or "").strip().lower()
        if not candidato or candidato in vistos or candidato in excluir:
            continue
        if not EMAIL_RE.match(candidato):
            continue
        vistos.add(candidato)
        emails.append(candidato)

    if teto and len(emails) > teto:
        print(f"ATENCAO: {len(emails)} inscritos na planilha, acima do teto de {teto}."
              f" Enviando so para os {teto} primeiros - confira se houve abuso do formulario.")
        emails = emails[:teto]
    return emails
