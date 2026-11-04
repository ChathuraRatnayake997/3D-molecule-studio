/** Shared DOM, formatting and rendering helpers. */

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * Tiny hyperscript helper. All text is inserted with textContent.
 */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key === 'attrs') {
      for (const [name, attrValue] of Object.entries(value)) {
        if (attrValue !== undefined && attrValue !== null && attrValue !== false) {
          node.setAttribute(name, String(attrValue));
        }
      }
    } else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node[key] = value;
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child === undefined || child === null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

export function clearNode(node) {
  while (node.firstChild) node.firstChild.remove();
}

export function icon(name, className = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', `icon ${className}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#icon-${name}`);
  svg.append(use);
  return svg;
}

/* ------------------------------ formatting ------------------------------ */

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value < 0) return '—';
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatTimestamp(iso) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export function slugify(value, fallback = 'molecule') {
  const slug = String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return slug || fallback;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = el('a', { href: url, download: filename, hidden: true });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function downloadText(text, mime, filename) {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/* ------------------------------- clipboard ------------------------------ */

export async function copyText(text) {
  const value = String(text ?? '');
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }

  const textarea = el('textarea', {
    value,
    readonly: true,
    class: 'clipboard-helper',
    attrs: { 'aria-hidden': 'true' },
  });
  document.body.append(textarea);
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  textarea.remove();
  return ok;
}

let toastTimer = 0;
export function toast(message, type = 'info') {
  const node = document.getElementById('toast');
  if (!node) return;
  node.textContent = message;
  node.dataset.type = type;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), 3600);
}

/* ---------------------------- shared elements --------------------------- */

export function copyButton(value, label = 'value') {
  const button = el(
    'button',
    {
      class: 'copy-btn',
      type: 'button',
      title: `Copy ${label}`,
      attrs: { 'aria-label': `Copy ${label}` },
      onclick: async () => {
        const ok = await copyText(value);
        toast(ok ? `${label} copied` : 'Copy failed — select the text manually', ok ? 'success' : 'error');
      },
    },
    icon('copy'),
  );
  return button;
}

/* ------------------------------ properties ------------------------------ */

const PROPERTY_LABELS = {
  MolecularFormula: 'Molecular formula',
  MolecularWeight: 'Molecular weight',
  ExactMass: 'Exact mass',
  MonoisotopicMass: 'Monoisotopic mass',
  IUPACName: 'IUPAC name',
  XLogP: 'XLogP',
  TPSA: 'Topological polar surface area',
  Complexity: 'Complexity',
  Charge: 'Formal charge',
  HBondDonorCount: 'H-bond donors',
  HBondAcceptorCount: 'H-bond acceptors',
  RotatableBondCount: 'Rotatable bonds',
  HeavyAtomCount: 'Heavy atoms',
  IsotopeAtomCount: 'Isotope atoms',
  AtomStereoCount: 'Atom stereo centers',
  DefinedAtomStereoCount: 'Defined atom stereo',
  UndefinedAtomStereoCount: 'Undefined atom stereo',
  BondStereoCount: 'Bond stereo',
  DefinedBondStereoCount: 'Defined bond stereo',
  UndefinedBondStereoCount: 'Undefined bond stereo',
  CovalentUnitCount: 'Covalent units',
  ConformerCount3D: '3D conformers',
  Volume3D: '3D volume',
  ConformerModelRMSD3D: 'Conformer model RMSD',
  EffectiveRotorCount3D: 'Effective rotors (3D)',
  FeatureCount3D: 'Pharmacophore features (3D)',
};

const PROPERTY_UNITS = {
  MolecularWeight: 'g/mol',
  ExactMass: 'Da',
  MonoisotopicMass: 'Da',
  TPSA: 'Å²',
  Volume3D: 'Å³',
  ConformerModelRMSD3D: 'Å',
};

