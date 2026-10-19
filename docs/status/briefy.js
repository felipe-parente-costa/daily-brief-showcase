/* Briefy: o carteiro que roda o Daily Brief, em 3D.
 *
 * O modelo (modelos/briefy.glb, 3,9 MB) veio de uma geracao no ChatGPT e foi
 * reduzido de 500 mil para 50 mil triangulos em briefy-3d/reduzir_animado.py,
 * com os morph targets das asas transferidos para a malha nova. O arquivo traz
 * um clipe de 4 s ("Flutuar e bater asas") que faz o corpo flutuar e as asas
 * baterem.
 *
 * Dois modos, como pedido:
 *   "entrega" - preparando ou ja entregue: o clipe toca, asas batendo.
 *   "falha"   - a edicao nao saiu: o clipe para, as asas caem, o corpo
 *               afunda, inclina e apaga um pouco.
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

const MODELO = "modelos/briefy.glb";

const ESTADOS = {
  entregue:    { rotulo: "Entregue",        cor: "--ok",    modo: "entrega" },
  trabalhando: { rotulo: "Rodando",         cor: "--work",  modo: "entrega" },
  dormindo:    { rotulo: "Fora do horario", cor: "--sleep", modo: "entrega" },
  falhou:      { rotulo: "Falhou",          cor: "--bad",   modo: "falha" },
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
  let modo = "entrega";
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

  const raiz = new THREE.Group();
  cena.add(raiz);

  const aviso = document.createElement("p");
  aviso.className = "briefy-aviso";
  aviso.textContent = "carregando o Briefy…";
  palco.appendChild(aviso);

  // ------------------------------------------------------------- modelo
  let malha = null, acao = null, mixer = null;
  const indice = { sobe: 0, desce: 1 };
  const corOriginal = new THREE.Color(1, 1, 1);
  const corAlvo = new THREE.Color(1, 1, 1);

  new GLTFLoader().load(
    MODELO,
    (gltf) => {
      raiz.add(gltf.scene);
      gltf.scene.traverse((o) => {
        if (o.isMesh && o.morphTargetInfluences) {
          malha = o;
          const d = o.morphTargetDictionary || {};
          if (d["Asas sobem"] !== undefined) indice.sobe = d["Asas sobem"];
          if (d["Asas descem"] !== undefined) indice.desce = d["Asas descem"];
        }
      });
      if (gltf.animations.length) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        acao = mixer.clipAction(gltf.animations[0]);
      }
      aviso.remove();
      aplicarModo();
    },
    undefined,
    () => { aviso.textContent = "não consegui carregar o modelo 3D."; }
  );

  function aplicarModo() {
    if (!malha) return;
    if (modo === "entrega" && !semMovimento) {
      if (acao) acao.reset().play();
    } else if (acao) {
      acao.stop();
    }
    if (modo === "falha") {
      malha.morphTargetInfluences[indice.sobe] = 0;
      malha.morphTargetInfluences[indice.desce] = 0.9;   // asas caidas
      corAlvo.setRGB(0.72, 0.62, 0.6);
    } else {
      corAlvo.copy(corOriginal);
    }
  }

  function definirEstado(chaveEstado) {
    const e = ESTADOS[chaveEstado];
    if (!e) return;
    atual = chaveEstado;
    modo = e.modo;
    aplicarModo();
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

    if (mixer && modo === "entrega" && !semMovimento) mixer.update(dt);

    // modo falha: afunda, inclina para frente e balanca devagar
    const falha = modo === "falha";
    const alvoY = falha ? -0.09 + (semMovimento ? 0 : Math.sin(t * 0.8) * 0.01) : 0;
    raiz.position.y += (alvoY - raiz.position.y) * Math.min(1, dt * 3);
    raiz.rotation.x += ((falha ? 0.16 : 0) - raiz.rotation.x) * Math.min(1, dt * 3);
    raiz.rotation.z += ((falha ? 0.07 : 0) - raiz.rotation.z) * Math.min(1, dt * 3);
    if (malha) malha.material.color.lerp(corAlvo, Math.min(1, dt * 3));

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
  // Para trocar de modo pelo console ao ajustar: Briefy.atual.definirEstado("falhou")
  window.Briefy.atual = api;
  return api;
}

window.Briefy = { criar, ESTADOS };
