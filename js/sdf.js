/**
 * Minimal, dependency-free SDF/MOL reader and text exporters.
 *
 * Parsing is used only for geometry (viewer counts, XYZ and GLB meshes).
 * The original SDF is always kept byte-for-byte for download.
 */

/**
 * @typedef {Object} Atom
 * @property {string} element
 * @property {number} x
 * @property {number} y
 * @property {number} z
 *
 * @typedef {Object} Bond
 * @property {number} a 0-based atom index
 * @property {number} b 0-based atom index
 * @property {number} order
 *
 * @typedef {Object} Molecule
 * @property {string} title
 * @property {string} program
 * @property {string} comment
 * @property {'V2000'|'V3000'} version
 * @property {number} declaredAtomCount
 * @property {number} declaredBondCount
 * @property {Atom[]} atoms
 * @property {Bond[]} bonds
 */

const countAtoms = (line) => Number.parseInt(line.slice(0, 3), 10);
const countBonds = (line) => Number.parseInt(line.slice(3, 6), 10);

/**
 * @param {string} text raw SDF record
 * @returns {Molecule}
 */
export function parseSdf(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('Empty SDF record.');
  }

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const countsIndex = lines.findIndex(
    (line, index) => index >= 2 && /\bV(2000|3000)\b/.test(line),
  );

  if (countsIndex === -1) {
    throw new Error('Not a recognizable V2000/V3000 SDF record.');
  }

  const countsLine = lines[countsIndex];
  const version = /\bV3000\b/.test(countsLine) ? 'V3000' : 'V2000';

  const molecule = {
    title: (lines[0] || '').trim() || 'Untitled',
    program: (lines[1] || '').trim(),
    comment: (lines[2] || '').trim(),
    version,
    declaredAtomCount: 0,
    declaredBondCount: 0,
    atoms: [],
    bonds: [],
  };

  if (version === 'V2000') {
    const atomCount = countAtoms(countsLine);
    const bondCount = countBonds(countsLine);
    if (!Number.isFinite(atomCount) || !Number.isFinite(bondCount)) {
      throw new Error('Invalid V2000 counts line.');
    }
    molecule.declaredAtomCount = atomCount;
    molecule.declaredBondCount = bondCount;

    const atomStart = countsIndex + 1;
    for (let i = 0; i < atomCount; i += 1) {
      const line = lines[atomStart + i];
      if (!line) throw new Error(`Missing atom line ${i + 1}.`);
      const x = Number.parseFloat(line.slice(0, 10));
      const y = Number.parseFloat(line.slice(10, 20));
      const z = Number.parseFloat(line.slice(20, 30));
      const element = line.slice(31, 34).trim() || 'X';
      if (![x, y, z].every(Number.isFinite)) {
        throw new Error(`Invalid coordinates on atom line ${i + 1}.`);
      }
      molecule.atoms.push({ element, x, y, z });
    }

    const bondStart = atomStart + atomCount;
    for (let i = 0; i < bondCount; i += 1) {
      const line = lines[bondStart + i];
      if (!line) throw new Error(`Missing bond line ${i + 1}.`);
      const a = Number.parseInt(line.slice(0, 3), 10) - 1;
      const b = Number.parseInt(line.slice(3, 6), 10) - 1;
      const order = Number.parseInt(line.slice(6, 9), 10) || 1;
      if (a < 0 || b < 0 || a >= atomCount || b >= atomCount) {
        throw new Error(`Bond ${i + 1} references an atom outside the record.`);
      }
      molecule.bonds.push({ a, b, order });
    }
  } else {
    parseV3000(lines, molecule);
  }

  if (!molecule.atoms.length) throw new Error('SDF contains no atoms.');
  return molecule;
}

/**
 * Return a copy of an SDF record with every atom coordinate shifted.
 * Used to lay multiple compounds out side by side in the editor scene.
 * @param {string} text
 * @param {{x?:number,y?:number,z?:number}} offset
 */
export function translateSdf(text, offset = {}) {
  const dx = Number(offset.x) || 0;
  const dy = Number(offset.y) || 0;
  const dz = Number(offset.z) || 0;
  if (!dx && !dy && !dz) return text;

  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const countsIndex = lines.findIndex(
    (line, index) => index >= 2 && /\bV(2000|3000)\b/.test(line),
  );
  if (countsIndex === -1) return text;

  if (!/\bV3000\b/.test(lines[countsIndex])) {
    const atomCount = Number.parseInt(lines[countsIndex].slice(0, 3), 10);
    if (!Number.isFinite(atomCount)) return text;
    for (let i = 0; i < atomCount; i += 1) {
      const index = countsIndex + 1 + i;
      const line = lines[index];
      if (!line) break;
      const x = Number.parseFloat(line.slice(0, 10));
      const y = Number.parseFloat(line.slice(10, 20));
      const z = Number.parseFloat(line.slice(20, 30));
      if (![x, y, z].every(Number.isFinite)) continue;
      lines[index] =
        `${(x + dx).toFixed(4).padStart(10)}` +
        `${(y + dy).toFixed(4).padStart(10)}` +
        `${(z + dz).toFixed(4).padStart(10)}` +
        line.slice(30);
    }
    return lines.join('\n');
  }

  let inAtoms = false;
  for (let i = countsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.startsWith('M  V30 BEGIN ATOM')) {
      inAtoms = true;
      continue;
    }
    if (line.startsWith('M  V30 END ATOM')) {
      inAtoms = false;
      continue;
    }
    if (!inAtoms || !line.startsWith('M  V30 ')) continue;

    const lead = line.match(/^\s*/)?.[0] ?? '';
    const tokens = line.trim().split(/\s+/);
    // M  V30 <index> <element> <x> <y> <z> ...
    if (tokens.length < 7) continue;
    const x = Number.parseFloat(tokens[4]);
    const y = Number.parseFloat(tokens[5]);
    const z = Number.parseFloat(tokens[6]);
    if (![x, y, z].every(Number.isFinite)) continue;
    tokens[4] = (x + dx).toFixed(4);
    tokens[5] = (y + dy).toFixed(4);
    tokens[6] = (z + dz).toFixed(4);
    lines[i] = lead + tokens.join(' ');
  }

  return lines.join('\n');
}

