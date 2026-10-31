/* ====================================================================
 * 10. FILAMENTS (свои филаменты: ABS, ASA, карбон и т.д. + остаток катушки)
 * Подключается ПОСЛЕ expert-extra.js
 * ==================================================================== */
(function (root) {
    'use strict';

    const KEY = 'salim_filaments_v1';
    const BUILTIN = ['PLA', 'PETG', 'TPU'];
    const MODE_NAMES = { speed: 'Speed', balanced: 'Balanced', quality: 'Quality', minweight: 'Min Weight' };
    const MODE_OFF = { speed: 5, balanced: 0, quality: -5, minweight: 0 };

    // Типовые значения: обязательно сверяйте с этикеткой своей катушки
    const TPL = {
        'ABS':     { base: 'PETG', nozzle: 245, bed: 95, fan: 20, density: 1.04, flow: 10, speed: 95, retract: 0.6, abr: false },
        'ASA':     { base: 'PETG', nozzle: 250, bed: 95, fan: 20, density: 1.07, flow: 10, speed: 95, retract: 0.6, abr: false },
        'PLA-CF':  { base: 'PLA',  nozzle: 220, bed: 60, fan: 100, density: 1.30, flow: 9, speed: 85, retract: 0.6, abr: true },
        'PETG-CF': { base: 'PETG', nozzle: 250, bed: 75, fan: 30, density: 1.30, flow: 8, speed: 80, retract: 0.6, abr: true },
        'ABS-CF':  { base: 'PETG', nozzle: 250, bed: 95, fan: 20, density: 1.10, flow: 8, speed: 85, retract: 0.6, abr: true }
    };

    let lib = [];
    let lastCharged = null;
    let editing = null;

    const num = (v, d, lo, hi) => { v = parseFloat(v); if (!isFinite(v)) v = d; return Math.max(lo, Math.min(hi, v)); };
    const clean = (s) => String(s || '').replace(/[^\w\-+. а-яА-ЯёЁ]/g, '').trim().slice(0, 14);
    const esc = (s) => (typeof escapeHtml === 'function') ? escapeHtml(s) : String(s);
    const toast = (m) => { if (typeof showToast === 'function') showToast(m); };

    function norm(f) {
        const total = num(f.total, 0, 0, 10000);
        return {
            name: clean(f.name),
            base: f.base === 'PLA' ? 'PLA' : 'PETG',
            nozzle: num(f.nozzle, 230, 170, 300),
            bed: num(f.bed, 60, 0, 100),
            fan: num(f.fan, 50, 0, 100),
            density: num(f.density, 1.24, 0.8, 2.0),
            flow: num(f.flow, 10, 2, 30),
            speed: num(f.speed, 100, 30, 150),
            retract: num(f.retract, 0.6, 0, 2),
            total: total,
            left: total > 0 ? Math.min(total, num(f.left, total, 0, 10000)) : 0,
            abr: !!f.abr
        };
    }

    function persist() { try { root.localStorage.setItem(KEY, JSON.stringify(lib)); } catch (e) { /* ничего */ } }
    function active() { return lib.find(f => f.name === state.material) || null; }

    /* ---------- Превращаем запись библиотеки в 4 режима печати ---------- */
    function register(rec) {
        const base = DEFAULT_PROFILES[rec.base] || DEFAULT_PROFILES.PLA;
        const cap = (state.expert && state.expert.hotendType === 'ceramic') ? 300 : 260;
        const out = {};
        Object.keys(base).forEach(mode => {
            const b = base[mode];
            out[mode] = Object.assign({}, b, {
                label: rec.name + ' • SE ' + (MODE_NAMES[mode] || mode),
                nozzleTemp: Math.max(170, Math.min(cap, Math.round(rec.nozzle + (MODE_OFF[mode] || 0)))),
                bedTemp: Math.round(rec.bed),
                fanSpeed: Math.round(rec.fan),
                density: rec.density,
                printSpeed: Math.max(20, Math.round(b.printSpeed * rec.speed / 100)),
                maxFlow: Number(Math.max(2, rec.flow * b.maxFlow / base.balanced.maxFlow).toFixed(1)),
                retractDist: rec.retract
            });
        });
        PROFILES[rec.name] = out;
    }

    function load() {
        let raw = [];
        try { const s = JSON.parse(root.localStorage.getItem(KEY) || 'null'); if (Array.isArray(s)) raw = s; } catch (e) { /* ничего */ }
        const seen = {};
        lib = [];
        raw.forEach(r => {
            if (!r || typeof r.name !== 'string') return;
            const f = norm(r);
            if (!f.name || BUILTIN.indexOf(f.name) >= 0 || seen[f.name]) return;
            if (f.name in PROFILES) return;
            seen[f.name] = true;
            lib.push(f);
        });
        lib.forEach(register);
    }

    /* ---------- Блок на вкладке «Печать» ---------- */
    function render() {
        const host = document.getElementById('salim-fil-block');
        if (!host) return;
        const cur = state.material;
        const f = active();
        let html = '<div class="flex items-center justify-between gap-2"><span class="text-[10px] font-extrabold text-cyan-400 uppercase tracking-wide">Мои филаменты</span>' +
            '<button type="button" data-act="add" class="px-2 py-1 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-[10px] font-bold"><i class="fa-solid fa-plus"></i> Добавить</button></div>';
        if (lib.length === 0) {
            html += '<p class="text-[10px] text-slate-400 leading-snug">Пока пусто. Нажмите «Добавить»: ABS, ASA, карбон и любые другие, с температурами и остатком катушки.</p>';
        } else {
            html += '<div class="flex flex-wrap gap-1.5">' + lib.map(x => {
                const on = x.name === cur;
                return '<button type="button" data-fil="' + esc(x.name) + '" class="px-2.5 py-1.5 rounded-xl border text-[11px] font-black transition active:scale-95 ' +
                    (on ? 'border-cyan-400 bg-cyan-500/20 text-cyan-300' : 'border-slate-700 bg-slate-950 text-slate-200') + '">' + esc(x.name) + '</button>';
            }).join('') + '</div>';
        }
        if (f) {
            const tracked = f.total > 0;
            const pct = tracked ? Math.max(0, Math.min(100, f.left / f.total * 100)) : 0;
            const col = pct < 15 ? '#f43f5e' : (pct < 40 ? '#fbbf24' : '#34d399');
            html += '<div class="space-y-1"><div class="flex items-center justify-between text-[10px] font-mono-code"><span class="text-slate-300">' + esc(f.name) + (f.abr ? ' • абразивный' : '') + '</span><span class="text-slate-200">' +
                (tracked ? Math.round(f.left) + ' / ' + Math.round(f.total) + ' г' : 'без учёта катушки') + '</span></div>' +
                (tracked ? '<div class="h-1.5 rounded-full bg-slate-950 border border-slate-800 overflow-hidden"><div style="width:' + pct.toFixed(0) + '%;background:' + col + ';height:100%"></div></div>' : '') +
                '<div class="flex gap-1.5 pt-0.5">' +
                '<button type="button" data-act="edit" class="flex-1 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold"><i class="fa-solid fa-pen text-cyan-400"></i> Изменить</button>' +
                '<button type="button" data-act="del" class="flex-1 py-1 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[10px] font-bold"><i class="fa-solid fa-trash-can"></i> Удалить</button></div></div>';
        }
        host.innerHTML = html;
    }

    function buildBlock() {
        if (document.getElementById('salim-fil-block')) return;
        const anchor = document.getElementById('btn-mat-PLA');
        if (!anchor || !anchor.parentNode) return;
        const host = document.createElement('div');
        host.id = 'salim-fil-block';
        host.className = 'mt-2 p-2.5 rounded-2xl bg-slate-900/90 border border-slate-800 space-y-2';
        anchor.parentNode.insertAdjacentElement('afterend', host);
        host.addEventListener('click', (e) => {
            const chip = e.target.closest('button[data-fil]');
            if (chip) { selectMaterial(chip.getAttribute('data-fil')); return; }
            const act = e.target.closest('button[data-act]');
            if (!act) return;
            const a = act.getAttribute('data-act');
            if (a === 'add') openForm(null);
            else if (a === 'edit') { const f = active(); if (f) openForm(f.name); }
            else if (a === 'del') deleteActive();
        });
        render();
    }

    function deleteActive() {
        const f = active();
        if (!f) return;
        const doDel = () => {
            delete PROFILES[f.name];
            lib = lib.filter(x => x.name !== f.name);
            persist();
            selectMaterial('PLA', true);
            render();
            toast('Удалён филамент: ' + f.name);
        };
        showConfirmDialog({ title: 'Удалить филамент', message: 'Удалить «' + f.name + '» из библиотеки?', confirmText: 'Удалить', cancelText: 'Отмена', type: 'rose', icon: 'fa-trash-can' }, doDel);
    }

    /* ---------- Окно добавления / правки ---------- */
    const cls = 'w-full bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs font-mono-code text-white select-text';
    const fld = (id, label, extra) => '<div><label class="text-slate-400 text-[10px] block mb-1">' + label + '</label><input type="number" id="' + id + '" ' + (extra || '') + ' class="' + cls + '"></div>';

    function buildModal() {
        if (document.getElementById('salim-fil-modal')) return;
        const m = document.createElement('div');
        m.id = 'salim-fil-modal';
        m.className = 'hidden fixed inset-0 bg-slate-950/85 backdrop-blur-md flex items-center justify-center p-3 z-[90]';
        m.innerHTML =
            '<div class="w-full max-w-md max-h-[92dvh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-3xl p-4 space-y-3 shadow-2xl">' +
            '<div class="flex items-center justify-between border-b border-slate-800 pb-2"><h3 id="fil-title" class="text-sm font-black text-white">Новый филамент</h3>' +
            '<button type="button" id="fil-close" class="w-8 h-8 rounded-xl bg-slate-800 text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button></div>' +
            '<div><div class="text-[10px] text-slate-400 mb-1">Шаблон (потом всё можно поправить)</div><div class="flex flex-wrap gap-1.5">' +
            Object.keys(TPL).map(k => '<button type="button" data-tpl="' + k + '" class="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[10px] font-bold text-cyan-300">' + k + '</button>').join('') +
            '</div></div>' +
            '<div class="grid grid-cols-2 gap-2">' +
            '<div><label class="text-slate-400 text-[10px] block mb-1">Название (до 14 символов)</label><input type="text" id="fil-name" maxlength="14" class="' + cls + '"></div>' +
            '<div><label class="text-slate-400 text-[10px] block mb-1">Основа режимов</label><select id="fil-base" class="' + cls + '"><option value="PETG">Как PETG (медленнее)</option><option value="PLA">Как PLA (быстрее)</option></select></div>' +
            fld('fil-nozzle', 'Сопло, °C', 'min="170" max="300" step="1"') +
            fld('fil-bed', 'Стол, °C', 'min="0" max="100" step="1"') +
            fld('fil-fan', 'Обдув, %', 'min="0" max="100" step="5"') +
            fld('fil-density', 'Плотность, г/см³', 'min="0.8" max="2" step="0.01"') +
            fld('fil-flow', 'Макс. поток, мм³/с', 'min="2" max="30" step="0.5"') +
            fld('fil-speed', 'Скорость, % от основы', 'min="30" max="150" step="5"') +
            fld('fil-retract', 'Откат, мм', 'min="0" max="2" step="0.1"') +
            fld('fil-total', 'Вес катушки, г (0 = без учёта)', 'min="0" max="10000" step="10"') +
            fld('fil-left', 'Осталось, г', 'min="0" max="10000" step="10"') +
            '</div>' +
            '<label class="flex items-center gap-1.5 text-[10px] font-bold text-amber-300 cursor-pointer"><input type="checkbox" id="fil-abr" class="accent-amber-400"> Абразивный (карбон, стекло): нужна стальная насадка</label>' +
            '<div class="flex gap-2 pt-2 border-t border-slate-800"><button type="button" id="fil-cancel" class="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs">Отмена</button>' +
            '<button type="button" id="fil-save" class="flex-1 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-xs">Сохранить</button></div>' +
            '</div>';
        document.body.appendChild(m);
        const close = () => m.classList.add('hidden');
        document.getElementById('fil-close').onclick = close;
        document.getElementById('fil-cancel').onclick = close;
        document.getElementById('fil-save').onclick = saveForm;
        m.addEventListener('click', (e) => {
            const t = e.target.closest('button[data-tpl]');
            if (!t) return;
            const key = t.getAttribute('data-tpl');
            const cur = readRaw();
            setForm(Object.assign({}, TPL[key], { name: cur.name || key, total: cur.total, left: cur.left }));
        });
    }

    const $ = (id) => document.getElementById(id);
    function setForm(v) {
        $('fil-name').value = v.name || '';
        $('fil-base').value = v.base === 'PLA' ? 'PLA' : 'PETG';
        $('fil-nozzle').value = v.nozzle; $('fil-bed').value = v.bed; $('fil-fan').value = v.fan;
        $('fil-density').value = v.density; $('fil-flow').value = v.flow; $('fil-speed').value = v.speed;
        $('fil-retract').value = v.retract; $('fil-total').value = v.total; $('fil-left').value = v.left;
        $('fil-abr').checked = !!v.abr;
    }
    function readRaw() {
        return {
            name: clean($('fil-name').value), base: $('fil-base').value,
            nozzle: $('fil-nozzle').value, bed: $('fil-bed').value, fan: $('fil-fan').value,
            density: $('fil-density').value, flow: $('fil-flow').value, speed: $('fil-speed').value,
            retract: $('fil-retract').value, total: $('fil-total').value, left: $('fil-left').value,
            abr: $('fil-abr').checked
        };
    }

    function openForm(name) {
        buildModal();
        editing = name || null;
        const f = name ? lib.find(x => x.name === name) : null;
        $('fil-title').textContent = f ? 'Изменить филамент' : 'Новый филамент';
        setForm(f || { name: '', base: 'PETG', nozzle: 240, bed: 80, fan: 40, density: 1.2, flow: 10, speed: 100, retract: 0.6, total: 1000, left: 1000, abr: false });
        $('salim-fil-modal').classList.remove('hidden');
    }

    function saveForm() {
        const raw = readRaw();
        if (!raw.name) { toast('Введите название'); return; }
        const taken = BUILTIN.indexOf(raw.name) >= 0 ||
            lib.some(x => x.name === raw.name && x.name !== editing) ||
            (!lib.some(x => x.name === raw.name) && (raw.name in PROFILES));
        if (taken) { toast('Такое название уже занято'); return; }
        const rec = norm(raw);
        if (editing) {
            const idx = lib.findIndex(x => x.name === editing);
            if (idx >= 0) lib[idx] = rec; else lib.push(rec);
            if (editing !== rec.name) delete PROFILES[editing];
        } else {
            lib.push(rec);
        }
        register(rec);
        persist();
        $('salim-fil-modal').classList.add('hidden');
        if (typeof invalidateSlicedGcode === 'function') invalidateSlicedGcode();
        selectMaterial(rec.name, true);
        toast('Филамент сохранён: ' + rec.name);
    }

    /* ---------- Встраиваемся в программу ---------- */
    if (typeof root.selectMaterial === 'function') {
        const origSel = root.selectMaterial;
        root.selectMaterial = function (mat, silent) {
            const r = origSel.apply(this, arguments);
            try {
                render();
                const f = lib.find(x => x.name === mat);
                if (f && f.abr && !silent && state.expert && state.expert.nozzleType !== 'steel') {
                    toast('⚠️ Карбон абразивный: латунное сопло быстро сотрётся. Нужна стальная насадка (Проф. режим → Материал сопла)');
                }
            } catch (e) { /* ничего */ }
            return r;
        };
    }
    if (typeof root.syncAllControlsUI === 'function') {
        const origSync = root.syncAllControlsUI;
        root.syncAllControlsUI = function () {
            const r = origSync.apply(this, arguments);
            try { render(); } catch (e) { /* ничего */ }
            return r;
        };
    }
    if (typeof root.hardResetSlicer === 'function') {
        const origReset = root.hardResetSlicer;
        root.hardResetSlicer = function () {
            const r = origReset.apply(this, arguments);
            try { lib.forEach(register); render(); } catch (e) { /* ничего */ }
            return r;
        };
    }
    // Предупреждение, если катушки не хватит
    if (typeof root.updateSliceSummaryUI === 'function') {
        const origUI = root.updateSliceSummaryUI;
        root.updateSliceSummaryUI = function (secs, grams) {
            const r = origUI.apply(this, arguments);
            try {
                const f = active();
                if (f && f.total > 0 && state.lastSliceStats && grams > f.left) {
                    toast('⚠️ Нужно ' + grams.toFixed(0) + ' г, на катушке «' + f.name + '» осталось ' + Math.round(f.left) + ' г');
                }
            } catch (e) { /* ничего */ }
            return r;
        };
    }
    // После скачивания G-кода предлагаем списать вес с катушки
    if (typeof root.downloadGcodeFile === 'function') {
        const origDl = root.downloadGcodeFile;
        root.downloadGcodeFile = async function () {
            const r = await origDl.apply(this, arguments);
            try {
                const f = active();
                const st = state.lastSliceStats;
                if (f && f.total > 0 && st && state.generatedGcode && state.generatedGcode !== lastCharged) {
                    const g = Math.round(st.totalGrams * 10) / 10;
                    showConfirmDialog({
                        title: 'Учёт катушки',
                        message: 'Списать ' + g + ' г с катушки «' + f.name + '»? Останется ' + Math.max(0, f.left - g).toFixed(0) + ' г.',
                        confirmText: 'Списать', cancelText: 'Нет', type: 'emerald', icon: 'fa-weight-hanging'
                    }, () => {
                        f.left = Math.max(0, f.left - g);
                        lastCharged = state.generatedGcode;
                        persist(); render();
                        toast('Осталось ' + Math.round(f.left) + ' г');
                    });
                }
            } catch (e) { /* ничего */ }
            return r;
        };
    }

    load();
    root.SalimFilaments = { get library() { return lib; }, openForm };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildBlock);
    else buildBlock();
})(typeof window !== 'undefined' ? window : globalThis);