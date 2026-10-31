/* ====================================================================
 * 4. SLICER CORE & G-CODE PREVIEW (Ядро нарезки, Ender 3 V3 SE и Слои)
 * ==================================================================== */

function expVal(key, def) {
    const v = state.expert ? state.expert[key] : undefined;
    return (typeof v === 'number' && isFinite(v)) ? v : def;
}

function invalidateSlicedGcode() {
    state.generatedGcode = '';
    state.gcodeChunks = [];
    state.slicedLayers = [];
    state.lastSliceStats = null;
    window._projectDirty = true;
    const resBar = document.getElementById('slice-result-bar');
    if (resBar) resBar.classList.add('hidden');
    if (state.activeTab === 'gcode' && typeof updateInlineGcodeViewer === 'function') updateInlineGcodeViewer();
}

function clearSlicedGcodeState() {
    state.generatedGcode = '';
    state.gcodeChunks = [];
    state.slicedLayers = [];
    state.lastSliceStats = null;
    const resBar = document.getElementById('slice-result-bar');
    if (resBar) resBar.classList.add('hidden');
    if (gcodeGroup) {
        while (gcodeGroup.children.length > 0) {
            const lg = gcodeGroup.children[0];
            lg.traverse(n => {
                if (n.geometry) n.geometry.dispose();
                if (n.material) n.material.dispose();
            });
            gcodeGroup.remove(lg);
        }
        gcodeGroup.visible = false;
    }
    setViewportMode('model');
    updateInlineGcodeViewer();
    showToast("🗑️ G-Code удалён");
}

function deleteSlicedGcode() {
    if (!state.generatedGcode && state.slicedLayers.length === 0) {
        showToast("Нет G-кода");
        return;
    }
    clearSlicedGcodeState();
}

// ==== Slicer core ====
function intersectTriangleWithY(v0, v1, v2, y) {
    const pts = [];
    const ie = (a, b) => {
        if ((a.y <= y && b.y > y) || (b.y <= y && a.y > y)) {
            const dy = b.y - a.y;
            if (Math.abs(dy) < 1e-9) return null;
            const t = (y - a.y) / dy;
            return { x: a.x + t * (b.x - a.x), z: a.z + t * (b.z - a.z) };
        }
        return null;
    };
    const p1 = ie(v0, v1), p2 = ie(v1, v2), p3 = ie(v2, v0);
    if (p1) pts.push(p1);
    if (p2) pts.push(p2);
    if (p3) pts.push(p3);
    if (pts.length < 2) return null;
    if (Math.hypot(pts[0].x - pts[1].x, pts[0].z - pts[1].z) < 1e-5) {
        if (pts.length === 3 && Math.hypot(pts[0].x - pts[2].x, pts[0].z - pts[2].z) >= 1e-5) {
            return { p1: pts[0], p2: pts[2] };
        }
        return null;
    }
    return { p1: pts[0], p2: pts[1] };
}

function buildClosedContours(rawSegs) {
    if (!rawSegs || rawSegs.length === 0) return [];
    const validSegs = rawSegs.filter(s => Math.hypot(s.p2.x - s.p1.x, s.p2.z - s.p1.z) > 1e-4);
    const used = new Array(validSegs.length).fill(false);
    const contours = [];
    const SNAP_TOL = 0.05;

    for (let i = 0; i < validSegs.length; i++) {
        if (used[i]) continue;
        used[i] = true;
        const path = [validSegs[i].p1, validSegs[i].p2];

        let extended = true;
        while (extended) {
            extended = false;
            const head = path[0];
            const tail = path[path.length - 1];
            if (path.length > 3 && Math.hypot(tail.x - head.x, tail.z - head.z) < 0.04) break;

            let bestIdx = -1, bestDist = SNAP_TOL, attachToHead = false, flipSeg = false;
            for (let j = 0; j < validSegs.length; j++) {
                if (used[j]) continue;
                const s = validSegs[j];
                const dT1 = Math.hypot(s.p1.x - tail.x, s.p1.z - tail.z);
                if (dT1 < bestDist) { bestDist = dT1; bestIdx = j; attachToHead = false; flipSeg = false; }
                const dT2 = Math.hypot(s.p2.x - tail.x, s.p2.z - tail.z);
                if (dT2 < bestDist) { bestDist = dT2; bestIdx = j; attachToHead = false; flipSeg = true; }
                const dH1 = Math.hypot(s.p2.x - head.x, s.p2.z - head.z);
                if (dH1 < bestDist) { bestDist = dH1; bestIdx = j; attachToHead = true; flipSeg = false; }
                const dH2 = Math.hypot(s.p1.x - head.x, s.p1.z - head.z);
                if (dH2 < bestDist) { bestDist = dH2; bestIdx = j; attachToHead = true; flipSeg = true; }
            }

            if (bestIdx !== -1) {
                used[bestIdx] = true;
                const seg = validSegs[bestIdx];
                if (!attachToHead) path.push(flipSeg ? seg.p1 : seg.p2);
                else path.unshift(flipSeg ? seg.p2 : seg.p1);
                extended = true;
            }
        }

        if (path.length >= 3) {
            const first = path[0], last = path[path.length - 1];
            if (Math.hypot(last.x - first.x, last.z - first.z) > 0.01) {
                path.push({ x: first.x, z: first.z });
            }
            contours.push(path);
        }
    }

    if (typeof ClipperLib !== 'undefined' && contours.length > 0) {
        const SCALE = 1000;
        const cpr = new ClipperLib.Clipper();
        for (const c of contours) {
            const pts = c.slice(0, c.length - 1).map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.z * SCALE) }));
            const cleaned = ClipperLib.Clipper.CleanPolygon(pts, 2);
            if (cleaned && cleaned.length >= 3) {
                cpr.AddPath(cleaned, ClipperLib.PolyType.ptSubject, true);
            }
        }
        const sol = new ClipperLib.Paths();
        cpr.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
        if (sol && sol.length > 0) {
            return sol.filter(p => p.length >= 3).map(p => {
                const ring = p.map(pt => ({ x: pt.X / SCALE, z: pt.Y / SCALE }));
                ring.push({ x: ring[0].x, z: ring[0].z });
                return ring;
            });
        }
    }
    return contours;
}

function createInsetContours(contoursInput, insetDist) {
    if (!contoursInput || contoursInput.length === 0 || typeof ClipperLib === 'undefined') return [];
    const SCALE = 1000;
    const ringList = Array.isArray(contoursInput[0]) ? contoursInput : [contoursInput];
    const cleanPaths = [];

    for (const pts of ringList) {
        if (!pts || pts.length < 3) continue;
        const isClosed = Math.hypot(pts[0].x - pts[pts.length - 1].x, pts[0].z - pts[pts.length - 1].z) < 0.25;
        const srcRing = isClosed ? pts.slice(0, pts.length - 1) : pts.slice();
        if (srcRing.length < 3) continue;
        const clPath = srcRing.map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.z * SCALE) }));
        const clean = ClipperLib.Clipper.CleanPolygon(clPath, 2);
        if (clean && clean.length >= 3) cleanPaths.push(clean);
    }

    if (cleanPaths.length === 0) return [];

    const co = new ClipperLib.ClipperOffset(2.4, 180);
    co.AddPaths(cleanPaths, ClipperLib.JoinType.jtMiter, ClipperLib.EndType.etClosedPolygon);
    
    const solution = new ClipperLib.Paths();
    co.Execute(solution, -insetDist * SCALE);
    if (!solution) return [];

    const out = [];
    for (const solPath of solution) {
        if (!solPath || solPath.length < 3) continue;
        const ringPts = solPath.map(pt => ({ x: pt.X / SCALE, z: pt.Y / SCALE }));
        ringPts.push({ x: ringPts[0].x, z: ringPts[0].z });
        out.push(ringPts);
    }
    return out;
}

function contourToSegs(pts, isClosedLoop = false) {
    const segs = [];
    const n = pts.length - 1;
    for (let i = 0; i < n; i++) {
        if (Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z) > 1e-4) { 
            segs.push({ p1: pts[i], p2: pts[i + 1], isLoopEnd: false });
        }
    }
    if (segs.length > 0 && isClosedLoop) segs[segs.length - 1].isLoopEnd = true;
    return segs;
}

function generateLinesInfill(boundarySegs, minX, maxX, minZ, maxZ, angleDeg, spacing) {
    const rad = (angleDeg * Math.PI) / 180;
    const cosA = Math.cos(rad), sinA = Math.sin(rad);
    const cx = (minX + maxX) * 0.5, cz = (minZ + maxZ) * 0.5;
    
    const rotSegs = new Array(boundarySegs.length);
    for (let i = 0; i < boundarySegs.length; i++) {
        const s = boundarySegs[i];
        const dx1 = s.p1.x - cx, dz1 = s.p1.z - cz, dx2 = s.p2.x - cx, dz2 = s.p2.z - cz;
        const p1 = { u: dx1 * cosA + dz1 * sinA, v: -dx1 * sinA + dz1 * cosA };
        const p2 = { u: dx2 * cosA + dz2 * sinA, v: -dx2 * sinA + dz2 * cosA };
        rotSegs[i] = { p1, p2, minV: Math.min(p1.v, p2.v), maxV: Math.max(p1.v, p2.v) };
    }
    
    const maxR = Math.hypot(maxX - minX, maxZ - minZ) * 0.56;
    const segs = [];
    let toggle = false;
    const safeSpacing = Math.max(0.1, spacing);
    
// Смещение +0.000137 исключает попадание луча ровно в целочисленные вершины Clipper,
    // а отказ от uniqueHits сохраняет строгую чётность пересечений (внутри/снаружи)
    for (let v = -maxR + 0.000137; v <= maxR; v += safeSpacing) {
        const hits = [];
        for (let i = 0; i < rotSegs.length; i++) {
            const s = rotSegs[i];
            if (v >= s.minV && v < s.maxV) {
                const t = (v - s.p1.v) / (s.p2.v - s.p1.v);
                hits.push(s.p1.u + t * (s.p2.u - s.p1.u));
            }
        }
        if (hits.length < 2) continue;
        hits.sort((a, b) => a - b);

        const pairs = [];
        for (let k = 0; k + 1 < hits.length; k += 2) {
            const u1 = hits[k] + 0.03;
            const u2 = hits[k + 1] - 0.03;
            if (u2 - u1 > 0.04) {
                const pS = { x: cx + (u1 * cosA - v * sinA), z: cz + (u1 * sinA + v * cosA) };
                const pE = { x: cx + (u2 * cosA - v * sinA), z: cz + (u2 * sinA + v * cosA) };
                pairs.push(toggle ? { p1: pE, p2: pS } : { p1: pS, p2: pE });
            }
        }
        if (toggle) pairs.reverse();

        for (let i = 0; i < pairs.length; i++) {
            segs.push(pairs[i]);
        }
        toggle = !toggle;
    }
    return segs;
}

