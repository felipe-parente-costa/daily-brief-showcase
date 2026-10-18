/* Preenche a pagina de status a partir do status.json gerado pelo status.py.
 *
 * A pagina e estatica: nao ha servidor, nao ha API. Tudo o que aparece aqui
 * saiu de um arquivo que o workflow do GitHub Actions escreveu depois do
 * envio do dia. Nenhum endereco de email passa por este arquivo - o
 * status.json so traz contagens, e o status.py aborta se achar um endereco.
 */
(function () {
  "use strict";

  var FUSO = "America/Sao_Paulo";
  var DISPARO_H = 7, DISPARO_M = 20;

  var MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho",
    "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  var MESES_CURTO = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN",
    "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

  var ROTULO_CURADOR = {
    gemini: "Gemini", openai_compat: "Reserva (OpenAI-compat)",
    anthropic: "Claude", manual: "à mão (resgate)"
  };

  // ------------------------------------------------------------- utilidades
  function $(id) { return document.getElementById(id); }

  function escapar(texto) {
    return String(texto == null ? "" : texto)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** `**assim**` vira negrito, como no email. Escapa antes de marcar. */
  function enfase(texto) {
    return escapar(texto).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  }

  /** Data de hoje no fuso do projeto, nao no do visitante. */
  function hojeNoProjeto() {
    var partes = new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
    return partes;  // en-CA ja devolve AAAA-MM-DD
  }

  function minutosNoProjeto() {
    var f = new Intl.DateTimeFormat("en-GB", {
      timeZone: FUSO, hour: "2-digit", minute: "2-digit", hour12: false
    }).format(new Date()).split(":");
    return parseInt(f[0], 10) * 60 + parseInt(f[1], 10);
  }

  function partes(iso) {
    var p = String(iso || "").split("-");
    return { ano: +p[0], mes: +p[1], dia: +p[2] };
  }

  function extenso(iso) {
    var d = partes(iso);
    if (!d.ano) return "—";
    return d.dia + " de " + MESES[d.mes - 1] + " de " + d.ano;
  }

  function semAssuntoPadrao(assunto) {
    return String(assunto || "").replace(
      /^Daily Brief\s*[-–—]\s*\d{1,2}\/\d{1,2}\s*[-–—]\s*/, ""
    );
  }

  function plural(n, um, muitos) { return n === 1 ? um : muitos; }

  // ------------------------------------------------------------- estado
  function decidirEstado(s, hoje) {
    var atualizado = s.hoje && s.hoje.data === hoje;
    if (atualizado && s.hoje.entregue) return "entregue";
    if (atualizado && s.hoje.aviso_de_falha) return "falhou";
    var agora = minutosNoProjeto();
    if (agora < DISPARO_H * 60 + DISPARO_M || agora >= 22 * 60) return "dormindo";
    return "trabalhando";
  }

  function textoDoEstado(estado, s, hoje) {
    var u = s.ultima_edicao || {};
    var atualizado = s.hoje && s.hoje.data === hoje;
    if (estado === "entregue") {
      return {
        titulo: "Entregue hoje",
        detalhe: "A edição de " + extenso(u.data) + " saiu para "
          + (s.hoje.destinatarios ? s.hoje.destinatarios + " " +
             plural(s.hoje.destinatarios, "leitor", "leitores") : "a lista")
          + "."
      };
    }
    if (estado === "falhou") {
      return {
        titulo: "Hoje falhou",
        detalhe: "Nenhum provedor de curadoria respondeu. A rota de resgate "
          + "assume e a edição sai com atraso."
      };
    }
    if (estado === "trabalhando") {
      return {
        titulo: "Em andamento",
        detalhe: "O disparo das 07:20 já passou e a edição de hoje ainda não "
          + "foi registrada. A última publicada é de " + extenso(u.data) + "."
      };
    }
    return {
      titulo: "Fora do horário",
      detalhe: atualizado
        ? "Nada a fazer até o próximo disparo."
        : "Última edição publicada: " + extenso(u.data) + "."
    };
  }

  function proximoDisparo() {
    var agora = minutosNoProjeto();
    var alvo = DISPARO_H * 60 + DISPARO_M;
    var falta = alvo - agora;
    if (falta <= 0) falta += 24 * 60;
    var h = Math.floor(falta / 60), m = falta % 60;
    if (h === 0) return "em " + m + " min";
    return "em " + h + " h " + (m < 10 ? "0" + m : m) + " min";
  }

  // ------------------------------------------------------------- blocos
  function preencherPainel(s, estado, hoje) {
    var u = s.ultima_edicao || {};
    var texto = textoDoEstado(estado, s, hoje);
    var cor = (window.Briefy && Briefy.ESTADOS[estado] || {}).cor || "--ok";

    $("estado-titulo").textContent = texto.titulo;
    $("estado-titulo").style.setProperty("--state-color", "var(" + cor + ")");
    $("estado-detalhe").textContent = texto.detalhe;

    $("v-hora").textContent = s.hoje && s.hoje.hora ? s.hoje.hora : "—";
    $("v-destinatarios").textContent = s.hoje && s.hoje.destinatarios
      ? s.hoje.destinatarios
      : (s.projeto.leitores ? s.projeto.leitores + " na lista" : "—");
    var curador = (s.hoje && s.hoje.curado_por) || null;
    $("v-curador").textContent = curador ? (ROTULO_CURADOR[curador] || curador) : "—";
    $("v-itens").textContent = u.itens != null ? u.itens : "—";
    $("v-newsletters").textContent = u.newsletters != null ? u.newsletters : "—";
    $("v-proximo").textContent = proximoDisparo();
  }

  function preencherCabecalho(s) {
    var u = s.ultima_edicao || {};
    var d = partes(u.data);
    $("selo-data").textContent = extenso(u.data);
    if (d.ano) {
      $("carimbo-dia").textContent = d.dia + " " + MESES_CURTO[d.mes - 1];
      $("carimbo-hora").textContent = ((s.hoje && s.hoje.hora) || "") + " · " + d.ano;
    }
    $("rodape-gerado").textContent = "Atualizado em " + extenso((s.gerado_em || "").slice(0, 10));
  }

  function preencherTiles(s) {
    var p = s.projeto || {};
    var tiles = [
      [p.edicoes, "edições publicadas"],
      [p.sequencia, "dias seguidos"],
      [p.itens_curados, "itens curados"],
      [(p.feeds || 0) + (p.indicadores || 0), "fontes monitoradas"],
      [p.leitores != null ? p.leitores : "—", "leitores"]
    ];
    $("tiles").innerHTML = tiles.map(function (t) {
      return '<div class="tile"><span class="n">' + escapar(t[0]) +
        '</span><span class="r">' + t[1] + "</span></div>";
    }).join("");
  }

  function preencherUltima(s) {
    var u = s.ultima_edicao || {};
    $("ultima-sub").textContent = u.numero ? "número " + u.numero : "";
    $("ultima-meta").textContent = extenso(u.data) +
      (u.itens ? " · " + u.itens + " itens" : "");
    $("ultima-assunto").textContent = semAssuntoPadrao(u.assunto) || "—";
    $("ultima-abertura").innerHTML = enfase(u.abertura);
    if (u.data) $("ultima-link").href = "edicoes/" + u.data + ".html";
  }

  function preencherCalendario(s) {
    var grade = $("grade");
    var hist = {};
    var maximo = 1;
    (s.historico || []).forEach(function (h) {
      hist[h.data] = h;
      if (h.itens > maximo) maximo = h.itens;
    });

    var inicio = s.projeto.primeira_edicao;
    if (!inicio) return;

    var d0 = partes(inicio), hoje = partes(hojeNoProjeto());
    var cursor = new Date(Date.UTC(d0.ano, d0.mes - 1, d0.dia));
    var fim = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia));

    var celulas = [];
    // Completa a primeira coluna: a grade tem 7 linhas, domingo no topo.
    var vazios = cursor.getUTCDay();
    for (var v = 0; v < vazios; v++) {
      celulas.push('<span class="dia vazio"></span>');
    }
    var niveis = [0.26, 0.48, 0.72, 1];
    while (cursor <= fim) {
      var iso = cursor.toISOString().slice(0, 10);
      var h = hist[iso];
      if (h) {
        var faixa = Math.min(3, Math.floor((h.itens / maximo) * 3.999));
        celulas.push('<span class="dia" style="background:var(--navy);opacity:' +
          niveis[faixa] + '" title="' + escapar(iso.split("-").reverse().join("/")) +
          " — " + h.itens + " itens" + '"></span>');
      } else {
        celulas.push('<span class="dia" title="' +
          escapar(iso.split("-").reverse().join("/")) +
          " — sem edição\"></span>");
      }
      cursor = new Date(cursor.getTime() + 86400000);
    }
    grade.innerHTML = celulas.join("");

    var publicadas = (s.historico || []).length;
    var total = celulas.length - vazios;
    $("calendario-sub").textContent = publicadas + " de " +
      Math.max(publicadas, total) + " dias desde " + extenso(inicio);

    [1, 2, 3, 4].forEach(function (n, i) {
      var el = $("leg-" + n);
      if (el) { el.style.background = "var(--navy)"; el.style.opacity = niveis[i]; }
    });
  }

  function barras(alvo, itens, chaveValor, sufixo) {
    var el = $(alvo);
    if (!itens || !itens.length) {
      el.innerHTML = '<li class="carregando">sem dados</li>';
      return;
    }
    var maximo = itens.reduce(function (m, i) {
      return Math.max(m, i[chaveValor]);
    }, 1);
    el.innerHTML = itens.map(function (i) {
      var pct = Math.max(2, (i[chaveValor] / maximo) * 100);
      return '<li><span class="nome">' + escapar(i.nome) + "</span>" +
        '<span class="v">' + i[chaveValor] + (sufixo || "") + "</span>" +
        '<span class="trilho"><span class="preenche" style="width:' +
        pct.toFixed(1) + '%"></span></span></li>';
    }).join("");
  }

  function preencherSaude(s) {
    var lista = s.saude_fontes || [];
    var dias = lista.length ? lista[0].dias : 0;
    var caidas = lista.filter(function (f) { return f.falhas > 0; });
    var inteiras = lista.length - caidas.length;

    $("saude-sub").textContent = dias
      ? "falhas nas últimas " + dias + " edições"
      : "";

    var html = caidas.map(function (f) {
      var pct = dias ? Math.round(((dias - f.falhas) / dias) * 100) : 100;
      var classe = pct < 50 ? "ruim" : (pct < 95 ? "meia" : "boa");
      return "<li><span>" + escapar(f.nome) + "</span>" +
        '<span class="tipo">' + (f.tipo === "feed" ? "feed" : "mercado") + "</span>" +
        '<span class="pct ' + classe + '">' + pct + "%</span></li>";
    });

    if (inteiras > 0) {
      html.push("<li><span>" + inteiras + " " +
        plural(inteiras, "fonte respondeu", "fontes responderam") +
        " todos os dias</span><span class=\"tipo\"></span>" +
        '<span class="pct boa">100%</span></li>');
    }
    $("saude").innerHTML = html.join("");
  }

  function preencherMercado(s) {
    var corpo = $("mercado");
    var itens = s.mercado || [];
    if (!itens.length) {
      corpo.innerHTML = '<tr><td colspan="4" class="carregando">' +
        "sem indicadores nesta edição</td></tr>";
      return;
    }
    corpo.innerHTML = itens.map(function (m) {
      var v = m.variacao_pct;
      var classe = v == null ? "" : (v >= 0 ? "sobe" : "cai");
      var texto = v == null ? "—" :
        (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
      return "<tr><td>" + escapar(m.nome) + "</td>" +
        '<td class="grupo">' + escapar(m.grupo || "") + "</td>" +
        '<td class="num">' + escapar(m.valor) + "</td>" +
        '<td class="num ' + classe + '">' + texto + "</td></tr>";
    }).join("");
  }

  function preencherArquivo(s) {
    var edicoes = (s.edicoes || []).slice().reverse();
    $("arquivo-sub").textContent = edicoes.length + " " +
      plural(edicoes.length, "edição", "edições");

    var porMes = [];
    var indice = {};
    edicoes.forEach(function (e) {
      var chave = e.data.slice(0, 7);
      if (!indice[chave]) {
        indice[chave] = { chave: chave, itens: [] };
        porMes.push(indice[chave]);
      }
      indice[chave].itens.push(e);
    });

    $("arquivo").innerHTML = porMes.map(function (m) {
      var d = partes(m.chave + "-01");
      var linhas = m.itens.map(function (e) {
        var dia = partes(e.data).dia;
        return '<li><a href="' + escapar(e.arquivo) + '">' +
          '<span class="d">' + (dia < 10 ? "0" + dia : dia) + "</span>" +
          '<span class="t">' + escapar(semAssuntoPadrao(e.assunto)) + "</span>" +
          '<span class="q">' + e.itens + " itens</span></a></li>";
      }).join("");
      return '<div class="mes"><h3>' + MESES[d.mes - 1] + " de " + d.ano +
        '</h3><ul class="lista">' + linhas + "</ul></div>";
    }).join("");
  }

  function frasesDoBriefy(s) {
    var p = s.projeto || {};
    var topFonte = (s.fontes || [])[0];
    var topNews = (s.newsletters || [])[0];
    var mortas = (s.saude_fontes || []).filter(function (f) {
      return f.dias && f.falhas >= f.dias;
    });

    var sempre = [];
    if (p.edicoes) sempre.push(p.edicoes + " edições publicadas até agora.");
    if (p.itens_curados) sempre.push(p.itens_curados +
      " itens curados desde " + extenso(p.primeira_edicao) + ".");
    if (topFonte) sempre.push(topFonte.nome +
      " é minha fonte mais citada: " + topFonte.citacoes + " vezes.");
    if (topNews) sempre.push(topNews.nome +
      " apareceu em " + topNews.edicoes + " edições.");
    if (mortas.length) sempre.push(mortas[0].nome +
      " falha há " + mortas[0].dias + " dias seguidos e ninguém tinha notado.");
    if (p.sequencia > 1) sempre.push(p.sequencia + " dias seguidos sem falhar.");

    return {
      entregue: sempre.concat(["Edição de hoje entregue. Pode conferir a caixa."]),
      trabalhando: sempre.concat([
        "Coletando os feeds agora. Volta em dois minutos.",
        "Lendo as newsletters antes de curar."
      ]),
      falhou: sempre.concat([
        "Troquei de modelo e ninguém respondeu. O resgate assume.",
        "Hoje não deu. Amanhã dá."
      ]),
      dormindo: sempre.concat([
        "Acordo às 07:20, nem um minuto antes.",
        "Um disparo por dia; o resto é soneca."
      ])
    };
  }

  // ------------------------------------------------------------- partida
  var briefy = window.Briefy ? Briefy.criar({
    palco: $("palco"),
    bilhete: $("bilhete"),
    bilheteTexto: $("bilhete-texto"),
    led: $("badge-led"),
    badgeTexto: $("badge-texto")
  }) : null;

  function falhar(mensagem) {
    var el = $("erro");
    el.textContent = mensagem;
    el.hidden = false;
  }

  fetch("status.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (s) {
      var hoje = hojeNoProjeto();
      var estado = decidirEstado(s, hoje);

      preencherCabecalho(s);
      preencherPainel(s, estado, hoje);
      preencherTiles(s);
      preencherUltima(s);
      preencherCalendario(s);
      barras("fontes", s.fontes, "citacoes");
      barras("newsletters", s.newsletters, "edicoes");
      preencherSaude(s);
      preencherMercado(s);
      preencherArquivo(s);

      if (briefy) {
        briefy.definirFrases(frasesDoBriefy(s));
        briefy.definirEstado(estado);
      }

      // A contagem regressiva e a unica coisa que muda sem recarregar.
      setInterval(function () {
        $("v-proximo").textContent = proximoDisparo();
      }, 30000);
    })
    .catch(function (erro) {
      falhar("Não consegui ler o status.json (" + erro.message +
        "). A página mostra a estrutura, mas sem os números do dia.");
      if (briefy) briefy.definirEstado("dormindo");
    });
})();
