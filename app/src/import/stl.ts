interface StlLimits {
  maxVertices: number;
  maxTriangles: number;
}

const INVALID_STRUCTURE = 'STLの構文が不正か、三角面データが不足しています';
const INVALID_SIZE = 'STLの面数またはファイル長が不正です';
const NUMBER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;

/**
 * Read the complete STL payload before accepting geometry. A display loader may
 * silently skip incomplete facets; stored geometry must never be a partial file.
 * Normals and the two binary attribute bytes (including color variants) are not
 * retained. Zero normals/degenerate facets remain available for diagnostics.
 */
export function parseStl(buffer: ArrayBuffer, factor: number, limits: StlLimits): {
  positions: Float32Array;
  indices: Uint32Array;
} {
  const data = new DataView(buffer);
  const triangleLimit = Math.min(limits.maxTriangles, Math.floor(limits.maxVertices / 3));
  const declared = buffer.byteLength >= 84 ? data.getUint32(80, true) : 0;
  const binaryLengthMatches = buffer.byteLength >= 84 && 84 + declared * 50 === buffer.byteLength;
  let positions: Float32Array;

  // Exact binary length takes precedence: legal binary headers can start "solid".
  if (binaryLengthMatches) {
    if (declared === 0 || declared > triangleLimit) throw new Error(INVALID_SIZE);
    positions = new Float32Array(declared * 9);
    for (let face = 0; face < declared; face++) {
      const start = 84 + face * 50;
      for (let axis = 0; axis < 3; axis++) finiteFloat(data.getFloat32(start + axis * 4, true));
      for (let coordinate = 0; coordinate < 9; coordinate++) {
        positions[face * 9 + coordinate] = scaledCoordinate(data.getFloat32(start + 12 + coordinate * 4, true), factor);
      }
    }
  } else {
    let source: string;
    try {
      source = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    } catch {
      throw new Error(INVALID_SIZE);
    }
    if (!/^\s*solid(?:\s|$)/i.test(source)) throw new Error(INVALID_SIZE);

    // Count and validate before allocating the bounded output; avoid a large
    // JS-number array or per-line/token arrays for a 32 MiB text input.
    const count = readAscii(source, triangleLimit, factor);
    positions = new Float32Array(count * 9);
    readAscii(source, triangleLimit, factor, positions);
  }

  const indices = new Uint32Array(positions.length / 3);
  for (let vertex = 0; vertex < indices.length; vertex++) indices[vertex] = vertex;
  return { positions, indices };
}

function finiteFloat(value: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new Error('STLに不正な数値があります');
  }
  return value;
}

function scaledCoordinate(value: number, factor: number): number {
  // STL stores Float32 coordinates; use the same rounding for text and binary.
  const scaled = Math.fround(finiteFloat(value)) * factor;
  if (!Number.isFinite(Math.fround(scaled))) throw new Error('頂点座標に無効な値があります');
  return scaled;
}

function readAscii(source: string, triangleLimit: number, factor: number, positions?: Float32Array): number {
  const token = /\s*(\S+)/gy;
  const space = /\s*/gy;
  const solidLine = /(?:solid|endsolid)(?:[ \t]+[^\r\n]*)?(?:\r\n|\r|\n|$)/iy;
  let offset = 0;
  let triangles = 0;

  function skipSpace() {
    space.lastIndex = offset;
    space.exec(source);
    offset = space.lastIndex;
  }
  function word(): string {
    token.lastIndex = offset;
    const next = token.exec(source);
    if (!next) throw new Error(INVALID_STRUCTURE);
    offset = token.lastIndex;
    return next[1];
  }
  function expect(expected: string) {
    if (word().toLowerCase() !== expected) throw new Error(INVALID_STRUCTURE);
  }
  function scalar() {
    const value = word();
    if (!NUMBER.test(value)) throw new Error('STLに不正な数値があります');
    return finiteFloat(Number(value));
  }
  function boundary(expected: 'solid' | 'endsolid') {
    skipSpace();
    solidLine.lastIndex = offset;
    const line = solidLine.exec(source);
    if (!line || !new RegExp(`^${expected}(?:\\s|$)`, 'i').test(line[0])) {
      throw new Error(INVALID_STRUCTURE);
    }
    offset = solidLine.lastIndex;
  }

  skipSpace();
  while (offset < source.length) {
    boundary('solid');
    while (true) {
      skipSpace();
      if (/^endsolid(?:\s|$)/i.test(source.slice(offset, offset + 9))) {
        boundary('endsolid');
        break;
      }
      expect('facet');
      expect('normal');
      scalar(); scalar(); scalar();
      expect('outer');
      expect('loop');
      if (triangles >= triangleLimit) throw new Error(INVALID_SIZE);
      for (let vertex = 0; vertex < 3; vertex++) {
        expect('vertex');
        for (let axis = 0; axis < 3; axis++) {
          const value = scaledCoordinate(scalar(), factor);
          if (positions) positions[triangles * 9 + vertex * 3 + axis] = value;
        }
      }
      expect('endloop');
      expect('endfacet');
      triangles++;
    }
    skipSpace();
  }
  if (triangles === 0) throw new Error(INVALID_SIZE);
  return triangles;
}
