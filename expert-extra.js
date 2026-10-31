/* ====================================================================
 * 9. EXPERT EXTRA (расширенные профессиональные настройки)
 * Подключается ПОСЛЕ features.js. Добавляет разделы в «Профили → Проф. режим».
 * ==================================================================== */
(function (root) {
    'use strict';

    const KEY = 'salim_expert_extra_v1';

const SECTIONS = [
        { t: 'Филамент', f: [
            { k: 'filamentDiameter', l: 'Диаметр прутка, мм', h: 'Стандарт для SE — 1.75 мм. Измерьте штангенциркулем для точности расчёта веса', def: 1.75, min: 1.5, max: 3.0, step: 0.01 },
            { k: 'density', l: 'Плотность, г/см³', h: 'PLA ~1.24, PETG ~1.27, TPU ~1.21. Нужна для точного расчёта граммов', prof: true, min: 0.8, max: 2.0, step: 0.01 },
            { k: 'retractSpeed', l: 'Скорость отката, мм/с', h: 'Для директ-экструдера Sprite: оптимально 25–40 мм/с. Выше 60 ставить опасно', prof: true, mul: 60, min: 5, max: 60, step: 1 }
        ] },
        { t: 'Первый слой', f: [
            { k: 'firstLayerHeight', l: 'Высота слоя, мм', h: '0.20 мм оптимально для сопла 0.4. Обеспечивает надёжное прижатие к столу', def: 0.20, min: 0.08, max: 0.40, step: 0.02 },
            { k: 'firstLayerSpeed', l: 'Скорость, мм/с (0 = авто)', h: 'Медленная печать первого слоя (20–30 мм/с) гарантирует сцепление с PEI', def: 0, min: 0, max: 80, step: 1 },
            { k: 'firstLayerWidthPct', l: 'Ширина линии, %', h: '110–120% вмазывает пластик в текстуру стола, убирая щели', def: 110, min: 80, max: 200, step: 5 }
        ] },
        { t: 'Скорости и ускорения', f: [
            { k: 'outerWallPct', l: 'Внешняя стенка, %', h: 'Снижение до 60–70% убирает рябь и делает поверхность детали гладкой', def: 68, min: 20, max: 150, step: 1 },
            { k: 'innerWallPct', l: 'Внутр. стенки, %', h: 'Можно печатать быстрее внешних (85–90%)', def: 88, min: 20, max: 150, step: 1 },
            { k: 'solidPct', l: 'Крышки и дно, %', h: 'Скорость сплошных поверхностей для плотного запечатывания', def: 82, min: 20, max: 150, step: 1 },
            { k: 'sparsePct', l: 'Заполнение, %', h: 'Внутренности детали можно гнать на максимуме (95–100%)', def: 95, min: 20, max: 150, step: 1 },
            { k: 'extrasPct', l: 'Кайма / поддержки, %', h: 'Медленная печать поддержек предотвращает их падение', def: 55, min: 20, max: 150, step: 1 },
            { k: 'travelSpeed', l: 'Холостой переезд, мм/с', h: '0 = авто. Базово 100–120 мм/с (быстрее на SE приводит к звону стола)', def: 0, min: 0, max: 250, step: 5 },
            { k: 'accelPct', l: 'Ускорения, %', h: '100% = норма. Для тишины и ресурса механики ставьте 70–80%', def: 100, min: 30, max: 200, step: 5 }
        ] },
        { t: 'Откаты (Ретракты Sprite)', f: [
            { k: 'retractMinTravel', l: 'Мин. переезд для отката, мм', h: 'Не дёргать пруток на мелких скачках меньше этого расстояния', def: 0.6, min: 0, max: 10, step: 0.1 },
            { k: 'retractLongTravel', l: 'Откат при переезде от, мм', h: 'Принудительный ретракт при дальних поездках через всю деталь', def: 25, min: 5, max: 200, step: 1 },
            { k: 'retractOnLayerChange', l: 'Откат на смене слоя', h: 'Убирает вертикальные прыщи на шве в момент подъёма Z', type: 'chk', def: true }
        ] },
        { t: 'Обдув и охлаждение', f: [
            { k: 'auxFan', l: 'Доп. обдув (M106 P2) для PLA', h: 'Команда для модификаций с дополнительным боковым вентилятором', type: 'chk', def: true }
        ] },
        { t: 'Поддержки', f: [
            { k: 'supportZGap', l: 'Зазор по Z, мм (0 = авто)', h: 'Расстояние между поддержкой и моделью. 0.18–0.22 мм легко отрываются', def: 0, min: 0, max: 1, step: 0.02 },
            { k: 'supportXYGap', l: 'Зазор до модели XY, мм', h: 'Отступ сбоку, чтобы поддержки не припекались к стенкам', def: 0.5, min: 0, max: 3, step: 0.1 },
            { k: 'supportInterface', l: 'Слоёв мостика (интерфейс)', h: 'Количество плотных слоёв под висящей плоскостью', def: 3, min: 0, max: 8, step: 1 },
            { k: 'supportSpacing', l: 'Шаг сетки поддержек', h: 'Множитель ширины линии. Чем больше — тем легче выламывать', def: 4, min: 1.5, max: 12, step: 0.5 }
        ] },
        { t: 'Прошивка и калибровка SE', f: [
            { k: 'levelingMode', l: 'Сетка стола (CR Touch)', h: 'G29 снимает сетку перед печатью; M420 загружает сохранённую из памяти EEPROM', type: 'sel', def: 'g29', o: [['g29', 'G29 (автокалибровка перед стартом)'], ['m420', 'M420 (брать сохранённую сетку)'], ['none', 'Без выравнивания']] },
            { k: 'nozzlePreheat', l: 'Сопло пока греется стол, °C', h: '150°C не даёт пластику капать из сопла во время замера стола щупом', def: 150, min: 100, max: 200, step: 5 },
            { k: 'cooldownNozzleTo', l: 'Ждать остывания сопла, °C', h: 'В конце печати крутит вентилятор до 60°C, защищая горло хотэнда от пробки', def: 60, min: 0, max: 200, step: 5 },
            { k: 'linearAdvanceK', l: 'Linear Advance K', h: '0 = выкл. Для стоковой прошивки держите 0. Включать только при наличии M900 в Marlin', def: 0, min: 0, max: 2, step: 0.01 },
            { k: 'minLayerTimeSec', l: 'Мин. время слоя, с', h: 'Если слой печатается быстрее этого времени, принтер сбавит ход для остывания пластика', def: 0, min: 0, max: 60, step: 1 }
        ] }
    ];

    const inputCls = 'w-full bg-slate-900 border border-slate-700 rounded-xl px-2 py-1.5 font-mono-code text-white select-text text-xs';
    const idOf = (k) => 'xx-' + k;
    const curProfile = () => (PROFILES[state.material] || {})[state.mode] || {};

    function applyCfg() {
        try {
            const M = root.SalimMarlin && root.SalimMarlin.CFG;
            if (!M || !state.expert) return;
            const e = state.expert;
            if (['g29', 'm420', 'none'].indexOf(e.levelingMode) >= 0) M.levelingMode = e.levelingMode;
            if (isFinite(e.nozzlePreheat)) M.nozzlePreheat = e.nozzlePreheat;
            if (isFinite(e.cooldownNozzleTo)) M.cooldownNozzleTo = e.cooldownNozzleTo;
            if (isFinite(e.linearAdvanceK)) M.linearAdvanceK = e.linearAdvanceK;
        } catch (err) { /* ничего */ }
    }

    function build() {
        const panel = document.getElementById('expert-settings-panel');
        if (!panel || document.getElementById('salim-expert-extra')) return;

        // Переключатель «Простой / Экспертный»
        let modeSwitch = document.getElementById('salim-mode-switch');
        if (!modeSwitch) {
            modeSwitch = document.createElement('div');
            modeSwitch.id = 'salim-mode-switch';
            modeSwitch.className = 'flex items-center justify-between p-2 rounded-xl bg-slate-950 border border-slate-800 mb-3';
            modeSwitch.innerHTML = `
                <span class="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                    <i class="fa-solid fa-sliders text-cyan-400"></i> Уровень настроек:
                </span>
                <div class="flex gap-1">
                    <button type="button" id="btn-lvl-simple" class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-cyan-500 text-slate-950 transition">Простой</button>
                    <button type="button" id="btn-lvl-expert" class="px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-slate-400 hover:text-white transition">Эксперт</button>
                </div>
            `;
            panel.parentNode.insertBefore(modeSwitch, panel);

            const btnSimple = document.getElementById('btn-lvl-simple');
            const btnExpert = document.getElementById('btn-lvl-expert');
            const setLvl = (isExp) => {
                btnSimple.className = !isExp ? "px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-cyan-500 text-slate-950" : "px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-slate-400 hover:text-white";
                btnExpert.className = isExp ? "px-2.5 py-1 rounded-lg text-[10px] font-extrabold bg-cyan-500 text-slate-950" : "px-2.5 py-1 rounded-lg text-[10px] font-extrabold text-slate-400 hover:text-white";
                panel.classList.toggle('hidden', !isExp);
                try { localStorage.setItem('salim_ui_level', isExp ? 'expert' : 'simple'); } catch (e) {}
            };
            btnSimple.onclick = () => setLvl(false);
            btnExpert.onclick = () => setLvl(true);

            const savedLvl = localStorage.getItem('salim_ui_level') === 'expert';
            setLvl(savedLvl);
        }

        const box = document.createElement('div');
        box.id = 'salim-expert-extra';
        box.className = 'space-y-3 pt-2 border-t border-slate-800/80';
        box.innerHTML = SECTIONS.map(s => {
            const fields = s.f.map(f => {
                const id = idOf(f.k);
                const tip = f.h ? `title="${f.h}"` : '';
                const qIcon = f.h ? `<i class="fa-solid fa-circle-question text-[9px] text-cyan-400/80 cursor-help ml-1" ${tip}></i>` : '';
                if (f.type === 'chk') return `<label class="col-span-2 flex items-center gap-1.5 text-[10px] font-bold text-slate-300 cursor-pointer" ${tip}><input type="checkbox" id="${id}" class="accent-cyan-400"> ${f.l} ${qIcon}</label>`;
                if (f.type === 'sel') return `<div class="col-span-2" ${tip}><label class="text-slate-400 text-[10px] block mb-1">${f.l} ${qIcon}</label><select id="${id}" class="${inputCls}">${f.o.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('')}</select></div>`;
                return `<div ${tip}><label class="text-slate-400 text-[10px] block mb-1">${f.l} ${qIcon}</label><input type="number" id="${id}" min="${f.min}" max="${f.max}" step="${f.step}" class="${inputCls}"></div>`;
            }).join('');
            return `<details class="xx-sec rounded-xl border border-slate-800 bg-slate-900/60"><summary class="cursor-pointer px-3 py-2 text-[11px] font-extrabold text-cyan-400 uppercase tracking-wide flex items-center justify-between">${s.t}<i class="fa-solid fa-chevron-down text-[9px] text-slate-500"></i></summary><div class="p-2"><div class="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">${fields}</div></div></details>`;
        }).join('') + '<p class="text-[9px] text-slate-500 leading-snug">Наведите курсор или нажмите на значок вопроса рядом с параметром, чтобы узнать подробности.</p>';

        const mainBody = document.createElement('div');
        mainBody.className = 'space-y-2';
        Array.from(panel.children).slice(2).forEach(el => mainBody.appendChild(el));
        const mainSec = document.createElement('details');
        mainSec.className = 'xx-sec rounded-xl border border-slate-800 bg-slate-900/60';
        mainSec.open = true;
        mainSec.innerHTML = '<summary class="cursor-pointer px-3 py-2 text-[11px] font-extrabold text-cyan-400 uppercase tracking-wide flex items-center justify-between">Основное: стенки, поток, режимы<i class="fa-solid fa-chevron-down text-[9px] text-slate-500"></i></summary>';
        const mainWrap = document.createElement('div');
        mainWrap.className = 'p-2';
        mainWrap.appendChild(mainBody);
        mainSec.appendChild(mainWrap);
        box.insertBefore(mainSec, box.firstChild);

        box.addEventListener('toggle', (ev) => {
            const t = ev.target;
            if (!t || !t.classList || !t.classList.contains('xx-sec') || !t.open) return;
            box.querySelectorAll('details.xx-sec').forEach(d => { if (d !== t) d.open = false; });
        }, true);
        panel.appendChild(box);
    }

    function writeUI() {
        const exp = state.expert || {};
        SECTIONS.forEach(s => s.f.forEach(f => {
            const el = document.getElementById(idOf(f.k));
            if (!el) return;
            let v = f.prof ? curProfile()[f.k] : exp[f.k];
            if (f.prof && v !== undefined && f.mul) v = v / f.mul;
            if (f.type === 'chk') el.checked = (v === undefined) ? !!f.def : !!v;
            else if (f.type === 'sel') el.value = v || f.def;
            else el.value = (v === undefined || v === null) ? (f.def !== undefined ? f.def : '') : v;
        }));
    }

    function readUI() {
        const exp = state.expert;
        SECTIONS.forEach(s => s.f.forEach(f => {
            const el = document.getElementById(idOf(f.k));
            if (!el) return;
            if (f.type === 'chk') { exp[f.k] = el.checked; return; }
            if (f.type === 'sel') { exp[f.k] = el.value; return; }
            let v = parseFloat(el.value);
            if (!isFinite(v)) { if (f.prof) return; v = f.def; }
            v = Number(Math.max(f.min, Math.min(f.max, v)).toFixed(3));
            if (f.prof) curProfile()[f.k] = f.mul ? Math.round(v * f.mul) : v;
            else exp[f.k] = v;
        }));
    }

    function persist() {
        try {
            const out = {};
            SECTIONS.forEach(s => s.f.forEach(f => { if (!f.prof && state.expert[f.k] !== undefined) out[f.k] = state.expert[f.k]; }));
            root.localStorage.setItem(KEY, JSON.stringify(out));
        } catch (e) { /* ничего */ }
    }

    // Сохранённые значения с прошлого запуска
    try {
        const saved = JSON.parse(root.localStorage.getItem(KEY) || 'null');
        if (saved && typeof saved === 'object') Object.assign(state.expert, saved);
    } catch (e) { /* ничего */ }
    applyCfg();

    if (typeof root.openProfileDetailsModal === 'function') {
        const origOpen = root.openProfileDetailsModal;
        root.openProfileDetailsModal = function () {
            const r = origOpen.apply(this, arguments);
            try { build(); writeUI(); applyCfg(); } catch (e) { /* ничего */ }
            return r;
        };
    }
    if (typeof root.saveCustomProfileEdits === 'function') {
        const origSave = root.saveCustomProfileEdits;
        root.saveCustomProfileEdits = function () {
            try { readUI(); } catch (e) { /* ничего */ }
            const r = origSave.apply(this, arguments);
            persist(); applyCfg();
            return r;
        };
    }
    if (typeof root.hardResetSlicer === 'function') {
        const origReset = root.hardResetSlicer;
        root.hardResetSlicer = function () {
            try { root.localStorage.removeItem(KEY); } catch (e) { /* ничего */ }
            const r = origReset.apply(this, arguments);
            try {
                const M = root.SalimMarlin && root.SalimMarlin.CFG;
                if (M) { M.levelingMode = 'g29'; M.nozzlePreheat = 150; M.cooldownNozzleTo = 60; M.linearAdvanceK = 0; }
                writeUI();
            } catch (e) { /* ничего */ }
            return r;
        };
    }
})(typeof window !== 'undefined' ? window : globalThis);