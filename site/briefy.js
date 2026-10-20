/* Briefy: o carteiro que roda o Daily Brief, em 3D.
 *
 * Dois modelos, os dois gerados no ChatGPT e reduzidos de 500 mil para 50 mil
 * triangulos em briefy-3d/reduzir_animado.py (os morph targets das asas
 * transferidos para a malha nova). Cada um traz um clipe de 4 s que faz o
 * corpo flutuar e as asas baterem.
 *   modelos/briefy.glb         - feliz: a edicao de hoje ja saiu
 *   modelos/briefy-triste.glb  - triste: ainda nao saiu, ou falhou
 *
 * O modelo do estado atual carrega primeiro; o outro so quando for preciso.
 * Se o triste nao carregar, o feliz faz as vezes dele do jeito antigo: asas
 * caidas, corpo afundado e cor apagada.
 *
 * A camera so gira +-45 graus pela frente. As asas sao deformacao de
 * vertice, nao rotacao rigida: de tras, a asa colada nas costas entorta.
 *
 * Uso (a mesma interface de antes, o app.js nao muda):
 *   var b = Briefy.criar({ palco, bilhete, bilheteTexto, led, badgeTexto });
 *   b.definirFrases({ entregue: ["..."] });
 *   b.definirEstado("entregue");
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const MODELOS = { feliz: "modelos/briefy.glb", triste: "modelos/briefy-triste.glb" };
const PES = 0.03;   // altura dos pes em repouso; a camera foi enquadrada assim

// Feliz so quando a edicao de hoje ja saiu; em qualquer outro caso, triste.
const ESTADOS = {
  entregue:    { rotulo: "Entregue",        cor: "--ok",    humor: "feliz" },
  trabalhando: { rotulo: "Rodando",         cor: "--work",  humor: "triste" },
  dormindo:    { rotulo: "Fora do horario", cor: "--sleep", humor: "triste" },
  falhou:      { rotulo: "Falhou",          cor: "--bad",   humor: "triste" },
};

const FRASES_PADRAO = {
  entregue: ["Edição do dia entregue."],
  trabalhando: ["Coletando agora."],
  falhou: ["Hoje não deu. O resgate assume."],
  dormindo: ["Acordo às 07:20."],
};

function criar(ref) {
  const palco = ref.palco;
  if (!palco) return null;

  const semMovimento = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let atual = "entregue";
  let frases = FRASES_PADRAO;

  // ------------------------------------------------------------- cena
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  palco.appendChild(renderer.domElement);

  const cena = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  cena.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const chave = new THREE.DirectionalLight(0xfff2e2, 1.3);
  chave.position.set(2, 3, 2.5);
  cena.add(chave);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
  camera.position.set(0, 0.62, 2.7);

  const orbita = new OrbitControls(camera, renderer.domElement);
  orbita.target.set(0, 0.54, 0);
  orbita.enableDamping = true;
  orbita.enableZoom = false;          // nao sequestrar a rolagem da pagina
  orbita.enablePan = false;
  orbita.minAzimuthAngle = -Math.PI / 4;
  orbita.maxAzimuthAngle = Math.PI / 4;
  orbita.minPolarAngle = Math.PI * 0.32;
  orbita.maxPolarAngle = Math.PI * 0.58;
  // O OrbitControls marca o canvas com touch-action: none, e no celular o
  // palco ocupa a largura toda: quem rolasse com o dedo em cima do Briefy
  // ficava preso. pan-y devolve a rolagem vertical a pagina; o arrasto
  // horizontal continua girando o boneco.
  renderer.domElement.style.touchAction = "pan-y";

  const raiz = new THREE.Group();
  cena.add(raiz);

  const aviso = document.createElement("p");
  aviso.className = "briefy-aviso";
  aviso.textContent = "carregando o Briefy…";
  palco.appendChild(aviso);

  // ------------------------------------------------------------- modelos
  // humor -> promessa de { cena, malha, mixer, acao }, ou de null se falhou
  const pendentes = {};
  let reserva = false;           // feliz imitando o triste (o triste falhou)
  const corOriginal = new THREE.Color(1, 1, 1);
  const corAlvo = new THREE.Color(1, 1, 1);
  const carregador = new GLTFLoader();

  function carregar(humor) {
    if (!pendentes[humor]) {
      pendentes[humor] = new Promise((pronto) => {
        carregador.load(MODELOS[humor], (gltf) => {
          const m = { cena: gltf.scene, malha: null, mixer: null, acao: null, sobe: 0, desce: 1 };
          gltf.scene.traverse((o) => {
            if (o.isMesh && o.morphTargetInfluences) {
              m.malha = o;
              const d = o.morphTargetDictionary || {};
              if (d["Asas sobem"] !== undefined) m.sobe = d["Asas sobem"];
              if (d["Asas descem"] !== undefined) m.desce = d["Asas descem"];
            }
          });
          if (gltf.animations.length) {
            m.mixer = new THREE.AnimationMixer(gltf.scene);
            m.acao = m.mixer.clipAction(gltf.animations[0]);
          }
          // Cada modelo veio com a origem num lugar (o feliz no meio do
          // corpo, o triste nos pes): apoia os pes na mesma altura.
          const caixa = new THREE.Box3().setFromObject(gltf.scene);
          gltf.scene.position.y = PES - caixa.min.y;
          gltf.scene.visible = false;
          raiz.add(gltf.scene);
          pronto(m);
        }, undefined, () => pronto(null));
      });
    }
    return pendentes[humor];
  }

  let visivel = null;            // o modelo que esta na tela

  function aplicarHumor(desejado) {
    carregar(desejado).then((m) => {
      if (desejado !== ESTADOS[atual].humor) return;   // estado mudou no meio
      if (!m && desejado === "triste") {
        // sem o modelo triste: o feliz assume, com asas caidas e cor apagada
        return carregar("feliz").then((f) => mostrar(f, true));
      }
      mostrar(m, false);
    });
  }

  function mostrar(m, comoReserva) {
    if (!m) { aviso.textContent = "não consegui carregar o modelo 3D."; return; }
    aviso.remove();
    if (visivel && visivel !== m) {
      visivel.cena.visible = false;
      if (visivel.acao) visivel.acao.stop();
    }
    visivel = m;
    reserva = comoReserva;
    m.cena.visible = true;
    if (m.acao) {
      if (!reserva && !semMovimento) m.acao.reset().play();
      else m.acao.stop();
    }
    if (m.malha) {
      if (reserva) {
        m.malha.morphTargetInfluences[m.sobe] = 0;
        m.malha.morphTargetInfluences[m.desce] = 0.9;   // asas caidas
        corAlvo.setRGB(0.72, 0.62, 0.6);
      } else {
        m.malha.morphTargetInfluences[m.desce] = 0;
        corAlvo.copy(corOriginal);
      }
    }
  }

  function definirEstado(chaveEstado) {
    const e = ESTADOS[chaveEstado];
    if (!e) return;
    atual = chaveEstado;
    aplicarHumor(e.humor);
    if (ref.badgeTexto) ref.badgeTexto.textContent = e.rotulo;
    if (ref.led) ref.led.style.setProperty("--cor-estado", `var(${e.cor})`);
    esconderBilhete();
  }

  // ------------------------------------------------------------- bilhete
  let timerBilhete = null;
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

  // clique sem arrastar = falar; arrastar = girar (OrbitControls)
  let inicioToque = null;
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    inicioToque = { x: ev.clientX, y: ev.clientY };
  });
  renderer.domElement.addEventListener("pointerup", (ev) => {
    if (!inicioToque) return;
    const andou = Math.hypot(ev.clientX - inicioToque.x, ev.clientY - inicioToque.y);
    inicioToque = null;
    if (andou > 5) return;
    const lista = frases[atual] || FRASES_PADRAO[atual] || [];
    if (lista.length) mostrarBilhete(lista[Math.floor(Math.random() * lista.length)]);
  });

  // ------------------------------------------------------------- loop
  function dimensionar() {
    const l = palco.clientWidth, a = palco.clientHeight;
    if (!l || !a) return;
    renderer.setSize(l, a, false);
    camera.aspect = l / a;
    camera.updateProjectionMatrix();
  }
  dimensionar();
  new ResizeObserver(dimensionar).observe(palco);

  const relogio = new THREE.Clock();
  function quadro() {
    const dt = Math.min(relogio.getDelta(), 0.05);
    const t = relogio.elapsedTime;

    if (visivel && visivel.mixer && !reserva && !semMovimento) visivel.mixer.update(dt);

    // so na reserva (sem o modelo triste): afunda, inclina e balanca devagar
    const falha = reserva;
    const alvoY = falha ? -0.09 + (semMovimento ? 0 : Math.sin(t * 0.8) * 0.01) : 0;
    raiz.position.y += (alvoY - raiz.position.y) * Math.min(1, dt * 3);
    raiz.rotation.x += ((falha ? 0.16 : 0) - raiz.rotation.x) * Math.min(1, dt * 3);
    raiz.rotation.z += ((falha ? 0.07 : 0) - raiz.rotation.z) * Math.min(1, dt * 3);
    if (visivel && visivel.malha) visivel.malha.material.color.lerp(corAlvo, Math.min(1, dt * 3));

    orbita.update();
    renderer.render(cena, camera);
    requestAnimationFrame(quadro);
  }
  quadro();

  const api = {
    definirEstado,
    definirFrases(novas) { frases = novas || FRASES_PADRAO; },
    falar: mostrarBilhete,
  };
  // Para trocar de humor pelo console ao ajustar: Briefy.atual.definirEstado("falhou")
  window.Briefy.atual = api;
  return api;
}

window.Briefy = { criar, ESTADOS };
