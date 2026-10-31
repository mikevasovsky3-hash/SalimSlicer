/* ====================================================================
 * 2. VIEWPORT 3D (Three.js Сцена, Камера, Стол, Линейка и Тетрис)
 * ==================================================================== */

let _sceneRenderPending = false;
    function triggerSceneRender() {
        if (!renderer || !scene || !camera || _sceneRenderPending) return;
        _sceneRenderPending = true;
        requestAnimationFrame(() => { _sceneRenderPending = false; if (renderer && scene && camera) renderer.render(scene, camera); });
    }

class BedOrbitControls {
        constructor(cam, dom) {
            this.camera = cam;
            this.domElement = dom;
            this.target = new THREE.Vector3(0, 25, 0);
            this.activePointers = new Map();
            this.isDraggingModel = false;
            this.holdLockTimer = null;
            this.dragGrabOffset = { x: 0, z: 0 };
            this.downPos = { x: 0, y: 0 };
            this.prevPinchDist = 0;
            this.prevMidpoint = null;
            this.lastTapTime = 0;
            this.lastTapPos = { x: 0, y: 0 };
            this.isPanDragging = false;
            this.bindPointerEvents();
            this.resetAll();
        }
        clearHoldTimer() {
            if (this.holdLockTimer) {
                clearTimeout(this.holdLockTimer);
                this.holdLockTimer = null;
            }
        }
        activateModelDragLock(clientX, clientY, showFeedback = false) {
            this.isDraggingModel = true;
            this.domElement.style.cursor = 'grabbing';
            const bedPt = getBedPlaneIntersection(clientX, clientY);
            if (bedPt && activeMesh) {
                this.dragGrabOffset.x = activeMesh.position.x - bedPt.x;
                this.dragGrabOffset.z = activeMesh.position.z - bedPt.z;
            } else {
                this.dragGrabOffset.x = 0;
                this.dragGrabOffset.z = 0;
            }
            if (selectionRingMesh) selectionRingMesh.material.color.setHex(0xfacc15);
            if (showFeedback && navigator.vibrate) navigator.vibrate(25);
        }
        panCameraByScreenDelta(dx, dy) {
            const dist = this.camera.position.distanceTo(this.target);
            const panScale = Math.max(0.04, dist * 0.0011);
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();
            const upVec = new THREE.Vector3().crossVectors(right, forward).normalize();
            const deltaMove = new THREE.Vector3()
                .addScaledVector(right, -dx * panScale)
                .addScaledVector(upVec, dy * panScale);
            this.target.add(deltaMove);
            this.camera.position.add(deltaMove);
            triggerSceneRender();
        }
        rotateFree3D(dx, dy) {
            const offset = this.camera.position.clone().sub(this.target);
            const forward = new THREE.Vector3();
            this.camera.getWorldDirection(forward);
            const right = new THREE.Vector3().crossVectors(forward, this.camera.up).normalize();

            const qPitch = new THREE.Quaternion().setFromAxisAngle(right, -dy * 0.0065);
            const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.0065);

            const qTotal = new THREE.Quaternion().multiplyQuaternions(qYaw, qPitch);
            offset.applyQuaternion(qTotal);
            this.camera.up.applyQuaternion(qTotal).normalize();

            this.camera.position.copy(this.target).add(offset);
            this.camera.lookAt(this.target);
            triggerSceneRender();
        }
        zoomToScreenPoint(clientX, clientY, factor) {
            const curDist = this.camera.position.distanceTo(this.target);
            const nextDist = curDist * factor;
            if (factor < 1 && nextDist < 20) return;
            if (factor > 1 && nextDist > 1200) return;

            const rect = this.domElement.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            const mx = ((clientX - rect.left) / rect.width) * 2 - 1;
            const my = -((clientY - rect.top) / rect.height) * 2 + 1;

            const ray = new THREE.Raycaster();
            ray.setFromCamera(new THREE.Vector2(mx, my), this.camera);

            const camDir = new THREE.Vector3();
            this.camera.getWorldDirection(camDir);
            const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camDir, this.target);
            const hitPoint = new THREE.Vector3();

            if (ray.ray.intersectPlane(plane, hitPoint)) {
                const camOffset = this.camera.position.clone().sub(hitPoint).multiplyScalar(factor);
                const targetOffset = this.target.clone().sub(hitPoint).multiplyScalar(factor);

                const newCamPos = hitPoint.clone().add(camOffset);
                const newTarget = hitPoint.clone().add(targetOffset);

                newTarget.x = Math.max(-130, Math.min(130, newTarget.x));
                newTarget.y = Math.max(0, Math.min(260, newTarget.y));
                newTarget.z = Math.max(-130, Math.min(130, newTarget.z));

                this.camera.position.copy(newCamPos);
                this.target.copy(newTarget);
                this.camera.lookAt(this.target);
                triggerSceneRender();
            } else {
                const offset = this.camera.position.clone().sub(this.target).multiplyScalar(factor);
                this.camera.position.copy(this.target).add(offset);
                this.camera.lookAt(this.target);
                triggerSceneRender();
            }
        }
        bindPointerEvents() {
            this.domElement.addEventListener('pointerdown', (e) => {
                this.domElement.setPointerCapture(e.pointerId);
                this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
                this.clearHoldTimer();
                if (this.activePointers.size === 1) {
                    this.downPos = { x: e.clientX, y: e.clientY };
                    {
                        getCanvasNDC(e.clientX, e.clientY);
                        raycaster.setFromCamera(pointerNDC, camera);
                        const overModel = state.viewportMode === 'model' && raycaster.intersectObjects(bedModels, false).length > 0;
                        const nowT = performance.now();
                        const nearLastTap = Math.hypot(e.clientX - this.lastTapPos.x, e.clientY - this.lastTapPos.y) < 40;
                        if (!overModel && (e.button === 0 || e.pointerType === 'touch') && (nowT - this.lastTapTime) < 380 && nearLastTap) {
                            this.isPanDragging = true;
                            this.lastTapTime = 0;
                            this.domElement.style.cursor = 'move';
                            if (navigator.vibrate) navigator.vibrate(20);
                        }
                    }
                    if ((e.button === 0 || e.pointerType === 'touch') && state.viewportMode === 'model') {
                        const hitPicked = tryPickModelOnBed(e.clientX, e.clientY);
                        if (hitPicked) {
                            if (state.dragModelMode) this.activateModelDragLock(e.clientX, e.clientY, false);
                            else {
                                const startX = e.clientX, startY = e.clientY;
                                this.holdLockTimer = setTimeout(() => {
                                    this.holdLockTimer = null;
                                    if (this.activePointers.size === 1 && state.viewportMode === 'model') this.activateModelDragLock(startX, startY, true);
                                }, 210);
                            }
                        }
                    }
                } else if (this.activePointers.size === 2) {
                    this.isDraggingModel = false;
                    const pts = Array.from(this.activePointers.values());
                    this.prevPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                    this.prevMidpoint = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
                }
            });
            this.domElement.addEventListener('pointermove', (e) => {
                if (!this.activePointers.has(e.pointerId)) return;
                const prev = this.activePointers.get(e.pointerId);
                const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
                this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

                if (this.activePointers.size === 1) {
                    if (this.holdLockTimer) {
                        const distFromDown = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
                        if (distFromDown > 9) this.clearHoldTimer();
                        else return;
                    }
                    if (this.isDraggingModel) {
                        moveSelectedModelOnBed(e.clientX, e.clientY, this.dragGrabOffset);
                    } else if (this.isPanDragging) {
                        this.panCameraByScreenDelta(dx * 1.7, dy * 1.7);
                    } else if (e.buttons === 2 || e.buttons === 4 || e.shiftKey) {
                        this.panCameraByScreenDelta(dx, dy);
                    } else {
                        this.rotateFree3D(dx, dy);
                    }
                } else if (this.activePointers.size === 2) {
                    this.clearHoldTimer();
                    const pts = Array.from(this.activePointers.values());
                    const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
                    const mid = { x: (pts[0].x + pts[1].x) * 0.5, y: (pts[0].y + pts[1].y) * 0.5 };
                    if (this.prevMidpoint) {
                        this.panCameraByScreenDelta(mid.x - this.prevMidpoint.x, mid.y - this.prevMidpoint.y);
                    }
                    if (this.prevPinchDist > 0 && dist > 0) {
                        const factor = this.prevPinchDist / dist;
                        this.zoomToScreenPoint(mid.x, mid.y, factor);
                    }
                    this.prevPinchDist = dist;
                    this.prevMidpoint = mid;
                }
            });
            const finish = (e) => {
                this.clearHoldTimer();
                if (this.activePointers.size === 1 && !this.isDraggingModel && !this.isPanDragging) {
                    const moveDist = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
                    if (moveDist < 8) {
                        handleViewportTap(e.clientX, e.clientY);
                        this.lastTapTime = performance.now();
                        this.lastTapPos = { x: e.clientX, y: e.clientY };
                    }
                }
                this.isPanDragging = false;
                if (this.isDraggingModel && selectionRingMesh) selectionRingMesh.material.color.setHex(0xfacc15);
                if (this.isDraggingModel) { updateDimensionsUI(); updateSelectionVisuals(); }
                this.domElement.style.cursor = 'default';
                this.activePointers.delete(e.pointerId);
                if (this.activePointers.size < 2) { this.prevPinchDist = 0; this.prevMidpoint = null; }
                if (this.activePointers.size === 0) this.isDraggingModel = false;
            };
            this.domElement.addEventListener('pointerup', finish);
            this.domElement.addEventListener('pointercancel', finish);
            this.domElement.addEventListener('wheel', (e) => {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 0.92 : 1.09;
                this.zoomToScreenPoint(e.clientX, e.clientY, factor);
            }, { passive: false });
            this.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
        }
        updateCamera() {
            this.camera.lookAt(this.target);
            triggerSceneRender();
        }
