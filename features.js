/* ====================================================================
 * 7. FEATURES (шов, виды заполнения, юбка, панель настроек качества)
 * Подключается ПОСЛЕ ui.js. Используется правками в runSlicer (slicer-core.js).
 * Если файл не подключён, нарезка работает как раньше.
 * ==================================================================== */
(function (root) {
    'use strict';

    const KEY = 'salim_features_v1';
    const DEF = {
        seam: 'rear',            // default | rear | corner | random
        infillPattern: 'lines',  // lines | grid | triangles
        skirt: false,
        skirtLoops: 2,
        skirtDist: 4,            // мм от модели
        minLayerTime: true       // замедлять слои с малым временем (см. marlin-safe.js)
    };
    const F = Object.assign({}, DEF);
    try {
        const saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
        if (saved && typeof saved === 'object') Object.keys(DEF).forEach(k => { if (saved[k] !== undefined) F[k] = saved[k]; });
    } catch (e) { /* без сохранённых настроек */ }
    function save() { try { root.localStorage.setItem(KEY, JSON.stringify(F)); } catch (e) { /* ignore */ } }

    /* ---------- ШОВ: поворот замкнутого кольца так, чтобы печать начиналась в нужной точке ---------- */
    function seamIndex(ring, n, l) {
        let rear = 0;
        for (let i = 1; i < n; i++) {
            if (ring[i].z < ring[rear].z - 1e-6 || (Math.abs(ring[i].z - ring[rear].z) <= 1e-6 && ring[i].x < ring[rear].x)) rear = i;
        }
        if (F.seam === 'rear') return rear;
        if (F.seam === 'random') {
            const r = Math.sin(l * 12.9898 + ring[0].x * 78.233 + ring[0].z * 37.719) * 43758.5453;
            return Math.floor((r - Math.floor(r)) * n) % n;
        }
        if (F.seam === 'corner') {
            let best = -1, bestZ = Infinity;
            for (let i = 0; i < n; i++) {
                const a = ring[(i - 1 + n) % n], b = ring[i], c = ring[i + 1];
                const v1x = b.x - a.x, v1z = b.z - a.z, v2x = c.x - b.x, v2z = c.z - b.z;
                const l1 = Math.hypot(v1x, v1z), l2 = Math.hypot(v2x, v2z);
                if (l1 < 1e-6 || l2 < 1e-6) continue;
                const dot = (v1x * v2x + v1z * v2z) / (l1 * l2);
                if (dot < 0.5 && b.z < bestZ) { bestZ = b.z; best = i; }   // угол острее 60°, ближе к задней стенке
            }
            return best >= 0 ? best : rear;
        }
        return 0;
    }

    function seamRing(ring, l) {
        try {
            if (!ring || ring.length < 4 || F.seam === 'default') return ring;
            if (typeof state !== 'undefined' && state.expert && state.expert.vaseMode) return ring;
            const n = ring.length - 1;
            const k = seamIndex(ring, n, l || 0);
            if (!k) return ring;
            const out = ring.slice(k, n).concat(ring.slice(0, k));
            out.push(out[0]);
            return out;
        } catch (e) { return ring; }
    }

    /* ---------- ЗАПОЛНЕНИЕ: общий расход материала как у линий, меняется только рисунок ---------- */
    function sparseInfill(segs, minX, maxX, minZ, maxZ, l, spacing) {
        const g = generateLinesInfill;
        if (F.infillPattern === 'grid') {
            const sp = spacing * 2;
            return g(segs, minX, maxX, minZ, maxZ, 45, sp).concat(g(segs, minX, maxX, minZ, maxZ, -45, sp));
        }
        if (F.infillPattern === 'triangles') {
            const sp = spacing * 3;
            return g(segs, minX, maxX, minZ, maxZ, 0, sp)
                .concat(g(segs, minX, maxX, minZ, maxZ, 60, sp))
                .concat(g(segs, minX, maxX, minZ, maxZ, 120, sp));
        }
        return g(segs, minX, maxX, minZ, maxZ, (l % 2 === 0) ? 45 : -45, spacing);
    }

    /* ---------- ЮБКА на первом слое (если нет каймы) ---------- */
    function addSkirt(layerMoves, l, outerRings, lineWidth) {
        try {
            if (l !== 0 || !F.skirt || (typeof state !== 'undefined' && state.brim)) return;
            if (!outerRings || outerRings.length === 0 || typeof ClipperLib === 'undefined') return;
            const SCALE = 1000;
            const paths = outerRings.map(r => r.slice(0, r.length - 1).map(p => ({ X: Math.round(p.x * SCALE), Y: Math.round(p.z * SCALE) })));
            const outerOnly = outerRings.filter((r, i) => {
                let depth = 0;
                for (let j = 0; j < paths.length; j++) {
                    if (j !== i && ClipperLib.Clipper.PointInPolygon(paths[i][0], paths[j]) !== 0) depth++;
                }
                return depth % 2 === 0;
            });
            const limX = PRINTER_SPECS.bedX / 2 - 1, limZ = PRINTER_SPECS.bedY / 2 - 1;
            const inside = (p) => Math.abs(p.x) <= limX && Math.abs(p.z) <= limZ;
            const loops = Math.max(1, Math.min(5, F.skirtLoops | 0));
            for (let b = 0; b < loops; b++) {
                const rings = createInsetContours(outerOnly, -(F.skirtDist + b * lineWidth));
                for (const r of rings) {
                    const segs = contourToSegs(r, true).filter(s => inside(s.p1) && inside(s.p2));
                    layerMoves.extras.push(...segs);
                }
            }
        } catch (e) { console.warn('Юбка не построена:', e); }
    }

/* ---------- ПАНЕЛЬ НАСТРОЕК (добавляется в конец вкладки «Печать») ---------- */
    function buildPanel() {
        const host = document.getElementById('tab-content-print');
        if (!host || document.getElementById('salim-features-panel')) return;
        const sel = 'w-full bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 text-[10px] font-bold text-white';
        const lbl = 'text-[9px] text-slate-400';
        const box = document.createElement('div');
        box.id = 'salim-features-panel';
        box.className = 'p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2.5';
        box.innerHTML = `
            <div class="text-[10px] font-extrabold text-cyan-400 uppercase tracking-wide flex items-center justify-between">
                <span>Ресурс механики и кинематика</span>
                <i class="fa-solid fa-shield-halved text-emerald-400"></i>
            </div>

            <div class="pt-1 border-t border-slate-800/80">
                <div class="${lbl}">Положение шва</div>
                <select id="feat-seam" class="${sel}">
                    <option value="rear">Сзади (вертикальная линия)</option>
                    <option value="corner">В острых углах</option>
                    <option value="random">Случайно</option>
                    <option value="default">Без оптимизации</option>
                </select>
            </div>

            <div>
                <div class="${lbl}">Рисунок заполнения</div>
                <select id="feat-infill" class="${sel}">
                    <option value="lines">Линии ±45°</option>
                    <option value="grid">Сетка (Grid)</option>
                    <option value="triangles">Треугольники</option>
                </select>
            </div>

            <label class="flex items-center justify-between gap-2 cursor-pointer">
                <span class="text-[10px] font-bold text-slate-300">Юбка (Skirt, если нет каймы)</span>
                <input type="checkbox" id="feat-skirt" class="accent-cyan-400">
            </label>

            <label class="flex items-center justify-between gap-2 cursor-pointer">
                <span class="text-[10px] font-bold text-slate-300">Замедлять мелкие слои (охлаждение)</span>
                <input type="checkbox" id="feat-minlayer" class="accent-cyan-400">
            </label>

            <!-- Калибровка точного времени M73 под экран принтера -->
            <div class="pt-1.5 border-t border-slate-800/80">
                <div class="${lbl} mb-1">Точность таймера M73 на экране SE:</div>
                <div class="flex items-center gap-1.5">
                    <input type="number" id="inp-real-minutes" placeholder="Факт (мин)" class="w-24 bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 text-[10px] font-mono-code text-white">
                    <button type="button" id="btn-apply-calib" class="flex-1 py-1 px-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 text-[10px] font-bold transition active:scale-95">
                        Подогнать время
                    </button>
                </div>
            </div>`;
        host.appendChild(box);

        const bind = (id, prop, isCheck) => {
            const el = document.getElementById(id);
            if (!el) return;
            if (isCheck) el.checked = !!F[prop]; else el.value = F[prop];
            el.addEventListener('change', () => {
                F[prop] = isCheck ? el.checked : el.value;
                save();
                if (typeof invalidateSlicedGcode === 'function') invalidateSlicedGcode();
            });
        };
        bind('feat-seam', 'seam', false);
        bind('feat-infill', 'infillPattern', false);
        bind('feat-skirt', 'skirt', true);
        bind('feat-minlayer', 'minLayerTime', true);

        // Кнопка калибровки времени
        const btnCalib = document.getElementById('btn-apply-calib');
        if (btnCalib) {
            btnCalib.onclick = () => {
                const inp = document.getElementById('inp-real-minutes');
                const realMins = parseFloat(inp ? inp.value : 0);
                const M = root.SalimMarlin;
                if (!realMins || realMins <= 0 || !root.state || !root.state.lastSliceStats || !M) {
                    if (typeof showToast === 'function') showToast('Сначала нарежьте модель и укажите реальные минуты');
                    return;
                }
                const estMins = root.state.lastSliceStats.totalTimeSec / 60;
                const newRatio = Number((M.CFG.timeCalibration * realMins / estMins).toFixed(3));
                M.CFG.timeCalibration = newRatio;
                try { root.localStorage.setItem('salim_time_calib', String(newRatio)); } catch (e) {}
                if (typeof showToast === 'function') showToast(`Коэффициент времени: ${newRatio} (M73 скорректирован)`);
                if (inp) inp.value = '';
            };
        }

        // Восстановление коэффициента калибровки при старте
        try {
            const savedCalib = parseFloat(root.localStorage.getItem('salim_time_calib') || '1');
            if (savedCalib > 0.4 && savedCalib < 3.0 && root.SalimMarlin) {
                root.SalimMarlin.CFG.timeCalibration = savedCalib;
            }
        } catch (e) {}

        if (typeof root.setSafetyMode === 'function') {
            root.setSafetyMode(root.localStorage.getItem('salim_safety_mode') || 'safe', true);
        }
    }

    root.SalimFeatures = { F, seamRing, sparseInfill, addSkirt, buildPanel };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
        else buildPanel();
    }
})(typeof window !== 'undefined' ? window : globalThis);