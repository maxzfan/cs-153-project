import * as THREE from "three";
import { Rhino3dmLoader } from "three/examples/jsm/loaders/3DMLoader.js";

// Singleton loader instance
let loaderInstance: Rhino3dmLoader | null = null;

/**
 * Get or create the Rhino3dm loader with proper library path
 */
export function getLoader(): Rhino3dmLoader {
  if (!loaderInstance) {
    loaderInstance = new Rhino3dmLoader();
    // Use CDN for rhino3dm library - this loads both the JS and WASM
    loaderInstance.setLibraryPath("./rhino3dm/");
  }
  return loaderInstance;
}

/**
 * Load a .3dm file and convert it to Three.js objects
 */
export async function load3dmFile(
  file: File
): Promise<{ objects: THREE.Object3D[]; metadata: Rhino3dmMetadata }> {
  const loader = getLoader();
  const buffer = await file.arrayBuffer();

  return new Promise((resolve, reject) => {
    loader.parse(
      buffer,
      (object) => {
        // Count objects
        let meshCount = 0;
        let lineCount = 0;
        let pointsCount = 0;

        object.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            meshCount++;
            // Ensure materials are properly set up
            if (child.material) {
              const mat = child.material as THREE.Material;
              if (mat instanceof THREE.MeshStandardMaterial || 
                  mat instanceof THREE.MeshPhysicalMaterial) {
                mat.side = THREE.DoubleSide;
                // Ensure the material color isn't black
                if (mat.color.r < 0.1 && mat.color.g < 0.1 && mat.color.b < 0.1) {
                  mat.color.setHex(0xcccccc);
                }
                mat.needsUpdate = true;
              }
            }
          } else if (child instanceof THREE.Line) {
            lineCount++;
          } else if (child instanceof THREE.Points) {
            pointsCount++;
          }
        });

        // Convert from Rhino's Z-up coordinate system to Three.js Y-up
        // Rhino: X=right, Y=forward, Z=up (model bottom at negative Z)
        // Three.js: X=right, Y=up, Z=backward (model bottom at negative Y)
        // Rotate -90° around X-axis: Z→Y, Y→Z (converts coordinate system)
        // Then rotate 180° around Y-axis to flip it vertically so bottom stays on bottom
        object.rotateX(-Math.PI / 2);
        object.rotateY(Math.PI); // Flip 180° to correct vertical orientation
        
        // Return the entire parsed object - it's already a proper Three.js group
        // This preserves all transforms and hierarchy, with coordinate system conversion applied
        const objects: THREE.Object3D[] = [object];
        
        const metadata: Rhino3dmMetadata = {
          objectCount: meshCount + lineCount + pointsCount,
          fileName: file.name,
          fileSize: file.size,
        };

        resolve({ objects, metadata });
      },
      (error) => {
        reject(error);
      }
    );
  });
}

// Singleton for rhino3dm module loaded from CDN
let rhinoModule: any = null;

// R8: WASM compilation cache — persists compiled WebAssembly.Module across sessions
// so rhino3dm doesn't recompile on every file open. Bump WASM_CACHE_VERSION when
// upgrading the rhino3dm package to invalidate the stale compiled module.
const WASM_CACHE_DB = 'rhino3dm-wasm';
const WASM_CACHE_STORE = 'modules';
const WASM_MODULE_KEY = 'compiled';
const WASM_CACHE_VERSION = 1; // bump when rhino3dm version changes

function openWasmCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(WASM_CACHE_DB, WASM_CACHE_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      // Recreate store on version bump to evict stale compiled modules
      if (db.objectStoreNames.contains(WASM_CACHE_STORE)) {
        db.deleteObjectStore(WASM_CACHE_STORE);
      }
      db.createObjectStore(WASM_CACHE_STORE);
    };
    req.onsuccess = (e) => resolve((e.target as IDBOpenDBRequest).result);
    req.onerror = () => reject(req.error);
  });
}