const PROPERTY_GROUPS = [
  {
    title: 'Core properties',
    keys: [
      'MolecularFormula',
      'MolecularWeight',
      'ExactMass',
      'MonoisotopicMass',
      'IUPACName',
      'XLogP',
      'TPSA',
      'Complexity',
      'Charge',
    ],
  },
  {
    title: 'Atom & bond counts',
    keys: [
      'HBondDonorCount',
      'HBondAcceptorCount',
      'RotatableBondCount',
      'HeavyAtomCount',
      'IsotopeAtomCount',
      'CovalentUnitCount',
      'AtomStereoCount',
      'DefinedAtomStereoCount',
      'UndefinedAtomStereoCount',
      'BondStereoCount',
      'DefinedBondStereoCount',
      'UndefinedBondStereoCount',
    ],
  },
  {
    title: '3D descriptors',
    note: 'Computed by PubChem, not by this app.',
    keys: [
      'ConformerCount3D',
      'Volume3D',
      'ConformerModelRMSD3D',
      'EffectiveRotorCount3D',
      'FeatureCount3D',
    ],
  },
];

const present = (value) => value !== undefined && value !== null && value !== '';

export function renderPropertyGroups(container, properties) {
  clearNode(container);

  for (const group of PROPERTY_GROUPS) {
    const rows = group.keys.filter((key) => present(properties[key]));
    if (!rows.length) continue;

    const list = el('dl', { class: 'prop-list' });
    for (const key of rows) {
      const raw = properties[key];
      const value = String(raw);
      const unit = PROPERTY_UNITS[key] ? el('span', { class: 'unit', text: PROPERTY_UNITS[key] }) : null;
      const isLong = key === 'IUPACName' || value.length > 24;
      const isFormula = key === 'MolecularFormula';

      list.append(
        el(
          'div',
          { class: `prop-row${isLong ? ' is-long' : ''}` },
          el('dt', { class: 'prop-label', text: PROPERTY_LABELS[key] || key }),
          el(
            'dd',
            { class: 'prop-cell' },
            el(
              'span',
              {
                class: `prop-value${isFormula ? ' formula' : ''}`,
                title: value,
              },
              value,
              unit,
            ),
            copyButton(value, PROPERTY_LABELS[key] || key),
          ),
        ),
      );
    }

    container.append(
      el(
        'section',
        { class: 'prop-group' },
        el('h3', { class: 'prop-group-title' }, group.title, el('span', { class: 'prop-count', text: String(rows.length) })),
        list,
        group.note ? el('p', { class: 'prop-note', text: group.note }) : null,
      ),
    );
  }

  const shown = PROPERTY_GROUPS.flatMap((group) => group.keys).filter((key) => present(properties[key]));
  const missing = Object.keys(properties).length - shown.length;

  container.append(
    el(
      'p',
      { class: 'prop-footnote' },
      'Values rendered verbatim from the PubChem property table — no rounding or local recalculation.',
      missing > 0 ? ` ${missing} additional field${missing === 1 ? '' : 's'} returned by PubChem are included in the JSON export.` : '',
    ),
  );
}

/* ------------------------------ identifiers ----------------------------- */

function identifierBlock(label, value) {
  return el(
    'section',
    { class: 'identifier' },
    el(
      'header',
      { class: 'identifier-head' },
      el('h3', { text: label }),
      copyButton(value, label),
    ),
    el('code', { class: 'identifier-value', text: value }),
  );
}

