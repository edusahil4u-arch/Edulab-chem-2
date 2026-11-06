import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { ELEMENTS } from '../chem/elements';
import type { AtomNode, BondEdge, ElementSymbol, MoleculeGraph, MoleculeMetrics } from '../chem/types';
import { createProceduralTextures, type ProceduralTextureSet } from './textures';

export type RepresentationMode = 'ball_stick' | 'space_filling' | 'wireframe';
export type MotionMode = 'static' | 'spin' | 'vibrate';
export type StageTheme = 'light' | 'dark';
export type CameraPreset = 'iso' | 'top' | 'front' | 'reset';

export interface StageOptions {
  representation: RepresentationMode;
  explodedFactor: number; // 1.0 to 1.8
  motionMode: MotionMode;
  showOrbitals: boolean;
  showElectronShell: boolean;
  stageTheme: StageTheme;
  selectedAtomId: string | null;
  hoveredAtomId: string | null;
}

// Pre-allocated scratch math helpers (zero GC inside render loop)
const _vec3A = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _vec3D = new THREE.Vector3();
const _vec3Mid = new THREE.Vector3();
const _vec3Dir = new THREE.Vector3();
const _vec3Perp = new THREE.Vector3();
const _vec3Perp2 = new THREE.Vector3();
const _quatA = new THREE.Quaternion();
const _upVec = new THREE.Vector3(0, 1, 0);

interface AtomRig {
  atomId: string;
  element: ElementSymbol;
  group: THREE.Group;
  coreMesh: THREE.Mesh;
  collarMesh: THREE.Mesh;
  reticleGroup: THREE.Group;
  lobeGroup: THREE.Group | null;
  shellMesh: THREE.Mesh | null;
  hitProxy: THREE.Mesh;
  currentPos: THREE.Vector3;
  targetPos: THREE.Vector3;
  baseRadius: number;
  vdwRadius: number;
}

interface BondRig {
  bond: BondEdge;
  group: THREE.Group;
}

export class MolecularStage {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private isSoftwareGl: boolean;
  private textures: ProceduralTextureSet;
  private envRenderTarget: THREE.WebGLRenderTarget;

  private rootGroup: THREE.Group;
  private moleculeGroup: THREE.Group;
  private floorMesh: THREE.Mesh;
  private moleculeShadowDisc: THREE.Mesh;
  private hemiLight: THREE.HemisphereLight;
  private keyLight: THREE.DirectionalLight;

  private atomRigs = new Map<string, AtomRig>();
  private bondRigs: BondRig[] = [];
  private hitTargets: THREE.Mesh[] = [];
  private disposableGeometries: THREE.BufferGeometry[] = [];
  private disposableMaterials: THREE.Material[] = [];

  private currentMolecule: MoleculeGraph | null = null;
  private currentMetrics: MoleculeMetrics | null = null;
  private options: StageOptions = {
    representation: 'ball_stick',
    explodedFactor: 1.0,
    motionMode: 'static',
    showOrbitals: false,
    showElectronShell: false,
    stageTheme: 'light',
    selectedAtomId: null,
    hoveredAtomId: null,
  };

  private currentExploded = 1.0;
  private cameraTargetPos: THREE.Vector3 | null = null;
  private cameraTargetLook: THREE.Vector3 | null = null;

  private rafId = 0;
  private timeoutId = 0;
  private lastWidth = 0;
  private lastHeight = 0;
  private renderBusy = false;
  private renderDirty = false;
  private continuousActive = false;
  private lastTickTime = performance.now();
  private elapsedSimTime = 0;
  private disposed = false;

  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private pointerDownClient = { x: 0, y: 0 };
  private lastHoverRaycast = 0;

  private onSelectAtom?: (atomId: string | null) => void;
  private onHoverAtom?: (atomId: string | null) => void;

  constructor(
    container: HTMLElement,
    callbacks: {
      onSelectAtom?: (atomId: string | null) => void;
      onHoverAtom?: (atomId: string | null) => void;
    }
  ) {
    this.container = container;
    this.onSelectAtom = callbacks.onSelectAtom;
    this.onHoverAtom = callbacks.onHoverAtom;

    // 1. Software WebGL Detection via GPU renderer string
    this.isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    const width = Math.max(300, container.clientWidth || window.innerWidth);
    const height = Math.max(240, container.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.lastWidth = width;
    this.lastHeight = height;
    this.renderer.setSize(width, height);
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.setAttribute('data-testid', 'molecule-3d-canvas');
    container.appendChild(this.renderer.domElement);

    // 2. Scene, Fog & Studio RoomEnvironment
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xeef3f8);
    this.scene.fog = new THREE.FogExp2(0xeef3f8, 0.024);

    const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
    this.envRenderTarget = pmremGenerator.fromScene(
      new RoomEnvironment(),
      0.04
    );
    this.scene.environment = this.envRenderTarget.texture;
    pmremGenerator.dispose();

    // 3. Camera & OrbitControls
    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 150);
    this.camera.position.set(7.8, 5.1, 11.2);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = !this.isSoftwareGl;
    this.controls.dampingFactor = 0.06;
    this.controls.minDistance = 2.4;
    this.controls.maxDistance = 28;
    this.controls.maxPolarAngle = Math.PI * 0.485;
    this.controls.target.set(0, 1.85, 0);