async function getCachedWasmModule(): Promise<WebAssembly.Module | null> {
  try {
    const db = await openWasmCacheDb();
    return new Promise((resolve) => {
      const tx = db.transaction(WASM_CACHE_STORE, 'readonly');
      const req = tx.objectStore(WASM_CACHE_STORE).get(WASM_MODULE_KEY);
      req.onsuccess = () => resolve((req.result as WebAssembly.Module) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

function saveWasmModule(module: WebAssembly.Module): void {
  // Fire-and-forget; failure is non-fatal — next session just recompiles
  openWasmCacheDb().then((db) => {
    const tx = db.transaction(WASM_CACHE_STORE, 'readwrite');
    tx.objectStore(WASM_CACHE_STORE).put(module, WASM_MODULE_KEY);
  }).catch(() => {});
}

/**
 * Load rhino3dm, using a cached compiled WebAssembly.Module when available.
 *
 * On first load: monkey-patches WebAssembly.instantiate/instantiateStreaming to
 * capture the compiled Module after Emscripten compiles it, then saves it to IndexedDB.
 *
 * On subsequent loads: patches the same methods to skip recompilation by handing
 * Emscripten the pre-compiled Module from IndexedDB.
 *
 * The patches are scoped to this function call and always restored in a finally block.
 */
async function getRhino3dm(): Promise<any> {
  if (rhinoModule) {
    return rhinoModule;
  }

  // Load the script if not already present
  if (!(window as any).rhino3dm) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "./rhino3dm/rhino3dm.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Failed to load rhino3dm"));
      document.head.appendChild(script);
    });
  }

  if (!(window as any).rhino3dm) {
    throw new Error("rhino3dm failed to initialize");
  }

  // R8: Try to serve compiled module from cache to skip WASM recompilation
  const cachedModule = await getCachedWasmModule();
  let capturedModule: WebAssembly.Module | null = null;

  const origInstantiate = WebAssembly.instantiate;
  const origInstantiateStreaming = WebAssembly.instantiateStreaming;

  if (cachedModule) {
    // Patch: skip compilation by returning the cached Module to Emscripten
    (WebAssembly as any).instantiate = async (
      source: BufferSource | WebAssembly.Module,
      importObject?: WebAssembly.Imports
    ) => {
      if (source instanceof WebAssembly.Module) {
        // Already a Module (Emscripten second-pass) — delegate to original
        return origInstantiate(source, importObject as any);
      }
      // BufferSource path: skip compilation, instantiate from cached module
      const instance = await origInstantiate(cachedModule, importObject as any);
      return { module: cachedModule, instance };
    };
    (WebAssembly as any).instantiateStreaming = async (
      _source: Response | Promise<Response>,
      importObject?: WebAssembly.Imports
    ) => {
      const instance = await origInstantiate(cachedModule, importObject as any);
      return { module: cachedModule, instance };
    };
  } else {
    // Patch: capture the compiled Module so we can cache it for next session
    (WebAssembly as any).instantiate = async (
      source: BufferSource | WebAssembly.Module,
      importObject?: WebAssembly.Imports
    ) => {
      const result = await origInstantiate(source as any, importObject as any);
      if (!capturedModule && result && typeof result === 'object' && result.module instanceof WebAssembly.Module) {
        capturedModule = result.module;
      }
      return result;
    };
    (WebAssembly as any).instantiateStreaming = async (
      source: Response | Promise<Response>,
      importObject?: WebAssembly.Imports
    ) => {
      const result = await origInstantiateStreaming(source as any, importObject as any);
      if (!capturedModule && result.module instanceof WebAssembly.Module) {
        capturedModule = result.module;
      }
      return result;
    };
  }

  try {
    rhinoModule = await (window as any).rhino3dm();
  } finally {
    // Always restore globals — do not leave patched WebAssembly methods in place
    WebAssembly.instantiate = origInstantiate;
    WebAssembly.instantiateStreaming = origInstantiateStreaming;
  }

  // Persist the captured module for future sessions (fire-and-forget)
  if (!cachedModule && capturedModule) {
    saveWasmModule(capturedModule);
  }

  return rhinoModule;
}

/**
 * Export LoadedModel to ArrayBuffer (.3dm file buffer)
 */
