import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import React, { useRef, useState, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useTheme } from "next-themes";
import * as THREE from "three";
import { X, FileBox, Camera, Check } from "lucide-react";
import { useModel, SceneStats, GeneratedObject, LoadedModel } from "@/contexts/ModelContext";
import { useVersionControl } from "@/contexts/VersionControlContext";
import { useGallery } from "@/contexts/GalleryContext";
import { useDesktopAPI, desktopAPI } from "@/lib/desktop-api";
import { TooltipProvider } from "@/components/ui/tooltip";
import WelcomePanel from "@/components/WelcomePanel";
import log from "electron-log/renderer";

// Dispose Three.js material and any textures it references.
function disposeMaterial(mat: THREE.Material): void {
  const m = mat as unknown as Record<string, unknown>;
  for (const key of Object.keys(m)) {
    const v = m[key];
    if (v && typeof v === 'object' && (v as { isTexture?: boolean }).isTexture) {
      (v as THREE.Texture).dispose();
    }
  }
  mat.dispose();
}

// Dispose all GPU resources for a LoadedModel. Only call on models the caller owns —
// do NOT call on models shared with other contexts (e.g. commit.modelData held by VersionControl).
function disposeLoadedModel(model: LoadedModel): void {
  for (const obj of model.objects) {
    obj.traverse((node) => {
      const mesh = node as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const mat = mesh.material;
      if (Array.isArray(mat)) mat.forEach(disposeMaterial);
      else if (mat) disposeMaterial(mat);
    });
  }
}

function DefaultCube() {
  return (
    <mesh>
      <boxGeometry args={[2, 2, 2]} />
      <meshStandardMaterial color="#888888" metalness={0.3} roughness={0.7} />
    </mesh>
  );
}

/**
 * Calculates the camera distance needed to fit a bounding box in the viewport
 * Uses the bounding sphere approach for reliable fitting from any angle
 */
function calculateCameraDistance(
  box: THREE.Box3,
  camera: THREE.PerspectiveCamera,
  padding: number = 1.2
): number {
  if (box.isEmpty()) return 10;
  
  // Calculate the bounding box size
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  
  if (maxDim === 0) return 10;
  
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const aspect = camera.aspect;
  const tanHalfFov = Math.tan(fov / 2);
  
  // Calculate distance needed to fit the largest dimension
  // For a perspective camera: visible height = 2 * d * tan(fov/2)
  // We need: visible height >= maxDim
  // So: d >= maxDim / (2 * tan(fov/2))
  const distanceFromHeight = maxDim / (2 * tanHalfFov);
  const distanceFromWidth = maxDim / (2 * tanHalfFov * aspect);
  
  // Use the larger distance to ensure the model fits in both dimensions
  const distance = Math.max(distanceFromHeight, distanceFromWidth);
  
  // Apply padding and ensure minimum distance
  return Math.max(0.1, distance * padding);
}

/**
 * Positions the camera to view the model fit to screen
 * Uses a consistent isometric-like angle, but looks at the model's actual center
 * This preserves the original Rhino orientation
 */