focusOnModel(mesh = activeMesh) {
            this.camera.up.set(0, 1, 0);
            let h = 25;
            if (mesh && mesh.geometry) {
                if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
                const b = mesh.geometry.boundingBox;
                const s = (mesh.scale && mesh.scale.x) || 1;
                const modelHeight = (b.max.y - b.min.y) * s;
                h = Math.max(15, Math.min(75, modelHeight * 0.5));
            }
            this.target.set(0, h, 0);
            const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
            const dist = isMobile ? 1.25 : 1.0;
            this.camera.position.set(160 * dist, (170 + h) * dist, 230 * dist);
            this.camera.lookAt(this.target);
            triggerSceneRender();
        }
        setPreset(type) {
            this.camera.up.set(0, 1, 0);
            if (type === 'front') {
                this.target.set(0, 25, 0);
                this.camera.position.set(0, 35, 360);
            } else if (type === 'top') {
                this.target.set(0, 0, 0);
                this.camera.position.set(0, 360, 0.01);
                this.camera.up.set(0, 0, -1);
            } else {
                this.target.set(0, 25, 0);
                this.camera.position.set(165, 185, 235);
            }
            this.camera.lookAt(this.target);
            triggerSceneRender();
        }
        resetAll() {
            this.focusOnModel();
        }
    }
	
    let ambientLight = null, dirLight1 = null, dirLight2 = null;

    function updateSceneLightingBrightness(pct) {
        const val = parseFloat(pct) / 100;
        const lbl = document.getElementById('lbl-scene-brightness');
        if (lbl) lbl.textContent = Math.round(pct) + '%';
        const rng = document.getElementById('rng-scene-brightness');
        if (rng && rng.value !== String(pct)) rng.value = pct;
        if (ambientLight) ambientLight.intensity = Number((0.65 * val).toFixed(2));
        if (dirLight1) dirLight1.intensity = Number((0.50 * val).toFixed(2));
        if (dirLight2) dirLight2.intensity = Number((0.25 * val).toFixed(2));
        triggerSceneRender();
    }
    function toggleLightingControlMenu() {
        document.getElementById('menu-lighting-controls')?.classList.toggle('hidden');
    }
	
function resizeViewportCanvas() {
    const vp = document.getElementById('viewport-section');
    const container = document.getElementById('canvas-container');
    if (!renderer || !camera) return;
    const w = (container && container.clientWidth) || (vp && vp.clientWidth) || window.innerWidth;
    const h = (container && container.clientHeight) || (vp && vp.clientHeight) || Math.round(window.innerHeight * 0.5);
    if (w <= 0 || h <= 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    triggerSceneRender();
}

    function initThreeScene() {
        const container = document.getElementById('canvas-container');
        if (!container || typeof THREE === 'undefined') return;
        const width = Math.max(240, container.clientWidth || window.innerWidth);
        const height = Math.max(220, container.clientHeight || window.innerHeight * 0.48);
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x080d18);
        camera = new THREE.PerspectiveCamera(42, width / height, 1, 2500);
        renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        renderer.setSize(width, height, false);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        container.innerHTML = ''; container.appendChild(renderer.domElement);
        controls = new BedOrbitControls(camera, renderer.domElement);
        ambientLight = new THREE.AmbientLight(0xe2e8f0, 0.40); scene.add(ambientLight);
        dirLight1 = new THREE.DirectionalLight(0xffffff, 0.30); dirLight1.position.set(160, 320, 220); scene.add(dirLight1);
        dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.15); dirLight2.position.set(-180, 180, -200); scene.add(dirLight2);
        buildBed();
        initSelectionHelpers();
        gcodeGroup = new THREE.Group(); gcodeGroup.visible = false; scene.add(gcodeGroup);
        updateDimensionsUI();
        window.addEventListener('resize', resizeViewportCanvas);
        setTimeout(resizeViewportCanvas, 100);
    }
    function clampModelToBed(mesh, x, z) {
        const aabb = getMeshWorldAABBAt(mesh, 0, 0);
        const halfW = (aabb.maxX - aabb.minX) * 0.5;
        const halfD = (aabb.maxZ - aabb.minZ) * 0.5;
        const limX = Math.max(0, PRINTER_SPECS.bedX * 0.5 - halfW);
        const limZ = Math.max(0, PRINTER_SPECS.bedY * 0.5 - halfD);
        return {
            x: Math.max(-limX, Math.min(limX, x)),
            z: Math.max(-limZ, Math.min(limZ, z))
        };
    }

    function moveSelectedModelOnBed(clientX, clientY, grabOffset = { x: 0, z: 0 }) {
        if (!activeMesh) return;
        const intersectPt = getBedPlaneIntersection(clientX, clientY);
        if (!intersectPt) return;
        const clamped = clampModelToBed(activeMesh, intersectPt.x + grabOffset.x, intersectPt.z + grabOffset.z);
        const targetX = Number(clamped.x.toFixed(1));
        const targetZ = Number(clamped.z.toFixed(1));
        state.posX = targetX; state.posY = Number((-targetZ).toFixed(1));
        activeMesh.position.set(targetX, 0, targetZ);
        const inpX = document.getElementById('inp-pos-x');
        const inpY = document.getElementById('inp-pos-y');
        if (inpX) inpX.value = state.posX;
        if (inpY) inpY.value = state.posY;
        invalidateSlicedGcode();
    }