async function collectTriangles(bedModels, onProgress) {
    let totalTris = 0;
    bedModels.forEach(m => {
        if (m.geometry.attributes.position) totalTris += Math.floor(m.geometry.attributes.position.count / 3);
    });
    const flat = new Float32Array(totalTris * 9);
    const overhang = [];
    const needOverhang = Boolean(state.supports);
    const critSlope = -Math.sin((state.supportOverhangAngle * Math.PI) / 180);
    let processed = 0, lastYield = 0, ptr = 0;

    for (const mesh of bedModels) {
        const posAttr = mesh.geometry.attributes.position;
        if (!posAttr) continue;
        const s = mesh.scale.x, px = mesh.position.x, pz = mesh.position.z;
        const triCount = Math.floor(posAttr.count / 3);
        for (let i = 0; i < triCount; i++) {
            const i3 = i * 3;
            const x0 = posAttr.getX(i3) * s + px,     y0 = posAttr.getY(i3) * s,     z0 = posAttr.getZ(i3) * s + pz;
            const x1 = posAttr.getX(i3 + 1) * s + px, y1 = posAttr.getY(i3 + 1) * s, z1 = posAttr.getZ(i3 + 1) * s + pz;
            const x2 = posAttr.getX(i3 + 2) * s + px, y2 = posAttr.getY(i3 + 2) * s, z2 = posAttr.getZ(i3 + 2) * s + pz;
            flat[ptr]     = x0; flat[ptr + 1] = y0; flat[ptr + 2] = z0;
            flat[ptr + 3] = x1; flat[ptr + 4] = y1; flat[ptr + 5] = z1;
            flat[ptr + 6] = x2; flat[ptr + 7] = y2; flat[ptr + 8] = z2;
            ptr += 9;

            if (needOverhang) {
                const yMin = Math.min(y0, y1, y2);
                if (yMin > 1.2) {
                    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
                    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
                    const ny = az * bx - ax * bz;
                    const nLen = Math.hypot(ay * bz - az * by, ny, ax * by - ay * bx) || 1;
                    if ((ny / nLen) < critSlope) {
                        overhang.push({
                            v0: { x: x0, y: y0, z: z0 },
                            v1: { x: x1, y: y1, z: z1 },
                            v2: { x: x2, y: y2, z: z2 },
                            yMin
                        });
                    }
                }
            }
            processed++;
            if (onProgress && processed - lastYield >= 4096) {
                lastYield = processed;
                await onProgress(processed, totalTris);
            }
        }
    }
    return { flat, overhang };
}

async function sliceLayers(flatTris, tasks, maybeYield, isHeavy) {
    const results = [];
    const triCount = flatTris.length / 9;
    const taskCount = tasks.length;

    const buckets = new Array(taskCount);
    for (let i = 0; i < taskCount; i++) buckets[i] = [];
    const firstTaskAtOrAbove = (y) => {
        let lo = 0, hi = taskCount;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (tasks[mid].ySlice < y) lo = mid + 1; else hi = mid;
        }
        return lo;
    };
    for (let t = 0; t < triCount; t++) {
        const b = t * 9;
        const ya = flatTris[b + 1], yb = flatTris[b + 4], yc = flatTris[b + 7];
        const yMin = Math.min(ya, yb, yc), yMax = Math.max(ya, yb, yc);
        for (let k = firstTaskAtOrAbove(yMin); k < taskCount && tasks[k].ySlice <= yMax; k++) buckets[k].push(t);
        if (maybeYield && (t & 0x3FFFF) === 0x3FFFF) {
            await maybeYield(8, "Индексация треугольников...", `${t.toLocaleString('ru-RU')} / ${triCount.toLocaleString('ru-RU')}`, "CPU", isHeavy);
        }
    }

    for (let i = 0; i < taskCount; i++) {
        const task = tasks[i];
        const bucket = buckets[i];
        const rawSegs = [];
        let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
        for (let n = 0; n < bucket.length; n++) {
            const b = bucket[n] * 9;
            const seg = intersectTriangleWithY(
                { x: flatTris[b],     y: flatTris[b + 1], z: flatTris[b + 2] },
                { x: flatTris[b + 3], y: flatTris[b + 4], z: flatTris[b + 5] },
                { x: flatTris[b + 6], y: flatTris[b + 7], z: flatTris[b + 8] }, task.ySlice
            );
            if (seg) {
                rawSegs.push(seg);
                minX = Math.min(minX, seg.p1.x, seg.p2.x); maxX = Math.max(maxX, seg.p1.x, seg.p2.x);
                minZ = Math.min(minZ, seg.p1.z, seg.p2.z); maxZ = Math.max(maxZ, seg.p1.z, seg.p2.z);
            }
        }
        buckets[i] = null;
        const contours = buildClosedContours(rawSegs);
        results.push({ l: task.l, h: task.h, dH: task.dH, contours, minX, maxX, minZ, maxZ });
        if ((i & 7) === 0 && maybeYield) {
            const pct = 8 + ((i + 1) / taskCount) * 30;
            await maybeYield(pct, "Сечение слоёв...", `Слой ${i + 1} из ${taskCount}`, "CPU", isHeavy);
            await new Promise(r => setTimeout(r, 0));
        }
    }
    return results;
}

// ==== Математические утилиты Clipper ====
function ringsToClipperClean(rings, scale = 1000) {
    if (!rings || rings.length === 0 || typeof ClipperLib === 'undefined') return [];
    const cpr = new ClipperLib.Clipper();
    for (let r = 0; r < rings.length; r++) {
        const ring = rings[r];
        if (!ring || ring.length < 3) continue;
        const isClosed = Math.hypot(ring[0].x - ring[ring.length - 1].x, ring[0].z - ring[ring.length - 1].z) < 0.1;
        const src = isClosed ? ring.slice(0, ring.length - 1) : ring;
        if (src.length < 3) continue;
        const pts = src.map(p => ({ X: Math.round(p.x * scale), Y: Math.round(p.z * scale) }));
        const cleaned = ClipperLib.Clipper.CleanPolygon(pts, 2);
        if (cleaned && cleaned.length >= 3) {
            cpr.AddPath(cleaned, ClipperLib.PolyType.ptSubject, true);
        }
    }
    const sol = new ClipperLib.Paths();
    cpr.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
    return sol || [];
}

function clipperOp(clipType, subjPaths, clipPaths, fillType = ClipperLib.PolyFillType.pftEvenOdd) {
    const hasSubj = Array.isArray(subjPaths) && subjPaths.length > 0;
    const hasClip = Array.isArray(clipPaths) && clipPaths.length > 0;
    if (!hasSubj) {
        if (clipType === ClipperLib.ClipType.ctUnion) return hasClip ? clipPaths.slice() : [];
        return [];
    }
    if (!hasClip) {
        if (clipType === ClipperLib.ClipType.ctDifference || clipType === ClipperLib.ClipType.ctUnion) return subjPaths.slice();
        if (clipType === ClipperLib.ClipType.ctIntersection) return [];
    }
    const cpr = new ClipperLib.Clipper();
    cpr.AddPaths(subjPaths, ClipperLib.PolyType.ptSubject, true);
    cpr.AddPaths(clipPaths, ClipperLib.PolyType.ptClip, true);
    const sol = new ClipperLib.Paths();
    cpr.Execute(clipType, sol, fillType, fillType);
    return sol || [];
}

function clipperToSegsAndBox(paths, scale = 1000) {
    const segs = [];
    let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
    for (let pIdx = 0; pIdx < paths.length; pIdx++) {
        const poly = paths[pIdx];
        if (!poly || poly.length < 3) continue;
        for (let i = 0; i < poly.length; i++) {
            const next = (i + 1) % poly.length;
            const p1 = { x: poly[i].X / scale, z: poly[i].Y / scale };
            const p2 = { x: poly[next].X / scale, z: poly[next].Y / scale };
            if (p1.x !== p2.x || p1.z !== p2.z) {
                segs.push({ p1, p2, isLoopEnd: false });
                bx0 = Math.min(bx0, p1.x, p2.x); bx1 = Math.max(bx1, p1.x, p2.x);
                bz0 = Math.min(bz0, p1.z, p2.z); bz1 = Math.max(bz1, p1.z, p2.z);
            }
        }
    }
    return { segs, minX: bx0, maxX: bx1, minZ: bz0, maxZ: bz1 };
}

function isTravelCrossingAir(x1, z1, x2, z2, safePolys, scale = 1000) {
    if (!safePolys || safePolys.length === 0) return true;
    const dist = Math.hypot(x2 - x1, z2 - z1);
    if (dist < 0.45) return false;
    // Проверяем линию переезда каждые 0.35 мм, чтобы не пропустить ни одну тонкую стенку или букву
    const steps = Math.max(3, Math.min(60, Math.ceil(dist / 0.35)));
    for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const pt = { X: Math.round((x1 + (x2 - x1) * t) * scale), Y: Math.round((z1 + (z2 - z1) * t) * scale) };
        let inside = false;
        for (let p = 0; p < safePolys.length; p++) {
            const res = ClipperLib.Clipper.PointInPolygon(pt, safePolys[p]);
            if (res !== 0) inside = !inside;
        }
        if (!inside) return true;
    }
    return false;
}

function optimizePath(segs, startX, startY) {
    if (!segs || segs.length < 2) return segs;
    if (segs.length > 2500) return segs;

    const cx = PRINTER_SPECS.bedX / 2;
    const cy = PRINTER_SPECS.bedY / 2;

    const chains = [];
    let curChain = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
        const prev = curChain[curChain.length - 1];
        const curr = segs[i];
        if (Math.hypot(curr.p1.x - prev.p2.x, curr.p1.z - prev.p2.z) < 0.08) {
            curChain.push(curr);
        } else {
            chains.push(curChain);
            curChain = [curr];
        }
    }
    chains.push(curChain);

    const used = new Array(chains.length).fill(false);
    const optimized = [];
    let curGx = startX === null ? (chains[0][0].p1.x + cx) : startX;
    let curGy = startY === null ? (cy - chains[0][0].p1.z) : startY;

    for (let step = 0; step < chains.length; step++) {
        let bestIdx = -1, bestDist = Infinity, flipChain = false;
        for (let i = 0; i < chains.length; i++) {
            if (used[i]) continue;
            const ch = chains[i];
            const firstSeg = ch[0];
            const lastSeg = ch[ch.length - 1];
            const isClosed = Math.hypot(firstSeg.p1.x - lastSeg.p2.x, firstSeg.p1.z - lastSeg.p2.z) < 0.1;

            const s1x = firstSeg.p1.x + cx, s1y = cy - firstSeg.p1.z;
            const d1 = Math.hypot(s1x - curGx, s1y - curGy);
            if (d1 < bestDist) { bestDist = d1; bestIdx = i; flipChain = false; }

            if (!isClosed) {
                const s2x = lastSeg.p2.x + cx, s2y = cy - lastSeg.p2.z;
                const d2 = Math.hypot(s2x - curGx, s2y - curGy);
                if (d2 < bestDist) { bestDist = d2; bestIdx = i; flipChain = true; }
            }
        }

        if (bestIdx === -1) break;
        used[bestIdx] = true;
        const chosen = chains[bestIdx];
        if (flipChain) {
            for (let k = chosen.length - 1; k >= 0; k--) {
                const s = chosen[k];
                optimized.push({ p1: s.p2, p2: s.p1, isLoopEnd: s.isLoopEnd });
            }
        } else {
            for (let k = 0; k < chosen.length; k++) optimized.push(chosen[k]);
        }
        const tail = optimized[optimized.length - 1];
        curGx = tail.p2.x + cx;
        curGy = cy - tail.p2.z;
    }
    return optimized;
}

