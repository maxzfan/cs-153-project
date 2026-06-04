import * as THREE from 'three';
import type { ModelMetadata } from './gltf-service';
import type { IfcMeshTransport, IfcWorkerError, IfcWorkerResponse } from '@/workers/ifc-worker';
// Vite worker import — `?worker` emits the worker with its own bundle. This is the
// supported way to ship a Web Worker alongside a Vite app; don't convert to a plain
// ESM import, it'll run in the main thread and the point of the worker disappears.
import IfcWorker from '@/workers/ifc-worker?worker';

/**
 * Metadata specific to models loaded from IFC (Industry Foundation Classes) files.
 * Viewer hides rhino-specific stats (curves/surfaces/polysurfaces) for this kind and
 * surfaces mesh/triangle counts instead.
 */
export interface IfcMetadata extends ModelMetadata {
  kind: 'ifc';
  meshCount: number;
  triangleCount: number;
}

export interface LoadedIfcModel {
  objects: THREE.Object3D[];
  metadata: IfcMetadata;
}

/** Hard upper bound on parse wall-clock time. Malformed IFC can spin forever in
 *  web-ifc; 30s is generous for ~500MB files and short enough to recover from pathological cases. */
const IFC_PARSE_TIMEOUT_MS = 30_000;

/**
 * Parse an IFC ArrayBuffer into Three.js geometry via a Web Worker.
 *
 * The worker does all WASM work; this function just orchestrates the request/response,
 * enforces a timeout, and reassembles BufferGeometry / Mesh / Group on the main thread.
 *
 * Geometry only — BIM properties (types, quantities, classifications) are intentionally
 * discarded. 0studio treats IFC as a visual bridge for Revit, not a BIM property store.
 */
export async function loadIfcFile(buffer: ArrayBuffer, fileName: string): Promise<LoadedIfcModel> {
  const response = await parseInWorker(buffer);
  const fileSize = buffer.byteLength;

  const group = new THREE.Group();
  group.name = fileName;

  for (const mesh of response.meshes) {
    group.add(buildMesh(mesh));
  }

  // Orient to match the rhino3dm-service convention: Y-up. web-ifc outputs Y-up for
  // IFC4 coordinate systems, so no explicit rotation is needed here.

  const metadata: IfcMetadata = {
    kind: 'ifc',
    fileName,
    fileSize,
    objectCount: response.meshCount,
    meshCount: response.meshCount,
    triangleCount: response.triangleCount,
  };

  return { objects: [group], metadata };
}

/**
 * Build the absolute URL the worker should use when fetching web-ifc.wasm. Works in:
 *   - Vite dev (`http://localhost:5173/web-ifc/`)
 *   - Browser prod (`https://app.example.com/web-ifc/`)
 *   - Packaged Electron (`file:///path/to/app.asar/dist/web-ifc/`)
 * We resolve against window.location.href so the prefix tracks whatever protocol
 * + base the app is actually loaded under.
 */
function resolveWasmPath(): string {
  return new URL('./web-ifc/', window.location.href).href;
}

function parseInWorker(buffer: ArrayBuffer): Promise<IfcWorkerResponse> {
  return new Promise((resolve, reject) => {
    const worker = new IfcWorker();
    let settled = false;

    // Timeout fires if web-ifc gets stuck. We terminate() rather than letting it linger
    // because a runaway worker can still consume gigabytes of RAM.
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error(`IFC parsing exceeded ${IFC_PARSE_TIMEOUT_MS / 1000}s timeout — file may be malformed or too large`));
    }, IFC_PARSE_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent<IfcWorkerResponse | IfcWorkerError>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const data = event.data;
      // Always terminate: we deliberately create + dispose per parse rather than reusing
      // workers, so a WASM crash or memory leak can't accumulate across sessions.
      worker.terminate();
      if (data.type === 'error') {
        reject(new Error(`IFC parse failed: ${data.message}`));
        return;
      }
      resolve(data);
    };

    worker.onerror = (event) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`IFC worker crashed: ${event.message || 'unknown error'}`));
    };

    // We COPY the buffer via slice() and transfer the copy instead of the caller's
    // original. ArrayBuffer transfer detaches the source — if we transferred `buffer`
    // directly, the caller (importFile) wouldn't be able to use it for commit storage
    // after parsing. A slice is a memcpy (~GB/s) so the cost is negligible compared to
    // the WASM parse itself.
    const copy = buffer.slice(0);
    worker.postMessage({ type: 'parse', buffer: copy, wasmPath: resolveWasmPath() }, [copy]);
  });
}

function buildMesh(transport: IfcMeshTransport): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(transport.positions, 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(transport.normals, 3));
  geometry.setIndex(new THREE.BufferAttribute(transport.indices, 1));

  // web-ifc hands back a 4x4 column-major transform. Three.js Matrix4 is also column-major
  // but accepts row-major via fromArray — .set() with the 16 values in column-major order
  // is the most explicit form.
  const matrix = new THREE.Matrix4();
  matrix.fromArray(transport.transform);

  // DoubleSide: Revit IFC exports frequently have inverted / missing normals on complex
  // families. DoubleSide trades a small render cost for correct visibility without manual
  // normal cleanup.
  const material = new THREE.MeshStandardMaterial({
    color: new THREE.Color(transport.color.r, transport.color.g, transport.color.b),
    opacity: transport.color.a,
    transparent: transport.color.a < 1,
    side: THREE.DoubleSide,
    metalness: 0.1,
    roughness: 0.75,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.applyMatrix4(matrix);
  mesh.userData = { expressID: transport.expressID, objectType: 'IfcElement' };
  return mesh;
}
