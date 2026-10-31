/* ====================================================================
 * 12. PRINTABILITY (проверка модели + красная подсветка нависаний)
 * Подключается ПОСЛЕ ui.js. Карточка появляется на вкладке «Модель».
 * Порог нависаний берётся из ползунка «Угол» поддержек (state.supportOverhangAngle),
 * как в самом слайсере: грань с нормалью, у которой ny < -sin(угол).
 * ==================================================================== */
(function (root) {
    'use strict';

    const MAX_TRIS_TOPOLOGY = 400000;

    /* ---------- чистая математика (без three.js, проверяется тестом) ---------- */
    function analyze(pos, idx, m, angleDeg) {
        const T = idx ? Math.floor(idx.length / 3) : Math.floor(pos.length / 9);
        const get = (i) => idx ? idx[i] : i;
        const crit = -Math.sin(angleDeg * Math.PI / 180);
        const wv = new Float64Array(9);
        let minY = Infinity, maxY = -Infinity, minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;

        // проход 1: границы в мировых координатах
        for (let t = 0; t < T; t++) {
            for (let k = 0; k < 3; k++) {
                const v = get(t * 3 + k) * 3;
                const x = pos[v], y = pos[v + 1], z = pos[v + 2];
                const X = m[0] * x + m[4] * y + m[8] * z + m[12];
                const Y = m[1] * x + m[5] * y + m[9] * z + m[13];
                const Z = m[2] * x + m[6] * y + m[10] * z + m[14];
                if (Y < minY) minY = Y; if (Y > maxY) maxY = Y;
                if (X < minX) minX = X; if (X > maxX) maxX = X;
                if (Z < minZ) minZ = Z; if (Z > maxZ) maxZ = Z;
            }
        }

        let area = 0, overArea = 0, baseArea = 0;
        const overTris = [];
        const doTopo = T <= MAX_TRIS_TOPOLOGY;
        const vid = doTopo ? new Map() : null;
        const edges = doTopo ? new Map() : null;
        const ids = [0, 0, 0];

        for (let t = 0; t < T; t++) {
            for (let k = 0; k < 3; k++) {
                const iv = get(t * 3 + k) * 3;
                const x = pos[iv], y = pos[iv + 1], z = pos[iv + 2];
                wv[k * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
                wv[k * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
                wv[k * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
                if (doTopo) {
                    const key = Math.round(x * 1000) + ',' + Math.round(y * 1000) + ',' + Math.round(z * 1000);
                    let id = vid.get(key);
                    if (id === undefined) { id = vid.size; vid.set(key, id); }
                    ids[k] = id;
                }
            }
            const ax = wv[3] - wv[0], ay = wv[4] - wv[1], az = wv[5] - wv[2];
            const bx = wv[6] - wv[0], by = wv[7] - wv[1], bz = wv[8] - wv[2];
            const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
            const len = Math.sqrt(cx * cx + cy * cy + cz * cz);
            if (len < 1e-9) continue;
            const a = len * 0.5;
            const ny = cy / len;
            area += a;
            const cyc = (wv[1] + wv[4] + wv[7]) / 3;
            const yMax = Math.max(wv[1], wv[4], wv[7]);
            if (ny < crit && cyc > minY + 0.3) { overArea += a; overTris.push(t); }
            if (ny < -0.98 && yMax <= minY + 0.2) baseArea += a;
            if (doTopo) {
                for (let k = 0; k < 3; k++) {
                    const p = ids[k], q = ids[(k + 1) % 3];
                    if (p === q) continue;
                    const key = p < q ? p * 4194304 + q : q * 4194304 + p;
                    edges.set(key, (edges.get(key) || 0) + 1);
                }
            }
        }

        let open = 0, nonManifold = 0;
        if (doTopo) edges.forEach(c => { if (c === 1) open++; else if (c > 2) nonManifold++; });

        return {
            tris: T, area, overArea, overPct: area > 0 ? overArea / area * 100 : 0, overTris, baseArea,
            height: maxY - minY, width: maxX - minX, depth: maxZ - minZ, minY,
            open, nonManifold, topoChecked: doTopo
        };
    }

    function messages(r, opts) {
        const w = [];
        const ang = opts.angle;
        if (r.overPct > 2) {
            let s = `Нависания круче ${ang}°: ${r.overPct.toFixed(1)}% поверхности (${(r.overArea / 100).toFixed(1)} см²).`;
            if (!opts.supports) s += ' Поддержки выключены: нависания могут провиснуть.';
            w.push(s);
        }
        if (r.baseArea < 1 && r.height > 5) w.push('Модель не опирается на стол плоской гранью. Используйте «Гранью на стол».');
        else if (r.baseArea < 100 && r.height > 25) w.push(`Малая площадь основания (${(r.baseArea / 100).toFixed(2)} см²) при высоте ${r.height.toFixed(0)} мм. Добавьте кайму.`);
        const minSide = Math.min(r.width, r.depth);
        if (minSide > 1 && r.height / minSide > 5) w.push(`Высокая и узкая: высота в ${(r.height / minSide).toFixed(1)} раза больше основания. Риск качания, используйте кайму и режим «Бережный».`);
        if (r.open > 0) w.push(`В сетке ${r.open} незамкнутых рёбер (дырки). Возможны пропуски в стенках; почините модель в редакторе.`);
        if (r.nonManifold > 0) w.push(`Рёбер, общих более чем для двух граней: ${r.nonManifold}. Сетка некорректна, возможны артефакты.`);
        if (!r.topoChecked) w.push('Модель слишком большая: целостность сетки не проверялась.');
        return w;
    }

    /* ---------- интеграция ---------- */
    function meshes() { try { return (typeof bedModels !== 'undefined') ? bedModels : []; } catch (e) { return []; } }
    function angleNow() { return (typeof state !== 'undefined' && isFinite(state.supportOverhangAngle)) ? state.supportOverhangAngle : 52; }

    function analyzeMesh(mesh) {
        mesh.updateMatrixWorld(true);
        const g = mesh.geometry;
        const pos = g.attributes.position.array;
        const idx = g.index ? g.index.array : null;
        return analyze(pos, idx, mesh.matrixWorld.elements, angleNow());
    }

    function runCheck() {
        const out = document.getElementById('pb-result');
        if (!out) return;
        const list = meshes();
        if (!list.length) { out.innerHTML = '<span class="text-slate-400">Сначала откройте модель.</span>'; return; }
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
        const supports = (typeof state !== 'undefined') && !!state.supports;
        const rows = [];
        list.forEach((mesh, n) => {
            let r;
            try { r = analyzeMesh(mesh); } catch (e) { rows.push('Не удалось проанализировать модель: ' + e.message); return; }
            const tag = list.length > 1 ? `Модель ${n + 1}: ` : '';
            const w = messages(r, { angle: angleNow(), supports });
            if (w.length === 0) rows.push(`<span style="color:#6ee7b7">${tag}замечаний нет</span> (${r.tris.toLocaleString('ru-RU')} граней, нависаний ${r.overPct.toFixed(1)}%)`);
            else w.forEach(x => rows.push(`<span style="color:#fcd34d">• ${esc(tag + x)}</span>`));
        });
        out.innerHTML = rows.join('<br>');
    }

    /* ---------- красные нависания поверх модели ---------- */
    let overlayOn = false, rebuildTimer = null;

    function clearOverlay(mesh) {
        const old = mesh.getObjectByName('salim-overhang');
        if (old) { mesh.remove(old); if (old.geometry) old.geometry.dispose(); if (old.material) old.material.dispose(); }
        delete mesh.userData._ohSig;
    }

    function buildOverlay(mesh) {
        const sig = mesh.geometry.uuid + '|' + mesh.quaternion.toArray().map(v => v.toFixed(4)).join(',') + '|' + mesh.scale.x.toFixed(4) + '|' + angleNow();
        if (mesh.userData._ohSig === sig && mesh.getObjectByName('salim-overhang')) return;
        clearOverlay(mesh);
        const r = analyzeMesh(mesh);
        mesh.userData._ohSig = sig;
        if (!r.overTris.length) { if (typeof triggerSceneRender === 'function') triggerSceneRender(); return; }
        const g = mesh.geometry, pos = g.attributes.position.array, idx = g.index ? g.index.array : null;
        const arr = new Float32Array(r.overTris.length * 9);
        let o = 0;
        for (const t of r.overTris) {
            for (let k = 0; k < 3; k++) {
                const v = (idx ? idx[t * 3 + k] : t * 3 + k) * 3;
                arr[o++] = pos[v]; arr[o++] = pos[v + 1]; arr[o++] = pos[v + 2];
            }
        }
        const og = new THREE.BufferGeometry();
        (og.setAttribute || og.addAttribute).call(og, 'position', new THREE.BufferAttribute(arr, 3));
        const mat = new THREE.MeshBasicMaterial({
            color: 0xef4444, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide,
            polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
        });
        const ov = new THREE.Mesh(og, mat);
        ov.name = 'salim-overhang';
        ov.raycast = function () { };
        mesh.add(ov);
        if (typeof triggerSceneRender === 'function') triggerSceneRender();
    }

    function refreshOverlays() {
        meshes().forEach(m => { try { if (overlayOn) buildOverlay(m); else clearOverlay(m); } catch (e) { console.warn('Нависания:', e); } });
        if (typeof triggerSceneRender === 'function') triggerSceneRender();
    }

    function toggleOverlay() {
        overlayOn = !overlayOn;
        const b = document.getElementById('pb-overhang');
        if (b) {
            b.textContent = overlayOn ? 'Нависания: вкл' : 'Нависания: выкл';
            b.className = BTN + (overlayOn ? ' bg-rose-500/25 border-rose-500/50 text-rose-300' : ' bg-slate-800 border-slate-700 text-slate-200');
        }
        refreshOverlays();
    }

    const BTN = 'flex-1 py-1.5 px-2 rounded-xl border text-[10px] font-extrabold transition active:scale-95';

    function buildPanel() {
        const host = document.getElementById('tab-content-model');
        if (!host || document.getElementById('salim-printability')) return;
        const box = document.createElement('div');
        box.id = 'salim-printability';
        box.className = 'p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2';
        box.innerHTML = `
            <div class="text-[10px] font-extrabold text-cyan-400 uppercase tracking-wide">Проверка печатаемости</div>
            <div class="flex gap-2">
                <button type="button" id="pb-check" class="${BTN} bg-cyan-500/20 border-cyan-500/40 text-cyan-300">Проверить модель</button>
                <button type="button" id="pb-overhang" class="${BTN} bg-slate-800 border-slate-700 text-slate-200">Нависания: выкл</button>
            </div>
            <div id="pb-result" class="text-[10px] leading-snug text-slate-300"></div>`;
        host.appendChild(box);
        document.getElementById('pb-check').addEventListener('click', runCheck);
        document.getElementById('pb-overhang').addEventListener('click', toggleOverlay);
    }

    function hookSelection() {
        const o = root.updateSelectionVisuals;
        if (typeof o !== 'function' || o.__salimPrintab) return;
        const w = function () {
            const r = o.apply(this, arguments);
            if (overlayOn) {
                clearTimeout(rebuildTimer);
                rebuildTimer = setTimeout(refreshOverlays, 250);
            }
            return r;
        };
        w.__salimPrintab = true;
        root.updateSelectionVisuals = w;
    }

    root.SalimPrintability = { analyze, messages, runCheck, toggleOverlay };
    if (typeof document !== 'undefined') {
        hookSelection();
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
        else buildPanel();
    }
})(typeof window !== 'undefined' ? window : globalThis);
