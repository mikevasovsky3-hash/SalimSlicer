/* ====================================================================
 * 6. MARLIN ADAPTER + SAFETY AUDIT (Creality Ender 3 V3 SE, стоковая прошивка)
 * Подключается ПОСЛЕ ui.js. Оборачивает generateKlipperGcode и updateSliceSummaryUI.
 *
 * Что делает:
 *  - переводит Klipper-команды (SET_VELOCITY_LIMIT, SET_PRESSURE_ADVANCE,
 *    EXCLUDE_OBJECT_*) в команды Marlin (M204) или убирает их;
 *  - ставит новый старт (подогрев стола, сопло 150°C пока греется стол,
 *    выравнивание, продувка с ротацией места) и новый финиш (остывание сопла,
 *    безопасный подъём Z, потом выключение моторов);
 *  - считает честное время печати и переписывает M73 для экрана принтера;
 *  - проверяет G-code перед выдачей: границы стола, NaN, температуры,
 *    экструзия без нагрева, ускорения, подачи, объёмный поток.
 *
 * Настройки можно переопределить заранее: window.SALIM_SAFETY_CFG = { ... }
 * ==================================================================== */
(function (root) {
    'use strict';

    const CFG = Object.assign({
        levelingMode: 'g29',      // 'g29' (сетка перед печатью) | 'm420' (загрузить сохранённую) | 'none'
        linearAdvanceK: 0,        // 0 = не писать M900. Включайте только если Linear Advance есть в вашей прошивке
        nozzlePreheat: 150,       // сопло держим холодным, пока греется стол и идёт выравнивание
        maxNozzle: 260,           // жёсткий потолок сопла (°C)
        maxNozzleCeramic: 300,    // потолок, если в экспертных настройках выбран керамический хотэнд
        maxBed: 100,              // жёсткий потолок стола (°C)
        bed: { x: 220, y: 220, z: 250 },
        maxAccel: 2500,           // выше этого значения M204 даёт предупреждение
        maxFeed: 12000,           // мм/мин, выше даёт предупреждение
        maxZFeed: 1200,           // мм/мин для движений только по Z
        flowTolerance: 1.15,      // допуск над maxFlow профиля
        cooldownNozzleTo: 60,     // в конце ждать остывания сопла до этой температуры (0 = не ждать)
        purgeLen: 130, purgeE: 10, purgeSlots: 8, purgeClearance: 8,
        timeCalibration: 1.0,     // после первой реальной печати подправьте: реальное_время / оценка
        junctionSpeed: 10,        // мм/с, скорость на стыке мелких сегментов
        zMoveSpeed: 8,            // мм/с, предел для движений только по Z
        warnAspectRatio: 5,       // высота / меньшая сторона основания
        edgeMargin: 2,            // мм, ближе к краю стола предупреждаем
        bedHeatSecPerDeg: 5,      // для оценки времени нагрева
        minLayerTimeSec: { PLA: 8, PETG: 12, TPU: 10 }, // слои короче замедляются через M220
        minLayerSpeedPct: 40      // не медленнее этого процента от скорости
    }, root.SALIM_SAFETY_CFG || {});

    let FIL_AREA = Math.PI * Math.pow(1.75 / 2, 2);

    /* ---------- режимы безопасности ---------- */
    const SAFETY_MODES = {
        safe: {
            label: 'Безопасный', speed: 1.00, accel: 1.00, travel: 4800, flow: 1.00,
            maxAccel: 2500, maxFeed: 12000, flowTolerance: 1.15, junctionSpeed: 10, minLayer: true,
            hint: 'Максимальный запас: скорости и ускорения строго по профилю'
        },
        medium: {
            label: 'Средний', speed: 1.15, accel: 1.25, travel: 6000, flow: 1.10,
            maxAccel: 3200, maxFeed: 15000, flowTolerance: 1.22, junctionSpeed: 12, minLayer: true,
            hint: '+15% скорость, +25% ускорение, переезды 100 мм/с'
        },
        extreme: {
            label: 'Экстремальный', speed: 1.35, accel: 1.60, travel: 7800, flow: 1.25,
            maxAccel: 4500, maxFeed: 20000, flowTolerance: 1.35, junctionSpeed: 15, minLayer: false,
            hint: '+35% скорость, ускорение ×1.6, переезды 130 мм/с. Риск вибраций, следите за печатью'
        }
    };
    let currentMode = 'safe';
    try {
        const savedMode = root.localStorage.getItem('salim_safety_mode');
        if (savedMode && SAFETY_MODES[savedMode]) currentMode = savedMode;
    } catch (e) { /* localStorage недоступен */ }

    function getSafetyMode() { return Object.assign({ key: currentMode }, SAFETY_MODES[currentMode]); }

    function applyModeToCfg() {
        const m = SAFETY_MODES[currentMode];
        CFG.maxAccel = m.maxAccel;
        CFG.maxFeed = m.maxFeed;
        CFG.flowTolerance = m.flowTolerance;
        CFG.junctionSpeed = m.junctionSpeed;
    }

    function renderSafetyModeUI() {
        const base = 'py-1.5 px-1 rounded-xl border text-[10px] font-extrabold transition active:scale-95 ';
        const on = {
            safe: 'border-emerald-500/60 bg-emerald-500/20 text-emerald-300',
            medium: 'border-amber-500/60 bg-amber-500/20 text-amber-300',
            extreme: 'border-rose-500/60 bg-rose-500/20 text-rose-300'
        };
        const off = 'border-slate-700 bg-slate-950 text-slate-400';
        Object.keys(SAFETY_MODES).forEach(k => {
            const btn = document.getElementById('btn-safety-' + k);
            if (btn) btn.className = base + (k === currentMode ? on[k] : off);
        });
        const hint = document.getElementById('safety-mode-hint');
        if (hint) hint.textContent = SAFETY_MODES[currentMode].hint;

        // ---- постоянная индикация режима на всём экране ----
        const COL = {
            safe: { rgb: '16,185,129', text: '#6ee7b7', label: 'БЕЗОПАСНЫЙ РЕЖИМ' },
            medium: { rgb: '245,158,11', text: '#fcd34d', label: 'СРЕДНИЙ РЕЖИМ: +15% скорость, +25% ускорение' },
            extreme: { rgb: '244,63,94', text: '#fda4af', label: 'ЭКСТРЕМАЛЬНЫЙ РЕЖИМ: +35% скорость, риск вибраций и недоэкструзии. Нажмите, чтобы вернуть безопасный' }
        };
        const c = COL[currentMode];
        if (!document.body) { document.addEventListener('DOMContentLoaded', renderSafetyModeUI, { once: true }); return; }

        let st = document.getElementById('salim-mode-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'salim-mode-style';
            st.textContent = '@keyframes salimModePulse{0%,100%{opacity:1}50%{opacity:.45}}';
            document.head.appendChild(st);
        }
        let frame = document.getElementById('salim-mode-frame');
        if (!frame) {
            frame = document.createElement('div');
            frame.id = 'salim-mode-frame';
            frame.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;z-index:70;pointer-events:none;';
            document.body.appendChild(frame);
        }
        let badge = document.getElementById('salim-mode-badge');
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'salim-mode-badge';
            badge.style.cssText = 'position:fixed;left:50%;top:0;transform:translateX(-50%);z-index:71;max-width:94vw;padding:2px 12px;border-radius:0 0 12px 12px;font:800 10px/1.3 system-ui,sans-serif;letter-spacing:.03em;text-align:center;cursor:pointer;';
            badge.addEventListener('click', () => { if (currentMode !== 'safe') setSafetyMode('safe'); });
            document.body.appendChild(badge);
        }
        const thick = currentMode === 'safe' ? 3 : (currentMode === 'medium' ? 5 : 7);
        frame.style.boxShadow = `inset 0 0 0 ${thick}px rgba(${c.rgb},0.95)` + (currentMode === 'extreme' ? ', inset 0 0 40px rgba(244,63,94,0.35)' : '');
        frame.style.animation = currentMode === 'extreme' ? 'salimModePulse 1s ease-in-out infinite' : 'none';
        badge.textContent = c.label;
        badge.style.background = `rgba(${c.rgb},${currentMode === 'safe' ? 0.9 : 1})`;
        badge.style.color = currentMode === 'extreme' ? '#fff' : '#052e1c';
        if (currentMode === 'medium') badge.style.color = '#2b1700';
        badge.style.animation = currentMode === 'extreme' ? 'salimModePulse 1s ease-in-out infinite' : 'none';
    }

    function setSafetyMode(key, silent) {
        if (!SAFETY_MODES[key]) return;
        currentMode = key;
        try { root.localStorage.setItem('salim_safety_mode', key); } catch (e) { /* ничего */ }
        applyModeToCfg();
        renderSafetyModeUI();
        if (typeof invalidateSlicedGcode === 'function') invalidateSlicedGcode();
        if (!silent && typeof showToast === 'function') showToast('Режим: ' + SAFETY_MODES[key].label);
    }

    /* ---------- ротация места продувки ---------- */
    function nextPurgeSlot() {
        let idx = 0;
        try {
            idx = (parseInt(root.localStorage.getItem('salim_purge_idx') || '-1', 10) + 1) % CFG.purgeSlots;
            if (!isFinite(idx) || idx < 0) idx = 0;
            root.localStorage.setItem('salim_purge_idx', String(idx));
        } catch (e) { idx = 0; }
        return idx;
    }

    function choosePurge(b, slot) {
        const m = CFG.purgeClearance;
        const off = 3 + slot * 2;
        const hasBox = b && isFinite(b.minX) && isFinite(b.maxX) && isFinite(b.minY) && isFinite(b.maxY);
        if (!hasBox) return { type: 'none' };
        // Вариант A: линия вдоль Y у левого края
        const aOk = (b.minX > off + 0.4 + m) || (b.minY > 20 + CFG.purgeLen + m) || (b.maxY < 20 - m);
        if (aOk) return { type: 'y', pos: off };
        // Вариант B: линия вдоль X у переднего края
        const bOk = (b.minY > off + 0.4 + m) || (b.minX > 20 + CFG.purgeLen + m) || (b.maxX < 20 - m);
        if (bOk) return { type: 'x', pos: off };
        return { type: 'none' };
    }

    function buildStart(bed, nozzle, purge) {
        const L = [];
        const pre = Math.min(CFG.nozzlePreheat, nozzle);
        L.push('; ==== Старт (Marlin, Ender 3 V3 SE) ====');
        L.push('M220 S100 ; сброс скорости');
        L.push('M221 S100 ; сброс потока');
        L.push('M204 P500 T500 ; мягкие ускорения на время парковки и выравнивания');
        L.push(`M140 S${bed} ; стол`);
        L.push(`M104 S${pre} ; сопло пока холодное (без подтекания)`);
        L.push('G28 ; парковка по всем осям');
        if (CFG.levelingMode === 'g29') L.push('G29 ; выравнивание стола (CR Touch)');
        else if (CFG.levelingMode === 'm420') L.push('M420 S1 ; загрузить сохранённую сетку');
        L.push(`M190 S${bed} ; ждём стол`);
        L.push(`M109 S${nozzle} ; ждём сопло`);
        if (CFG.linearAdvanceK > 0) L.push(`M900 K${Number(CFG.linearAdvanceK).toFixed(3)} ; Linear Advance`);
        L.push('G92 E0');
        if (purge.type === 'none') {
            L.push('; Продувка пропущена: рядом с краем стола стоит модель');
            L.push('G1 Z2.0 F600');
        } else {
            const p = purge.pos, q = Number((p + 0.4).toFixed(2));
            const a = 20, b = 20 + CFG.purgeLen;
            L.push(`; Продувка (ячейка ${purge.type === 'y' ? 'вдоль Y' : 'вдоль X'}, смещение ${p} мм; ротация защищает PEI)`);
            L.push('G1 Z2.0 F600');
            if (purge.type === 'y') {
                L.push(`G1 X${p} Y${a} F4800`);
                L.push('G1 Z0.3 F600');
                L.push(`G1 X${p} Y${b} F1500 E${CFG.purgeE}`);
                L.push(`G1 X${q} Y${b} F1500`);
                L.push(`G1 X${q} Y${a} F1500 E${CFG.purgeE}`);
            } else {
                L.push(`G1 X${a} Y${p} F4800`);
                L.push('G1 Z0.3 F600');
                L.push(`G1 X${b} Y${p} F1500 E${CFG.purgeE}`);
                L.push(`G1 X${b} Y${q} F1500`);
                L.push(`G1 X${a} Y${q} F1500 E${CFG.purgeE}`);
            }
            L.push('G1 Z2.0 F600');
            L.push('G92 E0');
        }
        return L;
    }

    function buildEnd(maxZ, nozzleOff) {
        const dz = Math.max(0, Math.min(10, (CFG.bed.z - 2) - maxZ));
        const L = [];
        L.push('; ==== Завершение (Marlin, Ender 3 V3 SE) ====');
        L.push('M220 S100 ; скорость 100%');
        L.push('M400 ; дождаться конца движений');
        L.push('M104 S0 ; сопло выкл');
        L.push('M140 S0 ; стол выкл');
        L.push('M204 P500 T500');
        L.push('G91');
        L.push('G1 E-2 F1500 ; небольшой ретракт');
        if (dz > 0) L.push(`G1 Z${dz.toFixed(1)} F600 ; подъём (не выше предела оси Z)`);
        L.push('G90');
        L.push('G1 X5 Y215 F3000 ; парковка');
        if (nozzleOff > 0) {
            L.push('M106 S255 ; обдув на максимум, чтобы остыть');
            L.push(`M109 R${nozzleOff} ; ждём остывания сопла до ${nozzleOff}°C`);
            L.push('M104 S0');
        }
        L.push('M106 S0');
        L.push('M84 ; моторы выкл');
        return L;
    }

    /* ---------- основной проход: замена, оценка времени, аудит ---------- */
    function processGcode(text, ctx) {
        ctx = ctx || {};
        const report = { ok: true, errors: [], warnings: [], info: {} };
        FIL_AREA = Math.PI * Math.pow((((typeof state !== 'undefined' && state.expert && state.expert.filamentDiameter) || 1.75)) / 2, 2);
        const addErr = (m) => { if (report.errors.length < 8) report.errors.push(m); };
        const warnCount = {};
        const addWarn = (key, m) => { warnCount[key] = (warnCount[key] || 0) + 1; if (warnCount[key] === 1) report.warnings.push(m); };

        const src = text.split('\n');

// --- маркеры блоков ---
        const iStart = src.findIndex(l => l.startsWith('; ==== Стандартные процедуры'));
        const iM73 = src.findIndex(l => l.startsWith('M73 P0'));
        const iEnd = src.findIndex(l => l.startsWith('; ==== Завершение печати'));
        let iM84 = -1;
        if (iEnd >= 0) iM84 = src.findIndex((l, i) => i > iEnd && l.startsWith('M84'));
        const blocksFound = iStart >= 0 && iM73 > iStart && iEnd > iM73 && iM84 > iEnd;

        // --- параметры из исходника (сканируем весь заголовок вплоть до процедур печати) ---
        let bedT = ctx.bedTemp || 60, nozT = ctx.nozzleTemp || 210, maxZ = ctx.maxZ || 0;
        let bedSet = Boolean(ctx.bedTemp), nozSet = Boolean(ctx.nozzleTemp);
        const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
        const scanLimit = iStart >= 0 ? (iStart + 30) : Math.min(src.length, 1200);

        for (let i = 0; i < scanLimit; i++) {
            const s = src[i];
            let m;
            if (!bedSet && (m = /^M140 S(\d+)/.exec(s))) { bedT = +m[1]; bedSet = true; }
            else if (!nozSet && (m = /^M104 S(\d+)/.exec(s))) { nozT = +m[1]; nozSet = true; }
            else if (!maxZ && (m = /^; MAXZ = ([\d.]+)/.exec(s))) maxZ = +m[1];
            else if ((m = /^; MINX = ([\d.\-]+)/.exec(s))) box.minX = +m[1];
            else if ((m = /^; MAXX = ([\d.\-]+)/.exec(s))) box.maxX = +m[1];
            else if ((m = /^; MINY = ([\d.\-]+)/.exec(s))) box.minY = +m[1];
            else if ((m = /^; MAXY = ([\d.\-]+)/.exec(s))) box.maxY = +m[1];
        }

        let out;
        if (blocksFound) {
            const purge = ctx.purge || choosePurge(box, ctx.purgeSlot !== undefined ? ctx.purgeSlot : 0);
            report.info.purge = purge.type;
            out = src.slice(0, iStart)
                .concat(buildStart(bedT, nozT, purge))
                .concat(src.slice(iM73, iEnd))
                .concat(buildEnd(maxZ, CFG.cooldownNozzleTo))
                .concat(src.slice(iM84 + 1));
        } else {
            out = src.slice();
            addWarn('blocks', 'Не найдены блоки старта/финиша исходного G-code, замена не выполнена');
        }

        // --- построчная конвертация Klipper -> Marlin ---
        const conv = [];
        let removedKlipper = 0;
        for (let i = 0; i < out.length; i++) {
            const l = out[i];
            if (l.length > 10 && (l.charCodeAt(0) === 83 || l.charCodeAt(0) === 69)) { // 'S' или 'E'
                let m;
                if ((m = /^SET_VELOCITY_LIMIT\s+ACCEL=(\d+)/.exec(l))) {
                    const a = Math.round(+m[1]);
                    conv.push(`M204 P${a} T${a}`);
                    continue;
                }
                if (l.startsWith('SET_PRESSURE_ADVANCE') || l.startsWith('EXCLUDE_OBJECT')) { removedKlipper++; continue; }
            }
            conv.push(l);
        }
        out = conv;
        report.info.removedKlipper = removedKlipper;

        // --- проход: аудит + симуляция времени ---
        const cap = (ctx.hotendType === 'ceramic') ? CFG.maxNozzleCeramic : CFG.maxNozzle;
        const maxFlow = ctx.maxFlow || 0;
        const RE = /([XYZEFS])\s*(-?\d*\.?\d+)/gi;
        let x = 0, y = 0, z = 0, f = 1800, rel = false, eRel = false, homed = false, nozzleReady = false;
        let accP = 1000, accT = 1000, tPrint = 0, tOver = 0;
        let cmds = 0, worstFlow = 0, firstE = false;
        const m73idx = [], m73t = [];
        const layerIdx = [], layerT = [];
        const vjBase = CFG.junctionSpeed;

        const segTime = (d, vCmd, a) => {
            if (d < 1e-6) return 0;
            const v = Math.max(1, vCmd);
            const vj = Math.min(v, vjBase);
            const da = (v * v - vj * vj) / (2 * a);
            if (2 * da >= d) { const vp = Math.sqrt(vj * vj + a * d); return 2 * (vp - vj) / a + 0.0; }
            return 2 * (v - vj) / a + (d - 2 * da) / v;
        };

        for (let i = 0; i < out.length; i++) {
            const line = out[i];
            if (line.charCodeAt(0) === 59 && line.startsWith(';LAYER_CHANGE')) { layerIdx.push(i); layerT.push(tPrint); continue; }
            const sc = line.indexOf(';');
            const code = (sc >= 0 ? line.slice(0, sc) : line).trim();
            if (!code) continue;
            cmds++;
            if (code.indexOf('NaN') >= 0 || code.indexOf('Infinity') >= 0 || code.indexOf('undefined') >= 0) {
                addErr(`Некорректное число в строке ${i + 1}: ${code.slice(0, 60)}`);
                continue;
            }
            const sp = code.indexOf(' ');
            const cmd = (sp < 0 ? code : code.slice(0, sp)).toUpperCase();

            if (cmd === 'G1' || cmd === 'G0') {
                let nx = x, ny = y, nz = z, de = 0, hasE = false, hasXY = false, hasZ = false;
                RE.lastIndex = 0;
                let m;
                while ((m = RE.exec(code)) !== null) {
                    const k = m[1].toUpperCase(), v = parseFloat(m[2]);
                    if (k === 'X') { nx = rel ? x + v : v; hasXY = true; }
                    else if (k === 'Y') { ny = rel ? y + v : v; hasXY = true; }
                    else if (k === 'Z') { nz = rel ? z + v : v; hasZ = true; }
                    else if (k === 'E') { de = eRel ? v : v - (root.__salimE || 0); hasE = true; root.__salimE = eRel ? 0 : v; }
                    else if (k === 'F') { f = v; }
                }
                if (f > CFG.maxFeed) addWarn('feed', `Подача выше ${CFG.maxFeed} мм/мин (строка ${i + 1})`);
                if (hasZ && !hasXY && f > CFG.maxZFeed) addWarn('zfeed', `Быстрое движение по Z, подача ${f} (строка ${i + 1})`);
                if (homed) {
                    if (nx < -0.01 || nx > CFG.bed.x + 0.01 || ny < -0.01 || ny > CFG.bed.y + 0.01)
                        addErr(`Выход за стол X=${nx.toFixed(2)} Y=${ny.toFixed(2)} (строка ${i + 1})`);
                    if (nz > CFG.bed.z + 0.01) addErr(`Z выше предела оси ${nz.toFixed(2)} (строка ${i + 1})`);
                    if (nz < -0.001) addErr(`Z ниже стола ${nz.toFixed(2)} (строка ${i + 1})`);
                }
                if (hasE && de > 0 && !nozzleReady) addErr(`Экструзия до нагрева сопла (строка ${i + 1})`);
                if (hasE && de > 0 && de > 20) addWarn('bige', `Подозрительно большая подача пластика ${de.toFixed(1)} мм за один ход (строка ${i + 1})`);

                const dx = nx - x, dy = ny - y, dz = nz - z;
                const dxy = Math.hypot(dx, dy);
                const v = f / 60;
                let t = 0;
                if (dxy > 0) {
                    const a = (hasE && de > 0) ? accP : accT;
                    t = segTime(Math.hypot(dxy, dz), v, a);
                    if (hasE && de > 0 && maxFlow > 0 && dxy > 0.1) {
                        const flow = de * FIL_AREA * v / dxy;
                        if (flow > worstFlow) worstFlow = flow;
                        if (flow > maxFlow * CFG.flowTolerance) addWarn('flow', `Поток выше лимита профиля (${maxFlow} мм³/с), строка ${i + 1}`);
                    }
                } else if (hasZ && dz !== 0) {
                    t = segTime(Math.abs(dz), Math.min(v, CFG.zMoveSpeed), 100);
                } else if (hasE && de !== 0) {
                    t = Math.abs(de) / Math.max(1, v) + 0.01;
                }
                tPrint += t;
                x = nx; y = ny; z = nz;
            } else if (cmd === 'G28') {
                homed = true; x = 0; y = 0; z = 0; tOver += 25;
            } else if (cmd === 'G29') {
                tOver += 100;
            } else if (cmd === 'G90') { rel = false; }
            else if (cmd === 'G91') { rel = true; }
            else if (cmd === 'M82') { eRel = false; }
            else if (cmd === 'M83') { eRel = true; }
            else if (cmd === 'G92') {
                if (/\bE/i.test(code)) root.__salimE = 0;
            } else if (cmd === 'M104' || cmd === 'M109') {
                const m = /S(-?\d+\.?\d*)/i.exec(code);
                if (m) {
                    const s = parseFloat(m[1]);
                    if (s > cap) addErr(`Температура сопла ${s}°C выше лимита ${cap}°C (строка ${i + 1})`);
                    if (cmd === 'M109') { nozzleReady = s >= 170; tOver += Math.max(0, s - 150) * 2; }
                }
                if (cmd === 'M109' && /\bR/i.test(code)) tOver += 100;
            } else if (cmd === 'M140' || cmd === 'M190') {
                const m = /S(-?\d+\.?\d*)/i.exec(code);
                if (m) {
                    const s = parseFloat(m[1]);
                    if (s > CFG.maxBed) addErr(`Температура стола ${s}°C выше лимита ${CFG.maxBed}°C (строка ${i + 1})`);
                    if (cmd === 'M190') tOver += Math.max(0, s - 25) * CFG.bedHeatSecPerDeg;
                }
            } else if (cmd === 'M204') {
                let m;
                if ((m = /P(\d+\.?\d*)/i.exec(code))) accP = Math.max(50, parseFloat(m[1]));
                if ((m = /T(\d+\.?\d*)/i.exec(code))) accT = Math.max(50, parseFloat(m[1]));
                if (accP > CFG.maxAccel || accT > CFG.maxAccel) addWarn('accel', `Ускорение выше ${CFG.maxAccel} мм/с² (строка ${i + 1})`);
            } else if (cmd === 'M73') {
                if (/P(\d+)/i.test(code)) { m73idx.push(i); m73t.push(tPrint); }
            } else if (cmd === 'G4') {
                const m = /P(\d+)/i.exec(code);
                if (m) tPrint += (+m[1]) / 1000;
            }
        }
        root.__salimE = 0;

        // --- минимальное время слоя: замедление через M220 ---
        const cal = CFG.timeCalibration;
        const minT = ctx.minLayerTime || 0;
        const extra = new Array(layerIdx.length).fill(0);
        const slowPct = new Array(layerIdx.length).fill(100);
        let slowed = 0;
        if (minT > 0) {
            for (let k = 1; k < layerIdx.length; k++) {
                const dt = ((k + 1 < layerIdx.length ? layerT[k + 1] : tPrint) - layerT[k]) * cal;
                if (dt > 0.2 && dt < minT) {
                    const pct = Math.max(CFG.minLayerSpeedPct, Math.floor(100 * dt / minT));
                    slowPct[k] = pct;
                    extra[k] = dt * 100 / pct - dt;
                    slowed++;
                }
            }
        }
        const extraTotal = extra.reduce((a, b) => a + b, 0);
        const printSec = tPrint * cal + extraTotal;
        let kp = 0, extraUpTo = 0;
        for (let k = 0; k < m73idx.length; k++) {
            while (kp < layerIdx.length && layerIdx[kp] < m73idx[k]) { extraUpTo += extra[kp]; kp++; }
            const mm = /P(\d+)/i.exec(out[m73idx[k]]);
            const remain = Math.max(0, Math.round(((tPrint - m73t[k]) * cal + (extraTotal - extraUpTo)) / 60));
            out[m73idx[k]] = `M73 P${mm ? mm[1] : 0} R${remain}`;
        }
        if (slowed > 0) {
            const ins = new Map();
            let cur = 100;
            for (let k = 0; k < layerIdx.length; k++) {
                if (slowPct[k] !== cur) { ins.set(layerIdx[k], `M220 S${slowPct[k]} ; мин. время слоя`); cur = slowPct[k]; }
            }
            const withM220 = [];
            for (let i = 0; i < out.length; i++) {
                withM220.push(out[i]);
                if (ins.has(i)) withM220.push(ins.get(i));
            }
            out = withM220;
        }
        report.info.slowedLayers = slowed;

        if (CFG.linearAdvanceK === 0 && ctx.paRequested) {
            report.info.laNote = 'Linear Advance не записан (linearAdvanceK = 0)';
        }
        report.ok = report.errors.length === 0;
        report.info.commands = cmds;
        report.info.printSec = printSec;
        report.info.totalSec = printSec + tOver;
        report.info.worstFlow = worstFlow;
        return { text: out.join('\n'), lines: out, report };
    }

    /* ---------- тестовые башни: температура и ретракт меняются по высоте ---------- */
    function applyTestPlan(text, plan, scale) {
        const steps = plan.steps.map(s => Object.assign({}, s, { z0: s.z0 * scale }));
        const hasTemp = steps.some(s => s.temp !== undefined);
        const hasRet = steps.some(s => s.retract !== undefined);
        const zoneOf = (z) => { let k = 0; for (let i = 0; i < steps.length; i++) if (steps[i].z0 <= z) k = i; return k; };
        const src = text.split('\n');
        const out = [];
        let zone = -1, nozzleDone = false, waitDone = false, printEnded = false;
        let useLen = hasRet ? steps[0].retract : null, lastRet = null, pending = null;
        const retRe = /^G1 E(-?)(\d+(?:\.\d+)?) F(\d+)$/;

        for (let i = 0; i < src.length; i++) {
            let line = src[i];

            // Стартовый нагрев сразу на температуру нижнего этажа
            if (zone === -1 && hasTemp && steps[0].temp !== undefined) {
                if (!nozzleDone && /^M104 S\d+ ; Установка температуры сопла/.test(line)) {
                    line = `M104 S${steps[0].temp} ; Установка температуры сопла (тест)`; nozzleDone = true;
                } else if (!waitDone && /^M109 S\d+ ; Ожидание нагрева сопла/.test(line)) {
                    line = `M109 S${steps[0].temp} ; Ожидание нагрева сопла (тест)`; waitDone = true;
                }
            }

            if (line.startsWith('M73 P100')) printEnded = true;

            // Ретракт: откат и возврат всегда равны друг другу, новая длина вступает после ближайшего возврата
            if (hasRet && !printEnded) {
                const m = retRe.exec(line);
                if (m) {
                    if (m[1] === '-') {
                        lastRet = useLen;
                        line = `G1 E-${useLen.toFixed(2)} F${m[3]}`;
                    } else {
                        if (lastRet === null) lastRet = useLen;
                        line = `G1 E${lastRet.toFixed(2)} F${m[3]}`;
                        if (pending !== null) { useLen = pending; pending = null; }
                    }
                }
            }

            out.push(line);

            if (line.startsWith(';Z:')) {
                const z = parseFloat(line.slice(3));
                if (isFinite(z)) {
                    const k = zoneOf(z - 0.1);
                    if (k !== zone) {
                        zone = k;
                        const st = steps[k];
                        const info = [];
                        if (st.temp !== undefined) info.push(`сопло ${st.temp}°C`);
                        if (st.retract !== undefined) info.push(`ретракт ${st.retract} мм`);
                        out.push(`; ==== ТЕСТ: этаж ${k + 1}, от Z=${st.z0.toFixed(1)} мм: ${info.join(', ')} ====`);
                        if (k > 0 && st.temp !== undefined) out.push(`M104 S${st.temp}`);
                        if (k > 0 && hasRet && st.retract !== undefined) pending = st.retract;
                    }
                }
            }
        }
        return out.join('\n');
    }

/* ---------- проверки модели до/после нарезки ---------- */
    function modelWarnings() {
        const w = [];
        try {
            if (typeof bedModels === 'undefined' || typeof PRINTER_SPECS === 'undefined') return w;
            const cx = PRINTER_SPECS.bedX / 2, cy = PRINTER_SPECS.bedY / 2;
            bedModels.forEach((m, n) => {
                const geo = m.geometry;
                geo.computeBoundingBox();
                const b = geo.boundingBox, s = m.scale.x;
                const wid = (b.max.x - b.min.x) * s, dep = (b.max.z - b.min.z) * s, hei = (b.max.y - b.min.y) * s;
                const tag = bedModels.length > 1 ? ` (модель ${n + 1})` : '';
                const minSide = Math.min(wid, dep);

                // 1. Риск раскачки подвижного стола Y
                if (minSide > 0.1 && hei / minSide > CFG.warnAspectRatio) {
                    w.push(`Высокая и узкая модель${tag}: высота в ${(hei / minSide).toFixed(1)} раз больше основания. Риск отрыва от инерции стола Y — включите кайму (Brim)`);
                }

                // 2. Близость к границам стола
                const minX = b.min.x * s + m.position.x + cx, maxX = b.max.x * s + m.position.x + cx;
                const minY = cy - (b.max.z * s + m.position.z), maxY = cy - (b.min.z * s + m.position.z);
                if (minX < CFG.edgeMargin || minY < CFG.edgeMargin || maxX > PRINTER_SPECS.bedX - CFG.edgeMargin || maxY > PRINTER_SPECS.bedY - CFG.edgeMargin) {
                    w.push(`Модель${tag} ближе ${CFG.edgeMargin} мм к краю стола. Риск задеть винты крепления PEI`);
                }
                if (hei > CFG.bed.z - 5) {
                    w.push(`Модель${tag} почти упирается в верхний предел оси Z (${CFG.bed.z} мм)`);
                }

                // 3. Проверка площади опоры первого слоя (касание стола Y=0)
                const pos = geo.attributes.position;
                if (pos) {
                    let baseTriCount = 0;
                    let baseArea = 0;
                    const count = pos.count;
                    const minYLocal = b.min.y;
                    const tol = 0.25; // допуск 0.25 мм от основания стола

                    for (let i = 0; i < count; i += 3) {
                        const y0 = pos.getY(i), y1 = pos.getY(i + 1), y2 = pos.getY(i + 2);
                        if (Math.abs(y0 - minYLocal) < tol && Math.abs(y1 - minYLocal) < tol && Math.abs(y2 - minYLocal) < tol) {
                            baseTriCount++;
                            const ax = (pos.getX(i + 1) - pos.getX(i)) * s;
                            const az = (pos.getZ(i + 1) - pos.getZ(i)) * s;
                            const bx = (pos.getX(i + 2) - pos.getX(i)) * s;
                            const bz = (pos.getZ(i + 2) - pos.getZ(i)) * s;
                            baseArea += Math.abs(ax * bz - az * bx) * 0.5;
                        }
                    }

                    if (baseArea < 20.0 && (!root.state || !root.state.brim)) {
                        w.push(`Критически малая площадь контакта со столом${tag} (~${Math.round(baseArea)} мм²). Деталь может сорвать при печати — обязательно включите кайму (Brim)!`);
                    }
                }
            });
        } catch (e) { /* проверки моделей не должны ломать нарезку */ }
        return w;
    }

    /* ---------- интеграция в программу ---------- */
    function installWrappers() {
        if (typeof root.generateKlipperGcode === 'function' && !root.generateKlipperGcode.__salimMarlin) {
            const orig = root.generateKlipperGcode;
            const wrapped = async function (layers, profile, maybeYield, isHeavy) {
                const res = await orig.apply(this, arguments);
                if (maybeYield) { try { await maybeYield(95, 'Проверка безопасности...', 'Marlin + аудит G-code', '', isHeavy); } catch (e) { if (e && e.message === 'SLICE_CANCELLED') throw e; } }
                const st = (typeof state !== 'undefined') ? state : {};
                const exp = st.expert || {};
                const ctx = {
                    hotendType: exp.hotendType,
                    maxFlow: profile && profile.maxFlow,
                    purgeSlot: nextPurgeSlot(),
                    paRequested: true,
                    minLayerTime: (SAFETY_MODES[currentMode].minLayer && (typeof SalimFeatures === 'undefined' || SalimFeatures.F.minLayerTime)) ? ((exp.minLayerTimeSec > 0 ? exp.minLayerTimeSec : (CFG.minLayerTimeSec || {})[st.material]) || 0) : 0
                };
                applyModeToCfg();
                let srcText = res.gcode;
                try {
                    const tm = (typeof bedModels !== 'undefined' && bedModels.length === 1) ? bedModels[0] : null;
                    const plan = tm && tm.userData && tm.userData.testPlan;
                    if (plan) {
                        tm.geometry.computeBoundingBox();
                        const hh = tm.geometry.boundingBox.max.y - tm.geometry.boundingBox.min.y;
                        // Если модель повернули или изменили, план не применяем
                        if (Math.abs(hh - plan.h) < 0.3) srcText = applyTestPlan(srcText, plan, tm.scale.x);
                    }
                } catch (e) { /* без плана теста */ }
                const r = processGcode(srcText, ctx);
                r.report.warnings = modelWarnings().concat(r.report.warnings);
                if (typeof state !== 'undefined') state.safetyReport = r.report;
                if (!r.report.ok) throw new Error('Проверка безопасности не пройдена: ' + r.report.errors.join('; '));

                // чанки по 10000 строк
                const chunks = [];
                for (let i = 0; i < r.lines.length; i += 10000) chunks.push(r.lines.slice(i, i + 10000).join('\n') + '\n');
                res.gcode = chunks.join('');
                res.gcodeChunks = chunks;

                // время: подменяем и масштабируем разбивку по типам линий
                const stats = res.stats;
                if (stats) {
                    const keys = ['outer', 'inner', 'solid', 'sparse', 'extra', 'travel'];
                    const oldSum = keys.reduce((a, k) => a + ((stats[k] && stats[k].timeSec) || 0), 0);
                    if (oldSum > 0) { const sc = r.report.info.printSec / oldSum; keys.forEach(k => { if (stats[k]) stats[k].timeSec *= sc; }); }
                    stats.totalTimeSec = r.report.info.totalSec;
                    const dens = (profile && profile.density) || 1.24;
                    const purgeDelta = (45 - 2 * CFG.purgeE) * FIL_AREA / 1000 * dens * 1.15;
                    stats.totalGrams = Math.max(0.1, stats.totalGrams - purgeDelta);
                }
                res.estimatedTimeSec = r.report.info.totalSec;
                return res;
            };
            wrapped.__salimMarlin = true;
            root.generateKlipperGcode = wrapped;
        }

        if (typeof root.updateSliceSummaryUI === 'function' && !root.updateSliceSummaryUI.__salimSafety) {
            const origUI = root.updateSliceSummaryUI;
            const wUI = function () {
                const out = origUI.apply(this, arguments);
                try { renderSafetyBadge(); } catch (e) { console.warn(e); }
                return out;
            };
            wUI.__salimSafety = true;
            root.updateSliceSummaryUI = wUI;
        }
    }

    function renderSafetyBadge() {
        const bar = document.getElementById('slice-result-bar');
        if (!bar || typeof state === 'undefined' || !state.safetyReport) return;
        let el = document.getElementById('safety-report');
        if (!el) { el = document.createElement('div'); el.id = 'safety-report'; el.className = 'mt-2 text-xs rounded-lg px-3 py-2'; bar.appendChild(el); }
        const r = state.safetyReport;
        const esc = (typeof escapeHtml === 'function') ? escapeHtml : (s => String(s));
        if (r.warnings.length === 0) {
            el.style.background = 'rgba(16,185,129,0.12)'; el.style.color = '#6ee7b7';
            el.innerHTML = `Проверка безопасности пройдена (${r.info.commands} команд)` + (r.info.slowedLayers ? ` • замедлено слоёв: ${r.info.slowedLayers}` : '');
        } else {
            el.style.background = 'rgba(245,158,11,0.14)'; el.style.color = '#fcd34d';
            el.innerHTML = '<b>Предупреждения:</b><br>' + r.warnings.map(w => '• ' + esc(w)).join('<br>');
        }
    }

    root.SalimMarlin = { CFG, processGcode, choosePurge, buildStart, buildEnd, modelWarnings, installWrappers };
    root.getSafetyMode = getSafetyMode;
    root.setSafetyMode = setSafetyMode;
    root.SAFETY_MODES = SAFETY_MODES;
    if (typeof document !== 'undefined') { installWrappers(); applyModeToCfg(); renderSafetyModeUI(); }
})(typeof window !== 'undefined' ? window : globalThis);