function fitCameraToModel(
  camera: THREE.PerspectiveCamera,
  box: THREE.Box3,
  controls?: { target: THREE.Vector3; update: () => void } | null,
  modelCenter?: THREE.Vector3
): void {
  const center = modelCenter || box.getCenter(new THREE.Vector3());
  
  if (box.isEmpty()) {
    camera.position.set(center.x + 5, center.y + 5, center.z + 8);
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    return;
  }
  
  // Calculate optimal distance to fit the bounding box
  // Use padding of ~2.0 to make model take up ~60% of viewport instead of filling it
  const distance = calculateCameraDistance(box, camera, 2.0);
  
  // Use a consistent camera angle: 45° elevation, 45° azimuth
  // This creates an isometric-like view that's consistent across all models
  const elevation = Math.PI / 4; // 45 degrees
  const azimuth = Math.PI / 4;   // 45 degrees
  
  // Calculate position on a sphere around the model's center (not origin)
  const x = center.x + distance * Math.cos(elevation) * Math.cos(azimuth);
  const y = center.y + distance * Math.sin(elevation);
  const z = center.z + distance * Math.cos(elevation) * Math.sin(azimuth);
  
  camera.position.set(x, y, z);
  camera.lookAt(center);
  camera.updateProjectionMatrix();
  
  // Update controls to look at model center (preserving original position)
  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

function LoadedObjects({ objects, onScaleChange }: { objects: THREE.Object3D[]; onScaleChange?: (scale: number) => void }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, controls } = useThree();
  
  // Cast controls to access OrbitControls methods (drei's OrbitControls sets this)
  const orbitControls = controls as unknown as { target: THREE.Vector3; update: () => void } | null;

  useLayoutEffect(() => {
    if (groupRef.current && objects.length > 0) {
      // Clear existing children
      while (groupRef.current.children.length > 0) {
        groupRef.current.remove(groupRef.current.children[0]);
      }

      // Add new objects
      objects.forEach((obj, index) => {
        const clonedObj = obj.clone();
        
        // Make sure materials are visible
        clonedObj.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            if (child.material) {
              const mat = child.material as THREE.MeshStandardMaterial;
              // Ensure material is not pure black
              if (mat.color) {
                const c = mat.color;
                if (c.r < 0.1 && c.g < 0.1 && c.b < 0.1) {
                  mat.color.setHex(0xaaaaaa);
}
              }
              mat.needsUpdate = true;
            }
          }
        });
        
        groupRef.current!.add(clonedObj);
      });

      // Preserve original position, rotation, and scale from Rhino
      // Do NOT reset transforms - this preserves the exact orientation as in Rhino
      
      // Force update the matrix to ensure transforms are applied
      groupRef.current.updateMatrixWorld(true);

      // Calculate bounding box in world space (preserving original transforms)
      const box = new THREE.Box3().setFromObject(groupRef.current);
      
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Calculate model scale for grid adjustment
        const maxDim = Math.max(size.x, size.y, size.z);
        const calculatedScale = maxDim > 0 ? maxDim : 1;
        
        // Notify parent of scale change for grid adjustment
        if (onScaleChange) {
          onScaleChange(calculatedScale);
        }

        // Ensure camera aspect is up to date
        camera.updateProjectionMatrix();
        
        // Position camera to fit the model in view, looking at the model's center
        // This preserves the original orientation while ensuring the model is visible
        fitCameraToModel(camera as THREE.PerspectiveCamera, box, orbitControls, center);
        
      } else {
      }
      
    } else {
    }
  }, [objects, camera, controls]);

  return <group ref={groupRef} />;
}

function GeneratedObjects({ objects }: { objects: GeneratedObject[] }) {
  const groupRef = useRef<THREE.Group>(null);
  const { camera, controls } = useThree();
  
  // Cast controls to access OrbitControls methods
  const orbitControls = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
  
  useLayoutEffect(() => {
    if (!groupRef.current) return;
    
    // Clear existing children
    while (groupRef.current.children.length > 0) {
      groupRef.current.remove(groupRef.current.children[0]);
    }
    
    // Add all generated objects
    objects.forEach((genObj) => {
      groupRef.current!.add(genObj.object);
    });
    
    if (objects.length > 0) {
      // Reset position and scale first
      groupRef.current.position.set(0, 0, 0);
      groupRef.current.scale.set(1, 1, 1);
      groupRef.current.rotation.set(0, 0, 0);

      // Calculate bounding box
      const box = new THREE.Box3().setFromObject(groupRef.current);
      
      if (!box.isEmpty()) {
        const center = box.getCenter(new THREE.Vector3());
        const size = box.getSize(new THREE.Vector3());
        
        // Move group so its center is at origin
        groupRef.current.position.set(-center.x, -center.y, -center.z);
        
        // Force matrix update after positioning
        groupRef.current.updateMatrixWorld(true);

        // Recalculate bounding box after centering for accurate camera positioning
        const centeredBox = new THREE.Box3().setFromObject(groupRef.current);
        const centeredCenter = centeredBox.getCenter(new THREE.Vector3());
        
        // Ensure camera aspect is up to date
        camera.updateProjectionMatrix();
        
        // Position camera to fit the model in view (no scaling - let camera handle fit)
        fitCameraToModel(camera as THREE.PerspectiveCamera, centeredBox, orbitControls, centeredCenter);
      }
    }
    
    return () => {
      // Remove objects from group on cleanup (but don't dispose - context handles that)
      if (groupRef.current) {
        while (groupRef.current.children.length > 0) {
          groupRef.current.remove(groupRef.current.children[0]);
        }
      }
    };
  }, [objects, camera, controls]);
  
  return <group ref={groupRef} />;
}

