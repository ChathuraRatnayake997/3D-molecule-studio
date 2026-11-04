/**
 * GLB (binary glTF 2.0) exporter.
 *
 * Builds a ball-and-stick mesh from the coordinates and display state supplied
 * by the app. No geometry is fetched from a third party: every sphere and
 * cylinder is generated locally from the scene data.
 */

const ELEMENT_COLORS = {
  H: 0xffffff,
  C: 0x909090,
  N: 0x3050f8,
  O: 0xff0d0d,
  F: 0x90e050,
  Cl: 0x1ff01f,
  Br: 0xa62929,
  I: 0x940094,
  S: 0xffff30,
  P: 0xff8000,
  B: 0xffb5b5,
  Si: 0xf0c8a0,
  Na: 0xab5cf2,
  K: 0x8f40d4,
  Mg: 0x8aff00,
  Ca: 0x3dff00,
  Fe: 0xe06633,
  Zn: 0x7d80b0,
  Cu: 0xc88033,
  Ni: 0x50d050,
  Mn: 0x9c7ac7,
  Co: 0xf090a0,
  Se: 0xffa100,
  As: 0xbd80e3,
  Al: 0xbfa6a6,
  Li: 0xcc80ff,
  He: 0xd9ffff,
  Ne: 0xb3e3f5,
  Ar: 0x80d1e3,
  Ti: 0xbfc2c7,
  Cr: 0x8a99c7,
  Ag: 0xc0c0c0,
  Au: 0xffd123,
  Pt: 0xd0d0e0,
  Hg: 0xb8b8d0,
  Pb: 0x575961,
};

const ELEMENT_RADII = {
  H: 0.21,
  C: 0.33,
  N: 0.31,
  O: 0.3,
  F: 0.27,
  Si: 0.44,
  P: 0.43,
  S: 0.42,
  Cl: 0.4,
  Br: 0.46,
  I: 0.5,
  B: 0.36,
  Se: 0.44,
  As: 0.43,
};

const DEFAULT_COLOR = 0xff1493;
const DEFAULT_RADIUS = 0.38;
const BOND_RADIUS = 0.09;

/** Quality presets for the generated mesh. */
export const GLB_QUALITY_PRESETS = {
  draft: {
    label: 'Draft',
    sphereStacks: 8,
    sphereSlices: 12,
    cylinderSegments: 8,
    dashSegments: 6,
  },
  standard: {
    label: 'Standard',
    sphereStacks: 14,
    sphereSlices: 20,
    cylinderSegments: 12,
    dashSegments: 8,
  },
  high: {
    label: 'High',
    sphereStacks: 28,
    sphereSlices: 40,
    cylinderSegments: 24,
    dashSegments: 12,
  },
  ultra: {
    label: 'Ultra',
    sphereStacks: 44,
    sphereSlices: 64,
    cylinderSegments: 36,
    dashSegments: 16,
  },
};

/* ------------------------------- helpers ------------------------------- */

const normalize = (v) => {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
};

const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const srgbToLinear = (value) =>
  value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;

function colorToLinear(hex) {
  return [
    srgbToLinear(((hex >> 16) & 255) / 255),
    srgbToLinear(((hex >> 8) & 255) / 255),
    srgbToLinear((hex & 255) / 255),
  ];
}

function parseColor(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value & 0xffffff;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^#[0-9a-f]{6}$/i.test(text)) return parseInt(text.slice(1), 16);
    if (/^#[0-9a-f]{3}$/i.test(text)) {
      return parseInt(
        text
          .slice(1)
          .split('')
          .map((digit) => digit + digit)
          .join(''),
        16,
      );
    }
    if (/^0x[0-9a-f]{1,6}$/i.test(text)) return parseInt(text.slice(2), 16);
  }
  return DEFAULT_COLOR;
}

function elementColor(element) {
  return ELEMENT_COLORS[element] ?? DEFAULT_COLOR;
}