// ==== Ender 3 V3 SE G-code generator ====
async function generateKlipperGcode(layers, profile, maybeYield = null, isHeavy = false) {
    const lines = [], chunks = [];
    let totalLines = 0;
    const flush = () => {
        if (lines.length > 0) {
            totalLines += lines.length;
            chunks.push(lines.join('\n') + '\n');
            lines.length = 0;
        }
    };

    const filamentArea = Math.PI * Math.pow(expVal('filamentDiameter', 1.75) / 2, 2);
    const cx = PRINTER_SPECS.bedX / 2;
    const cy = PRINTER_SPECS.bedY / 2;

const exp = state.expert || {};
    const retractLen = Number((profile.retractDist || 0.6).toFixed(2));
    const retractSpeed = Math.min(3600, profile.retractSpeed || 1500); // Предел 60 мм/с, обычно 25–40
    const retractMinTravel = expVal('retractMinTravel', 0.6);
    const retractLongTravel = expVal('retractLongTravel', 25.0);
    const SM = (typeof getSafetyMode === 'function') ? getSafetyMode() : { speed: 1, accel: 1, travel: 4800, flow: 1 };
    if (expVal('travelSpeed', 0) > 0) SM.travel = Math.round(expVal('travelSpeed', 0) * 60);
    SM.accel = SM.accel * (expVal('accelPct', 100) / 100);
    const isPLAlike = (state.material === 'PLA');
    const modeSpeedMult = isPLAlike ? SM.speed : Math.min(SM.speed, 1.0);
    const travelSpeed = isPLAlike ? SM.travel : Math.min(SM.travel, 6000);
    const paVal = exp.pressureAdvance !== undefined ? exp.pressureAdvance : (profile.pressureAdvance !== undefined ? profile.pressureAdvance : 0.04);

    const maxSafeTemp = exp.hotendType === 'ceramic' ? 300 : 260;
    const steelBonus = exp.nozzleType === 'steel' ? 5 : 0;
    const workNozzleTemp = Math.min(maxSafeTemp, profile.nozzleTemp + steelBonus);
    const bedTemp = profile.bedTemp;

    const globalFlowMult = Math.max(0.5, Math.min(1.5, ((exp.flowRate || 95) / 100)));
    const zOffset = Number((exp.zOffset || 0.0).toFixed(3));
    const maxVolFlow = Math.max(2.0, parseFloat(profile.maxFlow || 18.0)) * (isPLAlike ? SM.flow : 1);

    const baseLineW = Math.max(0.28, Math.min(0.80, parseFloat(exp.lineWidth || 0.45)));
    const outerWallWidth = Number((baseLineW * 0.93).toFixed(2));
    const innerWallWidth = baseLineW;
    const sparseInfillWidth = baseLineW;
    const solidInfillWidth = Number((baseLineW * 0.93).toFixed(2));
    const firstLayerWidth = Number(Math.max(0.48, baseLineW * (expVal('firstLayerWidthPct', 110) / 100)).toFixed(2));

    const baseSpd = Math.max(20, (profile.printSpeed || 180) * modeSpeedMult);
    const capFeed = (targetMMS, w, h) => {
        const maxMMSByFlow = maxVolFlow / Math.max(0.02, w * h);
        const finalMMS = Math.max(15, Math.min(targetMMS, maxMMSByFlow));
        return Math.round(finalMMS * 60);
    };

    const calcStadiumArea = (w, h) => (w - h) * h + Math.PI * Math.pow(h * 0.5, 2);
    const calcE = (dist, w, h, flowMult = 1.0) => ((dist * calcStadiumArea(w, h)) / filamentArea) * flowMult * globalFlowMult;

    const stats = {
        outer: { label: 'Внешняя стенка', color: '#fb923c', timeSec: 0, eMM: 0 },
        inner: { label: 'Внутр. стенка', color: '#facc15', timeSec: 0, eMM: 0 },
        solid: { label: 'Крышки и дно', color: '#c084fc', timeSec: 0, eMM: 0 },
        sparse: { label: 'Заполнение', color: '#f43f5e', timeSec: 0, eMM: 0 },
        extra: { label: 'Кайма / Подд.', color: '#10b981', timeSec: 0, eMM: 0 },
        travel: { label: 'Переезды / Ретр.', color: '#38bdf8', timeSec: 0, eMM: 0 },
        retractCount: 0, totalE: 0, totalGrams: 0
    };

    let gcodeMinX = Infinity, gcodeMaxX = -Infinity;
    let gcodeMinY = Infinity, gcodeMaxY = -Infinity;
    let bMaxY = 0;

    bedModels.forEach(m => {
        const s = m.scale.x;
        m.geometry.computeBoundingBox();
        const box = m.geometry.boundingBox;

        const minX = (box.min.x * s) + m.position.x + cx;
        const maxX = (box.max.x * s) + m.position.x + cx;
        const minY = cy - ((box.max.z * s) + m.position.z);
        const maxY = cy - ((box.min.z * s) + m.position.z);

        gcodeMinX = Math.min(gcodeMinX, minX);
        gcodeMaxX = Math.max(gcodeMaxX, maxX);
        gcodeMinY = Math.min(gcodeMinY, minY);
        gcodeMaxY = Math.max(gcodeMaxY, maxY);
        bMaxY = Math.max(bMaxY, (box.max.y - box.min.y) * s);
    });

    const objCenterX = Number(((gcodeMinX + gcodeMaxX) * 0.5).toFixed(2));
    const objCenterY = Number(((gcodeMinY + gcodeMaxY) * 0.5).toFixed(2));

lines.push(`; HEADER_BLOCK_START`);
    lines.push(`; generated by Salim Slicer Pro V3.0 (Ender 3 V3 SE Master) on ${new Date().toISOString().slice(0,19).replace('T',' ')}`);
    lines.push(`; total layer number: ${layers.length}`);

    // Вставка миниатюры для дисплея принтера
    if (typeof generateGcodeThumbnailBase64 === 'function') {
        const b64 = generateGcodeThumbnailBase64(200);
        if (b64) {
            lines.push(`; thumbnail begin 200x200 ${b64.length}`);
            for (let i = 0; i < b64.length; i += 78) {
                lines.push(`; ${b64.slice(i, i + 78)}`);
            }
            lines.push(`; thumbnail end`);
        }
    }
    lines.push(`; filament_density: ${(profile.density || 1.24).toFixed(2)}`);
    lines.push(`; filament_diameter: ${expVal('filamentDiameter', 1.75).toFixed(2)}`);
    lines.push(`; max_z_height: ${bMaxY.toFixed(2)}`);
    lines.push(`; HEADER_BLOCK_END`);
    lines.push(``);
    lines.push(`; MINX = ${gcodeMinX.toFixed(2)}`);
    lines.push(`; MINY = ${gcodeMinY.toFixed(2)}`);
    lines.push(`; MINZ = 0.00`);
    lines.push(`; MAXX = ${gcodeMaxX.toFixed(2)}`);
    lines.push(`; MAXY = ${gcodeMaxY.toFixed(2)}`);
    lines.push(`; MAXZ = ${bMaxY.toFixed(2)}`);
    lines.push(`; OBJECTS_BOUNDING = ${gcodeMinX.toFixed(2)},${gcodeMinY.toFixed(2)},0.00,${gcodeMaxX.toFixed(2)},${gcodeMaxY.toFixed(2)},${bMaxY.toFixed(2)}`);
    lines.push(`; WIPE_TOWER_BOUNDING = 0.00,0.00,0.00,0.00,0.00,0.00`);
    lines.push(``);
    lines.push(`; EXECUTABLE_BLOCK_START`);
    lines.push(`EXCLUDE_OBJECT_DEFINE NAME=Object_1_id_0_copy_0 CENTER=${objCenterX},${objCenterY} POLYGON=[[${gcodeMinX.toFixed(2)},${gcodeMinY.toFixed(2)}],[${gcodeMaxX.toFixed(2)},${gcodeMinY.toFixed(2)}],[${gcodeMaxX.toFixed(2)},${gcodeMaxY.toFixed(2)}],[${gcodeMinX.toFixed(2)},${gcodeMaxY.toFixed(2)}],[${gcodeMinX.toFixed(2)},${gcodeMinY.toFixed(2)}]]`);

// Мягкое прохождение углов (5 мм/с) полностью убирает удары стола на резких поворотах
    const scvVal = exp.cornerReinforce ? 4 : 5; 
    const estMin = Math.max(1, Math.round(layers.length * 15 / 60));
    lines.push(`; max_print_temp = ${bedTemp},${workNozzleTemp}`);
    lines.push(`;TYPE:Custom`);
    lines.push(`T0`);
    lines.push(`G90`);
    lines.push(`G21`);
    lines.push(`M83`);
    lines.push(``);
    lines.push(`; ==== Стандартные процедуры (Нагрев, Парковка) ====`);
    lines.push(`M140 S${bedTemp} ; Установка температуры стола`);
    lines.push(`M104 S${workNozzleTemp} ; Установка температуры сопла`);
    lines.push(`G28 ; Парковка (Homing) по всем осям`);
    lines.push(`M190 S${bedTemp} ; Ожидание нагрева стола`);
    lines.push(`M109 S${workNozzleTemp} ; Ожидание нагрева сопла`);
    lines.push(``);
    lines.push(`; ==== Очистка сопла (Purge Line) ====`);
    lines.push(`G92 E0 ; Сброс экструдера`);
    lines.push(`G1 Z2.0 F3000 ; Поднятие оси Z`);
    lines.push(`G1 X5.0 Y20 Z0.3 F5000.0 ; Движение к краю стола`);
    lines.push(`G1 X5.0 Y150.0 Z0.3 F1500.0 E15 ; Первая линия очистки`);
    lines.push(`G1 X5.4 Y150.0 Z0.3 F5000.0 ; Сдвиг в сторону`);
    lines.push(`G1 X5.4 Y20 Z0.3 F1500.0 E30 ; Вторая линия очистки`);
    lines.push(`G92 E0 ; Сброс экструдера после очистки`);
    lines.push(`G1 Z2.0 F3000 ; Поднятие оси Z перед печатью`);
    lines.push(``);
    lines.push(`; ==== Pressure Advance ====`);
    lines.push(`SET_PRESSURE_ADVANCE ADVANCE=${Number(paVal).toFixed(3)}`);
    lines.push(``);
    lines.push(`; ==== Щадящие лимиты механики (Защита валов и ремней) ====`);
    lines.push(`SET_VELOCITY_LIMIT ACCEL=2000 ACCEL_TO_DECEL=1000 SQUARE_CORNER_VELOCITY=${scvVal}`);
    lines.push(`M204 P2000 T2500 ; Лимит ускорений для стоковой прошивки Marlin`);
    lines.push(``);
    lines.push(`M73 P0 R${estMin}`);
    lines.push(`M106 S0`);
    lines.push(`M106 P2 S0`);
    lines.push(`G1 E-${retractLen} F${retractSpeed}`);

    let isRetracted = true;
    let retractedAmount = retractLen;
    let lastX = null, lastY = null;
    let lastFanPwm = 0;
    let auxFanOn = false;
    let currentGlobalAccel = 2000;
    let totalTime = 200;

    for (let idx = 0; idx < layers.length; idx++) {
        const layer = layers[idx];
        const zVal = Number(Math.max(0.05, layer.h + zOffset).toFixed(3));
        const dH = layer.dH || 0.20;
        const isFirst = (idx === 0);

        let layerTravelSpeed = travelSpeed;
        let layerRetractSpeed = retractSpeed;
        let layerRetractLen = retractLen;

        if (exp.yHeightDampening !== false && zVal > 40) {
            const dampFactor = Math.max(0.5, 1.0 - ((zVal - 40) / 180)); 
            layerTravelSpeed = Math.round(travelSpeed * dampFactor);
            layerRetractSpeed = Math.round(retractSpeed * dampFactor);
            layerRetractLen = Number((retractLen * (0.8 + dampFactor * 0.2)).toFixed(2));
        }

        if (!isFirst && lastX !== null && !isRetracted && !exp.vaseMode && exp.retractOnLayerChange !== false) {
            lines.push(`;WIPE_START`);
            lines.push(`G1 E-${layerRetractLen} F${layerRetractSpeed}`);
            lines.push(`;WIPE_END`);
            isRetracted = true;
            retractedAmount = layerRetractLen;
            stats.retractCount++;
        }

        const fanTargetPct = Math.min(100, Math.max(0, profile.fanSpeed !== undefined ? profile.fanSpeed : 100));
        let fanPct = 0;
        
        if (idx === 0) {
            fanPct = 0; 
        } else if (state.mode === 'speed') {
            fanPct = fanTargetPct;
        } else if (state.mode === 'quality') {
            if (idx === 1) fanPct = Math.round(fanTargetPct * 0.25);
            else if (idx === 2) fanPct = Math.round(fanTargetPct * 0.50);
            else if (idx === 3) fanPct = Math.round(fanTargetPct * 0.75);
            else fanPct = fanTargetPct;
        } else {
            if (idx === 1) fanPct = Math.round(fanTargetPct * 0.40);
            else if (idx === 2) fanPct = Math.round(fanTargetPct * 0.70);
            else fanPct = fanTargetPct;
        }
        const fanPwm = Math.round(255 * fanPct / 100);
        if (idx > 0 && fanPwm !== lastFanPwm) {
            lines.push(`M106 S${fanPwm}`);
            lastFanPwm = fanPwm;
        }

        if (idx >= 2 && state.material === 'PLA' && fanTargetPct >= 80 && !auxFanOn && exp.auxFan !== false) {
            lines.push(`M106 P2 S180`);
            auxFanOn = true;
        }

        lines.push(`;LAYER_CHANGE`);
        lines.push(`;Z:${zVal}`);
        lines.push(`;HEIGHT:${dH}`);
        lines.push(`;BEFORE_LAYER_CHANGE`);
        lines.push(`;${zVal}`);
        lines.push(`G92 E0`);
        lines.push(``);
        lines.push(`;AFTER_LAYER_CHANGE`);
        lines.push(`;${zVal}`);
        lines.push(`;_SET_FAN_SPEED_CHANGING_LAYER`);

        // Плавное снижение ускорений с ростом высоты модели (всегда активно для бережной печати)
        let heightDampMult = SM.accel;
        if (exp.yHeightDampening !== false && zVal > 45) {
            heightDampMult = Math.max(0.50, 1.0 - ((zVal - 45) / 180) * 0.50) * SM.accel;
        }

        const baseLayerAccel = isFirst ? 800 : Math.round((state.mode === 'quality' ? 1500 : 2000) * heightDampMult);
        if (baseLayerAccel !== currentGlobalAccel) {
            lines.push(`SET_VELOCITY_LIMIT ACCEL=${baseLayerAccel} ACCEL_TO_DECEL=${Math.round(baseLayerAccel * 0.5)} SQUARE_CORNER_VELOCITY=${scvVal}`);
            currentGlobalAccel = baseLayerAccel;
        }

        lines.push(`; OBJECT_ID: 112`);
        lines.push(`; printing object Object_1 id:0 copy 0`);
        lines.push(`EXCLUDE_OBJECT_START NAME=Object_1_id_0_copy_0`);

        if (!exp.vaseMode || isFirst) {
            lines.push(`G1 Z${zVal} F600`);
        }
        // НЕ возвращаем пластик до переезда, чтобы не было двойного холостого ретракта на смене слоя!

        let currentVelLimit = null;

        // Предвычисляем внутренний щит стенок 1 раз на весь слой (внутрь от периметра на толщину стенки)
        const innerShieldContours = createInsetContours(layer.contours, baseLineW * 1.15);
        const safeInteriorPolys = ringsToClipperClean(innerShieldContours.length > 0 ? innerShieldContours : layer.contours);

        const emitSegs = (segs, typeLabel, key, feed, lineWidth, velLimit, isVaseSpiral = false) => {
            if (!segs || segs.length === 0) return;
            
            if (!isVaseSpiral && (key === 'solid' || key === 'sparse' || key === 'extra')) {
                segs = optimizePath(segs, lastX, lastY);
            }

            if (velLimit !== currentVelLimit) {
                lines.push(`SET_VELOCITY_LIMIT ACCEL=${velLimit} ACCEL_TO_DECEL=${Math.round(velLimit * 0.5)}`);
                currentVelLimit = velLimit;
            }
            lines.push(`;TYPE:${typeLabel}`);
            lines.push(`;WIDTH:${lineWidth}`);

            const prevZ = idx > 0 ? Number(Math.max(0.05, layers[idx - 1].h + zOffset).toFixed(3)) : 0.0;
            const totalSegs = segs.length;

            for (let i = 0; i < totalSegs; i++) {
                const seg = segs[i];
                const d = Math.hypot(seg.p2.x - seg.p1.x, seg.p2.z - seg.p1.z);
                if (d < 0.02) continue;

                const gx1 = Number((seg.p1.x + cx).toFixed(3));
                const gy1 = Number((cy - seg.p1.z).toFixed(3));
                const gx2 = Number((seg.p2.x + cx).toFixed(3));
                const gy2 = Number((cy - seg.p2.z).toFixed(3));

                if (lastX !== null && lastY !== null) {
                    const jump = Math.hypot(gx1 - lastX, gy1 - lastY);
                    if (jump > 0.04 && !isVaseSpiral) {
                        const prevModelX = lastX - cx, prevModelZ = cy - lastY;
                        const curModelX = gx1 - cx, curModelZ = cy - gy1;
                        // Проверяем, пересекает ли переезд стенки или буквы (X, Y, Z)
                        const crossesWallOrAir = isTravelCrossingAir(prevModelX, prevModelZ, curModelX, curModelZ, safeInteriorPolys);

                        // Ретракт делается ТОЛЬКО если сопло пересекает стенку/букву (jump > 0.6 мм)
                        // или при очень длинном переезде через всю деталь (> 25 мм).
                        // На соседних линиях внутри заполнения ретракт НЕ дёргается!
                        const needRetract = !isRetracted && (
                            (crossesWallOrAir && jump > retractMinTravel) ||
                            (jump > retractLongTravel)
                        );

                        if (needRetract) {
                            lines.push(`G1 E-${layerRetractLen} F${layerRetractSpeed}`);
                            isRetracted = true;
                            retractedAmount = layerRetractLen;
                            stats.retractCount++;
                            const rSec = (layerRetractLen / (layerRetractSpeed / 60)) * 2 + 0.12;
                            stats.travel.timeSec += rSec;
                            totalTime += rSec;
                        }

                        lines.push(`G1 X${gx1} Y${gy1} F${layerTravelSpeed}`);
                        const vPeakT = Math.min(layerTravelSpeed / 60, Math.sqrt(2 * 2000 * jump));
                        const tSec = ((jump / Math.max(25, vPeakT * 0.65)) + 0.008) * 1.3;
                        stats.travel.timeSec += tSec;
                        totalTime += tSec;

                        if (isRetracted) {
                            lines.push(`G1 E${retractedAmount} F${layerRetractSpeed}`);
                            isRetracted = false;
                        }
                        lines.push(`G1 F${feed}`);
                    } else {
                        if (isRetracted) {
                            lines.push(`G1 E${retractedAmount} F${layerRetractSpeed}`);
                            isRetracted = false;
                        }
                        if (i === 0) lines.push(`G1 F${feed}`);
                    }
                } else {
                    lines.push(`G1 X${gx1} Y${gy1} F${layerTravelSpeed}`);
                    if (isRetracted) {
                        lines.push(`G1 E${retractedAmount} F${layerRetractSpeed}`);
                        isRetracted = false;
                    }
                    lines.push(`G1 F${feed}`);
                }

                const dE = calcE(d, lineWidth, dH, 1.0);
                if (!isFinite(dE) || dE <= 0 || dE > 5.0) continue;

                if (isVaseSpiral && !isFirst) {
                    const spiralZ = Number((prevZ + ((i + 1) / totalSegs) * (zVal - prevZ)).toFixed(3));
                    lines.push(`G1 X${gx2} Y${gy2} Z${spiralZ} E${dE.toFixed(5)}`);
                } else {
                    lines.push(`G1 X${gx2} Y${gy2} E${dE.toFixed(5)}`);
                }

                const vTarget = feed / 60;
                const vCorner = Math.min(vTarget, scvVal * 1.8);
                const vPeak = Math.min(vTarget, Math.sqrt(vCorner * vCorner + 1.4 * velLimit * d));
                const accelDist = (vTarget * vTarget - vCorner * vCorner) / Math.max(100, velLimit);
                const vEff = (d <= accelDist)
                    ? ((vCorner + vPeak) * 0.5)
                    : (d / ((accelDist / ((vCorner + vTarget) * 0.5)) + ((d - accelDist) / vTarget)));

                const SE_REAL_FACTOR = 2.2;
                const moveSec = ((d / Math.max(8, vEff)) + 0.008) * SE_REAL_FACTOR;

                stats[key].timeSec += moveSec;
                stats[key].eMM += dE;
                stats.totalE += dE;
                totalTime += moveSec;

                lastX = gx2; lastY = gy2;
            }
        };

        const firstLayerMMS = expVal('firstLayerSpeed', 0) > 0 ? expVal('firstLayerSpeed', 0) : (state.material === 'PETG' ? 20 : (state.material === 'TPU' ? 15 : 30));
        const firstLayerFeed = capFeed(firstLayerMMS, firstLayerWidth, dH);
        const outerWallFeed  = capFeed(baseSpd * (expVal('outerWallPct', 68) / 100), outerWallWidth, dH);
        const innerWallFeed  = capFeed(baseSpd * (expVal('innerWallPct', 88) / 100), innerWallWidth, dH);
        const solidInfillFeed = capFeed(baseSpd * (expVal('solidPct', 82) / 100), solidInfillWidth, dH);
        const sparseInfillFeed = capFeed(baseSpd * (expVal('sparsePct', 95) / 100), sparseInfillWidth, dH);
        const extrasFeed     = capFeed(Math.min(90, baseSpd * (expVal('extrasPct', 55) / 100)), innerWallWidth, dH);

        // Щадящие ускорения для сохранения ресурса подшипников и шаговых двигателей
        const accOuter  = isFirst ? 800 : Math.round(1500 * heightDampMult);
        const accInner  = isFirst ? 800 : Math.round(2000 * heightDampMult);
        const accSolid  = isFirst ? 800 : Math.round(2000 * heightDampMult);
        const accSparse = isFirst ? 800 : Math.round(2500 * heightDampMult);
        const accExtras = isFirst ? 800 : Math.round(1500 * heightDampMult);

        if (layer.extras && layer.extras.length > 0) {
            const extraTag = isFirst ? 'Skirt' : 'Support';
            emitSegs(layer.extras, extraTag, 'extra', isFirst ? firstLayerFeed : extrasFeed, isFirst ? firstLayerWidth : innerWallWidth, accExtras, false);
        }
        if (layer.innerWalls && layer.innerWalls.length > 0) {
            emitSegs(layer.innerWalls, 'Inner wall', 'inner', isFirst ? firstLayerFeed : innerWallFeed, isFirst ? firstLayerWidth : innerWallWidth, accInner, false);
        }
        if (layer.outerWalls && layer.outerWalls.length > 0) {
            emitSegs(layer.outerWalls, 'Outer wall', 'outer', isFirst ? firstLayerFeed : outerWallFeed, isFirst ? firstLayerWidth : outerWallWidth, accOuter, Boolean(exp.vaseMode && !isFirst));
        }
        if (layer.solidInfill && layer.solidInfill.length > 0) {
            const solidTag = idx < 3 ? 'Bottom surface' : (idx >= layers.length - 5 ? 'Top surface' : 'Internal solid infill');
            emitSegs(layer.solidInfill, solidTag, 'solid', isFirst ? firstLayerFeed : solidInfillFeed, isFirst ? firstLayerWidth : solidInfillWidth, accSolid, false);
        }
        if (layer.sparseInfill && layer.sparseInfill.length > 0) {
            emitSegs(layer.sparseInfill, 'Sparse infill', 'sparse', isFirst ? firstLayerFeed : sparseInfillFeed, isFirst ? firstLayerWidth : sparseInfillWidth, accSparse, false);
        }

        lines.push(`; stop printing object Object_1 id:0 copy 0`);
        lines.push(`;TIME_ELAPSED:${totalTime.toFixed(6)}`);
        lines.push(`EXCLUDE_OBJECT_END NAME=Object_1_id_0_copy_0`);

        const pct = Math.round(((idx + 1) / layers.length) * 100);
        const minLeft = Math.max(0, Math.round((layers.length - idx - 1) * 9 / 60));
        lines.push(`M73 P${pct} R${minLeft}`);

        if (lines.length >= 10000) flush();
        totalTime += 0.5;
        if (maybeYield) {
            const pctY = 78 + ((idx + 1) / layers.length) * 14;
            await maybeYield(pctY, "Компиляция G-кода...", `Слой ${idx + 1} из ${layers.length}`, `Чанков: ${chunks.length + 1}`, isHeavy);
        }
    }

    lines.push(`M73 P100 R0`);
    lines.push(`M106 S0`);
    lines.push(`M106 P2 S0`);
    lines.push(`;TYPE:Custom`);
    lines.push(`; ==== Завершение печати (Standard End) ====`);
    lines.push(`M104 S0 ; Выключение сопла`);
    lines.push(`M140 S0 ; Выключение стола`);
    lines.push(`M106 S0 ; Выключение обдува`);
    lines.push(`G91 ; Переход в относительные координаты`);
    lines.push(`G1 E-2 F2700 ; Ретракт (откат пластика)`);
    lines.push(`G1 Z10 F3000 ; Поднятие сопла на 10мм`);
    lines.push(`G90 ; Переход в абсолютные координаты`);
    lines.push(`G1 X5 Y220 F3000 ; Отъезд стола в конец`);
    lines.push(`M84 ; Выключение двигателей`);
    lines.push(`;TIME_ELAPSED:${totalTime.toFixed(6)}`);
    lines.push(``);
    lines.push(`; EXECUTABLE_BLOCK_END`);
    flush();

    const purgeLineE = 45;
    const retractionWasteMM = stats.retractCount * 0.04;
    const totalEffectiveE = stats.totalE + purgeLineE + retractionWasteMM;
    const volCM3 = (filamentArea * totalEffectiveE) / 1000;
    stats.totalGrams = Math.max(0.1, volCM3 * (profile.density || 1.24) * 1.15);
    stats.totalTimeSec = totalTime + 60;

    return { gcode: chunks.join(''), gcodeChunks: chunks, estimatedTimeSec: stats.totalTimeSec, stats };
}

