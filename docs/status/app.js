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

  var ROTULO_CURADOR = {
    gemini: "Gemini", openai_compat: "reserva", anthropic: "Claude",
    manual: "à mão"
  };

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

  function guardar(chave, valor) {
    try { localStorage.setItem(chave, valor); } catch (e) {}
  }
  function lembrar(chave) {
    try { return localStorage.getItem(chave); } catch (e) { return null; }
  }

  // ------------------------------------------------------------- tema
  var btnTema = $("btn-tema");
  var queroClaro = window.matchMedia("(prefers-color-scheme: light)");

  function temaEfetivo() {
    var explicito = document.documentElement.getAttribute("data-theme");
    if (explicito === "dark" || explicito === "light") return explicito;
    return queroClaro.matches ? "light" : "dark";
  }
  function desenharIcone() {
    // Mostra o icone do tema para o qual o clique vai levar.
    if (btnTema) btnTema.dataset.mostrar = temaEfetivo() === "dark" ? "sol" : "lua";
  }
  if (btnTema) {
    btnTema.addEventListener("click", function () {
      var novo = temaEfetivo() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", novo);
      guardar("tema", novo);
      desenharIcone();
    });
  }
  if (queroClaro.addEventListener) {
    queroClaro.addEventListener("change", desenharIcone);
  }
  desenharIcone();

  // ------------------------------------------------------------- dobras
  // Cada bloco lembra se ficou aberto ou fechado, so neste navegador.
  Array.prototype.forEach.call(
    document.querySelectorAll("details[data-chave]"),
    function (d) {
      var chave = "secao:" + d.dataset.chave;
      var salvo = lembrar(chave);
      if (salvo === "1") d.open = true;
      else if (salvo === "0") d.open = false;
      d.addEventListener("toggle", function () {
        guardar(chave, d.open ? "1" : "0");
      });
    }
  );

  // ------------------------------------------------------------- datas
  function hojeNoProjeto() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
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

  function curto(iso) {
    var d = partes(iso);
    if (!d.ano) return "—";
    return (d.dia < 10 ? "0" + d.dia : d.dia) + "/" + (d.mes < 10 ? "0" + d.mes : d.mes);
  }

  function semAssuntoPadrao(assunto) {
    return String(assunto || "").replace(
      /^Daily Brief\s*[-–—]\s*\d{1,2}\/\d{1,2}\s*[-–—]\s*/, ""
    );
  }

  function plural(n, um, muitos) { return n === 1 ? um : muitos; }

  /** 54 vira 054, com os zeros apagados - leitura de terminal. */
  function comZeros(valor, largura) {
    if (valor == null) return "—";
    var texto = String(valor);
    var faltam = Math.max(0, (largura || 3) - texto.length);
    return faltam
      ? '<span class="zeros">' + new Array(faltam + 1).join("0") + "</span>" + texto
      : texto;
  }

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
        detalhe: "A edição de " + extenso(u.data) + " saiu para " +
          (s.hoje.destinatarios
            ? s.hoje.destinatarios + " " + plural(s.hoje.destinatarios, "leitor", "leitores")
            : "a lista") + "."
      };
    }
    if (estado === "falhou") {
      return {
        titulo: "Hoje falhou",
        detalhe: "Nenhum provedor de curadoria respondeu. A rota de resgate assume " +
          "e a edição sai com atraso."
      };
    }
    if (estado === "trabalhando") {
      return {
        titulo: "Em andamento",
        detalhe: "O disparo das 07:20 já passou e a edição de hoje ainda não foi " +
          "registrada. A última publicada é de " + extenso(u.data) + "."
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
    var falta = DISPARO_H * 60 + DISPARO_M - minutosNoProjeto();
    if (falta <= 0) falta += 24 * 60;
    var h = Math.floor(falta / 60), m = falta % 60;
    return h === 0 ? m + " min" : h + "h " + (m < 10 ? "0" + m : m);
  }

  // ------------------------------------------------------------- blocos
  function preencherFita(s) {
    var itens = s.mercado || [];
    if (!itens.length) { $("fita").hidden = true; return; }
    var html = itens.map(function (m) {
      var v = m.variacao_pct;
      var classe = v == null ? "" : (v >= 0 ? "sobe" : "cai");
      var seta = v == null ? "" : (v >= 0 ? "▲ " : "▼ ");
      var texto = v == null ? "—"
        : seta + (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
      return '<span class="cotacao"><span class="t">' + escapar(m.nome) + "</span>" +
        '<span class="v">' + escapar(m.valor) + "</span>" +
        '<span class="d ' + classe + '">' + texto + "</span></span>";
    }).join("");
    // Duas voltas: a animacao desloca metade do trilho e volta ao inicio
    // sem emenda visivel.
    $("fita-trilho").innerHTML = html + html;
  }

  function preencherPainel(s, estado, hoje) {
    var u = s.ultima_edicao || {};
    var texto = textoDoEstado(estado, s, hoje);
    var cor = (window.Briefy && Briefy.ESTADOS[estado] || {}).cor || "--ok";

    var titulo = $("estado-titulo");
    titulo.textContent = texto.titulo;
    titulo.style.setProperty("--cor-estado", "var(" + cor + ")");
    $("estado-detalhe").textContent = texto.detalhe;

    $("v-hora").textContent = (s.hoje && s.hoje.hora) || "—";
    $("v-destinatarios").textContent = (s.hoje && s.hoje.destinatarios) ||
      (s.projeto.leitores != null ? s.projeto.leitores : "—");
    var curador = (s.hoje && s.hoje.curado_por) || null;
    $("v-curador").textContent = curador ? (ROTULO_CURADOR[curador] || curador) : "—";
    $("v-itens").textContent = u.itens != null ? u.itens : "—";
    $("v-newsletters").textContent = u.newsletters != null ? u.newsletters : "—";
    $("v-proximo").textContent = proximoDisparo();
  }

  function preencherCabecalho(s) {
    var u = s.ultima_edicao || {};
    $("selo-data").textContent = extenso(u.data);
    $("rodape-gerado").textContent = "atualizado " + curto((s.gerado_em || "").slice(0, 10)) +
      ((s.hoje && s.hoje.hora) ? " · " + s.hoje.hora : "");
  }

  function preencherPlacar(s) {
    var p = s.projeto || {};
    var casas = [
      [p.edicoes, "edições"],
      [p.sequencia, "dias seguidos"],
      [p.itens_curados, "itens curados"],
      [(p.feeds || 0) + (p.indicadores || 0), "fontes"],
      [p.leitores, "leitores"]
    ];
    $("placar").innerHTML = casas.map(function (c) {
      return '<div class="casa"><span class="n">' + comZeros(c[0], 3) +
        '</span><span class="r">' + c[1] + "</span></div>";
    }).join("");
  }

  function preencherUltima(s) {
    var u = s.ultima_edicao || {};
    $("ultima-nota").textContent = u.numero ? "número " + u.numero : "";
    $("ultima-meta").textContent = extenso(u.data) +
      (u.itens ? " · " + u.itens + " itens" : "");
    $("ultima-assunto").textContent = semAssuntoPadrao(u.assunto) || "—";
    $("ultima-abertura").innerHTML = enfase(u.abertura);
    if (u.data) $("ultima-link").href = "edicoes/" + u.data + ".html";
  }

  var NIVEIS = [0.28, 0.5, 0.74, 1];

  function preencherCalendario(s) {
    var grade = $("grade");
    var hist = {}, maximo = 1;
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
    var vazios = cursor.getUTCDay();
    for (var v = 0; v < vazios; v++) celulas.push('<span class="dia vazio"></span>');

    while (cursor <= fim) {
      var iso = cursor.toISOString().slice(0, 10);
      var h = hist[iso];
      var rotulo = iso.split("-").reverse().join("/");
      if (h) {
        var faixa = Math.min(3, Math.floor((h.itens / maximo) * 3.999));
        celulas.push('<span class="dia" style="background:var(--ambar);opacity:' +
          NIVEIS[faixa] + '" title="' + escapar(rotulo) + " — " + h.itens + ' itens"></span>');
      } else {
        celulas.push('<span class="dia" title="' + escapar(rotulo) +
          ' — sem edição"></span>');
      }
      cursor = new Date(cursor.getTime() + 86400000);
    }
    grade.innerHTML = celulas.join("");

    var publicadas = (s.historico || []).length;
    var total = celulas.length - vazios;
    $("calendario-nota").textContent = publicadas + " de " +
      Math.max(publicadas, total) + " dias desde " + extenso(inicio);

    [1, 2, 3, 4].forEach(function (n, i) {
      var el = $("leg-" + n);
      if (el) { el.style.background = "var(--ambar)"; el.style.opacity = NIVEIS[i]; }
    });
  }

  function barras(alvo, itens, chaveValor) {
    var el = $(alvo);
    if (!itens || !itens.length) {
      el.innerHTML = '<li class="carregando">sem dados</li>';
      return;
    }
    var maximo = itens.reduce(function (m, i) { return Math.max(m, i[chaveValor]); }, 1);
    el.innerHTML = itens.map(function (i) {
      var pct = Math.max(2, (i[chaveValor] / maximo) * 100);
      return '<li><span class="nome">' + escapar(i.nome) + "</span>" +
        '<span class="v">' + i[chaveValor] + "</span>" +
        '<span class="trilho"><span class="cheio" style="width:' +
        pct.toFixed(1) + '%"></span></span></li>';
    }).join("");
  }

  function preencherSaude(s) {
    var lista = s.saude_fontes || [];
    var dias = lista.length ? lista[0].dias : 0;
    var caidas = lista.filter(function (f) { return f.falhas > 0; });
    var inteiras = lista.length - caidas.length;

    $("saude-nota").textContent = dias ? "falhas nas últimas " + dias + " edições" : "";

    var html = caidas.map(function (f) {
      var pct = dias ? Math.round(((dias - f.falhas) / dias) * 100) : 100;
      var classe = pct < 50 ? "ruim" : (pct < 95 ? "meia" : "boa");
      return "<li><span>" + escapar(f.nome) +
        '<span class="tipo">' + (f.tipo === "feed" ? "feed" : "mercado") + "</span></span>" +
        '<span class="pct ' + classe + '">' + pct + "%</span>" +
        '<span class="trilho"><span class="cheio ' + classe + '-f" style="width:' +
        pct + '%"></span></span></li>';
    });

    if (inteiras > 0) {
      html.push("<li><span>" + inteiras + " " +
        plural(inteiras, "fonte respondeu", "fontes responderam") + " todos os dias</span>" +
        '<span class="pct boa">100%</span>' +
        '<span class="trilho"><span class="cheio boa-f" style="width:100%"></span></span></li>');
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
      var texto = v == null ? "—"
        : (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
      return "<tr><td>" + escapar(m.nome) + "</td>" +
        '<td class="grupo">' + escapar(m.grupo || "") + "</td>" +
        '<td class="num">' + escapar(m.valor) + "</td>" +
        '<td class="num ' + classe + '">' + texto + "</td></tr>";
    }).join("");
  }

  function preencherArquivo(s) {
    var edicoes = (s.edicoes || []).slice().reverse();
    $("arquivo-nota").textContent = edicoes.length + " " +
      plural(edicoes.length, "edição", "edições");

    var porMes = [], indice = {};
    edicoes.forEach(function (e) {
      var chave = e.data.slice(0, 7);
      if (!indice[chave]) {
        indice[chave] = { chave: chave, itens: [] };
        porMes.push(indice[chave]);
      }
      indice[chave].itens.push(e);
    });

    // So o mes mais recente nasce aberto; os anteriores viram pastas fechadas.
    $("arquivo").innerHTML = porMes.map(function (m, posicao) {
      var d = partes(m.chave + "-01");
      var linhas = m.itens.map(function (e) {
        var dia = partes(e.data).dia;
        return '<li><a href="' + escapar(e.arquivo) + '">' +
          '<span class="d">' + (dia < 10 ? "0" + dia : dia) + "</span>" +
          '<span class="t">' + escapar(semAssuntoPadrao(e.assunto)) + "</span>" +
          '<span class="q">' + e.itens + " itens</span></a></li>";
      }).join("");
      return '<details class="pasta"' + (posicao === 0 ? " open" : "") + ">" +
        '<summary><span class="marcador" aria-hidden="true"></span>' +
        '<span class="mes-nome">' + MESES[d.mes - 1] + " " + d.ano + "</span>" +
        '<span class="quantas">' + m.itens.length + " " +
        plural(m.itens.length, "edição", "edições") + "</span></summary>" +
        '<ul class="lista">' + linhas + "</ul></details>";
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
    if (p.itens_curados) sempre.push(p.itens_curados + " itens curados desde " +
      extenso(p.primeira_edicao) + ".");
    if (topFonte) sempre.push(topFonte.nome + " é minha fonte mais citada: " +
      topFonte.citacoes + " vezes.");
    if (topNews) sempre.push(topNews.nome + " apareceu em " + topNews.edicoes + " edições.");
    if (mortas.length) sempre.push(mortas[0].nome + " falha há " + mortas[0].dias +
      " dias seguidos e ninguém tinha notado.");
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
    led: $("led"),
    badgeTexto: $("sinal-texto")
  }) : null;

  fetch("status.json", { cache: "no-cache" })
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (s) {
      var hoje = hojeNoProjeto();
      var estado = decidirEstado(s, hoje);

      preencherFita(s);
      preencherCabecalho(s);
      preencherPainel(s, estado, hoje);
      preencherPlacar(s);
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

      setInterval(function () {
        $("v-proximo").textContent = proximoDisparo();
      }, 30000);
    })
    .catch(function (erro) {
      var el = $("erro");
      el.textContent = "Não consegui ler o status.json (" + erro.message +
        "). A página mostra a estrutura, mas sem os números do dia.";
      el.hidden = false;
      if (briefy) briefy.definirEstado("dormindo");
    });
})();
