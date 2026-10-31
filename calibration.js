/* ====================================================================
 * 14. CALIBRATION (тест Linear Advance для стоковой прошивки Marlin)
 * Подключается ПОСЛЕ marlin-safe.js. Карточка появляется на вкладке «Тесты».
 * Печатает один слой из линий «медленно - быстро - медленно»; перед каждой
 * линией стоит M900 K. Выбираем линию с самыми ровными углами перехода.
 * Если все линии одинаковые, значит прошивка не поддерживает M900: оставьте K = 0.
 * ==================================================================== */
(function (root) {
    'use strict';

    const LINE_W = 0.4, LAYER_H = 0.2, FIL_AREA = Math.PI * Math.pow(1.75 / 2, 2);
    const X0 = 70, SLOW1 = 20, FAST = 40, SLOW2 = 20, Y0 = 60, ROW = 5;
    const SLOW_SPEED = 20;   // мм/с

    function fmt(n, d) { return Number(n).toFixed(d === undefined ? 3 : d); }

    // чистая функция: собирает G-код теста, без обращения к DOM
    function buildLA(o) {
        const S = o.marlin;
        const prof = o.profile;
        if (o.material === 'TPU') throw new Error('Для TPU тест не подходит: гибкий пластик печатается медленно');
        const n = Math.max(3, Math.min(16, Math.round(o.count)));
        const kStart = Math.max(0, o.kStart), kStep = Math.max(0.001, o.kStep);
        const maxFlow = prof.maxFlow || 10;
        // быстрая секция не выше 75% лимита потока профиля и не выше 100 мм/с
        const vFast = Math.max(40, Math.min(100, Math.floor(0.75 * maxFlow / (LINE_W * LAYER_H) / 10) * 10));
        const flow = (o.flowPct || 100) / 100;
        const ePerMm = LINE_W * LAYER_H / FIL_AREA * flow;
        const f1 = SLOW_SPEED * 60, f2 = vFast * 60;

        const L = [];
        L.push('; Тест Linear Advance (Ender 3 V3 SE, Marlin)');
        L.push(`; Линий: ${n}, K от ${fmt(kStart)} с шагом ${fmt(kStep)}. Первая линия (K минимальный) ближе к вам.`);
        L.push(`; Быстрая секция ${vFast} мм/с. Выберите линию с ровными углами; если все одинаковы, M900 не поддерживается.`);
        L.push('G21', 'G90', 'M83');
        const purge = S.choosePurge({ minX: X0, maxX: X0 + SLOW1 + FAST + SLOW2, minY: Y0, maxY: Y0 + ROW * n }, o.purgeSlot || 0);
        S.buildStart(o.bed, o.nozzle, purge).forEach(l => L.push(l));
        L.push('M106 S0');
        L.push('M204 P1000 T1000');
        L.push('G1 Z0.6 F600');
        for (let i = 0; i < n; i++) {
            const k = kStart + i * kStep;
            const y = Y0 + i * ROW;
            L.push(`; Линия ${i + 1}: K=${fmt(k)}`);
            L.push(`M900 K${fmt(k)}`);
            L.push(`G1 X${X0} Y${y} F6000`);
            L.push('G1 Z0.2 F600');
            L.push('G1 E0.6 F1200');
            L.push(`G1 X${X0 + SLOW1} E${fmt(SLOW1 * ePerMm)} F${f1}`);
            L.push(`G1 X${X0 + SLOW1 + FAST} E${fmt(FAST * ePerMm)} F${f2}`);
            L.push(`G1 X${X0 + SLOW1 + FAST + SLOW2} E${fmt(SLOW2 * ePerMm)} F${f1}`);
            L.push('G1 E-0.6 F1800');
            L.push('G1 Z0.6 F600');
        }
        L.push('M900 K0');
        S.buildEnd(1, S.CFG.cooldownNozzleTo).forEach(l => L.push(l));
        const text = L.join('\n') + '\n';

        // тот же аудит, что и у обычной печати
        const rep = S.processGcode(text, { maxFlow: maxFlow * 1.0 }).report;
        if (!rep.ok) throw new Error('Проверка безопасности: ' + rep.errors.join('; '));
        return { text, vFast, kEnd: kStart + (n - 1) * kStep };
    }

    function num(id, d) { const v = parseFloat(String(document.getElementById(id).value).replace(',', '.')); return isFinite(v) ? v : d; }
    function toast(m) { if (typeof showToast === 'function') showToast(m); }

    function onDownload() {
        try {
            if (!root.SalimMarlin) throw new Error('Не подключён marlin-safe.js');
            const prof = ((PROFILES[state.material] || {})[state.mode]) || {};
            const o = {
                marlin: root.SalimMarlin, profile: prof, material: state.material,
                bed: prof.bedTemp || 60, nozzle: prof.nozzleTemp || 210,
                kStart: num('cal-kstart', 0), kStep: num('cal-kstep', 0.01), count: num('cal-count', 11),
                flowPct: (state.expert && state.expert.flowRate) || 100,
                purgeSlot: 0
            };
            const r = buildLA(o);
            const name = `Ender3V3SE_LA_test_K${fmt(o.kStart, 2)}-${fmt(r.kEnd, 2)}.gcode`;
            saveTextFile(name, r.text, 'application/octet-stream');
            toast('Скачано: ' + name);
        } catch (e) { toast('Тест не создан: ' + e.message); }
    }

    function buildPanel() {
        const host = document.getElementById('tab-content-models');
        if (!host || document.getElementById('salim-la-test')) return;
        const inp = 'w-full bg-slate-950 border border-slate-700 rounded-xl px-2 py-1 text-[11px] font-mono-code text-white select-text';
        const lbl = 'text-[9px] text-slate-400 block mb-0.5';
        const box = document.createElement('div');
        box.id = 'salim-la-test';
        box.className = 'p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2';
        box.innerHTML = `
            <div class="text-[10px] font-extrabold text-amber-400 uppercase tracking-wide">Тест Linear Advance (K)</div>
            <div class="grid grid-cols-3 gap-2">
                <div><label class="${lbl}">K с</label><input id="cal-kstart" type="number" step="0.01" min="0" value="0" class="${inp}"></div>
                <div><label class="${lbl}">Шаг</label><input id="cal-kstep" type="number" step="0.005" min="0.001" value="0.01" class="${inp}"></div>
                <div><label class="${lbl}">Линий</label><input id="cal-count" type="number" step="1" min="3" max="16" value="11" class="${inp}"></div>
            </div>
            <button type="button" id="cal-la-btn" class="w-full py-2 rounded-xl bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-extrabold transition active:scale-95">Скачать G-code теста</button>
            <p class="text-[9px] text-slate-400 leading-snug">Печатает один слой из линий «медленно, быстро, медленно» с разным K. Первая линия (меньший K) ближе к вам. Выберите линию, где нет утолщения в начале быстрого участка и просвета в конце. Впишите её K в «Профили → Проф. режим → Linear Advance K». Если все линии выглядят одинаково, прошивка не поддерживает M900: оставьте 0.</p>`;
        host.appendChild(box);
        document.getElementById('cal-la-btn').addEventListener('click', onDownload);
    }

    root.SalimCalibration = { buildLA };
    if (typeof document !== 'undefined') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildPanel);
        else buildPanel();
    }
})(typeof window !== 'undefined' ? window : globalThis);
