/**
 * PubChem PUG REST client.
 *
 * Design rule: this module never derives or recalculates a molecular property.
 * It returns PubChem's responses as-is so the UI can display them verbatim.
 */

const API = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

export const PROPERTY_KEYS = [
  'Title',
  'MolecularFormula',
  'MolecularWeight',
  'ExactMass',
  'MonoisotopicMass',
  'IUPACName',
  'SMILES',
  'ConnectivitySMILES',
  'IsomericSMILES',
  'InChI',
  'InChIKey',
  'XLogP',
  'TPSA',
  'Charge',
  'HBondDonorCount',
  'HBondAcceptorCount',
  'RotatableBondCount',
  'HeavyAtomCount',
  'IsotopeAtomCount',
  'AtomStereoCount',
  'DefinedAtomStereoCount',
  'UndefinedAtomStereoCount',
  'BondStereoCount',
  'DefinedBondStereoCount',
  'UndefinedBondStereoCount',
  'CovalentUnitCount',
  'Complexity',
  'ConformerCount3D',
  'Volume3D',
  'ConformerModelRMSD3D',
  'EffectiveRotorCount3D',
  'FeatureCount3D',
];

export const PROPERTY_QUERY = PROPERTY_KEYS.join(',');

export class PubChemError extends Error {
  /**
   * @param {string} code machine-readable code
   * @param {string} message human-readable message
   * @param {{status?: number, url?: string, detail?: unknown}} [meta]
   */
  constructor(code, message, meta = {}) {
    super(message);
    this.name = 'PubChemError';
    this.code = code;
    this.status = meta.status ?? null;
    this.url = meta.url ?? null;
    this.detail = meta.detail ?? null;
  }
}

/** Build every URL used by the app for one CID. */
export function urlsFor(cid) {
  return {
    page: `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}`,
    properties: `${API}/compound/cid/${cid}/property/${PROPERTY_QUERY}/JSON`,
    sdf3d: `${API}/compound/cid/${cid}/record/SDF?record_type=3d`,
    conformers: `${API}/compound/cid/${cid}/conformers/JSON`,
    synonyms: `${API}/compound/cid/${cid}/synonyms/JSON`,
    image2d: `${API}/compound/cid/${cid}/PNG?record_type=2d&image_size=600x600`,
    pug: 'https://pubchem.ncbi.nlm.nih.gov/docs/pug-rest',
  };
}

/**
 * Build the SDF request URL for one conformer ID or a list of them.
 * PubChem separates multi-ID responses with `$$$$` records.
 * @param {string|string[]} ids
 */
export function conformerUrl(ids) {
  const list = Array.isArray(ids) ? ids.join(',') : String(ids);
  return `${API}/conformers/${list}/SDF`;
}

/**
 * Accept a bare CID, "CID 2244", "#cid=2244", or a PubChem compound URL.
 * @param {string} raw
 * @returns {number|null}
 */
export function parseCid(raw) {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (!value) return null;

  const fromUrlOrPrefix = value.match(/(?:compound|cid)[\s/:=#]*(\d{1,9})\b/i);
  const digits = fromUrlOrPrefix ? fromUrlOrPrefix[1] : value.replace(/^cid[\s:]*/i, '');
  if (!/^\d{1,9}$/.test(digits)) return null;

  const cid = Number(digits);
  return Number.isSafeInteger(cid) && cid > 0 ? cid : null;
}

/* ------------------------------------------------------------------ */
/* Throttle: stay politely below PubChem's 5 requests/second guidance. */
/* ------------------------------------------------------------------ */

const MIN_REQUEST_SPACING_MS = 220;
let lastRequestAt = 0;

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }
    signal?.addEventListener('abort', onAbort, { once: true });
  });

async function throttle(signal) {
  const wait = Math.max(0, MIN_REQUEST_SPACING_MS - (Date.now() - lastRequestAt));
  if (wait > 0) await sleep(wait, signal);
  lastRequestAt = Date.now();
}

