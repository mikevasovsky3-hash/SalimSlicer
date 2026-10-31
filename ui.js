/* ====================================================================
 * 5. UI & APP INIT (Интерфейс, Крутилки, Модальные окна и Запуск)
 * ==================================================================== */

function setCameraPreset(preset) { if (controls) controls.setPreset(preset); }
    function toggleInspectOnlyMode() {
        state.inspectOnlyMode = !state.inspectOnlyMode;
        const cp = document.getElementById('control-panel');
        const vp = document.getElementById('viewport-section');
        const lbl = document.getElementById('inspect-mode-label');
        if (cp) cp.classList.toggle('hidden', state.inspectOnlyMode);
        if (vp) {
            vp.classList.remove('h-[46vh]', 'sm:h-[52vh]', 'h-full', 'w-full', 'flex-1', 'lg:h-full', 'lg:flex-1', 'landscape:w-[55%]', 'landscape:h-full');
            if (state.inspectOnlyMode) vp.classList.add('h-full', 'w-full', 'flex-1');
            else vp.classList.add('h-[46vh]', 'sm:h-[52vh]', 'landscape:w-[55%]', 'landscape:h-full', 'lg:h-full', 'lg:flex-1');
        }
        if (lbl) lbl.textContent = state.inspectOnlyMode ? "Вернуть меню" : "Просмотр";
        document.getElementById('btn-floating-exit-inspect')?.classList.toggle('hidden', !state.inspectOnlyMode);
        setTimeout(resizeViewportCanvas, 80);
    }

    function switchTab(tabId) {
        state.activeTab = tabId;
        ['print', 'model', 'models', 'gcode'].forEach(t => {
            const content = document.getElementById(`tab-content-${t}`);
            const btn = document.getElementById(`tab-btn-${t}`);
            if (content) content.classList.toggle('hidden', t !== tabId);
            if (btn) btn.className = t === tabId
                ? "py-2 rounded-xl text-xs font-bold tab-active transition flex items-center justify-center gap-1.5"
                : "py-2 rounded-xl text-xs font-bold text-slate-400 hover:text-white transition flex items-center justify-center gap-1.5";
        });
        if (tabId === 'gcode') updateInlineGcodeViewer();
    }

    function selectMaterial(mat, silent = false) {
        if (!PROFILES[mat]) return;
        state.material = mat;
        Object.keys(PROFILES).forEach(m => {
            const btn = document.getElementById(`btn-mat-${m}`);
            if (btn && ['PLA', 'PETG', 'TPU'].includes(m)) btn.className = "mat-btn py-2.5 px-2 rounded-2xl border border-slate-700 bg-slate-900 flex flex-col items-center justify-center transition active:scale-95";
        });
        const activeBtn = document.getElementById(`btn-mat-${mat}`);
        if (activeBtn && ['PLA', 'PETG', 'TPU'].includes(mat)) activeBtn.classList.add(`mat-active-${mat}`);
        ['speed', 'balanced', 'quality', 'minweight'].forEach(m => {
            const prof = PROFILES[mat][m];
            const el = document.getElementById(`mode-desc-${m}`);
            if (el && prof) el.textContent = m === 'minweight' ? `${prof.layerHeight.toFixed(2)} • 2 ст. Эко` : `${prof.layerHeight.toFixed(2)} • ${prof.printSpeed} мм/с`;
        });
        invalidateSlicedGcode();
        syncProfileSummaryUI();
        if (!silent) showToast(`Пластик: ${mat}`);
    }

    function selectMode(mode) {
        state.mode = mode;
        ['speed', 'balanced', 'quality', 'minweight'].forEach(m => {
            const btn = document.getElementById(`btn-mode-${m}`);
            if (btn) btn.classList.remove('mode-active');
        });
        const activeBtn = document.getElementById(`btn-mode-${mode}`);
        if (activeBtn) activeBtn.classList.add('mode-active');
        invalidateSlicedGcode();
        syncProfileSummaryUI();
        showToast(`Режим: ${PROFILES[state.material][mode].label}`);
    }

    function updateDialVisualsUI() {
        const p = PROFILES[state.material][state.mode];
        const nVal = document.getElementById('dial-val-nozzle');
        const nRot = document.getElementById('dial-rotor-nozzle');
        const nTag = document.getElementById('dial-mat-tag-nozzle');
        if (nVal) nVal.textContent = `${p.nozzleTemp}°`;
        if (nRot) nRot.style.transform = `rotate(${(p.nozzleTemp * 6) % 360}deg)`;
        if (nTag) nTag.textContent = state.material;
        const bVal = document.getElementById('dial-val-bed');
        const bRot = document.getElementById('dial-rotor-bed');
        const bTag = document.getElementById('dial-mat-tag-bed');
        if (bVal) bVal.textContent = `${p.bedTemp}°`;
        if (bRot) bRot.style.transform = `rotate(${(p.bedTemp * 6) % 360}deg)`;
        if (bTag) bTag.textContent = `PEI`;
        ['PLA', 'PETG', 'TPU'].forEach(m => {
            const sub = document.getElementById(`mat-sub-${m}`);
            if (sub && PROFILES[m] && PROFILES[m][state.mode]) {
                const mp = PROFILES[m][state.mode];
                sub.textContent = `${mp.nozzleTemp}°C • Стол ${mp.bedTemp}°`;
            }
        });
        ['speed', 'balanced', 'quality', 'minweight'].forEach(m => {
            const prof = PROFILES[state.material][m];
            const el = document.getElementById(`mode-desc-${m}`);
            if (el && prof) el.textContent = m === 'minweight'
                ? `${prof.layerHeight.toFixed(2)} • ${prof.defaultInfill}% Эко`
                : `${prof.layerHeight.toFixed(2)} • ${prof.printSpeed} мм/с`;
        });
    }

    function setMaterialTemperature(target, newVal) {
        const matObj = PROFILES[state.material];
        if (!matObj) return;
        const cur = matObj[state.mode];
        if (!cur) return;
        if (target === 'nozzle') {
            const maxNozzle = (state.expert && state.expert.hotendType === 'ceramic') ? 300 : 260;
            cur.nozzleTemp = Math.max(170, Math.min(maxNozzle, Math.round(newVal)));
        } else {
            cur.bedTemp = Math.max(0, Math.min(105, Math.round(newVal)));
        }
        invalidateSlicedGcode();
        syncProfileSummaryUI();
    }

    function stepQuickTemp(target, delta) {
        const p = PROFILES[state.material][state.mode];
        const cur = target === 'nozzle' ? p.nozzleTemp : p.bedTemp;
        setMaterialTemperature(target, cur + delta);
    }

    function initRotaryTempDials() {
        const bindDial = (elId, target) => {
            const knob = document.getElementById(elId);
            if (!knob) return;
            let dragging = false, startY = 0, startX = 0, startTemp = 0;
            knob.addEventListener('pointerdown', (e) => {
                e.preventDefault(); knob.setPointerCapture(e.pointerId);
                dragging = true; startY = e.clientY; startX = e.clientX;
                const p = PROFILES[state.material][state.mode];
                startTemp = target === 'nozzle' ? p.nozzleTemp : p.bedTemp;
            });
            knob.addEventListener('pointermove', (e) => {
                if (!dragging) return;
                const dy = startY - e.clientY, dx = e.clientX - startX;
                const deltaDeg = Math.round((dy + dx * 0.5) / 3.5);
                setMaterialTemperature(target, startTemp + deltaDeg);
            });
            const finish = () => { if (!dragging) return; dragging = false; };
            knob.addEventListener('pointerup', finish);
            knob.addEventListener('pointercancel', finish);
            knob.addEventListener('wheel', (e) => { e.preventDefault(); stepQuickTemp(target, e.deltaY < 0 ? 1 : -1); }, { passive: false });
        };
        bindDial('rotary-knob-nozzle', 'nozzle');
        bindDial('rotary-knob-bed', 'bed');
    }

    function syncProfileSummaryUI(resetInfill = true) {
        const p = PROFILES[state.material][state.mode];
        if (resetInfill) state.infill = p.defaultInfill;
        const infSlider = document.getElementById('infill-slider');
        const infLbl = document.getElementById('infill-val-label');
        const sumEl = document.getElementById('active-preset-summary');
        if (infSlider) infSlider.value = state.infill;
        if (infLbl) infLbl.textContent = `${state.infill}%`;
        if (sumEl) sumEl.textContent = `${p.nozzleTemp}° / ${p.bedTemp}°C • ${p.printSpeed} мм/с • ${p.layerHeight.toFixed(2)}мм`;
        updateDialVisualsUI();
        updateModeHintBannerUI();
    }

    function updateModeHintBannerUI() {
        const banner = document.getElementById('mode-hint-banner');
        if (!banner) return;
        const p = (PROFILES[state.material] && PROFILES[state.material][state.mode]) ? PROFILES[state.material][state.mode] : null;
        if (!p) return;
        const exp = state.expert || {};
        const walls = exp.wallCount > 0 ? exp.wallCount : 2;
        const lineW = exp.lineWidth || 0.45;
        const effFlow = p.maxFlow || 15;
        const outerMMS = Math.round(p.printSpeed * 0.68);
        const innerMMS = Math.round(p.printSpeed * 0.88);
        let titleText = '', iconClass = '', badgeBg = '', borderClass = '', description = '', tagPills = [];
        if (state.mode === 'speed') {
            titleText = 'Критерий: Максимальная скорость';
            iconClass = 'fa-solid fa-bolt text-amber-400';
            badgeBg = 'bg-amber-500/15 text-amber-300 border-amber-500/30';
            borderClass = 'border-amber-500/30';
            description = `До ${p.printSpeed} мм/с, поток ограничен ${effFlow} мм³/с. Обдув ${p.fanSpeed}% со 2-го слоя.`;
            tagPills = [ { icon: 'fa-gauge-high', label: `Стенки: ${outerMMS}/${innerMMS} мм/с` }, { icon: 'fa-faucet-drip', label: `Поток: ${effFlow} мм³/с` }, { icon: 'fa-layer-group', label: `Слой: ${p.layerHeight.toFixed(2)}мм` }, { icon: 'fa-wind', label: `Обдув: ${p.fanSpeed}%` } ];
        } else if (state.mode === 'balanced') {
            titleText = 'Критерий: Золотой баланс';
            iconClass = 'fa-solid fa-scale-balanced text-emerald-400';
            badgeBg = 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
            borderClass = 'border-emerald-500/30';
            description = `Оптимум ${p.printSpeed} мм/с, внешние стенки ${outerMMS} мм/с. Обдув нарастает на 2–3 слоях.`;
            tagPills = [ { icon: 'fa-gauge', label: `Стенки: ${outerMMS}/${innerMMS} мм/с` }, { icon: 'fa-faucet-drip', label: `Поток: ${effFlow} мм³/с` }, { icon: 'fa-layer-group', label: `Слой: ${p.layerHeight.toFixed(2)}мм` }, { icon: 'fa-arrow-rotate-left', label: `Ретракт: ${p.retractDist} мм` } ];
        } else if (state.mode === 'quality') {
            titleText = 'Критерий: Максимальное качество';
            iconClass = 'fa-solid fa-gem text-cyan-400';
            badgeBg = 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
            borderClass = 'border-cyan-500/30';
            description = `Слой ${p.layerHeight.toFixed(2)}мм, внешние стенки ${outerMMS} мм/с, ускорение внешних стенок 1500 мм/с², первый слой 800.`;
            tagPills = [ { icon: 'fa-wand-magic-sparkles', label: `Внеш.: ${outerMMS} мм/с` }, { icon: 'fa-ruler-combined', label: `Линия внеш.: ${(lineW * 0.93).toFixed(2)}мм` }, { icon: 'fa-layer-group', label: `Слой: ${p.layerHeight.toFixed(2)}мм` }, { icon: 'fa-wind', label: `Обдув до ${p.fanSpeed}%` } ];
        } else if (state.mode === 'minweight') {
            titleText = 'Критерий: Минимальный вес';
            iconClass = 'fa-solid fa-feather-pointed text-pink-400';
            badgeBg = 'bg-pink-500/15 text-pink-300 border-pink-500/30';
            borderClass = 'border-pink-500/30';
            description = `${walls} стенки, заполнение ${state.infill}% (линии), скорость ${p.printSpeed} мм/с.`;
            tagPills = [ { icon: 'fa-clone', label: `Стенки: ${walls} шт` }, { icon: 'fa-hashtag', label: `Заполнение: ${state.infill}%` }, { icon: 'fa-gauge-simple', label: `Скорость: ${p.printSpeed} мм/с` }, { icon: 'fa-layer-group', label: `Слой: ${p.layerHeight.toFixed(2)}мм` } ];
        }
        const pillsHtml = tagPills.map(pt => `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-950/80 border border-slate-800 text-[9px] font-mono-code font-bold text-slate-300"><i class="fa-solid ${pt.icon} text-[8px] text-cyan-400"></i> ${pt.label}</span>`).join('');
        banner.className = `mt-2 p-2.5 rounded-2xl bg-gradient-to-r from-slate-900 via-slate-900/95 to-slate-900 border-2 ${borderClass} space-y-1.5 shadow-lg transition-all duration-300`;
        banner.innerHTML = `
            <div class="flex items-center justify-between gap-2">
                <div class="flex items-center gap-1.5 truncate"><i class="${iconClass} text-xs"></i><span class="text-[11px] font-black tracking-tight text-white truncate">${titleText}</span></div>
                <span class="px-2 py-0.5 rounded-full text-[9px] font-bold border ${badgeBg} whitespace-nowrap shrink-0">${state.material}</span>
            </div>
            <p class="text-[10px] text-slate-300 leading-relaxed font-sans">${description}</p>
            <div class="flex flex-wrap gap-1.5 pt-0.5">${pillsHtml}</div>`;
    }

    function onInfillChange(val) {
        state.infill = parseInt(val);
        const infLbl = document.getElementById('infill-val-label');
        if (infLbl) infLbl.textContent = `${state.infill}%`;
        invalidateSlicedGcode();
    }

    function onBrimLoopsChange(val) {
        state.brimLoops = Math.max(1, Math.min(30, parseInt(val) || 6));
        const lbl = document.getElementById('brim-loops-val');
        if (lbl) { const mm = (state.brimLoops * (state.expert.lineWidth || 0.45) * 0.95).toFixed(1); lbl.textContent = `${state.brimLoops} шт (${mm}мм)`; }
        invalidateSlicedGcode();
    }
    function onBrimTypeChange(val) { state.brimType = val; invalidateSlicedGcode(); }
    function onSupportTypeChange(val) { state.supportType = val; invalidateSlicedGcode(); }
    function onSupportAngleChange(val) {
        state.supportOverhangAngle = parseInt(val) || 52;
        const lbl = document.getElementById('support-angle-val');
        if (lbl) lbl.textContent = `>${state.supportOverhangAngle}°`;
        invalidateSlicedGcode();
    }

    function renderSupportsUI() {
        const btn = document.getElementById('btn-toggle-supports');
        const icon = document.getElementById('icon-supports');
        const txt = document.getElementById('state-supports');
        const panel = document.getElementById('support-controls-panel');
        if (state.supports) {
            if (btn) btn.className = "col-span-3 py-2 px-1.5 rounded-2xl border border-purple-500/40 bg-purple-500/15 flex flex-col items-center justify-center gap-1 transition active:scale-95";
            if (icon) icon.className = "fa-solid fa-trowel-bricks text-xs text-purple-400";
            if (txt) { txt.textContent = "ВКЛ"; txt.className = "text-[9px] font-bold text-purple-300"; }
            if (panel) panel.classList.remove('opacity-40', 'pointer-events-none');
        } else {
            if (btn) btn.className = "col-span-3 py-2 px-1.5 rounded-2xl border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1 transition active:scale-95";
            if (icon) icon.className = "fa-solid fa-trowel-bricks text-xs text-slate-400";
            if (txt) { txt.textContent = "ВЫКЛ"; txt.className = "text-[9px] font-bold text-slate-500"; }
            if (panel) panel.classList.add('opacity-40', 'pointer-events-none');
        }
    }

    function toggleSupports() {
        state.supports = !state.supports;
        renderSupportsUI();
        invalidateSlicedGcode();
    }

    function renderBrimUI() {
        const btn = document.getElementById('btn-toggle-brim');
        const icon = document.getElementById('icon-brim');
        const txt = document.getElementById('state-brim');
        const panel = document.getElementById('brim-controls-panel');
        if (state.brim) {
            if (btn) btn.className = "col-span-3 py-2 px-1.5 rounded-2xl border border-cyan-500/40 bg-cyan-500/10 flex flex-col items-center justify-center gap-1 transition active:scale-95";
            if (icon) icon.className = "fa-regular fa-circle-dot text-xs text-cyan-400";
            if (txt) { txt.textContent = "ВКЛ"; txt.className = "text-[9px] font-bold text-cyan-300"; }
            if (panel) panel.classList.remove('opacity-40', 'pointer-events-none');
        } else {
            if (btn) btn.className = "col-span-3 py-2 px-1.5 rounded-2xl border border-slate-800 bg-slate-900 flex flex-col items-center justify-center gap-1 transition active:scale-95";
            if (icon) icon.className = "fa-regular fa-circle-dot text-xs text-slate-400";
            if (txt) { txt.textContent = "ВЫКЛ"; txt.className = "text-[9px] font-bold text-slate-500"; }
            if (panel) panel.classList.add('opacity-40', 'pointer-events-none');
        }
    }

    function toggleBrim() {
        state.brim = !state.brim;
        if (state.brim) state.brimLoops = state.brimLoops || 6;
        renderBrimUI();
        invalidateSlicedGcode();
        updateDimensionsUI();
    }

    // Полная синхронизация панели с состоянием (после загрузки проекта, Undo, автосейва)
    function syncAllControlsUI() {
        ['PLA', 'PETG', 'TPU'].forEach(m => {
            const btn = document.getElementById(`btn-mat-${m}`);
            if (!btn) return;
            btn.className = "mat-btn py-2.5 px-2 rounded-2xl border border-slate-700 bg-slate-900 flex flex-col items-center justify-center transition active:scale-95";
            if (m === state.material) btn.classList.add(`mat-active-${m}`);
        });
        ['speed', 'balanced', 'quality', 'minweight'].forEach(m => {
            document.getElementById(`btn-mode-${m}`)?.classList.toggle('mode-active', m === state.mode);
        });
        syncProfileSummaryUI(false);
        renderSupportsUI();
        renderBrimUI();

        const loops = state.brimLoops || 6;
        const loopsSlider = document.getElementById('brim-loops-slider');
        const loopsLbl = document.getElementById('brim-loops-val');
        if (loopsSlider) loopsSlider.value = loops;
        if (loopsLbl) loopsLbl.textContent = `${loops} шт (${(loops * (state.expert.lineWidth || 0.45) * 0.95).toFixed(1)}мм)`;
        const brimTypeSel = document.getElementById('sel-brim-type');
        if (brimTypeSel) brimTypeSel.value = state.brimType || 'outer';
        const earsChk = document.getElementById('chk-mouse-ears');
        if (earsChk) earsChk.checked = Boolean(state.mouseEars);
        const supTypeSel = document.getElementById('sel-support-type');
        if (supTypeSel) supTypeSel.value = state.supportType || 'tree';
        const supAngleSlider = document.getElementById('support-angle-slider');
        const supAngleLbl = document.getElementById('support-angle-val');
        if (supAngleSlider) supAngleSlider.value = state.supportOverhangAngle;
        if (supAngleLbl) supAngleLbl.textContent = `>${state.supportOverhangAngle}°`;
    }

    function toggleMouseEars(enabled) {
        state.mouseEars = Boolean(enabled);
        invalidateSlicedGcode();
    }

