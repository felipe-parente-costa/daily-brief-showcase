"""Copia o codigo desta instancia para o showcase publico, higienizado.

Uso: python sincronizar_showcase.py <repo_privado> <clone_do_showcase>

Nenhum dado pessoal esta escrito aqui: o que deve sumir vem do ambiente.
    GMAIL_USER, BRIEF_TO          enderecos a trocar por seuemail@gmail.com
    BRIEF_SUBSCRIBERS_SHEET_ID    id da planilha; no workflow vira secret
Caminho local do Windows (/caminho/do/seu/projeto) e reconhecido por
padrao e vira /caminho/do/seu/projeto.

No fim varre o showcase INTEIRO, nao so o que foi copiado, e sai com codigo 1
se achar email, id da planilha, caminho local ou formato de chave de API.
Nao toca em docs/: la ficam a landing de inscricao e a pagina de status, que
o workflow diario publica.

Roda sozinho a cada push (.github/workflows/showcase.yml).
"""
import os
import re
import shutil
import sys
from pathlib import Path

ARQUIVOS = [
    ".github/workflows/daily-brief.yml", ".gitignore", "BRIEF.md",
    "collectors/feeds.py", "collectors/markets.py",
    "config/sources.json", "config/profile.md",
    "curator.py", "mailer.py", "newsletters.py", "pipeline.py", "render.py",
    "requirements.txt", "run_brief.py", "subscribers.py", "status.py", "probe_llm.py",
    "sincronizar_showcase.py",
    "site/index.html", "site/estilo.css", "site/app.js", "site/briefy.js", "site/.nojekyll",
    "site/modelos/briefy.glb", "site/modelos/briefy-triste.glb",
]

CAMINHO_LOCAL = re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+[^\\/\s\"'`]+(?:[\\/]+[^\\/\s\"'`]+)*?[\\/]+A\.Reports")


def segredos():
    emails = []
    for var in ("GMAIL_USER", "BRIEF_TO"):
        for e in (os.environ.get(var) or "").split(","):
            e = e.strip().lower()
            if e and e not in emails:
                emails.append(e)
    planilha = (os.environ.get("BRIEF_SUBSCRIBERS_SHEET_ID") or "").strip()
    if not emails or not planilha:
        sys.exit("GMAIL_USER e BRIEF_SUBSCRIBERS_SHEET_ID sao obrigatorios: "
                 "sem saber o que esconder, nada e copiado.")
    return emails, planilha


def higienizar(texto, rel, emails, planilha):
    if rel == ".github/workflows/daily-brief.yml":
        texto = texto.replace(f'"{planilha}"', "${{ secrets.BRIEF_SUBSCRIBERS_SHEET_ID }}")
    texto = texto.replace(planilha, "SEU_SHEET_ID")
    for e in emails:
        local, _, dominio = e.partition("@")
        texto = re.sub(re.escape(f"{local}+brief@{dominio}"), "seuemail+brief@gmail.com", texto, flags=re.I)
        texto = re.sub(re.escape(e), "seuemail@gmail.com", texto, flags=re.I)
    return CAMINHO_LOCAL.sub("/caminho/do/seu/projeto", texto)


def copiar(privado, showcase, emails, planilha):
    for rel in ARQUIVOS:
        origem, destino = privado / rel, showcase / rel
        destino.parent.mkdir(parents=True, exist_ok=True)
        if rel.endswith(".glb"):
            shutil.copy2(origem, destino)
            continue
        texto = higienizar(origem.read_text(encoding="utf-8"), rel, emails, planilha)
        destino.write_text(texto, encoding="utf-8", newline="\n")


def varrer(showcase, emails, planilha):
    proibidos = [("id da planilha", re.compile(re.escape(planilha)))]
    proibidos += [("email pessoal", re.compile(re.escape(e.partition("@")[0]), re.I)) for e in emails]
    proibidos += [
        ("caminho local", re.compile(r"[A-Za-z]:[\\/]+Users[\\/]+", re.I)),
        ("chave Google", re.compile(r"AIza[0-9A-Za-z_\-]{30,}")),
        ("chave Anthropic", re.compile(r"sk-ant-[0-9A-Za-z_\-]{20,}")),
        ("chave Groq", re.compile(r"gsk_[0-9A-Za-z]{20,}")),
        ("token GitHub", re.compile(r"(ghp_[0-9A-Za-z]{30,}|github_pat_[0-9A-Za-z_]{40,})")),
        ("senha de app", re.compile(r"\b[a-z]{4} [a-z]{4} [a-z]{4} [a-z]{4}\b")),
    ]
    achados = []
    for arq in sorted(showcase.rglob("*")):
        rel = arq.relative_to(showcase).as_posix()
        if not arq.is_file() or rel.startswith(".git/"):
            continue
        try:
            texto = arq.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue
        # quatro palavras de quatro letras e o formato da senha de app do
        # Google, mas tambem aparece em manchete em ingles; em texto de
        # noticia essa regra so gera falso positivo
        noticia = rel.startswith(("data/", "docs/status/edicoes/", "docs/status/status.json"))
        for rotulo, padrao in proibidos:
            if noticia and rotulo == "senha de app":
                continue
            if padrao.search(texto):
                achados.append(f"{rel}: {rotulo}")
    return achados


def main():
    privado, showcase = Path(sys.argv[1]), Path(sys.argv[2])
    emails, planilha = segredos()
    copiar(privado, showcase, emails, planilha)
    achados = varrer(showcase, emails, planilha)
    if achados:
        # so o rotulo e o arquivo: imprimir o trecho achado vazaria no log
        print("VAZAMENTO - nada deve ser publicado:")
        for a in achados:
            print("  ", a)
        sys.exit(1)
    print(f"{len(ARQUIVOS)} arquivos sincronizados; varredura do showcase inteiro limpa")


if __name__ == "__main__":
    main()
