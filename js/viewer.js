/**
 * 3Dmol.js wrapper.
 *
 * 3Dmol's native stick shader gives smooth rounded joints. In Sticks mode
 * singleBonds is enabled so the whole molecule is drawn as a uniform bond
 * skeleton (like PubChem's stick view), without double-bond sticks or the
 * merged terminal cap that looked like an atom ball.
 */

/** Rotate a 3D vector by a quaternion. */
export function rotateVector(x, y, z, q) {
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  return {
    x: x + q.w * tx + (q.y * tz - q.z * ty),
    y: y + q.w * ty + (q.z * tx - q.x * tz),
    z: z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize3([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** Quaternion that makes the camera look along `dir` toward the origin. */
function viewQuaternionForDirection(dir, up = [0, 1, 0]) {
  const direction = normalize3(dir);
  const right = normalize3(cross(up, direction));
  const upVector = normalize3(cross(direction, right));
  const [r0, r1, r2] = right;
  const [u0, u1, u2] = upVector;
  const [d0, d1, d2] = direction;

  // World-to-view rotation matrix, rows = right, up, direction.
  const m00 = r0, m01 = r1, m02 = r2;
  const m10 = u0, m11 = u1, m12 = u2;
  const m20 = d0, m21 = d1, m22 = d2;
  const trace = m00 + m11 + m22;

  let x;
  let y;
  let z;
  let w;
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2;
    w = 0.25 * s;
    x = (m21 - m12) / s;
    y = (m02 - m20) / s;
    z = (m10 - m01) / s;
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    w = (m21 - m12) / s;
    x = 0.25 * s;
    y = (m01 + m10) / s;
    z = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    w = (m02 - m20) / s;
    x = (m01 + m10) / s;
    y = 0.25 * s;
    z = (m12 + m21) / s;
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    w = (m10 - m01) / s;
    x = (m02 + m20) / s;
    y = (m12 + m21) / s;
    z = 0.25 * s;
  }

  const length = Math.hypot(x, y, z, w) || 1;
  return { x: x / length, y: y / length, z: z / length, w: w / length };
}

/** Quaternion for a view looking from +axis toward the origin. */
function axisViewQuaternion(axis) {
  const negative = axis.startsWith('-');
  const base = negative ? axis.slice(1) : axis;
  const config = {
    x: { dir: [1, 0, 0], up: [0, 1, 0] },
    y: { dir: [0, 1, 0], up: [0, 0, 1] },
    z: { dir: [0, 0, 1], up: [0, 1, 0] },
  }[base] || { dir: [0, 0, 1], up: [0, 1, 0] };

  const sign = negative ? -1 : 1;
  return viewQuaternionForDirection(
    config.dir.map((value) => value * sign),
    config.up,
  );
}

export function multiplyQuaternion(a, b) {
  return {
    x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
    y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
    z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
    w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
  };
}

export function quaternionFromAxisAngle(axis, degrees) {
  const half = (degrees * Math.PI) / 360;
  const sin = Math.sin(half);
  return { x: axis.x * sin, y: axis.y * sin, z: axis.z * sin, w: Math.cos(half) };
}

export function slerpQuaternion(a, b, t) {
  let bx = b.x;
  let by = b.y;
  let bz = b.z;
  let bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (cos < 0) {
    cos = -cos;
    bx = -bx;
    by = -by;
    bz = -bz;
    bw = -bw;
  }

  if (cos > 0.9995) {
    const x = a.x + (bx - a.x) * t;
    const y = a.y + (by - a.y) * t;
    const z = a.z + (bz - a.z) * t;
    const w = a.w + (bw - a.w) * t;
    const length = Math.hypot(x, y, z, w) || 1;
    return { x: x / length, y: y / length, z: z / length, w: w / length };
  }

  const theta = Math.acos(cos);
  const sin = Math.sin(theta);
  const wa = Math.sin((1 - t) * theta) / sin;
  const wb = Math.sin(t * theta) / sin;
  return {
    x: a.x * wa + bx * wb,
    y: a.y * wa + by * wb,
    z: a.z * wa + bz * wb,
    w: a.w * wa + bw * wb,
  };
}

const STYLES = {
  'ball-stick': {
    stick: { radius: 0.15, colorscheme: 'Jmol' },
    sphere: { scale: 0.22, colorscheme: 'Jmol' },
  },
  sticks: {
    // PubChem's stick view shows a uniform bond skeleton, not parallel
    // double-bond sticks. singleBonds also avoids the merged double cap that
    // looks like an atom ball at a terminal C=O.
    stick: { radius: 0.12, colorscheme: 'Jmol', singleBonds: true },
  },
  spheres: {
    sphere: { scale: 0.9, colorscheme: 'Jmol' },
  },
  lines: {
    // WebGL ignores lineWidth > 1 on most desktop drivers, so the line view is
    // drawn with very thin sticks. Line width then visibly controls thickness.
    stick: { radius: 0.012, colorscheme: 'Jmol', singleBonds: true },
  },
};

/**
 * Visual finishes. 3Dmol's model shader is diffuse-only, so the metallic,
 * glass and clay looks are approximated with an element palette plus the
 * renderer's outline pass. Glass additionally lowers the base opacity.
 *
 * Outline width is in model units (3Dmol's default is 0.1), not pixels.
 * Keep it small: values above ~0.1 produce a huge merged silhouette.
 */
export const MATERIAL_PRESETS = {
  standard: {
    label: 'Standard',
    palette: null,
    outline: null,
    opacity: 1,
  },
  outline: {
    label: 'Outline',
    palette: null,
    outline: { color: '#050b10', width: 0.055 },
    opacity: 1,
  },
  matte: {
    label: 'Matte',
    palette: {
      H: '#dfe7ea',
      C: '#7d8b94',
      N: '#58739a',
      O: '#b66b5d',
      S: '#b6a04f',
      P: '#b98250',
      F: '#6da58f',
      Cl: '#77a887',
      Br: '#9c735d',
      I: '#75679a',
      B: '#b98a98',
      Si: '#8494a0',
    },
    outline: null,
    opacity: 1,
  },
  metal: {
    label: 'Metal',
    palette: {
      H: '#eef3f7',
      C: '#9aa8b4',
      N: '#5f83bf',
      O: '#cf8a5b',
      S: '#d6b25b',
      P: '#c98b50',
      F: '#7fb7a2',
      Cl: '#8bb79c',
      Br: '#b07b58',
      I: '#8c79b8',
      B: '#c08a93',
      Si: '#8e9dab',
      Fe: '#aab6c2',
      Cu: '#c98154',
      Zn: '#a7b2bd',
      Au: '#dec262',
      Ag: '#d5dde5',
      Pt: '#c8d2db',
    },
    outline: { color: '#0a1015', width: 0.035 },
    opacity: 1,
  },
  chrome: {
    label: 'Chrome',
    palette: {
      H: '#ffffff',
      C: '#d6dee7',
      N: '#a9bdd8',
      O: '#d8bda7',
      S: '#e6d9a4',
      P: '#dec19b',
      F: '#b9d9cd',
      Cl: '#c6d6c9',
      Br: '#c8ad9d',
      I: '#b9aed6',
      B: '#d8b6bd',
      Si: '#c3ced8',
      Fe: '#e2e8ee',
      Cu: '#e3b08e',
      Zn: '#d8e0e7',
      Au: '#f0d98a',
      Ag: '#f3f7fa',
      Pt: '#e2e9f0',
    },
    outline: { color: '#1a2530', width: 0.022 },
    opacity: 1,
  },
  gold: {
    label: 'Gold',
    palette: {
      H: '#fff7d9',
      C: '#d4af37',
      N: '#c9a24a',
      O: '#e0a34a',
      S: '#f0d060',
      P: '#dcb45a',
      F: '#c9c07a',
      Cl: '#d4c477',
      Br: '#c9a05a',
      I: '#b99a62',
      B: '#d8b46a',
      Si: '#c9b46a',
      Cu: '#f0c060',
      Ag: '#f5e6a8',
      Au: '#ffd700',
      Pt: '#e8d9a0',
    },
    outline: { color: '#4a3410', width: 0.028 },
    opacity: 1,
  },
  plastic: {
    label: 'Plastic',
    palette: {
      H: '#f4fbff',
      C: '#e4572e',
      N: '#3b82f6',
      O: '#ff5d8f',
      S: '#ffd166',
      P: '#ff9f1c',
      F: '#4ade80',
      Cl: '#34d399',
      Br: '#c084fc',
      I: '#a78bfa',
      B: '#f472b6',
      Si: '#94a3b8',
    },
    outline: { color: '#0a1015', width: 0.025 },
    opacity: 1,
  },
  ceramic: {
    label: 'Ceramic',
    palette: {
      H: '#fffdf8',
      C: '#d9d0c3',
      N: '#b8c6d6',
      O: '#d9b3a5',
      S: '#d9c9a3',
      P: '#d9b99b',
      F: '#b9cfc5',
      Cl: '#c6d4c9',
      Br: '#c9b6ad',
      I: '#b9afd0',
      B: '#d6b9c0',
      Si: '#c4c0b8',
    },
    outline: { color: '#6b5a48', width: 0.02 },
    opacity: 1,
  },
  glass: {
    label: 'Glass',
    palette: {
      H: '#e9fbff',
      C: '#b7e2ea',
      N: '#a3c6ff',
      O: '#ffb7c5',
      S: '#ffe7a3',
      P: '#ffd0a3',
      F: '#a9f7dc',
      Cl: '#b6f5d4',
      Br: '#f0c4b3',
      I: '#cfc2ff',
      B: '#f3c2d0',
      Si: '#c6e4ef',
    },
    outline: { color: '#c9f4ff', width: 0.025 },
    opacity: 0.45,
  },
  neon: {
    label: 'Neon',
    palette: {
      H: '#f7ffff',
      C: '#22ffd0',
      N: '#4d8cff',
      O: '#ff3c86',
      S: '#f4ff3d',
      P: '#ff9e22',
      F: '#54ff9a',
      Cl: '#82ff5e',
      Br: '#ff7bd8',
      I: '#b47bff',
      B: '#ff7bd8',
      Si: '#66e7ff',
    },
    outline: { color: '#00e6b8', width: 0.045 },
    opacity: 1,
  },
  clay: {
    label: 'Clay',
    palette: {
      H: '#f2dfcf',
      C: '#c38b66',
      N: '#8f7095',
      O: '#d2684a',
      S: '#d3ad55',
      P: '#c58b58',
      F: '#7fa58d',
      Cl: '#8eaf91',
      Br: '#a8785b',
      I: '#8b73a3',
      B: '#c58d91',
      Si: '#a98a76',
    },
    outline: { color: '#3b2418', width: 0.035 },
    opacity: 1,
  },
};

function clampGloss(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
}

function elementColorHex(element) {
  const value = window.$3Dmol?.elementColors?.Jmol?.[element];
  if (typeof value === 'number') return `#${value.toString(16).padStart(6, '0')}`;
  if (typeof value === 'string') return value;
  return '#8b979f';
}

function mixHex(base, target, amount) {
  const parse = (hex) => {
    const value = hex.replace('#', '');
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  };
  const a = parse(base);
  const b = parse(target);
  const t = Math.min(1, Math.max(0, amount));
  const channels = a.map((channel, index) =>
    Math.round(channel + (b[index] - channel) * t)
      .toString(16)
      .padStart(2, '0'),
  );
  return `#${channels.join('')}`;
}

/** Lighten or darken a colour with the gloss amount. */
export function glossColor(color, gloss = 0.5) {
  const value = clampGloss(gloss);
  if (Math.abs(value - 0.5) < 0.001) return color;
  const amount = (value - 0.5) * 0.8;
  return mixHex(color, amount > 0 ? '#ffffff' : '#000000', Math.abs(amount));
}

/** Palette colour for an element, with a gloss highlight/darken adjustment. */
export function materialElementColor(material, element, gloss = 0.5) {
  const preset = MATERIAL_PRESETS[material] || MATERIAL_PRESETS.standard;
  const base = preset.palette?.[element] || elementColorHex(element);
  return glossColor(base, gloss);
}

/** Extra opacity imposed by a translucent finish such as Glass. */
export function materialOpacity(material, gloss = 0.5) {
  const preset = MATERIAL_PRESETS[material] || MATERIAL_PRESETS.standard;
  const base = preset.opacity ?? 1;
  if (base >= 1) return null;
  const adjusted = base + (clampGloss(gloss) - 0.5) * 0.3;
  return Math.min(1, Math.max(0.15, adjusted));
}

export class MoleculeViewer {
  constructor(container) {
    this.container = container;
    this.viewer = null;
    this.model = null;
    this.models = [];
    this.modelLayers = [];
    this.appearance = {
      atomScale: 1,
      bondScale: 1,
      opacity: 1,
      lineWidth: 1.6,
      colorScheme: 'Jmol',
      customColor: '#2dd4bf',
      surfaceColor: '#2dd4bf',
      surfaceOpacity: 0.5,
      material: 'standard',
      materialGloss: 0.5,
      lighting: 'studio',
      showAxes: false,
      showGrid: false,
      gridSpacing: 2,
      gridPlane: 'xz',
      gridMode: 'single',
      showScaleBar: false,
      showUnitLabels: false,
      background: null,
    };
    this.styleName = 'ball-stick';
    this.showHydrogen = true;
    this.materialName = null;
    this.spinning = false;
    this.surfaceVisible = false;
    this.available = false;
    this.homeView = null;
    this.gizmo = null;
    this.gizmoSvg = null;
    this.gizmoAxes = [];
    this.gizmoOrder = '';
    this.gizmoEnabled = false;
    this.gizmoDrag = null;
    this.selectionHighlight = [];
    this.viewAnimation = 0;
    this.lightingPreset = null;
    this.baseLight = null;
    this.extraLights = [];
    this.overlayKey = '';
    this.overlayBounds = null;
  }

  init() {
    if (!window.$3Dmol) throw new Error('3Dmol.js did not load.');
    this.viewer = window.$3Dmol.createViewer(this.container, {
      backgroundColor: this.readBackground(),
      antialias: true,
      preserveDrawingBuffer: true,
    });
    this.setBackground();
    this.setLightingPreset(this.appearance.lighting);
    this.initGizmo();
    this.available = true;
    return this;
  }

  initGizmo() {
    this.gizmo = document.getElementById('axis-gizmo');
    if (!this.gizmo) return;
    this.gizmoSvg = this.gizmo.querySelector('svg');
    this.gizmoAxes = Array.from(this.gizmo.querySelectorAll('[data-axis]')).map((group) => ({
      key: group.dataset.axis,
      group,
      line: group.querySelector('line'),
      dot: group.querySelector('circle'),
      text: group.querySelector('text'),
    }));
    this.viewer.setViewChangeCallback?.(() => this.updateGizmo());

    for (const entry of this.gizmoAxes) {
      entry.group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          this.alignToAxis(entry.key);
        }
      });
    }

    this.gizmo.addEventListener('pointerdown', (event) => this.onGizmoPointerDown(event));
    this.gizmo.addEventListener('pointermove', (event) => this.onGizmoPointerMove(event));
    this.gizmo.addEventListener('pointerup', (event) => this.onGizmoPointerUp(event));
    this.gizmo.addEventListener('pointercancel', (event) => this.onGizmoPointerUp(event, true));

    this.container.addEventListener('pointerdown', () => this.cancelViewAnimation());
  }

  onGizmoPointerDown(event) {
    if (!this.viewer || !this.model) return;
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    this.cancelViewAnimation();
    const axisEl = event.target.closest?.('[data-axis]');

    this.gizmoDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      axis: axisEl?.dataset.axis || null,
      moved: false,
    };

    try {
      this.gizmo.setPointerCapture(event.pointerId);
    } catch {
      /* pointer capture is optional */
    }
    this.gizmo.classList.add('is-dragging');
    event.preventDefault();
  }

  onGizmoPointerMove(event) {
    const drag = this.gizmoDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const totalDx = event.clientX - drag.startX;
    const totalDy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(totalDx, totalDy) > 3) drag.moved = true;
    if (!drag.moved) return;

    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!dx && !dy) return;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;

    // Direct, screen-aligned orbit. Pre-multiplying keeps the drag axes tied
    // to the screen rather than the molecule.
    const sensitivity = 0.38;
    const yaw = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, dx * sensitivity);
    const pitch = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, dy * sensitivity);
    const view = this.viewer.getView();
    const current = { x: view[4], y: view[5], z: view[6], w: view[7] };
    const q = multiplyQuaternion(multiplyQuaternion(yaw, pitch), current);

    view[4] = q.x;
    view[5] = q.y;
    view[6] = q.z;
    view[7] = q.w;
    this.viewer.setView(view);
  }

  onGizmoPointerUp(event, cancelled = false) {
    const drag = this.gizmoDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    this.gizmoDrag = null;
    this.gizmo.classList.remove('is-dragging');
    try {
      this.gizmo.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer capture is optional */
    }

    if (!cancelled && !drag.moved && drag.axis) this.alignToAxis(drag.axis);
  }

  /** Animate the model to look along +axis, like Blender's navigation gizmo. */
  alignToAxis(axis) {
    if (!this.viewer || !this.model) return;
    const target = axisViewQuaternion(axis);
    const view = this.viewer.getView().slice();
    const start = { x: view[4], y: view[5], z: view[6], w: view[7] };

    this.cancelViewAnimation();
    const duration = 260;
    const startedAt = performance.now();

    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const q = slerpQuaternion(start, target, eased);
      view[4] = q.x;
      view[5] = q.y;
      view[6] = q.z;
      view[7] = q.w;
      this.viewer.setView(view);
      if (t < 1) {
        this.viewAnimation = requestAnimationFrame(step);
      } else {
        this.viewAnimation = 0;
        this.viewer.render();
      }
    };

    this.viewAnimation = requestAnimationFrame(step);
  }

  cancelViewAnimation() {
    if (this.viewAnimation) cancelAnimationFrame(this.viewAnimation);
    this.viewAnimation = 0;
  }

  setGizmoVisible(visible) {
    this.gizmoEnabled = Boolean(visible);
    this.updateGizmo();
  }

  /**
   * Keep the corner XYZ triad in sync with the model rotation. The view is
   * stored as an 8-value array; indices 4–7 are the rotation quaternion.
   */
  updateGizmo() {
    if (!this.gizmo || !this.gizmoSvg || !this.viewer) return;
    if (!this.model || !this.gizmoEnabled) {
      this.gizmo.hidden = true;
      return;
    }
    this.gizmo.hidden = false;

    const view = this.viewer.getView();
    const quat = { x: view[4], y: view[5], z: view[6], w: view[7] };
    const center = 50;
    const radius = 38;

    const axes = [
      ['x', 1, 0, 0],
      ['y', 0, 1, 0],
      ['z', 0, 0, 1],
      ['-x', -1, 0, 0],
      ['-y', 0, -1, 0],
      ['-z', 0, 0, -1],
    ].map(([key, x, y, z]) => ({ key, ...rotateVector(x, y, z, quat) }));

    // Draw the axis pointing away from the camera first.
    axes.sort((a, b) => a.z - b.z);

    const order = axes.map((axis) => axis.key).join(',');
    const orderChanged = order !== this.gizmoOrder;
    this.gizmoOrder = order;

    for (const axis of axes) {
      const entry = this.gizmoAxes.find((item) => item.key === axis.key);
      if (!entry) continue;
      const endX = center + axis.x * radius;
      const endY = center - axis.y * radius;

      entry.line.setAttribute('x2', endX.toFixed(2));
      entry.line.setAttribute('y2', endY.toFixed(2));
      entry.dot.setAttribute('cx', endX.toFixed(2));
      entry.dot.setAttribute('cy', endY.toFixed(2));
      if (entry.text) {
        entry.text.setAttribute('x', endX.toFixed(2));
        entry.text.setAttribute('y', endY.toFixed(2));
      }
      entry.group.style.opacity = (0.5 + ((axis.z + 1) / 2) * 0.5).toFixed(2);

      // Only reorder when the depth order actually changes; otherwise the
      // SVG is left alone so dragging stays flicker-free.
      if (orderChanged) this.gizmoSvg.append(entry.group);
    }
  }

  backgroundSpec() {
    if (this.appearance?.background === 'transparent') {
      return { color: '#000000', alpha: 0, transparent: true };
    }
    const value =
      this.appearance?.background ||
      getComputedStyle(document.documentElement)
        .getPropertyValue('--viewer-bg')
        .trim();
    return { color: value || '#050b10', alpha: 1, transparent: false };
  }

  readBackground() {
    return this.backgroundSpec().color;
  }

  setBackground() {
    if (!this.viewer) return;
    const spec = this.backgroundSpec();
    this.viewer.setBackgroundColor(spec.color, spec.alpha);
    this.container.classList.toggle('is-transparent-bg', spec.transparent);
    this.container.parentElement?.classList.toggle('is-transparent-bg', spec.transparent);
    this.viewer.render();
  }

  load(sdfText) {
    this.loadMany([sdfText]);
  }

  loadMany(sdfTexts) {
    if (!this.viewer) return;
    this.cancelViewAnimation();
    this.viewer.removeAllSurfaces();
    this.viewer.removeAllShapes();
    this.viewer.removeAllModels();
    this.surfaceVisible = false;
    this.modelLayers = [];
    this.overlayBounds = null;

    // Start every scene from a neutral camera; otherwise each reload would
    // stack another isometric tilt on the previous one.
    this.viewer.setView([0, 0, 0, 0, 0, 0, 0, 1]);

    this.models = (sdfTexts || [])
      .filter(Boolean)
      .map((text) => this.viewer.addModel(text, 'sdf'));
    this.model = this.models[0] ?? null;
    if (!this.model) {
      this.viewer.render();
      return;
    }

    this.applyStyle();
    // Fit the camera to the molecules only; guides and selection shapes can be
    // much larger than the structure and would otherwise zoom the view out.
    this.viewer.removeAllShapes();
    this.viewer.zoomTo();

    // Small isometric tilt: reduces atoms hiding directly behind one another
    // in flat molecules and shows the 3D shape instead of an edge-on view.
    this.viewer.rotate(20, 'y');
    this.viewer.rotate(10, 'x');
    this.viewer.zoomTo();
    this.homeView = this.viewer.getView();
    this.drawSelectionHighlight();

    if (this.spinning) this.viewer.spin(true);
    this.viewer.render();
    this.updateGizmo();
  }

  clear() {
    if (!this.viewer) return;
    this.cancelViewAnimation();
    this.viewer.removeAllSurfaces();
    this.viewer.removeAllShapes();
    this.viewer.removeAllModels();
    this.model = null;
    this.models = [];
    this.modelLayers = [];
    this.surfaceVisible = false;
    this.selectionHighlight = [];
    this.overlayBounds = null;
    if (this.gizmo) this.gizmo.hidden = true;
    this.viewer.render();
  }

  setStyleName(name) {
    if (!STYLES[name]) return;
    this.styleName = name;
    this.applyStyle();
  }

  setShowHydrogen(show) {
    this.showHydrogen = Boolean(show);
    this.applyStyle();
  }

  applyMaterial() {
    if (!this.viewer) return;
    const name = this.appearance.material || 'standard';
    if (this.materialName === name) return;
    this.materialName = name;
    const preset = MATERIAL_PRESETS[name] || MATERIAL_PRESETS.standard;
    const styles = [];
    if (preset.outline) styles.push('outline');
    if (preset.ambientOcclusion) styles.push('ambientOcclusion');
    this.viewer.setViewStyle({
      style: styles.join(' '),
      ...(preset.outline || {}),
      ...(preset.ambientOcclusion || {}),
    });
  }

  materialColor(element, gloss = this.appearance.materialGloss) {
    return materialElementColor(this.appearance.material, element, gloss);
  }

  effectiveOpacity(value = this.appearance.opacity) {
    const factor = materialOpacity(
      this.appearance.material,
      this.appearance.materialGloss,
    ) ?? 1;
    const number = Number.isFinite(Number(value)) ? Number(value) : 1;
    return Math.min(1, Math.max(0.05, number * factor));
  }

  applyStyle() {
    if (!this.viewer || !this.model) return;
    this.applyMaterial();
    const defaults = STYLES[this.styleName] ?? STYLES['ball-stick'];
    const appearance = this.appearance;
    const preset = MATERIAL_PRESETS[appearance.material] || MATERIAL_PRESETS.standard;
    const gloss = appearance.materialGloss ?? 0.5;
    const glossActive = Math.abs(gloss - 0.5) > 0.001;
    const opacity = this.effectiveOpacity(appearance.opacity);
    const base = {};
    for (const [kind, spec] of Object.entries(defaults)) {
      const next = { ...spec };
      if (kind === 'sphere') {
        next.scale = (spec.scale ?? 1) * (appearance.atomScale ?? 1);
      }
      if (kind === 'stick') {
        const baseRadius = spec.radius ?? 0.15;
        next.radius =
          this.styleName === 'lines'
            ? baseRadius *
              (appearance.lineWidth ?? 1.6) *
              (appearance.bondScale ?? 1)
            : baseRadius * (appearance.bondScale ?? 1);
      }
      if (kind === 'line') {
        next.linewidth = appearance.lineWidth ?? spec.linewidth;
      }
      if (appearance.colorScheme === 'custom') {
        delete next.colorscheme;
        next.color = appearance.customColor;
      } else if (preset.palette || glossActive) {
        const jmol = window.$3Dmol?.elementColors?.Jmol || {};
        const elements = new Set([
          ...Object.keys(jmol),
          ...Object.keys(preset.palette || {}),
        ]);
        const map = {};
        for (const element of elements) {
          map[element] = materialElementColor(appearance.material, element, gloss);
        }
        next.colorscheme = { prop: 'elem', map };
      } else {
        next.colorscheme = appearance.colorScheme || spec.colorscheme;
      }
      if (opacity < 1) next.opacity = opacity;
      base[kind] = next;
    }

    this.models.forEach((model, index) => {
      const options = this.modelLayers[index] || {};
      model.setStyle({}, {});
      if (options.visible === false) return;

      const style = {};
      for (const [kind, spec] of Object.entries(base)) style[kind] = { ...spec };
      if (options.atoms === false) delete style.sphere;
      if (options.bonds === false) delete style.stick;

      model.setStyle({}, style);

      const merge = (selector, spec) => {
        const filtered = {};
        for (const kind of ['sphere', 'stick', 'line']) {
          if (style[kind] && spec[kind]) filtered[kind] = spec[kind];
        }
        if (Object.keys(filtered).length) {
          model.setStyle(selector, filtered, true);
        }
      };

      const targetSpec = ({ color, scale, opacity }) => {
        const spec = {};
        if (color) {
          for (const kind of ['sphere', 'stick', 'line']) {
            if (style[kind]) spec[kind] = { color, colorscheme: undefined };
          }
        }
        if (scale != null && style.sphere) {
          spec.sphere = { ...spec.sphere, scale: style.sphere.scale * scale };
        }
        if (opacity != null) {
          for (const kind of ['sphere', 'stick', 'line']) {
            if (style[kind] && !spec[kind]) spec[kind] = {};
            if (style[kind]) spec[kind].opacity = opacity;
          }
        }
        return spec;
      };

      const stickSpec = (radiusScale, opacity) => {
        if (!style.stick) return {};
        const spec = { radius: style.stick.radius * radiusScale };
        if (opacity != null) spec.opacity = opacity;
        return { stick: spec };
      };

      // Dominance order: compound → bonds group → atoms group → element → atom.
      if (options.compoundOpacity != null) {
        merge({}, targetSpec({ opacity: options.compoundOpacity }));
      }

      if (
        options.bondsRadius != null ||
        options.bondsOpacity != null ||
        options.bondsColor
      ) {
        const spec = stickSpec(options.bondsRadius ?? 1, options.bondsOpacity);
        if (options.bondsColor && spec.stick) {
          spec.stick.color = options.bondsColor;
          spec.stick.colorscheme = undefined;
        }
        merge({}, spec);
      }

      if (
        options.atomsColor ||
        options.atomsScale != null ||
        options.atomsOpacity != null
      ) {
        merge(
          {},
          targetSpec({
            color: options.atomsColor,
            scale: options.atomsScale,
            opacity: options.atomsOpacity,
          }),
        );
      }

      const elementKeys = new Set([
        ...Object.keys(options.elementColors || {}),
        ...Object.keys(options.elementScales || {}),
        ...Object.keys(options.elementOpacities || {}),
      ]);
      for (const element of elementKeys) {
        merge(
          { elem: element },
          targetSpec({
            color: options.elementColors?.[element],
            scale: options.elementScales?.[element],
            opacity: options.elementOpacities?.[element],
          }),
        );
      }

      const atomKeys = new Set([
        ...Object.keys(options.atomColors || {}),
        ...Object.keys(options.atomScales || {}),
        ...Object.keys(options.atomOpacities || {}),
      ]);
      for (const atomKey of atomKeys) {
        merge(
          { index: Number(atomKey) },
          targetSpec({
            color: options.atomColors?.[atomKey],
            scale: options.atomScales?.[atomKey],
            opacity: options.atomOpacities?.[atomKey],
          }),
        );
      }

      if (!this.showHydrogen) model.setStyle({ elem: 'H' }, {});

      // Hiding an atom hides its sphere marker only; connected sticks stay so
      // the bond skeleton remains intact.
      const hiddenElements = new Set(options.hiddenElements || []);
      const hiddenAtoms = new Set((options.hiddenAtoms || []).map(Number));
      if (hiddenElements.size || hiddenAtoms.size) {
        model.atoms.forEach((atom, atomIndex) => {
          if (!hiddenElements.has(atom.elem) && !hiddenAtoms.has(atomIndex)) return;
          const current = { ...atom.style };
          if (!current.sphere) return;
          delete current.sphere;
          model.setStyle({ index: atomIndex }, current);
        });
      }
    });

    this.drawSelectionHighlight();
  }

  setAppearance(patch = {}) {
    const surfaceChanged =
      Object.prototype.hasOwnProperty.call(patch, 'surfaceColor') ||
      Object.prototype.hasOwnProperty.call(patch, 'surfaceOpacity');
    const backgroundChanged = Object.prototype.hasOwnProperty.call(patch, 'background');
    const lightingChanged = Object.prototype.hasOwnProperty.call(patch, 'lighting');
    const overlaysChanged = [
      'showAxes',
      'showGrid',
      'gridSpacing',
      'gridPlane',
      'gridMode',
      'showScaleBar',
      'showUnitLabels',
    ].some((key) => Object.prototype.hasOwnProperty.call(patch, key));
    Object.assign(this.appearance, patch);
    this.applyStyle();
    if (surfaceChanged) this.refreshSurface();
    if (backgroundChanged) this.setBackground();
    if (lightingChanged) this.setLightingPreset(this.appearance.lighting);
    if (overlaysChanged) {
      this.overlayKey = '';
      this.drawSelectionHighlight();
      this.updateScaleBar();
    }
  }

  setLightingPreset(name = 'studio') {
    const presets = {
      studio: { key: 1, keyPos: [0.25, 0.3, 1], fill: 0.32, fillPos: [-0.7, 0.15, 0.55], rim: 0.18, rimPos: [0.1, -0.5, -1] },
      soft: { key: 0.78, keyPos: [0.1, 0.25, 1], fill: 0.45, fillPos: [-0.7, 0.1, 0.6], rim: 0.12, rimPos: [0, -0.4, -1] },
      bright: { key: 1.25, keyPos: [0.2, 0.4, 1], fill: 0.55, fillPos: [-0.8, 0.3, 0.7], rim: 0.3, rimPos: [0.2, -0.6, -1] },
      dramatic: { key: 1.35, keyPos: [0.65, 0.55, 0.9], fill: 0.08, fillPos: [-0.8, 0.1, 0.4], rim: 0.5, rimPos: [-0.3, -0.2, -1] },
      rim: { key: 0.55, keyPos: [0.15, 0.2, 1], fill: 0.2, fillPos: [-0.6, 0.15, 0.5], rim: 0.75, rimPos: [-0.6, 0.45, -1] },
    };
    const config = presets[name] || presets.studio;
    if (!this.viewer?.scene) return;

    const scene = this.viewer.scene;
    if (!this.baseLight) {
      this.baseLight =
        scene.children.find(
          (child) =>
            child?.isLight ||
            child?.type === 'DirectionalLight' ||
            child?.type === 'PointLight' ||
            child?.type === 'Light' ||
            (child &&
              typeof child.intensity === 'number' &&
              child.position &&
              child.color),
        ) || null;
    }
    if (!this.baseLight) return;

    const applyLight = (light, intensity, position) => {
      light.intensity = intensity;
      if (light.position) {
        light.position.set(position[0], position[1], position[2]);
        if (light.position.normalize) light.position.normalize();
      }
      light.visible = intensity > 0.001;
    };

    applyLight(this.baseLight, config.key, config.keyPos);

    for (const light of this.extraLights) scene.remove(light);
    this.extraLights = [];

    const addFill = (intensity, position) => {
      if (intensity <= 0.001) return;
      let light;
      try {
        light = new this.baseLight.constructor(0xffffff);
      } catch {
        return;
      }
      applyLight(light, intensity, position);
      scene.add(light);
      this.extraLights.push(light);
    };
    addFill(config.fill, config.fillPos);
    addFill(config.rim, config.rimPos);

    this.lightingPreset = name;
    this.viewer.render();
  }

  setCameraPreset(name = 'iso', { animate = true } = {}) {
    if (!this.viewer) return;
    const presets = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      side: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0],
      bottom: [0, -1, 0],
      iso: [1, 1, 1],
    };
    const quaternion = viewQuaternionForDirection(
      presets[name] || presets.iso,
      name === 'top' || name === 'bottom' ? [0, 0, -1] : [0, 1, 0],
    );
    this.applyViewQuaternion(quaternion, animate);
  }

  applyViewQuaternion(quaternion, animate = true) {
    if (!this.viewer) return;
    const view = this.viewer.getView().slice();
    const start = { x: view[4], y: view[5], z: view[6], w: view[7] };
    this.cancelViewAnimation();

    if (!animate) {
      view[4] = quaternion.x;
      view[5] = quaternion.y;
      view[6] = quaternion.z;
      view[7] = quaternion.w;
      this.viewer.setView(view);
      this.viewer.render();
      this.updateGizmo();
      this.updateScaleBar();
      return;
    }

    const duration = 260;
    const startedAt = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - startedAt) / duration);
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      const q = slerpQuaternion(start, quaternion, eased);
      view[4] = q.x;
      view[5] = q.y;
      view[6] = q.z;
      view[7] = q.w;
      this.viewer.setView(view);
      if (t < 1) {
        this.viewAnimation = requestAnimationFrame(step);
      } else {
        this.viewAnimation = 0;
        this.viewer.render();
        this.updateGizmo();
        this.updateScaleBar();
      }
    };
    this.viewAnimation = requestAnimationFrame(step);
  }

  sceneBounds() {
    if (!this.viewer) return null;
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    for (const model of this.models || []) {
      if (!model?.atoms) continue;
      for (const atom of model.atoms) {
        minX = Math.min(minX, atom.x); maxX = Math.max(maxX, atom.x);
        minY = Math.min(minY, atom.y); maxY = Math.max(maxY, atom.y);
        minZ = Math.min(minZ, atom.z); maxZ = Math.max(maxZ, atom.z);
      }
    }
    if (!Number.isFinite(minX)) return null;
    return { minX, maxX, minY, maxY, minZ, maxZ };
  }

  gridBounds() {
    if (!this.overlayBounds) this.overlayBounds = this.sceneBounds();
    return this.overlayBounds;
  }

  drawOverlayShapes() {
    if (!this.viewer) return;
    const appearance = this.appearance || {};
    const bounds = this.gridBounds();
    if (!bounds) return;

    const span = Math.max(
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
      bounds.maxZ - bounds.minZ,
      1,
    );
    const margin = Math.max(1, span * 0.08);
    const planeOffset = Math.max(0.35, span * 0.03);
    const baseX = bounds.minX - planeOffset;
    const baseY = bounds.minY - planeOffset;
    const baseZ = bounds.minZ - planeOffset;

    if (appearance.showGrid) {
      const majorSpacing = Math.max(0.5, Number(appearance.gridSpacing) || 2);
      const gridMargin = Math.max(9, span * 1.2);
      const gridSpan = Math.max(
        bounds.maxX - bounds.minX,
        bounds.maxY - bounds.minY,
        bounds.maxZ - bounds.minZ,
        1,
      ) + gridMargin * 2;
      let step = majorSpacing / 5;
      if (gridSpan / step > 60) step = majorSpacing / 2;
      if (gridSpan / step > 60) step = majorSpacing;
      const selectedPlane = ['xz', 'xy', 'yz'].includes(appearance.gridPlane)
        ? appearance.gridPlane
        : 'xz';
      const planes =
        appearance.gridMode === 'triple'
          ? ['xz', 'xy', 'yz']
          : [selectedPlane];
      const eps = step * 0.05;
      const x0 = Math.floor((bounds.minX - gridMargin) / step) * step;
      const x1 = Math.ceil((bounds.maxX + gridMargin) / step) * step;
      const y0 = Math.floor((bounds.minY - gridMargin) / step) * step;
      const y1 = Math.ceil((bounds.maxY + gridMargin) / step) * step;
      const z0 = Math.floor((bounds.minZ - gridMargin) / step) * step;
      const z1 = Math.ceil((bounds.maxZ + gridMargin) / step) * step;
      const centerX = (bounds.minX + bounds.maxX) / 2;
      const centerY = (bounds.minY + bounds.maxY) / 2;
      const centerZ = (bounds.minZ + bounds.maxZ) / 2;
      const halfX = Math.max((bounds.maxX - bounds.minX) / 2, 1);
      const halfY = Math.max((bounds.maxY - bounds.minY) / 2, 1);
      const halfZ = Math.max((bounds.maxZ - bounds.minZ) / 2, 1);
      const minorColor = '#71808b';
      const majorColor = '#b1bec7';
      const axisX = '#e5484d';
      const axisY = '#22c55e';
      const axisZ = '#4f7cff';
      const minorRadius = Math.max(0.006, span * 0.0012);
      const majorRadius = Math.max(0.009, span * 0.002);
      const axisRadius = Math.max(0.012, span * 0.0026);
      let count = 0;
      const addLine = (start, end, color, opacity, radius) => {
        if (count >= 700) return;
        this.viewer.addCylinder({ start, end, color, opacity, radius });
        count += 1;
      };
      const drawGridLine = (start, end, value, center, half, axisColor) => {
        if (axisColor) {
          addLine(start, end, axisColor, 1, axisRadius);
          return;
        }
        const major =
          Math.abs(value / majorSpacing - Math.round(value / majorSpacing)) < 1e-6;
        const fade = 1 - 0.3 * Math.min(1, Math.abs(value - center) / half);
        addLine(
          start,
          end,
          major ? majorColor : minorColor,
          (major ? 0.8 : 0.4) * fade,
          major ? majorRadius : minorRadius,
        );
      };
      const isZero = (value) => Math.abs(value) < 1e-6;
      const drawPlane = (plane) => {
        if (plane === 'xy') {
          for (let x = x0; x <= x1 + eps; x += step) {
            drawGridLine(
              { x, y: y0, z: baseZ },
              { x, y: y1, z: baseZ },
              x,
              centerX,
              halfX,
              isZero(x) ? axisY : null,
            );
          }
          for (let y = y0; y <= y1 + eps; y += step) {
            drawGridLine(
              { x: x0, y, z: baseZ },
              { x: x1, y, z: baseZ },
              y,
              centerY,
              halfY,
              isZero(y) ? axisX : null,
            );
          }
        } else if (plane === 'yz') {
          for (let y = y0; y <= y1 + eps; y += step) {
            drawGridLine(
              { x: baseX, y, z: z0 },
              { x: baseX, y, z: z1 },
              y,
              centerY,
              halfY,
              isZero(y) ? axisZ : null,
            );
          }
          for (let z = z0; z <= z1 + eps; z += step) {
            drawGridLine(
              { x: baseX, y: y0, z },
              { x: baseX, y: y1, z },
              z,
              centerZ,
              halfZ,
              isZero(z) ? axisY : null,
            );
          }
        } else {
          for (let x = x0; x <= x1 + eps; x += step) {
            drawGridLine(
              { x, y: baseY, z: z0 },
              { x, y: baseY, z: z1 },
              x,
              centerX,
              halfX,
              isZero(x) ? axisZ : null,
            );
          }
          for (let z = z0; z <= z1 + eps; z += step) {
            drawGridLine(
              { x: x0, y: baseY, z },
              { x: x1, y: baseY, z },
              z,
              centerZ,
              halfZ,
              isZero(z) ? axisX : null,
            );
          }
        }
      };
      planes.forEach((plane) => drawPlane(plane));

      if (appearance.showUnitLabels) {
        this.viewer.addLabel(
          `${planes.length === 3 ? '3 planes · ' : ''}Major ${majorSpacing} Å · minor ${step.toFixed(2)} Å`,
          {
            position: { x: x0, y: baseY, z: z0 },
            fontSize: 9,
            fontColor: '#9aa7af',
            backgroundColor: 'rgba(0,0,0,0)',
            backgroundOpacity: 0,
            inFront: false,
          },
        );
      }
    }

    if (appearance.showAxes) {
      const length = Math.max(30, span * 4);
      const origin = { x: baseX, y: baseY, z: baseZ };
      const axes = [
        { key: 'X', dir: { x: 1, y: 0, z: 0 }, color: '#e5484d' },
        { key: 'Y', dir: { x: 0, y: 1, z: 0 }, color: '#22c55e' },
        { key: 'Z', dir: { x: 0, y: 0, z: 1 }, color: '#4f7cff' },
      ];
      for (const axis of axes) {
        const end = {
          x: origin.x + axis.dir.x * length,
          y: origin.y + axis.dir.y * length,
          z: origin.z + axis.dir.z * length,
        };
        this.viewer.addCylinder({
          start: origin,
          end,
          radius: Math.max(0.035, span * 0.006),
          color: axis.color,
          opacity: 0.95,
        });
        if (appearance.showUnitLabels) {
          const labelDistance = Math.min(length, Math.max(4, span * 0.8));
          this.viewer.addLabel(`${axis.key} (Å)`, {
            position: {
              x: origin.x + axis.dir.x * labelDistance,
              y: origin.y + axis.dir.y * labelDistance,
              z: origin.z + axis.dir.z * labelDistance,
            },
            fontSize: 10,
            fontColor: axis.color,
            backgroundColor: 'rgba(0,0,0,0)',
            backgroundOpacity: 0,
            inFront: false,
          });
        }
      }
    }
  }

  updateScaleBar() {
    const bar = document.getElementById('scale-bar');
    const label = document.getElementById('scale-bar-label');
    const line = document.getElementById('scale-bar-line');
    if (!bar || !label || !line) return;
    const visible = Boolean(this.appearance?.showScaleBar) && Boolean(this.model);
    bar.hidden = !visible;
    if (!visible) return;

    const view = this.viewer.getView();
    const quaternion = { x: view[4], y: view[5], z: view[6], w: view[7] };
    const inverse = { x: -quaternion.x, y: -quaternion.y, z: -quaternion.z, w: quaternion.w };
    const center = { x: -view[0], y: -view[1], z: -view[2] };
    const right = rotateVector(1, 0, 0, inverse);
    const points = this.viewer.modelToScreen
      ? this.viewer.modelToScreen([
          center,
          {
            x: center.x + right.x,
            y: center.y + right.y,
            z: center.z + right.z,
          },
        ])
      : null;
    if (!points?.[0] || !points?.[1]) {
      bar.hidden = true;
      return;
    }
    const pixelsPerUnit = Math.hypot(
      points[1].x - points[0].x,
      points[1].y - points[0].y,
    );
    if (!Number.isFinite(pixelsPerUnit) || pixelsPerUnit <= 0) {
      bar.hidden = true;
      return;
    }
    const targetPixels = Math.min(180, Math.max(70, this.viewer.WIDTH * 0.14));
    const raw = targetPixels / pixelsPerUnit;
    const niceSteps = [0.5, 1, 2, 5, 10, 20, 50, 100];
    let chosen = niceSteps[0];
    for (const step of niceSteps) {
      if (step <= raw) chosen = step;
      else break;
    }
    const width = Math.max(36, Math.min(240, chosen * pixelsPerUnit));
    bar.style.setProperty('--scale-width', `${width.toFixed(1)}px`);
    label.textContent = chosen < 1 ? `${chosen.toFixed(1)} Å` : `${chosen} Å`;
  }

  setSelectionHighlight(specs) {
    this.selectionHighlight = Array.isArray(specs) ? specs : specs ? [specs] : [];
    this.drawSelectionHighlight();
  }

  drawSelectionHighlight() {
    if (!this.viewer) return;
    this.viewer.removeAllShapes();
    this.viewer.removeAllLabels?.();
    const specs = this.selectionHighlight || [];
    if (!specs.length) {
      this.drawOverlayShapes();
      this.updateScaleBar();
      this.viewer.render();
      return;
    }

    const color =
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() ||
      '#2dd4bf';

    for (const spec of specs) {
      if (spec.type === 'atom') {
        this.viewer.addSphere({
          center: spec.center,
          radius: 0.82,
          color,
          opacity: 0.22,
        });
        this.viewer.addSphere({
          center: spec.center,
          radius: 0.94,
          color,
          wireframe: true,
          opacity: 0.9,
        });
      } else if (spec.type === 'bond') {
        this.viewer.addCylinder({
          start: spec.start,
          end: spec.end,
          radius: 0.16,
          color,
          opacity: 0.5,
        });
        this.viewer.addCylinder({
          start: spec.start,
          end: spec.end,
          radius: 0.2,
          color,
          dashed: true,
          opacity: 0.95,
        });
      } else if (spec.type === 'connect-first') {
        this.viewer.addSphere({
          center: spec.center,
          radius: 0.78,
          color: '#f59e0b',
          opacity: 0.3,
        });
        this.viewer.addSphere({
          center: spec.center,
          radius: 0.92,
          color: '#f59e0b',
          wireframe: true,
          opacity: 0.95,
        });
      } else if (spec.type === 'custom-bond') {
        const order = Math.max(1, Math.min(3, Math.round(spec.order || 1)));
        const dx = spec.end.x - spec.start.x;
        const dy = spec.end.y - spec.start.y;
        const dz = spec.end.z - spec.start.z;
        const length = Math.hypot(dx, dy, dz) || 1;
        const up =
          Math.abs(dy / length) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
        let px = dy * up.z - dz * up.y;
        let py = dz * up.x - dx * up.z;
        let pz = dx * up.y - dy * up.x;
        const plen = Math.hypot(px, py, pz) || 1;
        px /= plen;
        py /= plen;
        pz /= plen;

        const spacing = (spec.radius || 0.1) * 2.2;
        const offsets = order === 1 ? [0] : order === 2 ? [-1, 1] : [-1, 0, 1];

        for (const offset of offsets) {
          const ox = px * spacing * offset;
          const oy = py * spacing * offset;
          const oz = pz * spacing * offset;
          const start = {
            x: spec.start.x + ox,
            y: spec.start.y + oy,
            z: spec.start.z + oz,
          };
          const end = {
            x: spec.end.x + ox,
            y: spec.end.y + oy,
            z: spec.end.z + oz,
          };
          const middle = {
            x: (start.x + end.x) / 2,
            y: (start.y + end.y) / 2,
            z: (start.z + end.z) / 2,
          };

          if (spec.arrow) {
            const headStart = {
              x: start.x + (end.x - start.x) * 0.78,
              y: start.y + (end.y - start.y) * 0.78,
              z: start.z + (end.z - start.z) * 0.78,
            };
            this.viewer.addCylinder({
              start,
              end: headStart,
              radius: spec.radius,
              color: spec.colorA,
              opacity: spec.opacity,
            });
            this.viewer.addArrow({
              start: headStart,
              end,
              radius: spec.radius * 1.15,
              color: spec.colorB,
              opacity: spec.opacity,
              mid: 0.72,
              radiusRatio: 1.8,
            });
          } else {
            this.viewer.addCylinder({
              start,
              end: middle,
              radius: spec.radius,
              color: spec.colorA,
              opacity: spec.opacity,
              dashed: Boolean(spec.dashed),
            });
            this.viewer.addCylinder({
              start: middle,
              end,
              radius: spec.radius,
              color: spec.colorB,
              opacity: spec.opacity,
              dashed: Boolean(spec.dashed),
            });
          }
        }
      }
    }
    this.drawOverlayShapes();
    this.updateScaleBar();
    this.viewer.render();
  }

  setLayerOptions(options) {
    this.modelLayers = Array.isArray(options) ? options : [];
    this.applyStyle();
  }

  setSpin(enabled) {
    this.spinning = Boolean(enabled);
    if (!this.viewer) return;
    this.viewer.spin(this.spinning);
  }

  async setSurface(enabled) {
    if (!this.viewer || !this.model) return false;
    if (!enabled) {
      this.viewer.removeAllSurfaces();
      this.surfaceVisible = false;
      this.viewer.render();
      return false;
    }
    this.viewer.addSurface(window.$3Dmol.SurfaceType.VDW, {
      opacity: this.appearance.surfaceOpacity,
      color: this.appearance.surfaceColor,
    });
    this.surfaceVisible = true;
    this.viewer.render();
    return true;
  }

  refreshSurface() {
    if (!this.viewer || !this.surfaceVisible) return;
    this.viewer.removeAllSurfaces();
    this.viewer.addSurface(window.$3Dmol.SurfaceType.VDW, {
      opacity: this.appearance.surfaceOpacity,
      color: this.appearance.surfaceColor,
    });
    this.viewer.render();
  }

  resetView() {
    if (!this.viewer || !this.model) return;
    this.cancelViewAnimation();
    if (this.homeView) this.viewer.setView(this.homeView);
    this.viewer.removeAllShapes();
    this.viewer.zoomTo();
    this.drawSelectionHighlight();
    this.viewer.render();
  }

  fitScene() {
    if (!this.viewer) return;
    this.viewer.removeAllShapes();
    this.viewer.zoomTo();
    this.drawSelectionHighlight();
    this.viewer.render();
    this.homeView = this.viewer.getView();
    this.updateScaleBar();
  }

  resize() {
    if (!this.viewer) return;
    this.viewer.resize();
    this.viewer.render();
    this.updateGizmo();
    this.updateScaleBar();
  }

  /**
   * High-resolution PNG with 2× supersampling and a high-quality downsample.
   * The on-screen canvas is restored before the blob is returned.
   */
  async screenshot(targetLongEdge = 3600) {
    if (!this.viewer || !this.model) throw new Error('No 3D model is loaded.');
    this.cancelViewAnimation();

    const canvas = this.viewer.renderer.getCanvas();
    const cssWidth = this.viewer.WIDTH || this.container.clientWidth || canvas.clientWidth;
    const cssHeight = this.viewer.HEIGHT || this.container.clientHeight || canvas.clientHeight;
    const cssLongEdge = Math.max(cssWidth, cssHeight, 1);
    const gl =
      this.viewer.renderer._gl ||
      canvas.getContext('webgl2') ||
      canvas.getContext('webgl') ||
      canvas.getContext('experimental-webgl');

    const maxDimension =
      (gl &&
        Math.min(
          gl.getParameter(gl.MAX_RENDERBUFFER_SIZE) || 8192,
          gl.getParameter(gl.MAX_TEXTURE_SIZE) || 8192,
        )) ||
      8192;

    const baseScale = this.viewer.renderer.devicePixelRatio || 2;
    const maxScale = maxDimension / cssLongEdge;
    const targetScale = Math.max(baseScale, targetLongEdge / cssLongEdge);
    const finalScale = Math.min(targetScale, maxScale, 6);

    const pixelBudget = 34_000_000;
    const budgetScale = Math.sqrt(pixelBudget / (cssWidth * cssHeight));
    let renderScale = Math.min(
      finalScale * 2,
      maxScale,
      9,
      Math.max(finalScale, budgetScale),
    );
    const supersampled = renderScale >= finalScale * 1.2;
    if (!supersampled) renderScale = finalScale;

    const targetWidth = Math.max(1, Math.round(cssWidth * finalScale));
    const targetHeight = Math.max(1, Math.round(cssHeight * finalScale));

    const wasSpinning = this.spinning;
    if (wasSpinning) this.viewer.spin(false);

    const originalDPR = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    let dataUri;
    let sourceWidth;
    let sourceHeight;

    this.viewer.render();
    try {
      if (originalDPR?.configurable) {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          get: () => renderScale,
        });
      }
      this.viewer.resize();
      this.viewer.render();
      sourceWidth = canvas.width;
      sourceHeight = canvas.height;
      dataUri = this.viewer.pngURI();
    } finally {
      if (originalDPR) Object.defineProperty(window, 'devicePixelRatio', originalDPR);
      else delete window.devicePixelRatio;
      this.viewer.resize();
      this.viewer.render();
      if (wasSpinning) this.viewer.spin(true);
    }

    const sourceBlob = await (await fetch(dataUri)).blob();

    if (
      !supersampled ||
      typeof createImageBitmap !== 'function' ||
      sourceWidth <= targetWidth * 1.1
    ) {
      return {
        blob: sourceBlob,
        width: sourceWidth,
        height: sourceHeight,
        supersampled: false,
      };
    }

    try {
      const bitmap = await createImageBitmap(sourceBlob);
      const output = document.createElement('canvas');
      output.width = targetWidth;
      output.height = targetHeight;
      const context = output.getContext('2d');
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, 0, 0, targetWidth, targetHeight);
      bitmap.close?.();
      const blob = await new Promise((resolve, reject) => {
        output.toBlob(
          (encoded) =>
            encoded ? resolve(encoded) : reject(new Error('The PNG could not be encoded.')),
          'image/png',
        );
      });
      return { blob, width: targetWidth, height: targetHeight, supersampled: true };
    } catch (error) {
      console.warn('Supersampled PNG export fell back to a direct capture:', error);
      return {
        blob: sourceBlob,
        width: sourceWidth,
        height: sourceHeight,
        supersampled: false,
      };
    }
  }
}
