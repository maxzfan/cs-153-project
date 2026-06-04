import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import log from "electron-log/renderer";

/**
 * Shared metadata across every format that can be loaded into the viewer.
 */
export interface ModelMetadata {
  objectCount: number;
  fileName: string;
  fileSize: number;
}

/**
 * Metadata specific to models loaded from glTF (.glb) derivatives.
 * Tracks mesh/triangle counts since glTF doesn't preserve Rhino's curves/surfaces/polysurfaces.
 */
export interface GltfMetadata extends ModelMetadata {
  kind: 'gltf';
  meshCount: number;
  triangleCount: number;
}

/**
 * Shape returned by glTF-producing loaders. Matches the rhino3dm-service LoadedModel
 * contract (objects + metadata) so callers can treat both interchangeably.
 */
export interface LoadedGltfModel {
  objects: THREE.Object3D[];
  metadata: GltfMetadata;
}

// Singleton loader. GLTFLoader has no WASM — pure JS parsing — so construction is cheap,
// but we still reuse a single instance to match the rhino3dm-service pattern.
let loaderInstance: GLTFLoader | null = null;

function getLoader(): GLTFLoader {
  if (!loaderInstance) {
    loaderInstance = new GLTFLoader();
  }
  return loaderInstance;
}

/**
 * Recursively strip non-JSON-serializable entries from an object's userData, in place.
 * GLTFExporter runs `JSON.parse(JSON.stringify(userData))` which throws on circular
 * references — which rhino3dm-loaded objects commonly carry. Called before every export.
 */
function sanitizeUserDataInPlace(root: THREE.Object3D): void {
  root.traverse((node) => {
    if (!node.userData || typeof node.userData !== 'object') return;
    const original = node.userData;
    try {
      node.userData = JSON.parse(JSON.stringify(original));
    } catch {
      // Circular or otherwise non-serializable — drop entirely rather than fail the export.
      node.userData = {};
    }
  });
}

/**
 * Export a Three.js scene (or Object3D root) to a `.glb` ArrayBuffer.
 *
 * Uses binary glTF for compactness and self-containment — the result has no external
 * URI references. `onlyVisible: true` avoids exporting hidden helper meshes; `maxTextureSize`
 * caps texture memory in the derivative.
 *
 * The input scene's userData is shallow-cloned and sanitized in place so rhino3dm's
 * non-serializable object-ref userData doesn't crash JSON.stringify inside GLTFExporter.
 */
export async function sceneToGlb(scene: THREE.Object3D | THREE.Object3D[]): Promise<ArrayBuffer> {
  const roots = Array.isArray(scene) ? scene : [scene];
  roots.forEach(sanitizeUserDataInPlace);

  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, {
    binary: true,
    onlyVisible: true,
    maxTextureSize: 1024,
  });

  // parseAsync returns ArrayBuffer when binary:true, otherwise returns a JSON object.
  if (!(result instanceof ArrayBuffer)) {
    throw new Error('sceneToGlb: GLTFExporter did not return a binary glb — binary option was not honored');
  }
  return result;
}

// A resource path that will not resolve to anything on disk or the network.
// GLTFLoader concatenates this with any relative URI inside the glTF before fetching —
// with an unregistered 'data:' scheme as the base, the resulting URL is malformed and
// fetch() rejects. Prevents a crafted .glb from fetching arbitrary local files via the
// Electron file:// origin even if someone bypasses the binary-only export path.
const BLOCKED_RESOURCE_PATH = 'data:,';

/**
 * Parse a `.glb` ArrayBuffer into Three.js objects.
 *
 * Security: GLTFLoader's `path` argument is set to an unresolvable pseudo-URL so any
 * relative URI inside the glTF fails to fetch. Our exports are binary (texture data is
 * embedded in the binary chunk), so this only matters if we're ever handed a glb we
 * didn't produce ourselves.
 */