// ==== Main slicer ====
async function runSlicer() {
    if (state.isSlicing) return false;
    if (bedModels.length === 0) { showToast("Стол пуст!"); return false; }
    if (state.layerPlayInterval) { clearInterval(state.layerPlayInterval); state.layerPlayInterval = null; }

    state.generatedGcode = ''; state.gcodeChunks = []; state.slicedLayers = []; state.lastSliceStats = null;
    state.isSlicing = true;
    state.cancelSlicingRequested = false;
    _setFloatingStopButton(true);

    const btnLbl = document.getElementById('btn-slicer-label');
    if (btnLbl) btnLbl.textContent = "⏳ ИДЁТ НАРЕЗКА...";
    const sliceStartTime = performance.now();
    let lastYieldTime = performance.now();

    const maybeYield = async (pct, phaseText, detailText, memText, isHeavy) => {
        const now = performance.now();
        if (now - lastYieldTime >= 18) {
            const modal = document.getElementById('modal-slice-progress');
            const phaseEl = document.getElementById('slice-prog-phase');
            const detailEl = document.getElementById('slice-prog-detail');
            const pctEl = document.getElementById('slice-prog-pct');
            const barEl = document.getElementById('slice-prog-bar');
            const memEl = document.getElementById('slice-prog-mem');
            const timeEl = document.getElementById('slice-prog-time');
            if (modal && modal.classList.contains('hidden')) modal.classList.remove('hidden');
            document.getElementById('slice-heavy-badge')?.classList.toggle('hidden', !isHeavy);
            if (phaseEl) phaseEl.textContent = phaseText;
            if (detailEl) detailEl.textContent = detailText;
            if (pctEl) pctEl.textContent = `${Math.round(pct)}%`;
            if (barEl) barEl.style.width = `${Math.round(pct)}%`;
            if (memEl) memEl.textContent = memText;
            if (timeEl) timeEl.textContent = `${((performance.now() - sliceStartTime) / 1000).toFixed(1)} сек`;
            await new Promise(r => setTimeout(r, 0));
            lastYieldTime = performance.now();
            if (state.cancelSlicingRequested) throw new Error('SLICE_CANCELLED');
        }
    };

    try {
        const profile = PROFILES[state.material][state.mode];
        const firstLayerH = Math.max(0.08, Math.min(0.40, expVal('firstLayerHeight', 0.20)));
        const nextLayerH = profile.layerHeight;
        const exp = state.expert || {};
        const lineWidth = exp.lineWidth || 0.45;
        const wallCount = exp.wallCount > 0 ? exp.wallCount : 2;
        const bottomSolidLayers = exp.bottomLayers !== undefined ? exp.bottomLayers : 3;
        const topSolidLayers = exp.topLayers !== undefined ? exp.topLayers : 5;

        let maxModelHeight = 0, totalTris = 0;
        bedModels.forEach(mesh => {
            const s = mesh.scale.x;
            mesh.geometry.computeBoundingBox();
            maxModelHeight = Math.max(maxModelHeight, (mesh.geometry.boundingBox.max.y - mesh.geometry.boundingBox.min.y) * s);
            if (mesh.geometry.attributes.position) totalTris += Math.floor(mesh.geometry.attributes.position.count / 3);
        });
        const estLayers = Math.max(1, Math.ceil((maxModelHeight - firstLayerH) / nextLayerH) + 1);
        const isHeavy = (totalTris > 15000 || estLayers > 150 || bedModels.length >= 4);

await maybeYield(1, "Анализ 3D-модели...", `Треугольников: ${totalTris.toLocaleString('ru-RU')}`, isHeavy ? "Защита ОЗУ" : "Память: ОК", isHeavy);

// Быстрый аудит устойчивости на столе перед тяжёлыми вычислениями
        const MarlinAdapter = (typeof SalimMarlin !== 'undefined') ? SalimMarlin : (typeof window !== 'undefined' ? window.SalimMarlin : null);
        if (MarlinAdapter && typeof MarlinAdapter.modelWarnings === 'function') {
            const preWarns = MarlinAdapter.modelWarnings();
            const badBase = preWarns.find(msg => msg.includes('Критически малая площадь контакта'));
            if (badBase && !state.brim) {
                const addBrim = await new Promise(resolve => {
                    showConfirmDialog({
                        title: "Риск отрыва детали!",
                        message: "Площадь опоры на стол слишком мала. Включить кайму (Brim) автоматически для защиты печати?",
                        confirmText: "Включить кайму",
                        cancelText: "Печатать так",
                        type: "amber",
                        icon: "fa-triangle-exclamation"
                    }, () => resolve(true), () => resolve(false));
                });
                if (addBrim) {
                    state.brim = true;
                    state.brimLoops = state.brimLoops || 8;
                    renderBrimUI();
                }
            }
        }

        const { flat: flatTris, overhang } = await collectTriangles(bedModels, async (done, total) => {
            await maybeYield(1 + (done / Math.max(1, total)) * 7, "Подготовка...", `Треугольников: ${done} / ${total}`, "CPU", isHeavy);
        });

        const layerHeights = [];
        let curZ = firstLayerH;
        while (curZ <= maxModelHeight + nextLayerH * 0.45) {
            layerHeights.push(Number(Math.min(maxModelHeight, curZ).toFixed(2)));
            if (curZ >= maxModelHeight - 0.01) break;
            curZ += nextLayerH;
        }
        const numLayers = layerHeights.length;

        const tasks = [];
        for (let l = 0; l < numLayers; l++) {
            const h = layerHeights[l];
            const dH = l === 0 ? firstLayerH : Number((layerHeights[l] - layerHeights[l - 1]).toFixed(3));
            const ySlice = Math.min(maxModelHeight - 0.02, Math.max(0.05, h - dH * 0.5)) + 0.001;
            tasks.push({ l, h, dH, ySlice });
        }
        const slicedRaw = await sliceLayers(flatTris, tasks, maybeYield, isHeavy);

        const xyComp = parseFloat(exp.xyCompensation || 0);
        const wallSpacing = Number((lineWidth - nextLayerH * (1 - Math.PI / 4)).toFixed(3));
        const firstWallInset = Math.max(0.0, lineWidth * 0.5 - xyComp);
        const effWallCount = exp.vaseMode ? 1 : wallCount;
        const totalInfillInset = firstWallInset + (effWallCount - 1) * wallSpacing + wallSpacing * 0.82;
        const slicedLayers = [];
        const SCALE = 1000;
        const topCheckCount = Math.max(4, topSolidLayers);
        const bottomCheckCount = Math.max(3, bottomSolidLayers);
        const infillPolyCache = new Map();
        const getInfillPolysAt = (idx) => {
            let cached = infillPolyCache.get(idx);
            if (!cached) {
                cached = ringsToClipperClean(createInsetContours(slicedRaw[idx].contours, totalInfillInset), SCALE);
                infillPolyCache.set(idx, cached);
            }
            return cached;
        };

        for (let l = 0; l < slicedRaw.length; l++) {
            const { h, dH, contours, minX, maxX, minZ, maxZ } = slicedRaw[l];
            const isBottomLayer = (l < bottomSolidLayers);
            const isTopLayer = !exp.vaseMode && (topSolidLayers > 0 && l >= numLayers - topSolidLayers);
            const isGlobalSolid = (isBottomLayer || isTopLayer || state.infill >= 95);

            const layerMoves = { h, dH, contours, innerWalls: [], outerWalls: [], walls: [], solidInfill: [], sparseInfill: [], extras: [] };
            const outerRings = contours.map(c => c);
            const allOuterSegsForInfill = [];
            const infillRings = [];

            if (outerRings.length > 0) {
                let outerWallList = createInsetContours(outerRings, firstWallInset);
                if (outerWallList.length === 0) outerWallList = outerRings;

                for (const ow of outerWallList) {
                    layerMoves.outerWalls.push(...contourToSegs(typeof SalimFeatures !== 'undefined' ? SalimFeatures.seamRing(ow, l) : ow, true));
                }

                let lastWallRings = outerWallList;
                for (let w = 1; w < effWallCount; w++) {
                    const nextRings = createInsetContours(outerRings, firstWallInset + w * wallSpacing);
                    if (nextRings.length === 0) break;
                    for (const r of nextRings) {
                        layerMoves.innerWalls.push(...contourToSegs(typeof SalimFeatures !== 'undefined' ? SalimFeatures.seamRing(r, l) : r, true));
                    }
                    lastWallRings = nextRings;
                }

                let innerInfillBound = createInsetContours(outerRings, totalInfillInset);
                if (innerInfillBound.length === 0) innerInfillBound = lastWallRings;

                for (const r of innerInfillBound) {
                    infillRings.push(r);
                    allOuterSegsForInfill.push(...contourToSegs(r, false));
                }
            }

            layerMoves.walls = layerMoves.innerWalls.concat(layerMoves.outerWalls);

            // Генерация Каймы (Brim) и Мышиных ушек
            if (l === 0 && state.brim && outerRings.length > 0) {
                const brimSpacing = Number((lineWidth * 0.95).toFixed(3));
                const loopsCount = Math.max(1, state.brimLoops || 6);

                // Наружные контуры и отверстия различаем по чётности вложенности
                const ringPaths = outerRings.map(r => r.slice(0, r.length - 1).map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.z * SCALE) })));
                const outerOnly = outerRings.filter((r, i) => {
                    let depth = 0;
                    for (let j = 0; j < ringPaths.length; j++) {
                        if (j !== i && ClipperLib.Clipper.PointInPolygon(ringPaths[i][0], ringPaths[j]) !== 0) depth++;
                    }
                    return depth % 2 === 0;
                });
                const brimSource = (state.brimType === 'everywhere') ? outerRings : outerOnly;

