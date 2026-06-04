/**
 * IFC Web Worker — runs web-ifc WASM parsing off the renderer main thread.
 *
 * Why isolate: web-ifc can crash or loop on malformed IFC (Revit exports are
 * notoriously messy — missing geometry on complex families, circular refs). In a
 * worker, a WASM crash kills only this thread and the renderer survives with a
 * clean error. We also enforce a 30s wall-clock timeout from the caller.
 *
 * Memory correctness: every FlatMesh and IfcGeometry the API returns is a WASM
 * heap allocation. JavaScript GC does NOT reclaim these — we MUST call `.delete()`
 * or the process leaks MB per mesh. Same rule for the vertex/index typed arrays
 * returned by GetVertexArray/GetIndexArray: those are views into the WASM heap and
 * become invalid after CloseModel, so we copy (via .slice()) before transferring.
 */
import { IfcAPI, LogLevel } from 'web-ifc';

export interface IfcMeshTransport {
  /** Flat Float32Array of vertex positions [x,y,z, x,y,z, ...] — one copy per mesh. */
  positions: Float32Array;
  /** Flat Float32Array of vertex normals — same layout as positions. */
  normals: Float32Array;
  /** Triangle indices into positions/normals. */
  indices: Uint32Array;
  /** 4x4 column-major placement matrix from web-ifc. */
  transform: Float32Array;
  /** Linear RGB color per mesh. Alpha collapses to opacity downstream. */
  color: { r: number; g: number; b: number; a: number };
  /** IFC expressID — preserved as userData so downstream code can cross-reference. */
  expressID: number;
}

export interface IfcWorkerRequest {
  type: 'parse';
  buffer: ArrayBuffer;
  /** Absolute URL prefix the worker should use for loading web-ifc.wasm. Computed on
   *  the main thread where window.location is available — we can't derive it inside the
   *  worker because `./` resolves relative to the worker's own bundle, not the app. */
  wasmPath: string;
}

export interface IfcWorkerResponse {
  type: 'parsed';
  meshes: IfcMeshTransport[];
  meshCount: number;
  triangleCount: number;
}

export interface IfcWorkerError {
  type: 'error';
  message: string;
}

// Lazily initialized — web-ifc's Init() is async and expensive. Reusing a single
// IfcAPI across messages avoids re-downloading + recompiling the ~5MB WASM per parse.
let ifcApi: IfcAPI | null = null;

async function getIfcApi(wasmPath: string): Promise<IfcAPI> {
  if (ifcApi) return ifcApi;
  const api = new IfcAPI();
  // wasmPath is a fully-qualified URL from the caller. Setting absolute=true stops
  // web-ifc from re-concatenating any prefix; we hand it the exact directory URL.
  api.SetWasmPath(wasmPath, true);
  // forceSingleThread=true: we're already isolated in a Web Worker, and threading
  // inside WASM would need SharedArrayBuffer + cross-origin-isolation headers we
  // haven't opted into. The single-thread build is strictly smaller and simpler.
  await api.Init(undefined, true);
  api.SetLogLevel(LogLevel.LOG_LEVEL_ERROR);
  ifcApi = api;
  return api;
}

function parseIfc(api: IfcAPI, buffer: ArrayBuffer): IfcWorkerResponse {
  const bytes = new Uint8Array(buffer);
  // COORDINATE_TO_ORIGIN: Revit IFC exports often carry huge real-world coordinate
  //   offsets; this recenters on load so depth buffer precision stays usable.
  // CIRCLE_SEGMENTS: 12 is the web-ifc default for curved surface tessellation.
  //   Higher = smoother but larger .glb; 12 keeps parity with web-ifc-three.
  const modelID = api.OpenModel(bytes, {
    COORDINATE_TO_ORIGIN: true,
    CIRCLE_SEGMENTS: 12,
  });

  const meshes: IfcMeshTransport[] = [];
  let triangleCount = 0;

  try {
    api.StreamAllMeshes(modelID, (flatMesh) => {
      try {
        const placedGeoms = flatMesh.geometries;
        const size = placedGeoms.size();
        for (let i = 0; i < size; i++) {
          const placed = placedGeoms.get(i);
          let geometry: ReturnType<IfcAPI['GetGeometry']> | null = null;
          try {
            geometry = api.GetGeometry(modelID, placed.geometryExpressID);

            // Vertex array is interleaved [x,y,z, nx,ny,nz, x,y,z, nx,ny,nz, ...]
            // Each vertex is 6 floats = 24 bytes.
            const vertexPtr = geometry.GetVertexData();
            const vertexSize = geometry.GetVertexDataSize();
            const indexPtr = geometry.GetIndexData();
            const indexSize = geometry.GetIndexDataSize();

            // CRITICAL: .slice() forces a copy out of the WASM heap. Without this,
            // these typed arrays become undefined memory after CloseModel.
            const interleaved = api.GetVertexArray(vertexPtr, vertexSize);
            const indices = api.GetIndexArray(indexPtr, indexSize).slice();

            const vertexCount = interleaved.length / 6;
            const positions = new Float32Array(vertexCount * 3);
            const normals = new Float32Array(vertexCount * 3);
            for (let v = 0; v < vertexCount; v++) {
              const src = v * 6;
              const dst = v * 3;
              positions[dst] = interleaved[src];
              positions[dst + 1] = interleaved[src + 1];
              positions[dst + 2] = interleaved[src + 2];
              normals[dst] = interleaved[src + 3];
              normals[dst + 1] = interleaved[src + 4];
              normals[dst + 2] = interleaved[src + 5];
            }

            triangleCount += indices.length / 3;

            meshes.push({
              positions,
              normals,
              indices,
              transform: new Float32Array(placed.flatTransformation),
              color: {
                r: placed.color.x,
                g: placed.color.y,
                b: placed.color.z,
                a: placed.color.w,
              },
              expressID: flatMesh.expressID,
            });
          } finally {
            // delete() is a no-op if geometry is null (GetGeometry threw).
            geometry?.delete();
          }
        }
      } finally {
        flatMesh.delete();
      }
    });
  } finally {
    // CloseModel releases everything still resident in WASM heap. We do this in a
    // finally so a partial parse still cleans up — otherwise a malformed file could
    // leak hundreds of MB across sessions.
    api.CloseModel(modelID);
  }

  return {
    type: 'parsed',
    meshes,
    meshCount: meshes.length,
    triangleCount,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(self as any).onmessage = async (event: MessageEvent<IfcWorkerRequest>) => {
  if (event.data.type !== 'parse') return;
  try {
    const api = await getIfcApi(event.data.wasmPath);
    const response = parseIfc(api, event.data.buffer);
    // Mark the typed-array underlying buffers as transferables so we don't copy
    // the entire mesh payload back across the worker boundary — a multi-MB model
    // transfers as pointer handoff rather than structured clone.
    const transfer: ArrayBuffer[] = [];
    for (const m of response.meshes) {
      transfer.push(m.positions.buffer, m.normals.buffer, m.indices.buffer, m.transform.buffer);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage(response, transfer);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const errorResponse: IfcWorkerError = { type: 'error', message };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (self as any).postMessage(errorResponse);
  }
};
