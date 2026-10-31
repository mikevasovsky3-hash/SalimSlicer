/* ====================================================================
 * 1. CONFIG & STATE (Фундамент: Константы, Профили и Глобальное состояние)
 * ==================================================================== */

const PRINTER_SPECS = {
        name: "Creality Ender 3 V3 SE",
        bedX: 220, bedY: 220, bedZ: 250,
        nozzleDiameter: 0.4, filamentDiameter: 1.75
    };

    const PRINT_LIMITS = {
        maxFileSizeMB: 80, maxTriangles: 1000000,
        autoFitMarginMM: 4,
        safeGapBrimMM: 5.0, safeGapNoBrimMM: 3.0
    };

const DEFAULT_PROFILES = {
        PLA: {
            speed:     { label: "PLA • SE Speed",      layerHeight: 0.20, printSpeed: 160, nozzleTemp: 215, bedTemp: 60, retractDist: 0.6, fanSpeed: 100, defaultInfill: 15, density: 1.24, maxFlow: 15.0, pressureAdvance: 0.045, retractSpeed: 1500 },
            balanced:  { label: "PLA • SE Balanced",   layerHeight: 0.20, printSpeed: 130, nozzleTemp: 210, bedTemp: 60, retractDist: 0.6, fanSpeed: 100, defaultInfill: 15, density: 1.24, maxFlow: 13.0, pressureAdvance: 0.045, retractSpeed: 1500 },
            quality:   { label: "PLA • SE Quality",    layerHeight: 0.16, printSpeed: 95,  nozzleTemp: 205, bedTemp: 60, retractDist: 0.6, fanSpeed: 100, defaultInfill: 20, density: 1.24, maxFlow: 11.0, pressureAdvance: 0.040, retractSpeed: 1400 },
            minweight: { label: "PLA • SE Min Weight", layerHeight: 0.20, printSpeed: 130, nozzleTemp: 210, bedTemp: 60, retractDist: 0.6, fanSpeed: 100, defaultInfill: 6,  density: 1.24, maxFlow: 13.0, pressureAdvance: 0.045, retractSpeed: 1500 }
        },
        PETG: {
            speed:     { label: "PETG • SE Speed",     layerHeight: 0.20, printSpeed: 90, nozzleTemp: 240, bedTemp: 78, retractDist: 0.8, fanSpeed: 40, defaultInfill: 15, density: 1.27, maxFlow: 8.0, pressureAdvance: 0.060, retractSpeed: 1800 },
            balanced:  { label: "PETG • SE Balanced",  layerHeight: 0.20, printSpeed: 75, nozzleTemp: 240, bedTemp: 78, retractDist: 0.8, fanSpeed: 40, defaultInfill: 15, density: 1.27, maxFlow: 7.0, pressureAdvance: 0.060, retractSpeed: 1800 },
            quality:   { label: "PETG • SE Quality",   layerHeight: 0.16, printSpeed: 75,  nozzleTemp: 230, bedTemp: 75, retractDist: 0.6, fanSpeed: 35, defaultInfill: 20, density: 1.27, maxFlow: 9.0,  pressureAdvance: 0.055, retractSpeed: 1300 },
            minweight: { label: "PETG • SE Min Weight",layerHeight: 0.20, printSpeed: 105, nozzleTemp: 235, bedTemp: 75, retractDist: 0.6, fanSpeed: 40, defaultInfill: 6,  density: 1.27, maxFlow: 10.5, pressureAdvance: 0.060, retractSpeed: 1400 }
        },
        TPU: {
            speed:     { label: "TPU • SE Speed",      layerHeight: 0.20, printSpeed: 50, nozzleTemp: 225, bedTemp: 45, retractDist: 0.8, fanSpeed: 50, defaultInfill: 15, density: 1.21, maxFlow: 5.5, pressureAdvance: 0.100, retractSpeed: 1200 },
            balanced:  { label: "TPU • SE Balanced",   layerHeight: 0.20, printSpeed: 40, nozzleTemp: 225, bedTemp: 45, retractDist: 0.8, fanSpeed: 50, defaultInfill: 15, density: 1.21, maxFlow: 4.5, pressureAdvance: 0.100, retractSpeed: 1200 },
            quality:   { label: "TPU • SE Quality",    layerHeight: 0.16, printSpeed: 30, nozzleTemp: 220, bedTemp: 45, retractDist: 0.8, fanSpeed: 45, defaultInfill: 20, density: 1.21, maxFlow: 4.0, pressureAdvance: 0.100, retractSpeed: 1200 },
            minweight: { label: "TPU • SE Min Weight", layerHeight: 0.20, printSpeed: 40, nozzleTemp: 225, bedTemp: 45, retractDist: 0.8, fanSpeed: 50, defaultInfill: 6,  density: 1.21, maxFlow: 4.5, pressureAdvance: 0.100, retractSpeed: 1200 }
        }
    };

    const PROFILES = JSON.parse(JSON.stringify(DEFAULT_PROFILES));

let state = {
    material: 'PLA', mode: 'balanced',
    infill: 15, supports: false, supportType: 'tree', supportOverhangAngle: 52,
    brim: false, brimLoops: 0, brimType: 'outer', mouseEars: false,
    scale: 100, viewportMode: 'model',
    modelName: '',
    generatedGcode: '', slicedLayers: [],
    layerPlayInterval: null, inspectOnlyMode: false,
    showObjectRuler: true, showGcodeLayers: true, showSelectionRing: true,
    layerViewMode: 'all', activeTab: 'print',
    posX: 0, posY: 0, dragModelMode: false, ctxOpen: false,
    gcodeColorMode: 'type', lastSliceStats: null,
    featureFilters: { outer: true, inner: true, solid: true, sparse: true, extras: true },
        isSlicing: false, cancelSlicingRequested: false, gcodeChunks: [],
        expert: {
            hotendType: 'stock', nozzleType: 'brass',
            yHeightDampening: true, cornerReinforce: false,
            wallCount: 2, topLayers: 5, bottomLayers: 3,
            lineWidth: 0.45, flowRate: 95, zOffset: 0.00, pressureAdvance: 0.04,
            xyCompensation: 0.00, vaseMode: false
        }
    };

    // ==== Undo / Project persistence ====
    const _undoStack = [];
    const _undoMaxDepth = 12;
    let _suspendAutosave = false;

let scene, camera, renderer, controls;
let activeMesh = null, bedModels = [];
let selectionRingMesh = null, objectRulerGroup = null;
let gcodeGroup = null;
let raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const horizontalBedPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

// Экспорт в глобальный объект для view-fit, marlin-safe и features
if (typeof window !== 'undefined') {
    window.state = state;
    window.PROFILES = PROFILES;
    window.PRINTER_SPECS = PRINTER_SPECS;
    window.PRINT_LIMITS = PRINT_LIMITS;
    Object.defineProperty(window, 'camera', { get: () => camera, set: v => { camera = v; } });
    Object.defineProperty(window, 'controls', { get: () => controls, set: v => { controls = v; } });
    Object.defineProperty(window, 'scene', { get: () => scene, set: v => { scene = v; } });
    Object.defineProperty(window, 'renderer', { get: () => renderer, set: v => { renderer = v; } });
    Object.defineProperty(window, 'bedModels', { get: () => bedModels, set: v => { bedModels = v; } });
    Object.defineProperty(window, 'activeMesh', { get: () => activeMesh, set: v => { activeMesh = v; } });
    Object.defineProperty(window, 'gcodeGroup', { get: () => gcodeGroup, set: v => { gcodeGroup = v; } });
}

    function escapeHtml(value) {
        return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
    }