import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

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
  private points: THREE.Points | null = null;
  private mesh: THREE.Mesh | null = null;
  private grid: THREE.GridHelper;
  private raf = 0;
  private resizeObserver: ResizeObserver;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(120, 90, 120);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x2a2f38, 1.1));
    const dir = new THREE.DirectionalLight(0xffffff, 1.4);
    dir.position.set(80, 140, 60);
    this.scene.add(dir);

    this.grid = new THREE.GridHelper(200, 20, 0x3a4a5f, 0x232d3a);
    this.scene.add(this.grid);
    const axes = new THREE.AxesHelper(30);
    this.scene.add(axes);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
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
        color: 0x4cc2ff,
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
        color: 0x93a8bd,
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
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length() || 100;
    this.controls.target.copy(center);
    const dir = new THREE.Vector3(1, 0.7, 1).normalize().multiplyScalar(size * 1.2);
    this.camera.position.copy(center).add(dir);
    this.camera.near = size / 500;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    // 机面グリッドをモデル底面に合わせる
    this.grid.position.set(center.x, box.min.y, center.z);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.setPointCloud(null);
    this.setMesh(null);
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
