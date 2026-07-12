import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

type ViewerTheme = 'light' | 'dark';

/**
 * Canvas は CSS の色変数を直接参照できないため、アプリの data-theme と同じ
 * タイミングで Three.js 側の配色も切り替える。ライト配色では背景より十分濃い
 * 点群・サーフェス・グリッドを使い、形状の輪郭が消えないようにしている。
 */
const VIEWER_PALETTE: Record<
  ViewerTheme,
  {
    background: THREE.ColorRepresentation;
    point: THREE.ColorRepresentation;
    mesh: THREE.ColorRepresentation;
    gridCenter: THREE.ColorRepresentation;
    grid: THREE.ColorRepresentation;
    hemisphereSky: THREE.ColorRepresentation;
    hemisphereGround: THREE.ColorRepresentation;
    hemisphereIntensity: number;
    directionalIntensity: number;
  }
> = {
  dark: {
    background: 0x0b0f14,
    point: 0x4cc2ff,
    mesh: 0x93a8bd,
    gridCenter: 0x3a4a5f,
    grid: 0x232d3a,
    hemisphereSky: 0xdfe8ff,
    hemisphereGround: 0x2a2f38,
    hemisphereIntensity: 1.1,
    directionalIntensity: 1.4,
  },
  light: {
    background: 0xe5ebf3,
    point: 0x006fa8,
    mesh: 0x3f6482,
    gridCenter: 0x6d8195,
    grid: 0xb5c2ce,
    hemisphereSky: 0xffffff,
    hemisphereGround: 0x91a2b1,
    hemisphereIntensity: 1.35,
    directionalIntensity: 1.65,
  },
};

/**
 * 3Dビューア(作業計画 1D)。Three.js + OrbitControls。
 * OrbitControlsはタッチ操作(1本指回転・2本指ズーム/パン)に対応しており、
 * Android実機でもそのまま動作する。
 */
