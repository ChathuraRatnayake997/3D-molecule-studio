import {
  PubChemError,
  conformerUrl,
  fetchConformers,
  fetchProperties,
  fetchSynonyms,
  parseCid,
  sha256Hex,
  urlsFor,
} from './pubchem.js';
import { parseSdf, toMolBlock, toXyz, translateSdf } from './sdf.js';
import { buildSceneGlb, GLB_QUALITY_PRESETS } from './glb.js';
import {
  MATERIAL_PRESETS,
  MoleculeViewer,
  glossColor,
  materialElementColor,
  materialOpacity,
  multiplyQuaternion,
  quaternionFromAxisAngle,
  rotateVector,
} from './viewer.js';
import {
  $,
  $$,
  clearNode,
  downloadBlob,
  downloadText,
  el,
  formatBytes,
  formatTimestamp,
  icon,
  renderIdentifiers,
  renderPropertyGroups,
  renderProvenance,
  slugify,
  toast,
} from './ui.js';

/* --------------------------------- state -------------------------------- */

const APPEARANCE_DEFAULTS = {
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

function readAppearance() {
  try {
    const parsed = JSON.parse(localStorage.getItem('pubchem-appearance') || '{}');
    const clamp = (value, min, max, fallback) => {
      const number = Number(value);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };
    return {
      atomScale: clamp(parsed.atomScale, 0.5, 2, APPEARANCE_DEFAULTS.atomScale),
      bondScale: clamp(parsed.bondScale, 0.5, 2, APPEARANCE_DEFAULTS.bondScale),
      opacity: clamp(parsed.opacity, 0.15, 1, APPEARANCE_DEFAULTS.opacity),
      lineWidth: clamp(parsed.lineWidth, 1, 4, APPEARANCE_DEFAULTS.lineWidth),
      colorScheme: parsed.colorScheme === 'custom' ? 'custom' : 'Jmol',
      customColor:
        typeof parsed.customColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.customColor)
          ? parsed.customColor
          : APPEARANCE_DEFAULTS.customColor,
      surfaceColor:
        typeof parsed.surfaceColor === 'string' && /^#[0-9a-f]{6}$/i.test(parsed.surfaceColor)
          ? parsed.surfaceColor
          : APPEARANCE_DEFAULTS.surfaceColor,
      surfaceOpacity: clamp(
        parsed.surfaceOpacity,
        0.05,
        1,
        APPEARANCE_DEFAULTS.surfaceOpacity,
      ),
      material:
        typeof parsed.material === 'string' &&
        Object.prototype.hasOwnProperty.call(MATERIAL_PRESETS, parsed.material)
          ? parsed.material
          : APPEARANCE_DEFAULTS.material,
      materialGloss: clamp(
        parsed.materialGloss,
        0,
        1,
        APPEARANCE_DEFAULTS.materialGloss,
      ),
      lighting:
        typeof parsed.lighting === 'string' &&
        ['studio', 'soft', 'bright', 'dramatic', 'rim'].includes(parsed.lighting)
          ? parsed.lighting
          : APPEARANCE_DEFAULTS.lighting,
      showAxes: parsed.showAxes === true,
      showGrid: parsed.showGrid === true,
      gridSpacing: clamp(parsed.gridSpacing, 0.5, 8, APPEARANCE_DEFAULTS.gridSpacing),
      gridPlane: ['xz', 'xy', 'yz'].includes(parsed.gridPlane)
        ? parsed.gridPlane
        : APPEARANCE_DEFAULTS.gridPlane,
      gridMode: parsed.gridMode === 'triple' ? 'triple' : 'single',
      showScaleBar: parsed.showScaleBar === true,
      showUnitLabels: parsed.showUnitLabels === true,
      background:
        parsed.background === 'transparent'
          ? 'transparent'
          : typeof parsed.background === 'string' &&
              /^#[0-9a-f]{6}$/i.test(parsed.background)
            ? parsed.background
            : null,
    };
  } catch {
    return { ...APPEARANCE_DEFAULTS };
  }
}

const state = {
  cid: null,
  loading: false,
  loadToken: 0,
  abort: null,
  properties: null,
  propertiesRaw: null,
  propSource: null,
  synonyms: [],
  synonymsRaw: null,
  synSource: null,
  sdfText: null,
  sdfSource: null,
  conformers: [],
  conformerIndex: 0,
  sdfAllText: null,
  conformerSource: null,
  allHash: null,
  allHashReason: null,
  sdfError: null,
  no3d: false,
  molecule: null,
  parseError: null,
  hash: null,
  hashReason: null,
  retrievedAt: null,
  glbBytes: null,
  conformerToken: 0,
  style: ['ball-stick', 'sticks', 'spheres', 'lines'].includes(localStorage.getItem('viewerStyle'))
    ? localStorage.getItem('viewerStyle')
    : 'ball-stick',
  showH: localStorage.getItem('showHydrogen') !== '0',
  spin: false,
  editor: false,
  editorItem: 'viewport',
  scene: [],
  activeKey: null,
  nextCompoundKey: 1,
  renderedEntries: [],
  layoutMode: localStorage.getItem('sceneLayout') === 'grid' || localStorage.getItem('sceneLayout') === 'circle'
    ? localStorage.getItem('sceneLayout')
    : 'row',
  transformMode: 'rotate',
  sceneDrag: null,
  canvasClick: null,
  selection: null,
  connections: [],
  connectionsExpanded: true,
  nextConnectionId: 1,
  undoStack: [],
  redoStack: [],
  lastUndoKey: null,
  lastUndoAt: 0,
  connect: {
    active: false,
    order: 1,
    style: 'solid',
    join: true,
    first: null,
  },
  studio: {
    active: false,
    duration: 6,
    time: 0,
    loop: true,
    playing: false,
    recording: false,
    gifBusy: false,
    sceneMotion: 'spin',
    sceneAxis: 'y',
    scenePingPong: false,
    cameraMotion: 'none',
    cameraAxis: 'y',
    cameraAngle: 360,
    cameraCustomAxis: { x: 0, y: 1, z: 0 },
    manualView: false,
    showRecordingGuide: localStorage.getItem('studioRecordingGuide') !== '0',
    output: {
      size: 1080,
      aspect: 'wide',
      fps: 30,
    },
    items: {},
    base: null,
    raf: 0,
    lastTick: 0,
    playStart: 0,
    playFrom: 0,
    recorder: null,
    stream: null,
    chunks: [],
    mimeType: '',
    composite: null,
    compositeContext: null,
    sourceCanvas: null,
    recordFrame: 0,
  },
  appearance: readAppearance(),
  exportOptions: {
    glbQuality: ['draft', 'standard', 'high', 'ultra'].includes(
      localStorage.getItem('glbQuality'),
    )
      ? localStorage.getItem('glbQuality')
      : 'high',
    glbScope: localStorage.getItem('glbScope') === 'active' ? 'active' : 'scene',
    glbStyle: ['viewer', 'ball-stick', 'sticks', 'spheres', 'lines'].includes(
      localStorage.getItem('glbStyle'),
    )
      ? localStorage.getItem('glbStyle')
      : 'viewer',
  },
};

let viewer = null;
let resizeFrame = 0;

const dom = {};

/* -------------------------------- startup ------------------------------- */

function init() {
  cacheDom();
  applyInitialTheme();
  initViewer();
  bindSearch();  bindTabs();
  bindToolbar();
  bindEditor();
  bindSceneManipulation();
  bindConnect();
  bindStudio();
  bindItemEditor();
  bindCustomize();
  bindExports();
  bindConformers();
  bindPanels();
  bindSceneTools();
  bindTour();
  bindWelcome();
  bindGlobalKeys();
  initResizeObserver();
  renderRecentList();

  const params = new URLSearchParams(window.location.search);
  const cidParam = params.get('cid');
  if (cidParam) {
    const cid = parseCid(cidParam);
    if (cid) loadCid(cid, { updateUrl: false });
    else setSearchError('That link does not contain a valid PubChem CID.');
  }
}

function cacheDom() {
  const ids = [
    'app-shell',
    'search-form',
    'cid-input',
    'load-btn',
    'clear-btn',
    'search-error',
    'recent-wrap',
    'recent-list',
    'viewer-card',
    'viewer-body',
    'viewer',
    'viewer-empty',
    'viewer-loading',
    'viewer-message',
    'recording-guide',
    'recording-guide-frame',
    'recording-guide-label',
    'loading-cid',
    'msg-image',
    'msg-title',
    'msg-text',
    'msg-link',
    'msg-retry',
    'mol-title',
    'mol-subtitle',
    'cid-badge',
    'cid-badge-text',
    'conformer-control',
    'conformer-trigger',
    'conformer-trigger-text',
    'conformer-menu',
    'conformer-count',
    'conformer-prev',
    'conformer-next',
    'hud-record',
    'scale-bar',
    'scale-bar-label',
    'scale-bar-line',
    'transform-bar',
    'transform-target',
    'transform-reset',
    'provenance-text',
    'hash-mini',
    'hash-mini-value',
    'theme-toggle',
    'toggle-h',
    'toggle-spin',
    'toggle-surface',
    'reset-view',
    'screenshot',
    'fullscreen',
    'overview-empty',
    'overview-content',
    'structure-2d',
    'structure-fallback',
    'structure-formula',
    'structure-mw',
    'structure-link',
    'prop-groups',
    'identifiers-empty',
    'identifiers-content',
    'provenance-empty',
    'provenance-content',
    'export-card',
    'export-cid',
    'export-note',
    'glb-options',
    'glb-scope',
    'glb-quality',
    'glb-style',
    'glb-option-note',
    'export-all-sdf',
    'toggle-properties',
    'close-properties',
    'properties-panel',
    'toggle-layers',
    'close-layers',
    'layers-panel',
    'toggle-customize',
    'close-customize',
    'customize-panel',
    'custom-atom-size',
    'custom-atom-size-value',
    'custom-bond-size',
    'custom-bond-size-value',
    'custom-opacity',
    'custom-opacity-value',
    'custom-material',
    'custom-material-gloss',
    'custom-material-gloss-value',
    'custom-lighting',
    'custom-axes',
    'custom-grid',
    'custom-grid-spacing',
    'custom-grid-spacing-value',
    'custom-grid-plane',
    'custom-grid-mode',
    'custom-scale',
    'custom-units',
    'custom-line-width',
    'custom-line-width-value',
    'custom-color-scheme',
    'custom-color-field',
    'custom-color',
    'custom-surface-color',
    'custom-surface-opacity',
    'custom-surface-opacity-value',
    'custom-background',
    'custom-background-reset',
    'custom-background-transparent',
    'custom-reset',
    'scene-list',
    'scene-count',
    'scene-empty',
    'scene-tools',
    'scene-fit',
    'scene-reset',
    'connections-head',
    'connections-chevron',
    'connection-count',
    'connection-list',
    'clear-connections',
    'connect-toggle',
    'connect-bar',
    'connect-status',
    'connect-join',
    'connect-cancel',
    'studio-toggle',
    'studio-dock',
    'studio-scene-motion',
    'studio-scene-axis',
    'studio-scene-pingpong',
    'studio-camera-motion',
    'studio-camera-axis',
    'studio-camera-angle',
    'studio-camera-use-view',
    'studio-camera-custom',
    'studio-camera-x',
    'studio-camera-y',
    'studio-camera-z',
    'studio-background',
    'studio-background-reset',
    'studio-background-transparent',
    'studio-items',
    'studio-play',
    'studio-stop',
    'studio-duration',
    'studio-loop',
    'studio-time',
    'studio-fps',
    'studio-size',
    'studio-aspect',
    'studio-recording-guide',
    'studio-gif',
    'studio-record',
    'item-editor',
    'item-title',
    'item-visible',
    'item-color',
    'item-color-field',
    'item-order',
    'item-order-field',
    'item-connection-style',
    'item-connection-style-field',
    'item-size-field',
    'item-size',
    'item-size-value',
    'item-size-label',
    'item-opacity-field',
    'item-opacity',
    'item-opacity-value',
    'item-material-field',
    'item-material',
    'item-gloss-field',
    'item-gloss',
    'item-gloss-value',
    'item-reset',
    'load-btn-label',
    'toggle-export',
    'close-export',
    'editor-toggle',
    'editor-items',
    'tour-toggle',
    'tour',
    'tour-step-count',
    'tour-title',
    'tour-text',
    'tour-dots',
    'tour-skip',
    'tour-prev',
    'tour-next',
    'welcome',
    'welcome-close',
    'toast',
  ];
  for (const id of ids) dom[id] = document.getElementById(id);
}

/* --------------------------------- theme -------------------------------- */

function applyInitialTheme() {
  const stored = localStorage.getItem('theme');
  const preferred = window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  setTheme(stored === 'light' || stored === 'dark' ? stored : preferred, false);
}

function setTheme(theme, persist = true) {
  document.documentElement.dataset.theme = theme;
  if (persist) localStorage.setItem('theme', theme);
  if (dom['theme-toggle']) {
    dom['theme-toggle'].setAttribute('aria-pressed', String(theme === 'light'));
    dom['theme-toggle'].title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
  }
  viewer?.setBackground();
  updateBackgroundControls();
  updateSelectionHighlight();
}

/* -------------------------------- viewer -------------------------------- */

function initViewer() {
  try {
    viewer = new MoleculeViewer(dom.viewer);
    viewer.init();
    viewer.setStyleName(state.style);
    viewer.setShowHydrogen(state.showH);
    viewer.setAppearance(state.appearance);
    setToolbarEnabled(false);
  } catch (error) {
    setToolbarEnabled(false);
    console.error('3D viewer failed to initialise:', error);
  }
}

function initResizeObserver() {
  if (!dom['viewer-body'] || !('ResizeObserver' in window)) return;
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      viewer?.resize();
      updateRecordingGuide();
    });
  });
  observer.observe(dom['viewer-body']);
}

function setToolbarEnabled(enabled) {
  [...$$('.tool-style'), dom['toggle-h'], dom['toggle-spin'], dom['toggle-surface'], dom['reset-view'], dom['screenshot']].forEach(
    (button) => {
      if (button) button.disabled = !enabled;
    },
  );
}

/* ------------------------------- searching ------------------------------ */

function bindSearch() {
  dom['search-form'].addEventListener('submit', (event) => {
    event.preventDefault();
    const cid = parseCid(dom['cid-input'].value);
    if (!cid) {
      setSearchError('Enter a numeric PubChem CID (for example 2244) or paste a PubChem compound URL.');
      dom['cid-input'].focus();
      return;
    }
    setSearchError('');
    loadCid(cid);
  });

  dom['cid-input'].addEventListener('input', () => {
    setSearchError('');
    dom['clear-btn'].hidden = !dom['cid-input'].value;
  });

  dom['clear-btn'].addEventListener('click', () => {
    dom['cid-input'].value = '';
    dom['clear-btn'].hidden = true;
    dom['cid-input'].focus();
  });

  $$('.example-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const cid = Number(chip.dataset.cid);
      dom['cid-input'].value = String(cid);
      setSearchError('');
      loadCid(cid);
    });
  });

  dom['theme-toggle'].addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(next);
  });

  dom['msg-retry'].addEventListener('click', () => {
    if (state.cid) loadCid(state.cid);
  });

  // A 2D depiction that PubChem cannot render should disappear, not show a broken icon.
  dom['structure-2d'].addEventListener('error', () => {
    dom['structure-2d'].hidden = true;
    dom['structure-fallback'].hidden = false;
  });
  dom['structure-2d'].addEventListener('load', () => {
    dom['structure-2d'].hidden = false;
    dom['structure-fallback'].hidden = true;
  });
  dom['msg-image'].addEventListener('error', () => {
    dom['msg-image'].hidden = true;
  });
}

function setSearchError(message) {
  if (!dom['search-error']) return;
  dom['search-error'].textContent = message;
  dom['search-error'].hidden = !message;
}

/* ------------------------------- load flow ------------------------------ */

async function loadCid(cid, { updateUrl = true, mode = state.editor ? 'add' : 'replace' } = {}) {
  if (!Number.isSafeInteger(cid) || cid < 1) return;

  const token = state.loadToken + 1;
  state.loadToken = token;
  state.conformerToken += 1;

  if (state.abort) state.abort.abort();
  const controller = new AbortController();
  state.abort = controller;

  const previousKey = state.activeKey;
  const adding = mode === 'add' && state.scene.length > 0;
  if (!adding) {
    if (state.studio.active) setStudioMode(false);
    state.scene = [];
    state.selection = null;
    state.connections = [];
    state.connect.first = null;
    state.undoStack = [];
    state.redoStack = [];
    state.studio.items = {};
    state.studio.sceneMotion = 'spin';
    state.studio.sceneAxis = 'y';
    state.studio.cameraMotion = 'none';
    state.studio.cameraAxis = 'y';
    state.studio.cameraAngle = 360;
    state.studio.manualView = false;
    state.studio.time = 0;
    if (state.connect.active) setConnectMode(false);
  }
  state.activeKey = null;

  state.loading = true;
  state.cid = cid;
  state.glbBytes = null;

  dom['cid-input'].value = String(cid);
  dom['clear-btn'].hidden = false;
  setSearchError('');
  resetRecordUI();

  if (updateUrl) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('cid', String(cid));
      window.history.replaceState(null, '', url);
    } catch {
      /* file:// or sandboxed contexts can refuse history updates */
    }
  }

  beginLoading(cid);
  setToolbarEnabled(false);

  const urls = urlsFor(cid);
  const markStepIfCurrent = (key, status, note) => {
    if (state.loadToken === token) markStep(key, status, note);
  };

  markStep('properties', 'active', 'Fetching…');
  markStep('conformer', 'active', 'Fetching…');
  markStep('synonyms', 'active', 'Fetching…');

  const [propsResult, conformerResult, synonymResult] = await Promise.allSettled([
    fetchProperties(cid, controller.signal).then((result) => {
      markStepIfCurrent('properties', 'done', formatBytes(result.bytes));
      return result;
    }),
    fetchConformers(cid, controller.signal, (loaded, total) => {
      markStepIfCurrent('conformer', 'active', `${loaded}/${total}`);
    }).then(
      (result) => {
        markStepIfCurrent(
          'conformer',
          'done',
          result.records.length > 1
            ? `${result.records.length} conformers`
            : formatBytes(result.bytes),
        );
        return result;
      },
      (error) => {
        if (error?.name === 'AbortError') throw error;
        if (error?.code === 'NO_3D') {
          markStepIfCurrent('conformer', 'warn', 'No 3D record');
        } else {
          markStepIfCurrent('conformer', 'error', 'Unavailable');
        }
        throw error;
      },
    ),
    fetchSynonyms(cid, controller.signal).then(
      (result) => {
        markStepIfCurrent(
          'synonyms',
          'done',
          result.synonyms.length ? `${result.synonyms.length} names` : 'None returned',
        );
        return result;
      },
      (error) => {
        if (error?.name === 'AbortError') throw error;
        markStepIfCurrent('synonyms', 'warn', 'Unavailable');
        throw error;
      },
    ),
  ]);

  if (token !== state.loadToken) return;

  state.loading = false;

  if (propsResult.status === 'rejected') {
    if (propsResult.reason?.name === 'AbortError') return;
    if (adding && previousKey) {
      state.activeKey = previousKey;
      renderCompoundList();
    }
    handleLoadError(propsResult.reason, cid, urls);
    return;
  }

  const propData = propsResult.value;
  state.properties = propData.properties;
  state.propertiesRaw = propData.raw;
  state.propSource = propData;
  state.retrievedAt = propData.retrievedAt;

  if (synonymResult.status === 'fulfilled') {
    state.synonyms = synonymResult.value.synonyms;
    state.synonymsRaw = synonymResult.value.raw;
    state.synSource = synonymResult.value;
  }

  if (conformerResult.status === 'fulfilled') {
    const conformerData = conformerResult.value;
    state.conformerSource = conformerData;
    state.conformers = conformerData.ids.map((id, index) => ({
      id,
      sdf: conformerData.records[index],
    }));
    state.conformerIndex = 0;
    state.sdfAllText = conformerData.text;
    state.sdfText = state.conformers[0].sdf;
    state.sdfSource = {
      text: state.sdfText,
      url: conformerUrl(conformerData.ids[0]),
      status: conformerData.status,
      bytes: new TextEncoder().encode(state.sdfText).byteLength,
      retrievedAt: conformerData.retrievedAt,
    };

    try {
      state.molecule = parseSdf(state.sdfText);
    } catch (error) {
      state.parseError = error;
    }

    const hashResult = await sha256Hex(new TextEncoder().encode(state.sdfText));
    state.hash = hashResult.hash;
    state.hashReason = hashResult.reason;

    const allHashResult = await sha256Hex(new TextEncoder().encode(state.sdfAllText));
    state.allHash = allHashResult.hash;
    state.allHashReason = allHashResult.reason;
  } else {
    state.no3d = conformerResult.reason?.code === 'NO_3D';
    state.sdfError = conformerResult.reason ?? new Error('Unknown 3D retrieval error');
  }

  if (token !== state.loadToken) return;

  ensureCompoundEntry();
  renderRecord(urls);
  updateRecent(cid, state.properties.Title || state.properties.IUPACName || `CID ${cid}`);
  renderCompoundList();
  updateExportAvailability();
  finishLoading();

  if (state.sdfText && viewer?.available) {
    try {
      renderScene();
      setToolbarEnabled(true);
      viewer.setSpin(state.spin);
    } catch (error) {
      console.error('3D render failed:', error);
      showViewerMessage({
        kind: 'error',
        title: 'The 3D model could not be rendered',
        text: 'PubChem returned a 3D record, but the WebGL viewer rejected it. The original SDF is still available for download.',
        imageUrl: urls.image2d,
        linkUrl: urls.page,
        linkLabel: 'Open record on PubChem',
        retry: false,
      });
    }
  } else if (state.sdfText) {
    if (state.editor && state.scene.length > 1 && viewer?.available) {
      renderScene();
      dom['viewer-message'].hidden = true;
      dom['viewer-empty'].hidden = true;
      dom['viewer-card'].dataset.state = 'ready';
      toast(`CID ${cid} could not be parsed for display; other compounds remain`, 'warning');
    } else {
      showViewerMessage({
        kind: 'error',
        title: state.parseError ? 'The 3D record could not be parsed' : 'WebGL is not available in this browser',
        text: state.parseError
          ? 'The SDF was retrieved, but its atom block could not be read for the viewer. The exact SDF, MOL and JSON exports are still available.'
          : 'You can still inspect the data and export the exact SDF. Enable hardware acceleration or try a current browser to view the 3D model.',
        imageUrl: urls.image2d,
        linkUrl: urls.page,
        linkLabel: 'Open record on PubChem',
        retry: false,
      });
    }
  } else if (state.editor && state.scene.length > 1 && viewer?.available) {
    renderScene();
    dom['viewer-message'].hidden = true;
    dom['viewer-empty'].hidden = true;
    dom['viewer-card'].dataset.state = 'ready';
    toast(`CID ${cid} has no 3D conformer — properties only`, 'warning');
  } else {
    showViewerMessage({
      kind: 'no3d',
      title: 'No 3D conformer published',
      text: `PubChem has a chemical record for CID ${cid}, but no 3D conformer for it. The 2D depiction and all reported properties are still available.`,
      imageUrl: urls.image2d,
      linkUrl: urls.page,
      linkLabel: 'Open record on PubChem',
      retry: false,
    });
  }

  updateExportAvailability();

  const loadedTitle = state.properties.Title || `CID ${cid}`;
  const multi = state.editor && state.scene.length > 1;
  toast(
    state.sdfText
      ? `${multi ? 'Added' : 'Loaded'} ${loadedTitle} with PubChem 3D coordinates${multi ? ` — ${state.scene.length} compounds` : ''}`
      : `${multi ? 'Added' : 'Loaded'} ${loadedTitle} — no 3D conformer`,
    state.sdfText ? 'success' : 'warning',
  );
}

function beginLoading(cid) {
  dom['viewer-card'].dataset.state = 'loading';
  dom['viewer-empty'].hidden = true;
  dom['viewer-message'].hidden = true;
  dom['viewer-loading'].hidden = false;
  dom['loading-cid'].textContent = String(cid);
  dom['viewer-loading'].querySelectorAll('[data-step]').forEach((step) => {
    step.dataset.status = 'pending';
    step.querySelector('.step-note').textContent = '';
  });
  dom['mol-title'].textContent = `Loading CID ${cid}…`;
  dom['mol-subtitle'].textContent = 'Querying PubChem PUG REST';
  dom['cid-badge'].hidden = true;
  dom['hud-record'].textContent = state.editor ? 'EDITOR · LOADING' : 'PUBCHEM PUG REST';
  dom['provenance-text'].textContent = 'Requesting live record…';
  dom['hash-mini'].hidden = true;
  dom['export-card'].hidden = true;
  dom['toggle-surface'].setAttribute('aria-pressed', 'false');
  dom['toggle-surface'].classList.remove('is-active');
  setToolbarEnabled(false);
  viewer?.clear();
}

function markStep(key, status, note = '') {
  const step = dom['viewer-loading'].querySelector(`[data-step="${key}"]`);
  if (!step) return;
  step.dataset.status = status;
  const noteNode = step.querySelector('.step-note');
  if (noteNode) noteNode.textContent = note;
}

function finishLoading() {
  dom['viewer-loading'].hidden = true;
  dom['viewer-message'].hidden = true;
  dom['viewer-empty'].hidden = true;
  dom['viewer-card'].dataset.state = 'ready';
}

function handleLoadError(error, cid, urls) {
  dom['viewer-loading'].hidden = true;
  dom['viewer-empty'].hidden = true;
  markStep('properties', 'error', 'Failed');
  dom['mol-title'].textContent = `CID ${cid}`;
  dom['mol-subtitle'].textContent = 'The record could not be loaded';
  dom['hud-record'].textContent = state.editor ? 'EDITOR · NO RECORD' : 'NO RECORD';
  dom['provenance-text'].textContent = 'Request failed';
  dom['cid-badge'].hidden = true;
  dom['export-card'].hidden = true;
  setToolbarEnabled(false);

  const code = error?.code;
  let title = `Could not load CID ${cid}`;
  let text = error?.message || 'An unexpected error occurred while contacting PubChem.';
  let linkUrl = urls.page;
  let linkLabel = 'Open on PubChem';
  let retry = true;

  if (code === 'NOT_FOUND') {
    title = `CID ${cid} was not found`;
    text = 'PubChem has no compound with this CID. Check the number, or search PubChem by name.';
    linkUrl = `https://pubchem.ncbi.nlm.nih.gov/#query=${encodeURIComponent(cid)}`;
    linkLabel = 'Search PubChem';
    retry = false;
  } else if (code === 'BUSY') {
    title = 'PubChem is busy';
    text = 'The service is throttling requests right now. Wait a moment and try again.';
  } else if (code === 'NETWORK') {
    title = 'PubChem could not be reached';
    text = 'Check your internet connection, then try again. The app fetches data live — nothing is bundled or simulated.';
  }

  if (code !== 'NOT_FOUND') markStep('properties', 'error', 'Failed');
  showViewerMessage({ kind: 'error', title, text, linkUrl, linkLabel, retry });
  toast(text, 'error');
}

/* ------------------------------- rendering ------------------------------ */

function resetRecordUI() {
  state.properties = null;
  state.propertiesRaw = null;
  state.propSource = null;
  state.synonyms = [];
  state.synonymsRaw = null;
  state.synSource = null;
  state.sdfText = null;
  state.sdfSource = null;
  state.conformers = [];
  state.conformerIndex = 0;
  state.sdfAllText = null;
  state.conformerSource = null;
  state.allHash = null;
  state.allHashReason = null;
  state.sdfError = null;
  state.no3d = false;
  state.molecule = null;
  state.parseError = null;
  state.hash = null;
  state.hashReason = null;
  state.retrievedAt = null;

  dom['conformer-control'].hidden = true;
  setConformerMenuOpen(false);
  dom['export-all-sdf'].hidden = true;
  dom['overview-empty'].hidden = false;
  dom['overview-content'].hidden = true;
  dom['identifiers-empty'].hidden = false;
  dom['identifiers-content'].hidden = true;
  dom['provenance-empty'].hidden = false;
  dom['provenance-content'].hidden = true;
  dom['hash-mini'].hidden = true;
  dom['export-card'].hidden = true;
  dom['structure-2d'].hidden = false;
  dom['structure-2d'].removeAttribute('src');
  dom['structure-fallback'].hidden = true;
  clearNode(dom['prop-groups']);
  clearNode(dom['identifiers-content']);
  clearNode(dom['provenance-content']);
  dom['cid-badge'].hidden = true;
  dom['export-note'].textContent = '';
  updateExportAvailability();
}

function conformerListUrl() {
  return urlsFor(state.cid).conformers;
}

function allConformersUrl() {
  const ids = state.conformers.map((conformer) => conformer.id);
  return ids.length > 40 ? conformerListUrl() : conformerUrl(ids);
}