const limX = PRINTER_SPECS.bedX / 2 - 0.5, limZ = PRINTER_SPECS.bedY / 2 - 0.5;
                const insideBed = (s) => Math.abs(s.p1.x) <= limX && Math.abs(s.p1.z) <= limZ && Math.abs(s.p2.x) <= limX && Math.abs(s.p2.z) <= limZ;

                // Первое кольцо вплотную к стенке (центр линии на половину ширины от контура)
                for (let b = 1; b <= loopsCount; b++) {
                    const offsetDist = lineWidth * 0.5 + (b - 1) * brimSpacing;
                    const brimRings = createInsetContours(brimSource, -offsetDist);
                    for (const br of brimRings) {
                        const segs = contourToSegs(br, true).filter(insideBed);
                        layerMoves.extras.push(...segs);
                    }
                }

                if (state.mouseEars) {
                    const brimReach = lineWidth * 0.5 + (loopsCount - 1) * brimSpacing + lineWidth * 0.5;
                    let earClip = ringsToClipperClean(createInsetContours(brimSource, -brimReach), SCALE);
                    if (earClip.length === 0) earClip = ringsToClipperClean(outerRings, SCALE);
                    const earRadius = 4.5;
                    const earSegments = 24;
                    const earCenters = [];

                    for (const ring of outerOnly) {
                        const n = ring.length - 1;
                        if (n < 3) continue;
                        for (let pIdx = 0; pIdx < n; pIdx++) {
                            const ptPrev = ring[(pIdx - 1 + n) % n];
                            const ptCurr = ring[pIdx];
                            const ptNext = ring[pIdx + 1];
                            const v1x = ptCurr.x - ptPrev.x, v1z = ptCurr.z - ptPrev.z;
                            const v2x = ptNext.x - ptCurr.x, v2z = ptNext.z - ptCurr.z;
                            const len1 = Math.hypot(v1x, v1z) || 1;
                            const len2 = Math.hypot(v2x, v2z) || 1;
                            const dot = (v1x * v2x + v1z * v2z) / (len1 * len2);
                            if (dot >= 0.70) continue;
                            if (earCenters.some(c => Math.hypot(c.x - ptCurr.x, c.z - ptCurr.z) < earRadius * 1.5)) continue;
                            earCenters.push(ptCurr);

                            const circle = [];
                            for (let c = 0; c < earSegments; c++) {
                                const ang = (c * Math.PI * 2) / earSegments;
                                circle.push({
                                    X: Math.round((ptCurr.x + Math.cos(ang) * earRadius) * SCALE),
                                    Y: Math.round((ptCurr.z + Math.sin(ang) * earRadius) * SCALE)
                                });
                            }
                            // Ухо — залитый диск, обрезанный по кайме: поверх детали и каймы ничего не печатается
                            const earPaths = clipperOp(ClipperLib.ClipType.ctDifference, [circle], earClip);
                            const earData = clipperToSegsAndBox(earPaths, SCALE);
if (earData.segs.length > 0 && isFinite(earData.minX)) {
                                const validEarSegs = earData.segs.filter(insideBed);
                                layerMoves.extras.push(...validEarSegs);
                                const earInfill = generateLinesInfill(earData.segs, earData.minX, earData.maxX, earData.minZ, earData.maxZ, 45, lineWidth * 0.9).filter(insideBed);
                                layerMoves.extras.push(...earInfill);
                            }
                        }
                    }
                }
            }
			
            if (typeof SalimFeatures !== 'undefined') SalimFeatures.addSkirt(layerMoves, l, outerRings, lineWidth);

            // Генерация Поддержек
            if (state.supports && overhang.length > 0) {
                const zGap = expVal('supportZGap', 0) > 0 ? expVal('supportZGap', 0) : Math.max(0.18, dH * 1.1);
                const xyGap = Math.max(0, expVal('supportXYGap', 0.5));
                const interfaceLayers = Math.max(0, Math.round(expVal('supportInterface', 3)));

                const activeOverhangs = overhang.filter(ov => ov.yMin > h + zGap);
                if (activeOverhangs.length > 0) {
                    const subj = [];
                    for (const ov of activeOverhangs) {
                        subj.push([
                            { X: Math.round(ov.v0.x * SCALE), Y: Math.round(ov.v0.z * SCALE) },
                            { X: Math.round(ov.v1.x * SCALE), Y: Math.round(ov.v1.z * SCALE) },
                            { X: Math.round(ov.v2.x * SCALE), Y: Math.round(ov.v2.z * SCALE) }
                        ]);
                    }

                    const cpr = new ClipperLib.Clipper();
                    cpr.AddPaths(subj, ClipperLib.PolyType.ptSubject, true);
                    const sol = new ClipperLib.Paths();
                    cpr.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

                    const modelPaths = [];
                    contours.forEach(c => {
                        const pts = c.slice(0, c.length - 1).map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.z * SCALE) }));
                        if (pts.length >= 3) modelPaths.push(pts);
                    });

                    const cprDiff = new ClipperLib.Clipper();
                    cprDiff.AddPaths(sol, ClipperLib.PolyType.ptSubject, true);
                    cprDiff.AddPaths(modelPaths, ClipperLib.PolyType.ptClip, true);
                    const diffSol = new ClipperLib.Paths();
                    cprDiff.Execute(ClipperLib.ClipType.ctDifference, diffSol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

                    const co = new ClipperLib.ClipperOffset(2.4, 180);
                    co.AddPaths(diffSol, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                    const offsetSol = new ClipperLib.Paths();
                    co.Execute(offsetSol, -xyGap * SCALE);

                    if (offsetSol.length > 0) {
                        let minDistToOverhang = Infinity;
                        for (const ov of activeOverhangs) {
                            const distToOv = ov.yMin - h;
                            if (distToOv < minDistToOverhang) minDistToOverhang = distToOv;
                        }
                        const isInInterface = minDistToOverhang <= (interfaceLayers * dH + zGap);
                        let supMinX = Infinity, supMaxX = -Infinity, supMinZ = Infinity, supMaxZ = -Infinity;
                        const boundarySegs = [];
                        for (const path of offsetSol) {
                            if (path.length < 3) continue;
                            const ring = path.map(pt => ({ x: pt.X / SCALE, z: pt.Y / SCALE }));
                            ring.push({ x: ring[0].x, z: ring[0].z });
                            boundarySegs.push(...contourToSegs(ring, false));
                            ring.forEach(p => {
                                supMinX = Math.min(supMinX, p.x); supMaxX = Math.max(supMaxX, p.x);
                                supMinZ = Math.min(supMinZ, p.z); supMaxZ = Math.max(supMaxZ, p.z);
                            });
                        }

                        if (boundarySegs.length > 0) {
                            const spacing = isInInterface ? (lineWidth * 0.8) : (lineWidth * expVal('supportSpacing', 4));
                            let angle = (l % 2 === 0) ? 45 : -45;
                            if (state.supportType === 'tree') angle = 90;
                            const infill = generateLinesInfill(boundarySegs, supMinX, supMaxX, supMinZ, supMaxZ, angle, spacing);
                            layerMoves.extras.push(...infill);
                            layerMoves.extras.push(...boundarySegs);
                        }
                    }
                }
            }

            // ==== ДЕТЕКТОР ДНА И КРЫШЕК (Clipper, с кэшем соседних слоёв) ====
            const pInfill = ringsToClipperClean(infillRings, SCALE);
            let solidSkinPaths = [];

            if (!exp.vaseMode && pInfill.length > 0 && typeof ClipperLib !== 'undefined') {
                if (isGlobalSolid) {
                    solidSkinPaths = pInfill;
                } else {
                    let neededSolidUnion = [];

                    // 1. Что перестаёт быть внутренним заполнением на слоях выше (дно выемок, полки под стенками)
                    for (let step = 1; step <= topCheckCount; step++) {
                        if (l + step >= numLayers) {
                            neededSolidUnion = clipperOp(ClipperLib.ClipType.ctUnion, neededSolidUnion, pInfill);
                            break;
                        }
                        const exposedTop = clipperOp(ClipperLib.ClipType.ctDifference, pInfill, getInfillPolysAt(l + step));
                        if (exposedTop.length > 0) {
                            neededSolidUnion = clipperOp(ClipperLib.ClipType.ctUnion, neededSolidUnion, exposedTop);
                        }
                    }

                    // 2. Что висит над стенками или воздухом на слоях ниже (потолки, мосты, скосы)
                    for (let step = 1; step <= bottomCheckCount; step++) {
                        if (l - step < 0) {
                            neededSolidUnion = clipperOp(ClipperLib.ClipType.ctUnion, neededSolidUnion, pInfill);
                            break;
                        }
                        const exposedBottom = clipperOp(ClipperLib.ClipType.ctDifference, pInfill, getInfillPolysAt(l - step));
                        if (exposedBottom.length > 0) {
                            neededSolidUnion = clipperOp(ClipperLib.ClipType.ctUnion, neededSolidUnion, exposedBottom);
                        }
                    }

                    // 3. Фильтр микрошума (-0.12 мм) и расширение (+1.4 мм) для сцепления со стенками
                    if (neededSolidUnion.length > 0) {
                        const coClean = new ClipperLib.ClipperOffset(2.4, 180);
                        coClean.AddPaths(neededSolidUnion, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                        const eroded = new ClipperLib.Paths();
                        coClean.Execute(eroded, -0.12 * SCALE);

                        const srcForExpand = eroded.length > 0 ? eroded : neededSolidUnion;
                        const coExpand = new ClipperLib.ClipperOffset(2.4, 180);
                        coExpand.AddPaths(srcForExpand, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                        const expanded = new ClipperLib.Paths();
                        coExpand.Execute(expanded, 1.4 * SCALE);

                        solidSkinPaths = clipperOp(ClipperLib.ClipType.ctIntersection, expanded, pInfill);
                    }
                }
            }
            infillPolyCache.delete(l - bottomCheckCount - 1);
			
            // ==== ГЕНЕРАЦИЯ ЗАПОЛНЕНИЯ И СПЛОШНОГО ДНА ====
            if (!exp.vaseMode && allOuterSegsForInfill.length > 0 && isFinite(minX)) {
                const angle = (l % 2 === 0) ? 45 : -45;
                const baseSpacing = Math.max(lineWidth, (lineWidth * 100) / Math.max(1, state.infill));

                if (isGlobalSolid || (solidSkinPaths.length > 0 && clipperOp(ClipperLib.ClipType.ctDifference, pInfill, solidSkinPaths).length === 0)) {
                    const rawInfill = generateLinesInfill(allOuterSegsForInfill, minX, maxX, minZ, maxZ, angle, lineWidth * 0.90);
                    layerMoves.solidInfill.push(...rawInfill);
                } else if (solidSkinPaths.length > 0) {
                    const solidData = clipperToSegsAndBox(solidSkinPaths, SCALE);
                    if (solidData.segs.length > 0 && isFinite(solidData.minX)) {
                        const solidLines = generateLinesInfill(solidData.segs, solidData.minX, solidData.maxX, solidData.minZ, solidData.maxZ, angle, lineWidth * 0.90);
                        layerMoves.solidInfill.push(...solidLines);
                    }

                    if (state.infill > 0) {
                        const sparsePaths = clipperOp(ClipperLib.ClipType.ctDifference, pInfill, solidSkinPaths);
                        if (sparsePaths.length > 0) {
                            const sparseData = clipperToSegsAndBox(sparsePaths, SCALE);
                            if (sparseData.segs.length > 0 && isFinite(sparseData.minX)) {
                                const sparseLines = (typeof SalimFeatures !== 'undefined') ? SalimFeatures.sparseInfill(sparseData.segs, sparseData.minX, sparseData.maxX, sparseData.minZ, sparseData.maxZ, l, baseSpacing) : generateLinesInfill(sparseData.segs, sparseData.minX, sparseData.maxX, sparseData.minZ, sparseData.maxZ, angle, baseSpacing);
                                layerMoves.sparseInfill.push(...sparseLines);
                            }
                        }
                    }
                } else if (state.infill > 0) {
                    const rawInfill = (typeof SalimFeatures !== 'undefined') ? SalimFeatures.sparseInfill(allOuterSegsForInfill, minX, maxX, minZ, maxZ, l, baseSpacing) : generateLinesInfill(allOuterSegsForInfill, minX, maxX, minZ, maxZ, angle, baseSpacing);
                    layerMoves.sparseInfill.push(...rawInfill);
                }
            }

            // ==== ЗАЛИВКА УЗКИХ ЩЕЛЕЙ на сплошных слоях (острые клинья, где обычная заливка не помещается) ====
            if (isGlobalSolid && !exp.vaseMode && outerRings.length > 0 && typeof ClipperLib !== 'undefined') {
                const gapWallBand = firstWallInset + (effWallCount - 1) * wallSpacing + lineWidth * 0.5;
                const gapReachPaths = ringsToClipperClean(createInsetContours(outerRings, gapWallBand), SCALE);
                if (gapReachPaths.length > 0) {
                    const coGap = new ClipperLib.ClipperOffset(2.4, 180);
                    if (pInfill.length > 0) coGap.AddPaths(pInfill, ClipperLib.JoinType.jtRound, ClipperLib.EndType.etClosedPolygon);
                    const gapCovered = new ClipperLib.Paths();
                    coGap.Execute(gapCovered, 0.20 * SCALE);
                    const gapPaths = clipperOp(ClipperLib.ClipType.ctDifference, gapReachPaths, gapCovered)
                        .filter(gp => gp && gp.length >= 3 && Math.abs(ClipperLib.Clipper.Area(gp)) / (SCALE * SCALE) > 0.12);
                    if (gapPaths.length > 0) {
                        const gapData = clipperToSegsAndBox(gapPaths, SCALE);
                        if (gapData.segs.length > 0 && isFinite(gapData.minX)) {
                            const gapAngle = (l % 2 === 0) ? 45 : -45;
                            const gapLines = generateLinesInfill(gapData.segs, gapData.minX, gapData.maxX, gapData.minZ, gapData.maxZ, gapAngle, lineWidth * 0.85);
                            layerMoves.solidInfill.push(...gapLines);
                        }
                    }
                }
            }

            slicedLayers.push(layerMoves);

            const pct = 44 + ((l + 1) / numLayers) * 34;
            await maybeYield(pct, "Стенки и заполнение...", `Слой ${l + 1} из ${numLayers} (Z=${h.toFixed(2)})`, `Сегментов: ${layerMoves.walls.length + layerMoves.solidInfill.length + layerMoves.sparseInfill.length}`, isHeavy);
        }

        state.slicedLayers = slicedLayers;

        const result = await generateKlipperGcode(slicedLayers, profile, maybeYield, isHeavy);
        state.generatedGcode = result.gcode;
        state.gcodeChunks = result.gcodeChunks;
        state.lastSliceStats = result.stats;
        if (state.activeTab === 'gcode') updateInlineGcodeViewer();

        const meters = result.stats.totalE / 1000;
        const grams = result.stats.totalGrams;
        const estSecs = Math.max(15, Math.round(result.estimatedTimeSec));

        updateSliceSummaryUI(estSecs, grams, meters, numLayers);

        await buildGcodePreview(slicedLayers);
        if (state.cancelSlicingRequested) throw new Error('SLICE_CANCELLED');
        document.getElementById('modal-slice-progress')?.classList.add('hidden');
        setViewportMode('gcode');
        showToast(`Готово: ${numLayers} сл. • ${grams.toFixed(1)} г • Ender 3 V3 SE`);
        return true;
    } catch (err) {
        document.getElementById('modal-slice-progress')?.classList.add('hidden');
        if (err && err.message === 'SLICE_CANCELLED') showToast("Отменено");
        else { console.error(err); showToast("Ошибка нарезки: " + (err && err.message ? err.message : err)); }
        return false;
    } finally {
        state.isSlicing = false;
        if (btnLbl) btnLbl.textContent = "НАРЕЗАТЬ В G-CODE (ENDER 3 V3 SE)";
        _setFloatingStopButton(false);
    }
}

