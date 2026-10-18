/* Briefy: o carteiro que roda o Daily Brief, em 3D.
 *
 * Modelado a partir do character sheet: corpo capsula creme, bone azul com
 * fenda de correio e aba de cobre, viseira escura com rosto de LED ambar,
 * asas de envelope, antena com bandeirinha, bolsa postal e propulsor.
 * Nenhum arquivo de modelo: tudo e geometria gerada por codigo. Precisa do
 * THREE global.
 *
 * Dois modos, como pedido:
 *   "entrega" - preparando ou ja entregue. Asas abertas, bandeira erguida,
 *               propulsor aceso, rosto ambar sorrindo.
 *   "falha"   - a edicao nao saiu. Asas recolhidas, bandeira caida,
 *               propulsor engasgando, rosto vermelho e cabisbaixo.
 *
 * Uso:
 *   var b = Briefy.criar({ palco: el, bilhete: el, bilheteTexto: el,
 *                          led: el, badgeTexto: el });
 *   b.definirFrases({ entregue: ["..."] });
 *   b.definirEstado("entregue");
 */
window.Briefy = (function () {
  "use strict";

  // Os quatro estados da pagina continuam existindo - o painel le o rotulo e
  // a cor daqui - e o avatar os resume em dois modos.
  var ESTADOS = {
    entregue:    { rotulo: "Entregue",        cor: "--ok",    modo: "entrega" },
    trabalhando: { rotulo: "Rodando",         cor: "--work",  modo: "entrega" },
    dormindo:    { rotulo: "Fora do horario", cor: "--sleep", modo: "entrega" },
    falhou:      { rotulo: "Falhou",          cor: "--bad",   modo: "falha" }
  };

  var FRASES_PADRAO = {
    entregue: ["Edição do dia entregue."],
    trabalhando: ["Coletando agora."],
    falhou: ["Hoje não deu. O resgate assume."],
    dormindo: ["Acordo às 07:20."]
  };

  var COR = {
    creme: 0xf3eee5,
    cremeEscuro: 0xd9d1c4,
    navy: 0x31405f,
    navyEscuro: 0x243150,
    cobre: 0xc87a3c,
    cobreClaro: 0xe0a059,
    visor: 0x1a1310,
    ambar: 0xffa726,
    laranja: 0xef8c3a,
    falha: 0xff4a2f,
    fumaca: 0x7d7a74
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
    var atual = "entregue";
    var modo = "entrega";
    var frases = FRASES_PADRAO;

    // ============================== cena ==============================
    var cena = new THREE.Scene();
    var camera = new THREE.PerspectiveCamera(30, 16 / 11, 0.1, 100);
    camera.position.set(0, 0.1, 9.6);

    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setClearAlpha(0);
    if (THREE.sRGBEncoding) renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.92;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    palco.appendChild(renderer.domElement);

    // Ambiente de reflexo gerado por codigo, so para o metal e o vidro terem
    // o que espelhar.
    (function ambiente() {
      var c = document.createElement("canvas");
      c.width = 256; c.height = 128;
      var g = c.getContext("2d");
      var grad = g.createLinearGradient(0, 0, 0, 128);
      grad.addColorStop(0.00, "#fdf6ec");
      grad.addColorStop(0.45, "#b9a894");
      grad.addColorStop(0.55, "#4a4036");
      grad.addColorStop(1.00, "#140f0b");
      g.fillStyle = grad;
      g.fillRect(0, 0, 256, 128);
      g.fillStyle = "rgba(255,255,255,0.9)";
      g.fillRect(30, 20, 44, 28);
      g.fillStyle = "rgba(255,196,120,0.5)";
      g.fillRect(170, 28, 36, 22);
      var tex = new THREE.CanvasTexture(c);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      var pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      cena.environment = pmrem.fromEquirectangular(tex).texture;
      pmrem.dispose();
      tex.dispose();
    })();

    cena.add(new THREE.HemisphereLight(0xf2e8da, 0x151b22, 0.3));

    var principal = new THREE.DirectionalLight(0xfff4e4, 1.65);
    principal.position.set(3.2, 5.0, 4.4);
    principal.castShadow = true;
    principal.shadow.mapSize.set(2048, 2048);
    principal.shadow.radius = 4;
    principal.shadow.bias = -0.0009;
    var sc = principal.shadow.camera;
    sc.near = 0.5; sc.far = 24; sc.left = -3; sc.right = 3; sc.top = 3; sc.bottom = -3;
    cena.add(principal);

    var preenche = new THREE.DirectionalLight(0xbcd2ea, 0.38);
    preenche.position.set(-4.0, 1.4, 2.6);
    cena.add(preenche);

    var contorno = new THREE.DirectionalLight(0xffc89a, 0.85);
    contorno.position.set(-1.6, 2.4, -3.8);
    cena.add(contorno);

    var chao = new THREE.Mesh(
      new THREE.PlaneGeometry(14, 14),
      new THREE.ShadowMaterial({ color: 0x120c08, opacity: 0.3 })
    );
    chao.rotation.x = -Math.PI / 2;
    chao.position.y = -1.62;
    chao.receiveShadow = true;
    cena.add(chao);

    // ============================ materiais ===========================
    function pintura(cor, rug, met, verniz) {
      return new THREE.MeshPhysicalMaterial({
        color: cor,
        roughness: rug === undefined ? 0.38 : rug,
        metalness: met === undefined ? 0.05 : met,
        clearcoat: verniz === undefined ? 0.6 : verniz,
        clearcoatRoughness: 0.22,
        envMapIntensity: 0.55
      });
    }

    var MAT = {
      creme: pintura(COR.creme, 0.32, 0.04, 0.7),
      cremeEscuro: pintura(COR.cremeEscuro, 0.45, 0.04, 0.4),
      navy: pintura(COR.navy, 0.42, 0.08, 0.5),
      navyEscuro: pintura(COR.navyEscuro, 0.5, 0.06, 0.3),
      cobre: new THREE.MeshPhysicalMaterial({
        color: COR.cobre, roughness: 0.24, metalness: 0.95, envMapIntensity: 1.1
      }),
      cobreClaro: new THREE.MeshPhysicalMaterial({
        color: COR.cobreClaro, roughness: 0.2, metalness: 0.9, envMapIntensity: 1.2
      }),
      // Viseira: vidro escuro e muito liso. O rosto fica POR FORA dela,
      // senao o brilho do LED e cortado pela opacidade do vidro.
      visor: new THREE.MeshPhysicalMaterial({
        color: COR.visor, roughness: 0.05, metalness: 0.1,
        clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 0.55,
        transparent: true, opacity: 0.96, depthWrite: false
      })
    };

    var briefy = new THREE.Group();
    cena.add(briefy);
    var tronco = new THREE.Group();
    var cranio = new THREE.Group();
    briefy.add(tronco, cranio);

    // Em three.js o angulo phi comeca em -X; um remendo so fica de frente
    // para a camera se estiver centrado em PI/2.
    function frente(largura) { return Math.PI / 2 - largura / 2; }

    // ---------------------------- corpo -------------------------------
    (function corpo() {
      // Capsula: expoente alto deixa os lados retos, como no desenho.
      var pontos = [], passos = 60, R = 0.69, base = -1.08, topo = 0.54;
      for (var i = 0; i <= passos; i++) {
        var t = i / passos;
        var raio = R * Math.pow(1 - Math.pow(Math.abs(2 * Math.pow(t, 0.88) - 1), 4.2), 1 / 4.2);
        pontos.push(new THREE.Vector2(Math.max(raio, 0.0001), base + (topo - base) * t));
      }
      var casco = new THREE.Mesh(new THREE.LatheGeometry(pontos, 72), MAT.creme);
      casco.castShadow = true;
      tronco.add(casco);

      var cinta = new THREE.Mesh(new THREE.TorusGeometry(0.695, 0.028, 12, 80), MAT.cobre);
      cinta.rotation.x = Math.PI / 2;
      cinta.position.y = -0.34;
      cinta.castShadow = true;
      tronco.add(cinta);

      var friso = new THREE.Mesh(new THREE.TorusGeometry(0.595, 0.011, 10, 72), MAT.cremeEscuro);
      friso.rotation.x = Math.PI / 2;
      friso.position.y = 0.26;
      tronco.add(friso);

      var colar = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.42, 0.12, 48), MAT.cobre);
      colar.position.y = 0.5;
      colar.castShadow = true;
      tronco.add(colar);
    })();

    // selo no peito: picote, moldura e envelope, tudo desenhado em canvas
    (function selo() {
      var c = document.createElement("canvas");
      c.width = c.height = 128;
      var g = c.getContext("2d");
      g.fillStyle = "#f7f3ec";
      g.fillRect(0, 0, 128, 128);
      g.globalCompositeOperation = "destination-out";
      for (var i = 0; i <= 8; i++) {
        var p = 8 + i * 14;
        [[p, 0], [p, 128], [0, p], [128, p]].forEach(function (xy) {
          g.beginPath(); g.arc(xy[0], xy[1], 6, 0, Math.PI * 2); g.fill();
        });
      }
      g.globalCompositeOperation = "source-over";
      g.strokeStyle = "#c87a3c";
      g.lineWidth = 4;
      g.strokeRect(20, 20, 88, 88);
      g.strokeStyle = "#ef8c3a";
      g.lineWidth = 5;
      g.strokeRect(34, 44, 60, 42);
      g.beginPath();
      g.moveTo(34, 44); g.lineTo(64, 68); g.lineTo(94, 44);
      g.stroke();
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.34),
        new THREE.MeshStandardMaterial({
          map: new THREE.CanvasTexture(c), transparent: true,
          roughness: 0.85, metalness: 0
        })
      );
      m.position.set(-0.04, -0.04, 0.687);
      tronco.add(m);
    })();

    // ---------------------------- cabeca ------------------------------
    var ALTURA_CABECA = 1.02;

    var cabeca = new THREE.Mesh(new THREE.SphereGeometry(0.6, 56, 42), MAT.creme);
    cabeca.castShadow = true;
    cranio.add(cabeca);

    var bone = new THREE.Mesh(
      new THREE.SphereGeometry(0.607, 56, 32, 0, Math.PI * 2, 0, 1.06),
      MAT.navy
    );
    bone.castShadow = true;
    cranio.add(bone);

    var aro = new THREE.Mesh(new THREE.TorusGeometry(0.534, 0.024, 12, 72), MAT.cobre);
    aro.rotation.x = Math.PI / 2;
    aro.position.y = 0.296;
    cranio.add(aro);

    // fenda de correio no alto do bone
    var fenda = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.04, 0.13), MAT.navyEscuro);
    fenda.position.set(0, 0.575, 0.1);
    fenda.rotation.x = -0.12;
    cranio.add(fenda);

    // aba do bone: cunha de ~110 graus saindo da testa
    var aba = new THREE.Mesh(
      new THREE.CircleGeometry(0.84, 56, frente(1.86), 1.86),
      new THREE.MeshPhysicalMaterial({
        color: COR.navy, roughness: 0.4, metalness: 0.08,
        clearcoat: 0.5, side: THREE.DoubleSide
      })
    );
    aba.rotation.x = -1.72;
    aba.position.set(0, 0.26, -0.04);
    aba.castShadow = true;
    cranio.add(aba);

    // viseira
    var visor = new THREE.Mesh(
      new THREE.SphereGeometry(0.618, 64, 46, frente(2.12), 2.12, 1.1, 0.78),
      MAT.visor
    );
    visor.renderOrder = 3;
    cranio.add(visor);

    // ------------------- rosto desenhado em canvas ---------------------
    // POR FORA do vidro (0.618): o vidro tem 93% de opacidade e cortaria o
    // brilho do LED se o rosto estivesse atras dele.
    var ROSTO_L = 512, ROSTO_A = 256;
    var rostoCanvas = document.createElement("canvas");
    rostoCanvas.width = ROSTO_L; rostoCanvas.height = ROSTO_A;
    var rc = rostoCanvas.getContext("2d");
    var rostoTex = new THREE.CanvasTexture(rostoCanvas);
    var tela = new THREE.Mesh(
      new THREE.SphereGeometry(0.632, 64, 46, frente(1.74), 1.74, 1.18, 0.58),
      new THREE.MeshBasicMaterial({
        map: rostoTex, transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.FrontSide
      })
    );
    tela.renderOrder = 4;
    cranio.add(tela);

    function olho(x, y, raio, achatamento) {
      rc.beginPath();
      rc.ellipse(x, y, raio, raio * achatamento, 0, 0, Math.PI * 2);
      rc.fill();
    }

    function desenharRosto(cor, olharX, olharY, piscada, tempo) {
      rc.clearRect(0, 0, ROSTO_L, ROSTO_A);
      rc.save();
      rc.translate(ROSTO_L / 2 + olharX * 20, ROSTO_A / 2 + olharY * 13);
      rc.fillStyle = cor;
      rc.strokeStyle = cor;
      rc.lineCap = "round";
      rc.lineJoin = "round";
      rc.shadowColor = cor;
      rc.shadowBlur = 17;

      var dx = 98, ey = -18;

      if (modo === "entrega") {
        if (piscada < 0.45) {
          // olho fechado e feliz: o arco do character sheet
          rc.lineWidth = 15;
          [-dx, dx].forEach(function (x) {
            rc.beginPath();
            rc.arc(x, ey + 14, 27, Math.PI * 1.12, Math.PI * 1.88);
            rc.stroke();
          });
        } else {
          olho(-dx, ey, 26, 1.12 * piscada);
          olho(dx, ey, 26, 1.12 * piscada);
          rc.save();
          rc.globalAlpha = 0.5;
          rc.fillStyle = "#ffffff";
          olho(-dx + 8, ey - 9, 7, 1);
          olho(dx + 8, ey - 9, 7, 1);
          rc.restore();
        }
        rc.lineWidth = 13;
        rc.beginPath();
        rc.arc(0, 34, 34, Math.PI * 0.2, Math.PI * 0.8);
        rc.stroke();
      } else {
        // modo falha: olhos caidos, boca reta e um tremor de sinal ruim
        var tremor = Math.sin(tempo * 9) * 2.5;
        rc.lineWidth = 15;
        [-dx, dx].forEach(function (x) {
          rc.beginPath();
          rc.arc(x, ey + 24 + tremor, 26, Math.PI * 0.16, Math.PI * 0.84);
          rc.stroke();
        });
        rc.lineWidth = 12;
        rc.beginPath();
        rc.moveTo(-30, 46 + tremor);
        rc.lineTo(30, 46 + tremor);
        rc.stroke();
      }

      rc.restore();
      // Soma a si mesma: o nucleo do LED satura e o halo continua suave.
      rc.save();
      rc.globalCompositeOperation = "lighter";
      rc.globalAlpha = 0.34;
      rc.drawImage(rostoCanvas, 0, 0);
      rc.restore();
      rostoTex.needsUpdate = true;
    }

    // --------------------------- antena -------------------------------
    var antena = new THREE.Group();
    antena.position.set(0.34, 0.4, -0.08);
    antena.rotation.z = -0.16;
    cranio.add(antena);

    var haste = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.019, 0.56, 12), MAT.cobre);
    haste.position.y = 0.28;
    antena.add(haste);

    var bolinha = new THREE.Mesh(new THREE.SphereGeometry(0.047, 20, 16), MAT.cobreClaro);
    bolinha.position.y = 0.58;
    antena.add(bolinha);

    // bandeirinha num grupo proprio, para poder cair no modo falha
    var bandeira = new THREE.Group();
    bandeira.position.y = 0.5;
    antena.add(bandeira);

    (function panoDaBandeira() {
      var c = document.createElement("canvas");
      c.width = 128; c.height = 86;
      var g = c.getContext("2d");
      g.fillStyle = "#ef8c3a";
      g.fillRect(0, 0, 128, 86);
      g.strokeStyle = "#fff6e8";
      g.lineWidth = 6;
      g.strokeRect(24, 22, 80, 46);
      g.beginPath();
      g.moveTo(24, 22); g.lineTo(64, 50); g.lineTo(104, 22);
      g.stroke();
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.26, 0.17),
        new THREE.MeshStandardMaterial({
          map: new THREE.CanvasTexture(c), roughness: 0.8, metalness: 0,
          emissive: COR.laranja, emissiveIntensity: 0.22,
          side: THREE.DoubleSide
        })
      );
      m.position.set(0.14, 0, 0);
      bandeira.add(m);
    })();

    // ---------------------------- asas --------------------------------
    function formaPena(comprimento, largura) {
      var s = new THREE.Shape();
      s.moveTo(0, 0);
      s.quadraticCurveTo(comprimento * 0.3, largura, comprimento, largura * 0.26);
      s.quadraticCurveTo(comprimento * 0.42, -largura * 0.16, 0, 0);
      return s;
    }

    function extrudar(forma, material) {
      var g = new THREE.ExtrudeGeometry(forma, {
        depth: 0.035, bevelEnabled: true, bevelThickness: 0.012,
        bevelSize: 0.012, bevelSegments: 2, curveSegments: 18
      });
      var m = new THREE.Mesh(g, material);
      m.castShadow = true;
      return m;
    }

    var matPena = pintura(COR.creme, 0.3, 0.04, 0.75);
    var matPonta = pintura(COR.laranja, 0.35, 0.1, 0.6);

    function construirAsa(sinal) {
      var asa = new THREE.Group();
      var penas = [
        { c: 1.02, l: 0.3, y: 0.16, giro: 0.1 },
        { c: 0.88, l: 0.26, y: -0.02, giro: -0.04 },
        { c: 0.68, l: 0.22, y: -0.18, giro: -0.2 }
      ];
      penas.forEach(function (p) {
        var pena = extrudar(formaPena(p.c, p.l), matPena);
        pena.position.set(0, p.y, -0.018);
        pena.rotation.z = p.giro;
        asa.add(pena);

        // ponta laranja: a mesma forma, menor, encostada na extremidade
        var ponta = extrudar(formaPena(p.c * 0.34, p.l * 0.62), matPonta);
        ponta.position.set(p.c * 0.64, p.y + p.l * 0.1, 0.006);
        ponta.rotation.z = p.giro - 0.06;
        asa.add(ponta);
      });

      var encaixe = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.09, 24), MAT.cobre);
      encaixe.rotation.x = Math.PI / 2;
      asa.add(encaixe);
      var miolo = new THREE.Mesh(new THREE.CircleGeometry(0.055, 24), matPonta);
      miolo.position.z = 0.05;
      asa.add(miolo);

      asa.position.set(sinal * 0.5, 0.26, -0.2);
      return asa;
    }

    var asaE = construirAsa(-1), asaD = construirAsa(1);
    tronco.add(asaE, asaD);

    // ---------------------------- bracos ------------------------------
    function construirBraco(sinal) {
      var g = new THREE.Group();
      var ombro = new THREE.Mesh(new THREE.SphereGeometry(0.125, 24, 18), MAT.cobre);
      ombro.castShadow = true;
      var superior = new THREE.Mesh(new THREE.CapsuleGeometry(0.088, 0.2, 8, 20), MAT.creme);
      superior.position.y = -0.2;
      superior.castShadow = true;
      var cotovelo = new THREE.Mesh(new THREE.SphereGeometry(0.085, 20, 16), MAT.cobreClaro);
      cotovelo.position.y = -0.34;
      var antebraco = new THREE.Mesh(new THREE.CapsuleGeometry(0.082, 0.16, 8, 20), MAT.creme);
      antebraco.position.y = -0.48;
      antebraco.castShadow = true;
      var mao = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18), MAT.creme);
      mao.position.y = -0.63;
      mao.scale.set(1, 0.92, 1.05);
      mao.castShadow = true;
      g.add(ombro, superior, cotovelo, antebraco, mao);
      g.position.set(sinal * 0.8, 0.12, 0.1);
      g.rotation.z = sinal * -0.34;
      return g;
    }
    var bracoE = construirBraco(-1), bracoD = construirBraco(1);
    tronco.add(bracoE, bracoD);

    // ---------------------------- bolsa -------------------------------
    (function bolsa() {
      var g = new THREE.Group();
      var corpoBolsa = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.4, 0.24), MAT.navy);
      corpoBolsa.castShadow = true;
      g.add(corpoBolsa);

      var tampa = new THREE.Mesh(new THREE.BoxGeometry(0.545, 0.2, 0.26), MAT.navyEscuro);
      tampa.position.y = 0.14;
      g.add(tampa);

      var fivela = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.07, 0.03), MAT.cobreClaro);
      fivela.position.set(0, 0.03, 0.137);
      g.add(fivela);

      var c = document.createElement("canvas");
      c.width = 128; c.height = 96;
      var ctx = c.getContext("2d");
      ctx.clearRect(0, 0, 128, 96);
      ctx.strokeStyle = "#ef8c3a";
      ctx.lineWidth = 7;
      ctx.strokeRect(22, 22, 84, 56);
      ctx.beginPath();
      ctx.moveTo(22, 22); ctx.lineTo(64, 54); ctx.lineTo(106, 22);
      ctx.stroke();
      var emblema = new THREE.Mesh(
        new THREE.PlaneGeometry(0.26, 0.2),
        new THREE.MeshStandardMaterial({
          map: new THREE.CanvasTexture(c), transparent: true,
          roughness: 0.85, metalness: 0
        })
      );
      emblema.position.set(0, -0.04, 0.126);
      g.add(emblema);

      g.position.set(0.72, -0.55, 0.16);
      g.rotation.z = -0.1;
      tronco.add(g);

      var alca = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.035, 10, 60), MAT.navyEscuro);
      alca.position.set(0.04, -0.06, 0.04);
      alca.rotation.set(0.18, 0.06, 0.58);
      alca.castShadow = true;
      tronco.add(alca);
    })();

    // --------------------------- propulsor -----------------------------
    var bocal = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.23, 0.16, 32), MAT.cobre);
    bocal.position.y = -1.1;
    tronco.add(bocal);

    var chamaMat = new THREE.MeshBasicMaterial({
      color: COR.ambar, transparent: true, opacity: 0.75,
      blending: THREE.AdditiveBlending, depthWrite: false
    });
    var chama = new THREE.Mesh(new THREE.ConeGeometry(0.19, 0.5, 24, 1, true), chamaMat);
    chama.position.y = -1.42;
    chama.rotation.x = Math.PI;
    tronco.add(chama);

    var brilhoCanvas = document.createElement("canvas");
    brilhoCanvas.width = brilhoCanvas.height = 128;
    (function () {
      var g = brilhoCanvas.getContext("2d");
      var rad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      rad.addColorStop(0, "rgba(255,255,255,0.95)");
      rad.addColorStop(0.32, "rgba(255,255,255,0.3)");
      rad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = rad;
      g.fillRect(0, 0, 128, 128);
    })();
    var brilhoTex = new THREE.CanvasTexture(brilhoCanvas);

    var haloMat = new THREE.SpriteMaterial({
      map: brilhoTex, color: COR.ambar, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, opacity: 0.8
    });
    var halo = new THREE.Sprite(haloMat);
    halo.scale.setScalar(1.15);
    halo.position.y = -1.3;
    tronco.add(halo);

    // --------------------- envelope na mao (modo entrega) ---------------
    var carta = new THREE.Group();
    (function envelopeFlutuante() {
      var c = document.createElement("canvas");
      c.width = 256; c.height = 176;
      var g = c.getContext("2d");
      g.fillStyle = "#fbf6ee";
      g.fillRect(0, 0, 256, 176);
      for (var i = -176; i < 256; i += 24) {
        g.save();
        g.translate(i, 0); g.rotate(0.7);
        g.fillStyle = "#ef8c3a"; g.fillRect(0, 0, 12, 320);
        g.fillStyle = "#31405f"; g.fillRect(12, 0, 12, 320);
        g.restore();
      }
      g.fillStyle = "#fbf6ee"; g.fillRect(18, 16, 220, 144);
      g.strokeStyle = "#ef8c3a"; g.lineWidth = 6;
      g.strokeRect(46, 44, 164, 88);
      g.beginPath();
      g.moveTo(46, 44); g.lineTo(128, 102); g.lineTo(210, 44);
      g.stroke();
      var m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.46, 0.32),
        new THREE.MeshStandardMaterial({
          map: new THREE.CanvasTexture(c), roughness: 0.85, metalness: 0,
          side: THREE.DoubleSide
        })
      );
      m.castShadow = true;
      carta.add(m);
    })();
    carta.position.set(-1.04, -0.46, 0.5);
    carta.rotation.set(-0.26, 0.44, 0.12);
    briefy.add(carta);

    // --------------- fumaca do modo falha (puffs simples) ---------------
    var fumaca = new THREE.Group();
    var puffs = [];
    for (var k = 0; k < 5; k++) {
      var puff = new THREE.Sprite(new THREE.SpriteMaterial({
        map: brilhoTex, color: COR.fumaca, transparent: true,
        depthWrite: false, opacity: 0
      }));
      puffs.push(puff);
      fumaca.add(puff);
    }
    briefy.add(fumaca);

    // ============================= modos ==============================
    var corRosto = new THREE.Color(COR.ambar);
    var corAlvo = new THREE.Color(COR.ambar);
    var abertura = 1;        // 1 = asas abertas, 0 = recolhidas
    var aberturaAlvo = 1;

    function definirEstado(chave) {
      var e = ESTADOS[chave];
      if (!e) return;
      atual = chave;
      modo = e.modo;
      corAlvo.setHex(modo === "entrega" ? COR.ambar : COR.falha);
      aberturaAlvo = modo === "entrega" ? 1 : 0;
      carta.visible = modo === "entrega";
      fumaca.visible = modo === "falha";

      if (ref.badgeTexto) ref.badgeTexto.textContent = e.rotulo;
      if (ref.led) ref.led.style.setProperty("--cor-estado", "var(" + e.cor + ")");
      esconderBilhete();
    }

    // ============================ bilhete =============================
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

    // =========================== interacao ============================
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

    // ============================== loop ==============================
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
      var suave = Math.min(1, dt * 4);

      corRosto.lerp(corAlvo, suave);
      abertura += (aberturaAlvo - abertura) * suave;

      var corHex = "rgb(" + Math.round(corRosto.r * 255) + "," +
        Math.round(corRosto.g * 255) + "," + Math.round(corRosto.b * 255) + ")";

      if (!semMovimento) {
        var entrega = modo === "entrega";
        var ritmo = entrega ? 1.5 : 0.8;
        var bob = Math.sin(tt * ritmo) * (entrega ? 0.075 : 0.045);
        var altura = bob + (entrega ? 0 : -0.26);

        if (pulo > 0) {
          pulo = Math.max(0, pulo - dt * 1.8);
          altura += Math.sin((1 - pulo) * Math.PI) * 0.42;
        }
        briefy.position.y = altura;
        briefy.rotation.z = Math.sin(tt * 0.72) * 0.02 + (entrega ? 0 : 0.1);

        var resp = 1 + Math.sin(tt * ritmo * 1.6) * 0.011;
        tronco.scale.set(1 / Math.sqrt(resp), resp, 1 / Math.sqrt(resp));

        if (!arrastando) {
          giroAlvo += velocidade;
          velocidade *= 0.93;
          giroAlvo *= 0.986;
        }
        giro += (giroAlvo - giro) * Math.min(1, dt * 7);
        briefy.rotation.y = giro + Math.sin(tt * 0.4) * 0.05;

        var alvoX = arrastando ? 0 : ponteiro.x * 0.28;
        var alvoY = arrastando ? 0 : -ponteiro.y * 0.16;
        if (!entrega) { alvoX *= 0.4; alvoY = 0.2; }
        olhar.x += (alvoX - olhar.x) * Math.min(1, dt * 3.4);
        olhar.y += (alvoY - olhar.y) * Math.min(1, dt * 3.4);
        cranio.position.y = ALTURA_CABECA + Math.sin(tt * ritmo - 0.4) * 0.011;
        cranio.rotation.set(olhar.y, olhar.x, Math.sin(tt * 0.6 - 0.5) * 0.018);

        // asas: batem abertas no modo entrega, recolhem no modo falha
        var batida = entrega ? Math.sin(tt * 2.6) * 0.12 : 0;
        var recolher = 1 - abertura;
        var escala = 0.45 + 0.55 * abertura;
        asaE.rotation.z = -0.1 - batida - recolher * 0.95;
        asaD.rotation.z = 0.1 + batida + recolher * 0.95;
        asaE.rotation.y = Math.PI + recolher * 0.9;
        asaD.rotation.y = -recolher * 0.9;
        asaE.scale.set(escala, 0.5 + 0.5 * abertura, 1);
        asaD.scale.set(escala, 0.5 + 0.5 * abertura, 1);

        // bandeira erguida e tremulando, ou caida
        bandeira.rotation.z = -recolher * 1.5 + Math.sin(tt * 3.4) * 0.1 * abertura;

        var balanco = Math.sin(tt * ritmo - 0.7) * 0.05;
        bracoE.rotation.z = 0.2 + balanco - recolher * 0.18;
        bracoD.rotation.z = -0.2 - balanco + recolher * 0.18;

        // propulsor firme, ou engasgando
        var pulso = entrega
          ? 0.82 + Math.sin(tt * 11) * 0.12
          : Math.max(0, Math.sin(tt * 5.5)) * 0.4;
        chamaMat.color.copy(corRosto);
        chamaMat.opacity = 0.72 * pulso;
        chama.scale.set(0.9 + pulso * 0.25, 0.7 + pulso * 0.6, 0.9 + pulso * 0.25);
        haloMat.color.copy(corRosto);
        haloMat.opacity = 0.65 * pulso;
        halo.scale.setScalar(0.9 + pulso * 0.45);

        piscada = 1;
        if (entrega) {
          if (t > proximaPiscada) {
            var fase = (t - proximaPiscada) / 0.19;
            if (fase < 1) piscada = Math.abs(Math.cos(fase * Math.PI)) * 0.9 + 0.1;
            else proximaPiscada = t + 2.4 + Math.random() * 3.8;
          }
        }

        if (carta.visible) {
          carta.rotation.z = 0.12 + Math.sin(tt * 1.7) * 0.08;
          carta.position.y = -0.42 + Math.sin(tt * 1.7 + 0.6) * 0.04;
        }

        if (fumaca.visible) {
          puffs.forEach(function (p, i) {
            var q = (t * 0.5 + i * 0.2) % 1;
            p.position.set(
              Math.sin(q * 5 + i) * 0.16,
              -1.55 + q * 0.5,
              Math.cos(q * 4 + i) * 0.1
            );
            p.scale.setScalar(0.3 + q * 0.5);
            p.material.opacity = 0.3 * Math.sin(q * Math.PI);
          });
        }

        camera.position.x += (ponteiro.x * 0.24 - camera.position.x) * Math.min(1, dt * 2.2);
        camera.position.y += (0.1 - ponteiro.y * 0.15 - camera.position.y) * Math.min(1, dt * 2.2);
      } else {
        briefy.position.y = 0;
        cranio.position.y = ALTURA_CABECA;
        asaE.rotation.y = Math.PI;
      }
      camera.lookAt(0, -0.05, 0);

      desenharRosto(corHex, olhar.x * 0.8, olhar.y * 0.8, piscada, t);

      renderer.render(cena, camera);
      requestAnimationFrame(quadro);
    }

    cranio.position.y = ALTURA_CABECA;
    asaE.rotation.y = Math.PI;
    definirEstado("entregue");
    quadro();

    var api = {
      definirEstado: definirEstado,
      definirFrases: function (novas) { frases = novas || FRASES_PADRAO; },
      falar: mostrarBilhete
    };
    // Guardado para poder trocar de modo pelo console ao ajustar o visual:
    // Briefy.atual.definirEstado("falhou").
    Briefy.atual = api;
    return api;
  }

  return { criar: criar, ESTADOS: ESTADOS };
})();