async function request(url, { signal, accept = '*/*' } = {}) {
  await throttle(signal);

  let response;
  try {
    response = await fetch(url, {
      signal,
      cache: 'no-store',
      headers: { Accept: accept },
    });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new PubChemError(
      'NETWORK',
      'Could not reach PubChem. Check your connection, then try again.',
      { url, detail: error },
    );
  }

  const text = await response.text();

  if (!response.ok) {
    let fault = null;
    try {
      fault = JSON.parse(text)?.Fault ?? null;
    } catch {
      /* non-JSON error body */
    }

    const status = response.status;
    const code =
      status === 404 ? 'NOT_FOUND' : status === 503 ? 'BUSY' : `HTTP_${status}`;
    const fallback =
      status === 404
        ? 'PubChem has no record for that request.'
        : status === 503
          ? 'PubChem is busy right now. Try again in a moment.'
          : `PubChem returned HTTP ${status}.`;
    throw new PubChemError(code, fault?.Message || fallback, {
      status,
      url,
      detail: fault,
    });
  }

  return { text, response, url };
}

/**
 * Fetch the property table for a CID.
 * @param {number} cid
 * @param {AbortSignal} [signal]
 */
export async function fetchProperties(cid, signal) {
  const url = urlsFor(cid).properties;
  const { text, response } = await request(url, {
    signal,
    accept: 'application/json',
  });

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PubChemError('BAD_RESPONSE', 'PubChem returned an unreadable property table.', {
      url,
      status: response.status,
    });
  }

  const properties = raw?.PropertyTable?.Properties?.[0];
  if (!properties) {
    throw new PubChemError('NO_PROPERTIES', 'PubChem returned no properties for this CID.', {
      url,
      status: response.status,
      detail: raw,
    });
  }

  if (Number(properties.CID) !== Number(cid)) {
    throw new PubChemError(
      'CID_MISMATCH',
      `PubChem returned CID ${properties.CID} when CID ${cid} was requested.`,
      { url, status: response.status, detail: raw },
    );
  }

  // PUG REST returns HTTP 200 with only a CID stub for some unknown CIDs.
  // A genuine compound record always has an identity or formula field.
  if (!properties.MolecularFormula && !properties.MolecularWeight && !properties.Title && !properties.IUPACName) {
    throw new PubChemError('NOT_FOUND', `PubChem has no compound record for CID ${cid}.`, {
      url,
      status: 404,
      detail: raw,
    });
  }

  return {
    properties,
    raw,
    url,
    status: response.status,
    bytes: new TextEncoder().encode(text).byteLength,
    retrievedAt: new Date().toISOString(),
  };
}

/**
 * Fetch PubChem's published 3D conformer (SDF, record_type=3d).
 * A 404 here means "no 3D record", not necessarily "no compound".
 * @param {number} cid
 * @param {AbortSignal} [signal]
 */
export async function fetch3dSdf(cid, signal) {
  const url = urlsFor(cid).sdf3d;
  try {
    const { text, response } = await request(url, { signal, accept: 'chemical/x-mdl-sdfile' });
    if (!/M\s+END/.test(text)) {
      throw new PubChemError(
        'BAD_CONFORMER',
        'PubChem returned a 3D record in an unrecognized format.',
        { url, status: response.status },
      );
    }
    return {
      text,
      url,
      status: response.status,
      bytes: new TextEncoder().encode(text).byteLength,
      retrievedAt: new Date().toISOString(),
    };
  } catch (error) {
    if (error instanceof PubChemError && error.code === 'NOT_FOUND') {
      const no3d = new PubChemError(
        'NO_3D',
        'PubChem does not publish a 3D conformer for this CID.',
        { url, status: 404, detail: error.detail },
      );
      no3d.cause = error;
      throw no3d;
    }
    throw error;
  }
}

/**
 * Fetch every published 3D conformer for a CID.
 *
 * PubChem first exposes a conformer ID list, then serves one or more SDF
 * records in a single request. IDs are batched so the URL stays modest even
 * for large conformer sets.
 *
 * @param {number} cid
 * @param {AbortSignal} [signal]
 * @param {(loaded:number,total:number)=>void} [onProgress]
 */