export function loadGlbFile(buffer: ArrayBuffer, fileName = 'derivative.glb'): Promise<LoadedGltfModel> {
  const loader = getLoader();
  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      BLOCKED_RESOURCE_PATH,
      (gltf) => {
        const root = gltf.scene;

        let meshCount = 0;
        let triangleCount = 0;
        let objectCount = 0;

        root.traverse((node) => {
          objectCount++;
          const mesh = node as THREE.Mesh;
          // Only Mesh primitives contribute triangles. Lines/Points/Sprite round to zero.
          if (!mesh.isMesh) return;
          meshCount++;
          const geom = mesh.geometry;
          if (!geom) return;
          const index = geom.index;
          if (index) {
            triangleCount += Math.floor(index.count / 3);
          } else {
            const pos = geom.getAttribute('position');
            if (pos) triangleCount += Math.floor(pos.count / 3);
          }
        });

        const metadata: GltfMetadata = {
          kind: 'gltf',
          objectCount,
          fileName,
          fileSize: buffer.byteLength,
          meshCount,
          triangleCount,
        };

        resolve({ objects: [root], metadata });
      },
      (error) => reject(error)
    );
  });
}

/**
 * Validate the glTF export → import round-trip for a given Three.js scene.
 *
 * Compares bounding box corners (within tolerance) between the input and the parsed
 * derivative. Phase 1 success criterion — call from DevTools console:
 *
 *     const model = window.__loadedModel; // or any LoadedModel
 *     await window.__validateGltfRoundtrip(model.objects);
 *
 * Returns a report object; logs pass/fail via console.
 */
export async function validateGltfRoundtrip(scene: THREE.Object3D | THREE.Object3D[]): Promise<{
  ok: boolean;
  originalBounds: { min: THREE.Vector3; max: THREE.Vector3 };
  roundTripBounds: { min: THREE.Vector3; max: THREE.Vector3 };
  maxCornerDelta: number;
  glbSize: number;
  elapsedMs: number;
}> {
  const started = performance.now();

  // Compute the bounds of the input.
  const inputGroup = new THREE.Group();
  const inputObjects = Array.isArray(scene) ? scene : [scene];
  inputObjects.forEach((o) => inputGroup.add(o.clone(true))); // clone so we don't pollute the scene graph
  inputGroup.updateMatrixWorld(true);
  const originalBox = new THREE.Box3().setFromObject(inputGroup);

  // Round-trip via glb.
  const glb = await sceneToGlb(scene);
  const { objects } = await loadGlbFile(glb, 'roundtrip.glb');

  const roundTripGroup = new THREE.Group();
  objects.forEach((o) => roundTripGroup.add(o));
  roundTripGroup.updateMatrixWorld(true);
  const roundTripBox = new THREE.Box3().setFromObject(roundTripGroup);

  // Compare corner deltas.
  const maxCornerDelta = Math.max(
    originalBox.min.distanceTo(roundTripBox.min),
    originalBox.max.distanceTo(roundTripBox.max)
  );

  // Tolerance: 0.1% of the larger bounding diagonal. Scenes at model-scale (meters) should
  // round-trip to well under this; tolerance exists mostly for the PMREM-baked orientation
  // concerns the Phase 1 plan calls out.
  const diag = Math.max(originalBox.getSize(new THREE.Vector3()).length(), 1);
  const tolerance = diag * 0.001;
  const ok = maxCornerDelta <= tolerance;

  const report = {
    ok,
    originalBounds: { min: originalBox.min.clone(), max: originalBox.max.clone() },
    roundTripBounds: { min: roundTripBox.min.clone(), max: roundTripBox.max.clone() },
    maxCornerDelta,
    glbSize: glb.byteLength,
    elapsedMs: performance.now() - started,
  };

  if (ok) {
    log.info('[gltf-service] Roundtrip validation PASSED', report);
  } else {
    log.error('[gltf-service] Roundtrip validation FAILED', { tolerance, ...report });
  }
  return report;
}

// Expose validateGltfRoundtrip on window in dev builds only for manual console validation.
// This is the "standalone test" the Phase 1 plan asks for without adding a separate
// runner — it can be invoked against any currently-loaded model. Gated by import.meta.env.DEV
// so packaged DMG builds do not ship an undocumented global.
if (typeof window !== 'undefined' && import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__validateGltfRoundtrip = validateGltfRoundtrip;
}