/**
 * Parse the V3000 CTAB block (used by PubChem for very large records).
 * Atom/bond indices in V3000 are explicit 1-based labels.
 * @param {string[]} lines
 * @param {Molecule} molecule
 */
function parseV3000(lines, molecule) {
  /** @type {string[]} */
  const logical = [];

  for (const line of lines) {
    if (!line.startsWith('M  V30 ')) continue;
    const content = line.slice(7);
    if (logical.length && logical[logical.length - 1].endsWith('-')) {
      logical[logical.length - 1] =
        logical[logical.length - 1].slice(0, -1) + content.trimStart();
    } else {
      logical.push(content);
    }
  }

  const atomsByLabel = new Map();

  for (const content of logical) {
    const body = content.trim();
    if (!body || /^(BEGIN|END|COUNTS)\b/.test(body)) continue;
    const tokens = body.split(/\s+/);
    if (tokens.length < 5) continue;

    const label = Number.parseInt(tokens[0], 10);
    if (!Number.isFinite(label)) continue;

    // Atom: <label> <element> <x> <y> <z> ...
    if (/^[A-Za-z*#]/.test(tokens[1])) {
      const x = Number.parseFloat(tokens[2]);
      const y = Number.parseFloat(tokens[3]);
      const z = Number.parseFloat(tokens[4]);
      if (![x, y, z].every(Number.isFinite)) continue;
      const element = tokens[1].replace(/[^A-Za-z*#]/g, '') || 'X';
      const atomIndex = molecule.atoms.length;
      molecule.atoms.push({ element, x, y, z });
      atomsByLabel.set(label, atomIndex);
    }
  }

  for (const content of logical) {
    const body = content.trim();
    if (!body || /^(BEGIN|END|COUNTS)\b/.test(body)) continue;
    const tokens = body.split(/\s+/);
    if (tokens.length < 4) continue;

    // Bond: <label> <order> <atom1> <atom2> ...
    if (!/^[A-Za-z*#]/.test(tokens[1])) {
      const order = Number.parseInt(tokens[1], 10) || 1;
      const a = atomsByLabel.get(Number.parseInt(tokens[2], 10));
      const b = atomsByLabel.get(Number.parseInt(tokens[3], 10));
      if (a === undefined || b === undefined) continue;
      molecule.bonds.push({ a, b, order });
    }
  }

  molecule.declaredAtomCount = molecule.atoms.length;
  molecule.declaredBondCount = molecule.bonds.length;
}

/** Keep the MOL block only (everything through `M  END`). */
export function toMolBlock(sdfText) {
  const lines = sdfText.replace(/\r\n?/g, '\n').split('\n');
  const end = lines.findIndex((line) => /^M\s+END\s*$/.test(line));
  if (end === -1) return sdfText;
  return `${lines.slice(0, end + 1).join('\n')}\n`;
}

/**
 * XYZ export. Coordinates are written with the same 4-decimal precision
 * PubChem supplies in the SDF.
 * @param {Molecule} molecule
 * @param {{cid: number, title?: string}} meta
 */
export function toXyz(molecule, meta) {
  const header = `${meta.title || molecule.title} | CID ${meta.cid} | PubChem 3D conformer`;
  const rows = molecule.atoms.map(
    (atom) =>
      `${atom.element.padEnd(3)} ${atom.x.toFixed(4).padStart(11)} ${atom.y
        .toFixed(4)
        .padStart(11)} ${atom.z.toFixed(4).padStart(11)}`,
  );
  return `${molecule.atoms.length}\n${header}\n${rows.join('\n')}\n`;
}

/** Element symbols normalized for maps/exports. */
export function normalizeElement(element) {
  if (!element) return 'X';
  const cleaned = element.replace(/[^A-Za-z*]/g, '');
  if (!cleaned) return 'X';
  if (/^[DT]$/i.test(cleaned)) return 'H';
  return cleaned[0].toUpperCase() + cleaned.slice(1).toLowerCase();
}