function GridFloor({ modelScale = 1 }: { modelScale?: number }) {
  // Calculate grid scale based on model scale
  // If model is large, scale grid up proportionally to match
  // Default grid cell size is 1, section size is 10
  const baseCellSize = 1;
  const baseSectionSize = 10;
  
  // Scale grid proportionally to model size
  // Use a power function to get reasonable grid sizes
  // For very large models, we want larger grid cells
  const scaleFactor = Math.pow(modelScale, 0.5); // Square root for smoother scaling
  const cellSize = baseCellSize * scaleFactor;
  const sectionSize = baseSectionSize * scaleFactor;
  
  // Round to nice numbers for grid (powers of 10, or 1, 2, 5, etc.)
  const roundToNiceNumber = (value: number): number => {
    if (value <= 0) return 0.1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
    const normalized = value / magnitude;
    let nice: number;
    if (normalized <= 1) nice = 1;
    else if (normalized <= 2) nice = 2;
    else if (normalized <= 5) nice = 5;
    else nice = 10;
    return nice * magnitude;
  };
  
  const finalCellSize = roundToNiceNumber(Math.max(0.1, Math.min(100, cellSize)));
  const finalSectionSize = roundToNiceNumber(Math.max(1, Math.min(1000, sectionSize)));
  
  return (
    <Grid
      args={[200, 200]}
      cellSize={finalCellSize}
      cellThickness={0.6}
      cellColor="#555555"
      sectionSize={finalSectionSize}
      sectionThickness={0.8}
      sectionColor="#555555"
      fadeDistance={200}
      fadeStrength={1}
      followCamera={false}
      infiniteGrid={true}
      position={[0, -0.01, 0]}
    />
  );
}

function SceneStatsCalculator({
  onStatsUpdate,
  modelObjects,
  generatedObjects,
}: {
  onStatsUpdate: (stats: SceneStats) => void;
  modelObjects: THREE.Object3D[] | null;
  generatedObjects: GeneratedObject[];
}) {
  useEffect(() => {
    const calculateStats = () => {
      let curves = 0;
      let surfaces = 0;
      let polysurfaces = 0;

      // Count objects from the loaded model
      if (modelObjects && modelObjects.length > 0) {
        const objectDetails: string[] = [];
        
        modelObjects.forEach((obj) => {
          obj.traverse((child) => {
            // Get the original Rhino object type from userData
            const objectType = child.userData?.objectType as string | undefined;
            
            if (objectType) {
              switch (objectType) {
                case 'Curve':
                  curves++;
                  objectDetails.push(`Curve: ${child.name || 'unnamed'}`);
                  break;
                case 'Mesh':
                  // A single mesh is a surface
                  surfaces++;
                  objectDetails.push(`Surface (Mesh): ${child.name || 'unnamed'}`);
                  break;
                case 'Brep':
                  // Breps are polysurfaces (boundary representations)
                  polysurfaces++;
                  objectDetails.push(`Polysurface (Brep): ${child.name || 'unnamed'}`);
                  break;
                case 'Extrusion':
                  // Extrusions are also polysurfaces
                  polysurfaces++;
                  objectDetails.push(`Polysurface (Extrusion): ${child.name || 'unnamed'}`);
                  break;
                case 'SubD':
                  // SubD surfaces count as surfaces
                  surfaces++;
                  objectDetails.push(`Surface (SubD): ${child.name || 'unnamed'}`);
                  break;
                default:
                  // Log unknown types for debugging
                  if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
                  }
              }
            }
          });
        });
        
      }

      // Count generated objects as polysurfaces (AI-generated primitives are solid shapes)
      if (generatedObjects.length > 0) {
        polysurfaces += generatedObjects.length;
      }

      onStatsUpdate({ curves, surfaces, polysurfaces });
    };

    calculateStats();
    
    // Recalculate when model or generated objects change
  }, [modelObjects, generatedObjects, onStatsUpdate]);

  return null;
}

