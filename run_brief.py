"""Ciclo completo do Daily Brief, sem ninguem por perto.

Coleta -> newsletters -> curadoria pela API -> poda -> render -> envio -> registro.

E o equivalente automatizado do BRIEF.md: mesma ordem, mesmas regras, sem
depender do app do Claude nem do conector do Gmail. Roda no GitHub Actions ou
em qualquer agendador.

Variaveis de ambiente:
    GEMINI_API_KEY        chave da curadoria quando BRIEF_PROVIDER=gemini (padrao)
    ANTHROPIC_API_KEY     chave da curadoria quando BRIEF_PROVIDER=anthropic
    GMAIL_USER            a conta que le as newsletters e envia o brief
    GMAIL_APP_PASSWORD    senha de app do Google (IMAP e SMTP)
    BRIEF_TO              destinatario (padrao: GMAIL_USER)
    BRIEF_ALIAS           alias das assinaturas (padrao: usuario+brief@dominio)
    BRIEF_PROVIDER        gemini (padrao) ou anthropic
    BRIEF_MODELO          sobrescreve o modelo padrao do provedor
    BRIEF_SUBSCRIBERS_SHEET_ID  id da planilha de inscritos (opcional, sem ela
                          o brief so vai para BRIEF_TO)
"""

import json
import os
import sys
from datetime import date
from pathlib import Path

BASE = Path(__file__).parent
sys.path.insert(0, str(BASE))

import curator  # noqa: E402
import mailer  # noqa: E402
import newsletters  # noqa: E402
import pipeline  # noqa: E402
import render  # noqa: E402
import subscribers  # noqa: E402

BRIEFS = BASE / "data" / "briefs"


def _alias_padrao(usuario):
    local, _, dominio = usuario.partition("@")
    return f"{local}+brief@{dominio}"