export async function exportModelToBuffer(modelData: { objects: THREE.Object3D[]; metadata: Rhino3dmMetadata }): Promise<ArrayBuffer> {
  const rhino = await getRhino3dm();
  const doc = new rhino.File3dm();

  // Traverse all objects and convert meshes
  modelData.objects.forEach(rootObject => {
    rootObject.traverse((child) => {
      if (child instanceof THREE.Mesh && child.geometry) {
        const rhinoMesh = threeMeshToRhinoMesh(rhino, child);
        if (rhinoMesh) {
          const attributes = new rhino.ObjectAttributes();
          attributes.name = child.name || "Mesh";

          // Set color from material
          if (child.material instanceof THREE.MeshStandardMaterial) {
            const color = child.material.color;
            attributes.objectColor = {
              r: Math.round(color.r * 255),
              g: Math.round(color.g * 255),
              b: Math.round(color.b * 255),
              a: 255,
            };
            attributes.colorSource = rhino.ObjectColorSource.ColorFromObject;
          }

          doc.objects().add(rhinoMesh, attributes);
          rhinoMesh.delete();
        }
      }
    });
  });

  // Convert to byte array
  const buffer = doc.toByteArray();

  // Create a proper ArrayBuffer copy
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(buffer);

  doc.delete();
  return arrayBuffer;
}

/**
 * Export Three.js scene to a .3dm file
 */
export async function exportTo3dm(
  scene: THREE.Object3D,
  filename: string = "export.3dm"
): Promise<void> {
  // Load rhino3dm from CDN
  const rhino = await getRhino3dm();

  const doc = new rhino.File3dm();

  // Traverse the scene and convert meshes
  scene.traverse((child) => {
    if (child instanceof THREE.Mesh && child.geometry) {
      const rhinoMesh = threeMeshToRhinoMesh(rhino, child);
      if (rhinoMesh) {
        const attributes = new rhino.ObjectAttributes();
        attributes.name = child.name || "Mesh";

        // Set color from material
        if (child.material instanceof THREE.MeshStandardMaterial) {
          const color = child.material.color;
          attributes.objectColor = {
            r: Math.round(color.r * 255),
            g: Math.round(color.g * 255),
            b: Math.round(color.b * 255),
            a: 255,
          };
          attributes.colorSource = rhino.ObjectColorSource.ColorFromObject;
        }

        doc.objects().add(rhinoMesh, attributes);
        rhinoMesh.delete();
      }
    }
  });

  // Convert to byte array and trigger download
  const buffer = doc.toByteArray();

  // Create a proper ArrayBuffer copy for Blob
  const arrayBuffer = new ArrayBuffer(buffer.length);
  const view = new Uint8Array(arrayBuffer);
  view.set(buffer);

  const blob = new Blob([arrayBuffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".3dm") ? filename : `${filename}.3dm`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
  doc.delete();
}

/**
 * Convert a Three.js mesh to a Rhino mesh
 */
function threeMeshToRhinoMesh(rhino: any, threeMesh: THREE.Mesh): any | null {
  try {
    const geometry = threeMesh.geometry;

    if (!geometry.attributes.position) {
      return null;
    }

    const rhinoMesh = new rhino.Mesh();
    const positions = geometry.attributes.position;

    // Apply world matrix to get correct positions
    const worldMatrix = threeMesh.matrixWorld;
    const tempVector = new THREE.Vector3();

    // Add vertices
    for (let i = 0; i < positions.count; i++) {
      tempVector.fromBufferAttribute(positions, i);
      tempVector.applyMatrix4(worldMatrix);
      rhinoMesh.vertices().add(tempVector.x, tempVector.y, tempVector.z);
    }

    // Add faces using addTriFace (correct API for rhino3dm v8+)
    if (geometry.index) {
      const indices = geometry.index;
      for (let i = 0; i < indices.count; i += 3) {
        rhinoMesh
          .faces()
          .addTriFace(indices.getX(i), indices.getX(i + 1), indices.getX(i + 2));
      }
    } else {
      // Non-indexed geometry
      for (let i = 0; i < positions.count; i += 3) {
        rhinoMesh.faces().addTriFace(i, i + 1, i + 2);
      }
    }

    // Compute normals
    rhinoMesh.normals().computeNormals();
    rhinoMesh.compact();

    return rhinoMesh;
  } catch {
    return null;
  }
}

/**
 * Metadata returned when loading a 3DM file
 */
export interface Rhino3dmMetadata {
  objectCount: number;
  fileName: string;
  fileSize: number;
}

/**
 * Dispose of the loader and free resources
 */
export function disposeLoader(): void {
  if (loaderInstance) {
    loaderInstance.dispose();
    loaderInstance = null;
  }
}