function elementRadius(element) {
  return ELEMENT_RADII[element] ?? DEFAULT_RADIUS;
}

function clampOpacity(value) {
  if (value == null) return 1;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0.05, number)) : 1;
}

/* ---------------------------- mesh builders ---------------------------- */

function addSphere(
  positions,
  normals,
  indices,
  cx,
  cy,
  cz,
  radius,
  stacks,
  slices,
) {
  const base = positions.length / 3;

  for (let i = 0; i <= stacks; i += 1) {
    const phi = (Math.PI * i) / stacks;
    const y = Math.cos(phi);
    const ring = Math.sin(phi);
    for (let j = 0; j <= slices; j += 1) {
      const theta = (2 * Math.PI * j) / slices;
      const x = ring * Math.cos(theta);
      const z = ring * Math.sin(theta);
      positions.push(cx + radius * x, cy + radius * y, cz + radius * z);
      normals.push(x, y, z);
    }
  }

  for (let i = 0; i < stacks; i += 1) {
    for (let j = 0; j < slices; j += 1) {
      const a = base + i * (slices + 1) + j;
      const b = a + slices + 1;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
}

function addCylinder(
  positions,
  normals,
  indices,
  from,
  to,
  radius,
  segments,
) {
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  if (Math.hypot(...axis) < 1e-8) return;
  const direction = normalize(axis);

  const reference = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(direction, reference));
  const v = cross(direction, u);

  const base = positions.length / 3;

  for (let i = 0; i <= segments; i += 1) {
    const theta = (2 * Math.PI * i) / segments;
    const nx = u[0] * Math.cos(theta) + v[0] * Math.sin(theta);
    const ny = u[1] * Math.cos(theta) + v[1] * Math.sin(theta);
    const nz = u[2] * Math.cos(theta) + v[2] * Math.sin(theta);

    positions.push(
      from[0] + nx * radius,
      from[1] + ny * radius,
      from[2] + nz * radius,
    );
    normals.push(nx, ny, nz);
    positions.push(to[0] + nx * radius, to[1] + ny * radius, to[2] + nz * radius);
    normals.push(nx, ny, nz);
  }

  for (let i = 0; i < segments; i += 1) {
    const a0 = base + i * 2;
    const b0 = a0 + 1;
    const a1 = a0 + 2;
    const b1 = a0 + 3;
    indices.push(a0, a1, b0, a1, b1, b0);
  }

  for (const [center, normal, flip] of [
    [from, [-direction[0], -direction[1], -direction[2]], true],
    [to, direction, false],
  ]) {
    const capBase = positions.length / 3;
    positions.push(center[0], center[1], center[2]);
    normals.push(normal[0], normal[1], normal[2]);

    for (let i = 0; i <= segments; i += 1) {
      const theta = (2 * Math.PI * i) / segments;
      const nx = u[0] * Math.cos(theta) + v[0] * Math.sin(theta);
      const ny = u[1] * Math.cos(theta) + v[1] * Math.sin(theta);
      const nz = u[2] * Math.cos(theta) + v[2] * Math.sin(theta);
      positions.push(
        center[0] + nx * radius,
        center[1] + ny * radius,
        center[2] + nz * radius,
      );
      normals.push(normal[0], normal[1], normal[2]);
    }

    for (let i = 0; i < segments; i += 1) {
      const p0 = capBase + 1 + i;
      const p1 = p0 + 1;
      if (flip) indices.push(capBase, p1, p0);
      else indices.push(capBase, p0, p1);
    }
  }
}

function addCone(positions, normals, indices, basePoint, tip, radius, segments) {
  const axis = [
    tip[0] - basePoint[0],
    tip[1] - basePoint[1],
    tip[2] - basePoint[2],
  ];
  const length = Math.hypot(...axis);
  if (length < 1e-8) return;
  const direction = normalize(axis);
  const reference = Math.abs(direction[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(direction, reference));
  const v = cross(direction, u);

  const base = positions.length / 3;
  // Base centre.
  positions.push(basePoint[0], basePoint[1], basePoint[2]);
  normals.push(-direction[0], -direction[1], -direction[2]);

  for (let i = 0; i <= segments; i += 1) {
    const theta = (2 * Math.PI * i) / segments;
    const nx = u[0] * Math.cos(theta) + v[0] * Math.sin(theta);
    const ny = u[1] * Math.cos(theta) + v[1] * Math.sin(theta);
    const nz = u[2] * Math.cos(theta) + v[2] * Math.sin(theta);
    positions.push(
      basePoint[0] + nx * radius,
      basePoint[1] + ny * radius,
      basePoint[2] + nz * radius,
    );
    // Approximate side normals by blending outward and forward.
    const side = normalize([nx + direction[0] * 0.75, ny + direction[1] * 0.75, nz + direction[2] * 0.75]);
    normals.push(side[0], side[1], side[2]);
  }

  const tipIndex = positions.length / 3;
  positions.push(tip[0], tip[1], tip[2]);
  normals.push(direction[0], direction[1], direction[2]);

  for (let i = 0; i < segments; i += 1) {
    const p0 = base + 1 + i;
    const p1 = p0 + 1;
    indices.push(base, p1, p0);
    indices.push(p0, p1, tipIndex);
  }
}

function addDashedCylinder(
  positions,
  normals,
  indices,
  from,
  to,
  radius,
  segments,
  dashCount,
) {
  const axis = [to[0] - from[0], to[1] - from[1], to[2] - from[2]];
  const length = Math.hypot(...axis);
  if (length < 1e-8) return;
  const count = Math.max(2, Math.min(40, dashCount));
  const step = length / count;
  for (let i = 0; i < count; i += 1) {
    const start = i / count;
    const end = Math.min(1, start + 1 / count * 0.58);
    const a = [
      from[0] + axis[0] * start,
      from[1] + axis[1] * start,
      from[2] + axis[2] * start,
    ];
    const b = [
      from[0] + axis[0] * end,
      from[1] + axis[1] * end,
      from[2] + axis[2] * end,
    ];
    addCylinder(positions, normals, indices, a, b, radius, Math.max(6, Math.round(segments / 2)));
  }
}

/* ----------------------------- GLB assembly ----------------------------- */

function buildSceneMesh(scene, options = {}) {
  const quality =
    GLB_QUALITY_PRESETS[options.quality] || GLB_QUALITY_PRESETS.high;
  const baseBondRadius = Number(options.bondRadius) || BOND_RADIUS;
  const nodes = (scene.nodes || []).filter((node) => node?.atoms?.length);
  if (!nodes.length) throw new Error('No atoms available for mesh export.');

  // Centre the visible scene at its centroid and map chemistry (x, y, z)
  // onto glTF's Y-up frame. This preserves every editor transform because the
  // positions passed in are already in scene space.
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (const node of nodes) {
    for (const atom of node.atoms) {
      if (atom.visible === false) continue;
      cx += atom.x;
      cy += atom.y;
      cz += atom.z;
      count += 1;
    }
  }
  if (!count) {
    for (const node of nodes) {
      for (const atom of node.atoms) {
        cx += atom.x;
        cy += atom.y;
        cz += atom.z;
        count += 1;
      }
    }
  }
  cx /= count || 1;
  cy /= count || 1;
  cz /= count || 1;

  const toScene = (x, y, z) => [x - cx, z - cz, -(y - cy)];

  /** @type {Map<string, {color:number, opacity:number, positions:number[], normals:number[], indices:number[]}>} */
  const groups = new Map();

  const groupFor = (colorValue, opacityValue) => {
    const color = parseColor(colorValue);
    const opacity = clampOpacity(opacityValue);
    const key = `${color}:${opacity.toFixed(3)}`;
    let group = groups.get(key);
    if (!group) {
      group = {
        color,
        opacity,
        positions: [],
        normals: [],
        indices: [],
      };
      groups.set(key, group);
    }
    return group;
  };

  const addSphereAt = (atom) => {
    if (atom.visible === false) return;
    const group = groupFor(atom.color ?? elementColor(atom.element), atom.opacity);
    const [x, y, z] = toScene(atom.x, atom.y, atom.z);
    const radius =
      elementRadius(atom.element) * (Number(atom.scale) || 1);
    addSphere(
      group.positions,
      group.normals,
      group.indices,
      x,
      y,
      z,
      radius,
      quality.sphereStacks,
      quality.sphereSlices,
    );
  };

  const addBondSegment = (from, to, radius, color, opacity, { dashed = false } = {}) => {
    const group = groupFor(color, opacity);
    if (dashed) {
      addDashedCylinder(
        group.positions,
        group.normals,
        group.indices,
        from,
        to,
        radius,
        quality.cylinderSegments,
        quality.dashSegments,
      );
    } else {
      addCylinder(
        group.positions,
        group.normals,
        group.indices,
        from,
        to,
        radius,
        quality.cylinderSegments,
      );
    }
  };

  for (const node of nodes) {
    if (node.showAtoms !== false) {
      for (const atom of node.atoms) addSphereAt(atom);
    }
    if (node.showBonds === false) continue;

    for (const bond of node.bonds || []) {
      const atomA = node.atoms[bond.a];
      const atomB = node.atoms[bond.b];
      if (!atomA || !atomB) continue;

      const a = toScene(atomA.x, atomA.y, atomA.z);
      const b = toScene(atomB.x, atomB.y, atomB.z);
      const order = Math.max(1, Math.min(3, Math.round(Number(bond.order) || 1)));
      const radius =
        baseBondRadius * (Number(bond.scale) || 1);
      const orderRadius =
        radius * (order === 1 ? 1 : order === 2 ? 0.65 : 0.55);
      const colorA =
        bond.colorA ?? atomA.color ?? elementColor(atomA.element);
      const colorB =
        bond.colorB ?? atomB.color ?? elementColor(atomB.element);
      const opacityA = bond.opacityA ?? bond.opacity ?? atomA.opacity;
      const opacityB = bond.opacityB ?? bond.opacity ?? atomB.opacity;

      const dir = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
      const reference = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const perpendicular = normalize(cross(dir, reference));
      const offsets =
        order === 2 ? [-1, 1] : order === 3 ? [-1, 0, 1] : [0];
      const spacing =
        order === 2
          ? Math.max(0.095, radius * 1.1)
          : order === 3
            ? Math.max(0.13, radius * 1.2)
            : 0;

      for (const offset of offsets) {
        const shift = perpendicular.map((component) => component * offset * spacing);
        const aShifted = [a[0] + shift[0], a[1] + shift[1], a[2] + shift[2]];
        const bShifted = [b[0] + shift[0], b[1] + shift[1], b[2] + shift[2]];
        const mid = [
          (aShifted[0] + bShifted[0]) / 2,
          (aShifted[1] + bShifted[1]) / 2,
          (aShifted[2] + bShifted[2]) / 2,
        ];
        addBondSegment(aShifted, mid, orderRadius, colorA, opacityA);
        addBondSegment(mid, bShifted, orderRadius, colorB, opacityB);
      }
    }
  }

  // Custom-coloured internal bonds and added cross-compound bonds already carry
  // scene-space endpoints from the editor.
  for (const bond of scene.customBonds || []) {
    const a = toScene(bond.start.x, bond.start.y, bond.start.z);
    const b = toScene(bond.end.x, bond.end.y, bond.end.z);
    const order = Math.max(1, Math.min(3, Math.round(Number(bond.order) || 1)));
    const radius = bond.radius || BOND_RADIUS;
    const orderRadius =
      radius * (order === 1 ? 1 : order === 2 ? 0.65 : 0.55);
    const dir = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const reference = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perpendicular = normalize(cross(dir, reference));
    const offsets = order === 2 ? [-1, 1] : order === 3 ? [-1, 0, 1] : [0];
    const spacing =
      order === 2
        ? Math.max(0.095, radius * 1.1)
        : order === 3
          ? Math.max(0.13, radius * 1.2)
          : 0;
    for (const offset of offsets) {
      const shift = perpendicular.map(
        (component) => component * offset * spacing,
      );
      const aShifted = [a[0] + shift[0], a[1] + shift[1], a[2] + shift[2]];
      const bShifted = [b[0] + shift[0], b[1] + shift[1], b[2] + shift[2]];
      const mid = [
        (aShifted[0] + bShifted[0]) / 2,
        (aShifted[1] + bShifted[1]) / 2,
        (aShifted[2] + bShifted[2]) / 2,
      ];
      addBondSegment(aShifted, mid, orderRadius, bond.colorA, bond.opacity, { dashed: bond.dashed });
      addBondSegment(mid, bShifted, orderRadius, bond.colorB, bond.opacity, { dashed: bond.dashed });
    }
  }

  for (const bond of scene.connections || []) {
    const a = toScene(bond.start.x, bond.start.y, bond.start.z);
    const b = toScene(bond.end.x, bond.end.y, bond.end.z);
    const radius = Math.max(0.03, bond.radius || BOND_RADIUS);
    const colorA = bond.colorA ?? DEFAULT_COLOR;
    const colorB = bond.colorB ?? colorA;
    const order = Math.max(1, Math.min(3, Math.round(Number(bond.order) || 1)));
    const orderRadius =
      radius * (order === 1 ? 1 : order === 2 ? 0.65 : 0.55);
    const dir = normalize([b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
    const reference = Math.abs(dir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const perpendicular = normalize(cross(dir, reference));
    const offsets = order === 2 ? [-1, 1] : order === 3 ? [-1, 0, 1] : [0];
    const spacing =
      order === 2
        ? Math.max(0.095, radius * 1.1)
        : order === 3
          ? Math.max(0.13, radius * 1.2)
          : 0;

    for (const offset of offsets) {
      const shift = perpendicular.map((component) => component * offset * spacing);
      const aShifted = [a[0] + shift[0], a[1] + shift[1], a[2] + shift[2]];
      const bShifted = [b[0] + shift[0], b[1] + shift[1], b[2] + shift[2]];
      const mid = [
        (aShifted[0] + bShifted[0]) / 2,
        (aShifted[1] + bShifted[1]) / 2,
        (aShifted[2] + bShifted[2]) / 2,
      ];

      if (bond.arrow) {
        const headStart = [
          aShifted[0] + (bShifted[0] - aShifted[0]) * 0.8,
          aShifted[1] + (bShifted[1] - aShifted[1]) * 0.8,
          aShifted[2] + (bShifted[2] - aShifted[2]) * 0.8,
        ];
        addBondSegment(aShifted, mid, orderRadius, colorA, bond.opacity);
        addBondSegment(mid, headStart, orderRadius, colorB, bond.opacity);
        const group = groupFor(colorB, bond.opacity);
        addCone(
          group.positions,
          group.normals,
          group.indices,
          headStart,
          bShifted,
          orderRadius * 1.8,
          quality.cylinderSegments,
        );
      } else {
        addBondSegment(aShifted, mid, orderRadius, colorA, bond.opacity, { dashed: bond.dashed });
        addBondSegment(mid, bShifted, orderRadius, colorB, bond.opacity, { dashed: bond.dashed });
      }
    }
  }

  if (!groups.size) throw new Error('No mesh geometry could be generated.');
  return { groups, quality };
}

function packGlb(gltf, binParts, binLength) {
  gltf.buffers[0].byteLength = binLength;
  const jsonBytes = new TextEncoder().encode(JSON.stringify(gltf));
  const jsonPadding = (4 - (jsonBytes.length % 4)) % 4;
  const jsonChunkLength = jsonBytes.length + jsonPadding;
  const binPadding = (4 - (binLength % 4)) % 4;
  const binChunkLength = binLength + binPadding;
  const totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

  const output = new ArrayBuffer(totalLength);
  const view = new DataView(output);
  const bytes = new Uint8Array(output);

  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, totalLength, true);
  view.setUint32(12, jsonChunkLength, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(jsonBytes, 20);
  bytes.fill(0x20, 20 + jsonBytes.length, 20 + jsonChunkLength);

  const binStart = 20 + jsonChunkLength;
  view.setUint32(binStart, binChunkLength, true);
  view.setUint32(binStart + 4, 0x004e4942, true);
  let offset = binStart + 8;
  for (const part of binParts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }

  return { bytes: new Uint8Array(output), json: gltf };
}

/**
 * Build a GLB from a prepared multi-compound scene description.
 *
 * @param {{
 *   nodes: Array<{
 *     name?: string,
 *     showAtoms?: boolean,
 *     showBonds?: boolean,
 *     atoms: Array<{x:number,y:number,z:number,element:string,scale?:number,color?:string|number,opacity?:number,visible?:boolean}>,
 *     bonds?: Array<{a:number,b:number,order?:number,scale?:number,colorA?:string|number,colorB?:string|number,opacity?:number,opacityA?:number,opacityB?:number}>
 *   }>,
 *   customBonds?: Array<{start:{x:number,y:number,z:number},end:{x:number,y:number,z:number},colorA?:string|number,colorB?:string|number,radius?:number,opacity?:number,order?:number,dashed?:boolean}>,
 *   connections?: Array<{start:{x:number,y:number,z:number},end:{x:number,y:number,z:number},colorA?:string|number,colorB?:string|number,radius?:number,opacity?:number,order?:number,dashed?:boolean,arrow?:boolean}>
 * }} scene
 * @param {object} meta
 * @param {{quality?: 'draft'|'standard'|'high'|'ultra'}} options
 */
export function buildSceneGlb(scene, meta = {}, options = {}) {
  const { groups, quality } = buildSceneMesh(scene, options);

  /** @type {any[]} */
  const accessors = [];
  /** @type {any[]} */
  const bufferViews = [];
  /** @type {Uint8Array[]} */
  const binParts = [];
  let binLength = 0;

  const addBufferView = (typedArray, target) => {
    const alignment = (4 - (binLength % 4)) % 4;
    if (alignment) {
      binParts.push(new Uint8Array(alignment));
      binLength += alignment;
    }

    const bytes = new Uint8Array(
      typedArray.buffer,
      typedArray.byteOffset,
      typedArray.byteLength,
    );
    const byteOffset = binLength;
    binParts.push(bytes);
    binLength += bytes.byteLength;

    bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      target,
    });
    return bufferViews.length - 1;
  };

  const addAccessor = (accessor) => {
    accessors.push(accessor);
    return accessors.length - 1;
  };

  const primitives = [];
  const materials = [];

  for (const group of groups.values()) {
    if (!group.indices.length) continue;

    const positions = new Float32Array(group.positions);
    const normals = new Float32Array(group.normals);
    const indices = new Uint32Array(group.indices);

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }

    const positionView = addBufferView(positions, 34962);
    const normalView = addBufferView(normals, 34962);
    const indexView = addBufferView(indices, 34963);

    const positionAccessor = addAccessor({
      bufferView: positionView,
      componentType: 5126,
      count: positions.length / 3,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ],
    });
    const normalAccessor = addAccessor({
      bufferView: normalView,
      componentType: 5126,
      count: normals.length / 3,
      type: 'VEC3',
    });
    const indexAccessor = addAccessor({
      bufferView: indexView,
      componentType: 5125,
      count: indices.length,
      type: 'SCALAR',
    });

    const materialIndex = materials.length;
    const alpha = clampOpacity(group.opacity);
    materials.push({
      name: `Colour ${group.color.toString(16).padStart(6, '0')}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...colorToLinear(group.color), alpha],
        metallicFactor: 0.05,
        roughnessFactor: 0.5,
      },
      alphaMode: alpha < 0.999 ? 'BLEND' : 'OPAQUE',
      doubleSided: true,
    });

    primitives.push({
      attributes: {
        POSITION: positionAccessor,
        NORMAL: normalAccessor,
      },
      indices: indexAccessor,
      material: materialIndex,
      mode: 4,
    });
  }

  const compounds = (scene.nodes || []).map((node, index) => ({
    name: node.name ?? null,
    cid: node.cid ?? meta.entries?.[index]?.cid ?? null,
    atoms: node.atoms?.length ?? 0,
    bonds: node.bonds?.length ?? 0,
    showAtoms: node.showAtoms !== false,
    showBonds: node.showBonds !== false,
    transform: node.transform ?? meta.entries?.[index]?.transform ?? null,
    sdfSha256: node.hash ?? meta.entries?.[index]?.hash ?? null,
  }));

  const gltf = {
    asset: {
      version: '2.0',
      generator: '3D Molecule Studio',
      extras: {
        source: 'NCBI PubChem',
        cid: meta.cid ?? null,
        retrievedAt: meta.retrievedAt ?? null,
        sdfSha256: meta.sha256 ?? null,
        quality: quality.label,
        style: meta.style ?? null,
        units: 'angstrom',
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        mesh: 0,
        name: meta.title || `CID ${meta.cid ?? 'scene'}`,
      },
    ],
    meshes: [
      {
        name: meta.title || `Molecule CID ${meta.cid ?? 'scene'}`,
        primitives,
      },
    ],
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: 0 }],
    extras: {
      cid: meta.cid ?? null,
      title: meta.title ?? null,
      formula: meta.formula ?? null,
      sourceUrl: meta.sourceUrl ?? null,
      sdfSha256: meta.sha256 ?? null,
      quality: options.quality || 'high',
      style: meta.style ?? null,
      compounds,
      connections: (scene.connections || []).length,
      note: 'Scene-space coordinates from the editor, with display transforms and hidden-layer state applied. Mesh generated locally for visualization.',
    },
  };

  return packGlb(gltf, binParts, binLength);
}

/**
 * Legacy single-molecule GLB export. Kept for callers that only have a parsed
 * molecule; the editor now uses buildSceneGlb().
 *
 * @param {import('./sdf.js').Molecule} molecule
 * @param {{cid: number, title?: string, sha256?: string|null, retrievedAt?: string, sourceUrl?: string}} meta
 * @param {{quality?: 'draft'|'standard'|'high'|'ultra'}} options
 */
export function buildGlb(molecule, meta = {}, options = {}) {
  if (!molecule?.atoms?.length) throw new Error('No atoms available for mesh export.');
  const atoms = molecule.atoms.map((atom) => ({
    x: atom.x,
    y: atom.y,
    z: atom.z,
    element: atom.element,
    scale: 1,
    color: elementColor(atom.element),
    opacity: 1,
  }));
  const bonds = (molecule.bonds || []).map((bond) => ({
    a: bond.a,
    b: bond.b,
    order: bond.order,
    scale: 1,
    colorA: elementColor(molecule.atoms[bond.a]?.element),
    colorB: elementColor(molecule.atoms[bond.b]?.element),
    opacity: 1,
  }));
  return buildSceneGlb(
    {
      nodes: [
        {
          name: meta.title || `CID ${meta.cid}`,
          atoms,
          bonds,
          showAtoms: true,
          showBonds: true,
        },
      ],
    },
    meta,
    options,
  );
}