function updateSliceSummaryUI(secs, grams, meters, layers, auditReport = null) {
        const mins = Math.max(1, Math.round(secs / 60));
        const tLbl = document.getElementById('res-time-label');
        const gBig = document.getElementById('res-grams-big');
        const mBig = document.getElementById('res-meters-big');
        const wLbl = document.getElementById('res-weight-label');
        const bar = document.getElementById('slice-result-bar');
        const rowsEl = document.getElementById('slice-stats-rows');
        const p = PROFILES[state.material][state.mode];
        if (tLbl) tLbl.textContent = mins < 60 ? `${mins} мин` : `${Math.floor(mins/60)}ч ${mins%60}м`;
        if (gBig) gBig.textContent = `${grams.toFixed(2)} г`;
        if (mBig) mBig.textContent = `${meters.toFixed(2)} м • ${layers} сл.`;
        if (wLbl) wLbl.textContent = `Ender 3 V3 SE • ${state.material} • ≤${p.maxFlow || 18} мм³/с`;
        if (bar) bar.classList.remove('hidden');

        if (rowsEl && state.lastSliceStats) {
            const st = state.lastSliceStats;
            const filArea = Math.PI * Math.pow((state.expert.filamentDiameter || 1.75) / 2, 2);
            const dens = p.density || 1.24;
            const keys = ['outer', 'inner', 'solid', 'sparse', 'extra'];
            rowsEl.innerHTML = keys.map(k => {
                const item = st[k];
                if (!item) return '';
                const m = item.eMM / 1000;
                const g = ((filArea * item.eMM) / 1000) * dens;
                const tMin = Math.floor(item.timeSec / 60);
                const tSec = Math.round(item.timeSec % 60);
                const tStr = tMin > 0 ? `${tMin}м ${tSec}с` : `${tSec}с`;
                return `<div class="grid grid-cols-12 items-center py-0.5">
                    <span class="col-span-5 flex items-center gap-1.5 truncate"><span class="w-2 h-2 rounded-full shrink-0" style="background:${item.color}"></span>${item.label}</span>
                    <span class="col-span-3 text-right text-slate-300">${tStr}</span>
                    <span class="col-span-2 text-right text-amber-300">${m.toFixed(2)}м</span>
                    <span class="col-span-2 text-right text-cyan-300">${g.toFixed(1)}г</span>
                </div>`;
            }).join('');
        }
    }

    function toggleStatsBreakdown() {
        document.getElementById('slice-stats-breakdown')?.classList.toggle('hidden');
    }

    function saveTextFile(fileName, text, mime) {
        if (window.AndroidHost && typeof window.AndroidHost.saveFileToDownloads === 'function') {
            window.AndroidHost.saveFileToDownloads(fileName, text, mime || 'application/octet-stream');
            return;
        }
        const blob = new Blob([text], { type: mime || 'application/octet-stream' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = fileName;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    async function downloadGcodeFile() {
        if (!state.generatedGcode) {
            const ok = await runSlicer();
            if (!ok) return;
        }
        const cleanName = (state.modelName || 'model').replace(/\.[^/.]+$/, '').replace(/[^\w\-.()а-яА-ЯёЁ ]+/g, '_');
        const fileName = `Ender3V3SE_${state.material}_${cleanName}.gcode`;
        const fullText = (state.gcodeChunks && state.gcodeChunks.length > 0) ? state.gcodeChunks.join('') : (state.generatedGcode || '');
        saveTextFile(fileName, fullText, 'application/octet-stream');
        showToast(`Скачано: ${fileName}`);
    }
    function openGcodeTextModal() { switchTab('gcode'); updateInlineGcodeViewer(); }

    function updateInlineGcodeViewer() {
        const area = document.getElementById('gcode-inline-textarea');
        const linesEl = document.getElementById('gcode-inline-lines');
        const sizeEl = document.getElementById('gcode-inline-size');
        const codeText = (state.gcodeChunks && state.gcodeChunks.length > 0) ? state.gcodeChunks.join('') : (state.generatedGcode || '');
        if (area) {
            if (codeText.length > 350000) area.value = codeText.slice(0, 220000) + `\n\n; ... [СКРЫТО ${(codeText.length / 1024 / 1024).toFixed(1)} МБ] ...\n` + codeText.slice(-80000);
            else area.value = codeText || '; G-Code не сгенерирован.';
        }
        if (linesEl) linesEl.textContent = `Строк: ${(codeText ? codeText.split('\n').length : 0).toLocaleString('ru-RU')}`;
        if (sizeEl) sizeEl.textContent = `Размер: ${(codeText.length / 1024).toFixed(1)} КБ`;
    }

    async function copyGcodeToClipboard() {
        const fullText = (state.gcodeChunks && state.gcodeChunks.length > 0) ? state.gcodeChunks.join('') : (state.generatedGcode || '');
        if (!fullText) { showToast("Сначала нарежьте"); return; }
        try { await navigator.clipboard.writeText(fullText); showToast("G-Code скопирован"); }
        catch (e) { showToast("Ошибка копирования"); }
    }

    function openProfileDetailsModal() {
        const p = PROFILES[state.material][state.mode];
        const exp = state.expert;
        const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
        const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };
        document.getElementById('modal-profile-title').textContent = p.label;
        setVal('inp-nozzle', p.nozzleTemp);
        setVal('inp-bed', p.bedTemp);
        setVal('inp-layer', p.layerHeight);
        setVal('inp-speed', p.printSpeed);
        setVal('inp-retract', p.retractDist);
        setVal('inp-fan', p.fanSpeed);
        setVal('inp-exp-walls', exp.wallCount || 0);
        setVal('inp-exp-top', exp.topLayers !== undefined ? exp.topLayers : 5);
        setVal('inp-exp-bottom', exp.bottomLayers !== undefined ? exp.bottomLayers : 3);
        setVal('inp-exp-linewidth', exp.lineWidth || 0.45);
        setVal('inp-exp-flow', exp.flowRate || 95);
        setVal('inp-exp-zoffset', exp.zOffset || 0);
        setVal('inp-exp-pa', exp.pressureAdvance !== undefined ? exp.pressureAdvance : 0.04);
        setVal('inp-max-flow', p.maxFlow || 15.0);
        setVal('inp-exp-xycomp', exp.xyCompensation || 0);
        setVal('sel-hotend-type', exp.hotendType || 'stock');
        setVal('sel-nozzle-type', exp.nozzleType || 'brass');
        setChk('chk-y-dampen', exp.yHeightDampening !== false);
        setChk('chk-corner-reinforce', exp.cornerReinforce === true);
        setChk('chk-vase-mode', exp.vaseMode);
        updateModalHardwareSubtitle();
        document.getElementById('modal-profiles').classList.remove('hidden');
    }

function saveCustomProfileEdits() {
        const p = PROFILES[state.material][state.mode];
        const exp = state.expert;
        const parseNum = (id, cur, isFlt = false) => {
            const el = document.getElementById(id);
            if (!el) return cur;
            const v = isFlt ? parseFloat(el.value) : parseInt(el.value, 10);
            return isFinite(v) ? v : cur;
        };

        p.nozzleTemp = parseNum('inp-nozzle', p.nozzleTemp);
        p.bedTemp = parseNum('inp-bed', p.bedTemp);
        p.layerHeight = parseNum('inp-layer', p.layerHeight, true);
        p.printSpeed = parseNum('inp-speed', p.printSpeed);
        p.retractDist = parseNum('inp-retract', p.retractDist, true);
        p.fanSpeed = Math.max(0, Math.min(100, parseNum('inp-fan', p.fanSpeed)));
        p.maxFlow = Math.max(2.0, Math.min(40.0, parseNum('inp-max-flow', p.maxFlow || 15.0, true)));

        exp.wallCount = Math.max(0, Math.min(10, parseNum('inp-exp-walls', exp.wallCount || 2)));
        exp.topLayers = Math.max(0, Math.min(15, parseNum('inp-exp-top', exp.topLayers !== undefined ? exp.topLayers : 5)));
        exp.bottomLayers = Math.max(0, Math.min(15, parseNum('inp-exp-bottom', exp.bottomLayers !== undefined ? exp.bottomLayers : 3)));
        exp.lineWidth = Math.max(0.28, Math.min(0.80, parseNum('inp-exp-linewidth', exp.lineWidth || 0.45, true)));
        exp.flowRate = Math.max(70, Math.min(140, parseNum('inp-exp-flow', exp.flowRate || 95)));
        exp.zOffset = Math.max(-0.40, Math.min(0.40, parseNum('inp-exp-zoffset', exp.zOffset || 0, true)));
        exp.pressureAdvance = Math.max(0.0, Math.min(0.30, parseNum('inp-exp-pa', exp.pressureAdvance !== undefined ? exp.pressureAdvance : 0.04, true)));
        exp.xyCompensation = Math.max(-0.30, Math.min(0.30, parseNum('inp-exp-xycomp', exp.xyCompensation || 0, true)));
        exp.yHeightDampening = document.getElementById('chk-y-dampen')?.checked !== false;
        exp.cornerReinforce = !!document.getElementById('chk-corner-reinforce')?.checked;
        exp.vaseMode = !!document.getElementById('chk-vase-mode')?.checked;

        invalidateSlicedGcode();
        syncProfileSummaryUI(false);
        closeModals();
        showToast("Настройки сохранены");
    }

    function exportProfilesJSON() {
        const json = JSON.stringify({ PROFILES, expert: state.expert }, null, 2);
        saveTextFile("Ender3V3SE_Profiles.json", json, 'application/json');
        showToast("Профили экспортированы");
    }

    function toggleExpertPanel() { document.getElementById('expert-settings-panel')?.classList.toggle('hidden'); }
    function onHardwareConfigChange() {
        const hotendSel = document.getElementById('sel-hotend-type');
        const nozzleSel = document.getElementById('sel-nozzle-type');
        if (hotendSel) state.expert.hotendType = hotendSel.value;
        if (nozzleSel) state.expert.nozzleType = nozzleSel.value;
        const maxSafe = state.expert.hotendType === 'ceramic' ? 300 : 260;
        let clampedCount = 0;
        Object.keys(PROFILES).forEach(mat => {
            ['speed', 'balanced', 'quality', 'minweight'].forEach(m => {
                if (PROFILES[mat][m] && PROFILES[mat][m].nozzleTemp > maxSafe) { PROFILES[mat][m].nozzleTemp = maxSafe; clampedCount++; }
            });
        });
if (clampedCount > 0) showToast(`${clampedCount} профилей ограничены до ${maxSafe}°C`);
        updateModalHardwareSubtitle();
        syncProfileSummaryUI(false);
    }
    function updateModalHardwareSubtitle() {
        const sub = document.getElementById('modal-hw-subtitle');
        if (!sub) return;
        const hTxt = state.expert.hotendType === 'ceramic' ? 'Керамический (≤300°C)' : 'Стоковый (≤260°C)';
        const nTxt = state.expert.nozzleType === 'steel' ? 'Сталь (+5°C)' : 'Латунь 0.4мм';
        sub.textContent = `Хотэнд: ${hTxt} • Сопло: ${nTxt}`;
    }
    function hardResetSlicer() {
        const fresh = JSON.parse(JSON.stringify(DEFAULT_PROFILES));
        Object.keys(PROFILES).forEach(k => { delete PROFILES[k]; });
        Object.assign(PROFILES, fresh);
        state.material = 'PLA'; state.mode = 'balanced';
        state.expert = {
            hotendType: 'stock', nozzleType: 'brass',
            yHeightDampening: true, cornerReinforce: false,
            wallCount: 2, topLayers: 5, bottomLayers: 3,
            lineWidth: 0.45, flowRate: 95, zOffset: 0.00, pressureAdvance: 0.04,
            xyCompensation: 0.00, vaseMode: false
        };
        invalidateSlicedGcode();
        selectMaterial('PLA', true);
        selectMode('balanced');
        openProfileDetailsModal();
        showToast("Hard Reset: заводские настройки восстановлены!");
    }

    function closeModals() {
        document.getElementById('modal-profiles')?.classList.add('hidden');
        document.getElementById('modal-help')?.classList.add('hidden');
    }
    function openHelpModal() { document.getElementById('modal-help').classList.remove('hidden'); }
    function closeHelpModal() { document.getElementById('modal-help')?.classList.add('hidden'); }



    function showConfirmDialog(options, onConfirm, onCancel) {
        let msg = typeof options === 'string' ? options : (options.message || '');
        let title = (typeof options === 'object' && options.title) ? options.title : 'Подтверждение';
        let confirmText = (typeof options === 'object' && options.confirmText) ? options.confirmText : 'ОК';
        let cancelText = (typeof options === 'object' && options.cancelText) ? options.cancelText : 'Отмена';
        let type = (typeof options === 'object' && options.type) ? options.type : 'cyan';
        let icon = (typeof options === 'object' && options.icon) ? options.icon : 'fa-circle-question';

        let dlg = document.getElementById('dlg-confirm');
        if (!dlg) {
            dlg = document.createElement('div');
            dlg.id = 'dlg-confirm';
            dlg.className = 'fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4 transition-opacity';
            document.body.appendChild(dlg);
        }

        let iconBg = 'bg-cyan-500/20 text-cyan-400 border-cyan-500/40';
        let btnBg = 'bg-cyan-500 hover:bg-cyan-400 text-slate-950';

        if (type === 'rose' || type === 'red' || type === 'danger') {
            iconBg = 'bg-rose-500/20 text-rose-400 border-rose-500/40';
            btnBg = 'bg-rose-500 hover:bg-rose-400 text-white';
        } else if (type === 'emerald' || type === 'green' || type === 'success') {
            iconBg = 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40';
            btnBg = 'bg-emerald-400 hover:bg-emerald-300 text-slate-950';
        } else if (type === 'amber' || type === 'warning') {
            iconBg = 'bg-amber-500/20 text-amber-400 border-amber-500/40';
            btnBg = 'bg-amber-500 hover:bg-amber-400 text-slate-950';
        }

        dlg.innerHTML = `
            <div class="bg-slate-900 border border-slate-700/80 rounded-3xl p-5 max-w-sm w-full shadow-2xl space-y-4">
                <div class="flex items-center gap-3">
                    <div class="w-11 h-11 rounded-2xl ${iconBg} border flex items-center justify-center shrink-0 shadow-lg">
                        <i class="fa-solid ${icon} text-lg"></i>
                    </div>
                    <div>
                                               <h4 class="text-sm font-black text-white">${escapeHtml(title)}</h4>
                        <p id="dlg-confirm-msg" class="text-xs text-slate-300 mt-0.5 leading-snug">${escapeHtml(msg)}</p>
                    </div>
                </div>
                <div class="flex gap-2 pt-1 border-t border-slate-800">
                    <button id="dlg-confirm-cancel" class="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs transition active:scale-95">${cancelText}</button>
                    <button id="dlg-confirm-ok" class="flex-1 py-2.5 rounded-xl ${btnBg} font-black text-xs transition active:scale-95 shadow-lg">${confirmText}</button>
                </div>
            </div>`;

        dlg.classList.remove('hidden');
        const okBtn = document.getElementById('dlg-confirm-ok');
        const cancelBtn = document.getElementById('dlg-confirm-cancel');
        const close = () => { dlg.classList.add('hidden'); };
        okBtn.onclick = () => { close(); if (typeof onConfirm === 'function') try { onConfirm(); } catch (e) { console.error(e); } };
        cancelBtn.onclick = () => { close(); if (typeof onCancel === 'function') try { onCancel(); } catch (e) { console.error(e); } };
    }

    const _toastQueue = [];
    let _toastBusy = false;

    function showToast(msg) {
        _toastQueue.push(msg);
        if (_toastQueue.length > 5) _toastQueue.shift();
        _drainToastQueue();
    }

    function _drainToastQueue() {
        if (_toastBusy || _toastQueue.length === 0) return;
        _toastBusy = true;
        const box = document.getElementById('toast-box');
        const textEl = document.getElementById('toast-text');
        if (!box || !textEl) { _toastBusy = false; _toastQueue.length = 0; return; }
        const msg = _toastQueue.shift();
        textEl.textContent = msg;
        box.style.opacity = '1';
        box.style.transition = 'opacity 0.18s';
        clearTimeout(window._toastTimer);
        window._toastTimer = setTimeout(() => {
            box.style.opacity = '0';
            setTimeout(() => { _toastBusy = false; _drainToastQueue(); }, 200);
        }, 2200);
    }

    // ==== Undo / Save / Load ====
    function _geometryToBase64(geo) {
        const pos = geo.attributes.position.array;
        const u8 = new Uint8Array(pos.buffer, pos.byteOffset, pos.byteLength);
        let bin = '';
        const chunk = 0x8000;
        for (let i = 0; i < u8.length; i += chunk) {
            bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
        }
        return btoa(bin);
    }

    function _geometryFromBase64(b64) {
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(u8.buffer), 3));
        geo.computeVertexNormals();
        // Восстанавливаем градиент по высоте (тот же, что в setModelGeometry)
        const posAttr = geo.attributes.position;
        const vertexCount = posAttr.count;
        geo.computeBoundingBox();
        const bbox = geo.boundingBox;
        const minY = bbox ? bbox.min.y : 0;
        const maxY = bbox ? bbox.max.y : 10;
        const rangeY = Math.max(0.1, maxY - minY);
        const cols = new Float32Array(vertexCount * 3);
        for (let i = 0; i < vertexCount; i++) {
            const normY = (posAttr.getY(i) - minY) / rangeY;
            cols[i * 3] = Math.min(1.0, 0.04 + normY * 0.10);
            cols[i * 3 + 1] = Math.min(1.0, 0.68 + normY * 0.18);
            cols[i * 3 + 2] = Math.min(1.0, 0.85 + normY * 0.10);
        }
        geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
        geo.userData.originalColors = cols;
        return geo;
    }

    function pushUndoSnapshot() {
        try {
            const snap = {
                material: state.material, mode: state.mode, infill: state.infill,
                supports: state.supports, brim: state.brim, brimLoops: state.brimLoops,
                expert: JSON.parse(JSON.stringify(state.expert)),
                models: bedModels.map(m => ({
                    name: m.userData.name || 'Model',
                    posX: m.position.x, posY: -m.position.z, scale: m.scale.x,
                    geomBase64: _geometryToBase64(m.geometry)
                }))
            };
            _undoStack.push(snap);
            if (_undoStack.length > _undoMaxDepth) _undoStack.shift();
        } catch (e) { console.warn('Undo snapshot failed', e); }
    }

    function performUndo() {
        if (_undoStack.length === 0) { showToast("Нечего отменять"); return; }
        const snap = _undoStack.pop();
        _suspendAutosave = true;
        try {
            bedModels.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
            bedModels = []; activeMesh = null;
            snap.models.forEach(mData => {
                const geo = _geometryFromBase64(mData.geomBase64);
                const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(mData.posX, 0, -mData.posY);
                mesh.scale.setScalar(mData.scale);
                mesh.userData.name = mData.name;
                scene.add(mesh); bedModels.push(mesh);
            });
            state.material = PROFILES[snap.material] ? snap.material : 'PLA';
            state.mode = snap.mode;
            state.infill = snap.infill;
            state.supports = snap.supports;
            state.brim = snap.brim;
            state.brimLoops = snap.brimLoops;
            state.expert = snap.expert;
            if (bedModels.length > 0) selectMesh(bedModels[bedModels.length - 1], true);
            else deselectMesh();
            syncAllControlsUI();
            invalidateSlicedGcode();
            updateDimensionsUI();
            updateSelectionVisuals();
            showToast("↶ Отменено");
        } finally { _suspendAutosave = false; }
    }

    function _serializeState() {
        return {
            version: 1,
            material: state.material, mode: state.mode, infill: state.infill,
            supports: state.supports, supportType: state.supportType,
            supportOverhangAngle: state.supportOverhangAngle,
            brim: state.brim, brimLoops: state.brimLoops, mouseEars: state.mouseEars,
            expert: JSON.parse(JSON.stringify(state.expert)),
            models: bedModels.map(m => ({
                name: m.userData.name || 'Model',
                posX: m.position.x, posY: -m.position.z, scale: m.scale.x,
                geomBase64: _geometryToBase64(m.geometry)
            }))
        };
    }

    async function _applyProjectData(data) {
        if (!data || !Array.isArray(data.models)) throw new Error('Неверный формат');
        pushUndoSnapshot();
        _suspendAutosave = true;
        try {
            bedModels.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
            bedModels = []; activeMesh = null;
            data.models.forEach(mData => {
                const geo = _geometryFromBase64(mData.geomBase64);
                const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide });
                const mesh = new THREE.Mesh(geo, mat);
                mesh.position.set(mData.posX, 0, -mData.posY);
                mesh.scale.setScalar(mData.scale);
                mesh.userData.name = mData.name;
                scene.add(mesh); bedModels.push(mesh);
            });
            state.material = (data.material && PROFILES[data.material]) ? data.material : 'PLA';
            state.mode = data.mode || 'balanced';
            state.infill = (data.infill !== undefined) ? data.infill : 15;
            state.supports = !!data.supports;
            state.supportType = data.supportType || 'tree';
            state.supportOverhangAngle = data.supportOverhangAngle || 52;
            state.brim = !!data.brim;
            state.brimLoops = (data.brimLoops !== undefined) ? data.brimLoops : 6;
            state.mouseEars = !!data.mouseEars;
              if (data.expert) state.expert = Object.assign({}, state.expert, data.expert);
            if (bedModels.length > 0) selectMesh(bedModels[bedModels.length - 1], true);
            else deselectMesh();
            syncAllControlsUI();
            invalidateSlicedGcode();
            if (state.viewportMode === 'gcode') setViewportMode('model');
            updateDimensionsUI();
            updateSelectionVisuals();
        } finally { _suspendAutosave = false; }
    } // <-- ЭТА СКОБКА БЫЛА ПОТЕРЯНА

    function saveProject() {
        const json = JSON.stringify(_serializeState());
        const safeName = (state.modelName || 'project').replace(/\.[^/.]+$/, '').replace(/[^\w\-.()а-яА-ЯёЁ ]+/g, '_');
        saveTextFile(`${safeName}.ssproj.json`, json, 'application/json');
        showToast("💾 Проект сохранён");
    }

    async function loadProjectFile(file) {
        try {
            const raw = typeof file.text === 'function' ? await file.text() : String(file);
            const data = JSON.parse(raw);
            await _applyProjectData(data);
            showToast("📂 Проект загружен");
        } catch (e) {
            console.error(e);
            showToast("Ошибка загрузки проекта");
        }
    }

    function _initAutosave() {
        let lastJson = '';
        setInterval(() => {
            if (_suspendAutosave || state.isSlicing || !window._projectDirty) return;
            try {
                if (bedModels.length === 0) return;
                const json = JSON.stringify(_serializeState());
                window._projectDirty = false;
                if (json === lastJson) return;
                if (json.length > 4500000) return;
                localStorage.setItem('salim_autosave_v1', json);
                lastJson = json;
            } catch (e) { /* quota exceeded — silent */ }
        }, 20000);
    }

    function restoreFromAutosave() {
        try {
            const raw = localStorage.getItem('salim_autosave_v1');
            if (!raw) return false;
            const data = JSON.parse(raw);
            if (!data || !Array.isArray(data.models) || data.models.length === 0) return false;
            _applyProjectData(data);
            return true;
        } catch (e) { return false; }
    }

    function clearAutosave() {
        try { localStorage.removeItem('salim_autosave_v1'); showToast("Автосейв очищен"); }
        catch (e) { showToast("Не удалось очистить"); }
    }

    function animateLoop() {
        // Основной рендер идёт по требованию через triggerSceneRender(); здесь только страховка раз в секунду
        setInterval(() => {
            if (document.hidden || state.isSlicing) return;
            triggerSceneRender();
        }, 1000);
    }

    function preheatPrinter() {
        const p = PROFILES[state.material][state.mode];
        if (window.AndroidHost && typeof window.AndroidHost.sendGcode === 'function') {
            window.AndroidHost.sendGcode(`M140 S${p.bedTemp}\nM104 S${p.nozzleTemp}\n`);
            showToast(`🔥 Нагрев: сопло ${p.nozzleTemp}°, стол ${p.bedTemp}°`);
        } else {
            showToast(`Нагрев: ${p.nozzleTemp}° / ${p.bedTemp}° (нет связи с принтером)`);
        }
    }

    function cooldownPrinter() {
        if (window.AndroidHost && typeof window.AndroidHost.sendGcode === 'function') {
            window.AndroidHost.sendGcode(`M140 S0\nM104 S0\n`);
            showToast(`❄️ Охлаждение запущено`);
        } else {
            showToast(`Охлаждение (нет связи с принтером)`);
        }
    }

    function clearBedAll() {
        if (bedModels.length === 0) { showToast("Стол пуст"); return; }
        const doClear = () => {
            pushUndoSnapshot();
            bedModels.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
            bedModels = []; activeMesh = null;
            deselectMesh();
            clearSlicedGcodeState();
            invalidateSlicedGcode();
            updateDimensionsUI();
            updateSelectionVisuals();
            showToast("Стол очищен");
        };
        showConfirmDialog(`Очистить стол (${bedModels.length} моделей)?`, doClear);
    }

    function _initHotkeys() {
        document.addEventListener('keydown', (e) => {
            const tag = (e.target && e.target.tagName ? e.target.tagName : '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (e.ctrlKey || e.metaKey) {
                if (e.key === 's' || e.key === 'ы') { e.preventDefault(); downloadGcodeFile(); return; }
                if (e.key === 'z' || e.key === 'я') { e.preventDefault(); performUndo(); return; }
            }
            if (e.key === ' ') {
                e.preventDefault();
                if (state.slicedLayers.length > 0) toggleLayerPlay();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                e.preventDefault(); deleteSelectedModel();
            } else if (e.key === 'd' || e.key === 'в') {
                duplicateSelectedModel();
            } else if (e.key === 'f' || e.key === 'а') {
                if (controls && typeof controls.resetAll === 'function') controls.resetAll();
            } else if (e.key === 'Escape') {
                closeModals();
            }
        });
    }

    function _initFloatingActions() {
        if (document.getElementById('floating-actions')) return;
        const wrap = document.createElement('div');
        wrap.id = 'floating-actions';
        
        // Помещаем кнопки ВНУТРЬ 3D-вьюпорта, чтобы они не перекрывали ползунки и кнопку "Нарезать" снизу
        wrap.className = 'hidden sm:flex absolute top-auto bottom-4 left-4 z-[120] flex-col items-start gap-2 pointer-events-none';
        
        wrap.innerHTML = `
            <div id="fab-menu" class="hidden sm:flex flex-col gap-2 items-start transition-all duration-300 opacity-0 sm:opacity-100 scale-95 sm:scale-100 origin-top-left sm:origin-bottom-left pointer-events-auto">
                <button id="fab-undo" title="Отменить (Ctrl+Z)" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-rotate-left"></i>
                </button>
                <button id="fab-save" title="Сохранить проект" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-floppy-disk"></i>
                </button>
                <button id="fab-load" title="Загрузить проект" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-folder-open"></i>
                </button>
                <button id="fab-preheat" title="Нагрев" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-fire"></i>
                </button>
                <button id="fab-cooldown" title="Охлаждение" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-snowflake"></i>
                </button>
                <button id="fab-clear-bed" title="Очистить стол" class="w-10 h-10 sm:w-11 sm:h-11 rounded-full bg-rose-600 hover:bg-rose-500 text-white flex items-center justify-center shadow-xl active:scale-95 transition">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
            <!-- Главная кнопка для мобильных (на ПК скрыта) -->
            <button id="fab-toggle" class="sm:hidden w-10 h-10 rounded-full bg-slate-800 border border-slate-700 text-cyan-400 shadow-xl flex items-center justify-center active:scale-95 transition pointer-events-auto">
                <i class="fa-solid fa-bars text-lg transition-transform duration-300" id="fab-toggle-icon"></i>
            </button>
        `;
        
        // Вставляем в панель вьюпорта
        const vp = document.getElementById('viewport-section');
        if (vp) vp.appendChild(wrap); else document.body.appendChild(wrap);

        // Логика анимации раскрытия
        const fabToggle = document.getElementById('fab-toggle');
        const fabMenu = document.getElementById('fab-menu');
        const fabToggleIcon = document.getElementById('fab-toggle-icon');

        if (fabToggle && fabMenu) {
            fabToggle.onclick = () => {
                const isHidden = fabMenu.classList.contains('hidden');
                if (isHidden) {
                    fabMenu.classList.remove('hidden');
                    setTimeout(() => {
                        fabMenu.classList.remove('opacity-0', 'scale-95');
                        fabMenu.classList.add('opacity-100', 'scale-100');
                    }, 10);
                    fabToggleIcon.classList.add('rotate-90');
                    fabToggle.classList.add('bg-cyan-500', 'text-slate-950');
                    fabToggle.classList.remove('bg-slate-800', 'text-cyan-400');
                } else {
                    fabMenu.classList.remove('opacity-100', 'scale-100');
                    fabMenu.classList.add('opacity-0', 'scale-95');
                    fabToggleIcon.classList.remove('rotate-90');
                    fabToggle.classList.remove('bg-cyan-500', 'text-slate-950');
                    fabToggle.classList.add('bg-slate-800', 'text-cyan-400');
                    setTimeout(() => {
                        fabMenu.classList.add('hidden');
                    }, 300);
                }
            };
        }

        // Привязка действий
        document.getElementById('fab-undo').onclick = performUndo;
        document.getElementById('fab-save').onclick = saveProject;
        document.getElementById('fab-clear-bed').onclick = clearBedAll;
        document.getElementById('fab-preheat').onclick = preheatPrinter;
        document.getElementById('fab-cooldown').onclick = cooldownPrinter;
        document.getElementById('fab-load').onclick = () => {
            let inp = document.getElementById('project-file-input');
            if (!inp) {
                inp = document.createElement('input');
                inp.type = 'file';
                inp.accept = '.json,.ssproj';
                inp.id = 'project-file-input';
                inp.style.display = 'none';
                inp.onchange = (ev) => {
                    const f = ev.target.files[0];
                    if (f) loadProjectFile(f);
                    ev.target.value = '';
                };
                document.body.appendChild(inp);
            }
inp.click();
        };
    }

window.addEventListener('DOMContentLoaded', () => {
        initRotaryTempDials();
        initFileImportListeners();
        initThreeScene();
        state.mouseEars = Boolean(document.getElementById('chk-mouse-ears')?.checked);
        updateSceneLightingBrightness(75);
        updateSelectionVisuals();
        syncProfileSummaryUI();
        _initHotkeys();
        _initAutosave();
        animateLoop();

// Сессия сохраняется в фоне; диалог при старте отключен для чистоты экрана смартфона
        _suspendAutosave = false;
    });