function themeRGB(varName, fallback) {
        try {
            const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
            const p = raw.split(/\s+/).map(Number);
            if (p.length === 3 && p.every(isFinite)) return p;
        } catch (e) { /* переменной нет, берём запасной цвет */ }
        return fallback;
    }
    function rgbaCss(c, a) { return `rgba(${c[0]},${c[1]},${c[2]},${a})`; }

function createBedTexture() {
        try {
            const S = 2048;
            const canvas = document.createElement('canvas');
            canvas.width = S;
            canvas.height = S;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;

            const mm = S / PRINTER_SPECS.bedX;          // пикселей в одном миллиметре
            const base   = themeRGB('--slate-700', [51, 65, 85]);
            const light  = themeRGB('--slate-500', [100, 116, 139]);
            const textC  = themeRGB('--slate-200', [226, 232, 240]);
            const accent = themeRGB('--cyan-400', [34, 211, 238]);

            // 1. Полупрозрачная заливка: сквозь неё видно модель. Сетка и рамка рисуются отдельно линиями в 3D
            ctx.clearRect(0, 0, S, S);
            ctx.fillStyle = rgbaCss(base, 0.30);
            ctx.fillRect(0, 0, S, S);
            const grad = ctx.createRadialGradient(S / 2, S / 2, 40, S / 2, S / 2, S * 0.72);
            grad.addColorStop(0, rgbaCss(light, 0.30));
            grad.addColorStop(1, rgbaCss(light, 0));
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, S, S);

            // 2. Центральный прицел
            const c = S / 2;
            ctx.lineWidth = 5;
            ctx.strokeStyle = rgbaCss(accent, 0.9);
            ctx.beginPath(); ctx.arc(c, c, 26, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(c - 62, c); ctx.lineTo(c + 62, c); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(c, c - 62); ctx.lineTo(c, c + 62); ctx.stroke();

            // 3. Подписи координат: X вдоль переднего края, Y вдоль левого (как в G-code)
            ctx.font = 'bold 40px monospace';
            ctx.fillStyle = rgbaCss(textC, 0.85);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            for (let v = 50; v < PRINTER_SPECS.bedX; v += 50) {
                ctx.fillText(String(v), v * mm, S - 26);
            }
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            for (let v = 50; v < PRINTER_SPECS.bedY; v += 50) {
                ctx.fillText(String(v), 28, (PRINTER_SPECS.bedY - v) * mm);
            }
            ctx.textAlign = 'left';
            ctx.textBaseline = 'bottom';
            ctx.fillStyle = rgbaCss(accent, 1);
            ctx.font = 'bold 42px monospace';
            ctx.fillText('0', 28, S - 26);

            // 4. Тихая надпись у заднего края
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = '900 44px sans-serif';
            ctx.fillStyle = rgbaCss(textC, 0.35);
            ctx.fillText('CREALITY  ENDER-3 V3 SE', S / 2, 34);
            ctx.font = 'bold 26px monospace';
            ctx.fillStyle = rgbaCss(textC, 0.30);
            ctx.fillText('220 × 220 × 250 MM', S / 2, 90);

            const tex = new THREE.CanvasTexture(canvas);
            if (renderer && renderer.capabilities && renderer.capabilities.getMaxAnisotropy) {
                tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            }
            tex.needsUpdate = true;
            return tex;
        } catch (e) {
            console.error("Bed texture creation failed:", e);
            return null;
        }
    }

    function buildBed() {
        try {
            const existing = scene.getObjectByName("bedGroup");
            if (existing) {
                scene.remove(existing);
                existing.traverse(n => {
                    if (n.geometry) n.geometry.dispose();
                    if (n.material) {
                        if (n.material.map) n.material.map.dispose();
                        n.material.dispose();
                    }
                });
            }

            const bedGroup = new THREE.Group();
            bedGroup.name = "bedGroup";
            const W = PRINTER_SPECS.bedX, D = PRINTER_SPECS.bedY, H = PRINTER_SPECS.bedZ;
            const toHex = (c) => (c[0] << 16) | (c[1] << 8) | c[2];
            const minorHex  = toHex(themeRGB('--slate-300', [203, 213, 225]));
            const majorHex  = toHex(themeRGB('--slate-100', [241, 245, 249]));
            const accentHex = toHex(themeRGB('--cyan-400', [34, 211, 238]));

            // 1. Полупрозрачная пластина: без бликов, не пишет в буфер глубины, видна с обеих сторон
            const bedTex = createBedTexture();
            const topGeo = new THREE.PlaneGeometry(W, D);
            topGeo.rotateX(-Math.PI / 2);
            const topMat = new THREE.MeshBasicMaterial({
                map: bedTex,
                color: 0xffffff,
                transparent: true,
                opacity: 1,
                side: THREE.DoubleSide,
                depthWrite: false
            });
            const topMesh = new THREE.Mesh(topGeo, topMat);
            topMesh.position.set(0, -0.15, 0);
            topMesh.renderOrder = -2;
            bedGroup.add(topMesh);

            // 2. Сетка настоящими линиями: видна под любым углом, не размывается
            const minorPts = [], majorPts = [];
            const y = -0.1;
            for (let v = 10; v < W; v += 10) {
                const x = -W / 2 + v;
                const isMajor = (v % 50 === 0);
                const arr = isMajor ? majorPts : minorPts;
                arr.push(new THREE.Vector3(x, y, -D / 2), new THREE.Vector3(x, y, D / 2));
                if (isMajor) majorPts.push(new THREE.Vector3(x + 0.18, y, -D / 2), new THREE.Vector3(x + 0.18, y, D / 2));
            }
            for (let v = 10; v < D; v += 10) {
                const z = -D / 2 + v;
                const isMajor = (v % 50 === 0);
                const arr = isMajor ? majorPts : minorPts;
                arr.push(new THREE.Vector3(-W / 2, y, z), new THREE.Vector3(W / 2, y, z));
                if (isMajor) majorPts.push(new THREE.Vector3(-W / 2, y, z + 0.18), new THREE.Vector3(W / 2, y, z + 0.18));
            }
            const minorLines = new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints(minorPts),
                new THREE.LineBasicMaterial({ color: minorHex, transparent: true, opacity: 0.30, depthWrite: false })
            );
            minorLines.renderOrder = -1;
            bedGroup.add(minorLines);
            const majorLines = new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints(majorPts),
                new THREE.LineBasicMaterial({ color: majorHex, transparent: true, opacity: 0.70, depthWrite: false })
            );
            majorLines.renderOrder = -1;
            bedGroup.add(majorLines);

            // 3. Рамка области печати в цвете темы (двойная линия для толщины)
            const frameLoop = (inset) => new THREE.LineLoop(
                new THREE.BufferGeometry().setFromPoints([
                    new THREE.Vector3(-W / 2 + inset, y, -D / 2 + inset),
                    new THREE.Vector3(W / 2 - inset, y, -D / 2 + inset),
                    new THREE.Vector3(W / 2 - inset, y, D / 2 - inset),
                    new THREE.Vector3(-W / 2 + inset, y, D / 2 - inset)
                ]),
                new THREE.LineBasicMaterial({ color: accentHex, transparent: true, opacity: 1, depthWrite: false })
            );
            const frameA = frameLoop(0), frameB = frameLoop(0.35);
            frameA.renderOrder = -1; frameB.renderOrder = -1;
            bedGroup.add(frameA);
            bedGroup.add(frameB);

            // 4. Едва заметные границы объёма печати (220 × 250 × 220 мм)
            const volGeo = new THREE.BoxGeometry(W, H, D);
            const volEdges = new THREE.EdgesGeometry(volGeo);
            volGeo.dispose();
            const volMat = new THREE.LineDashedMaterial({
                color: 0x94a3b8,
                dashSize: 6,
                gapSize: 5,
                opacity: 0.22,
                transparent: true
            });
            const volBox = new THREE.LineSegments(volEdges, volMat);
            volBox.computeLineDistances();
            volBox.position.set(0, H / 2, 0);
            bedGroup.add(volBox);

            // 5. Шкала высоты Z на задней левой стойке (засечки каждые 50 мм)
            const zRulerPts = [
                new THREE.Vector3(-W / 2, 0, -D / 2),
                new THREE.Vector3(-W / 2, H, -D / 2)
            ];
            for (let zH = 50; zH <= 250; zH += 50) {
                zRulerPts.push(
                    new THREE.Vector3(-W / 2, zH, -D / 2),
                    new THREE.Vector3(-W / 2 + 6, zH, -D / 2)
                );
            }
            const zRulerGeo = new THREE.BufferGeometry().setFromPoints(zRulerPts);
            const zRulerLines = new THREE.LineSegments(zRulerGeo, new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.6 }));
            bedGroup.add(zRulerLines);

            // 6. Оси координат X, Y, Z из начала координат принтера (передний левый угол)
            const originCorner = new THREE.Vector3(-W / 2, 0.4, D / 2);
            bedGroup.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), originCorner, 36, 0xef4444, 7, 4));
            bedGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, -1), originCorner, 36, 0x10b981, 7, 4));
            bedGroup.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), originCorner, 36, 0x38bdf8, 7, 4));

            scene.add(bedGroup);
            triggerSceneRender();
        } catch (err) {
            console.error("buildBed error:", err);
        }
    }

    function initSelectionHelpers() {
        const ringGeo = new THREE.RingGeometry(22, 24, 48); ringGeo.rotateX(-Math.PI / 2);
        selectionRingMesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0x10b981, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
        selectionRingMesh.position.set(0, 0.15, 0); selectionRingMesh.visible = false;
        scene.add(selectionRingMesh);
    }

    function updateDimensionsUI() {
        const dimsLabel = document.getElementById('model-dims-label');
        const boundsWarn = document.getElementById('bounds-warning');
        const ix = document.getElementById('inp-size-x');
        const iy = document.getElementById('inp-size-y');
        const iz = document.getElementById('inp-size-z');

if (!activeMesh) {
            if (dimsLabel) dimsLabel.textContent = '';
            const nameLbl = document.getElementById('model-name-label');
            if (nameLbl) nameLbl.innerHTML = '';
            document.getElementById('model-info-panel')?.classList.add('hidden');
            if (ix) ix.value = '';
            if (iy) iy.value = '';
            if (iz) iz.value = '';
            if (boundsWarn) boundsWarn.classList.add('hidden');
            return;
        }

        activeMesh.geometry.computeBoundingBox();
        const box = activeMesh.geometry.boundingBox;
        const s = activeMesh.scale.x;
        const worldAABB = getMeshWorldAABBAt(activeMesh, activeMesh.position.x, activeMesh.position.z);
        const widthX = worldAABB.maxX - worldAABB.minX;
        const depthY = worldAABB.maxZ - worldAABB.minZ;
        const heightZ = (box.max.y - box.min.y) * s;

        if (dimsLabel) dimsLabel.textContent = `Габариты: ${widthX.toFixed(1)} × ${depthY.toFixed(1)} × ${heightZ.toFixed(1)} мм`;
        if (ix) ix.value = widthX.toFixed(1);
        if (iy) iy.value = depthY.toFixed(1);
        if (iz) iz.value = heightZ.toFixed(1);

        const halfBedX = PRINTER_SPECS.bedX * 0.5;
        const halfBedY = PRINTER_SPECS.bedY * 0.5;
        let isOut = false;
        for (const m of bedModels) {
            const aabb = getMeshWorldAABBAt(m, m.position.x, m.position.z);
            const mh = (m.geometry.boundingBox.max.y - m.geometry.boundingBox.min.y) * m.scale.x;
            if (aabb.minX < -halfBedX || aabb.maxX > halfBedX || aabb.minZ < -halfBedY || aabb.maxZ > halfBedY || mh > PRINTER_SPECS.bedZ) {
                isOut = true;
                break;
            }
        }
        if (boundsWarn) boundsWarn.classList.toggle('hidden', !isOut);
    }

    function onExactSizeMMChange(axis, val) {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        const targetMM = parseFloat(val);
        if (!targetMM || targetMM <= 0) return;
        activeMesh.geometry.computeBoundingBox();
        const b = activeMesh.geometry.boundingBox;
        let origDim = 1;
        if (axis === 'x') origDim = b.max.x - b.min.x;
        else if (axis === 'y') origDim = b.max.z - b.min.z;
        else if (axis === 'z') origDim = b.max.y - b.min.y;
        if (origDim <= 0.001) return;
        const newScalePct = (targetMM / origDim) * 100;
        updateModelScale(newScalePct);
    }