function _setFloatingStopButton(visible) {
    let btn = document.getElementById('btn-floating-stop');
    if (visible) {
        if (!btn) {
            btn = document.createElement('button');
            btn.id = 'btn-floating-stop';
            btn.className = 'fixed top-4 right-4 z-[150] px-4 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white font-black text-sm shadow-2xl flex items-center gap-2 active:scale-95 transition';
            btn.innerHTML = `<i class="fa-solid fa-stop"></i> STOP`;
            btn.onclick = () => { cancelActiveSlicing(); showToast("Останавливаю..."); };
            document.body.appendChild(btn);
        } else {
            btn.style.display = 'flex';
        }
    } else {
        if (btn) btn.style.display = 'none';
    }
}

function cancelActiveSlicing() {
    if (state.isSlicing) {
        state.cancelSlicingRequested = true;
        const phaseEl = document.getElementById('slice-prog-phase');
        if (phaseEl) phaseEl.textContent = "Остановка...";
    }
}

async function buildGcodePreview(layers) {
    while (gcodeGroup.children.length > 0) {
        const c = gcodeGroup.children[0];
        c.traverse(n => { if (n.geometry) n.geometry.dispose(); if (n.material) n.material.dispose(); });
        gcodeGroup.remove(c);
    }
    const colOuter = [0.984, 0.573, 0.235];
    const colInner = [0.980, 0.800, 0.082];
    const colSolid = [0.753, 0.518, 0.988];
    const colSparse = [0.957, 0.247, 0.369];
    const colExtra = [0.063, 0.725, 0.506];

    // Шестигранная трубка без торцов: 36 вершин на сегмент вместо 144 — критично для памяти телефона
    const numSides = 6;
    const vertsPerSeg = numSides * 6;
    const cosTable = [];
    const sinTable = [];
    for (let i = 0; i < numSides; i++) {
        const a = (i / numSides) * Math.PI * 2;
        cosTable.push(Math.cos(a));
        sinTable.push(Math.sin(a));
    }

    for (let lIdx = 0; lIdx < layers.length; lIdx++) {
        const layer = layers[lIdx];
        const group = new THREE.Group();
        group.userData.h = layer.h;
        const batches = [];
        if (layer.outerWalls && layer.outerWalls.length) batches.push({ fType: 'outer', segs: layer.outerWalls, col: colOuter });
        if (layer.innerWalls && layer.innerWalls.length) batches.push({ fType: 'inner', segs: layer.innerWalls, col: colInner });
        if (layer.solidInfill && layer.solidInfill.length) batches.push({ fType: 'solid', segs: layer.solidInfill, col: colSolid });
        if (layer.sparseInfill && layer.sparseInfill.length) batches.push({ fType: 'sparse', segs: layer.sparseInfill, col: colSparse });
        if (layer.extras && layer.extras.length) batches.push({ fType: 'extras', segs: layer.extras, col: colExtra });

        const dH = layer.dH || 0.20;
        const yCenter = layer.h - dH * 0.5;
        const halfH = dH * 0.5;
        const halfW = 0.22;

        for (const batch of batches) {
            const segs = batch.segs;
            const pts = new Float32Array(segs.length * vertsPerSeg * 3);
            const cols = new Float32Array(segs.length * vertsPerSeg * 3);
            let ptr = 0;
            const cr = batch.col[0], cg = batch.col[1], cb = batch.col[2];
            const pushVert = (x, y, z) => {
                pts[ptr] = x; pts[ptr + 1] = y; pts[ptr + 2] = z;
                cols[ptr] = cr; cols[ptr + 1] = cg; cols[ptr + 2] = cb;
                ptr += 3;
            };

            for (const s of segs) {
                const dx = s.p2.x - s.p1.x, dz = s.p2.z - s.p1.z;
                const len = Math.hypot(dx, dz);
                if (len < 1e-4) continue;
                const nx = -dz / len, nz = dx / len;

                for (let i = 0; i < numSides; i++) {
                    const next = (i + 1) % numSides;
                    const rx0 = cosTable[i] * halfW, ry0 = sinTable[i] * halfH;
                    const rx1 = cosTable[next] * halfW, ry1 = sinTable[next] * halfH;

                    const a1x = s.p1.x + nx * rx0, a1z = s.p1.z + nz * rx0, a1y = yCenter + ry0;
                    const b1x = s.p2.x + nx * rx0, b1z = s.p2.z + nz * rx0;
                    const a2x = s.p1.x + nx * rx1, a2z = s.p1.z + nz * rx1, a2y = yCenter + ry1;
                    const b2x = s.p2.x + nx * rx1, b2z = s.p2.z + nz * rx1;

                    pushVert(a1x, a1y, a1z); pushVert(b1x, a1y, b1z); pushVert(b2x, a2y, b2z);
                    pushVert(a1x, a1y, a1z); pushVert(b2x, a2y, b2z); pushVert(a2x, a2y, a2z);
                }
            }

            if (ptr > 0) {
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(ptr === pts.length ? pts : pts.slice(0, ptr), 3));
                geo.setAttribute('color', new THREE.BufferAttribute(ptr === cols.length ? cols : cols.slice(0, ptr), 3));
                geo.computeVertexNormals();

                const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
                const m = new THREE.Mesh(geo, mat);
                m.userData.featureType = batch.fType;
                if (state.featureFilters && state.featureFilters[batch.fType] !== undefined) {
                    m.visible = state.featureFilters[batch.fType];
                }
                group.add(m);
            }
        }
        gcodeGroup.add(group);
        // Даём интерфейсу дышать, чтобы работала кнопка STOP и не зависал телефон
        if ((lIdx & 15) === 15) await new Promise(r => setTimeout(r, 0));
    }
    const slider = document.getElementById('layer-slider');
    if (slider) { slider.max = layers.length; slider.value = layers.length; }
    if (state.gcodeColorMode && state.gcodeColorMode !== 'type') setGcodeColorMode(state.gcodeColorMode);
    onLayerSliderChange(layers.length);
}

