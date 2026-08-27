"""Estagio 3 do Daily Brief: transforma o brief editado em HTML de email.

Uso:
    python render.py data/briefs/AAAA-MM-DD.json

Grava o HTML ao lado do JSON e imprime o caminho. O LLM nunca escreve HTML:
ele preenche o JSON e o layout sai identico todo dia.

Restricoes de email (por isso o codigo parece de 2005):
- layout em <table>, nao flex/grid
- CSS inline em cada tag; Gmail descarta <style> em varias situacoes
- fontes web-safe e cores explicitas, porque o dark mode de cada cliente e diferente
"""

import html
import json
import re
import sys
from datetime import date
from pathlib import Path

BASE = Path(__file__).parent

TINTA = "#16202c"
SUAVE = "#5f6b7a"
BORDA = "#e2e6ea"
FUNDO = "#f4f6f8"
DESTAQUE = "#12355b"
ALTA = "#0a7d33"
BAIXA = "#b3261e"

MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]
DIAS = ["segunda-feira", "terca-feira", "quarta-feira", "quinta-feira",
        "sexta-feira", "sabado", "domingo"]
GRUPOS = [("brasil", "Brasil"), ("global", "Global"),
          ("commodity", "Commodities"), ("cripto", "Cripto")]

FONTE = "font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"


NEGRITO_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)


def e(texto):
    return html.escape(str(texto or ""))


def enfatizar(texto):
    """Escapa o texto e so entao converte **destaque** em negrito.

    A ordem importa: o material vem de fonte externa e nunca pode injetar HTML
    no email. Depois do escape, o unico marcador que sobrevive e o `**`, que o
    editor coloca de proposito. Ver o teto de destaques em config/profile.md.
    """
    return NEGRITO_RE.sub(r'<strong style="font-weight:700;">\1</strong>', e(texto))


def sem_marcadores(texto):
    """Tira os `**` para a versao em texto puro."""
    return NEGRITO_RE.sub(r"\1", str(texto or ""))


def data_extensa(iso):
    d = date.fromisoformat(iso)
    return f"{DIAS[d.weekday()]}, {d.day} de {MESES[d.month - 1]} de {d.year}"


def variacao_html(pct):
    """Variacao com seta e cor. Sem variacao (Selic, IPCA) vira traco discreto."""
    if pct is None:
        return f'<span style="color:{SUAVE};">&mdash;</span>'
    valor = f"{abs(pct):.2f}".replace(".", ",")
    if round(pct, 2) == 0:  # estavel: sem seta, senao -0.0 vira queda
        return f'<span style="color:{SUAVE};white-space:nowrap;">0,00%</span>'
    cor = ALTA if pct > 0 else BAIXA
    seta = "&#9650;" if pct > 0 else "&#9660;"
    return f'<span style="color:{cor};white-space:nowrap;">{seta} {valor}%</span>'


def tabela_mercado(indicadores):
    if not indicadores:
        return ""
    linhas = []
    for chave, rotulo in GRUPOS:
        doGrupo = [i for i in indicadores if i.get("grupo") == chave]
        if not doGrupo:
            continue
        linhas.append(
            f'<tr><td colspan="3" style="{FONTE}font-size:11px;font-weight:700;'
            f'letter-spacing:.08em;text-transform:uppercase;color:{SUAVE};'
            f'padding:14px 12px 4px;">{e(rotulo)}</td></tr>'
        )
        for i in doGrupo:
            referencia = f' <span style="color:{SUAVE};font-size:11px;">({e(i["referencia"])})</span>' if i.get("referencia") else ""
            linhas.append(
                f'<tr>'
                f'<td style="{FONTE}font-size:14px;color:{TINTA};padding:6px 12px;'
                f'border-top:1px solid {BORDA};">{e(i["nome"])}{referencia}</td>'
                f'<td style="{FONTE}font-size:14px;color:{TINTA};padding:6px 12px;'
                f'border-top:1px solid {BORDA};text-align:right;font-weight:600;'
                f'white-space:nowrap;">{e(i["valor"])}</td>'
                f'<td style="{FONTE}font-size:13px;padding:6px 12px;'
                f'border-top:1px solid {BORDA};text-align:right;">'
                f'{variacao_html(i.get("variacao_pct"))}</td>'
                f'</tr>'
            )
    return (
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="background:#ffffff;border:1px solid {BORDA};'
        f'border-radius:6px;margin:0 0 28px;">{"".join(linhas)}</table>'
    )


def bloco_item(item):
    links = []
    usados = {}
    for indice, url in enumerate(item.get("links", [])[:4]):
        rotulo = item.get("fontes", [])[indice] if indice < len(item.get("fontes", [])) else "fonte"
        # Duas materias da mesma fonte no mesmo item: numera, senao vira "G1 - G1"
        usados[rotulo] = usados.get(rotulo, 0) + 1
        if usados[rotulo] > 1:
            rotulo = f"{rotulo} ({usados[rotulo]})"
        links.append(
            f'<a href="{e(url)}" style="color:{DESTAQUE};text-decoration:none;'
            f'border-bottom:1px solid {BORDA};">{e(rotulo)}</a>'
        )
    rodape = (
        f'<div style="{FONTE}font-size:12px;color:{SUAVE};padding-top:6px;">'
        f'{" &middot; ".join(links)}</div>'
    ) if links else ""
    return (
        f'<div style="padding:0 0 18px;">'
        f'<div style="{FONTE}font-size:15px;font-weight:700;color:{TINTA};'
        f'line-height:1.35;padding-bottom:5px;">{e(item["titulo"])}</div>'
        f'<div style="{FONTE}font-size:14px;color:{TINTA};line-height:1.6;">'
        f'{enfatizar(item["texto"])}</div>{rodape}</div>'
    )