function updateSelectionVisuals() {
        if (selectionRingMesh) selectionRingMesh.visible = false;
        const ctxMenu = document.getElementById('model-context-menu');
        const infoPanel = document.getElementById('model-info-panel');
        if (infoPanel) infoPanel.classList.toggle('hidden', bedModels.length === 0);
        if (!activeMesh || state.viewportMode !== 'model') {
            if (ctxMenu) ctxMenu.classList.add('hidden');
            if (typeof updateObjectRulerHelper === 'function') updateObjectRulerHelper();
            return;
        }
        activeMesh.geometry.computeBoundingBox();
        const box = activeMesh.geometry.boundingBox;
        const s = activeMesh.scale.x;
        const widthX = (box.max.x - box.min.x) * s;
        const depthY = (box.max.z - box.min.z) * s;
        const heightZ = (box.max.y - box.min.y) * s;
        const radius = Math.max(8, Math.hypot(widthX, depthY) * 0.52);
        if (selectionRingMesh) {
            selectionRingMesh.geometry.dispose();
            const rGeo = new THREE.RingGeometry(radius, radius + 1.8, 48); rGeo.rotateX(-Math.PI / 2);
            selectionRingMesh.geometry = rGeo;
            selectionRingMesh.position.set(activeMesh.position.x, 0.14, activeMesh.position.z);
            selectionRingMesh.visible = (state.showSelectionRing === true);
        }
        const titleEl = document.getElementById('ctx-model-title');
        const sizeEl = document.getElementById('ctx-model-size');
        if (titleEl) titleEl.textContent = activeMesh.userData.name || state.modelName;
        if (sizeEl) sizeEl.textContent = `${widthX.toFixed(1)}×${depthY.toFixed(1)}×${heightZ.toFixed(1)} мм`;
        if (ctxMenu) ctxMenu.classList.toggle('hidden', !state.ctxOpen);
        if (typeof updateObjectRulerHelper === 'function') updateObjectRulerHelper();
    }

    function getCanvasNDC(clientX, clientY) {
        const rect = renderer.domElement.getBoundingClientRect();
        pointerNDC.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        pointerNDC.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    }
    function handleViewportTap(clientX, clientY) {
        if (state.viewportMode !== 'model') return;
        getCanvasNDC(clientX, clientY);
        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObjects(bedModels, false);
        if (hits.length === 0) deselectMesh();
    }
    function tryPickModelOnBed(clientX, clientY) {
        getCanvasNDC(clientX, clientY);
        raycaster.setFromCamera(pointerNDC, camera);
        const hits = raycaster.intersectObjects(bedModels, false);
        if (hits.length > 0) { state.ctxOpen = true; selectMesh(hits[0].object, true); return true; }
        return false;
    }
    function getBedPlaneIntersection(clientX, clientY) {
        getCanvasNDC(clientX, clientY);
        raycaster.setFromCamera(pointerNDC, camera);
        const intersectPt = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(horizontalBedPlane, intersectPt)) return intersectPt;
        return null;
    }
    function getMeshWorldAABBAt(mesh, x, z) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        const box = mesh.geometry.boundingBox;
        const s = mesh.scale.x;
        const rotY = mesh.rotation.y || 0;
        const cos = Math.cos(rotY), sin = Math.sin(rotY);
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        const xs = [box.min.x, box.max.x], zs = [box.min.z, box.max.z];
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
            const lx = xs[i] * s, lz = zs[j] * s;
            const wx = lx * cos + lz * sin + x;
            const wz = -lx * sin + lz * cos + z;
            if (wx < minX) minX = wx; if (wx > maxX) maxX = wx;
            if (wz < minZ) minZ = wz; if (wz > maxZ) maxZ = wz;
        }
        return { minX, maxX, minZ, maxZ };
    }

    function selectMesh(mesh, silent = false) {
        activeMesh = mesh;
        bedModels.forEach(m => {
            if (m === activeMesh) { m.material.emissive.setHex(0x083344); m.material.color.setRGB(1.0, 1.0, 1.0); }
            else { m.material.emissive.setHex(0x000000); m.material.color.setRGB(0.55, 0.55, 0.55); }
        });
        state.modelName = mesh.userData.name || 'Model.stl';
        state.posX = Number(mesh.position.x.toFixed(1));
        state.posY = Number((-mesh.position.z).toFixed(1));
        state.scale = Number((mesh.scale.x * 100).toFixed(1));
        const inpX = document.getElementById('inp-pos-x'), inpY = document.getElementById('inp-pos-y');
        const scSlider = document.getElementById('scale-slider'), scDisp = document.getElementById('scale-value-display');
        const nameLbl = document.getElementById('model-name-label');
        if (inpX) inpX.value = state.posX;
        if (inpY) inpY.value = state.posY;
        if (scSlider) scSlider.value = state.scale;
        if (scDisp) scDisp.textContent = `${state.scale}%`;
        if (nameLbl) nameLbl.innerHTML = `<i class="fa-solid fa-cube text-cyan-400"></i> <span class="truncate">${escapeHtml(state.modelName)}</span>`;
        updateDimensionsUI(); updateSelectionVisuals();
        if (!silent) showToast(`Выбрана: ${state.modelName}`);
    }