function onLayerSliderChange(val) {
    const idx = parseInt(val) || 1;
    const total = gcodeGroup ? gcodeGroup.children.length : 1;
    const topNum = document.getElementById('layer-top-num');
    const zHeight = document.getElementById('layer-z-height');
    if (topNum) topNum.textContent = `${idx}/${total}`;
    if (gcodeGroup) {
        gcodeGroup.visible = state.showGcodeLayers !== false;
        const isSingle = (state.layerViewMode === 'single');
        gcodeGroup.children.forEach((c, i) => {
            if (isSingle) {
                c.visible = (i === idx - 1);
                if (c.visible) {
                    c.children.forEach(o => { if (o.material) o.material.opacity = 1.0; });
                }
} else {
                c.visible = i < idx;
                if (c.visible) {
                    c.children.forEach(o => { if (o.material) o.material.opacity = 1.0; });
                }
            }
        });
        if (gcodeGroup.children[idx - 1] && zHeight) {
            zHeight.textContent = `${gcodeGroup.children[idx - 1].userData.h.toFixed(2)}мм`;
        }
    }
    triggerSceneRender();
}

function toggleGcodeLayersVisibility() {
    state.showGcodeLayers = !state.showGcodeLayers;
    if (gcodeGroup) gcodeGroup.visible = state.showGcodeLayers;
    const btn = document.getElementById('btn-toggle-layers-vis');
    const icon = document.getElementById('icon-layers-vis');
    if (btn) btn.className = state.showGcodeLayers
        ? "w-8 h-8 rounded-xl bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center justify-center font-bold shrink-0 shadow active:scale-95 transition"
        : "w-8 h-8 rounded-xl bg-slate-800 text-slate-500 border border-slate-700 flex items-center justify-center font-bold shrink-0 shadow active:scale-95 transition";
    if (icon) icon.className = state.showGcodeLayers ? "fa-solid fa-eye text-xs" : "fa-solid fa-eye-slash text-xs";
    triggerSceneRender();
}