    this.controls.addEventListener('start', () => {
      // Cancel any scripted camera transition immediately when user grabs camera
      this.cameraTargetPos = null;
      this.cameraTargetLook = null;
    });

    this.controls.addEventListener('change', () => {
      if (!this.continuousActive) {
        this.requestRender();
      }
    });

    // 4. Procedural Textures & Studio 3-Point + Softbox Lighting Rig
    this.textures = createProceduralTextures(this.renderer);

    this.hemiLight = new THREE.HemisphereLight(0xe0f2fe, 0xcbd5e1, 0.72);
    this.hemiLight.position.set(0, 20, 0);
    this.scene.add(this.hemiLight);

    this.keyLight = new THREE.DirectionalLight(0xfff7ed, 1.85);
    this.keyLight.position.set(6.5, 11.5, 7.5);
    this.keyLight.target.position.set(0, 2.0, 0);
    this.scene.add(this.keyLight.target);
    if (!this.isSoftwareGl) {
      this.keyLight.castShadow = true;
      this.keyLight.shadow.mapSize.width = 1024;
      this.keyLight.shadow.mapSize.height = 1024;
      this.keyLight.shadow.camera.near = 1;
      this.keyLight.shadow.camera.far = 28;
      const d = 7.5;
      this.keyLight.shadow.camera.left = -d;
      this.keyLight.shadow.camera.right = d;
      this.keyLight.shadow.camera.top = d;
      this.keyLight.shadow.camera.bottom = -d;
      this.keyLight.shadow.bias = -0.0005;
      this.keyLight.shadow.normalBias = 0.02;
    }
    this.scene.add(this.keyLight);

