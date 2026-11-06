import * as THREE from 'three';

export interface ProceduralTextureSet {
  goniometerDialMap: THREE.CanvasTexture;
  labFloorMap: THREE.CanvasTexture;
  brushedRoughnessMap: THREE.CanvasTexture;
  contactShadowMap: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(
  renderer: THREE.WebGLRenderer
): ProceduralTextureSet {
  const maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // 1. Calibrated Spectrometer Goniometer Degree Dial (1024x1024)
  const dialCanvas = document.createElement('canvas');
  dialCanvas.width = 1024;
  dialCanvas.height = 1024;
  const dctx = dialCanvas.getContext('2d')!;
  const cx = 512;
  const cy = 512;

  dctx.fillStyle = '#1E293B';
  dctx.fillRect(0, 0, 1024, 1024);

  // Subtle concentric machined rings
  for (let r = 180; r <= 490; r += 16) {
    dctx.beginPath();
    dctx.arc(cx, cy, r, 0, Math.PI * 2);
    dctx.strokeStyle = r % 64 === 0 ? 'rgba(148, 163, 184, 0.25)' : 'rgba(148, 163, 184, 0.08)';
    dctx.lineWidth = r % 64 === 0 ? 2 : 1;
    dctx.stroke();
  }

  // Degree tick marks around perimeter
  for (let deg = 0; deg < 360; deg += 2) {
    const rad = (deg * Math.PI) / 180;
    const isMajor = deg % 30 === 0;
    const isMedium = deg % 10 === 0;
    const outerR = 486;
    const innerR = isMajor ? 446 : isMedium ? 462 : 474;

    dctx.beginPath();
    dctx.moveTo(cx + Math.cos(rad) * innerR, cy + Math.sin(rad) * innerR);
    dctx.lineTo(cx + Math.cos(rad) * outerR, cy + Math.sin(rad) * outerR);
    dctx.strokeStyle = isMajor
      ? '#38BDF8'
      : isMedium
      ? 'rgba(226, 232, 240, 0.65)'
      : 'rgba(148, 163, 184, 0.35)';
    dctx.lineWidth = isMajor ? 3 : isMedium ? 2 : 1;
    dctx.stroke();

    if (isMajor) {
      dctx.save();
      dctx.translate(cx + Math.cos(rad) * 418, cy + Math.sin(rad) * 418);
      dctx.rotate(rad + Math.PI / 2);
      dctx.fillStyle = '#E2E8F0';
      dctx.font = '600 20px "JetBrains Mono", monospace';
      dctx.textAlign = 'center';
      dctx.textBaseline = 'middle';
      dctx.fillText(`${deg}°`, 0, 0);
      dctx.restore();
    }
  }

  const goniometerDialMap = new THREE.CanvasTexture(dialCanvas);
  goniometerDialMap.colorSpace = THREE.SRGBColorSpace;
  goniometerDialMap.anisotropy = maxAniso;

  // 2. Laboratory Coordinate Floor Micro-Grid Texture (512x512 tileable)
  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = 512;
  floorCanvas.height = 512;
  const fctx = floorCanvas.getContext('2d')!;
  fctx.fillStyle = '#E8EEF5';
  fctx.fillRect(0, 0, 512, 512);

  // Subtle architectural tile seams + calibration sub-grid
  fctx.strokeStyle = 'rgba(148, 163, 184, 0.22)';
  fctx.lineWidth = 1;
  for (let i = 0; i <= 512; i += 64) {
    fctx.beginPath();
    fctx.moveTo(i, 0);
    fctx.lineTo(i, 512);
    fctx.stroke();
    fctx.beginPath();
    fctx.moveTo(0, i);
    fctx.lineTo(512, i);
    fctx.stroke();
  }
  fctx.strokeStyle = 'rgba(100, 116, 139, 0.36)';
  fctx.lineWidth = 2;
  fctx.strokeRect(1, 1, 510, 510);

  // Crosshair ticks at tile intersections
  fctx.strokeStyle = 'rgba(59, 130, 246, 0.45)';
  fctx.lineWidth = 2;
  fctx.beginPath();
  fctx.moveTo(246, 256);
  fctx.lineTo(266, 256);
  fctx.moveTo(256, 246);
  fctx.lineTo(256, 266);
  fctx.stroke();

  const labFloorMap = new THREE.CanvasTexture(floorCanvas);
  labFloorMap.colorSpace = THREE.SRGBColorSpace;
  labFloorMap.wrapS = THREE.RepeatWrapping;
  labFloorMap.wrapT = THREE.RepeatWrapping;
  labFloorMap.repeat.set(16, 16);
  labFloorMap.anisotropy = maxAniso;

  // 3. Micro-Brushed Anodized Roughness / Bump Map (256x256 linear data)
  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = 256;
  roughCanvas.height = 256;
  const rctx = roughCanvas.getContext('2d')!;
  rctx.fillStyle = '#808080';
  rctx.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) {
    const v = 112 + Math.floor(Math.sin(y * 1.7) * 14 + ((y * 37) % 19));
    rctx.fillStyle = `rgb(${v},${v},${v})`;
    rctx.fillRect(0, y, 256, 1);
  }
  const brushedRoughnessMap = new THREE.CanvasTexture(roughCanvas);
  brushedRoughnessMap.wrapS = THREE.RepeatWrapping;
  brushedRoughnessMap.wrapT = THREE.RepeatWrapping;
  brushedRoughnessMap.repeat.set(4, 4);

  // 4. Soft Radial Contact Shadow Map (256x256)
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d')!;
  const grad = sctx.createRadialGradient(128, 128, 8, 128, 128, 124);
  grad.addColorStop(0, 'rgba(15, 23, 42, 0.72)');
  grad.addColorStop(0.5, 'rgba(15, 23, 42, 0.28)');
  grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const contactShadowMap = new THREE.CanvasTexture(shadowCanvas);

  return {
    goniometerDialMap,
    labFloorMap,
    brushedRoughnessMap,
    contactShadowMap,
    dispose: () => {
      goniometerDialMap.dispose();
      labFloorMap.dispose();
      brushedRoughnessMap.dispose();
      contactShadowMap.dispose();
    },
  };
}