function deselectMesh() {
        activeMesh = null;
        state.dragModelMode = false;
        state.ctxOpen = false;
        if (bedModels.length === 0) state.modelName = '';
        bedModels.forEach(m => { m.material.emissive.setHex(0x000000); m.material.color.setRGB(0.55, 0.55, 0.55); });
        updateSelectionVisuals();
    }
    function deleteSelectedModel() {
        const target = activeMesh || bedModels[bedModels.length - 1];
        if (!target) { showToast("Стол уже пуст"); return; }
        const removedName = target.userData.name || state.modelName;
        const doDelete = () => {
            if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();
            scene.remove(target);
            if (target.geometry) target.geometry.dispose();
            if (target.material) target.material.dispose();
            bedModels = bedModels.filter(m => m !== target);
activeMesh = bedModels.length > 0 ? bedModels[bedModels.length - 1] : null;
if (activeMesh) {
    state.ctxOpen = false;
    selectMesh(activeMesh, true);
} else {
    deselectMesh();
    clearSlicedGcodeState();
}
            invalidateSlicedGcode();
            updateDimensionsUI();
            updateSelectionVisuals();
            showToast(`Удалено: ${removedName}`);
        };
        if (typeof showConfirmDialog === 'function') {
            showConfirmDialog({
                title: "Удаление модели",
                message: `Удалить деталь "${removedName}" со стола?`,
                confirmText: "Удалить",
                cancelText: "Отмена",
                type: "rose",
                icon: "fa-trash-can"
            }, doDelete);
        } else {
            doDelete();
        }
    }
function stepModelScale(deltaPercent) {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        const nextScale = Math.max(1, Math.min(10000, Math.round(state.scale + deltaPercent)));
        updateModelScale(nextScale);
    }
    function updateModelScale(val) {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        const parsed = parseFloat(val);
        state.scale = (!isNaN(parsed) && parsed > 0) ? parsed : 100;

        const scSlider = document.getElementById('scale-slider');
        const scDisp = document.getElementById('scale-value-display');
        if (scSlider) {
            if (state.scale > parseFloat(scSlider.max)) scSlider.max = Math.ceil(state.scale * 1.25);
            scSlider.value = state.scale;
        }
        if (scDisp) scDisp.textContent = `${Math.round(state.scale)}%`;

        if (activeMesh) {
            const f = state.scale / 100;
            activeMesh.scale.set(f, f, f);
            invalidateSlicedGcode();
            alignMeshToBedSurface();
            updateDimensionsUI();
            updateSelectionVisuals();

            // Проверка превышения габаритов стола 220x220x250 мм
            const halfX = PRINTER_SPECS.bedX * 0.5;
            const halfY = PRINTER_SPECS.bedY * 0.5;
            const aabb = getMeshWorldAABBAt(activeMesh, activeMesh.position.x, activeMesh.position.z);
            activeMesh.geometry.computeBoundingBox();
            const h = (activeMesh.geometry.boundingBox.max.y - activeMesh.geometry.boundingBox.min.y) * f;

            if (aabb.minX < -halfX || aabb.maxX > halfX || aabb.minZ < -halfY || aabb.maxZ > halfY || h > PRINTER_SPECS.bedZ) {
                showToast(`⚠️ Модель превышает стол! Габариты: ${(aabb.maxX - aabb.minX).toFixed(0)}×${(aabb.maxZ - aabb.minZ).toFixed(0)}×${h.toFixed(0)} мм`);
            }
        }
    }
    function centerModelOnBed() {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        state.posX = 0; state.posY = 0;
        const inpX = document.getElementById('inp-pos-x'), inpY = document.getElementById('inp-pos-y');
        if (inpX) inpX.value = 0;
        if (inpY) inpY.value = 0;
        activeMesh.position.set(0, 0, 0);
        invalidateSlicedGcode();
        updateDimensionsUI(); updateSelectionVisuals();
        showToast("Модель в центре");
    }
    function onModelPositionChange() {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        const inpX = document.getElementById('inp-pos-x'), inpY = document.getElementById('inp-pos-y');
        const rawX = inpX ? (parseFloat(inpX.value) || 0) : 0;
        const rawY = inpY ? (parseFloat(inpY.value) || 0) : 0;
        const clamped = clampModelToBed(activeMesh, rawX, -rawY);
        const newX = Number(clamped.x.toFixed(1));
        const newY = Number((-clamped.z).toFixed(1));
        if (Math.abs(rawX - newX) > 0.05 || Math.abs(rawY - newY) > 0.05) {
            if (inpX) inpX.value = newX.toFixed(1);
            if (inpY) inpY.value = newY.toFixed(1);
            showToast("Позиция ограничена краем стола");
        }
        state.posX = newX; state.posY = newY;
        activeMesh.position.set(newX, 0, -newY);
        invalidateSlicedGcode();
        updateDimensionsUI(); updateSelectionVisuals();
    }