export async function fetchConformers(cid, signal, onProgress) {
  const urls = urlsFor(cid);
  let listText;
  let listResponse;

  try {
    ({ text: listText, response: listResponse } = await request(urls.conformers, {
      signal,
      accept: 'application/json',
    }));
  } catch (error) {
    if (error instanceof PubChemError && error.code === 'NOT_FOUND') {
      const no3d = new PubChemError(
        'NO_3D',
        'PubChem does not publish 3D conformers for this CID.',
        { url: urls.conformers, status: 404, detail: error.detail },
      );
      no3d.cause = error;
      throw no3d;
    }
    throw error;
  }

  let listRaw;
  try {
    listRaw = JSON.parse(listText);
  } catch {
    throw new PubChemError('BAD_RESPONSE', 'PubChem returned an unreadable conformer list.', {
      url: urls.conformers,
      status: listResponse.status,
    });
  }

  const listed = listRaw?.InformationList?.Information?.[0]?.ConformerID;
  const ids = Array.isArray(listed) ? listed.map(String) : listed ? [String(listed)] : [];
  if (!ids.length) {
    throw new PubChemError('NO_3D', 'PubChem does not publish 3D conformers for this CID.', {
      url: urls.conformers,
      status: listResponse.status,
      detail: listRaw,
    });
  }

  const chunkSize = 40;
  const records = [];
  let recordsUrl = '';
  let allText = '';
  let bytes = 0;

  for (let start = 0; start < ids.length; start += chunkSize) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const chunk = ids.slice(start, start + chunkSize);
    const url = conformerUrl(chunk);
    if (!recordsUrl) recordsUrl = url;

    const { text, response } = await request(url, {
      signal,
      accept: 'chemical/x-mdl-sdfile',
    });

    const normalized = text.replace(/\r\n?/g, '\n');
    const parts = normalized.includes('$$')
      ? normalized.split(/\$\$\$\$\s*\n?/)
      : [normalized];
    const chunkRecords = parts
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => `${part}\n$$\n`);

    if (chunkRecords.length !== chunk.length) {
      throw new PubChemError(
        'CONFORMER_MISMATCH',
        `PubChem returned ${chunkRecords.length} conformer record(s) for ${chunk.length} requested.`,
        { url, status: response.status },
      );
    }

    records.push(...chunkRecords);
    allText += chunkRecords.join('');
    bytes = new TextEncoder().encode(allText).byteLength;
    onProgress?.(Math.min(start + chunk.length, ids.length), ids.length);
  }

  return {
    ids,
    records,
    text: allText,
    bytes,
    listRaw,
    listBytes: new TextEncoder().encode(listText).byteLength,
    listUrl: urls.conformers,
    url: recordsUrl,
    status: listResponse.status,
    retrievedAt: new Date().toISOString(),
  };
}
/**
 * Fetch synonyms. This is supporting data: a failure never blocks the record.
 * @param {number} cid
 * @param {AbortSignal} [signal]
 */
export async function fetchSynonyms(cid, signal) {
  const url = urlsFor(cid).synonyms;
  const { text, response } = await request(url, {
    signal,
    accept: 'application/json',
  });

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new PubChemError('BAD_RESPONSE', 'PubChem returned an unreadable synonym list.', {
      url,
      status: response.status,
    });
  }

  const list = raw?.InformationList?.Information?.[0]?.Synonym;
  return {
    synonyms: Array.isArray(list) ? list : [],
    raw,
    url,
    status: response.status,
    bytes: new TextEncoder().encode(text).byteLength,
    retrievedAt: new Date().toISOString(),
  };
}

/** SHA-256 fingerprint of the exact bytes received, when Web Crypto is available. */
export async function sha256Hex(bytes) {
  if (!globalThis.crypto?.subtle) {
    return { hash: null, reason: 'Web Crypto requires a secure context (HTTPS or localhost).' };
  }
  try {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return { hash, reason: null };
  } catch (error) {
    return { hash: null, reason: error?.message || 'SHA-256 could not be computed.' };
  }
}