// Camera rotation component for idle animation
function CameraRotation() {
  const { camera } = useThree();
  
  useFrame((state, delta) => {
    // Get current camera position
    const radius = Math.sqrt(camera.position.x * camera.position.x + camera.position.z * camera.position.z);
    const currentAngle = Math.atan2(camera.position.z, camera.position.x);
    
    // Rotate around Y axis
    const newAngle = currentAngle + delta * 0.00; // 0.05 rad/sec rotation speed
    
    // Update camera position maintaining the same distance and Y position
    camera.position.x = radius * Math.cos(newAngle);
    camera.position.z = radius * Math.sin(newAngle);
    
    // Keep camera looking at center
    camera.lookAt(0, 0, 0);
  });
  
  return null;
}

// Scene content component that provides export functionality
function SceneContent({
  onSceneReady,
  modelData,
}: {
  onSceneReady: (scene: THREE.Scene) => void;
  modelData?: LoadedModel | null;
}) {
  const { scene } = useThree();
  const { loadedModel: contextModel, generatedObjects, setStats } = useModel();
  const [modelScale, setModelScale] = useState(1);
  
  // Use provided modelData if in gallery mode, otherwise use context model
  const displayModel = modelData !== undefined ? modelData : contextModel;

  useEffect(() => {
    onSceneReady(scene);
  }, [scene, onSceneReady]);

  // Reset scale when model is cleared
  useEffect(() => {
    if (!displayModel) {
      setModelScale(1);
    }
  }, [displayModel]);

  const handleScaleChange = useCallback((scale: number) => {
    setModelScale(scale);
  }, []);

  return (
    <>
      {displayModel && <LoadedObjects objects={displayModel.objects} onScaleChange={handleScaleChange} />}
      {/* Only show generated objects in main view, not in gallery */}
      {modelData === undefined && generatedObjects.length > 0 && <GeneratedObjects objects={generatedObjects} />}
      <GridFloor modelScale={modelScale} />
      <SceneStatsCalculator 
        onStatsUpdate={setStats} 
        modelObjects={displayModel?.objects || null}
        generatedObjects={modelData === undefined ? generatedObjects : []}
      />
    </>
  );
}