export function renderIdentifiers(container, properties, synonyms, pageUrl) {
  clearNode(container);

  const blocks = [];
  if (present(properties.ConnectivitySMILES)) {
    blocks.push(identifierBlock('Canonical SMILES', String(properties.ConnectivitySMILES)));
  }
  if (present(properties.IsomericSMILES)) {
    blocks.push(identifierBlock('Isomeric SMILES', String(properties.IsomericSMILES)));
  }
  if (
    present(properties.SMILES) &&
    properties.SMILES !== properties.ConnectivitySMILES &&
    properties.SMILES !== properties.IsomericSMILES
  ) {
    blocks.push(identifierBlock('SMILES', String(properties.SMILES)));
  }
  if (present(properties.InChI)) blocks.push(identifierBlock('InChI', String(properties.InChI)));
  if (present(properties.InChIKey)) blocks.push(identifierBlock('InChIKey', String(properties.InChIKey)));

  if (blocks.length) {
    container.append(el('div', { class: 'identifier-list' }, ...blocks));
  } else {
    container.append(el('p', { class: 'panel-empty-text', text: 'PubChem did not return identifiers for this record.' }));
  }

  const synonymSection = el('section', { class: 'synonym-section' });
  const heading = el(
    'h3',
    { class: 'prop-group-title' },
    'Synonyms',
    synonyms.length ? el('span', { class: 'prop-count', text: String(synonyms.length) }) : null,
  );
  synonymSection.append(heading);

  if (!synonyms.length) {
    synonymSection.append(el('p', { class: 'prop-note', text: 'No synonyms were returned for this CID.' }));
  } else {
    const visibleCount = Math.min(synonyms.length, 24);
    const chips = el('div', { class: 'synonym-chips' });
    const renderChips = (count) => {
      clearNode(chips);
      for (const synonym of synonyms.slice(0, count)) {
        chips.append(el('span', { class: 'chip', text: synonym }));
      }
    };
    renderChips(visibleCount);
    synonymSection.append(chips);

    if (synonyms.length > visibleCount) {
      synonymSection.append(
        el(
          'button',
          {
            class: 'text-btn',
            type: 'button',
            attrs: { 'aria-expanded': 'false' },
            onclick: (event) => {
              const button = event.currentTarget;
              const expanded = button.dataset.expanded === 'true';
              if (expanded) {
                renderChips(visibleCount);
                button.dataset.expanded = 'false';
                button.setAttribute('aria-expanded', 'false');
                button.textContent = `Show all ${synonyms.length} synonyms`;
              } else {
                renderChips(synonyms.length);
                button.dataset.expanded = 'true';
                button.setAttribute('aria-expanded', 'true');
                button.textContent = 'Show fewer';
              }
            },
          },
          `Show all ${synonyms.length} synonyms`,
        ),
      );
    }
  }

  synonymSection.append(
    el(
      'p',
      { class: 'prop-note' },
      'Synonym list © PubChem. ',
      el('a', { href: pageUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Open the full record on PubChem' }),
      '.',
    ),
  );

  container.append(synonymSection);
}

/* ------------------------------ provenance ------------------------------ */

export function renderProvenance(container, data) {
  clearNode(container);

  const {
    cid,
    properties,
    sources,
    hash,
    hashReason,
    sdfBytes,
    conformerIndex,
    conformerCount,
    conformerId,
    allHash,
    allHashReason,
    allSdfBytes,
    molecule,
    have3d,
    sdfError,
    citation,
    onDownloadJson,
  } = data;

  const rows = el('dl', { class: 'prov-list' });
  const addRow = (label, valueNode) => {
    rows.append(
      el(
        'div',
        { class: 'prov-row' },
        el('dt', { text: label }),
        el('dd', {}, valueNode),
      ),
    );
  };

  addRow('CID', el('span', { class: 'mono', text: String(cid) }));
  addRow(
    'Retrieved',
    properties
      ? el('time', {
          datetime: data.retrievedAt,
          title: data.retrievedAt,
          text: formatTimestamp(data.retrievedAt),
        })
      : el('span', { class: 'muted', text: 'Not loaded' }),
  );
  if (properties?.Title) addRow('Title', el('span', { text: properties.Title }));

  addRow(
    '3D conformer',
    have3d
      ? el(
          'span',
          { class: 'status status-ok' },
          el('span', { class: 'status-dot' }),
          conformerCount > 1
            ? `PubChem record_type=3d · conformer ${conformerIndex + 1} of ${conformerCount} · ${molecule.version}`
            : `PubChem record_type=3d · ${molecule.version}`,
        )
      : el(
          'span',
          { class: 'status status-warn' },
          el('span', { class: 'status-dot' }),
          sdfError ? 'Retrieval failed' : 'Not published by PubChem',
        ),
  );

  if (have3d && conformerId) {
    addRow('Conformer ID', el('span', { class: 'mono', text: String(conformerId) }));
  }

  if (have3d && molecule) {
    addRow(
      'SDF block counts',
      el('span', {
        class: 'mono',
        text: `${molecule.declaredAtomCount} atoms · ${molecule.declaredBondCount} bonds (declared in SDF header)`,
      }),
    );
    addRow('SDF size', el('span', { class: 'mono', text: formatBytes(sdfBytes) }));
    if (conformerCount > 1 && allSdfBytes) {
      addRow(
        'All conformers',
        el('span', {
          class: 'mono',
          text: `${conformerCount} SDF records · ${formatBytes(allSdfBytes)}`,
        }),
      );
    }
  }

  addRow(
    'SHA-256',
    hash
      ? el(
          'span',
          { class: 'hash-row' },
          el('code', { class: 'hash-value', text: hash }),
          copyButton(hash, 'SHA-256 hash'),
        )
      : el('span', { class: 'muted', text: hashReason || 'Unavailable' }),
  );

  if (conformerCount > 1) {
    addRow(
      'SHA-256 (all conformers)',
      allHash
        ? el(
            'span',
            { class: 'hash-row' },
            el('code', { class: 'hash-value', text: allHash }),
            copyButton(allHash, 'SHA-256 hash of all conformers'),
          )
        : el('span', { class: 'muted', text: allHashReason || 'Unavailable' }),
    );
  }

  container.append(el('section', { class: 'prov-section' }, el('h3', { class: 'prop-group-title', text: 'Record details' }), rows));

  const sourceList = el('ul', { class: 'source-list' });
  for (const source of sources) {
    const metaParts = [];
    if (source.status === 'error') {
      metaParts.push(source.note || 'Unavailable');
    } else {
      if (source.bytes) metaParts.push(formatBytes(source.bytes));
      if (source.httpStatus) metaParts.push(`HTTP ${source.httpStatus}`);
    }

    sourceList.append(
      el(
        'li',
        { class: 'source-item' },
        el(
          'div',
          { class: 'source-main' },
          el('a', {
            href: source.url,
            target: '_blank',
            rel: 'noopener noreferrer',
            text: source.label,
          }),
          el('span', {
            class: 'source-meta',
            text: metaParts.join(' · '),
          }),
        ),
        source.status === 'ok'
          ? el('span', { class: 'status status-ok status-compact' }, el('span', { class: 'status-dot' }), 'Retrieved')
          : el('span', { class: 'status status-warn status-compact' }, el('span', { class: 'status-dot' }), 'Unavailable'),
      ),
    );
  }

  container.append(
    el(
      'section',
      { class: 'prov-section' },
      el('h3', { class: 'prop-group-title', text: 'Source requests' }),
      sourceList,
      el(
        'div',
        { class: 'prov-actions' },
        el(
          'button',
          { class: 'ghost-btn', type: 'button', onclick: onDownloadJson },
          icon('download'),
          'Download raw JSON',
        ),
        el(
          'a',
          {
            class: 'ghost-btn',
            href: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest',
            target: '_blank',
            rel: 'noopener noreferrer',
          },
          'PUG REST docs',
          icon('external'),
        ),
      ),
    ),
  );

  container.append(
    el(
      'section',
      { class: 'prov-section accuracy-section' },
      el('h3', { class: 'prop-group-title', text: 'What “verbatim” means here' }),
      el(
        'ul',
        { class: 'accuracy-list' },
        el('li', { text: 'Every property shown above comes directly from PubChem’s property table and is displayed without rounding.' }),
        el('li', { text: '3D coordinates are the published PubChem conformer (record_type=3d), not a browser-generated guess. Every conformer PubChem lists for the CID is imported.' }),
        el('li', { text: 'The SDF download is the exact response body for the selected conformer. Its SHA-256 lets you verify the file after download; the all-conformer download has a separate hash.' }),
        el('li', { text: 'PubChem regenerates the SDF header timestamp on each request, so refetching can change the hash even when the coordinates are identical.' }),
        el('li', { text: 'GLB meshes are generated locally from those coordinates; they introduce no new chemistry.' }),
      ),
      el(
        'p',
        { class: 'prop-note' },
        'Accuracy is bounded by PubChem’s record itself. This app adds no derived molecular properties.',
      ),
    ),
  );

  const citeBox = el(
    'section',
    { class: 'citation-box' },
    el(
      'header',
      { class: 'citation-head' },
      el('h3', { text: 'Cite this record' }),
      copyButton(citation, 'citation'),
    ),
    el('p', { text: citation }),
  );

  container.append(citeBox);
}
