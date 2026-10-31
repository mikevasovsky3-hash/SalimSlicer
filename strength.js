/* STRENGTH: ползунок «Назначение детали» (заполнение, стенки, крышка/дно, рисунок) */
(function (root) {
    'use strict';
    const KEY = 'salim_strength_v1';
    const L = [null,
        { name: 'Декор',      infill: 15, walls: 2, top: 4, bottom: 3, pattern: 'lines',     use: 'Фигурки, макеты, вазы: нагрузки почти нет' },
        { name: 'Бытовое',    infill: 25, walls: 3, top: 5, bottom: 4, pattern: 'grid',      use: 'Подставки, корпуса, органайзеры' },
        { name: 'Инструмент', infill: 40, walls: 4, top: 6, bottom: 5, pattern: 'grid',      use: 'Лекала, шаблоны, оснастка, кронштейны' },
        { name: 'Монолит',    infill: 60, walls: 5, top: 7, bottom: 6, pattern: 'triangles', use: 'Максимальная прочность: долго и много пластика' }
    ];
    let lvl = 0, custom = null;
    try { lvl = Math.max(0, Math.min(4, parseInt(root.localStorage.getItem(KEY) || '0', 10) || 0)); } catch (e) { /* ничего */ }

    function render() {
        const t = document.getElementById('strength-text');
        const v = document.getElementById('strength-val');
        if (!t || !v) return;
        const s = document.getElementById('strength-slider');
        if (s) s.value = lvl;
        if (lvl === 0) {
            v.textContent = 'По режиму';
            t.textContent = 'Заполнение и стенки берутся из выбранного режима печати.';
            return;
        }
        const p = L[lvl];
        const inf = custom !== null ? custom : p.infill;
        v.textContent = lvl + '. ' + p.name;
        t.textContent = p.use + '. Заполнение ' + inf + '%' + (custom !== null ? ' (изменено вручную)' : '') +
            ', стенок ' + p.walls + ', крышка ' + p.top + ', дно ' + p.bottom + '.';
    }

    function apply(n) {
        lvl = n; custom = null;
        try { root.localStorage.setItem(KEY, String(lvl)); } catch (e) { /* ничего */ }
        if (lvl > 0) {
            const p = L[lvl];
            state.infill = p.infill;
            state.expert.wallCount = p.walls;
            state.expert.topLayers = p.top;
            state.expert.bottomLayers = p.bottom;
            const sel = document.getElementById('feat-infill');
            if (sel) { sel.value = p.pattern; sel.dispatchEvent(new Event('change')); }
        }
        if (typeof syncProfileSummaryUI === 'function') syncProfileSummaryUI(false);
        if (typeof invalidateSlicedGcode === 'function') invalidateSlicedGcode();
        render();
    }

    function build() {
        const slider = document.getElementById('infill-slider');
        if (!slider || document.getElementById('salim-strength')) return;
        const row = slider.closest('.grid');
        if (!row || !row.parentNode) return;
        const box = document.createElement('div');
        box.id = 'salim-strength';
        box.className = 'p-2.5 rounded-2xl border border-slate-800 bg-slate-900 space-y-1.5';
        box.innerHTML =
            '<div class="flex items-center justify-between text-xs font-bold"><span class="text-slate-300">Назначение детали</span>' +
            '<span id="strength-val" class="font-mono-code text-amber-300">По режиму</span></div>' +
            '<input type="range" id="strength-slider" min="0" max="4" step="1" value="0" class="w-full">' +
            '<div class="flex justify-between text-[9px] text-slate-500 font-mono-code"><span>Авто</span><span>Декор</span><span>Быт</span><span>Инстр.</span><span>Монолит</span></div>' +
            '<p id="strength-text" class="text-[10px] text-slate-400 leading-snug"></p>';
        row.parentNode.insertBefore(box, row);
        document.getElementById('strength-slider').addEventListener('input', (e) => apply(parseInt(e.target.value, 10) || 0));
        if (lvl > 0) apply(lvl); else render();
    }

    // смена пластика или режима сбрасывает заполнение на значение профиля, возвращаем выбранное
    const origSync = root.syncProfileSummaryUI;
    if (typeof origSync === 'function') {
        root.syncProfileSummaryUI = function (reset) {
            if (lvl > 0 && reset !== false) {
                state.infill = custom !== null ? custom : L[lvl].infill;
                return origSync.call(this, false);
            }
            return origSync.apply(this, arguments);
        };
    }
    // ручное движение ползунка заполнения запоминаем
    const origInf = root.onInfillChange;
    if (typeof origInf === 'function') {
        root.onInfillChange = function () {
            const r = origInf.apply(this, arguments);
            if (lvl > 0) { custom = (state.infill !== L[lvl].infill) ? state.infill : null; render(); }
            return r;
        };
    }

    root.SalimStrength = { apply, levels: L };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build);
    else build();
})(typeof window !== 'undefined' ? window : globalThis);