function duplicateSelectedModel() {
        const source = activeMesh || bedModels[bedModels.length - 1];
        if (!source) { showToast("Сначала добавьте модель"); return; }
        pushUndoSnapshot();
        const clonedGeo = source.geometry.clone();
        const clonedMat = source.material.clone();
        const newMesh = new THREE.Mesh(clonedGeo, clonedMat);
        newMesh.scale.copy(source.scale); newMesh.rotation.copy(source.rotation);
        newMesh.userData.name = `${source.userData.name || 'Model'} (Копия)`;
        bedModels.push(newMesh);
        const srcAABB = getMeshWorldAABBAt(source, source.position.x, source.position.z);
        const srcW = srcAABB.maxX - srcAABB.minX;
        newMesh.position.set(source.position.x + srcW + 5, 0, source.position.z);
        scene.add(newMesh);
        // Если копия не влезла на стол — раскладываем все детали заново
        const dupBox = getMeshWorldAABBAt(newMesh, newMesh.position.x, newMesh.position.z);
        const halfBed = PRINTER_SPECS.bedX * 0.5;
        if (dupBox.maxX > halfBed || dupBox.minX < -halfBed) autoArrangeBedModels('tetris', true);
        invalidateSlicedGcode();
        selectMesh(newMesh, true);
        updateDimensionsUI();
        showToast("Копия размещена");
    }
    function rotateModel90(axis) {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        pushUndoSnapshot();
        const rad = Math.PI / 2;
        if (axis === 'x') activeMesh.geometry.rotateX(rad);
        else if (axis === 'y') activeMesh.geometry.rotateZ(rad);
        else activeMesh.geometry.rotateY(rad);
        activeMesh.geometry.computeVertexNormals();
        invalidateSlicedGcode();
        alignMeshToBedSurface();
        showToast(`Поворот 90°`);
    }
function rotateModelCustomZ(deg) {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        pushUndoSnapshot();
        activeMesh.geometry.rotateY((deg * Math.PI) / 180);
        activeMesh.geometry.computeVertexNormals();
        invalidateSlicedGcode();
        alignMeshToBedSurface();
        showToast(`Поворот Z ${deg}°`);
    }

    function mirrorSelectedModel(axis = 'x') {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        if (typeof pushUndoSnapshot === 'function') pushUndoSnapshot();

        const geo = activeMesh.geometry;
        const pos = geo.attributes.position;
        const count = pos.count;

        for (let i = 0; i < count; i++) {
            if (axis === 'x') pos.setX(i, -pos.getX(i));
            else if (axis === 'y') pos.setZ(i, -pos.getZ(i));
            else if (axis === 'z') pos.setY(i, -pos.getY(i));
        }
        pos.needsUpdate = true;

        for (let i = 0; i < count; i += 3) {
            const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
            const x2 = pos.getX(i + 2), y2 = pos.getY(i + 2), z2 = pos.getZ(i + 2);
            pos.setXYZ(i + 1, x2, y2, z2);
            pos.setXYZ(i + 2, x1, y1, z1);
        }
        pos.needsUpdate = true;

        geo.computeVertexNormals();
        if (typeof invalidateSlicedGcode === 'function') invalidateSlicedGcode();
        alignMeshToBedSurface();
        showToast(`Отражено зеркально (${axis.toUpperCase()})`);
    }

function generateGcodeThumbnailBase64(size = 200) {
        if (!renderer || !scene || !camera || bedModels.length === 0) return null;
        let thumbRenderer = null;
        try {
            const thumbCanvas = document.createElement('canvas');
            thumbCanvas.width = size;
            thumbCanvas.height = size;
            thumbRenderer = new THREE.WebGLRenderer({ canvas: thumbCanvas, antialias: true, alpha: false, preserveDrawingBuffer: true });
            thumbRenderer.setSize(size, size);

            // Отключаем элементы окружения и возвращаем видимость моделей, если активен режим просмотра G-code
            const bedObj = scene.getObjectByName('bedGroup');
            if (bedObj) bedObj.visible = false;
            if (selectionRingMesh) selectionRingMesh.visible = false;
            if (objectRulerGroup) objectRulerGroup.visible = false;
            const wasGcodeMode = (state.viewportMode === 'gcode');
            if (wasGcodeMode) {
                bedModels.forEach(m => { m.visible = true; });
                if (gcodeGroup) gcodeGroup.visible = false;
            }

            const tempCam = camera.clone();
            tempCam.aspect = 1.0;
            tempCam.updateProjectionMatrix();

            thumbRenderer.render(scene, tempCam);
            const dataUrl = thumbCanvas.toDataURL('image/png');

            // Восстанавливаем исходную видимость
            if (bedObj) bedObj.visible = true;
            if (selectionRingMesh) selectionRingMesh.visible = state.showSelectionRing === true;
            if (objectRulerGroup) objectRulerGroup.visible = state.showObjectRuler === true;
            if (wasGcodeMode) {
                bedModels.forEach(m => { m.visible = false; });
                if (gcodeGroup) gcodeGroup.visible = (state.showGcodeLayers !== false);
            }

            // Освобождаем WebGL контекст, предотвращая лимит "Too many active WebGL contexts"
            thumbRenderer.forceContextLoss();
            thumbRenderer.dispose();
            thumbRenderer = null;

            return dataUrl.split(',')[1];
        } catch (e) {
            console.warn('Ошибка создания миниатюры:', e);
            if (thumbRenderer) {
                try { thumbRenderer.forceContextLoss(); thumbRenderer.dispose(); } catch (err) {}
            }
            return null;
        }
    }

    function alignMeshToBedSurface() {
        if (!activeMesh) return;
        activeMesh.geometry.computeBoundingBox();
        const box = activeMesh.geometry.boundingBox;
        const cx = (box.min.x + box.max.x) / 2, cz = (box.min.z + box.max.z) / 2;
        const minY = box.min.y;
        activeMesh.geometry.translate(-cx, -minY, -cz);
        activeMesh.position.set(state.posX, 0, -state.posY);
        updateDimensionsUI(); updateSelectionVisuals();
    }