export const ModelViewer = () => {
  const { resolvedTheme } = useTheme();
  const viewportBg = resolvedTheme === 'dark' ? '#151413' : '#eae9e8';
  const {
    loadedModel,
    error,
    stats,
    clearError,
    setSceneRef,
    importFile,
    isLoading,
    fileInputRef,
    triggerFileDialog,
  } = useModel();
  
  const { commits, currentCommitId, currentModel, modelName, buildTreeDataForReconstruction } = useVersionControl();
  const { isGalleryMode, selectedCommitIds } = useGallery();

  const [isDragOver, setIsDragOver] = useState(false);
  const [galleryModelData, setGalleryModelData] = useState<Map<string, LoadedModel>>(new Map());
  // Gallery models WE loaded (and thus own for disposal).
  // Models reused from commit.modelData live in galleryModelData but NOT here — they belong to
  // VersionControlContext and must not be disposed by us.
  const galleryOwnedModelsRef = useRef<Map<string, LoadedModel>>(new Map());
  const [snapshotCopied, setSnapshotCopied] = useState(false);

  const handleSnapshotToClipboard = useCallback(async () => {
    if (snapshotCopied) return; // prevent rapid double-click
    try {
      const canvas = document.querySelector('canvas');
      if (!canvas) return;
      const dataUrl = canvas.toDataURL('image/png');
      await desktopAPI.writeImageToClipboard(dataUrl);
      setSnapshotCopied(true);
      setTimeout(() => setSnapshotCopied(false), 2000);
    } catch (err) {
      log.error('Failed to copy snapshot:', err);
    }
  }, [snapshotCopied]);
  
  // Get selected commits for gallery mode (capped at 4).
  // For rendering (stats overlay, tile headers, etc.) — do NOT use as an effect dep.
  const selectedCommits = useMemo(() => {
    if (!isGalleryMode || selectedCommitIds.size === 0) return [];
    const filtered = commits.filter(commit => selectedCommitIds.has(commit.id));
    return filtered.slice(0, 4);
  }, [isGalleryMode, selectedCommitIds, commits]);

  // Latest commits, held in a ref for the gallery load effect so commit metadata
  // updates (star toggle, branch head move) do not trigger gallery re-disposal + reload.
  const commitsRef = useRef(commits);
  useEffect(() => {
    commitsRef.current = commits;
  }, [commits]);

  // Same pattern for the tree-data builder: needed to reconstruct delta commits in
  // the gallery, but its identity changes with every commits/branches update — keep
  // it out of the load-effect deps to avoid full gallery reload on unrelated changes.
  const buildTreeDataRef = useRef(buildTreeDataForReconstruction);
  useEffect(() => {
    buildTreeDataRef.current = buildTreeDataForReconstruction;
  }, [buildTreeDataForReconstruction]);

  // Load model data for selected commits in gallery mode.
  // Disposes GPU resources for previously-loaded (owned) entries before replacing.
  //
  // Deps use selectedCommitIds (stable across commit metadata changes) and read commits
  // from a ref — otherwise every star-toggle or branch-head move would re-dispose and
  // re-parse the entire gallery.
  useEffect(() => {
    const disposeOwned = () => {
      galleryOwnedModelsRef.current.forEach((model) => disposeLoadedModel(model));
      galleryOwnedModelsRef.current = new Map();
    };

    if (!isGalleryMode || selectedCommitIds.size === 0) {
      disposeOwned();
      setGalleryModelData(new Map());
      return;
    }

    let cancelled = false;
    const newOwnedModels = new Map<string, LoadedModel>();

    const abort = () => {
      newOwnedModels.forEach((model) => disposeLoadedModel(model));
    };

    const loadCommitModels = async () => {
      const commitsForGallery = commitsRef.current
        .filter(c => selectedCommitIds.has(c.id))
        .slice(0, 4);
      const newModelData = new Map<string, LoadedModel>();

      for (const commit of commitsForGallery) {
        if (cancelled) return abort();

        if (commit.modelData) {
          // Reused from VersionControlContext — not ours to dispose
          newModelData.set(commit.id, commit.modelData);
          continue;
        }

        try {
          const { desktopAPI } = await import('@/lib/desktop-api');
          const { load3dmFile } = await import('@/lib/rhino3dm-service');

          if (desktopAPI.isDesktop && currentModel) {
            // Delta commits live as .delta files on disk; readCommitFile only finds
            // .3dm/.rvt/.ifc, so we must reconstruct first. Mirrors restoreToCommit's
            // priority order (see VersionControlContext).
            let fileBuffer: ArrayBuffer | null = null;
            if (commit.storageType === 'delta') {
              const treeData = buildTreeDataRef.current();
              fileBuffer = await desktopAPI.reconstructCommit(currentModel, commit.id, treeData);
              if (cancelled) return abort();
            }
            if (!fileBuffer) {
              fileBuffer = await desktopAPI.readCommitFile(currentModel, commit.id);
              if (cancelled) return abort();
            }
            if (fileBuffer) {
              const file = new File([fileBuffer], modelName || 'model.3dm', { type: 'application/octet-stream' });
              const loaded = await load3dmFile(file);
              newOwnedModels.set(commit.id, loaded);
              if (cancelled) return abort();
              newModelData.set(commit.id, loaded);
            }
          } else if (commit.fileBuffer) {
            const file = new File([commit.fileBuffer], modelName || 'model.3dm', { type: 'application/octet-stream' });
            const loaded = await load3dmFile(file);
            newOwnedModels.set(commit.id, loaded);
            if (cancelled) return abort();
            newModelData.set(commit.id, loaded);
          }
        } catch {
          // Load errors render as empty tiles
        }
      }

      if (cancelled) return abort();

      disposeOwned();
      galleryOwnedModelsRef.current = newOwnedModels;
      setGalleryModelData(newModelData);
    };

    loadCommitModels();

    return () => {
      cancelled = true;
    };
  }, [isGalleryMode, selectedCommitIds, currentModel, modelName]);

  // Safety check for stats - provide default values if undefined
  const safeStats = stats || { curves: 0, surfaces: 0, polysurfaces: 0 };

  const handleSceneReady = useCallback((scene: THREE.Scene) => {
    setSceneRef(scene);
  }, [setSceneRef]);

  // Handle file input change
  const handleFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        importFile(file);
        // Clear the input to allow re-importing the same file
        event.target.value = "";
      }
    },
    [importFile]
  );

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (e.relatedTarget === null || !e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);

      const files = Array.from(e.dataTransfer.files);
      const file = files.find((f) => {
        const n = f.name.toLowerCase();
        return n.endsWith('.3dm') || n.endsWith('.rvt') || n.endsWith('.ifc');
      });

      if (file) {
        importFile(file);
      }
    },
    [importFile]
  );





  return (
    <TooltipProvider>
      <div 
        className="h-full flex flex-col panel-glass relative"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".3dm,.rvt,.ifc"
          onChange={handleFileInputChange}
          className="hidden"
        />

        {/* Drag overlay */}
        {isDragOver && (
          <div className="absolute inset-0 z-50 bg-primary/20 border-2 border-dashed border-primary rounded-lg flex items-center justify-center backdrop-blur-sm">
            <div className="text-center">
              <FileBox className="w-12 h-12 text-primary mx-auto mb-2" />
              <p className="text-lg font-medium text-primary">Drop 3D model here</p>
              <p className="text-xs text-muted-foreground mt-1">Accepts .3dm, .rvt, .ifc</p>
            </div>
          </div>
        )}

        {/* Empty state - Cursor-style welcome panel */}
        {!loadedModel && !isLoading && (
          <WelcomePanel
            triggerFileDialog={triggerFileDialog}
            onDragDropHint="Drag & drop a .3dm, .rvt, or .ifc file to open"
          />
        )}

        {/* Loading state */}
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/50 backdrop-blur-sm">
            <div className="text-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
              <p className="text-sm text-muted-foreground">Loading model...</p>
            </div>
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="absolute top-14 left-3 right-3 z-10 flex items-center gap-2 px-3 py-2 bg-destructive/20 border border-destructive/50 rounded-md">
            <span className="text-xs text-destructive">{error}</span>
            <button
              onClick={clearError}
              className="ml-auto text-destructive hover:text-destructive/80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Canvas - Gallery mode or single view */}
        {isGalleryMode && selectedCommits.length > 0 ? (
          <div 
            key={`gallery-${selectedCommits.length}`}
            className="flex-1 relative grid gap-2 p-2" 
            style={{
              gridTemplateColumns: selectedCommits.length === 1 ? '1fr' : 'repeat(2, 1fr)',
              gridTemplateRows: 
                selectedCommits.length === 1 
                  ? '1fr' 
                  : selectedCommits.length === 2 
                  ? '1fr' 
                  : 'repeat(2, 1fr)',
            }}
          >
            {selectedCommits.map((commit, index) => {
              // Determine grid layout based on number of commits
              const count = selectedCommits.length;
              let gridStyle: React.CSSProperties = {};
              
              if (count === 1) {
                // 1 commit: full width (no explicit positioning needed)
                gridStyle = {};
              } else if (count === 2) {
                // 2 commits: side by side in row 1
                gridStyle = {
                  gridRow: '1',
                  gridColumn: index === 0 ? '1' : '2',
                };
              } else if (count === 3) {
                // 3 commits: 2 on top, 1 centered on bottom
                if (index < 2) {
                  // First two commits in top row
                  gridStyle = {
                    gridRow: '1',
                    gridColumn: index === 0 ? '1' : '2',
                  };
                } else {
                  // Third commit spans both columns in row 2, taking full width
                  gridStyle = { 
                    gridRow: '2',
                    gridColumn: '1 / -1',
                  };
                }
              } else if (count === 4) {
                // 4 commits: 2x2 grid
                const row = Math.floor(index / 2) + 1; // 1 or 2
                const col = (index % 2) + 1; // 1 or 2
                gridStyle = {
                  gridRow: `${row}`,
                  gridColumn: `${col}`,
                };
              }
              
              return (
                <div 
                  key={commit.id} 
                  className="relative border border-border rounded-md overflow-hidden bg-background"
                  style={gridStyle}
                >
                  <div className="absolute top-2 left-2 z-10 bg-background/80 backdrop-blur-sm px-2 py-1 rounded text-xs font-medium">
                    {commit.message}
                  </div>
                  <Canvas
                    camera={{ position: [5, 5, 8], fov: 50 }}
                    dpr={[1, 2]}
                    gl={{ antialias: true, alpha: true }}
                  >
                    <color attach="background" args={[viewportBg]} />
                    <ambientLight intensity={0.8} />
                    <directionalLight
                      position={[10, 10, 10]}
                      intensity={1.5}
                      color="#ffffff"
                      castShadow
                    />
                    <directionalLight
                      position={[-10, -5, -10]}
                      intensity={0.8}
                      color="#ffffff"
                    />
                    <directionalLight
                      position={[0, -10, 0]}
                      intensity={0.5}
                      color="#ffffff"
                    />
                    <hemisphereLight
                      args={["#ffffff", "#444444", 0.6]}
                    />
                    <SceneContent onSceneReady={() => {}} modelData={galleryModelData.get(commit.id) || commit.modelData || null} />
                    <OrbitControls
                      enablePan={true}
                      enableZoom={true}
                      enableRotate={true}
                      enableDamping={true}
                      dampingFactor={0.05}
                      minDistance={0.5}
                      maxDistance={200}
                      makeDefault
                    />
                  </Canvas>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 relative">
            <Canvas
              key={loadedModel ? `canvas-${currentCommitId || 'default'}-${loadedModel.metadata.fileName}` : 'canvas-empty'}
              camera={{ position: [5, 5, 8], fov: 50 }}
              dpr={[1, 2]}
              gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
            >
              <color attach="background" args={[viewportBg]} />

              {/* Much brighter lighting */}
              <ambientLight intensity={0.8} />
              <directionalLight
                position={[10, 10, 10]}
                intensity={1.5}
                color="#ffffff"
                castShadow
              />
              <directionalLight
                position={[-10, -5, -10]}
                intensity={0.8}
                color="#ffffff"
              />
              <directionalLight
                position={[0, -10, 0]}
                intensity={0.5}
                color="#ffffff"
              />
              <hemisphereLight
                args={["#ffffff", "#444444", 0.6]}
              />

              <SceneContent onSceneReady={handleSceneReady} />

              <OrbitControls
                enablePan={true}
                enableZoom={true}
                enableRotate={true}
                enableDamping={true}
                dampingFactor={0.05}
                minDistance={0.5}
                maxDistance={200}
                makeDefault
              />
            </Canvas>

            {/* Viewport info overlay - only show when model is loaded */}
            {loadedModel && (
              <>
                {/* Snapshot to clipboard */}
                <div className="absolute top-4 right-4 z-20">
                  <button
                    onClick={handleSnapshotToClipboard}
                    className="text-code text-xs text-muted-foreground opacity-60 hover:opacity-100 transition-opacity flex items-center gap-1"
                    title="Copy viewport to clipboard"
                  >
                    {snapshotCopied ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : (
                      <Camera className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                <div className="absolute bottom-4 left-4 z-20 text-code text-xs text-muted-foreground space-y-1">
                  <div>Curves: {safeStats.curves}</div>
                  <div>Surfaces: {safeStats.surfaces}</div>
                  <div>Polysurfaces: {safeStats.polysurfaces}</div>
                </div>

                {/* Controls hint */}
                <div className="absolute bottom-4 right-4 z-20 text-code text-xs text-muted-foreground">
                  <span className="opacity-60">
                    Drag to rotate / Scroll to zoom
                  </span>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