export class ThreeView {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private hemisphereLight: THREE.HemisphereLight;
  private directionalLight: THREE.DirectionalLight;
  private points: THREE.Points | null = null;
  private mesh: THREE.Mesh | null = null;
  private grid: THREE.GridHelper;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private themeObserver: MutationObserver | null = null;
  private theme: ViewerTheme;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(120, 90, 120);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.hemisphereLight = new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 1.1);
    this.scene.add(this.hemisphereLight);
    this.directionalLight = new THREE.DirectionalLight(0xffffff, 1.4);
    this.directionalLight.position.set(80, 140, 60);
    this.scene.add(this.directionalLight);

    this.grid = new THREE.GridHelper(200, 20, 0x3a4a5f, 0x232d3a);
    this.scene.add(this.grid);
    const axes = new THREE.AxesHelper(30);
    this.scene.add(axes);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.theme = this.readTheme();
    this.setTheme(this.theme);
    // ThemeProvider writes the resolved value to <html data-theme="…">. Keeping
    // the observer in this renderer avoids coupling this non-React class to a
    // particular component and also covers a theme switch while this tab is open.
    this.themeObserver = new MutationObserver(() => this.setTheme(this.readTheme()));
    this.themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  private readTheme(): ViewerTheme {
    const dataTheme = document.documentElement.dataset.theme;
    if (dataTheme === 'light' || dataTheme === 'dark') return dataTheme;
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }

  /** data-theme の変更、または呼び出し元からの明示指定で描画配色を更新する。 */
  setTheme(theme: ViewerTheme = this.readTheme()): void {
    this.theme = theme;
    const palette = VIEWER_PALETTE[theme];
    this.renderer.setClearColor(palette.background, 1);
    if (!this.scene.background) this.scene.background = new THREE.Color(palette.background);
    else (this.scene.background as THREE.Color).set(palette.background);

    this.hemisphereLight.color.set(palette.hemisphereSky);
    this.hemisphereLight.groundColor.set(palette.hemisphereGround);
    this.hemisphereLight.intensity = palette.hemisphereIntensity;
    this.directionalLight.intensity = palette.directionalIntensity;
    this.replaceGrid(palette);

    const pointMaterial = this.points?.material;
    if (pointMaterial instanceof THREE.PointsMaterial) pointMaterial.color.set(palette.point);
    const meshMaterial = this.mesh?.material;
    if (meshMaterial instanceof THREE.MeshStandardMaterial) meshMaterial.color.set(palette.mesh);
  }

  /** r169 の GridHelper は色のsetterを公開していないため、位置を保って差し替える。 */
  private replaceGrid(palette: (typeof VIEWER_PALETTE)[ViewerTheme]): void {
    const position = this.grid.position.clone();
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const material = this.grid.material;
    if (Array.isArray(material)) material.forEach((entry) => entry.dispose());
    else material.dispose();

    this.grid = new THREE.GridHelper(200, 20, palette.gridCenter, palette.grid);
    this.grid.position.copy(position);
    this.scene.add(this.grid);
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setPointCloud(positions: Float32Array | null): void {
    if (this.points) {
      this.scene.remove(this.points);
      this.points.geometry.dispose();
      (this.points.material as THREE.Material).dispose();
      this.points = null;
    }
    if (positions && positions.length >= 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.computeBoundingSphere();
      const radius = geo.boundingSphere?.radius ?? 50;
      const mat = new THREE.PointsMaterial({
        color: VIEWER_PALETTE[this.theme].point,
        size: Math.max(0.05, radius * 0.006),
        sizeAttenuation: true,
      });
      this.points = new THREE.Points(geo, mat);
      this.scene.add(this.points);
    }
  }

  setMesh(positions: Float32Array | null, indices?: Uint32Array): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      (this.mesh.material as THREE.Material).dispose();
      this.mesh = null;
    }
    if (positions && indices && indices.length >= 3) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
      geo.computeVertexNormals();
      const mat = new THREE.MeshStandardMaterial({
        color: VIEWER_PALETTE[this.theme].mesh,
        flatShading: true,
        side: THREE.DoubleSide,
        metalness: 0.1,
        roughness: 0.75,
      });
      this.mesh = new THREE.Mesh(geo, mat);
      this.scene.add(this.mesh);
    }
  }

  setVisibility(target: 'points' | 'mesh', visible: boolean): void {
    const obj = target === 'points' ? this.points : this.mesh;
    if (obj) obj.visible = visible;
  }

  /** 表示中オブジェクトにカメラをフィット */
  fit(): void {
    const box = new THREE.Box3();
    let has = false;
    for (const obj of [this.points, this.mesh]) {
      if (obj && obj.visible) {
        box.expandByObject(obj);
        has = true;
      }
    }
    if (!has) return;
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const center = sphere.center.clone();
    const radius = Math.max(sphere.radius, 1e-3);
    // 水平・垂直の狭い方の視野角に外接球が収まる距離を計算する。
    // 固定係数(size×1.2)では縦長画面(スマホ縦持ち)で左右がはみ出すため
    const fovV = THREE.MathUtils.degToRad(this.camera.fov);
    const fovH = 2 * Math.atan(Math.tan(fovV / 2) * this.camera.aspect);
    const dist = (radius / Math.sin(Math.min(fovV, fovH) / 2)) * 1.06; // 6%の余白
    this.controls.target.copy(center);
    const dir = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(dist);
    this.camera.position.copy(center).add(dir);
    this.camera.near = radius / 200;
    this.camera.far = (dist + radius) * 10;
    this.camera.updateProjectionMatrix();
    // 机面グリッドをモデル底面に合わせる
    this.grid.position.set(center.x, box.min.y, center.z);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.themeObserver?.disconnect();
    this.themeObserver = null;
    this.setPointCloud(null);
    this.setMesh(null);
    this.scene.remove(this.grid);
    this.grid.geometry.dispose();
    const gridMaterial = this.grid.material;
    if (Array.isArray(gridMaterial)) gridMaterial.forEach((entry) => entry.dispose());
    else gridMaterial.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
