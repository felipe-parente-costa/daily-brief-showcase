/* Briefy: o personagem 3D da pagina de status.
 *
 * Nenhum arquivo de modelo: o corpo e um perfil girado, o rosto e desenhado
 * num canvas a cada quadro e projetado por dentro da viseira, e o reflexo vem
 * de um mapa de ambiente gerado por codigo. Precisa do THREE global.
 *
 * Uso:
 *   var b = Briefy.criar({ palco: el, bilhete: el, bilheteTexto: el,
 *                          led: el, badgeTexto: el });
 *   b.definirFrases({ entregue: ["..."] });
 *   b.definirEstado("entregue");
 */
window.Briefy = (function () {
  "use strict";

  var ESTADOS = {
    entregue:    { rotulo: "Entregue",        cor: "--ok",    led: 0x4ae3a6, rosto: "feliz" },
    trabalhando: { rotulo: "Rodando",         cor: "--work",  led: 0xf0ac2b, rosto: "foco" },
    falhou:      { rotulo: "Falhou",          cor: "--bad",   led: 0xf2654e, rosto: "erro" },
    dormindo:    { rotulo: "Fora do horario", cor: "--sleep", led: 0x7f93ab, rosto: "sono" }
  };

  var FRASES_PADRAO = {
    entregue: ["Edição do dia entregue."],
    trabalhando: ["Coletando agora."],
    falhou: ["Hoje não deu. O resgate assume."],
    dormindo: ["Acordo às 07:20."]
  };

  function criar(ref) {
    var palco = ref.palco;
    if (!palco) return null;

    if (typeof THREE === "undefined") {
      palco.insertAdjacentHTML("beforeend",
        '<p style="position:absolute;inset:auto 18px 18px;color:var(--muted);' +
        'font-size:13px;margin:0">A biblioteca 3D não carregou.</p>');
      return { definirEstado: function () {}, definirFrases: function () {} };
    }

    var semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    var atual = "dormindo";
    var frases = FRASES_PADRAO;

    // ============================= cena =============================
    var cena = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 16 / 11, 0.1, 100);
    camera.position.set(0, 0.22, 7.2);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    palco.appendChild(renderer.domElement);

    // Mapa de ambiente por codigo: gradiente ceu/chao com duas "janelas"
    // claras, so para a viseira ter o que refletir.
    (function ambiente() {
      var c = document.createElement("canvas");
      c.width = 256; c.height = 128;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0.00, "#f2f6fb");
      grad.addColorStop(0.42, "#9fb6d2");
      grad.addColorStop(0.52, "#3f536c");
      grad.addColorStop(1.00, "#101822");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = "rgba(255,255,255,0.85)";
      g.fillRect(28, 22, 46, 26);
      g.fillStyle = "rgba(255,236,214,0.55)";
      g.fillRect(168, 30, 34, 20);
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      var pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      cena.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();
    })();

    cena.add(new THREE.HemisphereLight(0xdce8f6, 0x0c1420, 0.25));

    var principal = new THREE.DirectionalLight(0xfff6ec, 1.5);
    principal.position.set(3.4, 5.2, 4.2);
    principal.castShadow = true;
    principal.shadow.mapSize.set(2048, 2048);
    principal.shadow.radius = 4;
    principal.shadow.bias = -0.0009;
    var sc = principal.shadow.camera;
    sc.near = 0.5; sc.far = 24; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3;
    cena.add(principal);

    var preenche = new THREE.DirectionalLight(0x9dc0ea, 0.3);
    preenche.position.set(-4.2, 1.2, 2.4);
    cena.add(preenche);

    var contorno = new THREE.DirectionalLight(0xffd3b3, 0.7);
    contorno.position.set(-1.8, 2.6, -3.6);
    cena.add(contorno);

    var chao = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.ShadowMaterial({ color: 0x08121c, opacity: 0.34 })
    );
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -1.46;
    chao.receiveShadow = true;
    cena.add(chao);

    // ========================== materiais ===========================
    function pintura(cor, rug, met) {
      return new THREE.MeshPhysicalMaterial({
        color: cor, roughness: rug, metalness: met,
        clearcoat: 0.55, clearcoatRoughness: 0.28, envMapIntensity: 0.55
      });
    }
    var MAT = {
      casco: pintura(0x1b4a79, 0.34, 0.22),
      cascoEscuro: pintura(0x102c4b, 0.3, 0.3),
      metal: new THREE.MeshPhysicalMaterial({ color: 0xc3cdd8, roughness: 0.26, metalness: 0.92 }),
      // Vidro fume translucido de proposito: o rosto de LED fica atras dele.
      vidro: new THREE.MeshPhysicalMaterial({
        color: 0x080e15, roughness: 0.05, metalness: 0.12,
        clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.6,
        transparent: true, opacity: 0.85, depthWrite: false
      }),
      couro: pintura(0x8a5f3c, 0.62, 0.05),
      correia: pintura(0xa83426, 0.5, 0.08),
      papel: new THREE.MeshStandardMaterial({
        color: 0xf3f6fa, roughness: 0.92, metalness: 0, side: THREE.DoubleSide
      })
    };

    var briefy = new THREE.Group();
    cena.add(briefy);
    var tronco = new THREE.Group();
    var cranio = new THREE.Group();
    briefy.add(tronco, cranio);

    // ---- corpo: perfil girado ----
    (function corpo() {
      var pontos = [], passos = 56, R = 0.70, base = -1.06, topo = 0.52;
      for (var i = 0; i <= passos; i++) {
        var t = i / passos;
        var raio = R * Math.pow(1 - Math.pow(Math.abs(2 * Math.pow(t, 0.86) - 1), 2.7), 1 / 2.7);
        pontos.push(new THREE.Vector2(Math.max(raio, 0.0001), base + (topo - base) * t));
      }
      var m = new THREE.Mesh(new THREE.LatheGeometry(pontos, 64), MAT.casco);
      m.castShadow = true;
      tronco.add(m);

      var anel = new THREE.Mesh(new THREE.TorusGeometry(0.695, 0.012, 8, 72), MAT.cascoEscuro);
      anel.rotation.x = Math.PI / 2;
      anel.position.y = -0.3;
      tronco.add(anel);

      var placa = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.05), MAT.papel);
      placa.position.set(-0.03, -0.1, 0.6);
      placa.castShadow = true;
      tronco.add(placa);
      var selo = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.022), MAT.correia);
      selo.position.set(0.07, -0.035, 0.63);
      tronco.add(selo);
      for (var k = 0; k < 3; k++) {
        var linha = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.012, 0.02), MAT.cascoEscuro);
        linha.position.set(-0.11, -0.085 - k * 0.045, 0.63);
        tronco.add(linha);
      }
    })();

    var colar = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.37, 0.13, 48), MAT.metal);
    colar.position.y = 0.52;
    colar.castShadow = true;
    tronco.add(colar);

    // ---- cabeca ----
    // Em three.js o angulo phi comeca em -X; para um remendo ficar de frente
    // para a camera ele precisa estar centrado em PI/2.
    function frente(largura) { return Math.PI / 2 - largura / 2; }

    var ALTURA_CABECA = 1.08;
    var cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.58, 56, 40), MAT.cascoEscuro);
    cabeca.scale.set(1, 0.93, 0.97);
    cabeca.castShadow = true;
    cranio.add(cabeca);

    var quepe = new THREE.Mesh(
      new THREE.SphereGeometry(0.588, 56, 30, 0, Math.PI * 2, 0, 0.88),
      MAT.casco
    );
    quepe.scale.set(1, 0.93, 0.97);
    quepe.castShadow = true;
    cranio.add(quepe);

    var pala = new THREE.Mesh(
      new THREE.CircleGeometry(0.76, 48, Math.PI / 2 - 1.05, 2.1),
      new THREE.MeshPhysicalMaterial({
        color: 0x0d2440, roughness: 0.33, metalness: 0.35,
        clearcoat: 0.7, side: THREE.DoubleSide
      })
    );
    pala.rotation.x = -1.3;
    pala.position.set(0, 0.17, -0.02);
    pala.castShadow = true;
    cranio.add(pala);

    var visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.606, 64, 44, frente(1.95), 1.95, 0.86, 0.94),
      MAT.vidro
    );
    visor.scale.set(1, 0.93, 0.97);
    visor.renderOrder = 3;
    cranio.add(visor);

    // ---- rosto em canvas, POR FORA do vidro (0.606) ----
    var ROSTO_L = 512, ROSTO_A = 256;
    var rostoCanvas = document.createElement("canvas");
    rostoCanvas.width = ROSTO_L; rostoCanvas.height = ROSTO_A;
    var rc = rostoCanvas.getContext("2d");
    var rostoTex = new THREE.CanvasTexture(rostoCanvas);
    var tela = new THREE.Mesh(
      new THREE.SphereGeometry(0.617, 64, 44, frente(1.6), 1.6, 0.92, 0.8),
      new THREE.MeshBasicMaterial({
        map: rostoTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.FrontSide
      })
    );
    tela.scale.set(1, 0.93, 0.97);
    tela.renderOrder = 4;
    cranio.add(tela);

    function pilula(x, y, l, a) {
      var r = Math.min(l, a) / 2;
      rc.beginPath();
      rc.moveTo(x - l / 2 + r, y - a / 2);
      rc.arcTo(x + l / 2, y - a / 2, x + l / 2, y + a / 2, r);
      rc.arcTo(x + l / 2, y + a / 2, x - l / 2, y + a / 2, r);
      rc.arcTo(x - l / 2, y + a / 2, x - l / 2, y - a / 2, r);
      rc.arcTo(x - l / 2, y - a / 2, x + l / 2, y - a / 2, r);
      rc.closePath();
      rc.fill();
    }

    var rostoAtual = "sono";
    function desenharRosto(cor, olharX, olharY, piscada, tempo) {
      rc.clearRect(0, 0, ROSTO_L, ROSTO_A);
      rc.save();
      rc.translate(ROSTO_L / 2 + olharX * 22, ROSTO_A / 2 + olharY * 14);
      rc.fillStyle = cor;
      rc.strokeStyle = cor;
      rc.lineCap = "round";
      rc.lineJoin = "round";
      rc.shadowColor = cor;
      rc.shadowBlur = 28;

      var dx = 104, ey = -26;

      if (rostoAtual === "feliz") {
        var a = 54 * piscada;
        if (piscada > 0.25) {
          pilula(-dx, ey, 33, a);
          pilula(dx, ey, 33, a);
        } else {
          rc.lineWidth = 13;
          [-dx, dx].forEach(function (x) {
            rc.beginPath(); rc.moveTo(x - 18, ey); rc.lineTo(x + 18, ey); rc.stroke();
          });
        }
        rc.lineWidth = 13;
        rc.beginPath();
        rc.arc(0, 32, 38, Math.PI * 0.18, Math.PI * 0.82);
        rc.stroke();
      } else if (rostoAtual === "foco") {
        pilula(-dx, ey, 46, 17);
        pilula(dx, ey, 46, 17);
        rc.lineWidth = 11;
        rc.beginPath(); rc.moveTo(-22, 40); rc.lineTo(22, 40); rc.stroke();
        for (var i = 0; i < 3; i++) {
          var fase = (tempo * 2.2 - i * 0.45) % 2.4;
          rc.globalAlpha = (fase > 0 && fase < 0.9) ? 1 : 0.22;
          pilula(-26 + i * 26, 72, 13, 13);
        }
        rc.globalAlpha = 1;
      } else if (rostoAtual === "erro") {
        rc.lineWidth = 14;
        [-dx, dx].forEach(function (x) {
          rc.beginPath();
          rc.moveTo(x - 17, ey - 17); rc.lineTo(x + 17, ey + 17);
          rc.moveTo(x + 17, ey - 17); rc.lineTo(x - 17, ey + 17);
          rc.stroke();
        });
        rc.lineWidth = 12;
        rc.beginPath();
        rc.moveTo(-34, 42);
        rc.quadraticCurveTo(-17, 28, 0, 42);
        rc.quadraticCurveTo(17, 56, 34, 42);
        rc.stroke();
      } else {
        rc.lineWidth = 13;
        [-dx, dx].forEach(function (x) {
          rc.beginPath();
          rc.arc(x, ey - 8, 22, Math.PI * 0.12, Math.PI * 0.88);
          rc.stroke();
        });
        rc.lineWidth = 11;
        rc.beginPath();
        rc.arc(6, 42, 11, 0, Math.PI * 2);
        rc.stroke();
      }
      rc.restore();
      // Segunda passada somando a si mesma: o nucleo do LED satura e o halo
      // continua suave. Mais barato que um passe de bloom.
      rc.save();
      rc.globalCompositeOperation = "lighter";
      rc.drawImage(rostoCanvas, 0, 0);
      rc.restore();
      rostoTex.needsUpdate = true;
    }

    // ---- antena ----
    var haste = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.34, 12), MAT.metal);
    haste.position.y = 0.66;
    cranio.add(haste);
    var bulboMat = new THREE.MeshStandardMaterial({
      color: 0x7f93ab, emissive: 0x7f93ab, emissiveIntensity: 1.2, roughness: 0.3
    });
    var bulbo = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 18), bulboMat);
    bulbo.position.y = 0.86;
    cranio.add(bulbo);

    var haloCanvas = document.createElement("canvas");
    haloCanvas.width = haloCanvas.height = 128;
    (function () {
      var g = haloCanvas.getContext("2d");
      var rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      rad.addColorStop(0, "rgba(255,255,255,0.95)");
      rad.addColorStop(0.3, "rgba(255,255,255,0.35)");
      rad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rad;
      g.fillRect(0, 0, 128, 128);
    })();
    var haloMat = new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(haloCanvas), color: 0x7f93ab,
      blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.6
    });
    var halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(0.52);
    halo.position.copy(bulbo.position);
    cranio.add(halo);

    // ---- bracos ----
    function braco(sinal) {
      var g = new THREE.Group();
      var ombro = new THREE.Mesh(new THREE.SphereGeometry(0.13, 24, 18), MAT.metal);
      var membro = new THREE.Mesh(new THREE.CapsuleGeometry(0.095, 0.3, 8, 20), MAT.casco);
      membro.position.y = -0.24;
      membro.castShadow = true;
      var mao = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 18), MAT.cascoEscuro);
      mao.position.y = -0.44;
      mao.castShadow = true;
      g.add(ombro, membro, mao);
      g.position.set(sinal * 0.66, 0.1, 0.04);
      g.rotation.z = sinal * -0.26;
      return g;
    }
    var bracoE = braco(-1), bracoD = braco(1);
    tronco.add(bracoE, bracoD);

    // ---- bolsa de correio ----
    (function bolsa() {
      var corpoBolsa = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.38, 0.22), MAT.couro);
      corpoBolsa.position.set(0.66, -0.56, 0.2);
      corpoBolsa.rotation.z = -0.12;
      corpoBolsa.castShadow = true;
      var aba = new THREE.Mesh(new THREE.BoxGeometry(0.515, 0.15, 0.235), pintura(0x6f4a2d, 0.6, 0.05));
      aba.position.set(0.66, -0.4, 0.2);
      aba.rotation.z = -0.12;
      var fecho = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), MAT.metal);
      fecho.rotation.x = Math.PI / 2;
      fecho.position.set(0.66, -0.47, 0.33);
      var correia = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.035, 10, 56), MAT.correia);
      correia.position.set(0.04, -0.1, 0.06);
      correia.rotation.set(0.2, 0.08, 0.56);
      correia.castShadow = true;
      var carta = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.012), MAT.papel);
      carta.position.set(0.63, -0.34, 0.26);
      carta.rotation.set(0.2, 0, -0.22);
      tronco.add(corpoBolsa, aba, fecho, correia, carta);
    })();

    // ====================== acessorios por estado ======================
    function texturaEnvelope() {
      var c = document.createElement("canvas");
      c.width = 256; c.height = 176;
      var g = c.getContext("2d");
      g.fillStyle = "#f6f8fb"; g.fillRect(0, 0, 256, 176);
      for (var i = -176; i < 256; i += 22) {
        g.save();
        g.translate(i, 0); g.rotate(0.72);
        g.fillStyle = "#bb3c2c"; g.fillRect(0, 0, 11, 300);
        g.fillStyle = "#12355b"; g.fillRect(11, 0, 11, 300);
        g.restore();
      }
      g.fillStyle = "#f6f8fb"; g.fillRect(16, 14, 224, 148);
      g.fillStyle = "#bb3c2c"; g.fillRect(186, 26, 42, 50);
      g.fillStyle = "#f6f8fb"; g.fillRect(192, 32, 30, 38);
      g.fillStyle = "#bb3c2c"; g.font = "bold 13px monospace";
      g.fillText("DB", 198, 56);
      g.fillStyle = "#9fadbd";
      [96, 114, 132].forEach(function (y, k) { g.fillRect(34, y, 150 - k * 34, 7); });
      g.fillStyle = "#12355b";
      g.font = "bold 12px monospace";
      g.fillText("DAILY BRIEF", 34, 60);
      return new THREE.CanvasTexture(c);
    }

    var envelope = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.29),
      new THREE.MeshStandardMaterial({
        map: texturaEnvelope(), roughness: 0.88, metalness: 0, side: THREE.DoubleSide
      })
    );
    envelope.position.set(-0.86, -0.52, 0.34);
    envelope.rotation.set(-0.3, 0.42, 0.14);
    envelope.castShadow = true;
    briefy.add(envelope);

    function texturaColuna() {
      var c = document.createElement("canvas");
      c.width = 128; c.height = 96;
      var g = c.getContext("2d");
      g.fillStyle = "#f3f6fa"; g.fillRect(0, 0, 128, 96);
      g.fillStyle = "#12355b"; g.fillRect(12, 12, 54, 8);
      g.fillStyle = "#a9b6c5";
      for (var y = 30; y < 88; y += 10) g.fillRect(12, y, 104 - (y % 20), 5);
      return new THREE.CanvasTexture(c);
    }
    var matColuna = new THREE.MeshStandardMaterial({
      map: texturaColuna(), roughness: 0.9, metalness: 0, side: THREE.DoubleSide
    });

    var voando = new THREE.Group();
    var folhas = [];
    for (var i = 0; i < 8; i++) {
      var f = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.2), matColuna);
      folhas.push({
        malha: f, fase: (i / 8) * Math.PI * 2,
        raio: 1.25 + (i % 3) * 0.17, altura: -0.45 + (i % 5) * 0.34
      });
      voando.add(f);
    }
    briefy.add(voando);

    var pilha = new THREE.Group();
    for (var j = 0; j < 6; j++) {
      var p = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.23), matColuna);
      p.rotation.set(-Math.PI / 2 + 0.05 * j, 0.6 * j, 0.15 * j);
      p.position.set(-0.95 + 0.2 * j, -1.44 + 0.014 * j, 0.5 - 0.13 * j);
      pilha.add(p);
    }
    cena.add(pilha);

    var gota = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 20, 16),
      new THREE.MeshPhysicalMaterial({
        color: 0xaedcf7, roughness: 0.04, metalness: 0, clearcoat: 1,
        transparent: true, opacity: 0.92
      })
    );
    gota.position.set(0.5, 1.45, 0.32);
    briefy.add(gota);

    function spriteZ(tam) {
      var c = document.createElement("canvas");
      c.width = c.height = 128;
      var g = c.getContext("2d");
      g.fillStyle = "#ffffff";
      g.font = "600 100px Georgia, serif";
      g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText("z", 64, 70);
      var s = new THREE.Sprite(new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(c), color: 0x9fb4cc,
        transparent: true, depthWrite: false, opacity: 0.8
      }));
      s.scale.setScalar(tam);
      return s;
    }
    var zzz = new THREE.Group();
    var zs = [spriteZ(0.22), spriteZ(0.3), spriteZ(0.38)];
    zs.forEach(function (s) { zzz.add(s); });
    briefy.add(zzz);

    // ============================ estados ============================
    var corLed = new THREE.Color(0x7f93ab);
    var corAlvo = new THREE.Color(0x7f93ab);
    var intensidadeAlvo = 1.2;

    function definirEstado(chave) {
      var e = ESTADOS[chave];
      if (!e) return;
      atual = chave;
      corAlvo.setHex(e.led);
      rostoAtual = e.rosto;
      envelope.visible = chave === "entregue";
      voando.visible = chave === "trabalhando";
      pilha.visible = chave === "falhou";
      gota.visible = chave === "falhou";
      zzz.visible = chave === "dormindo";
      intensidadeAlvo = chave === "dormindo" ? 0.8 : (chave === "trabalhando" ? 2.8 : 2.2);

      if (ref.badgeTexto) ref.badgeTexto.textContent = e.rotulo;
      if (ref.led) ref.led.style.setProperty("--state-color", "var(" + e.cor + ")");
      esconderBilhete();
    }

    // ========================== bilhete ==========================
    var timerBilhete = null;
    function mostrarBilhete(texto) {
      if (!ref.bilhete || !ref.bilheteTexto) return;
      ref.bilheteTexto.textContent = texto;
      ref.bilhete.classList.add("show");
      clearTimeout(timerBilhete);
      timerBilhete = setTimeout(esconderBilhete, 4200);
    }
    function esconderBilhete() {
      if (!ref.bilhete) return;
      clearTimeout(timerBilhete);
      ref.bilhete.classList.remove("show");
    }

    // ========================= interacao =========================
    var giroAlvo = 0, giro = 0, velocidade = 0;
    var arrastando = false, moveu = false, ultimoX = 0;
    var pulo = 0;
    var ponteiro = { x: 0, y: 0 };
    var olhar = { x: 0, y: 0 };

    palco.addEventListener("pointerdown", function (ev) {
      arrastando = true; moveu = false; ultimoX = ev.clientX;
      palco.classList.add("dragging");
      if (palco.setPointerCapture) palco.setPointerCapture(ev.pointerId);
    });
    palco.addEventListener("pointermove", function (ev) {
      var r = palco.getBoundingClientRect();
      ponteiro.x = ((ev.clientX - r.left) / r.width) * 2 - 1;
      ponteiro.y = ((ev.clientY - r.top) / r.height) * 2 - 1;
      if (!arrastando) return;
      var d = ev.clientX - ultimoX;
      ultimoX = ev.clientX;
      if (Math.abs(d) > 1) moveu = true;
      giroAlvo += d * 0.0095;
      velocidade = d * 0.0095;
    });
    function soltar() {
      if (!arrastando) return;
      arrastando = false;
      palco.classList.remove("dragging");
      if (!moveu) {
        var lista = frases[atual] || FRASES_PADRAO[atual] || [];
        if (lista.length) mostrarBilhete(lista[Math.floor(Math.random() * lista.length)]);
        pulo = 1;
      }
    }
    palco.addEventListener("pointerup", soltar);
    palco.addEventListener("pointercancel", soltar);
    palco.addEventListener("pointerleave", function () {
      soltar();
      ponteiro.x = 0; ponteiro.y = 0;
    });

    // ============================= loop =============================
    function dimensionar() {
      var l = palco.clientWidth, a = palco.clientHeight;
      if (!l || !a) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(l, a, false);
      camera.aspect = l / a;
      camera.updateProjectionMatrix();
    }
    dimensionar();
    if (window.ResizeObserver) new ResizeObserver(dimensionar).observe(palco);
    else window.addEventListener("resize", dimensionar);

    var relogio = new THREE.Clock();
    var proximaPiscada = 2.6;
    var piscada = 1;

    function quadro() {
      // getElapsedTime() consome o delta internamente: delta primeiro.
      var dt = Math.min(relogio.getDelta(), 0.05);
      var t = relogio.elapsedTime;
      var tt = semMovimento ? 0 : t;

      corLed.lerp(corAlvo, 1 - Math.pow(0.0025, dt));
      bulboMat.color.copy(corLed);
      bulboMat.emissive.copy(corLed);
      bulboMat.emissiveIntensity += (intensidadeAlvo - bulboMat.emissiveIntensity) * Math.min(1, dt * 6);
      haloMat.color.copy(corLed);
      haloMat.opacity = 0.35 + 0.42 * (bulboMat.emissiveIntensity / 2.8);

      if (!semMovimento) {
        var ritmo = atual === "dormindo" ? 0.85 : 1.55;
        var bob = Math.sin(tt * ritmo) * (atual === "dormindo" ? 0.055 : 0.088);
        var altura = bob + (atual === "falhou" ? -0.1 : 0);
        if (pulo > 0) {
          pulo = Math.max(0, pulo - dt * 1.8);
          altura += Math.sin((1 - pulo) * Math.PI) * 0.46;
        }
        briefy.position.y = altura;
        briefy.rotation.z = Math.sin(tt * 0.78) * 0.022 + (atual === "falhou" ? 0.08 : 0);

        var resp = 1 + Math.sin(tt * ritmo * 1.6) * 0.012;
        tronco.scale.set(1 / Math.sqrt(resp), resp, 1 / Math.sqrt(resp));

        if (!arrastando) {
          giroAlvo += velocidade;
          velocidade *= 0.93;
          giroAlvo *= 0.986;
        }
        giro += (giroAlvo - giro) * Math.min(1, dt * 7);
        briefy.rotation.y = giro + Math.sin(tt * 0.42) * 0.055;

        var alvoX = arrastando ? 0 : ponteiro.x * 0.3;
        var alvoY = arrastando ? 0 : -ponteiro.y * 0.18;
        if (atual === "dormindo") { alvoX = 0.12; alvoY = 0.26; }
        olhar.x += (alvoX - olhar.x) * Math.min(1, dt * 3.4);
        olhar.y += (alvoY - olhar.y) * Math.min(1, dt * 3.4);
        cranio.position.y = ALTURA_CABECA + Math.sin(tt * ritmo - 0.4) * 0.012;
        cranio.rotation.set(
          olhar.y, olhar.x,
          Math.sin(tt * 0.6 - 0.5) * 0.02 + (atual === "dormindo" ? 0.14 : 0)
        );

        var balanco = Math.sin(tt * ritmo - 0.7) * 0.05;
        bracoE.rotation.z = 0.26 + balanco;
        bracoD.rotation.z = -0.26 - balanco;

        piscada = 1;
        if (rostoAtual === "feliz") {
          if (t > proximaPiscada) {
            var fase = (t - proximaPiscada) / 0.17;
            if (fase < 1) piscada = Math.abs(Math.cos(fase * Math.PI)) * 0.92 + 0.08;
            else proximaPiscada = t + 2.4 + Math.random() * 3.6;
          }
        }

        if (voando.visible) {
          folhas.forEach(function (f) {
            var ang = tt * 1.2 + f.fase;
            f.malha.position.set(
              Math.cos(ang) * f.raio,
              f.altura + Math.sin(ang * 1.6) * 0.14,
              Math.sin(ang) * f.raio * 0.5
            );
            f.malha.rotation.set(ang * 0.7, ang, ang * 0.45);
          });
        }
        if (gota.visible) {
          var q = (t % 2.3) / 2.3;
          gota.position.y = 1.45 - q * 0.55;
          gota.material.opacity = 0.92 * (1 - q * q);
        }
        if (zzz.visible) {
          zs.forEach(function (s, k) {
            var q2 = ((t * 0.4 + k * 0.33) % 1);
            s.position.set(0.52 + q2 * 0.55, 1.5 + q2 * 0.85, 0.22);
            s.material.opacity = 0.85 * Math.sin(q2 * Math.PI);
          });
        }
        if (envelope.visible) {
          envelope.rotation.z = 0.14 + Math.sin(tt * 1.8) * 0.09;
          envelope.position.y = -0.52 + Math.sin(tt * 1.8 + 0.6) * 0.04;
        }

        camera.position.x += (ponteiro.x * 0.26 - camera.position.x) * Math.min(1, dt * 2.2);
        camera.position.y += (0.22 - ponteiro.y * 0.16 - camera.position.y) * Math.min(1, dt * 2.2);
      } else {
        briefy.position.y = 0;
        cranio.position.y = ALTURA_CABECA;
      }
      camera.lookAt(0, 0.1, 0);

      desenharRosto(
        "rgb(" + Math.round(corLed.r * 255) + "," + Math.round(corLed.g * 255) + "," + Math.round(corLed.b * 255) + ")",
        olhar.x * 0.8, olhar.y * 0.8, piscada, t
      );

      renderer.render(cena, camera);
      requestAnimationFrame(quadro);
    }

    cranio.position.y = ALTURA_CABECA;
    definirEstado("dormindo");
    quadro();

    return {
      definirEstado: definirEstado,
      definirFrases: function (novas) { frases = novas || FRASES_PADRAO; },
      falar: mostrarBilhete
    };
  }

  return { criar: criar, ESTADOS: ESTADOS };
})();