function createRulerBadgeSprite(mainText, subText, accentColor = '#06b6d4') {
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 56;
        const ctx = canvas.getContext('2d');

        // Компактная полупрозрачная капсула
        ctx.fillStyle = 'rgba(10, 16, 28, 0.76)';
        ctx.strokeStyle = accentColor;
        ctx.lineWidth = 2.5;
        const r = 24, x = 4, y = 4, w = 248, h = 48;
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.lineTo(x + w - r, y);
        ctx.arcTo(x + w, y, x + w, y + r, r);
        ctx.lineTo(x + w, y + h - r);
        ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
        ctx.lineTo(x + r, y + h);
        ctx.arcTo(x, y + h, x, y + h - r, r);
        ctx.lineTo(x, y + r);
        ctx.arcTo(x, y, x + r, y, r);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Индикатор оси
        ctx.fillStyle = accentColor;
        ctx.beginPath();
        ctx.arc(24, 28, 6, 0, Math.PI * 2);
        ctx.fill();

        // Чёткий однострочный текст размера
        ctx.fillStyle = '#f8fafc';
        ctx.font = '800 26px "JetBrains Mono", monospace';
        ctx.textBaseline = 'middle';
        ctx.fillText(mainText, 40, 29);

        const texture = new THREE.CanvasTexture(canvas);
        const mat = new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: 0.9,
            depthTest: false,
            depthWrite: false
        });
        const sprite = new THREE.Sprite(mat);
        sprite.raycast = () => {};

        // Фиксированный 2D-размер на экране: не раздувается при приближении камеры и не ведёт себя как 3D-объект
        sprite.onBeforeRender = function (rendererArg, sceneArg, cam) {
            if (!cam) return;
            const dist = cam.position.distanceTo(this.position);
            const k = Math.max(0.15, dist * 0.0022);
            this.scale.set(22 * k, 4.8 * k, 1);
            this.updateMatrixWorld();
        };
        return sprite;
    }

    function updateObjectRulerHelper() {
        if (!scene) return;
        if (!objectRulerGroup) {
            objectRulerGroup = new THREE.Group();
            scene.add(objectRulerGroup);
        }
        while (objectRulerGroup.children.length > 0) {
            const c = objectRulerGroup.children[0];
            if (c.geometry) c.geometry.dispose();
            if (c.material) {
                if (c.material.map) c.material.map.dispose();
                c.material.dispose();
            }
            objectRulerGroup.remove(c);
        }
        if (!state.showObjectRuler || !activeMesh || state.viewportMode !== 'model') {
            objectRulerGroup.visible = false;
            triggerSceneRender();
            return;
        }
        objectRulerGroup.visible = true;

        const aabb = getMeshWorldAABBAt(activeMesh, activeMesh.position.x, activeMesh.position.z);
        activeMesh.geometry.computeBoundingBox();
        const box = activeMesh.geometry.boundingBox;
        const h = (box.max.y - box.min.y) * activeMesh.scale.x;
        const w = Math.max(0.1, aabb.maxX - aabb.minX);
        const d = Math.max(0.1, aabb.maxZ - aabb.minZ);
        const midX = (aabb.minX + aabb.maxX) * 0.5;
        const midZ = (aabb.minZ + aabb.maxZ) * 0.5;

        // 1. Тонкий ненавязчивый габаритный контур
        const boxGeo = new THREE.BoxGeometry(w, h, d);
        const edges = new THREE.EdgesGeometry(boxGeo);
        boxGeo.dispose();
        const wire = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.28, depthWrite: false }));
        wire.position.set(midX, h * 0.5, midZ);
        objectRulerGroup.add(wire);

        // 2. Размерная линия X на плоскости стола спереди от модели
        const xLineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(aabb.minX, 0.2, aabb.maxZ + 4.5),
            new THREE.Vector3(aabb.maxX, 0.2, aabb.maxZ + 4.5),
            new THREE.Vector3(aabb.minX, 0.2, aabb.maxZ + 2.0),
            new THREE.Vector3(aabb.minX, 0.2, aabb.maxZ + 7.0),
            new THREE.Vector3(aabb.maxX, 0.2, aabb.maxZ + 2.0),
            new THREE.Vector3(aabb.maxX, 0.2, aabb.maxZ + 7.0)
        ]);
        objectRulerGroup.add(new THREE.LineSegments(xLineGeo, new THREE.LineBasicMaterial({ color: 0x06b6d4, transparent: true, opacity: 0.75 })));
        const xSprite = createRulerBadgeSprite(`X ${w.toFixed(1)} мм`, '', '#06b6d4');
        xSprite.position.set(midX, 0.4, aabb.maxZ + 11.5);
        objectRulerGroup.add(xSprite);

        // 3. Размерная линия Y на плоскости стола справа от модели
        const yLineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(aabb.maxX + 4.5, 0.2, aabb.minZ),
            new THREE.Vector3(aabb.maxX + 4.5, 0.2, aabb.maxZ),
            new THREE.Vector3(aabb.maxX + 2.0, 0.2, aabb.minZ),
            new THREE.Vector3(aabb.maxX + 7.0, 0.2, aabb.minZ),
            new THREE.Vector3(aabb.maxX + 2.0, 0.2, aabb.maxZ),
            new THREE.Vector3(aabb.maxX + 7.0, 0.2, aabb.maxZ)
        ]);
        objectRulerGroup.add(new THREE.LineSegments(yLineGeo, new THREE.LineBasicMaterial({ color: 0x10b981, transparent: true, opacity: 0.75 })));
        const ySprite = createRulerBadgeSprite(`Y ${d.toFixed(1)} мм`, '', '#10b981');
        ySprite.position.set(aabb.maxX + 12.5, 0.4, midZ);
        objectRulerGroup.add(ySprite);

        // 4. Размерная стойка высоты Z сбоку от модели
        const zLineGeo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(aabb.minX - 4.5, 0, aabb.minZ),
            new THREE.Vector3(aabb.minX - 4.5, h, aabb.minZ),
            new THREE.Vector3(aabb.minX - 7.0, 0, aabb.minZ),
            new THREE.Vector3(aabb.minX - 2.0, 0, aabb.minZ),
            new THREE.Vector3(aabb.minX - 7.0, h, aabb.minZ),
            new THREE.Vector3(aabb.minX - 2.0, h, aabb.minZ)
        ]);
        objectRulerGroup.add(new THREE.LineSegments(zLineGeo, new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.75 })));
        const zSprite = createRulerBadgeSprite(`Z ${h.toFixed(1)} мм`, '', '#f59e0b');
        zSprite.position.set(aabb.minX - 12.5, h * 0.5, aabb.minZ);
        objectRulerGroup.add(zSprite);

        triggerSceneRender();
    }

    function toggleObjectRuler() {
        state.showObjectRuler = !state.showObjectRuler;
        const btn = document.getElementById('btn-ctx-ruler');
        if (btn) {
            btn.className = state.showObjectRuler
                ? "py-1 px-0.5 rounded-lg bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 flex flex-col items-center justify-center gap-0.5 transition"
                : "py-1 px-0.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 flex flex-col items-center justify-center gap-0.5 transition";
        }
        updateObjectRulerHelper();
        showToast(state.showObjectRuler ? "Линейка ВКЛ" : "Линейка ВЫКЛ");
    }

    function toggleSelectionRing() {
        state.showSelectionRing = !state.showSelectionRing;
        const btn = document.getElementById('btn-ctx-ring');
        if (btn) {
            btn.className = state.showSelectionRing
                ? "py-1 px-0.5 rounded-lg bg-emerald-500/25 text-emerald-300 border border-emerald-500/40 flex flex-col items-center justify-center gap-0.5 transition"
                : "py-1 px-0.5 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 flex flex-col items-center justify-center gap-0.5 transition";
        }
        updateSelectionVisuals();
        triggerSceneRender();
    }

    function toggleDragModelMode() {
        state.dragModelMode = !state.dragModelMode;
        const btn = document.getElementById('btn-ctx-drag');
        if (btn) {
            btn.className = state.dragModelMode
                ? "py-1 px-0.5 rounded-lg bg-cyan-500/25 text-cyan-300 border border-cyan-500/40 flex flex-col items-center justify-center gap-0.5 transition"
                : "py-1 px-0.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex flex-col items-center justify-center gap-0.5 transition";
        }
        showToast(state.dragModelMode ? "Режим перемещения: тяните модель" : "Режим вращения камеры");
    }

    function autoOrientSelectedModel(mode = 'flat') {
        if (!activeMesh && bedModels.length > 0) selectMesh(bedModels[0], true);
        if (!activeMesh) return;
        pushUndoSnapshot();
        const candidates = [
            [0, 0], [Math.PI / 2, 0], [-Math.PI / 2, 0],
            [Math.PI, 0], [0, Math.PI / 2], [0, -Math.PI / 2]
        ];
        let bestRx = 0, bestRz = 0, bestScore = -Infinity;
        const pos = activeMesh.geometry.attributes.position;
        const step = Math.max(1, Math.floor((pos.count / 3) / 2000));

        for (const [rx, rz] of candidates) {
            const tempGeo = activeMesh.geometry.clone();
            if (rx !== 0) tempGeo.rotateX(rx);
            if (rz !== 0) tempGeo.rotateZ(rz);
            tempGeo.computeBoundingBox();
            const b = tempGeo.boundingBox;
            const h = b.max.y - b.min.y;
            const w = b.max.x - b.min.x;
            const d = b.max.z - b.min.z;
            let bottomArea = 0;
            const pAttr = tempGeo.attributes.position;
            const minY = b.min.y;
            for (let i = 0; i < pAttr.count; i += 3 * step) {
                const y0 = pAttr.getY(i), y1 = pAttr.getY(i+1), y2 = pAttr.getY(i+2);
                if (Math.abs(y0 - minY) < 0.25 && Math.abs(y1 - minY) < 0.25 && Math.abs(y2 - minY) < 0.25) {
                    const ax = pAttr.getX(i+1) - pAttr.getX(i), az = pAttr.getZ(i+1) - pAttr.getZ(i);
                    const bx = pAttr.getX(i+2) - pAttr.getX(i), bz = pAttr.getZ(i+2) - pAttr.getZ(i);
                    bottomArea += Math.abs(ax * bz - az * bx) * 0.5;
                }
            }
            tempGeo.dispose();
            const score = (mode === 'low') ? (-h * 100 + w * d * 0.1) : (bottomArea * 10 - h * 0.5);
            if (score > bestScore) { bestScore = score; bestRx = rx; bestRz = rz; }
        }
        if (bestRx !== 0) activeMesh.geometry.rotateX(bestRx);
        if (bestRz !== 0) activeMesh.geometry.rotateZ(bestRz);
        activeMesh.geometry.computeVertexNormals();
        alignMeshToBedSurface();
        invalidateSlicedGcode();
        updateObjectRulerHelper();
        triggerSceneRender();
        showToast(mode === 'low' ? "Выбран низкий профиль" : "Уложено на плоскую грань");
    }

    function autoArrangeBedModels(mode = 'tetris', silent = false) {
        if (bedModels.length === 0) return;
        if (!silent) pushUndoSnapshot();
        const gap = (mode === 'safe' || state.brim) ? PRINT_LIMITS.safeGapBrimMM : PRINT_LIMITS.safeGapNoBrimMM;
        const items = bedModels.map(m => {
            const aabb = getMeshWorldAABBAt(m, 0, 0);
            return { mesh: m, w: aabb.maxX - aabb.minX, d: aabb.maxZ - aabb.minZ };
        });
        items.sort((a, b) => (b.w * b.d) - (a.w * a.d));

        const maxRowW = PRINTER_SPECS.bedX - PRINT_LIMITS.autoFitMarginMM * 2;
        let curX = 0;
        const rows = [[]];

        for (const it of items) {
            if (curX > 0 && curX + it.w > maxRowW) {
                rows.push([]);
                curX = 0;
            }
            rows[rows.length - 1].push(it);
            curX += it.w + gap;
        }

        const totalDepth = rows.reduce((sum, r) => sum + Math.max(...r.map(i => i.d)), 0) + (rows.length - 1) * gap;
        if (totalDepth > PRINTER_SPECS.bedY) showToast("⚠️ Детали не помещаются на стол");
        let zCursor = -totalDepth * 0.5;

        for (const r of rows) {
            const rWidth = r.reduce((sum, i) => sum + i.w, 0) + (r.length - 1) * gap;
            const rDepth = Math.max(...r.map(i => i.d));
            let xCursor = -rWidth * 0.5;
            for (const it of r) {
                const targetX = Number((xCursor + it.w * 0.5).toFixed(1));
                const targetZ = Number((zCursor + rDepth * 0.5).toFixed(1));
                it.mesh.position.set(targetX, 0, targetZ);
                xCursor += it.w + gap;
            }
            zCursor += rDepth + gap;
        }

        if (activeMesh) {
            state.posX = Number(activeMesh.position.x.toFixed(1));
            state.posY = Number((-activeMesh.position.z).toFixed(1));
            const inpX = document.getElementById('inp-pos-x'), inpY = document.getElementById('inp-pos-y');
            if (inpX) inpX.value = state.posX;
            if (inpY) inpY.value = state.posY;
        }
        invalidateSlicedGcode();
        updateDimensionsUI();
        updateSelectionVisuals();
        updateObjectRulerHelper();
        triggerSceneRender();
        if (!silent) showToast(`Разложено деталей: ${bedModels.length}`);
    }

    function fillBedMaxCopies() {
        const source = activeMesh || bedModels[0];
        if (!source) { showToast("Сначала добавьте модель"); return; }
        const brimExtraMM = state.brim ? (Math.max(1, state.brimLoops || 6) * (state.expert.lineWidth || 0.45) * 0.95) : 0;
        const gap = (state.brim ? PRINT_LIMITS.safeGapBrimMM : PRINT_LIMITS.safeGapNoBrimMM) + brimExtraMM;
        const aabb = getMeshWorldAABBAt(source, 0, 0);
        const w = aabb.maxX - aabb.minX;
        const d = aabb.maxZ - aabb.minZ;
        const usableW = PRINTER_SPECS.bedX - PRINT_LIMITS.autoFitMarginMM * 2;
        const usableD = PRINTER_SPECS.bedY - PRINT_LIMITS.autoFitMarginMM * 2;
        const cols = Math.max(1, Math.floor((usableW + gap) / (w + gap)));
        const rows = Math.max(1, Math.floor((usableD + gap) / (d + gap)));
        const maxTotal = Math.min(25, cols * rows);

        if (maxTotal <= bedModels.length) {
            autoArrangeBedModels('tetris', true);
            showToast(`На столе уже максимум (${bedModels.length} шт.)`);
            return;
        }
        const toAdd = maxTotal - bedModels.length;
        for (let i = 0; i < toAdd; i++) {
            const newMesh = new THREE.Mesh(source.geometry.clone(), source.material.clone());
            newMesh.scale.copy(source.scale);
            newMesh.rotation.copy(source.rotation);
            newMesh.userData.name = `${source.userData.name || 'Model'} #${bedModels.length + 1}`;
            scene.add(newMesh);
            bedModels.push(newMesh);
        }
                autoArrangeBedModels('tetris', true);
        selectMesh(source, true);
        showToast(`Стол заполнен: ${bedModels.length} шт.`);
    }