function renderRecord(urls) {
  const properties = state.properties;
  const title = properties.Title || properties.IUPACName || `CID ${state.cid}`;
  const formula = properties.MolecularFormula || 'Formula not reported';
  const weight = properties.MolecularWeight ? `${properties.MolecularWeight} g/mol` : '';

  dom['mol-title'].textContent = title;
  dom['mol-subtitle'].textContent = [formula, weight].filter(Boolean).join(' · ');
  dom['cid-badge'].hidden = false;
  dom['cid-badge'].href = urls.page;
  dom['cid-badge'].title = `Open CID ${state.cid} on PubChem`;
  dom['cid-badge'].setAttribute('aria-label', `Open PubChem record for CID ${state.cid}`);
  dom['cid-badge-text'].textContent = `CID ${state.cid}`;

  dom['structure-formula'].textContent = formula;
  dom['structure-mw'].textContent = weight || 'Molecular weight not reported';
  dom['structure-link'].href = urls.page;
  dom['structure-2d'].src = urls.image2d;
  dom['structure-2d'].alt = `2D structure of ${title} (CID ${state.cid}) from PubChem`;
  dom['structure-2d'].hidden = false;
  dom['structure-fallback'].hidden = true;

  dom['overview-empty'].hidden = true;
  dom['overview-content'].hidden = false;
  renderPropertyGroups(dom['prop-groups'], properties);

  dom['identifiers-empty'].hidden = true;
  dom['identifiers-content'].hidden = false;
  renderIdentifiers(dom['identifiers-content'], properties, state.synonyms, urls.page);

  const sources = [
    {
      label: 'Property table (JSON)',
      url: urls.properties,
      bytes: state.propSource?.bytes,
      httpStatus: state.propSource?.status,
      status: 'ok',
    },
  ];

  if (state.conformerSource) {
    const listed = state.conformers.length;
    sources.push({
      label: '3D conformer list (JSON)',
      url: urls.conformers,
      bytes: state.conformerSource.listBytes,
      httpStatus: state.conformerSource.status,
      status: 'ok',
    });
    sources.push({
      label:
        listed > 1
          ? `3D conformer ${state.conformerIndex + 1} of ${listed} (SDF)`
          : '3D conformer (SDF)',
      url: state.sdfSource?.url ?? conformerUrl(state.conformers[0]?.id),
      bytes: state.sdfSource?.bytes,
      httpStatus: state.sdfSource?.status,
      status: 'ok',
    });
    if (listed > 1) {
      sources.push({
        label: `All ${listed} 3D conformers (SDF)`,
        url: allConformersUrl(),
        bytes: state.conformerSource.bytes,
        httpStatus: state.conformerSource.status,
        status: 'ok',
      });
    }
  } else {
    sources.push({
      label: '3D conformers (SDF)',
      url: urls.conformers,
      httpStatus: state.sdfError?.status,
      status: 'error',
      note: state.no3d ? 'No 3D record' : 'Request failed',
    });
  }

  sources.push({
    label: 'Synonyms (JSON)',
    url: urls.synonyms,
    bytes: state.synSource?.bytes,
    httpStatus: state.synSource?.status,
    status: state.synSource ? 'ok' : 'error',
    note: state.synSource ? '' : 'Unavailable',
  });

  const citation = buildCitation(properties, state.cid, state.retrievedAt);
  dom['provenance-empty'].hidden = true;
  dom['provenance-content'].hidden = false;
  renderProvenance(dom['provenance-content'], {
    cid: state.cid,
    properties,
    sources,
    hash: state.hash,
    hashReason: state.hashReason,
    sdfBytes: state.sdfSource?.bytes,
    conformerIndex: state.conformerIndex,
    conformerCount: state.conformers.length,
    conformerId: state.conformers[state.conformerIndex]?.id ?? null,
    allHash: state.allHash,
    allHashReason: state.allHashReason,
    allSdfBytes: state.conformerSource?.bytes ?? null,
    molecule: state.molecule,
    have3d: Boolean(state.sdfText),
    sdfError: Boolean(state.sdfError),
    retrievedAt: state.retrievedAt,
    citation,
    onDownloadJson: () => doExport('json'),
  });

  dom['export-card'].hidden = false;
  dom['export-cid'].textContent = `CID ${state.cid}`;
  const conformerLabel =
    state.conformers.length > 1
      ? `Showing conformer ${state.conformerIndex + 1} of ${state.conformers.length}. `
      : '';
  const sceneLabel =
    state.editor && state.scene.length > 1
      ? `Active compound: ${title}. Geometry exports use it; PNG captures the scene. `
      : '';
  const transformed = state.scene.some((entry) => {
    const transform = entry.transform;
    return Boolean(
      transform &&
        (transform.x ||
          transform.y ||
          transform.z ||
          transform.qx ||
          transform.qy ||
          transform.qz),
    );
  });
  const transformLabel = transformed
    ? 'Model transforms are visual only; SDF, MOL, XYZ and GLB use the original PubChem coordinates. '
    : '';
  dom['export-note'].textContent = state.sdfText
    ? `${sceneLabel}${transformLabel}${conformerLabel}${
        state.molecule
          ? 'SDF, MOL, XYZ and GLB are generated from the exact PubChem 3D conformer. JSON bundles the raw responses and integrity metadata.'
          : 'The exact SDF and MOL are available, but the atom block could not be parsed for XYZ or GLB generation. The raw JSON export still contains the full record.'
      }`
    : state.scene.some((entry) => entry.sdfText)
      ? 'No 3D conformer exists for the active compound, so its geometry exports are disabled. PNG still captures the scene, and JSON includes every compound in it.'
      : 'No 3D conformer exists for this CID, so geometry exports are disabled. The JSON export still contains the complete property table and provenance.';

  dom['hud-record'].textContent = hudRecordLabel();

  dom['provenance-text'].textContent = state.sdfText
    ? `Live PubChem record · retrieved ${formatTimestamp(state.retrievedAt)}`
    : `Live PubChem properties · no 3D record`;

  if (state.hash) {
    dom['hash-mini'].hidden = false;
    dom['hash-mini'].title = state.hash;
    dom['hash-mini-value'].textContent = `${state.hash.slice(0, 12)}…`;
  } else {
    dom['hash-mini'].hidden = true;
  }

  updateConformerUI();

  if (state.parseError) {
    console.warn('SDF parsed with warnings:', state.parseError);
  }
}

function showViewerMessage({ kind, title, text, imageUrl, linkUrl, linkLabel, retry }) {
  dom['viewer-empty'].hidden = true;
  dom['viewer-loading'].hidden = true;
  dom['viewer-message'].hidden = false;
  dom['viewer-card'].dataset.state = kind;
  dom['msg-title'].textContent = title;
  dom['msg-text'].textContent = text;

  if (imageUrl) {
    dom['msg-image'].src = imageUrl;
    dom['msg-image'].alt = '2D structure from PubChem';
    dom['msg-image'].hidden = false;
  } else {
    dom['msg-image'].removeAttribute('src');
    dom['msg-image'].hidden = true;
  }

  if (linkUrl) {
    dom['msg-link'].href = linkUrl;
    dom['msg-link'].textContent = linkLabel || 'Open on PubChem';
    dom['msg-link'].hidden = false;
  } else {
    dom['msg-link'].hidden = true;
  }

  dom['msg-retry'].hidden = !retry;
}

function buildCitation(properties, cid, retrievedAt) {
  const title = properties.Title ? `, ${properties.Title}` : '';
  const date = retrievedAt
    ? new Date(retrievedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  return `PubChem Compound Summary for CID ${cid}${title}. National Center for Biotechnology Information. https://pubchem.ncbi.nlm.nih.gov/compound/${cid} (accessed ${date}).`;
}

/* ------------------------------- recents -------------------------------- */

function readRecents() {
  try {
    const parsed = JSON.parse(localStorage.getItem('recentCids') || '[]');
    return Array.isArray(parsed)
      ? parsed
          .filter((entry) => Number.isSafeInteger(entry?.cid) && entry.cid > 0)
          .slice(0, 6)
      : [];
  } catch {
    return [];
  }
}

function updateRecent(cid, title) {
  const entries = readRecents().filter((entry) => entry.cid !== cid);
  entries.unshift({ cid, title });
  try {
    localStorage.setItem('recentCids', JSON.stringify(entries.slice(0, 6)));
  } catch {
    /* private mode */
  }
  renderRecentList();
}

function renderRecentList() {
  if (!dom['recent-list'] || !dom['recent-wrap']) return;
  const entries = readRecents();
  clearNode(dom['recent-list']);
  dom['recent-wrap'].hidden = entries.length === 0;

  for (const entry of entries) {
    dom['recent-list'].append(
      el(
        'button',
        {
          class: 'example-chip recent-chip',
          type: 'button',
          title: entry.title || `CID ${entry.cid}`,
          onclick: () => {
            dom['cid-input'].value = String(entry.cid);
            setSearchError('');
            loadCid(entry.cid);
          },
        },
        el('span', { class: 'recent-name', text: entry.title || `CID ${entry.cid}` }),
        el('span', { class: 'recent-cid', text: String(entry.cid) }),
      ),
    );
  }
}

/* --------------------------------- tabs --------------------------------- */

function bindTabs() {
  const tabs = $$('.tab');
  const panels = $$('.tab-panel');

  const activate = (name, focus = false) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    });
    panels.forEach((panel) => {
      panel.hidden = panel.id !== `panel-${name}`;
    });
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab.dataset.tab));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let target = index;
      if (event.key === 'ArrowLeft') target = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'ArrowRight') target = (index + 1) % tabs.length;
      if (event.key === 'Home') target = 0;
      if (event.key === 'End') target = tabs.length - 1;
      activate(tabs[target].dataset.tab, true);
    });
  });

  activate('overview');
}

/* -------------------------------- toolbar ------------------------------- */

function bindToolbar() {
  $$('.tool-style').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.style === state.style);
    button.setAttribute('aria-pressed', String(button.dataset.style === state.style));
    button.addEventListener('click', () => {
      state.style = button.dataset.style;
      localStorage.setItem('viewerStyle', state.style);
      $$('.tool-style').forEach((option) => {
        const active = option === button;
        option.classList.toggle('is-active', active);
        option.setAttribute('aria-pressed', String(active));
      });
      viewer?.setStyleName(state.style);
      renderCompoundList();
      updateSelectionHighlight();
    });
  });

  dom['toggle-h'].classList.toggle('is-active', state.showH);
  dom['toggle-h'].setAttribute('aria-pressed', String(state.showH));
  dom['toggle-h'].addEventListener('click', () => {
    state.showH = !state.showH;
    localStorage.setItem('showHydrogen', state.showH ? '1' : '0');
    dom['toggle-h'].classList.toggle('is-active', state.showH);
    dom['toggle-h'].setAttribute('aria-pressed', String(state.showH));
    viewer?.setShowHydrogen(state.showH);
  });

  dom['toggle-spin'].addEventListener('click', () => {
    state.spin = !state.spin;
    dom['toggle-spin'].classList.toggle('is-active', state.spin);
    dom['toggle-spin'].setAttribute('aria-pressed', String(state.spin));
    viewer?.setSpin(state.spin);
  });

  dom['toggle-surface'].addEventListener('click', async () => {
    if (!viewer?.model) return;
    const button = dom['toggle-surface'];
    const enabled = button.getAttribute('aria-pressed') !== 'true';
    button.disabled = true;
    try {
      await viewer.setSurface(enabled);
      button.setAttribute('aria-pressed', String(enabled));
      button.classList.toggle('is-active', enabled);
      toast(
        enabled
          ? 'Solvent-accessible surface generated locally from the PubChem coordinates'
          : 'Surface removed',
        'info',
      );
    } catch (error) {
      toast('The surface could not be generated for this molecule.', 'error');
      console.error(error);
    } finally {
      button.disabled = false;
    }
  });

  dom['reset-view'].addEventListener('click', () => viewer?.resetView());

  dom['screenshot'].addEventListener('click', () => doExport('png'));

  dom['fullscreen'].addEventListener('click', async () => {
    const target = dom['app-shell'] || dom['viewer-card'];
    try {
      if (!document.fullscreenElement) await target.requestFullscreen?.();
      else await document.exitFullscreen?.();
    } catch (error) {
      toast('Fullscreen is not available in this browser.', 'warning');
    }
  });

  document.addEventListener('fullscreenchange', () => {
    dom['fullscreen'].setAttribute('aria-pressed', String(Boolean(document.fullscreenElement)));
    setTimeout(() => viewer?.resize(), 60);
  });
}

/* -------------------------------- editor -------------------------------- */

function hudRecordLabel() {
  if (state.editor) {
    if (state.scene.length > 1) return `EDITOR · ${state.scene.length} COMPOUNDS`;
    if (!state.sdfText) return 'EDITOR · EMPTY VIEWPORT';
    const suffix =
      state.conformers.length > 1 ? ` ${state.conformerIndex + 1}/${state.conformers.length}` : '';
    return `EDITOR · 3D VIEWPORT${suffix}`;
  }

  if (!state.sdfText) return 'PUBCHEM 2D RECORD';
  return state.conformers.length > 1
    ? `PUBCHEM 3D CONFORMER ${state.conformerIndex + 1}/${state.conformers.length}`
    : 'PUBCHEM 3D CONFORMER';
}

function setEditorMode(enabled) {
  if (!enabled && state.studio.active) setStudioMode(false);
  state.editor = Boolean(enabled);

  if (!state.editor) state.selection = null;
  if (!state.editor && state.connect.active) setConnectMode(false);

  dom['app-shell']?.classList.toggle('is-editor', state.editor);
  dom['editor-toggle']?.classList.toggle('is-active', state.editor);
  dom['editor-toggle']?.setAttribute('aria-pressed', String(state.editor));
  if (dom['editor-toggle']) {
    dom['editor-toggle'].title = state.editor ? 'Exit editor' : 'Open the editor';
    dom['editor-toggle'].setAttribute('aria-label', state.editor ? 'Exit editor' : 'Open editor');
  }
  if (dom['editor-items']) dom['editor-items'].hidden = !state.editor;
  if (dom['connect-toggle']) dom['connect-toggle'].hidden = !state.editor;
  viewer?.setGizmoVisible(state.editor);

  if (dom['toggle-layers']) {
    dom['toggle-layers'].hidden = !state.editor;
    if (!state.editor) setLayersOpen(false);
  }
  if (dom['toggle-customize']) {
    dom['toggle-customize'].hidden = !state.editor;
    if (!state.editor) setCustomizeOpen(false);
  }

  if (dom['load-btn-label']) {
    dom['load-btn-label'].textContent = state.editor ? 'Add' : 'Load';
  }
  if (dom['load-btn']) {
    dom['load-btn'].title = state.editor
      ? 'Add another compound by CID'
      : 'Load a compound by CID';
  }

  if (state.properties) ensureCompoundEntry();
  renderCompoundList();
  renderScene();

  const tools = document.querySelector('.viewer-tools');
  tools?.setAttribute('aria-label', state.editor ? 'Editor tools' : '3D viewer controls');

  if (state.loading) {
    dom['hud-record'].textContent = state.editor ? 'EDITOR · LOADING' : 'PUBCHEM PUG REST';
  } else if (state.properties) {
    dom['hud-record'].textContent = hudRecordLabel();
  } else {
    dom['hud-record'].textContent = state.editor ? 'EDITOR · EMPTY VIEWPORT' : 'AWAITING RECORD';
  }

  requestAnimationFrame(() => viewer?.resize());
  toast(
    state.editor ? 'Editor mode — 3D viewport selected' : 'Back to viewer mode',
    'info',
  );
}