function toggleLayerPlay() {
    const btn = document.getElementById('btn-layer-play');
    const slider = document.getElementById('layer-slider');
    if (!btn || !slider) return;
    if (state.layerPlayInterval) {
        clearInterval(state.layerPlayInterval);
        state.layerPlayInterval = null;
        btn.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`;
        return;
    }
    let cur = parseInt(slider.value);
    const max = parseInt(slider.max);
    if (cur >= max) cur = 1;
    btn.innerHTML = `<i class="fa-solid fa-pause text-xs"></i>`;
    state.layerPlayInterval = setInterval(() => {
        cur++;
        if (cur > max) { clearInterval(state.layerPlayInterval); state.layerPlayInterval = null; btn.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`; return; }
        slider.value = cur;
        onLayerSliderChange(cur);
    }, 60);
}

function setGcodeColorMode(mode) {
    state.gcodeColorMode = mode;
    ['type', 'speed', 'flow'].forEach(m => {
        const btn = document.getElementById(`btn-color-${m}`);
        if (btn) {
            btn.className = (m === mode)
                ? "px-1.5 py-0.5 rounded text-[9px] font-extrabold bg-cyan-500 text-slate-950"
                : "px-1.5 py-0.5 rounded text-[9px] font-extrabold text-slate-400 hover:text-white";
        }
    });

    const legendType = document.getElementById('legend-items-type');
    const legendHeatmap = document.getElementById('legend-items-heatmap');
    const minLbl = document.getElementById('heatmap-min-lbl');
    const maxLbl = document.getElementById('heatmap-max-lbl');

    if (mode === 'type') {
        if (legendType) legendType.classList.remove('hidden');
        if (legendHeatmap) legendHeatmap.classList.add('hidden');
    } else {
        if (legendType) legendType.classList.add('hidden');
        if (legendHeatmap) legendHeatmap.classList.remove('hidden');
        const legendProfile = PROFILES[state.material][state.mode];
        if (mode === 'speed') {
            if (minLbl) minLbl.textContent = '30 мм/с';
            if (maxLbl) maxLbl.textContent = `${legendProfile.printSpeed || 180} мм/с`;
        } else if (mode === 'flow') {
            if (minLbl) minLbl.textContent = '0 мм³/с';
            if (maxLbl) maxLbl.textContent = `${legendProfile.maxFlow || 18} мм³/с`;
        }
    }

    if (gcodeGroup) {
        const profile = PROFILES[state.material][state.mode];
        const maxSpd = profile.printSpeed || 180;
        const maxFlw = profile.maxFlow || 18.0;

        const lineW = (state.expert && state.expert.lineWidth) || 0.45;
        const layerH = profile.layerHeight || 0.2;
        const capSpd = (v) => Math.max(15, Math.min(v, maxFlw / Math.max(0.02, lineW * layerH)));
        const speedMap = {
            outer: capSpd(maxSpd * 0.68), inner: capSpd(maxSpd * 0.88), solid: capSpd(maxSpd * 0.82),
            sparse: capSpd(maxSpd * 0.95), extras: capSpd(Math.min(90, maxSpd * 0.55))
        };
        const flowMap = {
            outer: speedMap.outer * lineW * layerH, inner: speedMap.inner * lineW * layerH, solid: speedMap.solid * lineW * layerH,
            sparse: speedMap.sparse * lineW * layerH, extras: speedMap.extras * lineW * layerH
        };

        const getHeatColor = (t) => {
            const clampT = Math.max(0, Math.min(1, t));
            let r = 0, g = 0, b = 0;
            if (clampT < 0.25) {
                const k = clampT / 0.25;
                r = 0; g = Math.round(180 * k); b = 255;
            } else if (clampT < 0.5) {
                const k = (clampT - 0.25) / 0.25;
                r = 0; g = 255; b = Math.round(255 * (1 - k));
            } else if (clampT < 0.75) {
                const k = (clampT - 0.5) / 0.25;
                r = Math.round(255 * k); g = 255; b = 0;
            } else {
                const k = (clampT - 0.75) / 0.25;
                r = 255; g = Math.round(255 * (1 - k)); b = 0;
            }
            return [r / 255, g / 255, b / 255];
        };

        const defaultColors = {
            outer: [0.984, 0.573, 0.235],
            inner: [0.980, 0.800, 0.082],
            solid: [0.753, 0.518, 0.988],
            sparse: [0.957, 0.247, 0.369],
            extras: [0.063, 0.725, 0.506]
        };

        gcodeGroup.traverse(node => {
            if (node.isMesh && node.userData && node.userData.featureType) {
                const fType = node.userData.featureType;
                const colAttr = node.geometry.attributes.color;
                if (!colAttr) return;

                let targetRgb;
                if (mode === 'type') {
                    targetRgb = defaultColors[fType] || [0.8, 0.8, 0.8];
                } else if (mode === 'speed') {
                    const val = speedMap[fType] || 100;
                    targetRgb = getHeatColor((val - 30) / (maxSpd - 30));
                } else if (mode === 'flow') {
                    const val = flowMap[fType] || 10;
                    targetRgb = getHeatColor(val / maxFlw);
                }

                const arr = colAttr.array;
                for (let i = 0; i < arr.length; i += 3) {
                    arr[i] = targetRgb[0];
                    arr[i + 1] = targetRgb[1];
                    arr[i + 2] = targetRgb[2];
                }
                colAttr.needsUpdate = true;
            }
        });
        triggerSceneRender();
    }
}

function setViewportMode(mode) {
    if (mode === 'gcode' && state.slicedLayers.length === 0) { runSlicer(); return; }
    if (mode !== 'gcode' && state.layerPlayInterval) {
        clearInterval(state.layerPlayInterval); state.layerPlayInterval = null;
        const pb = document.getElementById('btn-layer-play');
        if (pb) pb.innerHTML = `<i class="fa-solid fa-play text-xs"></i>`;
    }
    state.viewportMode = mode;
    bedModels.forEach(m => { m.visible = (mode === 'model'); });
    if (gcodeGroup) gcodeGroup.visible = (mode === 'gcode') && (state.showGcodeLayers !== false);
    updateSelectionVisuals();
    const lPanel = document.getElementById('gcode-layer-panel');
    const legendPanel = document.getElementById('gcode-legend');
    const b3d = document.getElementById('btn-view-3d');
    const bgc = document.getElementById('btn-view-gcode');
    if (lPanel) lPanel.classList.toggle('hidden', mode === 'model');
    if (legendPanel) legendPanel.classList.toggle('hidden', mode === 'model');
    if (b3d) b3d.className = mode === 'model' ? "px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition bg-cyan-500 text-slate-950 shadow" : "px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition text-slate-300 hover:text-white";
    if (bgc) bgc.className = mode === 'gcode' ? "px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition bg-emerald-400 text-slate-950 shadow" : "px-2 py-1 rounded-md text-[11px] font-bold flex items-center gap-1 transition text-slate-300 hover:text-white";

    const slider = document.getElementById('layer-slider');
    if (slider) onLayerSliderChange(slider.value);
    triggerSceneRender();
}

function toggleLayerViewMode() {
    state.layerViewMode = (state.layerViewMode === 'all') ? 'single' : 'all';
    const lbl = document.getElementById('label-layer-mode');
    if (lbl) {
        lbl.textContent = (state.layerViewMode === 'all') ? 'Все до N' : 'Только N';
    }
    const slider = document.getElementById('layer-slider');
    if (slider) onLayerSliderChange(slider.value);
}

function toggleGcodeFeatureFilter(feature, isVisible) {
    if (!state.featureFilters) {
        state.featureFilters = { outer: true, inner: true, solid: true, sparse: true, extras: true };
    }
    state.featureFilters[feature] = Boolean(isVisible);
    if (gcodeGroup) {
        gcodeGroup.traverse(node => {
            if (node.isMesh && node.userData && node.userData.featureType === feature) {
                node.visible = Boolean(isVisible);
            }
        });
        triggerSceneRender();
    }
}