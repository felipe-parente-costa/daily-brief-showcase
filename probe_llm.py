"""Mede os limites reais de cada modelo do provedor openai_compat.

Provedor nao publica limite por modelo de um jeito confiavel, e chutar sai
caro: em 02/09 eu li "Limit 8000" no erro de UM modelo e tratei como se fosse
da conta inteira, quando o texto do proprio erro diz "for model X". Este
script pergunta ao provedor em vez de supor - manda uma requisicao minima
para cada modelo e le os cabecalhos de rate limit que vem na resposta.

Uso (via workflow_dispatch, input diagnostico=true):
    python probe_llm.py

Le LLM_API_KEY e LLM_BASE_URL do ambiente. Nao envia email, nao toca em
nada: so imprime uma tabela.
"""

import json
import os
import sys
import urllib.error
import urllib.request

TIMEOUT = 30
# Modelos de audio e de moderacao nao servem para curadoria; filtrar aqui
# evita gastar uma requisicao em cada um so para descobrir isso.
IGNORAR = ("whisper", "orpheus", "prompt-guard", "safeguard", "tts", "embed")
USER_AGENT = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36")


def _cabecalho(chave):
    return {
        "Authorization": f"Bearer {chave}",
        "Content-Type": "application/json",
        "User-Agent": USER_AGENT,
    }


def listar_modelos(base, chave):
    pedido = urllib.request.Request(f"{base}/models", headers=_cabecalho(chave))
    with urllib.request.urlopen(pedido, timeout=TIMEOUT) as resposta:
        dados = json.loads(resposta.read().decode("utf-8"))
    return sorted(m["id"] for m in dados.get("data", []) if m.get("id"))


def _minusculo(cabecalhos):
    """Cabecalho HTTP nao diferencia caixa, mas dict sim: normaliza para a
    leitura por chave nao depender de como cada provedor escreve."""
    return {k.lower(): v for k, v in cabecalhos.items()}


def limites(base, chave, modelo):
    """Requisicao minima so para ler os cabecalhos de rate limit.

    max_tokens=1 mantem o custo proximo de zero. O que interessa esta nos
    cabecalhos, que vem tanto na resposta boa quanto no erro - por isso o
    except tambem os le, em vez de desistir.
    """
    corpo = json.dumps(
        {
            "model": modelo,
            "messages": [{"role": "user", "content": "oi"}],
            "max_tokens": 1,
        }
    ).encode("utf-8")
    pedido = urllib.request.Request(
        f"{base}/chat/completions", data=corpo, headers=_cabecalho(chave)
    )
    try:
        with urllib.request.urlopen(pedido, timeout=TIMEOUT) as resposta:
            return _minusculo(resposta.headers), None
    except urllib.error.HTTPError as erro:
        detalhe = erro.read().decode("utf-8", "replace")[:200]
        return _minusculo(erro.headers), f"HTTP {erro.code}: {detalhe}"
    except Exception as erro:
        return {}, str(erro)


def main():
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    chave = os.environ.get("LLM_API_KEY", "").strip()
    base = os.environ.get("LLM_BASE_URL", "").strip().rstrip("/")
    if not chave or not base:
        raise SystemExit("LLM_API_KEY e LLM_BASE_URL sao obrigatorios")

    print(f"provedor: {base}")
    modelos = listar_modelos(base, chave)
    uteis = [m for m in modelos if not any(x in m.lower() for x in IGNORAR)]
    print(f"modelos no total: {len(modelos)} | candidatos a curadoria: {len(uteis)}")
    print()
    print(f"{'modelo':<38} {'TPM':>9} {'RPM':>7} {'TPD':>11}  obs")
    print("-" * 90)

    achados = []
    for modelo in uteis:
        cab, erro = limites(base, chave, modelo)
        tpm = cab.get("x-ratelimit-limit-tokens", "?")
        rpm = cab.get("x-ratelimit-limit-requests", "?")
        tpd = cab.get("x-ratelimit-limit-tokens-day", "-")
        obs = "" if not erro else erro.split("\n")[0][:40]
        print(f"{modelo:<38} {tpm:>9} {rpm:>7} {tpd:>11}  {obs}")
        try:
            achados.append((int(tpm), modelo))
        except (TypeError, ValueError):
            pass

    if achados:
        achados.sort(reverse=True)
        print()
        print("maior TPM primeiro:")
        for tpm, modelo in achados[:5]:
            print(f"  {tpm:>9} tokens/min  {modelo}")
        print()
        print("sugestao para LLM_MODELOS:")
        print("  " + ",".join(m for _, m in achados[:3]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