    const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.9);
    rimLight.position.set(-7.0, 5.5, -6.5);
    this.scene.add(rimLight);

    if (!this.isSoftwareGl) {
      RectAreaLightUniformsLib.init();
      const softbox = new THREE.RectAreaLight(0xffffff, 2.2, 6, 3);
      softbox.position.set(-4.5, 6.5, 4.5);
      softbox.lookAt(0, 2.3, 0);
      this.scene.add(softbox);
    }

    // 5. Laboratory Floor & Molecule Floating Stage
    this.rootGroup = new THREE.Group();
    this.scene.add(this.rootGroup);

    const floorGeo = new THREE.PlaneGeometry(80, 80, 1, 1);
    const floorMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: this.textures.labFloorMap,
      roughness: 0.78,
      metalness: 0.05,
    });
    this.floorMesh = new THREE.Mesh(floorGeo, floorMat);
    this.floorMesh.rotation.x = -Math.PI / 2;
    this.floorMesh.position.y = 0;
    this.floorMesh.receiveShadow = !this.isSoftwareGl;
    this.rootGroup.add(this.floorMesh);

    // Soft radial contact shadow on laboratory floor beneath the 3D molecule
    const molShadowGeo = new THREE.CircleGeometry(2.35, 40);
    const molShadowMat = new THREE.MeshBasicMaterial({
      map: this.textures.contactShadowMap,
      transparent: true,
      depthWrite: false,
      opacity: 0.34,
    });
    this.moleculeShadowDisc = new THREE.Mesh(molShadowGeo, molShadowMat);
    this.moleculeShadowDisc.rotation.x = -Math.PI / 2;
    this.moleculeShadowDisc.position.y = 0.015;
    this.rootGroup.add(this.moleculeShadowDisc);

    this.moleculeGroup = new THREE.Group();
    this.moleculeGroup.position.set(0, 1.95, 0);
    this.rootGroup.add(this.moleculeGroup);

    // Layer 1 is dedicated to fast raycasting against atom hit proxies
    this.raycaster.layers.set(1);

    this.bindEvents();

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.requestRender();
  }

  /**
   * Updates the 3D molecular assembly when the drawn 2D/3D graph changes.
   */
  public setMolecule(molecule: MoleculeGraph, metrics: MoleculeMetrics) {
    this.currentMolecule = molecule;
    this.currentMetrics = metrics;
    this.rebuildMoleculeMeshes();
    this.requestRender();
  }

  public setOptions(partial: Partial<StageOptions>) {
    const prevRep = this.options.representation;
    const prevOrbitals = this.options.showOrbitals;
    const prevShell = this.options.showElectronShell;
    const prevTheme = this.options.stageTheme;
    const prevMotion = this.options.motionMode;

    this.options = { ...this.options, ...partial };

    if (prevTheme !== this.options.stageTheme) {
      this.applyStageTheme(this.options.stageTheme);
    }

    if (
      prevRep !== this.options.representation ||
      prevOrbitals !== this.options.showOrbitals ||
      prevShell !== this.options.showElectronShell
    ) {
      this.rebuildMoleculeMeshes();
    } else {
      this.updateAtomHighlightStates();
    }

    const needsContinuous =
      this.options.motionMode !== 'static' ||
      Math.abs(this.currentExploded - this.options.explodedFactor) > 0.005 ||
      this.cameraTargetPos !== null;

    if (needsContinuous && !this.continuousActive) {
      this.startContinuousLoop();
    } else if (!needsContinuous && prevMotion !== 'static') {
      this.continuousActive = false;
      this.requestRender();
    } else {
      this.requestRender();
    }
  }

  public setCameraPreset(preset: CameraPreset) {
    const target = new THREE.Vector3(0, 1.85, 0);
    if (preset === 'top') {
      this.cameraTargetPos = new THREE.Vector3(0.01, 12.8, 0.01);
    } else if (preset === 'front') {
      this.cameraTargetPos = new THREE.Vector3(0, 2.35, 11.8);
    } else {
      // 'iso' or 'reset'
      this.cameraTargetPos = new THREE.Vector3(7.8, 5.1, 11.2);
      if (preset === 'reset') {
        this.moleculeGroup.rotation.set(0, 0, 0);
      }
    }
    this.cameraTargetLook = target;

    if (this.isSoftwareGl) {
      // Snap cleanly on software GL if static, or let requestRender advance
      this.camera.position.copy(this.cameraTargetPos);
      this.controls.target.copy(this.cameraTargetLook);
      this.cameraTargetPos = null;
      this.cameraTargetLook = null;
      this.controls.update();
      this.requestRender();
    } else if (!this.continuousActive) {
      this.startContinuousLoop();
    }
  }

  public captureSnapshotDataUrl(): string {
    // Render synchronously right before toDataURL per threejs skill requirement
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  private applyStageTheme(theme: StageTheme) {
    if (theme === 'dark') {
      const bg = 0x0b1120;
      (this.scene.background as THREE.Color).setHex(bg);
      (this.scene.fog as THREE.FogExp2).color.setHex(bg);
      this.hemiLight.color.setHex(0x93c5fd);
      this.hemiLight.groundColor.setHex(0x0f172a);
      this.hemiLight.intensity = 0.62;
      (this.floorMesh.material as THREE.MeshStandardMaterial).color.setHex(0x1e293b);
    } else {
      const bg = 0xeef3f8;
      (this.scene.background as THREE.Color).setHex(bg);
      (this.scene.fog as THREE.FogExp2).color.setHex(bg);
      this.hemiLight.color.setHex(0xe0f2fe);
      this.hemiLight.groundColor.setHex(0xcbd5e1);
      this.hemiLight.intensity = 0.72;
      (this.floorMesh.material as THREE.MeshStandardMaterial).color.setHex(0xffffff);
    }
  }

  private disposeMoleculeResources() {
    while (this.moleculeGroup.children.length > 0) {
      this.moleculeGroup.remove(this.moleculeGroup.children[0]);
    }
    for (const g of this.disposableGeometries) {
      g.dispose();
    }
    for (const m of this.disposableMaterials) {
      m.dispose();
    }
    this.disposableGeometries = [];
    this.disposableMaterials = [];
    this.atomRigs.clear();
    this.bondRigs = [];
    this.hitTargets = [];
  }

  private rebuildMoleculeMeshes() {
    const prevPositions = new Map<string, THREE.Vector3>();
    for (const [id, rig] of this.atomRigs.entries()) {
      prevPositions.set(id, rig.currentPos.clone());
    }

    this.disposeMoleculeResources();
    const mol = this.currentMolecule;
    if (!mol || mol.atoms.length === 0) return;

    const rep = this.options.representation;
    const isWireframe = rep === 'wireframe';
    const isSpaceFilling = rep === 'space_filling';

    // Shared geometries for composite atom & bond parts
    const unitSphereGeo = new THREE.SphereGeometry(1, 32, 24);
    const unitCollarGeo = new THREE.TorusGeometry(1.14, 0.055, 12, 36);
    const unitReticleGeo = new THREE.TorusGeometry(1.38, 0.045, 10, 40);
    const unitCylGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1);
    const unitFerruleGeo = new THREE.CylinderGeometry(1.28, 1.38, 0.09, 20, 1);
    const unitPiRingGeo = new THREE.TorusGeometry(0.18, 0.022, 10, 28);
    this.disposableGeometries.push(
      unitSphereGeo,
      unitCollarGeo,
      unitReticleGeo,
      unitCylGeo,
      unitFerruleGeo,
      unitPiRingGeo
    );

    // Lone pair teardrop geometry via LatheGeometry
    const lobePoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.12, 0.14),
      new THREE.Vector2(0.22, 0.34),
      new THREE.Vector2(0.19, 0.52),
      new THREE.Vector2(0.0, 0.62),
    ];
    const lobeGeo = new THREE.LatheGeometry(lobePoints, 20);
    this.disposableGeometries.push(lobeGeo);

    const collarMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.82,
      roughness: 0.22,
    });
    const ferruleMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      metalness: 0.86,
      roughness: 0.18,
    });
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x0284c7,
    });
    const lobeMat = new THREE.MeshPhysicalMaterial({
      color: 0x38bdf8,
      metalness: 0.05,
      roughness: 0.15,
      clearcoat: 0.9,
      transparent: true,
      opacity: 0.44,
      depthWrite: false,
    });
    const electronShellMat = new THREE.MeshPhysicalMaterial({
      color: 0x60a5fa,
      metalness: 0.0,
      roughness: 0.25,
      transparent: true,
      opacity: 0.2,
      depthWrite: false,
    });
    electronShellMat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `
        #include <begin_vertex>
        transformed += normal * (sin(position.x * 5.0 + position.y * 5.0) * 0.025);
        `
      );
    };

    this.disposableMaterials.push(
      collarMat,
      ferruleMat,
      reticleMat,
      lobeMat,
      electronShellMat
    );

    // Per-element PBR materials cache
    const elementMatCache = new Map<ElementSymbol, THREE.MeshPhysicalMaterial>();
    const getElementMat = (el: ElementSymbol) => {
      if (!elementMatCache.has(el)) {
        const spec = ELEMENTS[el] ?? ELEMENTS.C;
        const mat = new THREE.MeshPhysicalMaterial({
          color: new THREE.Color(spec.cpkColor),
          roughness: spec.roughness,
          metalness: spec.metalness,
          roughnessMap: this.textures.brushedRoughnessMap,
          clearcoat: 0.65,
          clearcoatRoughness: 0.18,
        });
        elementMatCache.set(el, mat);
        this.disposableMaterials.push(mat);
      }
      return elementMatCache.get(el)!;
    };

    // Build Composite Multi-Part Atom Groups
    let maxRadiusFromCenter = 1.2;
    for (const atom of mol.atoms) {
      const spec = ELEMENTS[atom.element] ?? ELEMENTS.C;
      const analysis = this.currentMetrics?.atomAnalyses[atom.id];
      const baseRadius = isSpaceFilling
        ? spec.vdwRadius * 0.82
        : isWireframe
        ? 0.16
        : Math.max(0.24, spec.covalentRadius * 0.46);

      const group = new THREE.Group();
      const targetPos = new THREE.Vector3(atom.x3d, atom.y3d, atom.z3d);
      const prev = prevPositions.get(atom.id);
      const currentPos = prev ? prev.clone() : targetPos.clone();
      group.position.copy(currentPos);

      const distXZ = Math.hypot(atom.x3d, atom.z3d) + baseRadius;
      if (distXZ > maxRadiusFromCenter) maxRadiusFromCenter = distXZ;

      // Part 1: Primary atomic shell
      const coreMesh = new THREE.Mesh(unitSphereGeo, getElementMat(atom.element));
      coreMesh.scale.setScalar(baseRadius);
      coreMesh.castShadow = !this.isSoftwareGl;
      coreMesh.receiveShadow = !this.isSoftwareGl;
      group.add(coreMesh);

      // Part 2: Equatorial hybridization collar ring
      const collarMesh = new THREE.Mesh(unitCollarGeo, collarMat);
      collarMesh.scale.setScalar(baseRadius);
      if (analysis?.hybridization === 'sp2') {
        collarMesh.rotation.x = Math.PI / 2;
      } else if (analysis?.hybridization === 'sp') {
        collarMesh.rotation.y = Math.PI / 2;
      } else {
        collarMesh.rotation.set(Math.PI / 4, Math.PI / 4, 0);
      }
      collarMesh.visible = !isSpaceFilling && !isWireframe;
      group.add(collarMesh);

      // Part 3: Selection / Hover reticle halo
      const reticleGroup = new THREE.Group();
      const reticleRing = new THREE.Mesh(unitReticleGeo, reticleMat);
      reticleRing.scale.setScalar(baseRadius);
      reticleGroup.add(reticleRing);
      reticleGroup.visible = false;
      group.add(reticleGroup);

      // Part 4: Lone-pair / orbital lobes when enabled
      let lobeGroup: THREE.Group | null = null;
      if (this.options.showOrbitals && analysis && analysis.lonePairs > 0) {
        lobeGroup = new THREE.Group();
        for (let lp = 0; lp < Math.min(3, analysis.lonePairs); lp++) {
          const lobe = new THREE.Mesh(lobeGeo, lobeMat);
          const angle = (lp * Math.PI * 2) / Math.max(1, analysis.lonePairs);
          lobe.rotation.set(Math.PI / 3, angle, 0);
          lobe.position.set(
            Math.sin(angle) * baseRadius * 0.7,
            baseRadius * 0.65,
            Math.cos(angle) * baseRadius * 0.7
          );
          lobeGroup.add(lobe);
        }
        group.add(lobeGroup);
      }

      // Part 5: Translucent electron density envelope
      let shellMesh: THREE.Mesh | null = null;
      if (this.options.showElectronShell) {
        shellMesh = new THREE.Mesh(unitSphereGeo, electronShellMat);
        shellMesh.scale.setScalar(spec.vdwRadius * 0.92);
        shellMesh.renderOrder = 6;
        group.add(shellMesh);
      }

      // Invisible raycast hit proxy on Layer 1
      const hitProxy = new THREE.Mesh(
        unitSphereGeo,
        new THREE.MeshBasicMaterial({ visible: false })
      );
      this.disposableMaterials.push(hitProxy.material as THREE.Material);
      hitProxy.scale.setScalar(Math.max(0.45, baseRadius * 1.25));
      hitProxy.layers.set(1);
      hitProxy.userData.atomId = atom.id;
      group.add(hitProxy);
      this.hitTargets.push(hitProxy);

      this.moleculeGroup.add(group);
      this.atomRigs.set(atom.id, {
        atomId: atom.id,
        element: atom.element,
        group,
        coreMesh,
        collarMesh,
        reticleGroup,
        lobeGroup,
        shellMesh,
        hitProxy,
        currentPos,
        targetPos,
        baseRadius,
        vdwRadius: spec.vdwRadius,
      });
    }

    // Build Composite Multi-Part Covalent Bond Groups
    for (const bond of mol.bonds) {
      const rigA = this.atomRigs.get(bond.from);
      const rigB = this.atomRigs.get(bond.to);
      if (!rigA || !rigB) continue;

      const bondGroup = new THREE.Group();
      const matA = getElementMat(rigA.element);
      const matB = getElementMat(rigB.element);

      const stickRadius = isWireframe ? 0.055 : bond.order === 1 ? 0.095 : 0.068;

      if (bond.order === 1 || isWireframe) {
        // Two half-cylinders colored by each atom + two machined metallic junction ferrules
        const halfA = new THREE.Mesh(unitCylGeo, matA);
        halfA.name = 'halfA';
        halfA.castShadow = !this.isSoftwareGl;
        bondGroup.add(halfA);

        const halfB = new THREE.Mesh(unitCylGeo, matB);
        halfB.name = 'halfB';
        halfB.castShadow = !this.isSoftwareGl;
        bondGroup.add(halfB);

        if (!isWireframe) {
          const ferA = new THREE.Mesh(unitFerruleGeo, ferruleMat);
          ferA.name = 'ferA';
          ferA.scale.set(stickRadius, 1, stickRadius);
          bondGroup.add(ferA);

          const ferB = new THREE.Mesh(unitFerruleGeo, ferruleMat);
          ferB.name = 'ferB';
          ferB.scale.set(stickRadius, 1, stickRadius);
          bondGroup.add(ferB);
        }
      } else if (bond.order === 2) {
        // Parallel sigma + pi rods + central pi-cloud collar ring
        for (let strand = 0; strand < 2; strand++) {
          const hA = new THREE.Mesh(unitCylGeo, matA);
          hA.name = `doubleA_${strand}`;
          hA.castShadow = !this.isSoftwareGl;
          bondGroup.add(hA);

          const hB = new THREE.Mesh(unitCylGeo, matB);
          hB.name = `doubleB_${strand}`;
          hB.castShadow = !this.isSoftwareGl;
          bondGroup.add(hB);
        }
        const piRing = new THREE.Mesh(unitPiRingGeo, ferruleMat);
        piRing.name = 'piRing';
        piRing.rotation.x = Math.PI / 2;
        bondGroup.add(piRing);
      } else {
        // Triple bond: tri-axial cylinder bundle + dual stabilizing collar rings
        for (let strand = 0; strand < 3; strand++) {
          const hA = new THREE.Mesh(unitCylGeo, matA);
          hA.name = `tripleA_${strand}`;
          hA.castShadow = !this.isSoftwareGl;
          bondGroup.add(hA);

          const hB = new THREE.Mesh(unitCylGeo, matB);
          hB.name = `tripleB_${strand}`;
          hB.castShadow = !this.isSoftwareGl;
          bondGroup.add(hB);
        }
        const ring1 = new THREE.Mesh(unitPiRingGeo, ferruleMat);
        ring1.name = 'tripleRing1';
        ring1.rotation.x = Math.PI / 2;
        bondGroup.add(ring1);

        const ring2 = new THREE.Mesh(unitPiRingGeo, ferruleMat);
        ring2.name = 'tripleRing2';
        ring2.rotation.x = Math.PI / 2;
        bondGroup.add(ring2);
      }

      bondGroup.visible = !isSpaceFilling;
      this.moleculeGroup.add(bondGroup);
      this.bondRigs.push({ bond, group: bondGroup });
    }

    // Scale contact shadow disc beneath molecule to match molecular footprint
    const shadowScale = Math.max(0.75, Math.min(1.5, maxRadiusFromCenter / 2.2));
    this.moleculeShadowDisc.scale.setScalar(shadowScale);

    this.updateAtomHighlightStates();
    this.updateBondTransforms();
  }

  private updateAtomHighlightStates() {
    for (const [id, rig] of this.atomRigs.entries()) {
      const isSelected = id === this.options.selectedAtomId;
      const isHovered = id === this.options.hoveredAtomId;
      rig.reticleGroup.visible = isSelected || isHovered;
      const pulseScale = isSelected ? 1.12 : isHovered ? 1.05 : 1.0;
      rig.coreMesh.scale.setScalar(rig.baseRadius * pulseScale);
    }
  }

  /**
   * Aligns all multi-part covalent bond assemblies between current atom positions (zero GC).
   */
  private updateBondTransforms() {
    const rep = this.options.representation;
    if (rep === 'space_filling') return;

    const isWireframe = rep === 'wireframe';
    const exp = this.currentExploded;

    for (const { bond, group } of this.bondRigs) {
      const rigA = this.atomRigs.get(bond.from);
      const rigB = this.atomRigs.get(bond.to);
      if (!rigA || !rigB) continue;

      _vec3A.copy(rigA.currentPos).multiplyScalar(exp);
      _vec3B.copy(rigB.currentPos).multiplyScalar(exp);

      _vec3Dir.subVectors(_vec3B, _vec3A);
      const len = _vec3Dir.length();
      if (len < 0.001) {
        group.visible = false;
        continue;
      }
      group.visible = true;

      _vec3Mid.addVectors(_vec3A, _vec3B).multiplyScalar(0.5);
      group.position.copy(_vec3Mid);

      _vec3Dir.divideScalar(len);
      _quatA.setFromUnitVectors(_upVec, _vec3Dir);
      group.quaternion.copy(_quatA);

      const halfLen = len * 0.5;
      const stickRadius = isWireframe ? 0.055 : bond.order === 1 ? 0.095 : 0.064;

      if (bond.order === 1 || isWireframe) {
        const halfA = group.getObjectByName('halfA') as THREE.Mesh | undefined;
        const halfB = group.getObjectByName('halfB') as THREE.Mesh | undefined;
        if (halfA && halfB) {
          halfA.scale.set(stickRadius, halfLen, stickRadius);
          halfA.position.set(0, -halfLen * 0.5, 0);
          halfB.scale.set(stickRadius, halfLen, stickRadius);
          halfB.position.set(0, halfLen * 0.5, 0);
        }
        const ferA = group.getObjectByName('ferA') as THREE.Mesh | undefined;
        const ferB = group.getObjectByName('ferB') as THREE.Mesh | undefined;
        if (ferA && ferB) {
          const offsetA = Math.min(halfLen * 0.65, rigA.baseRadius * 0.92);
          const offsetB = Math.min(halfLen * 0.65, rigB.baseRadius * 0.92);
          ferA.position.set(0, -halfLen + offsetA, 0);
          ferB.position.set(0, halfLen - offsetB, 0);
        }
      } else if (bond.order === 2) {
        const sep = 0.105;
        for (let s = 0; s < 2; s++) {
          const xOff = s === 0 ? -sep : sep;
          const hA = group.getObjectByName(`doubleA_${s}`) as THREE.Mesh | undefined;
          const hB = group.getObjectByName(`doubleB_${s}`) as THREE.Mesh | undefined;
          if (hA && hB) {
            hA.scale.set(stickRadius, halfLen, stickRadius);
            hA.position.set(xOff, -halfLen * 0.5, 0);
            hB.scale.set(stickRadius, halfLen, stickRadius);
            hB.position.set(xOff, halfLen * 0.5, 0);
          }
        }
        const piRing = group.getObjectByName('piRing') as THREE.Mesh | undefined;
        if (piRing) {
          piRing.position.set(0, 0, 0);
        }
      } else {
        const rTri = 0.115;
        for (let s = 0; s < 3; s++) {
          const ang = (s * Math.PI * 2) / 3;
          const xOff = Math.cos(ang) * rTri;
          const zOff = Math.sin(ang) * rTri;
          const hA = group.getObjectByName(`tripleA_${s}`) as THREE.Mesh | undefined;
          const hB = group.getObjectByName(`tripleB_${s}`) as THREE.Mesh | undefined;
          if (hA && hB) {
            hA.scale.set(stickRadius * 0.88, halfLen, stickRadius * 0.88);
            hA.position.set(xOff, -halfLen * 0.5, zOff);
            hB.scale.set(stickRadius * 0.88, halfLen, stickRadius * 0.88);
            hB.position.set(xOff, halfLen * 0.5, zOff);
          }
        }
        const r1 = group.getObjectByName('tripleRing1') as THREE.Mesh | undefined;
        const r2 = group.getObjectByName('tripleRing2') as THREE.Mesh | undefined;
        if (r1 && r2) {
          r1.position.set(0, -halfLen * 0.35, 0);
          r2.position.set(0, halfLen * 0.35, 0);
        }
      }
    }
  }

  private bindEvents() {
    const dom = this.renderer.domElement;

    const onPointerDown = (e: PointerEvent) => {
      this.pointerDownClient.x = e.clientX;
      this.pointerDownClient.y = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      const dist = Math.hypot(
        e.clientX - this.pointerDownClient.x,
        e.clientY - this.pointerDownClient.y
      );
      if (dist > 6) return; // User was orbiting, not clicking an atom

      const rect = dom.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObjects(this.hitTargets, false);
      if (hits.length > 0) {
        const atomId = hits[0].object.userData.atomId as string;
        this.onSelectAtom?.(atomId);
      } else {
        this.onSelectAtom?.(null);
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      const now = performance.now();
      if (now - this.lastHoverRaycast < 50) return;
      this.lastHoverRaycast = now;

      const rect = dom.getBoundingClientRect();
      this.pointerNdc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      this.pointerNdc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.raycaster.setFromCamera(this.pointerNdc, this.camera);
      const hits = this.raycaster.intersectObjects(this.hitTargets, false);
      const hitId =
        hits.length > 0 ? (hits[0].object.userData.atomId as string) : null;
      dom.style.cursor = hitId ? 'pointer' : 'grab';
      if (hitId !== this.options.hoveredAtomId) {
        this.onHoverAtom?.(hitId);
      }
    };

    const onResize = () => {
      if (this.disposed) return;
      const w = Math.max(300, this.container.clientWidth);
      const h = Math.max(240, this.container.clientHeight);
      if (w === this.lastWidth && h === this.lastHeight) {
        return;
      }
      this.lastWidth = w;
      this.lastHeight = h;
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      this.requestRender();
    };

    dom.addEventListener('pointerdown', onPointerDown);
    dom.addEventListener('pointerup', onPointerUp);
    dom.addEventListener('pointermove', onPointerMove);
    window.addEventListener('resize', onResize);

    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(this.container);

    this.cleanupListeners = () => {
      dom.removeEventListener('pointerdown', onPointerDown);
      dom.removeEventListener('pointerup', onPointerUp);
      dom.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);
      resizeObserver.disconnect();
    };
  }

  private cleanupListeners: () => void = () => {};

  /**
   * Coalesced on-demand render with software-WebGL afterDraw() pacing.
   */
  public requestRender() {
    if (this.disposed || this.continuousActive) return;
    if (this.renderBusy) {
      this.renderDirty = true;
      return;
    }
    this.renderBusy = true;
    this.rafId = requestAnimationFrame(() => {
      if (this.disposed) return;
      this.renderDirty = false;
      this.stepSimulation(0.016);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      const done = () => {
        this.renderBusy = false;
        if (this.renderDirty && !this.disposed) {
          this.requestRender();
        }
      };
      if (this.isSoftwareGl) {
        this.afterDraw(done);
      } else {
        done();
      }
    });
  }

  private startContinuousLoop() {
    if (this.disposed || this.continuousActive) return;
    this.continuousActive = true;
    this.lastTickTime = performance.now();

    const tick = () => {
      if (this.disposed || !this.continuousActive) return;
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTickTime) / 1000));
      this.lastTickTime = now;

      const stillTransitioning = this.stepSimulation(dt);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);

      const shouldContinue =
        this.options.motionMode !== 'static' || stillTransitioning;
      if (!shouldContinue) {
        this.continuousActive = false;
        return;
      }

      if (this.isSoftwareGl) {
        this.afterDraw(tick);
      } else {
        this.rafId = requestAnimationFrame(tick);
      }
    };

    if (this.isSoftwareGl) {
      this.afterDraw(tick);
    } else {
      this.rafId = requestAnimationFrame(tick);
    }
  }

  private stepSimulation(dt: number): boolean {
    let anyActive = false;
    this.elapsedSimTime += dt;

    // 1. Exponential damping on exploded bond expansion
    const expDiff = Math.abs(this.currentExploded - this.options.explodedFactor);
    if (expDiff > 0.002) {
      this.currentExploded = THREE.MathUtils.damp(
        this.currentExploded,
        this.options.explodedFactor,
        9,
        dt
      );
      anyActive = true;
    } else {
      this.currentExploded = this.options.explodedFactor;
    }

    // 2. Exponential damping on atom positions + optional vibrational normal mode
    const vibrate = this.options.motionMode === 'vibrate';
    let idx = 0;
    for (const rig of this.atomRigs.values()) {
      const dist = rig.currentPos.distanceTo(rig.targetPos);
      if (dist > 0.002) {
        rig.currentPos.x = THREE.MathUtils.damp(rig.currentPos.x, rig.targetPos.x, 11, dt);
        rig.currentPos.y = THREE.MathUtils.damp(rig.currentPos.y, rig.targetPos.y, 11, dt);
        rig.currentPos.z = THREE.MathUtils.damp(rig.currentPos.z, rig.targetPos.z, 11, dt);
        anyActive = true;
      } else {
        rig.currentPos.copy(rig.targetPos);
      }

      _vec3C.copy(rig.currentPos).multiplyScalar(this.currentExploded);
      if (vibrate) {
        const phase = this.elapsedSimTime * 9.5 + idx * 1.37;
        _vec3C.x += Math.sin(phase) * 0.032;
        _vec3C.y += Math.cos(phase * 1.15) * 0.032;
        _vec3C.z += Math.sin(phase * 0.85) * 0.025;
      }
      rig.group.position.copy(_vec3C);

      if (rig.reticleGroup.visible) {
        rig.reticleGroup.rotation.z += dt * 1.2;
      }
      idx++;
    }

    this.updateBondTransforms();

    // 3. Spin mode rotation
    if (this.options.motionMode === 'spin') {
      this.moleculeGroup.rotation.y += dt * 0.65;
    }

    // 4. Exponential damping for scripted camera presets
    if (this.cameraTargetPos && this.cameraTargetLook) {
      this.camera.position.x = THREE.MathUtils.damp(
        this.camera.position.x,
        this.cameraTargetPos.x,
        7,
        dt
      );
      this.camera.position.y = THREE.MathUtils.damp(
        this.camera.position.y,
        this.cameraTargetPos.y,
        7,
        dt
      );
      this.camera.position.z = THREE.MathUtils.damp(
        this.camera.position.z,
        this.cameraTargetPos.z,
        7,
        dt
      );
      this.controls.target.x = THREE.MathUtils.damp(
        this.controls.target.x,
        this.cameraTargetLook.x,
        7,
        dt
      );
      this.controls.target.y = THREE.MathUtils.damp(
        this.controls.target.y,
        this.cameraTargetLook.y,
        7,
        dt
      );
      this.controls.target.z = THREE.MathUtils.damp(
        this.controls.target.z,
        this.cameraTargetLook.z,
        7,
        dt
      );

      if (
        this.camera.position.distanceTo(this.cameraTargetPos) < 0.03 &&
        this.controls.target.distanceTo(this.cameraTargetLook) < 0.03
      ) {
        this.camera.position.copy(this.cameraTargetPos);
        this.controls.target.copy(this.cameraTargetLook);
        this.cameraTargetPos = null;
        this.cameraTargetLook = null;
      } else {
        anyActive = true;
      }
    }

    return anyActive;
  }

  /**
   * Software-WebGL GPU fenceSync + 80ms cooldown pacing so SwiftShader never starves the event loop.
   */
  private afterDraw(cb: () => void) {
    try {
      const gl = this.renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (this.disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          this.timeoutId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          this.timeoutId = window.setTimeout(cb, 80);
        }
      };
      this.timeoutId = window.setTimeout(poll, 5);
    } catch {
      this.timeoutId = window.setTimeout(cb, 85);
    }
  }

  public dispose() {
    this.disposed = true;
    this.continuousActive = false;
    cancelAnimationFrame(this.rafId);
    clearTimeout(this.timeoutId);
    this.cleanupListeners();
    this.disposeMoleculeResources();
    this.controls.dispose();
    this.textures.dispose();
    this.envRenderTarget.dispose();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.container) {
      this.container.removeChild(this.renderer.domElement);
    }
  }
}