CHAVE_DO_PROVEDOR = {"gemini": "GEMINI_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}
VERDADEIROS = ("1", "true", "yes", "on")


def _ligado(nome):
    """O GitHub manda input booleano nao marcado como a string "false", entao
    checar so "a variavel existe" acionaria a flag sem querer."""
    return os.environ.get(nome, "").strip().lower() in VERDADEIROS


def _ambiente():
    usuario = os.environ.get("GMAIL_USER", "").strip()
    senha = os.environ.get("GMAIL_APP_PASSWORD", "").strip()
    if not usuario or not senha:
        raise SystemExit("GMAIL_USER e GMAIL_APP_PASSWORD sao obrigatorios")

    provedor = os.environ.get("BRIEF_PROVIDER", "").strip() or curator.PROVEDOR
    chave = CHAVE_DO_PROVEDOR.get(provedor)
    if not chave:
        raise SystemExit(f"BRIEF_PROVIDER invalido: {provedor} (use gemini ou anthropic)")
    if not os.environ.get(chave, "").strip():
        raise SystemExit(f"{chave} e obrigatorio com BRIEF_PROVIDER={provedor}")

    return {
        "usuario": usuario,
        "senha": senha,
        "destino": os.environ.get("BRIEF_TO", "").strip() or usuario,
        "alias": os.environ.get("BRIEF_ALIAS", "").strip() or _alias_padrao(usuario),
        "provedor": provedor,
        "modelo": os.environ.get("BRIEF_MODELO", "").strip() or None,
        "sheet_id": os.environ.get("BRIEF_SUBSCRIBERS_SHEET_ID", "").strip() or None,
        # Teste: gera e manda o brief real, mas so para o dono. Nao toca na
        # planilha e nao registra em seen.json - assim o envio de verdade do
        # dia acontece normalmente depois, para todo mundo.
        "so_dono": _ligado("BRIEF_SO_DONO"),
        # So vale em modo teste: finge uma lista de inscritos. Serve para
        # exercitar o caminho de varios destinatarios (que e onde o Bcc
        # vazava) usando aliases da propria caixa, sem enviar para ninguem.
        "amigos_teste": [
            e.strip()
            for e in os.environ.get("BRIEF_AMIGOS_TESTE", "").split(",")
            if e.strip()
        ],
    }


def coletar_dia():
    """Roda o estagio 1 e grava data/raw/AAAA-MM-DD.json, mesclando o que ja havia."""
    config = pipeline.carregar_config()
    pacote = pipeline.coletar(config)
    pipeline.RAW.mkdir(parents=True, exist_ok=True)
    destino = pipeline.RAW / f"{pacote['data']}.json"
    pipeline.mesclar_coleta_do_dia(pacote, destino)
    destino.write_text(json.dumps(pacote, ensure_ascii=False, indent=2), encoding="utf-8")
    return pacote


def _aparar_destaques(texto, teto):
    """Deixa no maximo `teto` negritos e desmarca o excedente, sem perder palavra."""
    if teto <= 0:
        return pipeline.NEGRITO_RE.sub(r"\1", texto)
    vistos = 0

    def troca(m):
        nonlocal vistos
        vistos += 1
        return m.group(0) if vistos <= teto else m.group(1)

    return pipeline.NEGRITO_RE.sub(troca, texto)


def podar(brief, pacote):
    """Remove o que o --validar recusaria: link fora da coleta e destaque demais.

    Sem humano no loop nao existe "corrija antes de renderizar". Link que nao
    saiu da coleta de hoje e cortado; item que fica sem link nenhum sai fora.
    """
    validos = {i["link"] for i in pacote.get("itens", []) if i.get("link")}
    cortes = {"links": 0, "itens": 0}

    for secao in brief.get("secoes", []):
        sobreviventes = []
        for item in secao.get("itens", []):
            pares = list(zip(item.get("links", []), item.get("fontes", [])))
            limpos = [(l, f) for l, f in pares if l in validos]
            cortes["links"] += len(pares) - len(limpos)
            if not limpos:
                cortes["itens"] += 1
                continue
            item["links"] = [l for l, _ in limpos]
            item["fontes"] = [f for _, f in limpos]
            item["titulo"] = _aparar_destaques(
                item.get("titulo", ""), pipeline.TETO_DESTAQUES["titulo"]
            )
            item["texto"] = _aparar_destaques(
                item.get("texto", ""), pipeline.TETO_DESTAQUES["texto"]
            )
            sobreviventes.append(item)
        secao["itens"] = sobreviventes

    brief["secoes"] = [s for s in brief.get("secoes", []) if s.get("itens")]
    brief["abertura"] = _aparar_destaques(
        brief.get("abertura", ""), pipeline.TETO_DESTAQUES["abertura"]
    )
    return cortes


def _ja_enviado_hoje(hoje):
    """True se o brief de hoje ja foi gerado e enviado ate o fim.

    O cron do GitHub roda em melhor esforco: um disparo pode atrasar ou, mais
    raro, sumir sem erro nenhum (comum logo apos criar o workflow). Por isso o
    yml carrega um segundo horario de seguranca no mesmo dia - esta funcao e
    o que impede o segundo disparo de mandar um email duplicado quando o
    primeiro ja deu certo. marcar_vistos() so roda depois do envio, entao a
    presenca da chave de hoje em seen.json prova que o ciclo terminou.

    BRIEF_FORCE pula a checagem, para reenviar de proposito quando precisar.
    O GitHub Actions manda "false" como texto literal quando o input do
    workflow_dispatch nao e marcado - por isso comparar contra um conjunto
    de valores verdadeiros, nunca so "a variavel existe".
    """
    if _ligado("BRIEF_FORCE") or _ligado("BRIEF_SO_DONO"):
        return False
    vistos = pipeline.carregar_vistos()
    return bool(vistos.get(hoje))


def executar():
    env = _ambiente()
    hoje = date.today().isoformat()
    BRIEFS.mkdir(parents=True, exist_ok=True)
    caminho = BRIEFS / f"{hoje}.json"

    if _ja_enviado_hoje(hoje):
        print(f"brief de {hoje} ja foi enviado - nada a fazer (segundo disparo do dia)")
        return 0

    pacote = coletar_dia()
    if not pacote.get("itens"):
        raise RuntimeError("a coleta nao trouxe nenhum item")
    print(f"coleta: {len(pacote['itens'])} itens, {len(pacote['fontes_com_erro'])} fontes com erro")

    # Newsletter e bonus: dia sem newsletter e dia normal, nao e falha.
    try:
        cartas = newsletters.buscar(env["usuario"], env["senha"], env["alias"])
        print(f"newsletters: {len(cartas)}")
    except Exception as erro:
        print(f"newsletters indisponiveis ({erro}) - seguindo sem elas")
        cartas = []

    brief = curator.curar(pacote, cartas, provedor=env["provedor"], modelo=env["modelo"])
    cortes = podar(brief, pacote)
    if cortes["links"] or cortes["itens"]:
        print(f"poda: {cortes['links']} links fora da coleta, {cortes['itens']} itens sem link")
    if not brief.get("secoes"):
        raise RuntimeError("nada sobrou depois da poda")

    caminho.write_text(json.dumps(brief, ensure_ascii=False, indent=2), encoding="utf-8")

    if pipeline.validar(caminho) != 0:
        raise RuntimeError("o brief nao passou no --validar depois da poda")

    # O contato do rodape e o mesmo endereco que envia: sem servidor, o pedido
    # de descadastro chega como email comum. Ver mailer._montar.
    corpo_html = render.renderizar(brief, contato=env["usuario"])
    caminho.with_suffix(".html").write_text(corpo_html, encoding="utf-8")
    texto = render.renderizar_texto(brief, contato=env["usuario"])
    caminho.with_suffix(".txt").write_text(texto, encoding="utf-8")

    # Amigos inscritos pelo formulario tambem sao bonus: planilha fora do ar
    # nao pode impedir o dono de receber o proprio brief.
    amigos = []
    if env["so_dono"]:
        amigos = env["amigos_teste"]
        alvo = f"o dono + {len(amigos)} endereco(s) de teste" if amigos else "so o dono"
        print(f"MODO TESTE (BRIEF_SO_DONO): enviando para {alvo}, sem tocar na planilha")
    elif env["sheet_id"]:
        try:
            amigos = subscribers.buscar(env["sheet_id"], excluir=[env["destino"]])
            print(f"inscritos: {len(amigos)}")
        except Exception as erro:
            print(f"lista de inscritos indisponivel ({erro}) - enviando so para o dono")

    enviados, falhas = mailer.enviar(
        env["usuario"],
        env["senha"],
        env["destino"],
        brief["assunto"],
        corpo_html,
        texto,
        ocultos=amigos,
    )
    print(f"enviado para {len(enviados)} destinatario(s): {brief['assunto']}")
    for endereco, erro in falhas:
        print(f"falhou para {endereco}: {erro}")

    if env["so_dono"]:
        # Nao registra: o envio de verdade do dia ainda tem que acontecer para
        # todo mundo. Marcar aqui faria a trava bloquear o envio real depois.
        print("MODO TESTE: seen.json intocado - o envio normal do dia segue valendo")
        return 0

    # Sem isto o brief de amanha repete as manchetes de hoje.
    print(f"registrados {pipeline.marcar_vistos(caminho)} links em seen.json")
    return 0


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    try:
        return executar()
    except SystemExit:
        raise
    except Exception as erro:
        print(f"FALHA: {erro}", file=sys.stderr)
        try:
            env = _ambiente()
            mailer.avisar_falha(
                env["usuario"], env["senha"], env["destino"], date.today().isoformat(), erro
            )
            print("aviso de falha enviado")
        except Exception as segundo:
            print(f"nao deu nem para avisar: {segundo}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