def bloco_secao(secao):
    if not secao.get("itens"):
        return ""
    itens = "".join(bloco_item(i) for i in secao["itens"])
    return (
        f'<div style="margin:0 0 10px;">'
        f'<div style="{FONTE}font-size:13px;font-weight:700;letter-spacing:.1em;'
        f'text-transform:uppercase;color:{DESTAQUE};border-left:3px solid {DESTAQUE};'
        f'padding:0 0 0 10px;margin:0 0 14px;">{e(secao["titulo"])}</div>'
        f'{itens}</div>'
    )


def bloco_newsletters(nomes):
    if not nomes:
        return ""
    linhas = "".join(
        f'<li style="{FONTE}font-size:13px;color:{SUAVE};line-height:1.7;">{e(n)}</li>'
        for n in nomes
    )
    return (
        f'<div style="border-top:1px solid {BORDA};margin-top:6px;padding-top:14px;">'
        f'<div style="{FONTE}font-size:11px;font-weight:700;letter-spacing:.08em;'
        f'text-transform:uppercase;color:{SUAVE};padding-bottom:6px;">'
        f'Newsletters lidas hoje</div>'
        f'<ul style="margin:0;padding-left:18px;">{linhas}</ul></div>'
    )


def rodape(brief):
    partes = [f'Gerado em {e(brief.get("gerado_em", ""))}.']
    erros = brief.get("fontes_com_erro") or []
    if erros:
        nomes = ", ".join(e(x["fonte"]) for x in erros)
        partes.append(f'Fontes indisponíveis nesta edição: {nomes}.')
    return (
        f'<div style="{FONTE}font-size:11px;color:{SUAVE};line-height:1.6;'
        f'border-top:1px solid {BORDA};margin-top:22px;padding-top:12px;">'
        f'{" ".join(partes)}<br>Resumo automatizado de fontes públicas e newsletters '
        f'assinadas. Não é recomendação de investimento.</div>'
    )


def renderizar(brief):
    secoes = "".join(bloco_secao(s) for s in brief.get("secoes", []))
    corpo = (
        f'<div style="{FONTE}font-size:16px;line-height:1.55;color:{TINTA};'
        f'padding:0 0 24px;">{enfatizar(brief.get("abertura", ""))}</div>'
        f'{tabela_mercado(brief.get("mercado", []))}'
        f'{secoes}'
        f'{bloco_newsletters(brief.get("newsletters_lidas"))}'
        f'{rodape(brief)}'
    )
    return (
        f'<div style="background:{FUNDO};padding:20px 0;margin:0;">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="100%" style="background:{FUNDO};"><tr><td align="center">'
        f'<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        f'width="640" style="max-width:640px;width:100%;background:#ffffff;'
        f'border:1px solid {BORDA};border-radius:8px;">'
        f'<tr><td style="padding:26px 28px 0;">'
        f'<div style="{FONTE}font-size:20px;font-weight:800;color:{DESTAQUE};'
        f'letter-spacing:-.01em;">Daily Brief</div>'
        f'<div style="{FONTE}font-size:12px;color:{SUAVE};padding:3px 0 20px;">'
        f'{e(data_extensa(brief["data"]))}</div></td></tr>'
        f'<tr><td style="padding:0 28px 26px;">{corpo}</td></tr>'
        f'</table></td></tr></table></div>'
    )


def renderizar_texto(brief):
    """Alternativa em texto puro, para cliente de email sem HTML."""
    linhas = ["DAILY BRIEF", data_extensa(brief["data"]), "", sem_marcadores(brief.get("abertura", "")), ""]
    for i in brief.get("mercado", []):
        variacao = "-" if i.get("variacao_pct") is None else f'{i["variacao_pct"]:+.2f}%'
        linhas.append(f'{i["nome"]}: {i["valor"]} ({variacao})')
    for secao in brief.get("secoes", []):
        if not secao.get("itens"):
            continue
        linhas += ["", secao["titulo"].upper(), ""]
        for item in secao["itens"]:
            linhas.append(f'* {sem_marcadores(item["titulo"])}')
            linhas.append(f'  {sem_marcadores(item["texto"])}')
            for link in item.get("links", []):
                linhas.append(f"  {link}")
            linhas.append("")
    if brief.get("newsletters_lidas"):
        linhas += ["NEWSLETTERS LIDAS HOJE"] + [f'- {n}' for n in brief["newsletters_lidas"]]
    linhas += ["", "Resumo automatizado de fontes públicas e newsletters assinadas.",
               "Não é recomendação de investimento."]
    return "\n".join(linhas)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    caminho = Path(sys.argv[1])
    brief = json.loads(caminho.read_text(encoding="utf-8"))
    destino = caminho.with_suffix(".html")
    destino.write_text(renderizar(brief), encoding="utf-8")
    texto = caminho.with_suffix(".txt")
    texto.write_text(renderizar_texto(brief), encoding="utf-8")
    print(destino)
    print(texto)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