function selectEditorItem(item) {
  state.editorItem = item;
  $$('[data-editor-item]').forEach((button) => {
    const active = button.dataset.editorItem === item;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function bindEditor() {
  dom['editor-toggle']?.addEventListener('click', () => {
    if (state.studio.active) {
      setStudioMode(false);
      return;
    }
    setEditorMode(!state.editor);
  });
  $$('[data-editor-item]').forEach((button) => {
    button.addEventListener('click', () => selectEditorItem(button.dataset.editorItem));
  });
}

/* ------------------------------ customize ------------------------------- */

function saveAppearance() {
  try {
    localStorage.setItem('pubchem-appearance', JSON.stringify(state.appearance));
  } catch {
    /* storage can be unavailable */
  }
}

function applyAppearance(patch) {
  if (!state.studio.active) {
    const keys = Object.keys(patch).sort().join(',');
    snapshotUndo('Changed appearance', {
      key: `appearance:${keys}`,
      coalesce: true,
    });
  }
  Object.assign(state.appearance, patch);
  viewer?.setAppearance(patch);
  updateSelectionHighlight();
  saveAppearance();
}

function updateBackgroundControls() {
  const appearance = state.appearance;
  const transparent = appearance.background === 'transparent';
  const themeBackground =
    getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() ||
    '#050b10';

  if (dom['custom-background']) {
    dom['custom-background'].value =
      transparent || !appearance.background ? themeBackground : appearance.background;
    dom['custom-background'].title = transparent
      ? 'Pick a colour to leave transparency'
      : 'Custom viewport background';
  }

  const themeButton = dom['custom-background-reset'];
  const transparentButton = dom['custom-background-transparent'];
  if (themeButton) {
    const active = !appearance.background;
    themeButton.classList.toggle('is-active', active);
    themeButton.setAttribute('aria-pressed', String(active));
  }
  if (transparentButton) {
    transparentButton.classList.toggle('is-active', transparent);
    transparentButton.setAttribute('aria-pressed', String(transparent));
  }
  updateBackgroundStudioControls();
}

function updateCustomizeControls() {
  const appearance = state.appearance;
  const setRange = (id, value, label) => {
    const input = dom[id];
    if (input) input.value = String(value);
    const output = dom[`${id}-value`];
    if (output) output.textContent = label;
  };

  setRange('custom-atom-size', appearance.atomScale, `${appearance.atomScale.toFixed(2)}×`);
  setRange('custom-bond-size', appearance.bondScale, `${appearance.bondScale.toFixed(2)}×`);
  setRange('custom-opacity', appearance.opacity, `${Math.round(appearance.opacity * 100)}%`);
  setRange('custom-line-width', appearance.lineWidth, appearance.lineWidth.toFixed(1));
  setRange(
    'custom-material-gloss',
    appearance.materialGloss,
    `${Math.round(appearance.materialGloss * 100)}%`,
  );
  setRange(
    'custom-surface-opacity',
    appearance.surfaceOpacity,
    `${Math.round(appearance.surfaceOpacity * 100)}%`,
  );

  if (dom['custom-material']) dom['custom-material'].value = appearance.material;
  if (dom['custom-lighting']) dom['custom-lighting'].value = appearance.lighting;
  if (dom['custom-axes']) dom['custom-axes'].checked = appearance.showAxes;
  if (dom['custom-grid']) dom['custom-grid'].checked = appearance.showGrid;
  if (dom['custom-grid-plane']) dom['custom-grid-plane'].value = appearance.gridPlane;
  if (dom['custom-grid-mode']) dom['custom-grid-mode'].value = appearance.gridMode;
  if (dom['custom-scale']) dom['custom-scale'].checked = appearance.showScaleBar;
  if (dom['custom-units']) dom['custom-units'].checked = appearance.showUnitLabels;
  setRange(
    'custom-grid-spacing',
    appearance.gridSpacing,
    `${appearance.gridSpacing.toFixed(1)} Å`,
  );
  if (dom['custom-color-scheme']) {
    dom['custom-color-scheme'].value = appearance.colorScheme;
  }
  if (dom['custom-color-field']) {
    dom['custom-color-field'].hidden = appearance.colorScheme !== 'custom';
  }
  if (dom['custom-color']) dom['custom-color'].value = appearance.customColor;
  if (dom['custom-surface-color']) dom['custom-surface-color'].value = appearance.surfaceColor;
  updateBackgroundControls();
}

function bindCustomize() {
  updateCustomizeControls();

  const bindRange = (id, key, format, applyOnInput = true) => {
    const input = dom[id];
    if (!input) return;
    const output = dom[`${id}-value`];
    const handler = () => {
      const value = Number(input.value);
      if (output) output.textContent = format(value);
      if (applyOnInput) {
        applyAppearance({ [key]: value });
      } else {
        snapshotUndo('Changed appearance', {
          key: `appearance:${key}`,
          coalesce: true,
        });
        state.appearance[key] = value;
        saveAppearance();
      }
    };
    input.addEventListener('input', handler);
    if (!applyOnInput) {
      input.addEventListener('change', () => {
        const value = Number(input.value);
        viewer?.setAppearance({ [key]: value });
        updateSelectionHighlight();
        saveAppearance();
      });
    }
  };

  bindRange('custom-atom-size', 'atomScale', (value) => `${value.toFixed(2)}×`);
  bindRange('custom-bond-size', 'bondScale', (value) => `${value.toFixed(2)}×`);
  bindRange('custom-opacity', 'opacity', (value) => `${Math.round(value * 100)}%`);
  bindRange('custom-line-width', 'lineWidth', (value) => value.toFixed(1));
  bindRange(
    'custom-material-gloss',
    'materialGloss',
    (value) => `${Math.round(value * 100)}%`,
  );
  bindRange(
    'custom-surface-opacity',
    'surfaceOpacity',
    (value) => `${Math.round(value * 100)}%`,
    false,
  );
  bindRange(
    'custom-grid-spacing',
    'gridSpacing',
    (value) => `${value.toFixed(1)} Å`,
  );

  dom['custom-lighting']?.addEventListener('change', () => {
    applyAppearance({ lighting: dom['custom-lighting'].value });
  });

  const bindOverlayToggle = (id, key) => {
    dom[id]?.addEventListener('change', () => {
      applyAppearance({ [key]: Boolean(dom[id].checked) });
    });
  };
  bindOverlayToggle('custom-axes', 'showAxes');
  bindOverlayToggle('custom-grid', 'showGrid');
  bindOverlayToggle('custom-scale', 'showScaleBar');
  bindOverlayToggle('custom-units', 'showUnitLabels');

  dom['custom-grid-plane']?.addEventListener('change', () => {
    applyAppearance({ gridPlane: dom['custom-grid-plane'].value });
  });
  dom['custom-grid-mode']?.addEventListener('change', () => {
    applyAppearance({ gridMode: dom['custom-grid-mode'].value });
  });

  dom['custom-material']?.addEventListener('change', () => {
    const material = dom['custom-material'].value;
    const patch = { material };
    if (material !== 'standard' && state.appearance.colorScheme === 'custom') {
      // A named finish has its own element palette; show it immediately.
      patch.colorScheme = 'Jmol';
    }
    applyAppearance(patch);
    updateCustomizeControls();
    renderCompoundList();
  });

  dom['custom-material-gloss']?.addEventListener('change', () => {
    renderCompoundList();
  });

  dom['custom-color-scheme']?.addEventListener('change', () => {
    applyAppearance({ colorScheme: dom['custom-color-scheme'].value });
    updateCustomizeControls();
    renderCompoundList();
  });

  dom['custom-color']?.addEventListener('input', () => {
    applyAppearance({ customColor: dom['custom-color'].value });
  });

  dom['custom-surface-color']?.addEventListener('change', () => {
    applyAppearance({ surfaceColor: dom['custom-surface-color'].value });
  });

  dom['custom-background']?.addEventListener('input', () => {
    applyAppearance({ background: dom['custom-background'].value });
    updateBackgroundControls();
  });

  dom['custom-background-reset']?.addEventListener('click', () => {
    applyAppearance({ background: null });
    updateBackgroundControls();
  });

  dom['custom-background-transparent']?.addEventListener('click', () => {
    applyAppearance({ background: 'transparent' });
    updateBackgroundControls();
  });

  dom['custom-reset']?.addEventListener('click', () => {
    snapshotUndo('Reset appearance');
    state.appearance = { ...APPEARANCE_DEFAULTS };
    viewer?.setAppearance(state.appearance);
    updateSelectionHighlight();
    saveAppearance();
    updateCustomizeControls();
    renderCompoundList();
  });
}

/* -------------------------------- exports ------------------------------- */

function bindExports() {
  $$('[data-export]').forEach((button) => {
    button.addEventListener('click', () => doExport(button.dataset.export));
  });

  if (dom['glb-scope']) dom['glb-scope'].value = state.exportOptions.glbScope;
  if (dom['glb-quality']) dom['glb-quality'].value = state.exportOptions.glbQuality;
  if (dom['glb-style']) dom['glb-style'].value = state.exportOptions.glbStyle;
  const saveOptions = () => {
    try {
      localStorage.setItem('glbScope', state.exportOptions.glbScope);
      localStorage.setItem('glbQuality', state.exportOptions.glbQuality);
      localStorage.setItem('glbStyle', state.exportOptions.glbStyle);
    } catch {
      /* storage can be unavailable */
    }
    updateExportAvailability();
  };
  dom['glb-scope']?.addEventListener('change', () => {
    state.exportOptions.glbScope = dom['glb-scope'].value === 'active' ? 'active' : 'scene';
    saveOptions();
  });
  dom['glb-quality']?.addEventListener('change', () => {
    state.exportOptions.glbQuality = Object.prototype.hasOwnProperty.call(
      GLB_QUALITY_PRESETS,
      dom['glb-quality'].value,
    )
      ? dom['glb-quality'].value
      : 'high';
    saveOptions();
  });
  dom['glb-style']?.addEventListener('change', () => {
    state.exportOptions.glbStyle = [
      'viewer',
      'ball-stick',
      'sticks',
      'spheres',
      'lines',
    ].includes(dom['glb-style'].value)
      ? dom['glb-style'].value
      : 'viewer';
    saveOptions();
  });
}

/* ------------------------------- conformers ------------------------------ */

function bindConformers() {
  dom['conformer-trigger']?.addEventListener('click', () => {
    setConformerMenuOpen(dom['conformer-menu']?.hidden);
  });

  dom['conformer-menu']?.addEventListener('click', (event) => {
    const option = event.target.closest('[data-conformer-index]');
    if (!option) return;
    setConformerMenuOpen(false);
    dom['conformer-trigger']?.focus();
    selectConformer(Number(option.dataset.conformerIndex));
  });

  dom['conformer-menu']?.addEventListener('focusout', (event) => {
    if (!event.relatedTarget?.closest?.('.conformer-picker')) setConformerMenuOpen(false);
  });

  dom['conformer-menu']?.addEventListener('keydown', (event) => {
    const options = [...dom['conformer-menu'].querySelectorAll('[data-conformer-index]')];
    const current = options.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      options[Math.min(current + 1, options.length - 1)]?.focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      options[Math.max(current - 1, 0)]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      options[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      options[options.length - 1]?.focus();
    }
  });

  dom['conformer-prev']?.addEventListener('click', () => selectConformer(state.conformerIndex - 1));
  dom['conformer-next']?.addEventListener('click', () => selectConformer(state.conformerIndex + 1));
  dom['export-all-sdf']?.addEventListener('click', () => doExport('sdf-all'));

  document.addEventListener('click', (event) => {
    if (!dom['conformer-menu'] || dom['conformer-menu'].hidden) return;
    if (!event.target.closest('.conformer-picker')) setConformerMenuOpen(false);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom['conformer-menu'] && !dom['conformer-menu'].hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      setConformerMenuOpen(false);
      dom['conformer-trigger']?.focus();
    }
  });
}

function setConformerMenuOpen(open) {
  const menu = dom['conformer-menu'];
  const trigger = dom['conformer-trigger'];
  if (!menu || !trigger) return;

  menu.hidden = !open;
  trigger.setAttribute('aria-expanded', String(Boolean(open)));
  trigger.classList.toggle('is-open', Boolean(open));

  if (open) {
    const selected = menu.querySelector('[aria-selected="true"]');
    (selected || menu.firstElementChild)?.focus();
  }
}

function updateConformerUI() {
  const control = dom['conformer-control'];
  if (!control) return;

  const total = state.conformers.length;
  const visible = total > 1 && Boolean(state.sdfText);
  control.hidden = !visible;

  const allButton = dom['export-all-sdf'];
  if (allButton) {
    allButton.hidden = !visible;
    if (visible) allButton.textContent = `Download all ${total} conformers (SDF)`;
  }

  if (!visible) {
    setConformerMenuOpen(false);
    return;
  }

  const menu = dom['conformer-menu'];
  if (menu && menu.children.length !== total) {
    clearNode(menu);
    state.conformers.forEach((conformer, index) => {
      const option = el('button', {
        class: 'conformer-option',
        type: 'button',
        text: `Conformer ${index + 1}`,
        dataset: { conformerIndex: String(index) },
        attrs: {
          role: 'option',
          'aria-selected': String(index === state.conformerIndex),
        },
      });
      option.title = conformer.id;
      menu.append(option);
    });
  }

  if (menu) {
    [...menu.children].forEach((option, index) => {
      option.setAttribute('aria-selected', String(index === state.conformerIndex));
    });
  }

  if (dom['conformer-trigger-text']) {
    dom['conformer-trigger-text'].textContent = `Conformer ${state.conformerIndex + 1}`;
  }
  dom['conformer-trigger']?.setAttribute(
    'aria-label',
    `Select 3D conformer, currently ${state.conformerIndex + 1} of ${total}`,
  );
  if (dom['conformer-count']) {
    dom['conformer-count'].textContent = `/ ${total}`;
  }
  if (dom['conformer-prev']) dom['conformer-prev'].disabled = state.conformerIndex === 0;
  if (dom['conformer-next']) dom['conformer-next'].disabled = state.conformerIndex >= total - 1;
}

async function selectConformer(index) {
  const total = state.conformers.length;
  if (total < 2) return;

  const next = Math.max(0, Math.min(index, total - 1));
  if (next === state.conformerIndex && state.sdfText) return;

  const token = state.conformerToken + 1;
  state.conformerToken = token;

  state.conformerIndex = next;
  const conformer = state.conformers[next];
  state.glbBytes = null;
  state.parseError = null;
  state.sdfText = conformer.sdf;
  state.sdfSource = {
    text: conformer.sdf,
    url: conformerUrl(conformer.id),
    status: state.conformerSource?.status ?? 200,
    bytes: new TextEncoder().encode(conformer.sdf).byteLength,
    retrievedAt: state.conformerSource?.retrievedAt ?? state.retrievedAt,
  };

  try {
    state.molecule = parseSdf(conformer.sdf);
  } catch (error) {
    state.molecule = null;
    state.parseError = error;
  }

  const hashResult = await sha256Hex(new TextEncoder().encode(conformer.sdf));
  if (token !== state.conformerToken) return;
  state.hash = hashResult.hash;
  state.hashReason = hashResult.reason;

  ensureCompoundEntry();
  renderRecord(urlsFor(state.cid));
  renderCompoundList();

  if (state.molecule && viewer?.available) {
    try {
      renderScene();
      viewer.setSpin(state.spin);
      dom['toggle-surface'].setAttribute('aria-pressed', 'false');
      dom['toggle-surface'].classList.remove('is-active');
      setToolbarEnabled(true);
    } catch (error) {
      console.error('3D render failed:', error);
      setToolbarEnabled(false);
    }
  } else {
    renderScene();
    setToolbarEnabled(false);
  }

  updateExportAvailability();
  toast(`Viewing conformer ${next + 1} of ${total}`, 'info');
}

/* ------------------------------- scene ---------------------------------- */

const COMPOUND_FIELDS = [
  'cid',
  'properties',
  'propertiesRaw',
  'propSource',
  'synonyms',
  'synonymsRaw',
  'synSource',
  'conformers',
  'conformerIndex',
  'sdfText',
  'sdfAllText',
  'sdfSource',
  'conformerSource',
  'molecule',
  'parseError',
  'hash',
  'hashReason',
  'allHash',
  'allHashReason',
  'sdfError',
  'no3d',
  'retrievedAt',
];

function compoundTitle(entry) {
  return entry.properties?.Title || entry.properties?.IUPACName || `CID ${entry.cid}`;
}

function syncUrlCid(cid) {
  if (!cid) return;
  try {
    const url = new URL(window.location.href);
    url.searchParams.set('cid', String(cid));
    window.history.replaceState(null, '', url);
  } catch {
    /* file:// or sandboxed contexts can refuse history updates */
  }
}

function ensureCompoundEntry() {
  if (!state.cid) return null;
  let entry = state.scene.find((item) => item.key === state.activeKey);
  if (!entry) {
    entry = { key: `compound-${state.nextCompoundKey++}` };
    state.scene.push(entry);
    state.activeKey = entry.key;
  }
  for (const field of COMPOUND_FIELDS) entry[field] = state[field];
  if (!entry.transform) entry.transform = defaultTransform();
  if (!entry.layers) entry.layers = { visible: true, atoms: true, bonds: true, hiddenElements: [] };
  if (!entry.ui) entry.ui = { expanded: false, atomsExpanded: false };
  entry.title = compoundTitle(entry);
  return entry;
}

function activateCompound(key, { updateUrl = true, render = true } = {}) {
  const entry = state.scene.find((item) => item.key === key);
  if (!entry) return;

  if (state.selection && state.selection.entryKey !== entry.key) {
    state.selection = null;
  }

  for (const field of COMPOUND_FIELDS) state[field] = entry[field];
  state.activeKey = entry.key;
  state.conformerToken += 1;
  state.loading = false;
  state.glbBytes = null;

  dom['cid-input'].value = String(entry.cid);
  dom['clear-btn'].hidden = false;
  if (updateUrl) syncUrlCid(entry.cid);

  renderRecord(urlsFor(entry.cid));
  renderCompoundList();
  if (render) renderScene();
  updateSelectionHighlight();
  updateTransformBar();
  updateExportAvailability();
}

function removeCompound(key) {
  const index = state.scene.findIndex((entry) => entry.key === key);
  if (index < 0) return;
  const wasActive = state.scene[index].key === state.activeKey;
  if (state.selection?.entryKey === key) {
    state.selection = null;
  }
  state.scene.splice(index, 1);
  state.undoStack = [];
  state.redoStack = [];
  if (state.studio.items) delete state.studio.items[key];
  state.connections = state.connections.filter(
    (connection) =>
      connection.a.entryKey !== key && connection.b.entryKey !== key,
  );
  if (
    state.selection?.type === 'connection' &&
    !state.connections.some((connection) => connection.id === state.selection.id)
  ) {
    state.selection = null;
  }
  if (state.connect.first?.entryKey === key) {
    state.connect.first = null;
    updateConnectUI();
    updateSelectionHighlight();
  }
  renderConnectionList();

  if (!state.scene.length) {
    clearScene();
    return;
  }

  if (wasActive) {
    const next = state.scene[Math.min(index, state.scene.length - 1)];
    activateCompound(next.key);
  } else {
    renderCompoundList();
    renderScene();
  }
}

function updateSceneTools() {
  $$('[data-layout]').forEach((button) => {
    const active = button.dataset.layout === state.layoutMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const hasScene = state.scene.length > 0;
  for (const id of ['scene-fit', 'scene-reset']) {
    if (dom[id]) dom[id].disabled = !hasScene;
  }
}

function setSceneLayout(mode) {
  if (!['row', 'grid', 'circle'].includes(mode)) return;
  if (state.layoutMode === mode) return;
  if (state.studio.active) setStudioMode(false);
  snapshotUndo('Changed scene arrangement');
  state.layoutMode = mode;
  try {
    localStorage.setItem('sceneLayout', mode);
  } catch {
    /* storage can be unavailable */
  }
  renderScene();
  updateSceneTools();
  toast(`Arranged compounds in a ${mode}.`, 'info');
}

function centerFitScene() {
  if (!viewer?.available) return;
  if (state.studio.active) pauseStudioPlayback();
  viewer.fitScene();
  viewer.viewer?.render();
  if (state.studio.active && state.studio.base && viewer?.viewer) {
    state.studio.base.view = viewer.viewer.getView().slice();
    applyStudioTime(state.studio.time);
  }
  toast('Centred and fitted the scene.', 'info');
}

function resetAllTransforms() {
  if (!state.scene.length) return;
  snapshotUndo('Reset all transforms');
  for (const entry of state.scene) entry.transform = defaultTransform();
  applySceneTransforms(state.renderedEntries);
  viewer?.fitScene();
  if (state.studio.active && state.studio.base) {
    state.studio.base.entries = state.renderedEntries.map((entry) => ({
      key: entry.key,
      transform: { ...ensureEntryTransform(entry) },
    }));
    state.studio.base.view = viewer?.viewer?.getView?.()?.slice() || state.studio.base.view;
    applyStudioTime(0);
  }
  updateSelectionHighlight();
  toast('Reset every compound transform.', 'info');
}

function duplicateCompound(key) {
  const source = state.scene.find((entry) => entry.key === key);
  if (!source) return;
  const clone = cloneJson(source);
  clone.key = `compound-${state.nextCompoundKey++}`;
  clone.title = compoundTitle(clone);
  clone.ui = {
    expanded: false,
    atomsExpanded: false,
    expandedElements: [],
    ...(clone.ui || {}),
  };
  ensureEntryLayers(clone);
  const index = state.scene.findIndex((entry) => entry.key === key);
  state.scene.splice(index + 1, 0, clone);
  state.activeKey = clone.key;
  state.undoStack = [];
  state.redoStack = [];
  activateCompound(clone.key);
  toast(`Duplicated ${compoundTitle(source)}.`, 'success');
}

function clearScene() {
  if (state.studio.active) setStudioMode(false);
  state.scene = [];
  state.activeKey = null;
  state.cid = null;
  state.renderedEntries = [];
  state.selection = null;
  state.connections = [];
  state.connect.first = null;
  state.undoStack = [];
  state.redoStack = [];
  state.studio.items = {};
  state.studio.sceneMotion = 'spin';
  state.studio.sceneAxis = 'y';
  state.studio.cameraMotion = 'none';
  state.studio.cameraAxis = 'y';
  state.studio.cameraAngle = 360;
  state.studio.manualView = false;
  state.studio.time = 0;
  if (state.connect.active) setConnectMode(false);
  resetRecordUI();
  viewer?.clear();
  dom['viewer-empty'].hidden = false;
  dom['viewer-message'].hidden = true;
  dom['viewer-loading'].hidden = true;
  dom['viewer-card'].dataset.state = 'empty';
  dom['mol-title'].textContent = 'No molecule loaded';
  dom['mol-subtitle'].textContent = 'Search a PubChem CID to begin.';
  dom['hud-record'].textContent = state.editor ? 'EDITOR · EMPTY VIEWPORT' : 'AWAITING RECORD';
  dom['provenance-text'].textContent = 'No record loaded';
  dom['hash-mini'].hidden = true;
  setToolbarEnabled(false);
  renderCompoundList();
  updateTransformBar();
}

function defaultTransform() {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

function ensureEntryTransform(entry) {
  if (!entry.transform) entry.transform = defaultTransform();
  return entry.transform;
}

function buildScenePlacements(entries) {
  const gap = 3;
  const boxes = entries.map((entry) => {
    const atoms = entry.molecule.atoms;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const atom of atoms) {
      minX = Math.min(minX, atom.x);
      maxX = Math.max(maxX, atom.x);
      minY = Math.min(minY, atom.y);
      maxY = Math.max(maxY, atom.y);
      minZ = Math.min(minZ, atom.z);
      maxZ = Math.max(maxZ, atom.z);
    }
    return {
      minX,
      maxX,
      minY,
      maxY,
      minZ,
      maxZ,
      width: Math.max(maxX - minX, 0.8),
      height: Math.max(maxY - minY, 0.8),
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2,
      centerZ: (minZ + maxZ) / 2,
    };
  });

  const count = entries.length;
  const mode = ['row', 'grid', 'circle'].includes(state.layoutMode)
    ? state.layoutMode
    : 'row';
  let rawOffsets;

  if (count <= 1) {
    rawOffsets = boxes.map(() => ({ x: 0, y: 0, z: 0 }));
  } else if (mode === 'grid') {
    const columns = Math.ceil(Math.sqrt(count));
    const rows = Math.ceil(count / columns);
    const cellWidth = Math.max(...boxes.map((box) => box.width)) + gap;
    const cellHeight = Math.max(...boxes.map((box) => box.height)) + gap;
    const totalWidth = columns * cellWidth - gap;
    const totalHeight = rows * cellHeight - gap;
    rawOffsets = boxes.map((box, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const cellX = -totalWidth / 2 + column * cellWidth + cellWidth / 2;
      const cellY = totalHeight / 2 - row * cellHeight - cellHeight / 2;
      return {
        x: cellX - box.centerX,
        y: cellY - box.centerY,
        z: -box.centerZ,
      };
    });
  } else if (mode === 'circle') {
    const maxDimension = Math.max(
      ...boxes.map((box) => Math.max(box.width, box.height)),
      2,
    );
    const radius = Math.max(
      (maxDimension * 0.62) / Math.sin(Math.PI / count),
      maxDimension * 0.7,
    );
    rawOffsets = boxes.map((box, index) => {
      const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
      return {
        x: Math.cos(angle) * radius - box.centerX,
        y: Math.sin(angle) * radius - box.centerY,
        z: -box.centerZ,
      };
    });
  } else {
    let cursor = 0;
    rawOffsets = boxes.map((box) => {
      const centerX = cursor + box.width / 2;
      cursor = centerX + box.width / 2 + gap;
      return {
        x: centerX - box.centerX,
        y: -box.centerY,
        z: -box.centerZ,
      };
    });
    const totalWidth = cursor - gap;
    rawOffsets = rawOffsets.map((offset) => ({
      ...offset,
      x: offset.x - totalWidth / 2,
    }));
  }

  return entries.map((entry, index) => {
    const offset = rawOffsets[index];
    const box = boxes[index];
    entry.layoutOffset = offset;
    entry.layoutCenter = {
      x: box.centerX + offset.x,
      y: box.centerY + offset.y,
      z: box.centerZ + offset.z,
    };
    ensureEntryTransform(entry);

    return { entry, text: translateSdf(entry.sdfText, offset) };
  });
}

function applySceneTransforms(
  entries,
  onlyKey = null,
  { render = true, highlight = true } = {},
) {
  if (!viewer?.available) return;
  const models = viewer.models || [];
  let changed = false;

  entries.forEach((entry, index) => {
    if (onlyKey && entry.key !== onlyKey) return;
    const model = models[index];
    if (!model || !entry.molecule || !model.atoms) return;
    const source = entry.molecule.atoms;
    if (model.atoms.length !== source.length) return;

    const offset = entry.layoutOffset || { x: 0, y: 0, z: 0 };
    const center = entry.layoutCenter || { x: 0, y: 0, z: 0 };
    const transform = ensureEntryTransform(entry);
    const q = { x: transform.qx, y: transform.qy, z: transform.qz, w: transform.qw };

    for (let i = 0; i < model.atoms.length; i += 1) {
      const bx = source[i].x + offset.x;
      const by = source[i].y + offset.y;
      const bz = source[i].z + offset.z;
      const rotated = rotateVector(bx - center.x, by - center.y, bz - center.z, q);
      model.atoms[i].x = center.x + rotated.x + transform.x;
      model.atoms[i].y = center.y + rotated.y + transform.y;
      model.atoms[i].z = center.z + rotated.z + transform.z;
    }
    model.molObj = null;
    changed = true;
  });

  if (changed) {
    if (highlight) {
      updateSelectionHighlight();
    } else if (render) {
      viewer.viewer.render();
    }
  }
}

const ELEMENT_COLORS = {
  H: '#e8eef0',
  C: '#8b979f',
  N: '#4f7cff',
  O: '#e5484d',
  F: '#22c55e',
  P: '#f97316',
  S: '#eab308',
  Cl: '#22c55e',
  Br: '#a855f7',
  I: '#7c3aed',
};

const COVALENT_RADII = {
  H: 0.31,
  B: 0.84,
  C: 0.76,
  N: 0.71,
  O: 0.66,
  F: 0.57,
  Si: 1.11,
  P: 1.07,
  S: 1.05,
  Cl: 1.02,
  Br: 1.2,
  I: 1.39,
};

function baseElementColor(element) {
  if (state.appearance.colorScheme === 'custom') return state.appearance.customColor;
  return viewer?.materialColor(element) || ELEMENT_COLORS[element] || '#8b979f';
}

function ensureEntryLayers(entry) {
  if (!entry.layers) entry.layers = {};
  const layers = entry.layers;
  if (layers.visible === undefined) layers.visible = true;
  if (layers.atoms === undefined) layers.atoms = true;
  if (layers.bonds === undefined) layers.bonds = true;
  if (!Array.isArray(layers.hiddenElements)) layers.hiddenElements = [];
  if (!Array.isArray(layers.hiddenAtoms)) layers.hiddenAtoms = [];
  if (!Array.isArray(layers.hiddenBonds)) layers.hiddenBonds = [];

  if (!layers.atomColors || typeof layers.atomColors !== 'object') layers.atomColors = {};
  if (!layers.bondOrders || typeof layers.bondOrders !== 'object') layers.bondOrders = {};

  if (layers.compoundOpacity == null) layers.compoundOpacity = null;
  if (layers.atomsColor == null) layers.atomsColor = null;
  if (layers.atomsScale == null) layers.atomsScale = 1;
  if (layers.atomsOpacity == null) layers.atomsOpacity = null;
  if (layers.bondsRadius == null) layers.bondsRadius = 1;
  if (layers.bondsOpacity == null) layers.bondsOpacity = null;
  if (layers.bondsColor == null) layers.bondsColor = null;

  if (layers.material == null) layers.material = null;
  if (layers.atomsMaterial == null) layers.atomsMaterial = null;
  if (layers.bondsMaterial == null) layers.bondsMaterial = null;
  if (layers.gloss == null) layers.gloss = null;
  if (layers.atomsGloss == null) layers.atomsGloss = null;
  if (layers.bondsGloss == null) layers.bondsGloss = null;

  for (const key of [
    'elementColors',
    'elementScales',
    'elementOpacities',
    'elementMaterials',
    'elementGlosses',
    'atomScales',
    'atomOpacities',
    'atomMaterials',
    'atomGlosses',
    'bondColors',
    'bondScales',
    'bondOpacities',
    'bondMaterials',
    'bondGlosses',
  ]) {
    if (!layers[key] || typeof layers[key] !== 'object') layers[key] = {};
  }

  if (!entry.ui) entry.ui = {};
  if (typeof entry.ui.expanded !== 'boolean') entry.ui.expanded = false;
  if (typeof entry.ui.atomsExpanded !== 'boolean') entry.ui.atomsExpanded = false;
  if (!Array.isArray(entry.ui.expandedElements)) entry.ui.expandedElements = [];
  if (typeof entry.ui.bondsExpanded !== 'boolean') entry.ui.bondsExpanded = false;
  return layers;
}

function scopeMaterial(value) {
  return value && value !== 'inherit' ? value : null;
}

function itemMaterialColor(material, element, gloss) {
  const name = scopeMaterial(material) || state.appearance.material;
  return materialElementColor(
    name,
    element,
    gloss == null ? state.appearance.materialGloss : gloss,
  );
}

function itemMaterialOpacity(material, gloss) {
  const name = scopeMaterial(material);
  if (!name) return null;
  return materialOpacity(
    name,
    gloss == null ? state.appearance.materialGloss : gloss,
  );
}

function resolveMaterialScope(layers, atom, index) {
  const atomMaterial = scopeMaterial(layers.atomMaterials[index]);
  if (atomMaterial) {
    return {
      material: atomMaterial,
      gloss: layers.atomGlosses[index] ?? state.appearance.materialGloss,
    };
  }
  const elementMaterial = scopeMaterial(layers.elementMaterials[atom.element]);
  if (elementMaterial) {
    return {
      material: elementMaterial,
      gloss:
        layers.elementGlosses[atom.element] ?? state.appearance.materialGloss,
    };
  }
  const atomsMaterial = scopeMaterial(layers.atomsMaterial);
  if (atomsMaterial) {
    return {
      material: atomsMaterial,
      gloss: layers.atomsGloss ?? state.appearance.materialGloss,
    };
  }
  const compoundMaterial = scopeMaterial(layers.material);
  if (compoundMaterial) {
    return {
      material: compoundMaterial,
      gloss: layers.gloss ?? state.appearance.materialGloss,
    };
  }
  return null;
}

function resolveAtomColor(layers, atom, index) {
  if (layers.atomColors[index]) return layers.atomColors[index];
  const atomMaterial = scopeMaterial(layers.atomMaterials[index]);
  if (atomMaterial) {
    return itemMaterialColor(
      atomMaterial,
      atom.element,
      layers.atomGlosses[index] ?? state.appearance.materialGloss,
    );
  }

  if (layers.elementColors[atom.element]) return layers.elementColors[atom.element];
  const elementMaterial = scopeMaterial(layers.elementMaterials[atom.element]);
  if (elementMaterial) {
    return itemMaterialColor(
      elementMaterial,
      atom.element,
      layers.elementGlosses[atom.element] ?? state.appearance.materialGloss,
    );
  }

  if (layers.atomsColor) return layers.atomsColor;
  const atomsMaterial = scopeMaterial(layers.atomsMaterial);
  if (atomsMaterial) {
    return itemMaterialColor(
      atomsMaterial,
      atom.element,
      layers.atomsGloss ?? state.appearance.materialGloss,
    );
  }

  const compoundMaterial = scopeMaterial(layers.material);
  if (compoundMaterial) {
    return itemMaterialColor(
      compoundMaterial,
      atom.element,
      layers.gloss ?? state.appearance.materialGloss,
    );
  }

  const gloss =
    layers.atomGlosses[index] ??
    layers.elementGlosses[atom.element] ??
    layers.atomsGloss ??
    layers.gloss;
  if (gloss != null) {
    if (state.appearance.colorScheme === 'custom') {
      return glossColor(state.appearance.customColor, gloss);
    }
    return itemMaterialColor(null, atom.element, gloss);
  }

  return null;
}

function resolveAtomOpacity(layers, atom, index) {
  const scope = resolveMaterialScope(layers, atom, index);
  const baseOpacity =
    layers.atomOpacities[index] ??
    layers.elementOpacities[atom.element] ??
    layers.atomsOpacity ??
    layers.compoundOpacity ??
    state.appearance.opacity;

  if (scope) {
    const factor = materialOpacity(scope.material, scope.gloss) ?? 1;
    return Math.min(1, Math.max(0.05, baseOpacity * factor));
  }

  const hasExplicitOpacity =
    layers.atomOpacities[index] != null ||
    layers.elementOpacities[atom.element] != null ||
    layers.atomsOpacity != null ||
    layers.compoundOpacity != null;
  return hasExplicitOpacity ? baseOpacity : null;
}

function entryLayerOptions(entry) {
  const layers = ensureEntryLayers(entry);
  const hasAtomAppearance = Boolean(
    scopeMaterial(layers.material) ||
      scopeMaterial(layers.atomsMaterial) ||
      layers.gloss != null ||
      layers.atomsGloss != null ||
      Object.keys(layers.elementMaterials).length ||
      Object.keys(layers.elementGlosses).length ||
      Object.keys(layers.atomMaterials).length ||
      Object.keys(layers.atomGlosses).length,
  );

  let atomColors = layers.atomColors;
  let atomOpacities = layers.atomOpacities;
  let elementColors = layers.elementColors;
  let elementOpacities = layers.elementOpacities;
  let atomsColor = layers.atomsColor;
  let atomsOpacity = layers.atomsOpacity;
  let compoundOpacity = layers.compoundOpacity;

  if (hasAtomAppearance && entry.molecule?.atoms?.length) {
    atomColors = {};
    atomOpacities = {};
    elementColors = {};
    elementOpacities = {};
    atomsColor = null;
    atomsOpacity = null;
    compoundOpacity = null;

    entry.molecule.atoms.forEach((atom, index) => {
      const color = resolveAtomColor(layers, atom, index);
      if (color) atomColors[index] = color;
      const opacity = resolveAtomOpacity(layers, atom, index);
      if (opacity != null) atomOpacities[index] = opacity;
    });
  }

  return {
    visible: layers.visible !== false,
    atoms: layers.atoms !== false,
    bonds: layers.bonds !== false,
    hiddenElements: layers.hiddenElements,
    hiddenAtoms: layers.hiddenAtoms,
    atomColors,
    atomScales: layers.atomScales,
    atomOpacities,
    elementColors,
    elementScales: layers.elementScales,
    elementOpacities,
    atomsColor,
    atomsScale: layers.atomsScale,
    atomsOpacity,
    bondsRadius: layers.bondsRadius,
    bondsOpacity: layers.bondsOpacity,
    bondsColor: layers.bondsColor,
    compoundOpacity,
  };
}

function applySceneLayers() {
  if (!viewer?.available) return;
  viewer.setLayerOptions(state.renderedEntries.map(entryLayerOptions));
}

function updateEntryLayer(key, patch) {
  const entry = state.scene.find((item) => item.key === key);
  if (!entry) return;
  snapshotUndo('Changed layer visibility');
  const layers = ensureEntryLayers(entry);
  Object.assign(layers, patch);
  applySceneLayers();
  updateSelectionHighlight();
  renderCompoundList();
}

function toggleEntryElement(key, element) {
  const entry = state.scene.find((item) => item.key === key);
  if (!entry) return;
  snapshotUndo('Toggled element visibility');
  const layers = ensureEntryLayers(entry);
  const hidden = new Set(layers.hiddenElements);
  if (hidden.has(element)) hidden.delete(element);
  else hidden.add(element);
  layers.hiddenElements = [...hidden];
  applySceneLayers();
  updateSelectionHighlight();
  renderCompoundList();
}

function elementCounts(entry) {
  const counts = new Map();
  for (const atom of entry.molecule?.atoms ?? []) {
    counts.set(atom.element, (counts.get(atom.element) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

function bondMaterialFor(layers, index) {
  return scopeMaterial(
    layers.bondMaterials[index] ?? layers.bondsMaterial ?? layers.material,
  );
}

function bondGlossFor(layers, index) {
  return (
    layers.bondGlosses[index] ??
    layers.bondsGloss ??
    layers.gloss ??
    state.appearance.materialGloss
  );
}

function bondHasCustomAppearance(layers, index) {
  return (
    layers.bondColors[index] != null ||
    layers.bondScales[index] != null ||
    layers.bondOpacities[index] != null ||
    layers.bondMaterials[index] != null ||
    layers.bondsMaterial != null ||
    layers.bondGlosses[index] != null ||
    layers.bondsGloss != null
  );
}

function applyBondOverrides() {
  if (!viewer?.available) return;
  const models = viewer.models || [];

  state.renderedEntries.forEach((entry, index) => {
    const model = models[index];
    if (!model?.atoms || !entry.molecule) return;
    if (model.atoms.length !== entry.molecule.atoms.length) return;

    const layers = ensureEntryLayers(entry);
    const hiddenBonds = new Set(layers.hiddenBonds);
    const orders = layers.bondOrders || {};
    const customBond = (bondIndex) => bondHasCustomAppearance(layers, bondIndex);

    model.atoms.forEach((atom) => {
      atom.bonds = [];
      atom.bondOrder = [];
    });

    entry.molecule.bonds.forEach((bond, bondIndex) => {
      if (hiddenBonds.has(bondIndex) || customBond(bondIndex)) return;
      const a = model.atoms[bond.a];
      const b = model.atoms[bond.b];
      if (!a || !b) return;
      const order = orders[bondIndex] ?? bond.order;
      a.bonds.push(bond.b);
      a.bondOrder.push(order);
      b.bonds.push(bond.a);
      b.bondOrder.push(order);
    });

    model.molObj = null;
  });

  viewer.viewer.render();
}

function selectionDetails() {
  if (!state.editor || !state.selection) return null;

  if (state.selection.type === 'connection') {
    const connection = state.connections.find(
      (item) => item.id === state.selection.id,
    );
    if (!connection) return null;
    const entryA = state.scene.find(
      (entry) => entry.key === connection.a.entryKey,
    );
    const entryB = state.scene.find(
      (entry) => entry.key === connection.b.entryKey,
    );
    const atomA = entryA?.molecule?.atoms?.[connection.a.atomIndex];
    const atomB = entryB?.molecule?.atoms?.[connection.b.atomIndex];
    if (!entryA || !entryB || !atomA || !atomB) return null;
    return {
      type: 'connection',
      connection,
      entryA,
      entryB,
      atomA,
      atomB,
      atomIndexA: connection.a.atomIndex,
      atomIndexB: connection.b.atomIndex,
    };
  }

  const entry = state.scene.find((item) => item.key === state.selection.entryKey);
  if (!entry) return null;

  const type = state.selection.type;
  if (type === 'compound' || type === 'atoms' || type === 'bonds') {
    return { entry, type };
  }

  if (type === 'element') {
    const element = state.selection.element;
    const count = entry.molecule?.atoms?.filter((atom) => atom.element === element).length ?? 0;
    if (!element || !count) return null;
    return { entry, type, element, count };
  }

  if (type === 'atom') {
    const indices = (state.selection.indices ?? [state.selection.index])
      .filter((index) => Number.isInteger(index) && index >= 0 && index < (entry.molecule?.atoms?.length ?? 0));
    if (!indices.length) return null;
    const atoms = indices.map((index) => entry.molecule.atoms[index]);
    return { entry, type, indices, atoms };
  }
  if (type === 'bond') {
    const indices = (state.selection.indices ?? [state.selection.index])
      .filter((index) => Number.isInteger(index) && index >= 0 && index < (entry.molecule?.bonds?.length ?? 0));
    if (!indices.length) return null;
    const bonds = indices.map((index) => entry.molecule.bonds[index]);
    return { entry, type, indices, bonds };
  }
  return null;
}

function clearSelection() {
  state.selection = null;
  updateSelectionHighlight();
  renderCompoundList();
  renderItemEditor();
}

function selectConnection(id) {
  const connection = state.connections.find((item) => item.id === id);
  if (!connection) return;
  state.selection = { type: 'connection', id };
  if (state.editor && !dom['customize-panel']?.classList.contains('is-open')) {
    setCustomizeOpen(true);
  }
  renderCompoundList();
  renderItemEditor();
  updateSelectionHighlight();
}

function selectItem(entryKey, type, payload = {}, { additive = false, source = 'layers' } = {}) {
  const entry = state.scene.find((item) => item.key === entryKey);
  if (!entry || !entry.molecule) return;
  const data = typeof payload === 'number' ? { index: payload } : payload;
  if (state.activeKey !== entryKey) {
    activateCompound(entryKey, { render: false, updateUrl: false });
  }

  if (type === 'atom' || type === 'bond') {
    const index = data.index;
    if (
      additive &&
      state.selection?.entryKey === entryKey &&
      state.selection.type === type
    ) {
      const current = new Set(state.selection.indices ?? [state.selection.index]);
      if (current.has(index)) current.delete(index);
      else current.add(index);
      state.selection = current.size
        ? {
            entryKey,
            type,
            indices: [...current].sort((a, b) => a - b),
          }
        : null;
    } else {
      state.selection = { entryKey, type, indices: [index] };
    }
  } else if (type === 'element') {
    state.selection = { entryKey, type, element: data.element };
  } else {
    state.selection = { entryKey, type };
  }

  if (state.editor) {
    const wide = window.matchMedia('(min-width: 1200px)').matches;
    if (source === 'viewport') {
      if (wide) {
        if (!dom['layers-panel']?.classList.contains('is-open')) setLayersOpen(true);
        if (!dom['customize-panel']?.classList.contains('is-open')) setCustomizeOpen(true);
      } else {
        setCustomizeOpen(true);
      }
    } else if (!additive) {
      // The selection editor lives in Customize now. Additive clicks keep
      // Layers open so several atoms or bonds can be collected first.
      if (!dom['customize-panel']?.classList.contains('is-open')) setCustomizeOpen(true);
    }
  }

  renderCompoundList();
  renderItemEditor();
  updateSelectionHighlight();
}

function atomDisplayColor(layers, atom, index) {
  return (
    layers.atomColors[index] ||
    layers.elementColors[atom.element] ||
    layers.atomsColor ||
    baseElementColor(atom.element)
  );
}

function viewerBondBaseRadius() {
  if (state.style === 'sticks') return 0.12;
  if (state.style === 'lines') {
    return 0.012 * (state.appearance.lineWidth ?? 1.6);
  }
  return 0.15;
}

function customBondSpecs() {
  const specs = [];
  if (!viewer?.available) return specs;

  state.renderedEntries.forEach((entry, entryIndex) => {
    const layers = ensureEntryLayers(entry);
    if (layers.visible === false || layers.bonds === false) return;
    const model = viewer.models[entryIndex];
    if (!model?.atoms || !entry.molecule) return;

    const baseRadius =
      viewerBondBaseRadius() * (state.appearance.bondScale ?? 1);
    const globalOpacity =
      viewer?.effectiveOpacity(state.appearance.opacity) ?? state.appearance.opacity ?? 1;

    entry.molecule.bonds.forEach((bond, index) => {
      if (layers.hiddenBonds.includes(index)) return;
      if (!bondHasCustomAppearance(layers, index)) return;

      const a = model.atoms[bond.a];
      const b = model.atoms[bond.b];
      if (!a || !b) return;

      const atomA = entry.molecule.atoms[bond.a];
      const atomB = entry.molecule.atoms[bond.b];
      const bondMaterial = bondMaterialFor(layers, index);
      const bondGloss = bondGlossFor(layers, index);
      const explicitColor = layers.bondColors[index] || layers.bondsColor;
      const materialTint =
        bondMaterial != null ||
        layers.bondGlosses[index] != null ||
        layers.bondsGloss != null ||
        layers.gloss != null;
      const colorA =
        explicitColor ||
        (materialTint
          ? itemMaterialColor(bondMaterial, atomA.element, bondGloss)
          : atomDisplayColor(layers, atomA, bond.a));
      const colorB =
        explicitColor ||
        (materialTint
          ? itemMaterialColor(bondMaterial, atomB.element, bondGloss)
          : atomDisplayColor(layers, atomB, bond.b));
      const materialFactor = bondMaterial
        ? itemMaterialOpacity(bondMaterial, bondGloss) ?? 1
        : 1;
      const baseOpacity =
        layers.bondOpacities[index] ??
        layers.bondsOpacity ??
        layers.compoundOpacity ??
        state.appearance.opacity;
      const opacity = bondMaterial
        ? Math.min(1, Math.max(0.05, baseOpacity * materialFactor))
        : layers.bondOpacities[index] ??
          layers.bondsOpacity ??
          layers.compoundOpacity ??
          globalOpacity;

      specs.push({
        type: 'custom-bond',
        start: { x: a.x, y: a.y, z: a.z },
        end: { x: b.x, y: b.y, z: b.z },
        colorA,
        colorB,
        radius: Math.max(
          0.03,
          baseRadius * (layers.bondsRadius ?? 1) * (layers.bondScales[index] ?? 1),
        ),
        opacity,
        order: layers.bondOrders[index] ?? bond.order,
      });
    });
  });

  return specs;
}

function connectionSpecs() {
  const specs = [];
  if (!viewer?.available || !state.connections.length) return specs;
  const baseRadius =
    viewerBondBaseRadius() * (state.appearance.bondScale ?? 1);
  const opacity =
    viewer.effectiveOpacity(state.appearance.opacity) ??
    state.appearance.opacity ??
    1;

  for (const connection of state.connections) {
    if (connection.visible === false) continue;
    const entryA = state.scene.find((entry) => entry.key === connection.a.entryKey);
    const entryB = state.scene.find((entry) => entry.key === connection.b.entryKey);
    if (!entryA?.molecule || !entryB?.molecule) continue;
    const layersA = ensureEntryLayers(entryA);
    const layersB = ensureEntryLayers(entryB);
    if (
      layersA.visible === false ||
      layersB.visible === false ||
      layersA.bonds === false ||
      layersB.bonds === false
    ) {
      continue;
    }

    const indexA = state.renderedEntries.findIndex((entry) => entry.key === entryA.key);
    const indexB = state.renderedEntries.findIndex((entry) => entry.key === entryB.key);
    const modelA = indexA >= 0 ? viewer.models[indexA] : null;
    const modelB = indexB >= 0 ? viewer.models[indexB] : null;
    const atomA = modelA?.atoms?.[connection.a.atomIndex];
    const atomB = modelB?.atoms?.[connection.b.atomIndex];
    const sourceA = entryA.molecule.atoms[connection.a.atomIndex];
    const sourceB = entryB.molecule.atoms[connection.b.atomIndex];
    if (!atomA || !atomB || !sourceA || !sourceB) continue;

    const colorA =
      connection.color ||
      atomDisplayColor(layersA, sourceA, connection.a.atomIndex);
    const colorB =
      connection.color ||
      atomDisplayColor(layersB, sourceB, connection.b.atomIndex);

    specs.push({
      type: 'custom-bond',
      start: { x: atomA.x, y: atomA.y, z: atomA.z },
      end: { x: atomB.x, y: atomB.y, z: atomB.z },
      colorA,
      colorB,
      radius: baseRadius * (connection.scale ?? 1),
      opacity: connection.opacity ?? opacity,
      order: connection.order,
      dashed: connection.style === 'dashed',
      arrow: connection.style === 'arrow',
    });
  }

  return specs;
}

function updateSelectionHighlight() {
  const specs = customBondSpecs();
  specs.push(...connectionSpecs());
  const details = selectionDetails();

  if (details && (details.type === 'atom' || details.type === 'bond')) {
    const { entry, type, indices } = details;
    const layers = ensureEntryLayers(entry);
    const renderedIndex = state.renderedEntries.findIndex((item) => item.key === entry.key);
    const model = renderedIndex >= 0 ? viewer?.models?.[renderedIndex] : null;

    if (model && layers.visible !== false) {
      if (type === 'atom') {
        for (const index of indices) {
          const atom = model.atoms?.[index];
          if (!atom) continue;
          if (
            layers.hiddenElements.includes(atom.elem) ||
            layers.hiddenAtoms.includes(index)
          ) {
            continue;
          }
          specs.push({
            type: 'atom',
            center: { x: atom.x, y: atom.y, z: atom.z },
          });
        }
      } else {
        for (const index of indices) {
          const bond = entry.molecule.bonds[index];
          const a = model.atoms?.[bond?.a];
          const b = model.atoms?.[bond?.b];
          if (!bond || !a || !b || layers.hiddenBonds.includes(index)) continue;
          specs.push({
            type: 'bond',
            start: { x: a.x, y: a.y, z: a.z },
            end: { x: b.x, y: b.y, z: b.z },
          });
        }
      }
    }
  }

  if (details?.type === 'connection') {
    const { connection, entryA, entryB, atomIndexA, atomIndexB } = details;
    const layersA = ensureEntryLayers(entryA);
    const layersB = ensureEntryLayers(entryB);
    const indexA = state.renderedEntries.findIndex((item) => item.key === entryA.key);
    const indexB = state.renderedEntries.findIndex((item) => item.key === entryB.key);
    const modelA = indexA >= 0 ? viewer?.models?.[indexA] : null;
    const modelB = indexB >= 0 ? viewer?.models?.[indexB] : null;
    const a = modelA?.atoms?.[atomIndexA];
    const b = modelB?.atoms?.[atomIndexB];
    if (
      a &&
      b &&
      connection.visible !== false &&
      layersA.visible !== false &&
      layersB.visible !== false &&
      layersA.bonds !== false &&
      layersB.bonds !== false
    ) {
      specs.push({
        type: 'bond',
        start: { x: a.x, y: a.y, z: a.z },
        end: { x: b.x, y: b.y, z: b.z },
      });
    }
  }

  if (state.connect.active && state.connect.first) {
    const entry = state.scene.find(
      (item) => item.key === state.connect.first.entryKey,
    );
    const layers = entry ? ensureEntryLayers(entry) : null;
    const entryIndex = entry
      ? state.renderedEntries.findIndex((item) => item.key === entry.key)
      : -1;
    const model = entryIndex >= 0 ? viewer?.models?.[entryIndex] : null;
    const atom = model?.atoms?.[state.connect.first.atomIndex];
    if (
      atom &&
      layers?.visible !== false &&
      !layers?.hiddenAtoms.includes(state.connect.first.atomIndex) &&
      !layers?.hiddenElements.includes(atom.elem)
    ) {
      specs.push({
        type: 'connect-first',
        center: { x: atom.x, y: atom.y, z: atom.z },
      });
    }
  }

  viewer?.setSelectionHighlight(specs);
}

function pickAtomAt(clientX, clientY) {
  if (!viewer?.available || !state.renderedEntries.length) return null;
  const v = viewer.viewer;
  if (!v?.modelToScreen) return null;

  const pageX = clientX + window.scrollX;
  const pageY = clientY + window.scrollY;
  const threshold = 24;

  let best = null;
  let bestDistance = threshold;

  for (let entryIndex = state.renderedEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = state.renderedEntries[entryIndex];
    if (entry.layers?.visible === false) continue;
    const model = viewer.models[entryIndex];
    if (!model?.atoms?.length) continue;
    const layers = ensureEntryLayers(entry);
    for (let atomIndex = 0; atomIndex < model.atoms.length; atomIndex += 1) {
      const atom = model.atoms[atomIndex];
      if (
        layers.hiddenAtoms.includes(atomIndex) ||
        layers.hiddenElements.includes(atom.elem)
      ) {
        continue;
      }
      const point = v.modelToScreen({ x: atom.x, y: atom.y, z: atom.z });
      if (!point) continue;
      const distance = Math.hypot(point.x - pageX, point.y - pageY);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { entry, entryIndex, atomIndex, distance };
      }
    }
  }

  return best;
}

function pointSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function pickBondAt(clientX, clientY) {
  if (!viewer?.available || !state.renderedEntries.length) return null;
  const v = viewer.viewer;
  if (!v?.modelToScreen) return null;

  const pageX = clientX + window.scrollX;
  const pageY = clientY + window.scrollY;
  const threshold = 7;

  let best = null;
  let bestDistance = threshold;

  for (let entryIndex = state.renderedEntries.length - 1; entryIndex >= 0; entryIndex -= 1) {
    const entry = state.renderedEntries[entryIndex];
    if (entry.layers?.visible === false) continue;
    const model = viewer.models[entryIndex];
    if (!model?.atoms?.length || !entry.molecule) continue;
    const hidden = new Set(ensureEntryLayers(entry).hiddenBonds);

    entry.molecule.bonds.forEach((bond, bondIndex) => {
      if (hidden.has(bondIndex)) return;
      const a = model.atoms[bond.a];
      const b = model.atoms[bond.b];
      if (!a || !b) return;
      const pa = v.modelToScreen({ x: a.x, y: a.y, z: a.z });
      const pb = v.modelToScreen({ x: b.x, y: b.y, z: b.z });
      if (!pa || !pb) return;
      const distance = pointSegmentDistance(pageX, pageY, pa.x, pa.y, pb.x, pb.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { entry, entryIndex, bondIndex, distance };
      }
    });
  }

  return best;
}

function pickSceneEntry(clientX, clientY) {
  return pickAtomAt(clientX, clientY)?.entry ?? null;
}

function renderScene() {
  if (!viewer?.available) return;

  const entries = (
    state.editor
      ? state.scene
      : state.scene.filter((entry) => entry.key === state.activeKey)
  ).filter((entry) => entry.sdfText && entry.molecule);

  state.renderedEntries = entries;

  if (!entries.length) {
    viewer.clear();
    setToolbarEnabled(false);
    updateSelectionHighlight();
    updateTransformBar();
    updateConnectUI();
    return;
  }

  try {
    const placements = buildScenePlacements(entries);
    viewer.loadMany(placements.map((placement) => placement.text));
    applySceneLayers();
    applyBondOverrides();
    applySceneTransforms(entries);
    viewer.fitScene();
    updateSelectionHighlight();
    setToolbarEnabled(true);
    viewer.setSpin(state.spin);
    dom['toggle-surface'].setAttribute('aria-pressed', 'false');
    dom['toggle-surface'].classList.remove('is-active');
  } catch (error) {
    console.error('3D render failed:', error);
    setToolbarEnabled(false);
  }
  updateTransformBar();
  updateConnectUI();
}

function selectTransformMode(mode) {
  state.transformMode = mode === 'move' ? 'move' : 'rotate';
  $$('[data-transform-mode]').forEach((button) => {
    const active = button.dataset.transformMode === state.transformMode;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function updateTransformBar() {
  const bar = dom['transform-bar'];
  if (!bar) return;

  const entry = state.scene.find((item) => item.key === state.activeKey);
  const visible =
    state.editor &&
    !state.studio.active &&
    !state.connect.active &&
    entry?.layers?.visible !== false &&
    Boolean(entry?.sdfText) &&
    state.renderedEntries.some((item) => item.key === state.activeKey);

  bar.hidden = !visible;
  if (!visible) return;

  dom['transform-target'].textContent = compoundTitle(entry);
  selectTransformMode(state.transformMode);
}

function resetActiveTransform() {
  const entry = state.scene.find((item) => item.key === state.activeKey);
  if (!entry) return;
  entry.transform = defaultTransform();
  applySceneTransforms(state.renderedEntries, entry.key);
  viewer?.fitScene();
  toast(`Transform reset for ${compoundTitle(entry)}`, 'info');
}

function onScenePointerDown(event) {
  if (!state.editor || state.loading) return;
  if (event.pointerType === 'mouse' && event.button !== 0) return;
  if (state.studio.active && (state.studio.playing || state.studio.recording)) {
    return;
  }

  if (state.connect.active) {
    const hit = pickAtomAt(event.clientX, event.clientY);
    if (hit) {
      handleConnectAtom(hit);
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    state.canvasClick = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    return;
  }

  if (event.altKey) {
    const additive = event.ctrlKey || event.metaKey || event.shiftKey;
    const atomHit = pickAtomAt(event.clientX, event.clientY);
    if (atomHit) {
      selectItem(
        atomHit.entry.key,
        'atom',
        { index: atomHit.atomIndex },
        { additive, source: 'viewport' },
      );
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const bondHit = pickBondAt(event.clientX, event.clientY);
    if (bondHit) {
      selectItem(
        bondHit.entry.key,
        'bond',
        { index: bondHit.bondIndex },
        { additive, source: 'viewport' },
      );
      event.preventDefault();
      event.stopPropagation();
    }
    return;
  }

  const entry = pickSceneEntry(event.clientX, event.clientY);
  if (!entry) {
    state.canvasClick = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    return;
  }

  if (entry.key !== state.activeKey) {
    activateCompound(entry.key, { updateUrl: false, render: false });
  }
  if (state.studio.active) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }

  state.sceneDrag = {
    pointerId: event.pointerId,
    key: entry.key,
    mode: state.transformMode,
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
    snapshot: captureEditorSnapshot(),
    undoPushed: false,
  };

  try {
    dom['viewer'].setPointerCapture(event.pointerId);
  } catch {
    /* pointer capture is optional */
  }
  dom['viewer'].classList.add('is-transforming');
  event.preventDefault();
  event.stopPropagation();
}

function onScenePointerMove(event) {
  if (
    state.canvasClick &&
    event.pointerId === state.canvasClick.pointerId
  ) {
    if (
      Math.hypot(
        event.clientX - state.canvasClick.startX,
        event.clientY - state.canvasClick.startY,
      ) > 3
    ) {
      state.canvasClick.moved = true;
    }
    return;
  }

  const drag = state.sceneDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  if (!drag.moved) {
    const total = Math.hypot(
      event.clientX - drag.startX,
      event.clientY - drag.startY,
    );
    if (total > 3) {
      drag.moved = true;
    } else {
      drag.lastX = event.clientX;
      drag.lastY = event.clientY;
      return;
    }
  }

  const dx = event.clientX - drag.lastX;
  const dy = event.clientY - drag.lastY;
  if (!dx && !dy) return;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;

  if (!drag.undoPushed) {
    drag.undoPushed = true;
    if (!state.studio.active) {
      pushUndoSnapshot(
        drag.mode === 'move' ? 'Moved compound' : 'Rotated compound',
        drag.snapshot,
      );
    }
  }

  const entry = state.scene.find((item) => item.key === drag.key);
  const v = viewer?.viewer;
  if (!entry || !v) return;
  const transform = ensureEntryTransform(entry);

  if (drag.mode === 'move') {
    const xRatio = v.renderer?.getXRatio?.() ?? 1;
    const yRatio = v.renderer?.getYRatio?.() ?? 1;
    const offset = v.screenOffsetToModel(dx * xRatio, dy * yRatio);
    transform.x += offset.x;
    transform.y += offset.y;
    transform.z += offset.z;
  } else {
    const sensitivity = 0.38;
    const yaw = quaternionFromAxisAngle({ x: 0, y: 1, z: 0 }, dx * sensitivity);
    const pitch = quaternionFromAxisAngle({ x: 1, y: 0, z: 0 }, dy * sensitivity);
    const view = v.getView();
    const qView = { x: view[4], y: view[5], z: view[6], w: view[7] };
    const qViewInverse = { x: -qView.x, y: -qView.y, z: -qView.z, w: qView.w };
    const qScreen = multiplyQuaternion(yaw, pitch);
    const qLocal = multiplyQuaternion(
      multiplyQuaternion(qViewInverse, qScreen),
      qView,
    );
    const q = multiplyQuaternion(qLocal, {
      x: transform.qx,
      y: transform.qy,
      z: transform.qz,
      w: transform.qw,
    });
    transform.qx = q.x;
    transform.qy = q.y;
    transform.qz = q.z;
    transform.qw = q.w;
  }

  applySceneTransforms(state.renderedEntries, entry.key);
  event.preventDefault();
}

function onScenePointerUp(event, cancelled = false) {
  if (state.canvasClick && event.pointerId === state.canvasClick.pointerId) {
    const click = state.canvasClick;
    state.canvasClick = null;
    if (!cancelled && !click.moved) clearSelection();
    return;
  }

  const drag = state.sceneDrag;
  if (!drag || event.pointerId !== drag.pointerId) return;

  state.sceneDrag = null;
  try {
    dom['viewer'].releasePointerCapture(event.pointerId);
  } catch {
    /* pointer capture is optional */
  }
  dom['viewer'].classList.remove('is-transforming');

  if (cancelled || drag.moved) return;

  const additive = event.ctrlKey || event.metaKey || event.shiftKey;
  const atomHit = pickAtomAt(event.clientX, event.clientY);
  if (atomHit) {
    selectItem(
      atomHit.entry.key,
      'atom',
      { index: atomHit.atomIndex },
      { additive, source: 'viewport' },
    );
    return;
  }

  const bondHit = pickBondAt(event.clientX, event.clientY);
  if (bondHit) {
    selectItem(
      bondHit.entry.key,
      'bond',
      { index: bondHit.bondIndex },
      { additive, source: 'viewport' },
    );
    return;
  }

  clearSelection();
}

function bindSceneManipulation() {
  const host = dom['viewer'];
  host.addEventListener('pointerdown', onScenePointerDown, true);
  host.addEventListener('pointermove', onScenePointerMove);
  host.addEventListener('pointerup', onScenePointerUp, true);
  host.addEventListener('pointercancel', (event) => onScenePointerUp(event, true), true);

  // Prevent 3Dmol's own touch orbit from also starting when a touch begins on
  // a model that is about to be transformed.
  host.addEventListener(
    'touchstart',
    (event) => {
      if (!state.editor || state.loading) return;
      const touch = event.touches?.[0];
      if (!touch) return;
      if (pickSceneEntry(touch.clientX, touch.clientY)) {
        event.preventDefault();
        event.stopPropagation();
      }
    },
    true,
  );

  $$('[data-transform-mode]').forEach((button) => {
    button.addEventListener('click', () => selectTransformMode(button.dataset.transformMode));
  });
  dom['transform-reset']?.addEventListener('click', resetActiveTransform);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function captureEditorSnapshot() {
  return {
    connections: cloneJson(state.connections),
    entries: state.scene.map((entry) => ({
      key: entry.key,
      layers: cloneJson(entry.layers || {}),
      transform: entry.transform ? { ...entry.transform } : null,
    })),
    selection: cloneJson(state.selection),
    connectFirst: state.connect.first ? { ...state.connect.first } : null,
    appearance: cloneJson(state.appearance),
    layoutMode: state.layoutMode,
  };
}

function pushUndoSnapshot(label, snapshot, { key = null, coalesce = false } = {}) {
  const now = performance.now();
  if (
    coalesce &&
    key &&
    key === state.lastUndoKey &&
    now - state.lastUndoAt < 700
  ) {
    state.lastUndoAt = now;
    return;
  }
  state.undoStack.push({ label, snapshot });
  if (state.undoStack.length > 80) state.undoStack.shift();
  state.redoStack.length = 0;
  state.lastUndoKey = key;
  state.lastUndoAt = now;
}

function snapshotUndo(label, options = {}) {
  const now = performance.now();
  if (
    options.coalesce &&
    options.key &&
    options.key === state.lastUndoKey &&
    now - state.lastUndoAt < 700
  ) {
    state.lastUndoAt = now;
    return;
  }
  pushUndoSnapshot(label, captureEditorSnapshot(), options);
}

function applyEditorSnapshot(snapshot) {
  if (!snapshot) return;
  const layoutMode = ['row', 'grid', 'circle'].includes(snapshot.layoutMode)
    ? snapshot.layoutMode
    : state.layoutMode;
  const layoutChanged = layoutMode !== state.layoutMode;
  state.layoutMode = layoutMode;
  state.connections = cloneJson(snapshot.connections) || [];
  const saved = new Map((snapshot.entries || []).map((entry) => [entry.key, entry]));
  state.scene.forEach((entry) => {
    const previous = saved.get(entry.key);
    if (!previous) return;
    entry.layers = previous.layers || {};
    ensureEntryLayers(entry);
    if (previous.transform) entry.transform = { ...previous.transform };
  });
  state.selection = cloneJson(snapshot.selection);
  state.connect.first = snapshot.connectFirst
    ? { ...snapshot.connectFirst }
    : null;

  if (snapshot.appearance) {
    state.appearance = cloneJson(snapshot.appearance);
    viewer?.setAppearance(state.appearance);
    saveAppearance();
    updateCustomizeControls();
  }

  if (layoutChanged) {
    renderScene();
  } else {
    applySceneLayers();
    applyBondOverrides();
    applySceneTransforms(state.renderedEntries);
    updateSelectionHighlight();
  }
  updateSceneTools();
  renderCompoundList();
  renderConnectionList();
  updateConnectUI();
  updateTransformBar();
  viewer?.viewer.render();
}

function undoEditor() {
  if (state.studio.active) {
    toast('Studio uses simple motion presets; there are no keyframes to undo.', 'info');
    return;
  }
  const entry = state.undoStack.pop();
  if (!entry) {
    toast('Nothing to undo.', 'info');
    return;
  }
  state.redoStack.push({
    label: entry.label,
    snapshot: captureEditorSnapshot(),
  });
  applyEditorSnapshot(entry.snapshot);
  state.lastUndoKey = null;
  toast(`Undo: ${entry.label}`, 'info');
}

function redoEditor() {
  if (state.studio.active) {
    toast('Studio uses simple motion presets; there are no keyframes to undo.', 'info');
    return;
  }
  const entry = state.redoStack.pop();
  if (!entry) {
    toast('Nothing to redo.', 'info');
    return;
  }
  state.undoStack.push({
    label: entry.label,
    snapshot: captureEditorSnapshot(),
  });
  applyEditorSnapshot(entry.snapshot);
  state.lastUndoKey = null;
  toast(`Redo: ${entry.label}`, 'info');
}

function setConnectMode(active) {
  if (active && state.editor && state.renderedEntries.length < 2) {
    toast('Add a second compound with a 3D conformer to use Connect.', 'info');
    return;
  }
  const next = Boolean(active && state.editor && state.renderedEntries.length >= 2);
  state.connect.active = next;
  state.connect.first = null;
  dom['connect-toggle']?.classList.toggle('is-active', next);
  dom['connect-toggle']?.setAttribute('aria-pressed', String(next));
  dom['connect-bar'] && (dom['connect-bar'].hidden = !next);
  dom['viewer']?.classList.toggle('is-connecting', next);
  if (dom['connect-status']) dom['connect-status'].textContent = 'Pick the first atom';
  updateTransformBar();
  updateSelectionHighlight();
}

function updateConnectUI() {
  if (state.connect.active && state.renderedEntries.length < 2) {
    setConnectMode(false);
  }
  if (dom['connect-toggle']) {
    dom['connect-toggle'].hidden = !state.editor;
    dom['connect-toggle'].disabled = state.renderedEntries.length === 0;
    dom['connect-toggle'].title =
      state.renderedEntries.length < 2
        ? 'Add a second 3D compound to connect atoms'
        : 'Connect atoms between compounds';
  }
  $$('[data-connect-order]').forEach((button) => {
    const active = Number(button.dataset.connectOrder) === state.connect.order;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  $$('[data-connect-style]').forEach((button) => {
    const active = button.dataset.connectStyle === state.connect.style;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (dom['connect-join']) dom['connect-join'].checked = state.connect.join;
  if (dom['connect-status']) {
    dom['connect-status'].textContent = state.connect.first
      ? 'Pick a second atom in another compound'
      : 'Pick the first atom';
  }
}

function bindConnect() {
  dom['connect-toggle']?.addEventListener('click', () =>
    setConnectMode(!state.connect.active),
  );
  dom['connect-cancel']?.addEventListener('click', () => setConnectMode(false));
  dom['connect-join']?.addEventListener('change', () => {
    state.connect.join = Boolean(dom['connect-join'].checked);
  });

  $$('[data-connect-order]').forEach((button) => {
    button.addEventListener('click', () => {
      state.connect.order = Number(button.dataset.connectOrder) || 1;
      updateConnectUI();
    });
  });
  $$('[data-connect-style]').forEach((button) => {
    button.addEventListener('click', () => {
      state.connect.style = button.dataset.connectStyle || 'solid';
      updateConnectUI();
    });
  });

  dom['clear-connections']?.addEventListener('click', () => clearConnections());
  dom['connections-chevron']?.addEventListener('click', () => {
    state.connectionsExpanded = !state.connectionsExpanded;
    renderConnectionList();
  });
  dom['connections-head']?.addEventListener('click', (event) => {
    if (
      event.target.closest('#connections-chevron') ||
      event.target.closest('#clear-connections')
    ) {
      return;
    }
    state.connectionsExpanded = !state.connectionsExpanded;
    renderConnectionList();
  });
  updateConnectUI();
}

function studioItemIds() {
  return state.renderedEntries.map((entry) => entry.key);
}

function studioItemLabel(itemId) {
  const entry = state.scene.find((item) => item.key === itemId);
  if (!entry) return 'Compound';
  const index = state.renderedEntries.findIndex((item) => item.key === itemId);
  const prefix = index >= 0 ? `${index + 1}. ` : '';
  return `${prefix}${shortConnectionTitle(entry)}`;
}

const STUDIO_ITEM_MOTIONS = {
  none: 'Still',
  spin: 'Rotate',
  rock: 'Rock',
  float: 'Float',
};

const STUDIO_AXES = {
  x: 'X',
  y: 'Y',
  z: 'Z',
};

function studioAxisVector(axis) {
  if (axis === 'x') return { x: 1, y: 0, z: 0 };
  if (axis === 'z') return { x: 0, y: 0, z: 1 };
  return { x: 0, y: 1, z: 0 };
}

function normalizeStudioSceneMotion(value) {
  if (value === 'turntable') return 'spin';
  return ['none', 'spin', 'rock'].includes(value) ? value : 'none';
}

function studioCameraAxisVector() {
  const studio = state.studio;
  if (studio.cameraAxis === 'custom') {
    const custom = studio.cameraCustomAxis || { x: 0, y: 1, z: 0 };
    const length = Math.hypot(custom.x, custom.y, custom.z);
    if (length > 0.0001) {
      return { x: custom.x / length, y: custom.y / length, z: custom.z / length };
    }
    return { x: 0, y: 1, z: 0 };
  }
  return studioAxisVector(studio.cameraAxis);
}

/** 0 → 1 → 0 triangle wave for ping-pong playback. */
function pingPongPercent(value) {
  const wrapped = ((value % 1) + 1) % 1;
  return wrapped <= 0.5 ? wrapped * 2 : 2 - wrapped * 2;
}

function ensureStudioItems() {
  const next = {};
  for (const id of studioItemIds()) {
    const current = state.studio.items[id];
    const speed = Number(current?.speed);
    const phase = Number(current?.phase);
    next[id] = {
      motion:
        current && Object.prototype.hasOwnProperty.call(STUDIO_ITEM_MOTIONS, current.motion)
          ? current.motion
          : 'none',
      axis: current && STUDIO_AXES[current.axis] ? current.axis : 'y',
      speed: Number.isFinite(speed) ? Math.min(4, Math.max(0.1, speed)) : 1,
      phase: Number.isFinite(phase) ? Math.min(360, Math.max(0, phase)) : 0,
      pingPong: Boolean(current?.pingPong),
    };
  }
  state.studio.items = next;
}

function saveStudioBase(editorView = null) {
  state.studio.base = {
    editorView: editorView ? editorView.slice() : null,
    view: viewer?.viewer?.getView?.()?.slice() || null,
    entries: state.renderedEntries.map((entry) => ({
      key: entry.key,
      transform: { ...ensureEntryTransform(entry) },
    })),
  };
}

function captureStudioPlaybackBase() {
  const base = state.studio.base;
  if (!base || !viewer?.viewer) return;
  const view = viewer.viewer.getView?.();
  if (view) base.view = view.slice();
}

function captureStudioZoomFromCurrent() {
  const base = state.studio.base;
  if (!base?.view || !viewer?.viewer) return;
  const view = viewer.viewer.getView?.();
  if (!view) return;
  // Keep the user's current zoom and pan when resuming; leave the orbit
  // quaternion on the saved base so the camera animation can continue.
  base.view[0] = view[0];
  base.view[1] = view[1];
  base.view[2] = view[2];
  base.view[3] = view[3];
}

function preserveStudioZoom() {
  if (
    state.studio.active &&
    !state.studio.playing &&
    !state.studio.recording &&
    !state.studio.gifBusy
  ) {
    captureStudioZoomFromCurrent();
  }
}

function restoreStudioTransforms() {
  const base = state.studio.base;
  if (!base) return;
  for (const saved of base.entries) {
    const entry = state.scene.find((item) => item.key === saved.key);
    if (entry && saved.transform) entry.transform = { ...saved.transform };
  }
  applySceneTransforms(state.renderedEntries);
}

function restoreStudioCamera() {
  const base = state.studio.base;
  if (!base) return;
  const view = base.editorView || base.view;
  if (view && viewer?.viewer) {
    viewer.viewer.setView(view);
    viewer.viewer.render();
  }
  state.studio.base = null;
}

function setStudioMode(enabled) {
  if (state.studio.gifBusy) {
    toast('Wait for the GIF export to finish.', 'info');
    return;
  }
  if (enabled) {
    if (state.studio.active) return;
    if (!state.properties && !state.scene.length) {
      toast('Load a compound before opening Studio.', 'info');
      return;
    }
    const editorView = viewer?.viewer?.getView?.()?.slice() || null;
    const editorHeight = viewer?.viewer?.HEIGHT || 0;
    if (!state.editor) setEditorMode(true);
    if (!state.renderedEntries.length) {
      toast('Load a compound with a 3D conformer before opening Studio.', 'info');
      return;
    }
    setConnectMode(false);
    setLayersOpen(false);
    setCustomizeOpen(false);
    setPropertiesOpen(false);
    setExportOpen(false);
    clearSelection();
    state.studio.active = true;
    state.studio.playing = false;
    state.studio.recording = false;
    state.studio.time = 0;
    state.studio.manualView = false;
    ensureStudioItems();
    dom['app-shell']?.classList.add('is-studio');
    if (dom['studio-dock']) dom['studio-dock'].hidden = false;
    dom['studio-toggle']?.classList.add('is-active');
    dom['studio-toggle']?.setAttribute('aria-pressed', 'true');
    dom['studio-toggle']?.setAttribute('aria-label', 'Back to editor');
    if (dom['studio-toggle']) dom['studio-toggle'].title = 'Back to editor';
    dom['editor-toggle']?.classList.remove('is-active');
    dom['editor-toggle']?.setAttribute('aria-pressed', 'false');
    renderStudioUI();
    // Let the Studio layout settle before capturing the playback view, so the
    // first frame matches what the user sees instead of the pre-Studio canvas.
    viewer?.resize();
    saveStudioBase(editorView);
    // The Studio dock changes the viewport height. Scale the camera distance
    // by the height ratio so the user's on-screen zoom level is preserved.
    const base = state.studio.base;
    const studioHeight = viewer?.viewer?.HEIGHT || 0;
    if (base?.view && editorHeight > 0 && studioHeight > 0) {
      const ratio = studioHeight / editorHeight;
      const cameraZ = viewer?.viewer?.camera?.position?.z || 150;
      const distance = cameraZ - base.view[3];
      if (Number.isFinite(ratio) && ratio > 0 && distance > 0) {
        const nextDistance = Math.max(2, distance * ratio);
        base.view[3] = Math.min(cameraZ - 2, cameraZ - nextDistance);
      }
    }
    updateSelectionHighlight();
    applyStudioTime(0);
    updateRecordingGuide();
    toast('Studio mode — combine camera and per-compound motions.', 'info');
  } else {
    if (!state.studio.active) return;
    if (state.studio.recording) finishStudioRecording();
    pauseStudioPlayback();
    restoreStudioTransforms();
    state.studio.active = false;
    state.studio.playing = false;
    state.studio.time = 0;
    state.studio.manualView = false;
    dom['app-shell']?.classList.remove('is-studio');
    if (dom['studio-dock']) dom['studio-dock'].hidden = true;
    dom['studio-toggle']?.classList.remove('is-active');
    dom['studio-toggle']?.setAttribute('aria-pressed', 'false');
    dom['studio-toggle']?.setAttribute('aria-label', 'Open animation studio');
    if (dom['studio-toggle']) dom['studio-toggle'].title = 'Open the animation studio';
    if (state.editor) {
      dom['editor-toggle']?.classList.add('is-active');
      dom['editor-toggle']?.setAttribute('aria-pressed', 'true');
    }
    updateTransformBar();
    // Restore the editor layout first, then put the pre-Studio camera back.
    viewer?.resize();
    restoreStudioCamera();
    updateRecordingGuide();
    toast('Back to editor.', 'info');
  }
}

function renderStudioItemRows() {
  const host = dom['studio-items'];
  if (!host) return;
  clearNode(host);
  ensureStudioItems();
  const busy = state.studio.playing || state.studio.recording;

  for (const id of studioItemIds()) {
    const config = state.studio.items[id];
    const row = el('div', { class: 'studio-item', dataset: { key: id } });
    row.append(
      el(
        'span',
        { class: 'studio-item-label', title: studioItemLabel(id) },
        studioItemLabel(id),
      ),
    );

    const motion = el('select', {
      class: 'studio-item-select',
      attrs: { 'aria-label': `Motion for ${studioItemLabel(id)}` },
    });
    for (const [value, label] of Object.entries(STUDIO_ITEM_MOTIONS)) {
      motion.append(el('option', { value, text: label }));
    }
    motion.value = config.motion;
    motion.disabled = busy;
    motion.addEventListener('change', () => {
      preserveStudioZoom();
      config.motion = motion.value;
      renderStudioUI();
      applyStudioTime(state.studio.time);
    });
    row.append(motion);

    const axis = el('select', {
      class: 'studio-item-select studio-axis-select',
      attrs: { 'aria-label': `Rotation axis for ${studioItemLabel(id)}` },
    });
    for (const [value, label] of Object.entries(STUDIO_AXES)) {
      axis.append(el('option', { value, text: label }));
    }
    axis.value = config.axis;
    axis.disabled =
      busy || (config.motion !== 'spin' && config.motion !== 'rock');
    axis.addEventListener('change', () => {
      preserveStudioZoom();
      config.axis = axis.value;
      applyStudioTime(state.studio.time);
    });
    row.append(axis);

    const speed = el('input', {
      class: 'studio-item-input studio-speed',
      attrs: {
        type: 'number',
        min: '0.1',
        max: '4',
        step: '0.1',
        value: String(config.speed),
        title: `Speed for ${studioItemLabel(id)}`,
        'aria-label': `Speed for ${studioItemLabel(id)}`,
      },
    });
    speed.value = String(config.speed);
    speed.disabled = busy;
    speed.addEventListener('change', () => {
      preserveStudioZoom();
      const value = Number(speed.value);
      config.speed = Number.isFinite(value) ? Math.min(4, Math.max(0.1, value)) : 1;
      speed.value = String(config.speed);
      applyStudioTime(state.studio.time);
    });
    row.append(speed);

    const phase = el('input', {
      class: 'studio-item-input studio-phase',
      attrs: {
        type: 'number',
        min: '0',
        max: '360',
        step: '5',
        value: String(config.phase),
        title: `Phase offset for ${studioItemLabel(id)}`,
        'aria-label': `Phase offset for ${studioItemLabel(id)}`,
      },
    });
    phase.value = String(config.phase);
    phase.disabled = busy;
    phase.addEventListener('change', () => {
      preserveStudioZoom();
      const value = Number(phase.value);
      config.phase = Number.isFinite(value) ? Math.min(360, Math.max(0, value)) : 0;
      phase.value = String(config.phase);
      applyStudioTime(state.studio.time);
    });
    row.append(phase);

    const pingWrap = el('label', {
      class: 'studio-ping',
      attrs: {
        title: `Ping-pong motion for ${studioItemLabel(id)}`,
      },
    });
    const ping = el('input', {
      attrs: {
        type: 'checkbox',
        'aria-label': `Ping-pong motion for ${studioItemLabel(id)}`,
      },
    });
    ping.checked = config.pingPong;
    ping.disabled = busy;
    ping.addEventListener('change', () => {
      preserveStudioZoom();
      config.pingPong = ping.checked;
      applyStudioTime(state.studio.time);
    });
    pingWrap.append(ping, el('span', { text: '⇄' }));
    row.append(pingWrap);

    host.append(row);
  }
}

function updateBackgroundStudioControls() {
  const appearance = state.appearance;
  const transparent = appearance.background === 'transparent';
  const themeBackground =
    getComputedStyle(document.documentElement).getPropertyValue('--viewer-bg').trim() ||
    '#050b10';
  if (dom['studio-background']) {
    dom['studio-background'].value =
      transparent || !appearance.background ? themeBackground : appearance.background;
    dom['studio-background'].title = transparent
      ? 'Pick a colour to leave transparency'
      : 'Studio background colour';
  }
  if (dom['studio-background-reset']) {
    const active = !appearance.background;
    dom['studio-background-reset'].classList.toggle('is-active', active);
    dom['studio-background-reset'].setAttribute('aria-pressed', String(active));
  }
  if (dom['studio-background-transparent']) {
    dom['studio-background-transparent'].classList.toggle(
      'is-active',
      transparent,
    );
    dom['studio-background-transparent'].setAttribute(
      'aria-pressed',
      String(transparent),
    );
  }
}

function updateStudioControls() {
  const studio = state.studio;
  studio.sceneMotion = normalizeStudioSceneMotion(studio.sceneMotion);
  if (dom['studio-scene-motion']) {
    dom['studio-scene-motion'].value = studio.sceneMotion;
  }
  if (dom['studio-scene-axis']) {
    dom['studio-scene-axis'].value = studio.sceneAxis;
  }
  if (dom['studio-scene-pingpong']) {
    dom['studio-scene-pingpong'].checked = studio.scenePingPong;
  }
  if (dom['studio-camera-motion']) {
    dom['studio-camera-motion'].value = studio.cameraMotion;
  }
  if (dom['studio-camera-axis']) {
    dom['studio-camera-axis'].value = studio.cameraAxis;
  }
  if (dom['studio-camera-angle']) {
    dom['studio-camera-angle'].value = String(studio.cameraAngle);
  }
  if (dom['studio-camera-x']) dom['studio-camera-x'].value = String(studio.cameraCustomAxis.x);
  if (dom['studio-camera-y']) dom['studio-camera-y'].value = String(studio.cameraCustomAxis.y);
  if (dom['studio-camera-z']) dom['studio-camera-z'].value = String(studio.cameraCustomAxis.z);
  if (dom['studio-camera-custom']) {
    dom['studio-camera-custom'].hidden = studio.cameraAxis !== 'custom';
  }
  if (dom['studio-fps']) dom['studio-fps'].value = String(studio.output.fps);
  if (dom['studio-size']) dom['studio-size'].value = String(studio.output.size);
  if (dom['studio-aspect']) dom['studio-aspect'].value = studio.output.aspect;
  if (dom['studio-duration']) dom['studio-duration'].value = String(studio.duration);
  if (dom['studio-loop']) dom['studio-loop'].checked = studio.loop;
  if (dom['studio-time']) {
    dom['studio-time'].textContent = `${studio.time.toFixed(2)} s`;
  }
  if (dom['studio-play']) {
    dom['studio-play'].textContent = studio.playing ? 'Pause' : 'Play';
    dom['studio-play'].disabled = studio.recording || studio.gifBusy;
  }
  if (dom['studio-gif']) {
    dom['studio-gif'].textContent = studio.gifBusy ? 'GIF…' : 'GIF';
    dom['studio-gif'].disabled = studio.recording || studio.gifBusy;
    dom['studio-gif'].classList.toggle('is-recording', studio.gifBusy);
  }
  if (dom['studio-record']) {
    dom['studio-record'].textContent = studio.recording
      ? 'Stop recording'
      : 'Record';
    dom['studio-record'].classList.toggle('is-recording', studio.recording);
    dom['studio-record'].disabled = studio.gifBusy;
  }

  const busy = studio.playing || studio.recording || studio.gifBusy;
  for (const id of [
    'studio-scene-motion',
    'studio-scene-axis',
    'studio-scene-pingpong',
    'studio-camera-motion',
    'studio-camera-axis',
    'studio-camera-angle',
    'studio-camera-use-view',
    'studio-camera-x',
    'studio-camera-y',
    'studio-camera-z',
    'studio-duration',
    'studio-fps',
    'studio-size',
    'studio-aspect',
    'studio-loop',
    'studio-background',
    'studio-background-reset',
    'studio-background-transparent',
  ]) {
    if (dom[id]) dom[id].disabled = busy;
  }
  if (dom['studio-stop']) dom['studio-stop'].disabled = studio.gifBusy;
  $$('[data-studio-scene], [data-studio-frame]').forEach((button) => {
    button.disabled = busy;
  });
  if (dom['studio-scene-axis']) {
    dom['studio-scene-axis'].disabled =
      busy || (studio.sceneMotion !== 'spin' && studio.sceneMotion !== 'rock');
  }
  if (dom['studio-camera-axis']) {
    dom['studio-camera-axis'].disabled =
      busy || (studio.cameraMotion !== 'orbit' && studio.cameraMotion !== 'rock');
  }
  if (dom['studio-camera-angle']) {
    dom['studio-camera-angle'].disabled = busy || studio.cameraMotion !== 'orbit';
  }
  if (dom['studio-camera-custom']) {
    const customActive =
      studio.cameraAxis === 'custom' &&
      (studio.cameraMotion === 'orbit' || studio.cameraMotion === 'rock');
    dom['studio-camera-custom'].hidden = !customActive;
    for (const id of ['studio-camera-x', 'studio-camera-y', 'studio-camera-z']) {
      if (dom[id]) dom[id].disabled = busy || !customActive;
    }
  }
  if (dom['studio-recording-guide']) {
    dom['studio-recording-guide'].checked = studio.showRecordingGuide;
  }
  dom['studio-items']
    ?.querySelectorAll('select, input')
    .forEach((control) => {
      if (busy) {
        control.disabled = true;
      } else if (control.classList.contains('studio-axis-select')) {
        const row = control.closest('.studio-item');
        const config = state.studio.items[row?.dataset.key];
        control.disabled =
          config && config.motion !== 'spin' && config.motion !== 'rock';
      } else {
        control.disabled = false;
      }
    });

  updateBackgroundStudioControls();
  dom['viewer-card']?.classList.toggle(
    'is-studio-playing',
    studio.playing || studio.recording || studio.gifBusy,
  );
  updateTransformBar();
  updateRecordingGuide();
}

function updateStudioPlayhead() {
  if (dom['studio-time']) {
    dom['studio-time'].textContent = `${state.studio.time.toFixed(2)} s`;
  }
}

function renderStudioUI() {
  if (!state.studio.active) return;
  ensureStudioItems();
  renderStudioItemRows();
  updateStudioControls();
}

function applyStudioTime(time) {
  if (!state.studio.active) return;
  const studio = state.studio;
  const clamped = Math.max(0, Math.min(studio.duration, time));
  studio.time = clamped;
  const base = studio.base;
  if (!base) return;

  const progress = studio.duration > 0 ? clamped / studio.duration : 0;
  let transformsChanged = false;
  const sceneAxis = STUDIO_AXES[studio.sceneAxis] ? studio.sceneAxis : 'y';
  const sceneMotion = normalizeStudioSceneMotion(studio.sceneMotion);
  let sceneDelta = null;

  if (sceneMotion === 'spin' || sceneMotion === 'rock') {
    const angle =
      sceneMotion === 'spin'
        ? (studio.scenePingPong ? pingPongPercent(progress) : progress) * 360
        : Math.sin(progress * Math.PI * 2) * 35;
    if (Math.abs(angle) > 0.0001) {
      sceneDelta = quaternionFromAxisAngle(studioAxisVector(sceneAxis), angle);
    }
  }

  for (const saved of base.entries) {
    const entry = state.scene.find((item) => item.key === saved.key);
    if (!entry || !saved.transform) continue;
    const next = { ...saved.transform };
    const config = studio.items[saved.key];
    let q = {
      x: saved.transform.qx,
      y: saved.transform.qy,
      z: saved.transform.qz,
      w: saved.transform.qw,
    };

    if (config && config.motion !== 'none') {
      const speed = Number.isFinite(Number(config.speed))
        ? Math.min(4, Math.max(0.1, Number(config.speed)))
        : 1;
      const phase = Number.isFinite(Number(config.phase))
        ? Math.min(360, Math.max(0, Number(config.phase))) / 360
        : 0;
      const cycles = progress * speed + phase;

      if (config.motion === 'spin') {
        const angle = config.pingPong ? pingPongPercent(cycles) * 360 : cycles * 360;
        const qDelta = quaternionFromAxisAngle(
          studioAxisVector(config.axis),
          angle,
        );
        q = multiplyQuaternion(qDelta, q);
      } else if (config.motion === 'rock') {
        const qDelta = quaternionFromAxisAngle(
          studioAxisVector(config.axis),
          Math.sin(cycles * Math.PI * 2) * 35,
        );
        q = multiplyQuaternion(qDelta, q);
      } else if (config.motion === 'float') {
        next.y =
          saved.transform.y + Math.sin(cycles * Math.PI * 2) * 0.45;
      }
    }

    // Scene motions turn every compound in place around its own layout
    // centre. Keeping the layout fixed stops the scene from appearing to
    // shrink when it rotates edge-on.
    if (sceneDelta) {
      q = multiplyQuaternion(sceneDelta, q);
    }

    next.qx = q.x;
    next.qy = q.y;
    next.qz = q.z;
    next.qw = q.w;

    const current = entry.transform;
    if (
      current &&
      current.x === next.x &&
      current.y === next.y &&
      current.z === next.z &&
      current.qx === next.qx &&
      current.qy === next.qy &&
      current.qz === next.qz &&
      current.qw === next.qw
    ) {
      continue;
    }
    entry.transform = next;
    transformsChanged = true;
  }

  if (transformsChanged) {
    applySceneTransforms(state.renderedEntries, null, {
      render: false,
      highlight: false,
    });
    // Added-bond overlays are shapes, so they must be rebuilt from the new
    // atom positions when compounds rotate. Selection wireframes stay off in
    // Studio because the selection is cleared on entry.
    if (state.connections.length) updateSelectionHighlight();
  }

  if (viewer?.viewer && base.view) {
    viewer.viewer.setView(base.view);
    const cameraMotion = studio.cameraMotion || 'none';
    if (cameraMotion === 'orbit') {
      const angle = progress * (Number(studio.cameraAngle) || 0);
      if (Math.abs(angle) > 0.0001) {
        viewer.viewer.rotate(angle, studioCameraAxisVector());
      }
    } else if (cameraMotion === 'rock') {
      viewer.viewer.rotate(
        Math.sin(progress * Math.PI * 2) * 35,
        studioCameraAxisVector(),
      );
    } else if (cameraMotion === 'zoom') {
      viewer.viewer.zoom(1 + Math.sin(progress * Math.PI * 2) * 0.22);
    }
    viewer.viewer.render();
    viewer.updateScaleBar?.();
  }
  updateStudioPlayhead();
}

function setStudioTime(time) {
  state.studio.time = Math.max(0, Math.min(state.studio.duration, time));
  applyStudioTime(state.studio.time);
  updateStudioControls();
}

function startStudioPlayback() {
  if (!state.studio.active || state.studio.playing) return;
  const studio = state.studio;
  if (studio.manualView) {
    // The user dragged/zoomed while paused: use that as the new start view.
    studio.time = 0;
    captureStudioPlaybackBase();
    studio.manualView = false;
    applyStudioTime(0);
  } else if (studio.time >= studio.duration - 0.001) {
    setStudioTime(0);
    captureStudioPlaybackBase();
    applyStudioTime(0);
  } else if (studio.time <= 0.001) {
    // Start from the camera the user is actually looking at, so pressing Play
    // never snaps the scene to an older zoom or position.
    captureStudioPlaybackBase();
    applyStudioTime(0);
  } else {
    // Resuming mid-clip: keep the current zoom and pan but let a camera orbit
    // continue from the saved base orientation.
    captureStudioZoomFromCurrent();
    applyStudioTime(studio.time);
  }
  state.studio.playing = true;
  state.studio.playStart = performance.now();
  state.studio.playFrom = state.studio.time;
  cancelAnimationFrame(state.studio.raf);
  state.studio.raf = requestAnimationFrame(studioTick);
  updateStudioControls();
}

function pauseStudioPlayback() {
  state.studio.playing = false;
  cancelAnimationFrame(state.studio.raf);
  state.studio.raf = 0;
  updateStudioControls();
}

function stopStudioPlayback(reset = true) {
  pauseStudioPlayback();
  if (reset) setStudioTime(0);
  updateStudioControls();
}

function studioTick(now) {
  const studio = state.studio;
  if (!studio.active || (!studio.playing && !studio.recording)) return;
  const duration = studio.duration;
  let time = studio.playFrom + (now - studio.playStart) / 1000;

  if (time >= duration) {
    if (studio.recording) {
      studio.time = duration;
      applyStudioTime(duration);
      drawStudioRecordingFrame();
      studio.playing = false;
      finishStudioRecording();
      updateStudioControls();
      return;
    }
    if (studio.loop) {
      studio.playStart = now;
      studio.playFrom = 0;
      time = 0;
    } else {
      studio.time = duration;
      applyStudioTime(duration);
      studio.playing = false;
      updateStudioControls();
      return;
    }
  }

  studio.time = time;
  applyStudioTime(time);
  if (studio.recording) drawStudioRecordingFrame();
  studio.raf = requestAnimationFrame(studioTick);
}

function finishStudioRecording() {
  const studio = state.studio;
  const recorder = studio.recorder;
  studio.playing = false;
  cancelAnimationFrame(studio.raf);
  studio.raf = 0;
  if (!recorder) {
    studio.recording = false;
    updateStudioControls();
    return;
  }
  studio.recording = false;
  updateStudioControls();
  if (recorder.state !== 'inactive') {
    recorder.stop();
  } else {
    studio.recorder = null;
  }
}

function studioOutputDimensions({ maxLong = null } = {}) {
  const size = Number(state.studio.output.size) || 1080;
  const aspect = state.studio.output.aspect;
  let width;
  let height;
  if (aspect === 'square') {
    width = size;
    height = size;
  } else if (aspect === 'portrait') {
    width = size;
    height = Math.round((size * 16) / 9);
  } else {
    width = Math.round((size * 16) / 9);
    height = size;
  }
  if (maxLong) {
    const scale = Math.min(1, maxLong / Math.max(width, height));
    width = Math.max(2, Math.round(width * scale));
    height = Math.max(2, Math.round(height * scale));
  }
  return { width, height };
}

function updateRecordingGuide() {
  const guide = dom['recording-guide'];
  const frame = dom['recording-guide-frame'];
  const label = dom['recording-guide-label'];
  const host = dom['viewer-body'];
  if (!guide || !frame || !label || !host) return;

  const active = state.studio.active && state.studio.showRecordingGuide;
  guide.hidden = !active;
  if (!active) return;

  const hostRect = host.getBoundingClientRect();
  const canvas = viewer?.viewer?.renderer?.getCanvas?.() || dom['viewer']?.querySelector('canvas');
  const canvasRect = canvas?.getBoundingClientRect?.() || hostRect;
  const baseWidth = canvasRect.width;
  const baseHeight = canvasRect.height;
  if (baseWidth <= 1 || baseHeight <= 1) {
    guide.hidden = true;
    return;
  }

  const { width, height } = studioOutputDimensions();
  const targetAspect = width / height;
  const sourceAspect = baseWidth / baseHeight;
  let frameWidth;
  let frameHeight;
  if (sourceAspect > targetAspect) {
    frameHeight = baseHeight;
    frameWidth = frameHeight * targetAspect;
  } else {
    frameWidth = baseWidth;
    frameHeight = frameWidth / targetAspect;
  }
  const left =
    canvasRect.left - hostRect.left + (baseWidth - frameWidth) / 2;
  const top =
    canvasRect.top - hostRect.top + (baseHeight - frameHeight) / 2;
  frame.style.left = `${left.toFixed(1)}px`;
  frame.style.top = `${top.toFixed(1)}px`;
  frame.style.width = `${Math.max(1, frameWidth).toFixed(1)}px`;
  frame.style.height = `${Math.max(1, frameHeight).toFixed(1)}px`;
  const aspectLabel =
    state.studio.output.aspect === 'square'
      ? '1:1'
      : state.studio.output.aspect === 'portrait'
        ? '9:16'
        : '16:9';
  label.textContent = `${aspectLabel} · ${width}×${height}`;
  guide.classList.toggle('is-recording', state.studio.recording);
}

function studioOutputBackground() {
  if (state.appearance.background === 'transparent') {
    return (
      getComputedStyle(document.documentElement)
        .getPropertyValue('--viewer-bg')
        .trim() || '#050b10'
    );
  }
  return (
    viewer?.backgroundSpec?.().color ||
    state.appearance.background ||
    getComputedStyle(document.documentElement)
      .getPropertyValue('--viewer-bg')
      .trim() ||
    '#050b10'
  );
}

function drawStudioCover(context, source, width, height) {
  if (!source?.width || !source?.height) return;
  context.fillStyle = studioOutputBackground();
  context.fillRect(0, 0, width, height);
  const scale = Math.max(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  context.drawImage(
    source,
    (width - drawWidth) / 2,
    (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function setupStudioComposite() {
  const studio = state.studio;
  const canvas = viewer?.viewer?.renderer?.getCanvas?.();
  if (!canvas) return null;
  const { width, height } = studioOutputDimensions();
  const composite = document.createElement('canvas');
  composite.width = width;
  composite.height = height;
  const context = composite.getContext('2d');
  studio.composite = composite;
  studio.compositeContext = context;
  studio.sourceCanvas = canvas;
  studio.recordFrame = 0;
  drawStudioCover(context, canvas, width, height);
  return composite;
}

function drawStudioRecordingFrame() {
  const studio = state.studio;
  if (
    !studio.recording ||
    !studio.composite ||
    !studio.compositeContext ||
    !studio.sourceCanvas
  ) {
    return;
  }
  drawStudioCover(
    studio.compositeContext,
    studio.sourceCanvas,
    studio.composite.width,
    studio.composite.height,
  );
  studio.recordFrame += 1;
}

function clearStudioComposite() {
  const studio = state.studio;
  studio.composite = null;
  studio.compositeContext = null;
  studio.sourceCanvas = null;
  studio.recordFrame = 0;
}

function startStudioRecording() {
  const studio = state.studio;
  if (!studio.active) return;
  if (studio.recording) {
    finishStudioRecording();
    return;
  }
  const canvas = viewer?.viewer?.renderer?.getCanvas?.();
  if (!canvas || typeof canvas.captureStream !== 'function' || !window.MediaRecorder) {
    toast('Recording is not supported in this browser.', 'warning');
    return;
  }

  stopStudioPlayback(false);
  try {
    const composite = setupStudioComposite();
    if (!composite) throw new Error('No render canvas.');
    const fps = Number(state.studio.output.fps) || 30;
    const stream = composite.captureStream(fps);
    const candidates = [
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm',
    ];
    const mimeType =
      candidates.find((type) => window.MediaRecorder.isTypeSupported?.(type)) ||
      '';
    const recorder = new window.MediaRecorder(
      stream,
      mimeType
        ? { mimeType, videoBitsPerSecond: 8_000_000 }
        : { videoBitsPerSecond: 8_000_000 },
    );
    studio.stream = stream;
    studio.recorder = recorder;
    studio.chunks = [];
    studio.mimeType = mimeType || 'video/webm';

    recorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) studio.chunks.push(event.data);
    });
    recorder.addEventListener('stop', () => {
      const chunks = studio.chunks;
      studio.chunks = [];
      studio.recorder = null;
      studio.recording = false;
      studio.stream?.getTracks().forEach((track) => track.stop());
      studio.stream = null;
      clearStudioComposite();
      const blob = new Blob(chunks, { type: studio.mimeType || 'video/webm' });
      if (blob.size) {
        downloadBlob(
          blob,
          `molecule-studio-${state.cid || 'scene'}-${Date.now()}.webm`,
        );
        toast(`Recording saved (${formatBytes(blob.size)}).`, 'success');
      } else {
        toast('The recording produced no video data.', 'warning');
      }
      updateStudioControls();
    });

    studio.recording = true;
    // Recording always starts a new clip from the view the user is looking at.
    captureStudioPlaybackBase();
    studio.manualView = false;
    setStudioTime(0);
    drawStudioRecordingFrame();
    recorder.start(100);
    startStudioPlayback();
    updateStudioControls();
    toast('Recording the studio animation…', 'info');
  } catch (error) {
    console.error('Studio recording failed:', error);
    studio.stream?.getTracks().forEach((track) => track.stop());
    studio.stream = null;
    studio.recorder = null;
    studio.recording = false;
    clearStudioComposite();
    updateStudioControls();
    toast('Recording could not be started.', 'warning');
  }
}

function applyStudioFraming(name) {
  const studio = state.studio;
  if (!studio.active) return;
  pauseStudioPlayback();
  viewer?.setCameraPreset(name, { animate: false });
  if (studio.base && viewer?.viewer) {
    studio.base.view = viewer.viewer.getView().slice();
    applyStudioTime(studio.time);
  }
}

function useStudioDraggedAngle() {
  const studio = state.studio;
  if (!studio.active || !studio.base?.view || !viewer?.viewer) return;
  const view = viewer.viewer.getView?.();
  if (!view) return;

  const base = studio.base.view;
  const baseQ = { x: base[4], y: base[5], z: base[6], w: base[7] };
  const currentQ = { x: view[4], y: view[5], z: view[6], w: view[7] };
  const inverseBase = { x: -baseQ.x, y: -baseQ.y, z: -baseQ.z, w: baseQ.w };
  const delta = multiplyQuaternion(inverseBase, currentQ);
  const axis = studioCameraAxisVector();
  const dot = delta.x * axis.x + delta.y * axis.y + delta.z * axis.z;
  let angle = (2 * Math.atan2(dot, delta.w) * 180) / Math.PI;
  if (!Number.isFinite(angle) || Math.abs(angle) < 1) {
    toast('Drag the view around the chosen axis first.', 'info');
    return;
  }
  angle = Math.round(angle);
  studio.cameraMotion = 'orbit';
  studio.cameraAngle = angle;
  updateStudioControls();
  viewer.viewer.setView(base);
  viewer.viewer.render();
  applyStudioTime(0);
  toast(`Camera orbit set to ${angle}°.`, 'success');
}

function applyStudioSceneCommand(command) {
  const studio = state.studio;
  if (!studio.active) return;
  if (command === 'fit') {
    centerFitScene();
    return;
  }
  if (command === 'reset') {
    resetAllTransforms();
    return;
  }
  if (!['row', 'grid', 'circle'].includes(command)) return;
  setStudioMode(false);
  setSceneLayout(command);
  setStudioMode(true);
}

async function exportStudioGif() {
  const studio = state.studio;
  if (!studio.active || studio.gifBusy) return;
  if (!window.GIF) {
    toast('The GIF encoder did not load.', 'warning');
    return;
  }
  if (studio.recording) finishStudioRecording();
  pauseStudioPlayback();

  const { width, height } = studioOutputDimensions({ maxLong: 720 });
  const fps = Math.max(4, Math.min(24, Number(studio.output.fps) || 24));
  const frameCount = Math.max(2, Math.min(240, Math.round(studio.duration * fps)));
  const previousTime = studio.time;
  const canvas = viewer?.viewer?.renderer?.getCanvas?.();
  if (!canvas) {
    toast('The 3D view is not ready.', 'warning');
    return;
  }

  studio.gifBusy = true;
  if (dom['studio-gif']) dom['studio-gif'].textContent = 'GIF…';
  updateStudioControls();

  const frame = document.createElement('canvas');
  frame.width = width;
  frame.height = height;
  const context = frame.getContext('2d');

  let gif;
  try {
    gif = new window.GIF({
      workers: 2,
      quality: 8,
      width,
      height,
      workerScript: new URL('../vendor/gif/gif.worker.js', import.meta.url).href,
      repeat: studio.loop ? 0 : -1,
    });
  } catch (error) {
    console.error('GIF setup failed:', error);
    studio.gifBusy = false;
    updateStudioControls();
    toast('GIF export could not be started.', 'warning');
    return;
  }

  gif.on('progress', (value) => {
    if (dom['studio-gif']) {
      dom['studio-gif'].textContent = `GIF ${Math.round(value * 100)}%`;
    }
  });
  gif.on('finished', (blob) => {
    studio.gifBusy = false;
    if (dom['studio-gif']) dom['studio-gif'].textContent = 'GIF';
    if (blob?.size) {
      downloadBlob(
        blob,
        `molecule-studio-${state.cid || 'scene'}-${Date.now()}.gif`,
      );
      toast(`GIF saved (${formatBytes(blob.size)}).`, 'success');
    } else {
      toast('The GIF produced no data.', 'warning');
    }
    applyStudioTime(previousTime);
    updateStudioControls();
  });
  gif.on('abort', () => {
    studio.gifBusy = false;
    if (dom['studio-gif']) dom['studio-gif'].textContent = 'GIF';
    applyStudioTime(previousTime);
    updateStudioControls();
  });

  try {
    for (let index = 0; index < frameCount; index += 1) {
      const time = (index / frameCount) * studio.duration;
      applyStudioTime(time);
      drawStudioCover(context, canvas, width, height);
      gif.addFrame(frame, { copy: true, delay: Math.round(1000 / fps) });
      if (index % 4 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
    applyStudioTime(previousTime);
    updateStudioControls();
    gif.render();
    toast(`Encoding ${frameCount} GIF frames…`, 'info');
  } catch (error) {
    console.error('GIF export failed:', error);
    studio.gifBusy = false;
    applyStudioTime(previousTime);
    updateStudioControls();
    toast('GIF export failed.', 'warning');
  }
}

function bindStudio() {
  dom['studio-toggle']?.addEventListener('click', () =>
    setStudioMode(!state.studio.active),
  );
  dom['studio-scene-motion']?.addEventListener('change', () => {
    preserveStudioZoom();
    state.studio.sceneMotion = dom['studio-scene-motion'].value;
    renderStudioUI();
    applyStudioTime(state.studio.time);
  });
  dom['studio-scene-axis']?.addEventListener('change', () => {
    preserveStudioZoom();
    state.studio.sceneAxis = dom['studio-scene-axis'].value;
    applyStudioTime(state.studio.time);
  });
  dom['studio-scene-pingpong']?.addEventListener('change', () => {
    preserveStudioZoom();
    state.studio.scenePingPong = Boolean(dom['studio-scene-pingpong'].checked);
    applyStudioTime(state.studio.time);
  });
  dom['studio-camera-motion']?.addEventListener('change', () => {
    preserveStudioZoom();
    state.studio.cameraMotion = dom['studio-camera-motion'].value;
    updateStudioControls();
    applyStudioTime(state.studio.time);
  });
  dom['studio-camera-axis']?.addEventListener('change', () => {
    preserveStudioZoom();
    state.studio.cameraAxis = dom['studio-camera-axis'].value;
    updateStudioControls();
    applyStudioTime(state.studio.time);
  });
  dom['studio-camera-angle']?.addEventListener('change', () => {
    preserveStudioZoom();
    const value = Number(dom['studio-camera-angle'].value);
    state.studio.cameraAngle = Number.isFinite(value) ? value : 360;
    dom['studio-camera-angle'].value = String(state.studio.cameraAngle);
    applyStudioTime(state.studio.time);
  });
  dom['studio-camera-use-view']?.addEventListener('click', useStudioDraggedAngle);
  const readCustomAxis = () => {
    preserveStudioZoom();
    const read = (id) => {
      const value = Number(dom[id]?.value);
      return Number.isFinite(value) ? value : 0;
    };
    state.studio.cameraCustomAxis = {
      x: read('studio-camera-x'),
      y: read('studio-camera-y'),
      z: read('studio-camera-z'),
    };
    applyStudioTime(state.studio.time);
  };
  dom['studio-camera-x']?.addEventListener('change', readCustomAxis);
  dom['studio-camera-y']?.addEventListener('change', readCustomAxis);
  dom['studio-camera-z']?.addEventListener('change', readCustomAxis);
  const markManualView = () => {
    if (
      state.studio.active &&
      !state.studio.playing &&
      !state.studio.recording &&
      !state.studio.gifBusy
    ) {
      state.studio.manualView = true;
    }
  };
  dom['viewer']?.addEventListener('pointerdown', markManualView);
  dom['viewer']?.addEventListener('wheel', markManualView, { passive: true });
  document.getElementById('axis-gizmo')?.addEventListener('pointerdown', markManualView);
  dom['studio-fps']?.addEventListener('change', () => {
    state.studio.output.fps = Number(dom['studio-fps'].value) || 30;
  });
  dom['studio-size']?.addEventListener('change', () => {
    state.studio.output.size = Number(dom['studio-size'].value) || 1080;
    updateRecordingGuide();
  });
  dom['studio-aspect']?.addEventListener('change', () => {
    state.studio.output.aspect = dom['studio-aspect'].value;
    updateRecordingGuide();
  });
  dom['studio-recording-guide']?.addEventListener('change', () => {
    state.studio.showRecordingGuide = Boolean(dom['studio-recording-guide'].checked);
    try {
      localStorage.setItem(
        'studioRecordingGuide',
        state.studio.showRecordingGuide ? '1' : '0',
      );
    } catch {
      /* storage can be unavailable */
    }
    updateRecordingGuide();
  });
  dom['studio-gif']?.addEventListener('click', () => {
    if (state.studio.gifBusy) return;
    exportStudioGif();
  });
  $$('[data-studio-frame]').forEach((button) => {
    button.addEventListener('click', () => applyStudioFraming(button.dataset.studioFrame));
  });
  $$('[data-studio-scene]').forEach((button) => {
    button.addEventListener('click', () =>
      applyStudioSceneCommand(button.dataset.studioScene),
    );
  });
  dom['studio-background']?.addEventListener('input', () => {
    applyAppearance({ background: dom['studio-background'].value });
    updateBackgroundControls();
  });
  dom['studio-background-reset']?.addEventListener('click', () => {
    applyAppearance({ background: null });
    updateBackgroundControls();
  });
  dom['studio-background-transparent']?.addEventListener('click', () => {
    applyAppearance({ background: 'transparent' });
    updateBackgroundControls();
  });
  dom['studio-play']?.addEventListener('click', () => {
    if (state.studio.playing) pauseStudioPlayback();
    else startStudioPlayback();
  });
  dom['studio-stop']?.addEventListener('click', () => {
    if (state.studio.recording) finishStudioRecording();
    stopStudioPlayback(true);
  });
  dom['studio-record']?.addEventListener('click', () => {
    if (state.studio.recording) finishStudioRecording();
    else startStudioRecording();
  });
  dom['studio-duration']?.addEventListener('change', () => {
    preserveStudioZoom();
    const parsed = Number(dom['studio-duration'].value);
    const value = Number.isFinite(parsed) && parsed > 0 ? parsed : 6;
    state.studio.duration = value;
    if (state.studio.time > value) state.studio.time = value;
    if (state.studio.active) {
      renderStudioUI();
      applyStudioTime(state.studio.time);
    }
  });
  dom['studio-loop']?.addEventListener('change', () => {
    state.studio.loop = Boolean(dom['studio-loop'].checked);
  });
  updateStudioControls();
}


function covalentRadius(element) {
  return COVALENT_RADII[element] ?? 0.77;
}

function hasConnectionBetween(entryKeyA, entryKeyB) {
  return state.connections.some(
    (connection) =>
      (connection.a.entryKey === entryKeyA &&
        connection.b.entryKey === entryKeyB) ||
      (connection.a.entryKey === entryKeyB &&
        connection.b.entryKey === entryKeyA),
  );
}

function modelCentroid(model) {
  if (!model?.atoms?.length) return { x: 0, y: 0, z: 0 };
  let x = 0;
  let y = 0;
  let z = 0;
  for (const atom of model.atoms) {
    x += atom.x;
    y += atom.y;
    z += atom.z;
  }
  return {
    x: x / model.atoms.length,
    y: y / model.atoms.length,
    z: z / model.atoms.length,
  };
}

function normalizeVector3(v) {
  const length = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function quaternionFromVectors(from, to) {
  const a = normalizeVector3(from);
  const b = normalizeVector3(to);
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  if (dot < -0.999999) {
    const helper =
      Math.abs(a.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
    const axis = normalizeVector3({
      x: helper.y * a.z - helper.z * a.y,
      y: helper.z * a.x - helper.x * a.z,
      z: helper.x * a.y - helper.y * a.x,
    });
    return { x: axis.x, y: axis.y, z: axis.z, w: 0 };
  }
  const q = {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
    w: 1 + dot,
  };
  const length = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / length, y: q.y / length, z: q.z / length, w: q.w / length };
}

function joinCompounds(first, second, order = 1) {
  const entryA = state.scene.find((entry) => entry.key === first.entryKey);
  const entryB = state.scene.find((entry) => entry.key === second.entryKey);
  if (!entryA?.molecule || !entryB?.molecule) return;
  const indexA = state.renderedEntries.findIndex(
    (entry) => entry.key === first.entryKey,
  );
  const indexB = state.renderedEntries.findIndex(
    (entry) => entry.key === second.entryKey,
  );
  const modelA = indexA >= 0 ? viewer?.models[indexA] : null;
  const modelB = indexB >= 0 ? viewer?.models[indexB] : null;
  const atomA = modelA?.atoms?.[first.atomIndex];
  const atomB = modelB?.atoms?.[second.atomIndex];
  const sourceA = entryA.molecule.atoms[first.atomIndex];
  const sourceB = entryB.molecule.atoms[second.atomIndex];
  if (!atomA || !atomB || !sourceA || !sourceB) return;

  const target =
    covalentRadius(sourceA.element) +
    covalentRadius(sourceB.element) +
    0.1 -
    (order - 1) * 0.08;

  const centroidA = modelCentroid(modelA);
  const centroidB = modelCentroid(modelB);
  let aBody = {
    x: centroidA.x - atomA.x,
    y: centroidA.y - atomA.y,
    z: centroidA.z - atomA.z,
  };
  if (Math.hypot(aBody.x, aBody.y, aBody.z) < 1e-4) {
    aBody = {
      x: atomB.x - atomA.x,
      y: atomB.y - atomA.y,
      z: atomB.z - atomA.z,
    };
  }
  let direction = normalizeVector3({
    x: -aBody.x,
    y: -aBody.y,
    z: -aBody.z,
  });
  if (Math.hypot(direction.x, direction.y, direction.z) < 1e-4) {
    direction = { x: 1, y: 0, z: 0 };
  }

  const targetPosition = {
    x: atomA.x + direction.x * target,
    y: atomA.y + direction.y * target,
    z: atomA.z + direction.z * target,
  };

  const bBody = {
    x: centroidB.x - atomB.x,
    y: centroidB.y - atomB.y,
    z: centroidB.z - atomB.z,
  };
  const hasBody = Math.hypot(bBody.x, bBody.y, bBody.z) > 1e-4;
  const qDelta = hasBody
    ? quaternionFromVectors(bBody, direction)
    : { x: 0, y: 0, z: 0, w: 1 };
  const qB = {
    x: entryB.transform.qx,
    y: entryB.transform.qy,
    z: entryB.transform.qz,
    w: entryB.transform.qw,
  };
  const qNew = multiplyQuaternion(qDelta, qB);
  const center = entryB.layoutCenter || { x: 0, y: 0, z: 0 };
  const current = {
    x: atomB.x,
    y: atomB.y,
    z: atomB.z,
  };
  const shift = {
    x: targetPosition.x - current.x,
    y: targetPosition.y - current.y,
    z: targetPosition.z - current.z,
  };
  const offset = {
    x: center.x - current.x + entryB.transform.x,
    y: center.y - current.y + entryB.transform.y,
    z: center.z - current.z + entryB.transform.z,
  };
  const rotatedOffset = rotateVector(offset.x, offset.y, offset.z, qDelta);

  entryB.transform.qx = qNew.x;
  entryB.transform.qy = qNew.y;
  entryB.transform.qz = qNew.z;
  entryB.transform.qw = qNew.w;
  entryB.transform.x = current.x + rotatedOffset.x - center.x + shift.x;
  entryB.transform.y = current.y + rotatedOffset.y - center.y + shift.y;
  entryB.transform.z = current.z + rotatedOffset.z - center.z + shift.z;

  applySceneTransforms(state.renderedEntries, entryB.key);
}

function handleConnectAtom(hit) {
  if (!hit?.entry) return;
  const next = { entryKey: hit.entry.key, atomIndex: hit.atomIndex };
  const first = state.connect.first;

  if (!first) {
    state.connect.first = next;
    updateConnectUI();
    updateSelectionHighlight();
    return;
  }

  if (first.entryKey === next.entryKey) {
    if (first.atomIndex === next.atomIndex) {
      state.connect.first = null;
      updateConnectUI();
      updateSelectionHighlight();
    } else {
      toast('Choose an atom in a different compound to add a connection.', 'info');
    }
    return;
  }

  const existing = state.connections.find(
    (connection) =>
      (connection.a.entryKey === first.entryKey &&
        connection.a.atomIndex === first.atomIndex &&
        connection.b.entryKey === next.entryKey &&
        connection.b.atomIndex === next.atomIndex) ||
      (connection.b.entryKey === first.entryKey &&
        connection.b.atomIndex === first.atomIndex &&
        connection.a.entryKey === next.entryKey &&
        connection.a.atomIndex === next.atomIndex),
  );

  if (existing) {
    snapshotUndo('Connection updated');
    existing.a = first;
    existing.b = next;
    existing.order = state.connect.order;
    existing.style = state.connect.style;
    toast('Connection updated.', 'success');
  } else {
    snapshotUndo('Added bond');
    const firstBetween = !hasConnectionBetween(first.entryKey, next.entryKey);
    state.connections.push({
      id: `connection-${state.nextConnectionId++}`,
      a: first,
      b: next,
      order: state.connect.order,
      style: state.connect.style,
      visible: true,
    });
    state.connectionsExpanded = true;
    if (state.connect.join && firstBetween) {
      joinCompounds(first, next, state.connect.order);
    }
    toast('Connection added.', 'success');
  }

  state.connect.first = null;
  updateConnectUI();
  renderConnectionList();
  updateSelectionHighlight();
}

function removeConnection(id) {
  if (!state.connections.some((connection) => connection.id === id)) return;
  snapshotUndo('Removed bond');
  state.connections = state.connections.filter((connection) => connection.id !== id);
  if (state.selection?.type === 'connection' && state.selection.id === id) {
    state.selection = null;
  }
  renderConnectionList();
  renderItemEditor();
  updateSelectionHighlight();
}

function clearConnections() {
  if (!state.connections.length) return;
  snapshotUndo('Cleared added bonds');
  state.connections = [];
  state.connect.first = null;
  if (state.selection?.type === 'connection') state.selection = null;
  updateConnectUI();
  renderConnectionList();
  renderItemEditor();
  updateSelectionHighlight();
  toast('Added bonds cleared.', 'info');
}

function connectionMeta(connection) {
  const order = connection.order === 3 ? 'Triple' : connection.order === 2 ? 'Double' : 'Single';
  const style =
    connection.style === 'dashed'
      ? 'Dashed'
      : connection.style === 'arrow'
        ? 'Arrow'
        : 'Solid';
  return `${order} · ${style}`;
}

function shortConnectionTitle(entry) {
  const title = compoundTitle(entry);
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
}

function connectionLabel(connection) {
  const entryA = state.scene.find((entry) => entry.key === connection.a.entryKey);
  const entryB = state.scene.find((entry) => entry.key === connection.b.entryKey);
  const atomA = entryA?.molecule?.atoms?.[connection.a.atomIndex];
  const atomB = entryB?.molecule?.atoms?.[connection.b.atomIndex];
  if (!entryA || !entryB || !atomA || !atomB) return 'Missing atoms';
  return `${shortConnectionTitle(entryA)} ${atomA.element}${connection.a.atomIndex + 1} ↔ ${shortConnectionTitle(entryB)} ${atomB.element}${connection.b.atomIndex + 1}`;
}

function renderConnectionList() {
  const list = dom['connection-list'];
  const head = dom['connections-head'];
  if (!list || !head) return;
  clearNode(list);
  const count = state.connections.length;
  head.hidden = count === 0;
  list.hidden = count === 0 || !state.connectionsExpanded;
  if (dom['connection-count']) dom['connection-count'].textContent = String(count);
  if (dom['connections-chevron']) {
    dom['connections-chevron'].setAttribute(
      'aria-expanded',
      String(state.connectionsExpanded),
    );
    dom['connections-chevron'].setAttribute(
      'aria-label',
      `${state.connectionsExpanded ? 'Collapse' : 'Expand'} added bonds`,
    );
  }
  if (count === 0) return;

  for (const connection of state.connections) {
    const selected =
      state.selection?.type === 'connection' &&
      state.selection.id === connection.id;
    const visible = connection.visible !== false;
    const row = el('li', {
      class: `layer-row connection-row${selected ? ' is-selected' : ''}${
        visible ? '' : ' is-hidden'
      }`,
    });

    const eye = el('button', {
      class: 'connection-eye',
      type: 'button',
      attrs: {
        'aria-label': `${visible ? 'Hide' : 'Show'} added bond`,
        'aria-pressed': String(visible),
        title: `${visible ? 'Hide' : 'Show'} added bond`,
      },
    });
    eye.append(icon(visible ? 'eye' : 'eye-off'));
    eye.addEventListener('click', () => {
      snapshotUndo('Toggled bond visibility');
      connection.visible = !visible;
      renderConnectionList();
      updateSelectionHighlight();
    });
    row.append(eye);

    const label = connectionLabel(connection);
    const select = el('button', {
      class: 'connection-select',
      type: 'button',
      attrs: {
        'aria-label': `Select ${label}`,
        'aria-pressed': String(selected),
        title: label,
      },
    });
    select.append(label);
    select.addEventListener('click', () => selectConnection(connection.id));
    row.append(select);

    row.append(
      el(
        'span',
        { class: 'connection-meta', title: connectionMeta(connection) },
        connectionMeta(connection),
      ),
    );

    const remove = el('button', {
      class: 'connection-remove',
      type: 'button',
      attrs: {
        'aria-label': `Remove ${label}`,
        title: 'Remove added bond',
      },
    });
    remove.append(icon('close'));
    remove.addEventListener('click', () => removeConnection(connection.id));
    row.append(remove);
    list.append(row);
  }
}

function layerEyeButton(entry, visible, label, onToggle, disabled = false) {  const button = el('button', {
    class: `layer-eye${visible ? '' : ' is-off'}`,
    type: 'button',
    attrs: {
      'aria-label': label,
      'aria-pressed': String(visible),
    },
    title: label,
  });
  button.append(icon(visible ? 'eye' : 'eye-off'));
  button.disabled = disabled;
  button.addEventListener('click', onToggle);
  return button;
}

function layerNameButton(children, selected, onClick) {
  const button = el(
    'button',
    {
      class: 'layer-name layer-name-button',
      type: 'button',
      attrs: { 'aria-pressed': String(selected) },
    },
    children,
  );
  button.addEventListener('click', onClick);
  return button;
}

function setItemSlider(id, value, text) {
  const input = dom[id];
  if (input) input.value = String(value);
  const output = dom[`${id}-value`];
  if (output) output.textContent = text;
}

function renderConnectionItemEditor(details) {
  const editor = dom['item-editor'];
  if (!editor) return;
  const { connection, entryA, entryB, atomA, atomB, atomIndexA, atomIndexB } =
    details;
  editor.hidden = false;

  const hide = (id, hidden) => {
    if (dom[id]) dom[id].hidden = hidden;
  };

  hide('item-color-field', true);
  hide('item-size-field', true);
  hide('item-opacity-field', true);
  hide('item-order-field', true);
  hide('item-connection-style-field', true);
  hide('item-material-field', true);
  hide('item-gloss-field', true);
  dom['item-visible'].indeterminate = false;
  dom['item-visible'].checked = connection.visible !== false;
  dom['item-visible'].disabled = false;
  dom['item-color'].disabled = false;
  dom['item-size'].disabled = false;
  dom['item-opacity'].disabled = false;
  dom['item-order'].disabled = false;
  dom['item-connection-style'].disabled = false;

  dom['item-title'].textContent = `Added bond · ${shortConnectionTitle(entryA)} ${atomA.element}${atomIndexA + 1} ↔ ${shortConnectionTitle(entryB)} ${atomB.element}${atomIndexB + 1}`;

  const layersA = ensureEntryLayers(entryA);
  hide('item-color-field', false);
  dom['item-color'].value =
    connection.color || atomDisplayColor(layersA, atomA, atomIndexA);
  hide('item-size-field', false);
  dom['item-size-label'].textContent = 'Bond thickness';
  setItemSlider('item-size', connection.scale ?? 1, `${Number(connection.scale ?? 1).toFixed(2)}×`);
  hide('item-opacity-field', false);
  setItemSlider(
    'item-opacity',
    connection.opacity ?? state.appearance.opacity ?? 1,
    `${Math.round((connection.opacity ?? state.appearance.opacity ?? 1) * 100)}%`,
  );
  hide('item-order-field', false);
  dom['item-order'].value = String(connection.order || 1);
  hide('item-connection-style-field', false);
  dom['item-connection-style'].value = connection.style || 'solid';
}

function renderItemEditor() {
  const editor = dom['item-editor'];
  if (!editor) return;

  const details = selectionDetails();
  if (!details) {
    editor.hidden = true;
    return;
  }

  if (details.type === 'connection') {
    renderConnectionItemEditor(details);
    return;
  }

  editor.hidden = false;
  const { entry, type } = details;
  const layers = ensureEntryLayers(entry);
  const title = compoundTitle(entry);
  const atomsDisabled = state.style === 'sticks' || state.style === 'lines';
  const bondsDisabled = state.style === 'spheres' || state.style === 'lines';

  const hide = (id, hidden) => {
    if (dom[id]) dom[id].hidden = hidden;
  };

  hide('item-color-field', true);
  hide('item-size-field', true);
  hide('item-opacity-field', true);
  hide('item-order-field', true);
  hide('item-connection-style-field', true);
  hide('item-material-field', false);
  hide('item-gloss-field', false);
  dom['item-visible'].checked = true;
  dom['item-visible'].disabled = false;
  dom['item-color'].disabled = false;
  dom['item-size'].disabled = false;
  dom['item-opacity'].disabled = false;

  let scopeMaterialValue = 'inherit';
  let scopeGlossValue = state.appearance.materialGloss;
  if (type === 'compound') {
    scopeMaterialValue = layers.material || 'inherit';
    scopeGlossValue = layers.gloss ?? scopeGlossValue;
  } else if (type === 'atoms') {
    scopeMaterialValue = layers.atomsMaterial || 'inherit';
    scopeGlossValue = layers.atomsGloss ?? scopeGlossValue;
  } else if (type === 'bonds') {
    scopeMaterialValue = layers.bondsMaterial || 'inherit';
    scopeGlossValue = layers.bondsGloss ?? scopeGlossValue;
  } else if (type === 'element') {
    scopeMaterialValue = layers.elementMaterials[details.element] || 'inherit';
    scopeGlossValue = layers.elementGlosses[details.element] ?? scopeGlossValue;
  } else if (type === 'atom') {
    const index = details.indices[0];
    scopeMaterialValue = layers.atomMaterials[index] || 'inherit';
    scopeGlossValue = layers.atomGlosses[index] ?? scopeGlossValue;
  } else if (type === 'bond') {
    const index = details.indices[0];
    scopeMaterialValue = layers.bondMaterials[index] || 'inherit';
    scopeGlossValue = layers.bondGlosses[index] ?? scopeGlossValue;
  }
  dom['item-material'].value = scopeMaterialValue;
  setItemSlider('item-gloss', scopeGlossValue, `${Math.round(scopeGlossValue * 100)}%`);

  const showColour = (value) => {
    hide('item-color-field', false);
    dom['item-color'].value = value || '#8b979f';
  };
  const showSize = (value, label, disabled = false) => {
    hide('item-size-field', false);
    dom['item-size-label'].textContent = label;
    setItemSlider('item-size', value, `${Number(value).toFixed(2)}×`);
    dom['item-size'].disabled = disabled;
  };
  const showOpacity = (value, disabled = false) => {
    hide('item-opacity-field', false);
    setItemSlider('item-opacity', value, `${Math.round(value * 100)}%`);
    dom['item-opacity'].disabled = disabled;
  };
  const showOrder = (value, disabled = false) => {
    hide('item-order-field', false);
    dom['item-order'].value = String(value);
    dom['item-order'].disabled = disabled;
  };

  if (type === 'compound') {
    dom['item-title'].textContent = `Compound · ${title}`;
    dom['item-visible'].checked = layers.visible !== false;
    showOpacity(layers.compoundOpacity ?? 1);
    return;
  }

  if (type === 'atoms') {
    dom['item-title'].textContent = `Atoms · ${title}`;
    dom['item-visible'].checked = layers.atoms !== false;
    dom['item-visible'].disabled = atomsDisabled;
    const groupMaterial = scopeMaterial(layers.atomsMaterial);
    showColour(
      layers.atomsColor ||
        (groupMaterial
          ? itemMaterialColor(
              groupMaterial,
              'C',
              layers.atomsGloss ?? state.appearance.materialGloss,
            )
          : baseElementColor('C')),
    );
    showSize(layers.atomsScale ?? 1, 'Atom size', atomsDisabled);
    showOpacity(layers.atomsOpacity ?? layers.compoundOpacity ?? 1);
    return;
  }

  if (type === 'element') {
    const { element, count } = details;
    dom['item-title'].textContent = `Element ${element} · ${title} (${count})`;
    dom['item-visible'].checked = !layers.hiddenElements.includes(element);
    dom['item-visible'].disabled = atomsDisabled;
    const elementAtom = entry.molecule.atoms.find((atom) => atom.element === element);
    const elementIndex = elementAtom
      ? entry.molecule.atoms.indexOf(elementAtom)
      : -1;
    showColour(
      (elementAtom
        ? resolveAtomColor(layers, elementAtom, elementIndex)
        : null) || baseElementColor(element),
    );
    showSize(
      layers.elementScales[element] ?? layers.atomsScale ?? 1,
      'Atom size',
      atomsDisabled,
    );
    showOpacity(
      layers.elementOpacities[element] ??
        layers.atomsOpacity ??
        layers.compoundOpacity ??
        1,
    );
    return;
  }

  if (type === 'bonds') {
    dom['item-title'].textContent = `Bonds · ${title}`;
    dom['item-visible'].checked = layers.bonds !== false;
    dom['item-visible'].disabled = bondsDisabled;
    const groupMaterial = scopeMaterial(layers.bondsMaterial);
    showColour(
      layers.bondsColor ||
        (groupMaterial
          ? itemMaterialColor(
              groupMaterial,
              'C',
              layers.bondsGloss ?? state.appearance.materialGloss,
            )
          : baseElementColor('C')),
    );
    showSize(layers.bondsRadius ?? 1, 'Bond thickness', bondsDisabled);
    showOpacity(
      layers.bondsOpacity ?? layers.compoundOpacity ?? 1,
      bondsDisabled,
    );
    return;
  }

  if (type === 'atom') {
    const { indices, atoms } = details;
    const firstIndex = indices[0];
    const firstAtom = atoms[0];
    dom['item-title'].textContent =
      indices.length > 1
        ? `${indices.length} atoms · ${title}`
        : `Atom ${firstAtom.element} ${firstIndex + 1} · ${title}`;

    const hiddenCount = indices.filter((index) => layers.hiddenAtoms.includes(index)).length;
    dom['item-visible'].checked = hiddenCount === 0;
    dom['item-visible'].indeterminate = hiddenCount > 0 && hiddenCount < indices.length;
    dom['item-visible'].disabled = atomsDisabled || layers.visible === false;

    const colorOf = (atom, index) =>
      resolveAtomColor(layers, atom, index) || baseElementColor(atom.element);
    const scaleOf = (atom, index) =>
      layers.atomScales[index] ??
      layers.elementScales[atom.element] ??
      layers.atomsScale ??
      1;
    const opacityOf = (atom, index) =>
      layers.atomOpacities[index] ??
      layers.elementOpacities[atom.element] ??
      layers.atomsOpacity ??
      layers.compoundOpacity ??
      1;

    showColour(colorOf(firstAtom, firstIndex));
    showSize(scaleOf(firstAtom, firstIndex), 'Atom size', atomsDisabled);
    showOpacity(opacityOf(firstAtom, firstIndex));
    return;
  }

  const { indices, bonds } = details;
  const firstIndex = indices[0];
  const firstBond = bonds[0];
  const a = entry.molecule.atoms[firstBond.a];
  const b = entry.molecule.atoms[firstBond.b];
  dom['item-title'].textContent =
    indices.length > 1
      ? `${indices.length} bonds · ${title}`
      : `Bond ${a.element}${firstBond.a + 1}–${b.element}${firstBond.b + 1} · ${title}`;

  const hiddenCount = indices.filter((index) => layers.hiddenBonds.includes(index)).length;
  dom['item-visible'].checked = hiddenCount === 0;
  dom['item-visible'].indeterminate = hiddenCount > 0 && hiddenCount < indices.length;
  dom['item-visible'].disabled = layers.visible === false;

  const bondMaterial = bondMaterialFor(layers, firstIndex);
  showColour(
    layers.bondColors[firstIndex] ||
      layers.bondsColor ||
      (bondMaterial
        ? itemMaterialColor(
            bondMaterial,
            a.element,
            bondGlossFor(layers, firstIndex),
          )
        : atomDisplayColor(layers, a, firstBond.a)),
  );
  showSize(layers.bondScales[firstIndex] ?? 1, 'Bond thickness', bondsDisabled);
  showOpacity(
    layers.bondOpacities[firstIndex] ??
      layers.bondsOpacity ??
      layers.compoundOpacity ??
      1,
    bondsDisabled,
  );
  showOrder(layers.bondOrders[firstIndex] ?? firstBond.order, bondsDisabled);
}

function refreshSelectedItem() {
  applySceneLayers();
  applyBondOverrides();
  updateSelectionHighlight();
  renderCompoundList();
  renderItemEditor();
}

function applySelectedStyles() {
  applySceneLayers();
  applyBondOverrides();
  updateSelectionHighlight();
}

function bindItemEditor() {
  const details = () => selectionDetails();

  dom['item-visible']?.addEventListener('change', () => {
    const current = details();
    if (!current) return;
    snapshotUndo('Toggled visibility');
    const visible = dom['item-visible'].checked;

    if (current.type === 'connection') {
      current.connection.visible = visible;
      dom['item-visible'].indeterminate = false;
      refreshSelectedItem();
      return;
    }

    const layers = ensureEntryLayers(current.entry);

    if (current.type === 'compound') {
      layers.visible = visible;
    } else if (current.type === 'atoms') {
      layers.atoms = visible;
    } else if (current.type === 'bonds') {
      layers.bonds = visible;
    } else if (current.type === 'element') {
      const hidden = new Set(layers.hiddenElements);
      if (visible) hidden.delete(current.element);
      else hidden.add(current.element);
      layers.hiddenElements = [...hidden];
    } else if (current.type === 'atom') {
      const hidden = new Set(layers.hiddenAtoms);
      for (const index of current.indices) {
        if (visible) hidden.delete(index);
        else hidden.add(index);
      }
      layers.hiddenAtoms = [...hidden];
    } else if (current.type === 'bond') {
      const hidden = new Set(layers.hiddenBonds);
      for (const index of current.indices) {
        if (visible) hidden.delete(index);
        else hidden.add(index);
      }
      layers.hiddenBonds = [...hidden];
    }

    dom['item-visible'].indeterminate = false;
    refreshSelectedItem();
  });

  dom['item-color']?.addEventListener('input', () => {
    const current = details();
    if (!current) return;
    snapshotUndo('Changed colour', { key: 'item-color', coalesce: true });
    if (current.type === 'connection') {
      current.connection.color = dom['item-color'].value;
      applySelectedStyles();
      return;
    }
    const layers = ensureEntryLayers(current.entry);
    const color = dom['item-color'].value;

    if (current.type === 'atoms') layers.atomsColor = color;
    else if (current.type === 'bonds') layers.bondsColor = color;
    else if (current.type === 'element') layers.elementColors[current.element] = color;
    else if (current.type === 'atom') {
      for (const index of current.indices) layers.atomColors[index] = color;
    } else if (current.type === 'bond') {
      for (const index of current.indices) layers.bondColors[index] = color;
    }

    applySelectedStyles();
  });

  dom['item-material']?.addEventListener('change', () => {
    const current = details();
    if (!current || current.type === 'connection') return;
    snapshotUndo('Changed material');
    const layers = ensureEntryLayers(current.entry);
    const value = dom['item-material'].value;
    const material = value === 'inherit' ? null : value;

    if (current.type === 'compound') layers.material = material;
    else if (current.type === 'atoms') {
      layers.atomsMaterial = material;
      if (material) layers.atomsColor = null;
    } else if (current.type === 'bonds') {
      layers.bondsMaterial = material;
      if (material) layers.bondsColor = null;
    } else if (current.type === 'element') {
      if (material) {
        layers.elementMaterials[current.element] = material;
        delete layers.elementColors[current.element];
      } else {
        delete layers.elementMaterials[current.element];
      }
    } else if (current.type === 'atom') {
      for (const index of current.indices) {
        if (material) {
          layers.atomMaterials[index] = material;
          delete layers.atomColors[index];
        } else {
          delete layers.atomMaterials[index];
        }
      }
    } else if (current.type === 'bond') {
      for (const index of current.indices) {
        if (material) {
          layers.bondMaterials[index] = material;
          delete layers.bondColors[index];
        } else {
          delete layers.bondMaterials[index];
        }
      }
    }

    refreshSelectedItem();
  });

  dom['item-gloss']?.addEventListener('input', () => {
    const current = details();
    if (!current || current.type === 'connection') return;
    snapshotUndo('Changed gloss', { key: 'item-gloss', coalesce: true });
    const layers = ensureEntryLayers(current.entry);
    const value = Number(dom['item-gloss'].value);
    const output = dom['item-gloss-value'];
    if (output) output.textContent = `${Math.round(value * 100)}%`;

    if (current.type === 'compound') layers.gloss = value;
    else if (current.type === 'atoms') layers.atomsGloss = value;
    else if (current.type === 'bonds') layers.bondsGloss = value;
    else if (current.type === 'element') layers.elementGlosses[current.element] = value;
    else if (current.type === 'atom') {
      for (const index of current.indices) layers.atomGlosses[index] = value;
    } else if (current.type === 'bond') {
      for (const index of current.indices) layers.bondGlosses[index] = value;
    }

    applySelectedStyles();
  });

  dom['item-gloss']?.addEventListener('change', () => {
    renderCompoundList();
  });

  dom['item-order']?.addEventListener('change', () => {
    const current = details();
    if (!current) return;
    const order = Number(dom['item-order'].value) || 1;
    if (current.type === 'connection') {
      snapshotUndo('Changed bond order');
      current.connection.order = order;
      applySelectedStyles();
      renderCompoundList();
      renderItemEditor();
      return;
    }
    if (current.type !== 'bond') return;
    snapshotUndo('Changed bond order');
    const layers = ensureEntryLayers(current.entry);
    for (const index of current.indices) {
      layers.bondOrders[index] = order;
    }
    applyBondOverrides();
    renderCompoundList();
    renderItemEditor();
    updateSelectionHighlight();
  });

  dom['item-connection-style']?.addEventListener('change', () => {
    const current = details();
    if (!current || current.type !== 'connection') return;
    snapshotUndo('Changed bond style');
    current.connection.style = dom['item-connection-style'].value;
    applySelectedStyles();
    renderCompoundList();
    renderItemEditor();
  });

  const bindRange = (id, format, apply) => {
    const input = dom[id];
    if (!input) return;
    input.addEventListener('input', () => {
      const value = Number(input.value);
      const output = dom[`${id}-value`];
      if (output) output.textContent = format(value);
      apply(value);
    });
  };

  bindRange(
    'item-size',
    (value) => `${value.toFixed(2)}×`,
    (value) => {
      const current = details();
      if (!current) return;
      snapshotUndo('Changed thickness', { key: 'item-size', coalesce: true });
      if (current.type === 'connection') {
        current.connection.scale = value;
        applySelectedStyles();
        return;
      }
      const layers = ensureEntryLayers(current.entry);
      if (current.type === 'atoms') layers.atomsScale = value;
      else if (current.type === 'bonds') layers.bondsRadius = value;
      else if (current.type === 'element') layers.elementScales[current.element] = value;
      else if (current.type === 'atom') {
        for (const index of current.indices) layers.atomScales[index] = value;
      } else if (current.type === 'bond') {
        for (const index of current.indices) layers.bondScales[index] = value;
      }
      applySelectedStyles();
    },
  );

  bindRange(
    'item-opacity',
    (value) => `${Math.round(value * 100)}%`,
    (value) => {
      const current = details();
      if (!current) return;
      snapshotUndo('Changed opacity', { key: 'item-opacity', coalesce: true });
      if (current.type === 'connection') {
        current.connection.opacity = value;
        applySelectedStyles();
        return;
      }
      const layers = ensureEntryLayers(current.entry);
      if (current.type === 'compound') layers.compoundOpacity = value;
      else if (current.type === 'atoms') layers.atomsOpacity = value;
      else if (current.type === 'bonds') layers.bondsOpacity = value;
      else if (current.type === 'element') layers.elementOpacities[current.element] = value;
      else if (current.type === 'atom') {
        for (const index of current.indices) layers.atomOpacities[index] = value;
      } else if (current.type === 'bond') {
        for (const index of current.indices) layers.bondOpacities[index] = value;
      }
      applySelectedStyles();
    },
  );

  dom['item-reset']?.addEventListener('click', () => {
    const current = details();
    if (!current) return;
    if (current.type === 'connection') {
      snapshotUndo('Reset added bond');
      const connection = current.connection;
      connection.visible = true;
      connection.color = null;
      connection.scale = 1;
      connection.opacity = null;
      connection.order = 1;
      connection.style = 'solid';
      refreshSelectedItem();
      return;
    }
    snapshotUndo('Reset item');
    const layers = ensureEntryLayers(current.entry);

    if (current.type === 'compound') {
      layers.compoundOpacity = null;
      layers.material = null;
      layers.gloss = null;
      layers.visible = true;
    } else if (current.type === 'atoms') {
      layers.atoms = true;
      layers.atomsColor = null;
      layers.atomsScale = 1;
      layers.atomsOpacity = null;
      layers.atomsMaterial = null;
      layers.atomsGloss = null;
    } else if (current.type === 'bonds') {
      layers.bonds = true;
      layers.bondsRadius = 1;
      layers.bondsOpacity = null;
      layers.bondsColor = null;
      layers.bondsMaterial = null;
      layers.bondsGloss = null;
    } else if (current.type === 'element') {
      layers.hiddenElements = layers.hiddenElements.filter((element) => element !== current.element);
      delete layers.elementColors[current.element];
      delete layers.elementScales[current.element];
      delete layers.elementOpacities[current.element];
      delete layers.elementMaterials[current.element];
      delete layers.elementGlosses[current.element];
    } else if (current.type === 'atom') {
      const indices = new Set(current.indices);
      layers.hiddenAtoms = layers.hiddenAtoms.filter((index) => !indices.has(index));
      for (const index of indices) {
        delete layers.atomColors[index];
        delete layers.atomScales[index];
        delete layers.atomOpacities[index];
        delete layers.atomMaterials[index];
        delete layers.atomGlosses[index];
      }
    } else if (current.type === 'bond') {
      const indices = new Set(current.indices);
      layers.hiddenBonds = layers.hiddenBonds.filter((index) => !indices.has(index));
      for (const index of indices) {
        delete layers.bondColors[index];
        delete layers.bondScales[index];
        delete layers.bondOpacities[index];
        delete layers.bondOrders[index];
        delete layers.bondMaterials[index];
        delete layers.bondGlosses[index];
      }
    }

    refreshSelectedItem();
  });
}

function renderCompoundList() {
  const list = dom['scene-list'];
  if (!list) return;

  clearNode(list);
  updateSceneTools();
  dom['scene-count'].textContent = String(state.scene.length);
  dom['scene-empty'].hidden = state.scene.length > 0;

  for (const entry of state.scene) {
    const layers = ensureEntryLayers(entry);
    const active = entry.key === state.activeKey;
    const title = compoundTitle(entry);
    const has3d = Boolean(entry.sdfText && entry.molecule);
    const visible = layers.visible !== false;
    const atomsDisabled = state.style === 'sticks' || state.style === 'lines';
    const bondsDisabled = state.style === 'spheres' || state.style === 'lines';
    const compoundSelected =
      state.selection?.entryKey === entry.key && state.selection.type === 'compound';

    const group = el('li', {
      class: `layer-group${active ? ' is-active' : ''}${visible ? '' : ' is-hidden'}${
        compoundSelected ? ' is-selected' : ''
      }`,
    });
    const row = el('div', { class: 'layer-row layer-group-row' });

    if (has3d) {
      const chevron = el('button', {
        class: 'layer-chevron',
        type: 'button',
        attrs: {
          'aria-label': `${entry.ui.expanded ? 'Collapse' : 'Expand'} ${title}`,
          'aria-expanded': String(entry.ui.expanded),
        },
      });
      chevron.append(icon('chevron-down'));
      chevron.addEventListener('click', () => {
        entry.ui.expanded = !entry.ui.expanded;
        renderCompoundList();
      });
      row.append(chevron);
    } else {
      row.append(el('span', { class: 'layer-spacer' }));
    }

    row.append(
      layerEyeButton(
        entry,
        visible,
        `${visible ? 'Hide' : 'Show'} ${title} in the scene`,
        () => updateEntryLayer(entry.key, { visible: !visible }),
        !has3d,
      ),
    );

    const meta = [`CID ${entry.cid}`];
    if (entry.no3d) {
      meta.push('no 3D');
    } else if (entry.conformers?.length > 1) {
      meta.push(`conf ${entry.conformerIndex + 1}/${entry.conformers.length}`);
    }

    const select = el(
      'button',
      {
        class: 'scene-select',
        type: 'button',
        attrs: { 'aria-pressed': String(active) },
      },
      el('span', { class: 'scene-title', text: title }),
      el('span', { class: 'scene-meta', text: meta.join(' · ') }),
    );
    select.addEventListener('click', () => selectItem(entry.key, 'compound'));
    row.append(select);

    const duplicate = el('button', {
      class: 'scene-duplicate',
      type: 'button',
      attrs: {
        'aria-label': `Duplicate ${title}`,
        title: 'Duplicate compound',
      },
    });
    duplicate.append(icon('copy'));
    duplicate.addEventListener('click', () => duplicateCompound(entry.key));
    row.append(duplicate);

    const remove = el('button', {
      class: 'scene-remove',
      type: 'button',
      text: '×',
      attrs: {
        'aria-label': `Remove ${title} from the scene`,
        title: 'Remove from scene',
      },
    });
    remove.addEventListener('click', () => removeCompound(entry.key));
    row.append(remove);
    group.append(row);

    if (has3d && entry.ui.expanded) {
      const children = el('ul', { class: 'layer-children' });

      const atomsVisible = layers.atoms !== false;
      const atomsRow = el('li', { class: 'layer-row layer-sub' });
      const atomsChevron = el('button', {
        class: 'layer-chevron',
        type: 'button',
        attrs: {
          'aria-label': `${entry.ui.atomsExpanded ? 'Collapse' : 'Expand'} atoms of ${title}`,
          'aria-expanded': String(entry.ui.atomsExpanded),
        },
      });
      atomsChevron.append(icon('chevron-down'));
      atomsChevron.addEventListener('click', () => {
        entry.ui.atomsExpanded = !entry.ui.atomsExpanded;
        renderCompoundList();
      });
      atomsRow.append(atomsChevron);
      atomsRow.append(
        layerEyeButton(
          entry,
          atomsVisible,
          atomsDisabled
            ? 'Atoms are not shown in this style'
            : `${atomsVisible ? 'Hide' : 'Show'} atoms of ${title}`,
          () => updateEntryLayer(entry.key, { atoms: !atomsVisible }),
          atomsDisabled,
        ),
      );
      atomsRow.append(
        layerNameButton('Atoms', state.selection?.entryKey === entry.key && state.selection.type === 'atoms', () =>
          selectItem(entry.key, 'atoms'),
        ),
      );
      if (state.selection?.entryKey === entry.key && state.selection.type === 'atoms') {
        atomsRow.classList.add('is-selected');
      }
      atomsRow.append(
        el('span', {
          class: 'layer-count',
          text: String(entry.molecule.declaredAtomCount ?? entry.molecule.atoms.length),
        }),
      );
      children.append(atomsRow);

      if (entry.ui.atomsExpanded) {
        for (const [element, count] of elementCounts(entry)) {
          const hidden = layers.hiddenElements.includes(element);
          const expanded = entry.ui.expandedElements.includes(element);
          const elementRow = el('li', { class: 'layer-row layer-element' });

          const elementChevron = el('button', {
            class: 'layer-chevron',
            type: 'button',
            attrs: {
              'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${element} atoms`,
              'aria-expanded': String(expanded),
            },
          });
          elementChevron.append(icon('chevron-down'));
          elementChevron.addEventListener('click', () => {
            const set = new Set(entry.ui.expandedElements);
            if (set.has(element)) set.delete(element);
            else set.add(element);
            entry.ui.expandedElements = [...set];
            renderCompoundList();
          });
          elementRow.append(elementChevron);

          elementRow.append(
            layerEyeButton(
              entry,
              !hidden,
              atomsDisabled
                ? 'Atoms are not shown in this style'
                : `${hidden ? 'Show' : 'Hide'} ${element} atoms of ${title}`,
              () => toggleEntryElement(entry.key, element),
              atomsDisabled,
            ),
          );

          const elementSelected =
            state.selection?.entryKey === entry.key &&
            state.selection.type === 'element' &&
            state.selection.element === element;
          if (elementSelected) elementRow.classList.add('is-selected');

          const dot = el('span', { class: 'element-dot' });
          const firstIndex = entry.molecule?.atoms?.findIndex((atom) => atom.element === element) ?? -1;
          const firstAtom = firstIndex >= 0 ? entry.molecule.atoms[firstIndex] : null;
          dot.style.background =
            (firstAtom ? resolveAtomColor(layers, firstAtom, firstIndex) : null) ||
            baseElementColor(element);
          elementRow.append(
            layerNameButton([dot, element], elementSelected, () =>
              selectItem(entry.key, 'element', { element }),
            ),
          );
          elementRow.append(el('span', { class: 'layer-count', text: String(count) }));
          children.append(elementRow);

          if (expanded) {
            entry.molecule.atoms.forEach((atom, atomIndex) => {
              if (atom.element !== element) return;
              const atomHidden = layers.hiddenAtoms.includes(atomIndex);
              const selected =
                state.selection?.entryKey === entry.key &&
                state.selection.type === 'atom' &&
                (state.selection.indices ?? []).includes(atomIndex);
              const atomRow = el('li', {
                class: `layer-row layer-atom${selected ? ' is-selected' : ''}`,
              });
              atomRow.append(el('span', { class: 'layer-spacer' }));
              atomRow.append(
                layerEyeButton(
                  entry,
                  !atomHidden && !hidden,
                  atomsDisabled
                    ? 'Atoms are not shown in this style'
                    : `${atomHidden || hidden ? 'Show' : 'Hide'} ${atom.element} ${atomIndex + 1} of ${title}`,
                  () => {
                    const next = new Set(layers.hiddenAtoms);
                    if (next.has(atomIndex)) next.delete(atomIndex);
                    else next.add(atomIndex);
                    updateEntryLayer(entry.key, { hiddenAtoms: [...next] });
                  },
                  hidden || atomsDisabled,
                ),
              );

              const atomSelect = el('button', {
                class: 'layer-item-select',
                type: 'button',
                attrs: { 'aria-pressed': String(selected) },
              });
              const atomDot = el('span', { class: 'element-dot' });
              atomDot.style.background =
                resolveAtomColor(layers, atom, atomIndex) ||
                baseElementColor(atom.element);
              atomSelect.append(atomDot, `${atom.element} ${atomIndex + 1}`);
              atomSelect.addEventListener('click', (event) =>
                selectItem(
                  entry.key,
                  'atom',
                  { index: atomIndex },
                  { additive: event.ctrlKey || event.metaKey || event.shiftKey },
                ),
              );
              atomRow.append(atomSelect);
              children.append(atomRow);
            });
          }
        }
      }

      const bondsVisible = layers.bonds !== false;
      const bondsExpanded = entry.ui.bondsExpanded;
      const bondsRow = el('li', { class: 'layer-row layer-sub' });
      const bondsChevron = el('button', {
        class: 'layer-chevron',
        type: 'button',
        attrs: {
          'aria-label': `${bondsExpanded ? 'Collapse' : 'Expand'} bonds of ${title}`,
          'aria-expanded': String(bondsExpanded),
        },
      });
      bondsChevron.append(icon('chevron-down'));
      bondsChevron.addEventListener('click', () => {
        entry.ui.bondsExpanded = !entry.ui.bondsExpanded;
        renderCompoundList();
      });
      bondsRow.append(bondsChevron);
      bondsRow.append(
        layerEyeButton(
          entry,
          bondsVisible,
          bondsDisabled
            ? 'Bonds are not shown in this style'
            : `${bondsVisible ? 'Hide' : 'Show'} bonds of ${title}`,
          () => updateEntryLayer(entry.key, { bonds: !bondsVisible }),
          bondsDisabled,
        ),
      );
      const bondsSelected =
        state.selection?.entryKey === entry.key && state.selection.type === 'bonds';
      if (bondsSelected) bondsRow.classList.add('is-selected');
      bondsRow.append(
        layerNameButton('Bonds', bondsSelected, () => selectItem(entry.key, 'bonds')),
      );
      bondsRow.append(
        el('span', {
          class: 'layer-count',
          text: String(entry.molecule.declaredBondCount ?? entry.molecule.bonds.length),
        }),
      );
      children.append(bondsRow);

      if (bondsExpanded) {
        entry.molecule.bonds.forEach((bond, bondIndex) => {
          const a = entry.molecule.atoms[bond.a];
          const b = entry.molecule.atoms[bond.b];
          if (!a || !b) return;
          const hiddenBond = layers.hiddenBonds.includes(bondIndex);
          const selected =
            state.selection?.entryKey === entry.key &&
            state.selection.type === 'bond' &&
            (state.selection.indices ?? []).includes(bondIndex);
          const order = layers.bondOrders[bondIndex] ?? bond.order;

          const bondRow = el('li', {
            class: `layer-row layer-bond${selected ? ' is-selected' : ''}`,
          });
          bondRow.append(el('span', { class: 'layer-spacer' }));
          bondRow.append(
            layerEyeButton(
              entry,
              !hiddenBond,
              `${hiddenBond ? 'Show' : 'Hide'} bond ${a.element}${bond.a + 1}–${b.element}${bond.b + 1}`,
              () => {
                snapshotUndo('Toggled bond visibility');
                const next = new Set(layers.hiddenBonds);
                if (next.has(bondIndex)) next.delete(bondIndex);
                else next.add(bondIndex);
                layers.hiddenBonds = [...next];
                applyBondOverrides();
                renderCompoundList();
                updateSelectionHighlight();
              },
            ),
          );

          const bondSelect = el('button', {
            class: 'layer-item-select',
            type: 'button',
            attrs: { 'aria-pressed': String(selected) },
          });
          bondSelect.append(`${a.element}${bond.a + 1}–${b.element}${bond.b + 1}`);
          bondSelect.addEventListener('click', (event) =>
            selectItem(
              entry.key,
              'bond',
              { index: bondIndex },
              { additive: event.ctrlKey || event.metaKey || event.shiftKey },
            ),
          );
          bondRow.append(bondSelect);
          bondRow.append(el('span', { class: 'bond-order', text: String(order) }));
          children.append(bondRow);
        });
      }

      group.append(children);
    }

    list.append(group);
  }

  if (!state.loading) {
    dom['hud-record'].textContent = hudRecordLabel();
  }
  renderItemEditor();
  renderConnectionList();
  updateConnectUI();
  updateTransformBar();
}

/* -------------------------------- panels -------------------------------- */

function setPropertiesOpen(open) {
  const panel = dom['properties-panel'];
  const button = dom['toggle-properties'];
  if (!panel || !button) return;
  panel.classList.toggle('is-open', open);
  panel.setAttribute('aria-hidden', String(!open));
  button.setAttribute('aria-expanded', String(open));
  button.classList.toggle('is-active', open);
  if (open) {
    setLayersOpen(false);
    if (window.matchMedia('(max-width: 1199px)').matches) setCustomizeOpen(false);
  }
}

function setLayersOpen(open) {
  const panel = dom['layers-panel'];
  const button = dom['toggle-layers'];
  if (!panel || !button) return;
  const next = Boolean(open && state.editor);
  panel.classList.toggle('is-open', next);
  panel.setAttribute('aria-hidden', String(!next));
  button.setAttribute('aria-expanded', String(next));
  button.classList.toggle('is-active', next);
  if (next) {
    setPropertiesOpen(false);
    if (window.matchMedia('(max-width: 1199px)').matches) setCustomizeOpen(false);
  }
}

function setCustomizeOpen(open) {
  const panel = dom['customize-panel'];
  const button = dom['toggle-customize'];
  if (!panel || !button) return;
  const next = Boolean(open && state.editor);
  panel.classList.toggle('is-open', next);
  panel.setAttribute('aria-hidden', String(!next));
  button.setAttribute('aria-expanded', String(next));
  button.classList.toggle('is-active', next);
  if (next && window.matchMedia('(max-width: 1199px)').matches) {
    setPropertiesOpen(false);
    setLayersOpen(false);
  }
}

function setExportOpen(open) {
  const panel = dom['export-card'];
  const button = dom['toggle-export'];
  if (!panel || !button) return;
  const allowed = Boolean(state.properties) && !panel.hidden;
  const next = Boolean(open && allowed);
  panel.classList.toggle('is-open', next);
  button.setAttribute('aria-expanded', String(next));
  button.classList.toggle('is-active', next);
}

function bindPanels() {
  const wide = window.matchMedia('(min-width: 1200px)').matches;
  setPropertiesOpen(wide);
  setLayersOpen(false);
  setCustomizeOpen(false);
  setExportOpen(false);

  dom['toggle-properties']?.addEventListener('click', () => {
    setPropertiesOpen(!dom['properties-panel'].classList.contains('is-open'));
  });
  dom['close-properties']?.addEventListener('click', () => setPropertiesOpen(false));

  dom['toggle-layers']?.addEventListener('click', () => {
    setLayersOpen(!dom['layers-panel'].classList.contains('is-open'));
  });
  dom['close-layers']?.addEventListener('click', () => setLayersOpen(false));

  dom['toggle-customize']?.addEventListener('click', () => {
    setCustomizeOpen(!dom['customize-panel'].classList.contains('is-open'));
  });
  dom['close-customize']?.addEventListener('click', () => setCustomizeOpen(false));

  const narrow = window.matchMedia('(max-width: 1199px)');
  narrow.addEventListener?.('change', (event) => {
    if (event.matches && dom['customize-panel']?.classList.contains('is-open')) {
      setPropertiesOpen(false);
      setLayersOpen(false);
    }
  });

  dom['toggle-export']?.addEventListener('click', () => {
    setExportOpen(!dom['export-card'].classList.contains('is-open'));
  });
  dom['close-export']?.addEventListener('click', () => setExportOpen(false));
}

function bindSceneTools() {
  $$('[data-layout]').forEach((button) => {
    button.addEventListener('click', () => setSceneLayout(button.dataset.layout));
  });
  dom['scene-fit']?.addEventListener('click', centerFitScene);
  dom['scene-reset']?.addEventListener('click', resetAllTransforms);
  updateSceneTools();
}

const TOUR_STEPS = [
  {
    title: 'Start in the Editor',
    text: 'Open Editor to work with more than one compound. The 3D viewport is the first item in the editor strip.',
  },
  {
    title: 'Add compounds',
    text: 'The top search becomes Add while Editor is open. Load another CID — the same CID can be added more than once to compare conformers.',
  },
  {
    title: 'Organise with Layers',
    text: 'Layers lists every compound, atom and bond. Toggle visibility, select items to restyle them, or duplicate a compound from its row.',
  },
  {
    title: 'Connect compounds',
    text: 'Use Connect in the viewport toolbar to link atoms in different compounds. Choose bond order and a solid, dashed or arrow style.',
  },
  {
    title: 'Animate in Studio',
    text: 'Studio adds scene motion, per-compound speed and phase, camera framing, guides and WebM or GIF export — no keyframes needed.',
  },
];

let tourIndex = 0;
let pendingTour = false;

function renderTour() {
  const step = TOUR_STEPS[tourIndex];
  if (!step) return;
  if (dom['tour-step-count']) {
    dom['tour-step-count'].textContent = `${tourIndex + 1} / ${TOUR_STEPS.length}`;
  }
  if (dom['tour-title']) dom['tour-title'].textContent = step.title;
  if (dom['tour-text']) dom['tour-text'].textContent = step.text;
  if (dom['tour-prev']) dom['tour-prev'].hidden = tourIndex === 0;
  if (dom['tour-next']) {
    dom['tour-next'].textContent = tourIndex === TOUR_STEPS.length - 1 ? 'Done' : 'Next';
  }
  if (dom['tour-dots']) {
    clearNode(dom['tour-dots']);
    TOUR_STEPS.forEach((_, index) => {
      const dot = el('span', {
        class: `tour-dot${index === tourIndex ? ' is-active' : ''}`,
      });
      dom['tour-dots'].append(dot);
    });
  }
}

function showTour() {
  if (!dom['tour']) return;
  tourIndex = 0;
  renderTour();
  dom['tour'].hidden = false;
  document.body.classList.add('is-touring');
  dom['tour-skip']?.focus();
}

function hideTour(markSeen = true) {
  if (!dom['tour']) return;
  dom['tour'].hidden = true;
  document.body.classList.remove('is-touring');
  if (markSeen) {
    try {
      localStorage.setItem('molecule-tour-seen', '1');
    } catch {
      /* storage can be unavailable */
    }
  }
}

function bindTour() {
  dom['tour-toggle']?.addEventListener('click', showTour);
  dom['tour-skip']?.addEventListener('click', () => hideTour(true));
  dom['tour-prev']?.addEventListener('click', () => {
    tourIndex = Math.max(0, tourIndex - 1);
    renderTour();
  });
  dom['tour-next']?.addEventListener('click', () => {
    if (tourIndex >= TOUR_STEPS.length - 1) {
      hideTour(true);
      return;
    }
    tourIndex += 1;
    renderTour();
  });
  dom['tour']?.addEventListener('click', (event) => {
    if (event.target === dom['tour']) hideTour(true);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom['tour'] && !dom['tour'].hidden) {
      hideTour(true);
    }
  });
  try {
    if (!localStorage.getItem('molecule-tour-seen')) pendingTour = true;
  } catch {
    /* storage can be unavailable */
  }
}

function showWelcome() {
  if (!dom['welcome']) return;
  dom['welcome'].hidden = false;
  document.body.classList.add('is-touring');
  dom['welcome-close']?.focus();
}

function hideWelcome() {
  if (!dom['welcome']) return;
  dom['welcome'].hidden = true;
  document.body.classList.remove('is-touring');
  if (pendingTour) {
    pendingTour = false;
    setTimeout(showTour, 250);
  }
}

function bindWelcome() {
  dom['welcome-close']?.addEventListener('click', hideWelcome);
  dom['welcome']?.addEventListener('click', (event) => {
    if (event.target === dom['welcome']) hideWelcome();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && dom['welcome'] && !dom['welcome'].hidden) {
      hideWelcome();
    }
  });
  setTimeout(showWelcome, 450);
}

function updateExportAvailability() {
  const sceneHas3d = state.scene.some((entry) => entry.sdfText && entry.molecule);
  const availability = {
    sdf: Boolean(state.sdfText),
    mol: Boolean(state.sdfText),
    xyz: Boolean(state.molecule),
    glb: sceneHas3d,
    json: Boolean(state.properties),
    png: Boolean(sceneHas3d && viewer?.available && viewer?.model),
  };

  const molBytes = state.sdfText
    ? new TextEncoder().encode(toMolBlock(state.sdfText)).byteLength
    : null;
  const xyzBytes = state.molecule
    ? new TextEncoder().encode(
        toXyz(state.molecule, { cid: state.cid, title: state.properties?.Title }),
      ).byteLength
    : null;

  const sizes = {
    sdf: state.sdfSource ? formatBytes(state.sdfSource.bytes) : 'Unavailable',
    mol: molBytes ? formatBytes(molBytes) : 'Unavailable',
    xyz: xyzBytes
      ? `${formatBytes(xyzBytes)} · ${state.molecule.declaredAtomCount} atoms`
      : state.sdfText
        ? 'Parse failed'
        : 'Unavailable',
    glb: availability.glb
      ? state.exportOptions.glbScope === 'scene'
        ? `Edited scene · ${Math.max(1, state.renderedEntries.length)} compound${
            state.renderedEntries.length === 1 ? '' : 's'
          }`
        : 'Active compound'
      : 'Unavailable',
    json: state.properties ? 'Data + provenance' : 'Unavailable',
    png: availability.png ? 'High-res snapshot' : 'No 3D view',
  };

  if (state.conformers.length > 1 && state.sdfAllText) {
    sizes.sdf = `${formatBytes(state.sdfSource?.bytes)} · ${state.conformerIndex + 1}/${state.conformers.length}`;
  }

  $$('[data-export]').forEach((button) => {
    const type = button.dataset.export;
    const enabled = availability[type];
    button.disabled = !enabled;
    const sizeNode = button.querySelector('[data-size]');
    if (sizeNode) sizeNode.textContent = sizes[type];
  });

  const allButton = dom['export-all-sdf'];
  if (allButton) {
    const available = state.conformers.length > 1 && Boolean(state.sdfAllText);
    allButton.disabled = !available;
    if (available) {
      allButton.textContent = `Download all ${state.conformers.length} conformers (SDF, ${formatBytes(
        state.conformerSource?.bytes,
      )})`;
    }
  }

  if (dom['glb-option-note']) {
    const style = resolveGlbStyle();
    dom['glb-option-note'].textContent =
      state.exportOptions.glbScope === 'active'
        ? `Active compound · ${GLB_STYLE_LABELS[style]} uses its current editor transform and appearance; other compounds and added bonds are omitted.`
        : `Edited scene · ${GLB_STYLE_LABELS[style]} includes every visible compound, transform, colour, layer state and added bond. Ultra produces the largest files.`;
  }

  if (dom['toggle-export']) {
    dom['toggle-export'].disabled = !state.properties;
  }
  if (!state.properties) setExportOpen(false);
}

function exportBaseName() {
  const title = state.properties?.Title || state.properties?.IUPACName || 'molecule';
  return `${slugify(title)}-cid-${state.cid}`;
}

function buildExportJson() {
  const title = state.properties?.Title || state.properties?.IUPACName || `CID ${state.cid}`;
  return {
    schema: 'pubchem-3d-studio/1.0',
    generatedAt: new Date().toISOString(),
    retrievedAt: state.retrievedAt,
    cid: state.cid,
    title,
    scene: state.scene.map((entry) => ({
      cid: entry.cid,
      title: compoundTitle(entry),
      active: entry.key === state.activeKey,
      conformers: entry.conformers?.length ?? 0,
      conformerId: entry.conformers?.[entry.conformerIndex]?.id ?? null,
      transform: entry.transform
        ? {
            position: { x: entry.transform.x, y: entry.transform.y, z: entry.transform.z },
            rotation: {
              x: entry.transform.qx,
              y: entry.transform.qy,
              z: entry.transform.qz,
              w: entry.transform.qw,
            },
          }
        : null,
      layers: entry.layers
        ? {
            visible: entry.layers.visible !== false,
            atoms: entry.layers.atoms !== false,
            bonds: entry.layers.bonds !== false,
            hiddenElements: entry.layers.hiddenElements ?? [],
            hiddenAtoms: entry.layers.hiddenAtoms ?? [],
            hiddenBonds: entry.layers.hiddenBonds ?? [],
            atomColors: entry.layers.atomColors ?? {},
            atomScales: entry.layers.atomScales ?? {},
            atomOpacities: entry.layers.atomOpacities ?? {},
            elementColors: entry.layers.elementColors ?? {},
            elementScales: entry.layers.elementScales ?? {},
            elementOpacities: entry.layers.elementOpacities ?? {},
            atomsColor: entry.layers.atomsColor ?? null,
            atomsScale: entry.layers.atomsScale ?? 1,
            atomsOpacity: entry.layers.atomsOpacity ?? null,
            bondsRadius: entry.layers.bondsRadius ?? 1,
            bondsOpacity: entry.layers.bondsOpacity ?? null,
            bondsColor: entry.layers.bondsColor ?? null,
            bondColors: entry.layers.bondColors ?? {},
            bondScales: entry.layers.bondScales ?? {},
            bondOpacities: entry.layers.bondOpacities ?? {},
            compoundOpacity: entry.layers.compoundOpacity ?? null,
            bondOrders: entry.layers.bondOrders ?? {},
            material: entry.layers.material ?? null,
            gloss: entry.layers.gloss ?? null,
            atomsMaterial: entry.layers.atomsMaterial ?? null,
            atomsGloss: entry.layers.atomsGloss ?? null,
            bondsMaterial: entry.layers.bondsMaterial ?? null,
            bondsGloss: entry.layers.bondsGloss ?? null,
            elementMaterials: entry.layers.elementMaterials ?? {},
            elementGlosses: entry.layers.elementGlosses ?? {},
            atomMaterials: entry.layers.atomMaterials ?? {},
            atomGlosses: entry.layers.atomGlosses ?? {},
            bondMaterials: entry.layers.bondMaterials ?? {},
            bondGlosses: entry.layers.bondGlosses ?? {},
          }
        : null,
    })),
    connections: state.connections.map((connection) => {
      const entryA = state.scene.find((entry) => entry.key === connection.a.entryKey);
      const entryB = state.scene.find((entry) => entry.key === connection.b.entryKey);
      const atomA = entryA?.molecule?.atoms?.[connection.a.atomIndex];
      const atomB = entryB?.molecule?.atoms?.[connection.b.atomIndex];
      return {
        id: connection.id,
        order: connection.order,
        style: connection.style,
        visible: connection.visible !== false,
        color: connection.color ?? null,
        scale: connection.scale ?? 1,
        opacity: connection.opacity ?? null,
        a: {
          cid: entryA?.cid ?? null,
          entryKey: connection.a.entryKey,
          atomIndex: connection.a.atomIndex,
          element: atomA?.element ?? null,
        },
        b: {
          cid: entryB?.cid ?? null,
          entryKey: connection.b.entryKey,
          atomIndex: connection.b.atomIndex,
          element: atomB?.element ?? null,
        },
      };
    }),
    source: {
      name: 'NCBI PubChem PUG REST',
      page: `https://pubchem.ncbi.nlm.nih.gov/compound/${state.cid}`,
      propertyTable: urlsFor(state.cid).properties,
      conformerList: urlsFor(state.cid).conformers,
      conformer: state.sdfSource?.url ?? urlsFor(state.cid).sdf3d,
      synonyms: urlsFor(state.cid).synonyms,
    },
    integrity: {
      sdfSha256: state.hash,
      sdfBytes: state.sdfSource?.bytes ?? null,
      allConformersSha256: state.allHash,
      allConformersBytes: state.conformerSource?.bytes ?? null,
    },
    conformers: state.conformers.length
      ? {
          count: state.conformers.length,
          selected: state.conformerIndex + 1,
          selectedId: state.conformers[state.conformerIndex]?.id ?? null,
          ids: state.conformers.map((conformer) => conformer.id),
          listUrl: urlsFor(state.cid).conformers,
          sdfUrl: state.sdfSource?.url ?? null,
        }
      : null,
    compound: state.properties,
    synonyms: state.synonyms,
    threeD: state.sdfText
      ? {
          available: true,
          recordType: '3d',
          format: state.molecule?.version ?? 'unknown',
          conformerId: state.conformers[state.conformerIndex]?.id ?? null,
          conformerIndex: state.conformers.length ? state.conformerIndex + 1 : null,
          conformerCount: state.conformers.length || null,
          atoms: state.molecule?.declaredAtomCount ?? null,
          bonds: state.molecule?.declaredBondCount ?? null,
          coordinates: state.molecule?.atoms ?? null,
          note: 'Coordinates are from the selected PubChem 3D conformer record. The original SDF is included under raw.sdf; every conformer is included under raw.allConformersSdf.',
        }
      : {
          available: false,
          recordType: null,
          reason: state.no3d ? 'PubChem does not publish a 3D conformer for this CID.' : state.sdfError?.message,
        },
    appearance: {
      atomScale: state.appearance.atomScale,
      bondScale: state.appearance.bondScale,
      opacity: state.appearance.opacity,
      lineWidth: state.appearance.lineWidth,
      colorScheme: state.appearance.colorScheme,
      customColor: state.appearance.customColor,
      material: state.appearance.material,
      materialGloss: state.appearance.materialGloss,
      lighting: state.appearance.lighting,
      background: state.appearance.background,
      showAxes: state.appearance.showAxes,
      showGrid: state.appearance.showGrid,
      gridSpacing: state.appearance.gridSpacing,
      gridPlane: state.appearance.gridPlane,
      gridMode: state.appearance.gridMode,
      showScaleBar: state.appearance.showScaleBar,
      showUnitLabels: state.appearance.showUnitLabels,
    },
    layoutMode: state.layoutMode,
    studio: {
      duration: state.studio.duration,
      loop: state.studio.loop,
      sceneMotion: state.studio.sceneMotion,
      sceneAxis: state.studio.sceneAxis,
      scenePingPong: state.studio.scenePingPong,
      cameraMotion: state.studio.cameraMotion,
      cameraAxis: state.studio.cameraAxis,
      cameraAngle: state.studio.cameraAngle,
      cameraCustomAxis: { ...state.studio.cameraCustomAxis },
      output: { ...state.studio.output },
      items: cloneJson(state.studio.items),
    },
    raw: {
      properties: state.propertiesRaw,
      synonyms: state.synonymsRaw,
      sdf: state.sdfText,
      allConformersSdf: state.sdfAllText,
    },
  };
}

const GLB_STYLE_LABELS = {
  'ball-stick': 'Ball & stick',
  sticks: 'Sticks',
  spheres: 'Spheres',
  lines: 'Lines',
};

const GLB_STYLE_PROFILES = {
  'ball-stick': {
    showAtoms: true,
    showBonds: true,
    sphereScale: 1.15,
    bondRadius: 0.09,
    singleBonds: false,
  },
  sticks: {
    showAtoms: false,
    showBonds: true,
    sphereScale: 1,
    bondRadius: 0.075,
    singleBonds: true,
  },
  spheres: {
    showAtoms: true,
    showBonds: false,
    sphereScale: 4.4,
    bondRadius: 0.075,
    singleBonds: true,
  },
  lines: {
    showAtoms: false,
    showBonds: true,
    sphereScale: 1,
    bondRadius: 0.02,
    singleBonds: true,
  },
};

function resolveGlbStyle() {
  const requested = state.exportOptions.glbStyle;
  return requested === 'viewer'
    ? state.style
    : Object.prototype.hasOwnProperty.call(GLB_STYLE_PROFILES, requested)
      ? requested
      : 'ball-stick';
}

function glbSceneEntryNodes(entries, style = 'ball-stick') {
  const profile = GLB_STYLE_PROFILES[style] || GLB_STYLE_PROFILES['ball-stick'];
  const nodes = [];
  entries.forEach((entry) => {
    const renderedIndex = state.renderedEntries.findIndex((item) => item.key === entry.key);
    const model = renderedIndex >= 0 ? viewer?.models?.[renderedIndex] : null;
    if (!model?.atoms || !entry.molecule) return;
    const layers = ensureEntryLayers(entry);
    if (layers.visible === false) return;

    const atoms = model.atoms.map((atom, index) => {
      const sourceAtom = entry.molecule.atoms[index] || {
        element: atom.elem,
        x: atom.x,
        y: atom.y,
        z: atom.z,
      };
      const element = sourceAtom.element || atom.elem;
      const hidden =
        (!state.showH && element === 'H') ||
        layers.hiddenAtoms.includes(index) ||
        layers.hiddenElements.includes(element);
      const scale =
        layers.atomScales[index] ??
        layers.elementScales[element] ??
        layers.atomsScale ??
        1;
      const color =
        resolveAtomColor(layers, sourceAtom, index) ||
        (state.appearance.colorScheme === 'custom'
          ? state.appearance.customColor
          : viewer?.materialColor?.(element, state.appearance.materialGloss)) ||
        atomDisplayColor(layers, sourceAtom, index);
      const explicitOpacity = resolveAtomOpacity(layers, sourceAtom, index);
      return {
        x: atom.x,
        y: atom.y,
        z: atom.z,
        element,
        scale:
          (state.appearance.atomScale ?? 1) *
          scale *
          (profile.sphereScale || 1),
        color,
        opacity:
          explicitOpacity != null
            ? explicitOpacity
            : viewer?.effectiveOpacity?.(state.appearance.opacity) ??
              state.appearance.opacity ??
              1,
        visible: !hidden,
      };
    });

    const bonds = [];
    entry.molecule.bonds.forEach((bond, index) => {
      if (layers.hiddenBonds.includes(index)) return;
      const atomA = entry.molecule.atoms[bond.a];
      const atomB = entry.molecule.atoms[bond.b];
      const renderedA = atoms[bond.a];
      const renderedB = atoms[bond.b];
      if (!atomA || !atomB || !renderedA || !renderedB) return;
      if (!state.showH && (atomA.element === 'H' || atomB.element === 'H')) return;

      const bondMaterial = bondMaterialFor(layers, index);
      const bondGloss = bondGlossFor(layers, index);
      const explicitColor = layers.bondColors[index] || layers.bondsColor;
      const colorA =
        explicitColor ||
        (bondMaterial
          ? itemMaterialColor(bondMaterial, atomA.element, bondGloss)
          : renderedA.color);
      const colorB =
        explicitColor ||
        (bondMaterial
          ? itemMaterialColor(bondMaterial, atomB.element, bondGloss)
          : renderedB.color);
      const baseOpacity =
        layers.bondOpacities[index] ??
        layers.bondsOpacity ??
        layers.compoundOpacity ??
        state.appearance.opacity;
      const materialFactor = bondMaterial
        ? itemMaterialOpacity(bondMaterial, bondGloss) ?? 1
        : 1;
      const opacity = Math.min(
        1,
        Math.max(
          0.05,
          (viewer?.effectiveOpacity?.(baseOpacity) ?? baseOpacity) * materialFactor,
        ),
      );
      const scale =
        (state.appearance.bondScale ?? 1) *
        (layers.bondsRadius ?? 1) *
        (layers.bondScales[index] ?? 1);

      bonds.push({
        a: bond.a,
        b: bond.b,
        order: profile.singleBonds
          ? 1
          : layers.bondOrders[index] ?? bond.order,
        scale,
        colorA,
        colorB,
        opacity,
      });
    });

    nodes.push({
      name: compoundTitle(entry),
      cid: entry.cid,
      hash: entry.hash ?? null,
      transform: entry.transform ? { ...entry.transform } : null,
      style,
      atoms,
      bonds,
      showAtoms: profile.showAtoms && layers.atoms !== false,
      showBonds: profile.showBonds && layers.bonds !== false,
    });
  });
  return nodes;
}

function buildGlbExportScene(scope = 'scene', style = 'ball-stick') {
  const profile = GLB_STYLE_PROFILES[style] || GLB_STYLE_PROFILES['ball-stick'];
  const entries =
    scope === 'active'
      ? state.renderedEntries.filter((entry) => entry.key === state.activeKey)
      : state.renderedEntries;
  const nodes = glbSceneEntryNodes(entries, style);
  if (!nodes.length) {
    throw new Error('No edited 3D scene is available for GLB export.');
  }

  const effectiveProfile = { ...profile };
  if (style === 'lines') {
    effectiveProfile.bondRadius = Math.max(
      0.006,
      0.006 * (state.appearance.lineWidth ?? 1.6),
    );
  }
  const viewerBaseRadius =
    viewerBondBaseRadius() * (state.appearance.bondScale ?? 1);
  const connectionRadiusRatio =
    viewerBaseRadius > 0
      ? effectiveProfile.bondRadius / viewerBaseRadius
      : 1;
  const connections =
    scope === 'scene' && effectiveProfile.showBonds
      ? connectionSpecs().map((spec) => ({
          start: spec.start,
          end: spec.end,
          colorA: spec.colorA,
          colorB: spec.colorB,
          radius: Math.max(0.01, spec.radius * connectionRadiusRatio),
          opacity: spec.opacity,
          order: effectiveProfile.singleBonds ? 1 : spec.order,
          dashed: Boolean(spec.dashed),
          arrow: Boolean(spec.arrow),
        }))
      : [];

  return { nodes, connections, style, profile: effectiveProfile };
}

function buildGlbExportMeta(entries, scope) {
  const active =
    state.scene.find((entry) => entry.key === state.activeKey) ||
    entries[0] ||
    null;
  const title =
    scope === 'scene'
      ? entries.length > 1
        ? 'Edited scene'
        : active
          ? compoundTitle(active)
          : 'Edited scene'
      : active
        ? compoundTitle(active)
        : 'Molecule';
  return {
    cid: active?.cid ?? state.cid,
    title,
    formula: active?.properties?.MolecularFormula ?? null,
    sha256: scope === 'active' ? active?.hash ?? null : null,
    retrievedAt: active?.retrievedAt ?? state.retrievedAt,
    sourceUrl: active?.sdfSource?.url ?? (state.cid ? urlsFor(state.cid).sdf3d : null),
    scope,
    entries: entries.map((entry) => ({
      cid: entry.cid,
      title: compoundTitle(entry),
      hash: entry.hash ?? null,
      transform: entry.transform ? { ...entry.transform } : null,
    })),
  };
}

async function doExport(type) {
  if (!state.properties) return;
  const base = exportBaseName();
  const button =
    type === 'sdf-all'
      ? dom['export-all-sdf']
      : document.querySelector(`[data-export="${type}"]`);

  if (button) {
    button.dataset.busy = 'true';
    button.disabled = true;
  }

  try {
    switch (type) {
      case 'sdf': {
        if (!state.sdfText) throw new Error('No SDF record is available.');
        downloadText(state.sdfText, 'chemical/x-mdl-sdfile', `${base}-3d.sdf`);
        toast('SDF downloaded — exact PubChem response body', 'success');
        break;
      }
      case 'sdf-all': {
        if (!state.sdfAllText || state.conformers.length < 2) {
          throw new Error('This CID has a single 3D conformer.');
        }
        downloadText(
          state.sdfAllText,
          'chemical/x-mdl-sdfile',
          `${base}-3d-all-conformers.sdf`,
        );
        toast(
          `${state.conformers.length} conformers downloaded — exact PubChem response bodies`,
          'success',
        );
        break;
      }
      case 'mol': {
        if (!state.sdfText) throw new Error('No MOL record is available.');
        downloadText(toMolBlock(state.sdfText), 'chemical/x-mdl-molfile', `${base}.mol`);
        toast('MOL block downloaded', 'success');
        break;
      }
      case 'xyz': {
        if (!state.molecule) throw new Error('The SDF atom block could not be parsed.');
        downloadText(
          toXyz(state.molecule, { cid: state.cid, title: state.properties.Title }),
          'chemical/x-xyz',
          `${base}-3d.xyz`,
        );
        toast('XYZ coordinates downloaded', 'success');
        break;
      }
      case 'glb': {
        if (!state.renderedEntries.length) {
          throw new Error('No edited 3D scene is available for GLB export.');
        }
        const scope = state.exportOptions.glbScope === 'active' ? 'active' : 'scene';
        const quality = Object.prototype.hasOwnProperty.call(
          GLB_QUALITY_PRESETS,
          state.exportOptions.glbQuality,
        )
          ? state.exportOptions.glbQuality
          : 'high';
        const metaEntries =
          scope === 'active'
            ? state.renderedEntries.filter((entry) => entry.key === state.activeKey)
            : state.renderedEntries;
        const style = resolveGlbStyle();
        const scene = buildGlbExportScene(scope, style);
        const meta = buildGlbExportMeta(metaEntries, scope);
        meta.style = style;
        toast(
          `Generating ${GLB_QUALITY_PRESETS[quality].label.toLowerCase()} GLB…`,
          'info',
        );
        // Let the toast paint before the potentially heavy mesh generation.
        await new Promise((resolve) => setTimeout(resolve, 0));
        const result = buildSceneGlb(scene, meta, {
          quality,
          bondRadius: scene.profile.bondRadius,
        });
        const filename =
          scope === 'scene' ? `${base}-scene-3d.glb` : `${base}-3d.glb`;
        downloadBlob(
          new Blob([result.bytes], { type: 'model/gltf-binary' }),
          filename,
        );
        toast(
          `GLB downloaded (${formatBytes(result.bytes.byteLength)}, ${
            GLB_QUALITY_PRESETS[quality].label
          }).`,
          'success',
        );
        break;
      }
      case 'json': {
        downloadText(JSON.stringify(buildExportJson(), null, 2), 'application/json', `${base}-data.json`);
        toast('JSON downloaded — raw responses and integrity metadata', 'success');
        break;
      }
      case 'png': {
        if (!viewer?.model) throw new Error('No 3D model is loaded.');
        toast('Rendering a supersampled PNG…', 'info');
        const shot = await viewer.screenshot();
        downloadBlob(shot.blob, `${base}-view.png`);
        toast(
          `PNG downloaded — ${shot.width} × ${shot.height} px${shot.supersampled ? ' (supersampled)' : ''}`,
          'success',
        );
        break;
      }
      default:
        throw new Error('Unknown export type.');
    }
  } catch (error) {
    console.error(error);
    toast(error?.message || 'Export failed.', 'error');
  } finally {
    if (button) {
      delete button.dataset.busy;
    }
    updateExportAvailability();
  }
}

/* ------------------------------- shortcuts ------------------------------ */

function bindGlobalKeys() {
  document.addEventListener('keydown', (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    const textEditing =
      target instanceof HTMLElement &&
      (target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        (target.tagName === 'INPUT' &&
          !['range', 'checkbox', 'radio', 'color', 'button', 'submit', 'reset', 'file'].includes(
            target.type,
          )));

    if ((event.ctrlKey || event.metaKey) && !event.altKey && !textEditing) {
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redoEditor();
        else undoEditor();
        return;
      }
      if (key === 'y') {
        event.preventDefault();
        redoEditor();
        return;
      }
    }

    if (event.key === '/' && !typing) {
      event.preventDefault();
      dom['cid-input'].focus();
      dom['cid-input'].select();
    }

    if (event.key === 'Escape' && state.connect.active && !typing) {
      event.preventDefault();
      setConnectMode(false);
      return;
    }

    if (event.key === 'Escape' && document.fullscreenElement) {
      document.exitFullscreen?.();
    } else if (event.key === 'Escape' && !typing) {
      if (dom['export-card']?.classList.contains('is-open')) setExportOpen(false);
      else if (dom['layers-panel']?.classList.contains('is-open')) setLayersOpen(false);
      else if (dom['customize-panel']?.classList.contains('is-open')) setCustomizeOpen(false);
      else setPropertiesOpen(false);
    }
  });
}

/* --------------------------------- boot --------------------------------- */

init();
