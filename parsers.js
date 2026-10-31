/* ====================================================================
 * 3. PARSERS & MODELS (Чтение STL/3MF/OBJ/PLY и Встроенные фигуры)
 * ==================================================================== */

// ==== File parsers (STL / 3MF / OBJ / PLY / GCODE) ====
function computeGcodeStats(text, layerCount) {
    const res = { secs: 0, grams: 0, meters: 0 };
    const hms = (s) => {
        let t = 0, k;
        if ((k = /(\d+(?:\.\d+)?)\s*d/i.exec(s))) t += parseFloat(k[1]) * 86400;
        if ((k = /(\d+(?:\.\d+)?)\s*h/i.exec(s))) t += parseFloat(k[1]) * 3600;
        if ((k = /(\d+(?:\.\d+)?)\s*m(?!m)/i.exec(s))) t += parseFloat(k[1]) * 60;
        if ((k = /(\d+(?:\.\d+)?)\s*s/i.exec(s))) t += parseFloat(k[1]);
        return t;
    };
    let m;
    // Время печати из комментариев слайсера
    if ((m = /^;\s*(?:estimated printing time[^=\n]*=|total estimated time\s*:|estimated time\s*:)\s*(.+)$/im.exec(text))) res.secs = hms(m[1]);
    if (!res.secs && (m = /^;TIME:(\d+)/m.exec(text))) res.secs = parseInt(m[1], 10);
    if (!res.secs && (m = /^M73 P0 R(\d+)/m.exec(text))) res.secs = parseInt(m[1], 10) * 60;
    if (!res.secs) {
        const re = /^;TIME_ELAPSED:([\d.]+)/gm;
        let last = 0;
        while ((m = re.exec(text)) !== null) last = parseFloat(m[1]);
        res.secs = last;
    }
    // Вес и длина прутка из комментариев слайсера
    if ((m = /^;\s*(?:total )?filament (?:used \[g\]|weight \[g\])\s*[=:]\s*([\d.]+)/im.exec(text))) res.grams = parseFloat(m[1]) || 0;
    if ((m = /^;\s*(?:total )?filament used \[mm\]\s*[=:]\s*([\d.]+)/im.exec(text))) res.meters = (parseFloat(m[1]) || 0) / 1000;
    else if ((m = /^;\s*Filament used:\s*([\d.]+)\s*m/im.exec(text))) res.meters = parseFloat(m[1]) || 0;

    // Если в файле нет комментариев: считаем сами по движениям
    if (!res.secs || !res.meters) {
        const lines = text.split(/\r?\n/);
        let absE = true, x = 0, y = 0, e = 0, f = 1800, eSum = 0, t = 0;
        for (let i = 0; i < lines.length; i++) {
            const c = lines[i].split(';')[0].trim();
            if (!c) continue;
            if (c.startsWith('M82')) { absE = true; continue; }
            if (c.startsWith('M83')) { absE = false; continue; }
            if (c.startsWith('G92')) { const k = /E(-?[\d.]+)/.exec(c); if (k) e = parseFloat(k[1]); continue; }
            if (!/^G[01](?!\d)/.test(c)) continue;
            const gx = /X(-?[\d.]+)/.exec(c), gy = /Y(-?[\d.]+)/.exec(c), ge = /E(-?[\d.]+)/.exec(c), gf = /F([\d.]+)/.exec(c);
            if (gf) f = parseFloat(gf[1]);
            const nx = gx ? parseFloat(gx[1]) : x, ny = gy ? parseFloat(gy[1]) : y;
            if (ge) {
                const v = parseFloat(ge[1]);
                if (absE) { if (v > e) eSum += v - e; e = v; }
                else if (v > 0) eSum += v;
            }
            const d = Math.hypot(nx - x, ny - y);
            if (d > 0 && f > 0) t += d / (f / 60);
            x = nx; y = ny;
        }
        if (!res.meters) res.meters = eSum / 1000;
        if (!res.secs) res.secs = t * 1.15;
    }
    if (!res.grams) {
        const prof = (PROFILES[state.material] && PROFILES[state.material][state.mode]) || {};
        const dens = prof.density || 1.24;
        res.grams = (Math.PI * Math.pow(1.75 / 2, 2) * res.meters * 1000 / 1000) * dens;
    }
    res.layers = layerCount;
    return res;
}

const SalimLoader = (function () {
    const css = `
    #salim-load-ov{position:absolute;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;overflow:hidden;background:rgba(8,13,24,.78);opacity:0;pointer-events:none;transition:opacity .35s ease}
    #salim-load-ov.on{opacity:1;pointer-events:auto}
    .sl-smoke{position:absolute;width:75%;aspect-ratio:1;border-radius:50%;will-change:transform;animation:slDrift 7s ease-in-out infinite alternate}
    .sl-smoke.a{background:radial-gradient(circle,rgba(34,211,238,.38),rgba(34,211,238,0) 65%)}
    .sl-smoke.b{background:radial-gradient(circle,rgba(129,140,248,.36),rgba(129,140,248,0) 65%);animation-duration:9s;animation-delay:-3s}
    .sl-smoke.c{background:radial-gradient(circle,rgba(52,211,153,.30),rgba(52,211,153,0) 65%);animation-duration:11s;animation-delay:-6s}
    @keyframes slDrift{from{transform:translate3d(-28%,-16%,0) scale(.8)}to{transform:translate3d(28%,18%,0) scale(1.2)}}
    .sl-card{position:relative;width:min(280px,82%);padding:18px 16px 14px;border-radius:24px;background:rgba(15,23,42,.72);border:1px solid rgba(34,211,238,.35);box-shadow:0 0 40px rgba(34,211,238,.18);text-align:center;font-family:monospace}
    .sl-ring{width:76px;height:76px;margin:0 auto 12px;border-radius:50%;border:3px solid rgba(148,163,184,.18);border-top-color:#22d3ee;border-right-color:#34d399;will-change:transform;animation:slSpin 1.3s linear infinite}
    @keyframes slSpin{to{transform:rotate(360deg)}}
    .sl-title{color:#fff;font-size:12px;font-weight:800}
    .sl-name{color:#67e8f9;font-size:10px;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .sl-bar{position:relative;height:8px;margin-top:12px;border-radius:99px;background:rgba(2,6,23,.9);border:1px solid rgba(51,65,85,.8);overflow:hidden}
    .sl-fill{position:absolute;left:0;top:0;bottom:0;width:0;border-radius:99px;background:linear-gradient(90deg,#22d3ee,#38bdf8,#34d399);transition:width .7s cubic-bezier(.2,.8,.2,1);overflow:hidden}
    .sl-fill::after{content:"";position:absolute;top:0;bottom:0;width:60%;left:-60%;background:linear-gradient(90deg,transparent,rgba(255,255,255,.55),transparent);will-change:transform;animation:slShine 1.4s ease-in-out infinite}
    @keyframes slShine{to{transform:translateX(280%)}}
    .sl-pct{color:#6ee7b7;font-size:11px;font-weight:800;margin-top:6px}
    #salim-load-meter{position:absolute;right:8px;bottom:8px;z-index:15;width:156px;padding:6px 8px;border-radius:12px;background:rgba(2,6,23,.72);border:1px solid rgba(51,65,85,.9);font-family:monospace;font-size:9px;color:#cbd5e1;pointer-events:none;opacity:0;transition:opacity .3s}
    #salim-load-meter.on{opacity:1}
    #salim-load-meter .r{display:flex;justify-content:space-between;margin-top:3px}
    #salim-load-meter .t{height:3px;margin-top:1px;border-radius:9px;background:rgba(51,65,85,.8);overflow:hidden}
    #salim-load-meter .t i{display:block;height:100%;border-radius:9px;transition:width .5s}
    `;
    const st = document.createElement('style');
    st.textContent = css;
    document.head.appendChild(st);

    let ov = null, meter = null, info = null, busy = false, timer = null;
    const frame = () => new Promise(r => {
        let done = false;
        const fin = () => { if (!done) { done = true; r(); } };
        requestAnimationFrame(() => requestAnimationFrame(fin));
        setTimeout(fin, 120);
    });
    const col = (p) => p < 60 ? '#34d399' : (p < 85 ? '#fbbf24' : '#f43f5e');

    function mount() {
        const vp = document.getElementById('viewport-section');
        if (!vp) return false;
        if (ov && ov.isConnected) return true;
        ov = document.createElement('div');
        ov.id = 'salim-load-ov';
        ov.innerHTML = `<div class="sl-smoke a"></div><div class="sl-smoke b"></div><div class="sl-smoke c"></div>
            <div class="sl-card"><div class="sl-ring"></div><div class="sl-title" id="sl-title">Загрузка модели...</div>
            <div class="sl-name" id="sl-name"></div>
            <div class="sl-bar"><div class="sl-fill" id="sl-fill"></div></div><div class="sl-pct" id="sl-pct">0%</div></div>`;
        vp.appendChild(ov);
        meter = document.createElement('div');
        meter.id = 'salim-load-meter';
        vp.appendChild(meter);
        if (!timer) timer = setInterval(updMeter, 1500);
        return true;
    }

    function row(label, valTxt, pct) {
        const p = Math.max(0, Math.min(100, pct));
        return `<div class="r"><span>${label}</span><span>${valTxt}</span></div><div class="t"><i style="width:${p}%;background:${col(p)}"></i></div>`;
    }

    function updMeter() {
        if (!meter) return;
        const hasModels = (typeof bedModels !== 'undefined') && bedModels.length > 0;
        if (!info || (!busy && !hasModels)) { meter.classList.remove('on'); return; }
        if (!busy && hasModels) {
            let t = 0;
            bedModels.forEach(m => { if (m.geometry.attributes.position) t += Math.floor(m.geometry.attributes.position.count / 3); });
            info.tris = t;
        }
        const mb = info.size / 1048576;
        const fp = (mb / PRINT_LIMITS.maxFileSizeMB) * 100;
        const tp = (info.tris / PRINT_LIMITS.maxTriangles) * 100;
        let html = mb > 0 ? row('Вес файла', mb.toFixed(mb < 10 ? 2 : 1) + ' МБ', fp) : '';
        const triTxt = info.tris >= 1000 ? Math.round(info.tris / 1000) + ' тыс' : String(info.tris);
        html += row('Треугольники', triTxt, tp);
        let memP = 0;
        try {
            const pm = performance.memory;
            if (pm && pm.jsHeapSizeLimit) {
                memP = (pm.usedJSHeapSize / pm.jsHeapSizeLimit) * 100;
                html += row('Память', Math.round(pm.usedJSHeapSize / 1048576) + ' / ' + Math.round(pm.jsHeapSizeLimit / 1048576) + ' МБ', memP);
            }
        } catch (e) { /* память недоступна */ }
        const total = Math.max(fp, tp, memP);
        html = `<div class="r" style="color:#fff;font-weight:800"><span>Нагрузка</span><span style="color:${col(total)}">${Math.round(total)}%</span></div>` + html;
        meter.innerHTML = html;
        meter.classList.add('on');
    }

    function setBar(p, text) {
        const f = document.getElementById('sl-fill'), pc = document.getElementById('sl-pct'), t = document.getElementById('sl-title');
        if (f) f.style.width = p + '%';
        if (pc) pc.textContent = Math.round(p) + '%';
        if (t && text) t.textContent = text;
    }

    return {
        async begin(name, size) {
            if (!mount()) return;
            busy = true;
            info = { size: size || 0, tris: 0 };
            const n = document.getElementById('sl-name');
            if (n) n.textContent = name || '';
            setBar(0, 'Чтение файла...');
            ov.classList.add('on');
            updMeter();
            await frame();
            setBar(12, 'Чтение файла...');
            await frame();
        },
        async stage(p, text) {
            if (!busy) return;
            setBar(p, text);
            await frame();
        },
        end(size, geo, result) {
            if (!busy) return;
            busy = false;
            const ok = result && result.success !== false;
            if (ok) {
                const pos = geo && geo.attributes && geo.attributes.position;
                info = { size: size || 0, tris: pos ? Math.floor(pos.count / 3) : 0 };
                setBar(100, 'Готово');
            }
            setTimeout(() => { if (ov && !busy) ov.classList.remove('on'); }, ok ? 500 : 0);
            updMeter();
        },
        reset() { info = { size: 0, tris: 0 }; updMeter(); },
        fail() {
            busy = false;
            if (ov) ov.classList.remove('on');
            updMeter();
        }
    };
})();

function parseGCodeText(text) {
        const lines = text.split(/\r?\n/);
        const layers = [];
        const hasZComments = /^;Z:/m.test(text);
        const cx = PRINTER_SPECS.bedX / 2;
        const cy = PRINTER_SPECS.bedY / 2;

        const makeLayer = (h, dH) => ({ h, dH, innerWalls: [], outerWalls: [], solidInfill: [], sparseInfill: [], extras: [] });
        const layerHasData = (l) => Boolean(l && (l.innerWalls.length || l.outerWalls.length || l.solidInfill.length || l.sparseInfill.length || l.extras.length));

        let curZ = 0;
        let pendingZ = null;
        let curLayer = null;
        let curX = 0, curY = 0;
        let curE = 0;
        let absoluteE = false;
        let curType = null;

        const startLayer = (newZ) => {
            if (layerHasData(curLayer)) layers.push(curLayer);
            const dH = Number(Math.max(0.05, newZ - curZ).toFixed(3));
            curZ = newZ;
            curLayer = makeLayer(newZ, dH);
        };

        function addSegment(x1, y1, x2, y2, type) {
            if (!type) return;
            if (!curLayer) startLayer(0.2);
            // Перевод из координат стола Creality (0..220) в центр 3D-сцены Three.js (-110..+110)
            const seg = { p1: { x: x1 - cx, z: cy - y1 }, p2: { x: x2 - cx, z: cy - y2 } };
            if (type === 'outer') curLayer.outerWalls.push(seg);
            else if (type === 'inner') curLayer.innerWalls.push(seg);
            else if (type === 'solid') curLayer.solidInfill.push(seg);
            else if (type === 'sparse') curLayer.sparseInfill.push(seg);
            else curLayer.extras.push(seg);
        }

        for (let i = 0; i < lines.length; i++) {
            const raw = lines[i].trim();
            if (!raw) continue;

            // 1. Типы линий (Creality Print / Prusa / Cura и наш собственный генератор)
            if (raw.startsWith(';TYPE:')) {
                const t = raw.slice(6).toLowerCase().replace(/[-_]/g, ' ').trim();
                if (t === 'custom') curType = null;
                else if (t.includes('outer') || t.includes('overhang')) curType = 'outer';
                else if (t.includes('wall') || t.includes('perimeter')) curType = 'inner';
                else if (t.includes('solid') || t.includes('skin') || t.includes('surface') || t.includes('gap') || t.includes('bridge')) curType = 'solid';
                else if (t.includes('infill') || t.includes('fill')) curType = 'sparse';
                else curType = 'extras';
                continue;
            }

            // 2. Смена слоя по комментарию ;Z:
            if (raw.startsWith(';Z:')) {
                const nextZ = parseFloat(raw.slice(3));
                if (isFinite(nextZ)) startLayer(nextZ);
                continue;
            }
            if (raw.startsWith(';')) continue;

            const cmd = raw.split(';')[0].trim();
            if (cmd.startsWith('M82')) { absoluteE = true; continue; }
            if (cmd.startsWith('M83')) { absoluteE = false; continue; }
            if (cmd.startsWith('G92')) {
                const eReset = cmd.match(/E([\d.-]+)/);
                if (eReset) curE = parseFloat(eReset[1]);
                continue;
            }

            // 3. Команды движения строго G0..G3 (G28, G29 и т.п. не считаются)
            const gm = cmd.match(/^G([0-3])(?!\d)/);
            if (!gm) continue;
            const gNum = parseInt(gm[1], 10);
            const isArc = (gNum === 2 || gNum === 3);
            const isCW = (gNum === 2);
            const num = (re) => { const m = cmd.match(re); return m ? parseFloat(m[1]) : null; };

            const xv = num(/X([\d.-]+)/), yv = num(/Y([\d.-]+)/), zv = num(/Z([\d.-]+)/);
            const ev = num(/E([\d.-]+)/), iv = num(/I([\d.-]+)/), jv = num(/J([\d.-]+)/);
            const nextX = xv !== null ? xv : curX;
            const nextY = yv !== null ? yv : curY;

            // Z-хопы и подъёмы без печати не создают слоёв: слой начинается только при экструзии на новой высоте
            if (zv !== null && !hasZComments) pendingZ = zv;

            let hasExtrusion = false;
            if (ev !== null) {
                if (absoluteE) { hasExtrusion = ev > curE + 1e-6; curE = ev; }
                else hasExtrusion = ev > 0;
            }
            if (hasExtrusion && !hasZComments && pendingZ !== null) {
                if (pendingZ > curZ + 0.001) startLayer(pendingZ);
                pendingZ = null;
            }

            if (isArc && hasExtrusion && (iv !== null || jv !== null)) {
                const iVal = iv !== null ? iv : 0;
                const jVal = jv !== null ? jv : 0;
                const cX = curX + iVal;
                const cY = curY + jVal;
                const r = Math.hypot(iVal, jVal);

                let startAngle = Math.atan2(curY - cY, curX - cX);
                let endAngle = Math.atan2(nextY - cY, nextX - cX);
                if (isCW) {
                    if (endAngle >= startAngle) endAngle -= Math.PI * 2;
                } else {
                    if (endAngle <= startAngle) endAngle += Math.PI * 2;
                }

                const arcLen = Math.abs(endAngle - startAngle) * r;
                const steps = Math.max(3, Math.min(24, Math.ceil(arcLen / 0.8)));
                let prevArcX = curX, prevArcY = curY;
                for (let s = 1; s <= steps; s++) {
                    const t = s / steps;
                    const ang = startAngle + (endAngle - startAngle) * t;
                    const ptX = (s === steps) ? nextX : (cX + Math.cos(ang) * r);
                    const ptY = (s === steps) ? nextY : (cY + Math.sin(ang) * r);
                    addSegment(prevArcX, prevArcY, ptX, ptY, curType);
                    prevArcX = ptX; prevArcY = ptY;
                }
            } else if (!isArc && hasExtrusion) {
                addSegment(curX, curY, nextX, nextY, curType);
            }

            curX = nextX;
            curY = nextY;
        }

        if (layerHasData(curLayer)) layers.push(curLayer);
        return { layers, rawGcode: text };
    }
async function parse3MFBuffer(buffer) {
    const zip = await JSZip.loadAsync(buffer);
    const modelFiles = [];
    zip.forEach((relPath, file) => {
        if (!file.dir && relPath.toLowerCase().endsWith('.model')) modelFiles.push({ path: relPath, file });
    });
    if (modelFiles.length === 0) throw new Error('3MF без 3D-модели');

    const isMainPath = (p) => /(^|\/)3dmodel\.model$/i.test(p);
    modelFiles.sort((a, b) => (isMainPath(a.path) ? 0 : 1) - (isMainPath(b.path) ? 0 : 1));

    const outCoords = [];
    for (const entry of modelFiles) {
        const xmlText = await entry.file.async('text');
        const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');
        const meshNodes = xmlDoc.querySelectorAll('mesh');
        if (meshNodes.length === 0) continue;

        // Матрица трансформации лежит в <build><item> главного файла и задана в системе 3MF (Z-вверх)
        let transformMatrix = null;
        if (isMainPath(entry.path)) {
            const itemNode = xmlDoc.querySelector('build > item');
            if (itemNode && itemNode.hasAttribute('transform')) {
                const parts = itemNode.getAttribute('transform').trim().split(/\s+/).map(parseFloat);
                if (parts.length === 12 && parts.every(isFinite)) {
                    transformMatrix = new THREE.Matrix4().set(
                        parts[0], parts[3], parts[6], parts[9],
                        parts[1], parts[4], parts[7], parts[10],
                        parts[2], parts[5], parts[8], parts[11],
                        0, 0, 0, 1
                    );
                }
            }
        }

        meshNodes.forEach(meshNode => {
            const vArr = [];
            meshNode.querySelectorAll('vertex').forEach(v => {
                const vec = new THREE.Vector3(
                    parseFloat(v.getAttribute('x')) || 0,
                    parseFloat(v.getAttribute('y')) || 0,
                    parseFloat(v.getAttribute('z')) || 0
                );
                // Сначала трансформация в пространстве 3MF, потом перевод Z-up → Y-up
                if (transformMatrix) vec.applyMatrix4(transformMatrix);
                vArr.push([vec.x, vec.z, -vec.y]);
            });
            meshNode.querySelectorAll('triangle').forEach(t => {
                const i1 = parseInt(t.getAttribute('v1')), i2 = parseInt(t.getAttribute('v2')), i3 = parseInt(t.getAttribute('v3'));
                if (vArr[i1] && vArr[i2] && vArr[i3]) {
                    outCoords.push(...vArr[i1], ...vArr[i2], ...vArr[i3]);
                }
            });
        });
        if (outCoords.length > 0 && isMainPath(entry.path)) break;
    }
    if (outCoords.length === 0) throw new Error('3MF не содержит треугольников');
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(outCoords), 3));
    geo.computeVertexNormals(); return geo;
}

        function parseSTLInWorker(buffer, maxTriangles) {
        return new Promise((resolve) => {
            let worker = null, url = null;
            const finish = (geo) => {
                try { if (worker) worker.terminate(); if (url) URL.revokeObjectURL(url); } catch (e) { /* ничего */ }
                resolve(geo);
            };
            try {
                if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || buffer.byteLength < 200000) { resolve(null); return; }
                const workerMain = function () {
                    self.onmessage = function (ev) {
                        const buf = ev.data.buf, maxTri = ev.data.maxTri;
                        try {
                            if (buf.byteLength <= 84) { self.postMessage({ ok: false }); return; }
                            const dv = new DataView(buf);
                            const tri = dv.getUint32(80, true);
                            if (tri <= 0 || tri > maxTri || buf.byteLength < 84 + tri * 50) { self.postMessage({ ok: false }); return; }
                            const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(256, buf.byteLength)));
                            if (head.trimStart().toLowerCase().startsWith('solid') && /facet\s+normal/i.test(head)) { self.postMessage({ ok: false }); return; }
                            const pos = new Float32Array(tri * 9);
                            let off = 84;
                            for (let i = 0; i < tri; i++) {
                                off += 12;
                                for (let v = 0; v < 3; v++) {
                                    const x = dv.getFloat32(off, true);
                                    const y = dv.getFloat32(off + 4, true);
                                    const z = dv.getFloat32(off + 8, true);
                                    off += 12;
                                    const p = i * 9 + v * 3;
                                    pos[p] = x; pos[p + 1] = z; pos[p + 2] = -y;
                                }
                                off += 2;
                            }
                            self.postMessage({ ok: true, pos: pos }, [pos.buffer]);
                        } catch (err) {
                            self.postMessage({ ok: false });
                        }
                    };
                };
                url = URL.createObjectURL(new Blob(['(' + workerMain.toString() + ')()'], { type: 'application/javascript' }));
                worker = new Worker(url);
                worker.onmessage = (ev) => {
                    const d = ev.data;
                    if (!d || !d.ok) { finish(null); return; }
                    const geo = new THREE.BufferGeometry();
                    geo.setAttribute('position', new THREE.BufferAttribute(d.pos, 3));
                    geo.computeVertexNormals();
                    finish(geo);
                };
                worker.onerror = () => finish(null);
                worker.postMessage({ buf: buffer, maxTri: maxTriangles }, [buffer]);
            } catch (e) {
                finish(null);
            }
        });
    }

    function parseSTLBuffer(buffer) {
        const dataView = new DataView(buffer);
        
        // 1. Попытка прочитать бинарный STL
        if (buffer.byteLength > 84) {
            const triCount = dataView.getUint32(80, true);
            const expectedByteLen = 84 + triCount * 50;
            const headPreview = new TextDecoder().decode(buffer.slice(0, Math.min(256, buffer.byteLength)));
            const looksLikeAscii = headPreview.trimStart().toLowerCase().startsWith('solid') && /facet\s+normal/i.test(headPreview);
            
            if (!looksLikeAscii && triCount > 0 && buffer.byteLength >= expectedByteLen) {
                if (triCount > PRINT_LIMITS.maxTriangles) {
                    throw new Error(`Модель слишком сложная: ${triCount.toLocaleString('ru-RU')} треугольников (лимит: ${PRINT_LIMITS.maxTriangles.toLocaleString('ru-RU')})`);
                }
                const positions = new Float32Array(triCount * 9);
                let offset = 84;
                try {
                    for (let i = 0; i < triCount; i++) {
                        offset += 12;
                        for (let v = 0; v < 3; v++) {
                            const x = dataView.getFloat32(offset, true);
                            const y = dataView.getFloat32(offset + 4, true);
                            const z = dataView.getFloat32(offset + 8, true);
                            offset += 12;
                            positions[i * 9 + v * 3] = x;
                            positions[i * 9 + v * 3 + 1] = z;
                            positions[i * 9 + v * 3 + 2] = -y;
                        }
                        offset += 2;
                    }
                } catch (e) {
                    throw new Error("Файл поврежден (бинарный STL не соответствует заявленному размеру)");
                }
                const geo = new THREE.BufferGeometry();
                geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
                geo.computeVertexNormals(); return geo;
            }
        }

        // 2. Попытка прочитать текстовый STL
        try {
            const text = new TextDecoder().decode(buffer);
            const verts = [];
            const regex = /vertex\s+([\d.+\-eE]+)\s+([\d.+\-eE]+)\s+([\d.+\-eE]+)/g;
            let match;
            while ((match = regex.exec(text)) !== null) {
                verts.push(parseFloat(match[1]), parseFloat(match[3]), -parseFloat(match[2]));
            }
            if (verts.length === 0) {
                throw new Error("В файле не найдено треугольников. Возможно, это не STL или файл сильно поврежден.");
            }
            const geo = new THREE.BufferGeometry();
            geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3));
            geo.computeVertexNormals(); return geo;
        } catch (e) {
            throw new Error("Не удалось прочитать STL: " + e.message);
        }
    }

    function parseOBJText(text) {
        const lines = text.split(/\r?\n/);
        const vertices = [], positions = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line || line.startsWith('#')) continue;
            if (line.startsWith('v ')) {
                const parts = line.split(/\s+/);
                vertices.push({ x: parseFloat(parts[1]) || 0, y: parseFloat(parts[2]) || 0, z: parseFloat(parts[3]) || 0 });
            } else if (line.startsWith('f ')) {
                const parts = line.split(/\s+/).slice(1);
                if (parts.length < 3) continue;
                const faceIndices = [];
                for (let p = 0; p < parts.length; p++) {
                    let idx = parseInt(parts[p].split('/')[0], 10);
                    if (isNaN(idx)) continue;
                    idx = idx < 0 ? (vertices.length + idx) : (idx - 1);
                    faceIndices.push(idx);
                }
                for (let f = 1; f < faceIndices.length - 1; f++) {
                    const v0 = vertices[faceIndices[0]], v1 = vertices[faceIndices[f]], v2 = vertices[faceIndices[f + 1]];
                    if (v0 && v1 && v2) {
                        positions.push(v0.x, v0.z, -v0.y, v1.x, v1.z, -v1.y, v2.x, v2.z, -v2.y);
                    }
                }
            }
        }
        if (positions.length === 0) throw new Error("OBJ без геометрии");
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.computeVertexNormals(); return geo;
    }
    function parsePLYBuffer(buffer) {
        const bytes = new Uint8Array(buffer);
        const headText = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(16384, bytes.length)));
        const endIdx = headText.indexOf('end_header');
        if (endIdx === -1) throw new Error("Некорректный PLY");
        let dataStart = endIdx + 'end_header'.length;
        if (bytes[dataStart] === 13) dataStart++;
        if (bytes[dataStart] === 10) dataStart++;

        let format = 'ascii';
        const elements = [];
        for (const rawLine of headText.slice(0, endIdx).split(/\r?\n/)) {
            const p = rawLine.trim().split(/\s+/);
            if (p[0] === 'format') format = p[1];
            else if (p[0] === 'element') elements.push({ name: p[1], count: parseInt(p[2], 10) || 0, props: [] });
            else if (p[0] === 'property' && elements.length > 0) {
                const el = elements[elements.length - 1];
                if (p[1] === 'list') el.props.push({ isList: true, countType: p[2], itemType: p[3], name: p[4] });
                else el.props.push({ isList: false, type: p[1], name: p[2] });
            }
        }

        const isAscii = format === 'ascii';
        const little = format !== 'binary_big_endian';
        const view = new DataView(buffer);
        const tokens = isAscii ? new TextDecoder().decode(bytes.subarray(dataStart)).split(/\s+/).filter(Boolean) : null;
        let off = dataStart, tokenIdx = 0;

        const readValue = (type) => {
            if (isAscii) return parseFloat(tokens[tokenIdx++]);
            let v;
            switch (type) {
                case 'char': case 'int8': v = view.getInt8(off); off += 1; break;
                case 'uchar': case 'uint8': v = view.getUint8(off); off += 1; break;
                case 'short': case 'int16': v = view.getInt16(off, little); off += 2; break;
                case 'ushort': case 'uint16': v = view.getUint16(off, little); off += 2; break;
                case 'int': case 'int32': v = view.getInt32(off, little); off += 4; break;
                case 'uint': case 'uint32': v = view.getUint32(off, little); off += 4; break;
                case 'double': case 'float64': v = view.getFloat64(off, little); off += 8; break;
                default: v = view.getFloat32(off, little); off += 4;
            }
            return v;
        };

        const verts = [];
        const positions = [];
        for (const el of elements) {
            for (let i = 0; i < el.count; i++) {
                let x = 0, y = 0, z = 0, faceIdx = null;
                for (const prop of el.props) {
                    if (prop.isList) {
                        const n = readValue(prop.countType);
                        const arr = [];
                        for (let k = 0; k < n; k++) arr.push(readValue(prop.itemType));
                        if (el.name === 'face' && (prop.name === 'vertex_indices' || prop.name === 'vertex_index')) faceIdx = arr;
                    } else {
                        const v = readValue(prop.type);
                        if (el.name === 'vertex') {
                            if (prop.name === 'x') x = v;
                            else if (prop.name === 'y') y = v;
                            else if (prop.name === 'z') z = v;
                        }
                    }
                }
                if (el.name === 'vertex') {
                    verts.push(x, y, z);
                } else if (el.name === 'face' && faceIdx && faceIdx.length >= 3) {
                    for (let f = 1; f < faceIdx.length - 1; f++) {
                        const a = faceIdx[0] * 3, b = faceIdx[f] * 3, c = faceIdx[f + 1] * 3;
                        if (verts[a] === undefined || verts[b] === undefined || verts[c] === undefined) continue;
                        // Z-up (PLY) → Y-up (Three.js)
                        positions.push(
                            verts[a], verts[a + 2], -verts[a + 1],
                            verts[b], verts[b + 2], -verts[b + 1],
                            verts[c], verts[c + 2], -verts[c + 1]
                        );
                    }
                }
            }
        }
        if (positions.length === 0) throw new Error("PLY без треугольников");
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
        geo.computeVertexNormals(); return geo;
    }

// ==== Built-in test models ====
    function mergeGeos(geos) {
        let totalVerts = 0;
        const validGeos = geos.filter(Boolean);
        const nonIndexed = validGeos.map(g => { const ni = g.index ? g.toNonIndexed() : g.clone(); totalVerts += ni.attributes.position.count; return ni; });
        const mergedPos = new Float32Array(totalVerts * 3);
        let offset = 0;
        nonIndexed.forEach((ni, idx) => {
            mergedPos.set(ni.attributes.position.array, offset);
            offset += ni.attributes.position.array.length;
            ni.dispose(); if (validGeos[idx]) validGeos[idx].dispose();
        });
        const out = new THREE.BufferGeometry();
        out.setAttribute('position', new THREE.BufferAttribute(mergedPos, 3));
        out.computeVertexNormals();
        return out;
    }

    // Булево объединение 2D-полигонов через Clipper (pftNonZero) и экструзия без внутренних пересечений
    function extrudeClipperPolys(outerPolys, holePolys, depth) {
        const SC = 1000;
        const toClipper = (list) => (list || []).map(pts => pts.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));
        let sol = new ClipperLib.Paths();
        const cpr = new ClipperLib.Clipper();
        cpr.AddPaths(toClipper(outerPolys), ClipperLib.PolyType.ptSubject, true);
        cpr.Execute(ClipperLib.ClipType.ctUnion, sol, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

        if (holePolys && holePolys.length > 0) {
            const diff = new ClipperLib.Paths();
            const cprD = new ClipperLib.Clipper();
            cprD.AddPaths(sol, ClipperLib.PolyType.ptSubject, true);
            cprD.AddPaths(toClipper(holePolys), ClipperLib.PolyType.ptClip, true);
            cprD.Execute(ClipperLib.ClipType.ctDifference, diff, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);
            sol = diff;
        }
        if (!sol || sol.length === 0) return null;

        const n = sol.length;
        const areas = sol.map(p => Math.abs(ClipperLib.Clipper.Area(p)));
        const isHole = new Array(n).fill(false);
        const parent = new Array(n).fill(-1);
        for (let i = 0; i < n; i++) {
            let depthN = 0, best = -1;
            for (let j = 0; j < n; j++) {
                if (j !== i && ClipperLib.Clipper.PointInPolygon(sol[i][0], sol[j]) !== 0) {
                    depthN++;
                    if (best < 0 || areas[j] < areas[best]) best = j;
                }
            }
            isHole[i] = (depthN % 2 === 1);
            parent[i] = best;
        }

        const shapes = new Array(n).fill(null);
        for (let i = 0; i < n; i++) {
            if (isHole[i]) continue;
            const s = new THREE.Shape();
            sol[i].forEach((p, k) => { if (k === 0) s.moveTo(p.X / SC, p.Y / SC); else s.lineTo(p.X / SC, p.Y / SC); });
            s.closePath();
            shapes[i] = s;
        }
        for (let i = 0; i < n; i++) {
            if (!isHole[i] || parent[i] < 0 || !shapes[parent[i]]) continue;
            const h = new THREE.Path();
            sol[i].forEach((p, k) => { if (k === 0) h.moveTo(p.X / SC, p.Y / SC); else h.lineTo(p.X / SC, p.Y / SC); });
            h.closePath();
            shapes[parent[i]].holes.push(h);
        }
        const valid = shapes.filter(Boolean);
        if (valid.length === 0) return null;
        return new THREE.ExtrudeGeometry(valid, { depth: depth, bevelEnabled: false });
    }

    // Монолитное тело вращения (без внутренних перегородок и с правильными внешними нормалями)
    function createLatheGeo(profile, segs = 36, offX = 0, offZ = 0) {
        const tris = [];
        const pushTri = (a, b, c) => tris.push(...a, ...b, ...c);
        const rings = profile.map(([r, y]) => {
            const ring = [];
            for (let i = 0; i < segs; i++) {
                const th = (i * Math.PI * 2) / segs;
                ring.push([offX + Math.cos(th) * r, y, offZ + Math.sin(th) * r]);
            }
            return ring;
        });

        const yBot = profile[0][1];
        const yTop = profile[profile.length - 1][1];
        const rTop = profile[profile.length - 1][0];
        const lastIdx = rings.length - 1;

        for (let i = 0; i < segs; i++) {
            const ni = (i + 1) % segs;
            pushTri([offX, yBot, offZ], rings[0][i], rings[0][ni]);
            for (let s = 0; s < lastIdx; s++) {
                const p1 = rings[s][i], p2 = rings[s][ni], p3 = rings[s + 1][ni], p4 = rings[s + 1][i];
                if (s === lastIdx - 1 && rTop <= 1e-4) {
                    pushTri(p1, p3, p2);
                } else {
                    pushTri(p1, p3, p2);
                    pushTri(p1, p4, p3);
                }
            }
            if (rTop > 1e-4) {
                pushTri([offX, yTop, offZ], rings[lastIdx][ni], rings[lastIdx][i]);
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
        geo.computeVertexNormals();
        return geo;
    }

    function createRocketGeo() {
        const segs = 72;
        const yLevels = [0, 4, 6, 22, 34, 55];
        const baseRadii = [17.5, 15.0, 13.0, 11.8, 11.0, 0.0];
        const tris = [];
        const getRadius = (y, theta) => {
            let r = 11.0;
            for (let k = 0; k < yLevels.length - 1; k++) {
                if (y >= yLevels[k] && y <= yLevels[k + 1]) {
                    const t = (y - yLevels[k]) / (yLevels[k + 1] - yLevels[k]);
                    r = baseRadii[k] + t * (baseRadii[k + 1] - baseRadii[k]); break;
                }
            }
            if (y >= 4 && y <= 22) {
                const finEnv = Math.sin(((y - 4) / 18) * Math.PI);
                for (let f = 0; f < 3; f++) {
                    const ca = (f * Math.PI * 2) / 3;
                    const dA = Math.abs(Math.atan2(Math.sin(theta - ca), Math.cos(theta - ca)));
                    if (dA < 0.22) r += 7.5 * Math.cos((dA / 0.22) * (Math.PI * 0.5)) * finEnv;
                }
            }
            return r;
        };
        const rings = [];
        for (let s = 0; s <= 28; s++) {
            const y = (s / 28) * 55;
            const ring = [];
            for (let i = 0; i < segs; i++) {
                const th = (i * Math.PI * 2) / segs;
                const rad = (s === 28) ? 0 : getRadius(y, th);
                ring.push([Math.cos(th) * rad, y, Math.sin(th) * rad]);
            }
            rings.push(ring);
        }
        const pushTri = (a, b, c) => tris.push(...a, ...b, ...c);
        for (let i = 0; i < segs; i++) {
            const ni = (i + 1) % segs;
            pushTri([0, 0, 0], rings[0][i], rings[0][ni]);
            for (let s = 0; s < 28; s++) {
                const p1 = rings[s][i], p2 = rings[s][ni], p3 = rings[s + 1][ni], p4 = rings[s + 1][i];
                if (s === 27) pushTri(p1, p3, p2);
                else { pushTri(p1, p3, p2); pushTri(p1, p4, p3); }
            }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
        geo.computeVertexNormals(); return geo;
    }

    function createCubeGeo() {
        const S = 10;
        const DEPTH = 0.8;

        const shapeX = new THREE.Shape();
        shapeX.moveTo(-4.2, 5.0); shapeX.lineTo(-2.6, 5.0); shapeX.lineTo(0.0, 0.9);
        shapeX.lineTo(2.6, 5.0); shapeX.lineTo(4.2, 5.0); shapeX.lineTo(1.2, 0.0);
        shapeX.lineTo(4.2, -5.0); shapeX.lineTo(2.6, -5.0); shapeX.lineTo(0.0, -0.9);
        shapeX.lineTo(-2.6, -5.0); shapeX.lineTo(-4.2, -5.0); shapeX.lineTo(-1.2, 0.0);
        shapeX.closePath();

        const shapeY = new THREE.Shape();
        shapeY.moveTo(-0.8, -5.0); shapeY.lineTo(0.8, -5.0); shapeY.lineTo(0.8, -0.5);
        shapeY.lineTo(4.2, 5.0); shapeY.lineTo(2.4, 5.0); shapeY.lineTo(0.0, 0.8);
        shapeY.lineTo(-2.4, 5.0); shapeY.lineTo(-4.2, 5.0); shapeY.lineTo(-0.8, -0.5);
        shapeY.closePath();

        const shapeZ = new THREE.Shape();
        shapeZ.moveTo(-4.2, 5.0); shapeZ.lineTo(4.2, 5.0); shapeZ.lineTo(4.2, 3.4);
        shapeZ.lineTo(-1.6, -3.4); shapeZ.lineTo(4.2, -3.4); shapeZ.lineTo(4.2, -5.0);
        shapeZ.lineTo(-4.2, -5.0); shapeZ.lineTo(-4.2, -3.4); shapeZ.lineTo(1.6, 3.4);
        shapeZ.lineTo(-4.2, 3.4); shapeZ.closePath();

        const buildFace = (letter) => {
            const sq = new THREE.Shape();
            sq.moveTo(-S, -S); sq.lineTo(S, -S); sq.lineTo(S, S); sq.lineTo(-S, S); sq.closePath();
            if (!letter) return [new THREE.ShapeGeometry(sq)];

            const pts = letter.getPoints();
            if (pts.length > 1 && pts[0].distanceTo(pts[pts.length - 1]) < 1e-6) pts.pop();
            sq.holes.push(new THREE.Path(pts));

            const plate = new THREE.ShapeGeometry(sq);
            const floor = new THREE.ShapeGeometry(letter);
            floor.translate(0, 0, -DEPTH);

            const wall = [];
            for (let i = 0; i < pts.length; i++) {
                const a = pts[i], b = pts[(i + 1) % pts.length];
                if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-6) continue;
                wall.push(
                    a.x, a.y, 0,       b.x, b.y, 0,       b.x, b.y, -DEPTH,
                    a.x, a.y, 0,       b.x, b.y, -DEPTH,  a.x, a.y, -DEPTH
                );
            }
            const walls = new THREE.BufferGeometry();
            walls.setAttribute('position', new THREE.BufferAttribute(new Float32Array(wall), 3));
            return [plate, floor, walls];
        };

        const place = (geos, rot, pos) => {
            geos.forEach(g => {
                if (rot === 'y180') g.rotateY(Math.PI);
                else if (rot === 'y90') g.rotateY(Math.PI / 2);
                else if (rot === 'y-90') g.rotateY(-Math.PI / 2);
                else if (rot === 'x-90') g.rotateX(-Math.PI / 2);
                else if (rot === 'x90') g.rotateX(Math.PI / 2);
                g.translate(pos[0], pos[1], pos[2]);
            });
            return geos;
        };

        const parts = []
            .concat(place(buildFace(shapeX), null,   [0, 10, 10]))
            .concat(place(buildFace(shapeY), 'y90',  [10, 10, 0]))
            .concat(place(buildFace(shapeZ), 'x-90', [0, 20, 0]))
            .concat(place(buildFace(null),   'y180', [0, 10, -10]))
            .concat(place(buildFace(null),   'y-90', [-10, 10, 0]))
            .concat(place(buildFace(null),   'x90',  [0, 0, 0]));

        return mergeGeos(parts);
    }

    function createGearGeo() {
        const teeth = 16, outerR = 18.0, pitchR = 15.8, rootR = 13.5, h = 8.0;
        const gearPts = [];
        for (let i = 0; i < teeth; i++) {
            const step = (Math.PI * 2) / teeth;
            const a0 = i * step;
            const a1 = a0 + step * 0.18;
            const a2 = a0 + step * 0.34;
            const a3 = a0 + step * 0.52;
            const a4 = a0 + step * 0.68;
            const a5 = a0 + step * 0.84;
            gearPts.push(
                [rootR * Math.cos(a0), rootR * Math.sin(a0)],
                [rootR * Math.cos(a1), rootR * Math.sin(a1)],
                [pitchR * Math.cos(a2), pitchR * Math.sin(a2)],
                [outerR * Math.cos(a3), outerR * Math.sin(a3)],
                [outerR * Math.cos(a4), outerR * Math.sin(a4)],
                [pitchR * Math.cos(a5), pitchR * Math.sin(a5)]
            );
        }

        // Отверстие под вал D=8 мм с лыской (D-shaft) и 4 облегчающих окна
        const borePts = [];
        for (let i = 0; i < 32; i++) {
            const a = (i * Math.PI * 2) / 32;
            const x = Math.min(3.1, 4.0 * Math.cos(a));
            const y = 4.0 * Math.sin(a);
            borePts.push([x, y]);
        }
        const holes = [borePts];
        for (let k = 0; k < 4; k++) {
            const ca = (k * Math.PI) / 2 + Math.PI / 4;
            const cx = 8.8 * Math.cos(ca), cy = 8.8 * Math.sin(ca);
            const win = [];
            for (let s = 0; s < 16; s++) {
                const a = (s * Math.PI * 2) / 16;
                win.push([cx + 2.1 * Math.cos(a), cy + 2.1 * Math.sin(a)]);
            }
            holes.push(win);
        }

        const body = extrudeClipperPolys([gearPts], holes, h);
        body.rotateX(-Math.PI / 2);

        // Ступица сверху (y от 8.0 до 11.0 мм — без пересечения по высоте)
        const hubOuter = [];
        for (let i = 0; i < 32; i++) {
            const a = (i * Math.PI * 2) / 32;
            hubOuter.push([6.8 * Math.cos(a), 6.8 * Math.sin(a)]);
        }
        const hub = extrudeClipperPolys([hubOuter], [borePts], 3.0);
        hub.rotateX(-Math.PI / 2);
        hub.translate(0, h, 0);

        return mergeGeos([body, hub]);
    }

    function createHingeGeo() {
        // Print-In-Place шарнир: ось вдоль Z, плоское основание на столе, зазор 0.45 мм, 0 пересечений
        const parts = [];
        const cy = 3.2, rBarrel = 3.2, rPin = 1.55, rHole = 2.00, leafH = 4.0;

        // Профиль наружного кулачка с плоской подошвой на y=0 и 45° фасками
        const makeBarrelPts = (connectLeft, connectRight) => {
            const pts = [];
            for (let i = 0; i <= 24; i++) {
                const a = -Math.PI * 0.25 + (i / 24) * (Math.PI * 1.5);
                const x = rBarrel * Math.cos(a);
                const y = Math.max(0, cy + rBarrel * Math.sin(a));
                pts.push([x, y]);
            }
            pts.push([-2.2, 0]);
            if (connectLeft) {
                pts.push([-19.0, 0], [-19.0, leafH], [-2.5, leafH]);
            }
            if (connectRight) {
                pts.unshift([2.5, leafH], [19.0, leafH], [19.0, 0], [2.2, 0]);
            } else {
                pts.unshift([2.2, 0]);
            }
            return pts;
        };

        // Профиль каплевидного отверстия (верх под 45° для печати без провисания)
        const holePts = [];
        for (let i = 0; i < 28; i++) {
            const a = (i * Math.PI * 2) / 28;
            let x = rHole * Math.cos(a);
            let y = cy + rHole * Math.sin(a);
            if (Math.sin(a) > 0.707) y = cy + (rHole * 1.25 - Math.abs(x));
            holePts.push([x, y]);
        }

        // Профиль центральной оси
        const pinPts = [];
        for (let i = 0; i < 24; i++) {
            const a = (i * Math.PI * 2) / 24;
            pinPts.push([rPin * Math.cos(a), cy + rPin * Math.sin(a)]);
        }

        // 1. Задняя секция: z от -14 до -5.0 (левое крыло + замкнутый кулачок)
        const secBack = extrudeClipperPolys([makeBarrelPts(true, false), [[3.65, 0], [19.0, 0], [19.0, leafH], [3.65, leafH]]], null, 9.0);
        secBack.translate(0, 0, -14.0);
        parts.push(secBack);

        // 2. Зазор z от -5.0 до -4.6 (0.4 мм): крылья + центральный штифт
        const gap1 = extrudeClipperPolys([
            [[-19.0, 0], [-3.65, 0], [-3.65, leafH], [-19.0, leafH]],
            [[3.65, 0], [19.0, 0], [19.0, leafH], [3.65, leafH]],
            pinPts
        ], null, 0.4);
        gap1.translate(0, 0, -5.0);
        parts.push(gap1);

        // 3. Средняя секция: z от -4.6 до +4.6 (правое крыло с кулачком вокруг оси + левое крыло)
        const secMid = extrudeClipperPolys([
            [[-19.0, 0], [-3.65, 0], [-3.65, leafH], [-19.0, leafH]],
            makeBarrelPts(false, true),
            pinPts
        ], [holePts], 9.2);
        secMid.translate(0, 0, -4.6);
        parts.push(secMid);

        // 4. Зазор z от +4.6 до +5.0 (0.4 мм): крылья + центральный штифт
        const gap2 = extrudeClipperPolys([
            [[-19.0, 0], [-3.65, 0], [-3.65, leafH], [-19.0, leafH]],
            [[3.65, 0], [19.0, 0], [19.0, leafH], [3.65, leafH]],
            pinPts
        ], null, 0.4);
        gap2.translate(0, 0, 4.6);
        parts.push(gap2);

        // 5. Передняя секция: z от +5.0 до +14.0 (левое крыло + замкнутый кулачок)
        const secFront = extrudeClipperPolys([makeBarrelPts(true, false), [[3.65, 0], [19.0, 0], [19.0, leafH], [3.65, leafH]]], null, 9.0);
        secFront.translate(0, 0, 5.0);
        parts.push(secFront);

        return mergeGeos(parts);
    }

    function createBoltGeo() {
        // Реальная спиральная метрическая резьба М10x2.5: Болт + Гайка с внутренней спиральной резьбой (зазор 0.35 мм)
        const tris = [];
        const pushTri = (a, b, c) => tris.push(...a, ...b, ...c);
        const P = 2.5; // Шаг резьбы 2.5 мм
        const segs = 36;

        const threadWave = (y, th) => {
            const phase = (((y / P) - (th / (Math.PI * 2))) % 1 + 1) % 1;
            const tri = 1 - Math.abs(2 * phase - 1);
            return (Math.max(0.12, Math.min(0.88, tri)) - 0.12) / 0.76;
        };

        // 1. БОЛТ (центр X = -14, Z = 0): единая непрерывная поверхность от Y=0 до Y=23
        const bx = -14, bz = 0;
        const boltY = [0, 5.0];
        for (let y = 5.25; y <= 23.001; y += 0.25) boltY.push(Number(y.toFixed(3)));

        const boltRings = boltY.map((y, idx) => {
            const ring = [];
            for (let i = 0; i < segs; i++) {
                const th = (i * Math.PI * 2) / segs;
                let r;
                if (idx <= 1) {
                    // Шестигранная шляпка (под ключ 15 мм)
                    const sec = (th % (Math.PI / 3)) - Math.PI / 6;
                    r = 7.5 / Math.cos(sec);
                } else {
                    const taper = Math.min(1, (y - 5.0) / 1.5, (23.0 - y) / 1.5);
                    r = 3.85 + 1.05 * threadWave(y, th) * Math.max(0, taper);
                }
                ring.push([bx + Math.cos(th) * r, y, bz + Math.sin(th) * r]);
            }
            return ring;
        });

        // Шляпка (y = 0..5.0) и переходная ступенька на стержень (y = 5.0)
        const shaftStartRing = [];
        for (let i = 0; i < segs; i++) {
            const th = (i * Math.PI * 2) / segs;
            shaftStartRing.push([bx + Math.cos(th) * 3.85, 5.0, bz + Math.sin(th) * 3.85]);
        }

        const bLast = boltRings.length - 1;
        const bTopY = boltY[bLast];
        for (let i = 0; i < segs; i++) {
            const ni = (i + 1) % segs;
            // Дно шляпки (нормаль вниз)
            pushTri([bx, 0, bz], boltRings[0][i], boltRings[0][ni]);
            // Боковина шляпки
            pushTri(boltRings[0][i], boltRings[1][ni], boltRings[0][ni]);
            pushTri(boltRings[0][i], boltRings[1][i], boltRings[1][ni]);
            // Верхняя полка шляпки к стержню
            pushTri(boltRings[1][i], shaftStartRing[ni], boltRings[1][ni]);
            pushTri(boltRings[1][i], shaftStartRing[i], shaftStartRing[ni]);
            // Первый шаг стержня
            pushTri(shaftStartRing[i], boltRings[2][ni], shaftStartRing[ni]);
            pushTri(shaftStartRing[i], boltRings[2][i], boltRings[2][ni]);
            // Спиральная резьба стержня
            for (let s = 2; s < bLast; s++) {
                const p1 = boltRings[s][i], p2 = boltRings[s][ni], p3 = boltRings[s + 1][ni], p4 = boltRings[s + 1][i];
                pushTri(p1, p3, p2);
                pushTri(p1, p4, p3);
            }
            // Крышка верхушки болта
            pushTri([bx, bTopY, bz], boltRings[bLast][ni], boltRings[bLast][i]);
        }

        // 2. ГАЙКА (центр X = +14, Z = 0, высота Y = 0..8.0 мм) с внутренней спиральной резьбой
        const nx = 14, nz = 0, nutH = 8.0;
        const nutY = [];
        for (let y = 0; y <= nutH + 0.001; y += 0.25) nutY.push(Number(y.toFixed(3)));
        const nLast = nutY.length - 1;

        const nutOuter = nutY.map(y => {
            const ring = [];
            for (let i = 0; i < segs; i++) {
                const th = (i * Math.PI * 2) / segs;
                const sec = (th % (Math.PI / 3)) - Math.PI / 6;
                const r = 8.0 / Math.cos(sec);
                ring.push([nx + Math.cos(th) * r, y, nz + Math.sin(th) * r]);
            }
            return ring;
        });

        const nutInner = nutY.map(y => {
            const ring = [];
            for (let i = 0; i < segs; i++) {
                const th = (i * Math.PI * 2) / segs;
                const chamfer = Math.min(1, y / 1.0, (nutH - y) / 1.0);
                // Зазор 0.35 мм по радиусу (0.70 мм на диаметр) для легкого накручивания после печати
                const r = 4.20 + 1.05 * threadWave(y, th) + (1 - chamfer) * 0.65;
                ring.push([nx + Math.cos(th) * r, y, nz + Math.sin(th) * r]);
            }
            return ring;
        });

        for (let i = 0; i < segs; i++) {
            const ni = (i + 1) % segs;
            // Нижнее кольцо гайки (y = 0, нормаль вниз)
            pushTri(nutInner[0][i], nutOuter[0][i], nutOuter[0][ni]);
            pushTri(nutInner[0][i], nutOuter[0][ni], nutInner[0][ni]);
            // Верхнее кольцо гайки (y = nutH, нормаль вверх)
            pushTri(nutInner[nLast][i], nutOuter[nLast][ni], nutOuter[nLast][i]);
            pushTri(nutInner[nLast][i], nutInner[nLast][ni], nutOuter[nLast][ni]);

            for (let s = 0; s < nLast; s++) {
                // Наружные грани шестигранника (нормаль наружу)
                pushTri(nutOuter[s][i], nutOuter[s + 1][ni], nutOuter[s][ni]);
                pushTri(nutOuter[s][i], nutOuter[s + 1][i], nutOuter[s + 1][ni]);
                // Внутренняя спиральная резьба гайки (нормаль внутрь к оси отверстия)
                pushTri(nutInner[s][i], nutInner[s][ni], nutInner[s + 1][ni]);
                pushTri(nutInner[s][i], nutInner[s + 1][ni], nutInner[s + 1][i]);
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
        geo.computeVertexNormals();
        return geo;
    }

    const TEXT_FONT = {
        '0': ['111', '101', '101', '101', '111'],
        '1': ['010', '110', '010', '010', '111'],
        '2': ['111', '001', '111', '100', '111'],
        '3': ['111', '001', '111', '001', '111'],
        '4': ['101', '101', '111', '001', '001'],
        '5': ['111', '100', '111', '001', '111'],
        '6': ['111', '100', '111', '101', '111'],
        '7': ['111', '001', '011', '010', '010'],
        '8': ['111', '101', '111', '101', '111'],
        '9': ['111', '101', '111', '001', '111'],
        '.': ['0', '0', '0', '0', '1'],
        '-': ['000', '000', '111', '000', '000'],
        'R': ['110', '101', '110', '101', '101'],
        'X': ['101', '101', '010', '101', '101'],
        'Y': ['101', '101', '010', '010', '010'],
        ' ': ['00', '00', '00', '00', '00']
    };

    function createTextGeo(text, px, depth) {
        if (typeof ClipperLib === 'undefined') return null;
        const rects = [];
        let cx = 0;
        String(text).toUpperCase().split('').forEach(ch => {
            const g = TEXT_FONT[ch] || TEXT_FONT[' '];
            for (let r = 0; r < 5; r++) {
                for (let c = 0; c < g[r].length; c++) {
                    if (g[r][c] !== '1') continue;
                    rects.push([
                        [(cx + c) * px, (4 - r) * px],
                        [(cx + c + 1) * px, (4 - r) * px],
                        [(cx + c + 1) * px, (5 - r) * px],
                        [(cx + c) * px, (5 - r) * px]
                    ]);
                }
            }
            cx += g[0].length + 1;
        });
        if (rects.length === 0) return null;
        const offX = ((cx - 1) * px) / 2, offY = (5 * px) / 2;
        const centered = rects.map(poly => poly.map(([x, y]) => [x - offX, y - offY]));
        return extrudeClipperPolys(centered, null, depth);
    }

    function labelGeo(text, px, depth, mode, x, y, z) {
        const g = createTextGeo(text, px, depth);
        if (!g) return null;
        if (mode === 'top') g.rotateX(-Math.PI / 2);
        else if (mode === 'side') g.rotateY(Math.PI / 2);
        g.translate(x, y, z);
        return g;
    }

    function createTempTowerGeo(temps) {
        // Монолитная температурная башня: единый контур всех 5 этажей с мостами 20 мм, нависаниями 45°/55° и конусами
        const list = temps || [230, 220, 210, 200, 190];
        const parts = [];

        // 1. Основание (y от 0 до 3.2 мм)
        const base = new THREE.BoxGeometry(44, 3.2, 16);
        base.translate(0, 1.6, 0);
        parts.push(base);

        // 2. Единое тело всех 5 этажей (y от 3.2 до 53.2 мм, глубина Z от -5 до +5 мм)
        const outerBlock = [[-20, 3.2], [20, 3.2], [20, 53.2], [-20, 53.2]];
        const holes = [];

        for (let t = 0; t < 5; t++) {
            const y0 = 3.2 + t * 10.0;
            // Окно этажа: справа нависание 45°, слева нависание 55°, сверху чистый мост 12 мм
            holes.push([
                [-11.0, y0],
                [11.0, y0],
                [11.0, y0 + 3.2],
                [6.0, y0 + 8.2],
                [-5.3, y0 + 8.2],
                [-11.0, y0 + 4.2]
            ]);
            // Боковые канавки на границе этажей для проверки межслойной спекаемости на излом
            if (t > 0) {
                holes.push([[-20.5, y0 - 0.4], [-19.2, y0 - 0.4], [-19.2, y0 + 0.4], [-20.5, y0 + 0.4]]);
                holes.push([[19.2, y0 - 0.4], [20.5, y0 - 0.4], [20.5, y0 + 0.4], [19.2, y0 + 0.4]]);
            }
            // Конус проверки ретракта (стоит на полу окна y0, не пересекаясь со стенками)
            parts.push(createLatheGeo([[1.6, y0], [0.3, y0 + 5.0]], 20, 2.5, 0));

            // Рельефная температура этажа на передней грани левой стойки (Z от 5.0 до 5.6 мм)
            const lab = labelGeo(String(list[t]), 0.7, 0.6, 'front', -15.5, y0 + 5.0, 5.0);
            if (lab) parts.push(lab);
        }

        const towerBody = extrudeClipperPolys([outerBlock], holes, 10.0);
        towerBody.translate(0, 0, -5.0);
        parts.push(towerBody);

        return mergeGeos(parts);
    }

    function createRetractionTowerGeo(labels) {
        const list = labels || ['0.4', '0.6', '0.8'];
        const base = new THREE.BoxGeometry(48, 3.0, 18);
        base.translate(0, 1.5, 0);
        const parts = [base];

        // Единый непрерывный профиль конической башни (y от 3.0 до 33.0 мм — 0 внутренних пересечений!)
        const pillarProfile = [
            [3.2, 3.0],
            [2.3, 12.6],
            [2.7, 13.0], // Кольцо смены ретракта на Z = 13.0 мм
            [2.1, 13.4],
            [1.7, 22.6],
            [2.1, 23.0], // Кольцо смены ретракта на Z = 23.0 мм
            [1.5, 23.4],
            [0.45, 33.0]
        ];

        parts.push(createLatheGeo(pillarProfile, 32, -14, 0));
        parts.push(createLatheGeo(pillarProfile, 32, 14, 0));

        const l1 = labelGeo(list[0], 0.65, 0.6, 'top', -14, 3.0, 5.5);
        const l2 = labelGeo(list[1], 0.65, 0.6, 'top', 0, 3.0, 5.5);
        const l3 = labelGeo(list[2], 0.65, 0.6, 'top', 14, 3.0, 5.5);
        if (l1) parts.push(l1);
        if (l2) parts.push(l2);
        if (l3) parts.push(l3);

        return mergeGeos(parts);
    }

    function createOverhangTestGeo() {
        // Реальный тест нависаний (30°, 45°, 55°, 65°, 75°) и 4 мостов:
        // Каждая консоль растет монолитно от базы в плоскости YZ (повернута через rotateY(Math.PI / 2))
        const parts = [];
        const base = new THREE.BoxGeometry(78, 2.4, 28);
        base.translate(0, 1.2, 0);
        parts.push(base);

        const angles = [30, 45, 55, 65, 75];
        const xPositions = [-28, -14, 0, 14, 28];
        const armW = 9.0;
        const topDeckPolys = [
            // Непрерывная задняя балка-мост через все 5 колонн (образует 4 моста над пролетами)
            [[-32.5, -12.0], [32.5, -12.0], [32.5, -3.0], [-32.5, -3.0]]
        ];

        for (let i = 0; i < 5; i++) {
            const ang = angles[i];
            const xp = xPositions[i];
            const tanA = Math.tan((ang * Math.PI) / 180);

            // Консоль растет от y=2.4 до y=16.4 (14 мм высоты). Максимальный вылет вперед до Z = +9.0 мм
            const maxDz = 11.5;
            const slopeH = Math.min(14.0, maxDz / tanA);
            const yStart = Number((16.4 - slopeH).toFixed(2));
            const zTip = Number((-2.5 + slopeH * tanA).toFixed(2));

            // В локальных координатах Shape: x_shape = -Z_мира, y_shape = Y_мира.
            // После rotateY(Math.PI / 2): X_мира = z_экструзии, Y_мира = y_shape, Z_мира = -x_shape!
            const polyZY = [
                [12.0, 2.4],
                [2.5, 2.4],
                [2.5, yStart],
                [-zTip, 16.4],
                [12.0, 16.4]
            ];
            const armGeo = extrudeClipperPolys([polyZY], null, armW);
            armGeo.rotateY(Math.PI / 2);
            armGeo.translate(xp - armW * 0.5, 0, 0);
            parts.push(armGeo);

            // Верхняя площадка консоли (y от 16.4 до 18.0 мм)
            topDeckPolys.push([
                [xp - armW * 0.5, -12.0],
                [xp + armW * 0.5, -12.0],
                [xp + armW * 0.5, zTip],
                [xp - armW * 0.5, zTip]
            ]);

            // Маркировка угла на базе перед каждой консолью (y от 2.4 до 3.0 мм)
            const lab = labelGeo(String(ang), 0.75, 0.6, 'top', xp, 2.4, 10.2);
            if (lab) parts.push(lab);
        }

        // Единая верхняя плита (y от 16.4 до 18.0 мм), связывающая вершины нависаний и мосты
        const topDeck = extrudeClipperPolys(topDeckPolys, null, 1.6);
        topDeck.rotateX(-Math.PI / 2);
        topDeck.translate(0, 16.4, 0);
        parts.push(topDeck);

        return mergeGeos(parts);
    }

    function createResonanceGeo() {
        // Полая башня теста резонансов и звона (Input Shaper / Ringing Tower) с вертикальными ступеньками-канавками
        const parts = [];
        const base = new THREE.BoxGeometry(36, 2.0, 36);
        base.translate(0, 1.0, 0);
        parts.push(base);

        // Внешний контур 28x28 мм с резкими 90° вертикальными канавками на гранях X и Y для возбуждения резонанса
        const S = 14.0, T = 2.0, N = 12.8;
        const outerPts = [
            [-S, -S],
            [-4, -S], [-4, -N], [-2, -N], [-2, -S],
            [2, -S],  [2, -N],  [4, -N],  [4, -S],
            [S, -S],
            [S, -4],  [N, -4],  [N, -2],  [S, -2],
            [S, 2],   [N, 2],   [N, 4],   [S, 4],
            [S, S],
            [4, S],   [4, N],   [2, N],   [2, S],
            [-2, S],  [-2, N],  [-4, N],  [-4, S],
            [-S, S],
            [-S, 4],  [-N, 4],  [-N, 2],  [-S, 2],
            [-S, -2], [-N, -2], [-N, -4], [-S, -4]
        ];
        const innerHole = [
            [-(S - T), -(S - T)],
            [ (S - T), -(S - T)],
            [ (S - T),  (S - T)],
            [-(S - T),  (S - T)]
        ];

        const tower = extrudeClipperPolys([outerPts], [innerHole], 42.0);
        tower.rotateX(-Math.PI / 2);
        tower.translate(0, 2.0, 0);
        parts.push(tower);

        const labY = labelGeo('Y', 1.2, 0.6, 'front', 0, 23, 14.0);
        const labX = labelGeo('X', 1.2, 0.6, 'side', 14.0, 23, 0);
        if (labY) parts.push(labY);
        if (labX) parts.push(labX);

        return mergeGeos(parts);
    }

    function createBedLevelingGeo() {
        // 5 квадратов 30x30 мм + связующий контур, объединенные через Clipper в единый слой 0.20 мм без самопересечений
        const polys = [];
        const pad = 15;
        const coords = [[-75, -75], [75, -75], [75, 75], [-75, 75], [0, 0]];
        coords.forEach(([cx, cz]) => {
            polys.push([
                [cx - pad, cz - pad],
                [cx + pad, cz - pad],
                [cx + pad, cz + pad],
                [cx - pad, cz + pad]
            ]);
        });
        // Продольная и поперечная связующие дорожки шириной 1.6 мм
        polys.push([[-75, -0.8], [75, -0.8], [75, 0.8], [-75, 0.8]]);
        polys.push([[-0.8, -75], [0.8, -75], [0.8, 75], [-0.8, 75]]);

        const geo = extrudeClipperPolys(polys, null, 0.2);
        geo.rotateX(-Math.PI / 2);
        return geo;
    }

    function createBenchyFallbackGeo() {
        // Калибровочный кораблик из строго послойных секций по Y (0 пересекающихся объёмов)
        const parts = [];

        // 1. Плоское днище (y от 0 до 2.0 мм)
        const bottom = extrudeClipperPolys([[[-20, -7], [8, -7], [18, 0], [8, 7], [-20, 7]]], null, 2.0);
        bottom.rotateX(-Math.PI / 2);
        parts.push(bottom);

        // 2. Основной корпус (y от 2.0 до 10.0 мм)
        const hull = extrudeClipperPolys([[[-22, -9], [10, -9], [24, 0], [10, 9], [-22, 9]]], null, 8.0);
        hull.rotateX(-Math.PI / 2);
        hull.translate(0, 2.0, 0);
        parts.push(hull);

        // 3. Фальшборт кормы и основание рубки (y от 10.0 до 13.0 мм)
        const deckWall = extrudeClipperPolys(
            [[[-22, -9], [8, -9], [20, 0], [8, 9], [-22, 9]]],
            [[[-19.5, -6.5], [-7, -6.5], [-7, 6.5], [-19.5, 6.5]]],
            3.0
        );
        deckWall.rotateX(-Math.PI / 2);
        deckWall.translate(0, 10.0, 0);
        parts.push(deckWall);

        // 4. Стойки каюты (y от 13.0 до 22.0 мм)
        const pillars = extrudeClipperPolys([
            [[-5.5, -6.5], [-2.5, -6.5], [-2.5, -3.5], [-5.5, -3.5]],
            [[ 2.5, -6.5], [ 5.5, -6.5], [ 5.5, -3.5], [ 2.5, -3.5]],
            [[-5.5,  3.5], [-2.5,  3.5], [-2.5,  6.5], [-5.5,  6.5]],
            [[ 2.5,  3.5], [ 5.5,  3.5], [ 5.5,  6.5], [ 2.5,  6.5]]
        ], null, 9.0);
        pillars.rotateX(-Math.PI / 2);
        pillars.translate(0, 13.0, 0);
        parts.push(pillars);

        // 5. Крыша каюты с мостом (y от 22.0 до 24.4 мм)
        const roof = extrudeClipperPolys([[[-7, -7.5], [7.5, -7.5], [7.5, 7.5], [-7, 7.5]]], null, 2.4);
        roof.rotateX(-Math.PI / 2);
        roof.translate(0, 22.0, 0);
        parts.push(roof);

        // 6. Труба на крыше (y от 24.4 до 33.4 мм)
        parts.push(createLatheGeo([
            [2.4, 24.4],
            [2.4, 31.8],
            [2.9, 32.2],
            [2.9, 33.4]
        ], 24, 2.0, 0));

        return mergeGeos(parts);
    }

    function createFlowTestGeo() {
        // Калибровочный куб потока 20x20x20 мм: дно 1.2 мм + стенка 0.80 мм (ровно 2 линии по 0.40 мм)
        const outer = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
        const inner = [[-9.2, -9.2], [9.2, -9.2], [9.2, 9.2], [-9.2, 9.2]];

        const bottom = extrudeClipperPolys([outer], null, 1.2);
        bottom.rotateX(-Math.PI / 2);

        const walls = extrudeClipperPolys([outer], [inner], 18.8);
        walls.rotateX(-Math.PI / 2);
        walls.translate(0, 1.2, 0);

        return mergeGeos([bottom, walls]);
    }

    function loadBuiltinModel(type, silent = false) {
        const prof = (PROFILES[state.material] && PROFILES[state.material][state.mode]) || { nozzleTemp: 210 };
        const cap = (state.expert && state.expert.hotendType === 'ceramic') ? 300 : 260;
        const tBase = Math.round(prof.nozzleTemp / 5) * 5;
        // Этажи снизу вверх: самый горячий внизу, шаг 10°C
        const towerTemps = [0, 1, 2, 3, 4].map(i => Math.max(170, Math.min(cap, tBase + 20 - i * 10)));
        const retractVals = [0.4, 0.6, 0.8];

        const catalog = {
            rocket:           { make: createRocketGeo,          name: 'Salim_Calib_Rocket.stl' },
            benchy:           { make: createBenchyFallbackGeo,  name: '3DBenchy_Calibration.stl' },
            boat:             { make: createBenchyFallbackGeo,  name: '3DBenchy_Calibration.stl' },
            xyz_cube:         { make: createCubeGeo,            name: 'XYZ_Calibration_Cube_20mm.stl' },
            cube:             { make: createCubeGeo,            name: 'XYZ_Calibration_Cube_20mm.stl' },
            temp_tower:       { make: () => createTempTowerGeo(towerTemps), name: `Temp_Tower_${towerTemps[4]}-${towerTemps[0]}C.stl` },
            retraction_tower: { make: () => createRetractionTowerGeo(retractVals.map(v => 'R' + v.toFixed(1))), name: 'Retraction_Test_0.4-0.8mm.stl' },
            overhang_test:    { make: createOverhangTestGeo,    name: 'Overhang_Bridge_Test.stl' },
            bed_leveling_test:{ make: createBedLevelingGeo,     name: 'Bed_Leveling_5Point_Test.stl' },
            flow_test_cube:   { make: createFlowTestGeo,        name: 'Flow_Test_ThinWall_Cube_20mm.stl' },
            resonance_tower:  { make: createResonanceGeo,       name: 'Resonance_Tower.stl' },
            gear:             { make: createGearGeo,            name: 'Tolerance_Involute_Gear.stl' },
            hinge:            { make: createHingeGeo,           name: 'Clearance_PrintInPlace_Hinge.stl' },
            bolt:             { make: createBoltGeo,            name: 'Bolt_Nut_M10_Tolerance.stl' }
        };
        const entry = catalog[type];
        if (!entry) { showToast(`Неизвестная фигура: ${type}`); return; }

        // План теста: что менять по высоте при нарезке (применяется в marlin-safe.js)
        let plan = null;
        let planNote = '';
        if (type === 'temp_tower') {
            plan = { h: 0, steps: towerTemps.map((t, i) => ({ z0: i === 0 ? 0 : 3.2 + i * 10, temp: t })) };
            planNote = `${towerTemps[0]} → ${towerTemps[4]}°C снизу вверх`;
        } else if (type === 'retraction_tower') {
            plan = { h: 0, steps: [{ z0: 0, retract: retractVals[0] }, { z0: 13.0, retract: retractVals[1] }, { z0: 23.0, retract: retractVals[2] }] };
            planNote = `ретракт ${retractVals.join(' / ')} мм снизу вверх`;
        }

        const geom = entry.make();
        const result = setModelGeometry(geom, entry.name, false);
        geom.dispose();
        if (!result || result.success === false) {
            showToast((result && result.error) || 'Ошибка загрузки фигуры');
            return;
        }
        if (plan && activeMesh) {
            activeMesh.geometry.computeBoundingBox();
            const bb = activeMesh.geometry.boundingBox;
            plan.h = bb.max.y - bb.min.y;
            activeMesh.userData.testPlan = plan;
        }
        SalimLoader.reset();
        if (!silent) showToast(planNote ? `Тест: ${planNote}` : `Загружен тест: ${entry.name}`);
    }

    function enforceBuildVolume(geometry) {
        if (!geometry.attributes.position) throw new Error('Модель без position');
        const pos = geometry.attributes.position;
        const rawCount = pos.count;
        if (rawCount % 3 !== 0) throw new Error(`Повреждено: ${rawCount}`);
        const cleanPos = [];
        for (let i = 0; i < rawCount; i += 3) {
            const x0 = pos.getX(i), y0 = pos.getY(i), z0 = pos.getZ(i);
            const x1 = pos.getX(i + 1), y1 = pos.getY(i + 1), z1 = pos.getZ(i + 1);
            const x2 = pos.getX(i + 2), y2 = pos.getY(i + 2), z2 = pos.getZ(i + 2);
            if (!isFinite(x0) || !isFinite(y0) || !isFinite(z0) || !isFinite(x1) || !isFinite(y1) || !isFinite(z1) || !isFinite(x2) || !isFinite(y2) || !isFinite(z2)) continue;
            cleanPos.push(x0, y0, z0, x1, y1, z1, x2, y2, z2);
        }
        if (cleanPos.length === 0) throw new Error('Геометрия пуста');
        if (cleanPos.length !== rawCount * 3) geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cleanPos), 3));
        const triCount = Math.floor(geometry.attributes.position.count / 3);
        if (triCount > PRINT_LIMITS.maxTriangles) throw new Error(`Слишком сложная: ${triCount}`);
        geometry.computeBoundingBox();
        const box = geometry.boundingBox;
        const w = box.max.x - box.min.x, d = box.max.z - box.min.z, h = box.max.y - box.min.y;
        if (w <= 0.001 || d <= 0.001 || h <= 0.001) throw new Error('Нулевые размеры');
        const margin = PRINT_LIMITS.autoFitMarginMM;
        const fitScale = Math.min((PRINTER_SPECS.bedX - margin) / w, (PRINTER_SPECS.bedY - margin) / d, (PRINTER_SPECS.bedZ - margin) / h, 1.0);
        let scalePct = Math.round(fitScale * 100);
        if (scalePct < 5) scalePct = 5;
        return { triCount, wasScaled: fitScale < 0.995, scalePct };
    }

    function setModelGeometry(geometry, filename, appendToBed = false) {
        const cleanGeo = geometry.index ? geometry.toNonIndexed() : geometry.clone();
        cleanGeo.computeVertexNormals();
        let fitInfo;
        try { fitInfo = enforceBuildVolume(cleanGeo); }
        catch (err) { return { success: false, error: err.message }; }
        if (!appendToBed) {
            bedModels.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
            bedModels = []; activeMesh = null;
        }
        const vertexCount = cleanGeo.attributes.position.count;
        if (!cleanGeo.userData.originalColors) {
            const posAttr = cleanGeo.attributes.position;
            cleanGeo.computeBoundingBox();
            const bbox = cleanGeo.boundingBox;
            const minY = bbox ? bbox.min.y : 0;
            const maxY = bbox ? bbox.max.y : 10;
            const rangeY = Math.max(0.1, maxY - minY);
            const origCols = new Float32Array(vertexCount * 3);
            for (let i = 0; i < vertexCount; i++) {
                const normY = (posAttr.getY(i) - minY) / rangeY;
                origCols[i * 3] = Math.min(1.0, 0.04 + normY * 0.10);
                origCols[i * 3 + 1] = Math.min(1.0, 0.68 + normY * 0.18);
                origCols[i * 3 + 2] = Math.min(1.0, 0.85 + normY * 0.10);
            }
            cleanGeo.userData.originalColors = origCols;
        }
        const colorArray = new Float32Array(cleanGeo.userData.originalColors);
        cleanGeo.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.35, metalness: 0.15, side: THREE.DoubleSide });
        activeMesh = new THREE.Mesh(cleanGeo, mat);
        activeMesh.userData.name = filename;
        scene.add(activeMesh);
        bedModels.push(activeMesh);
        state.modelName = filename;
        state.scale = fitInfo.scalePct;
        state.posX = 0; state.posY = 0;
        invalidateSlicedGcode();
        const f = state.scale / 100;
        activeMesh.scale.set(f, f, f);
        const scSlider = document.getElementById('scale-slider'), scDisp = document.getElementById('scale-value-display');
        const inpX = document.getElementById('inp-pos-x'), inpY = document.getElementById('inp-pos-y');
        if (scSlider) scSlider.value = state.scale;
        if (scDisp) scDisp.textContent = `${state.scale}%`;
        if (inpX) inpX.value = 0; if (inpY) inpY.value = 0;
alignMeshToBedSurface();
        selectMesh(activeMesh, true);
        setViewportMode('model');
        if (controls && typeof controls.focusOnModel === 'function') controls.focusOnModel(activeMesh);
        return { success: true, fitInfo };
    }

let _isAppendingModel = false;
    function triggerModelImport() {
        _isAppendingModel = false;
        document.getElementById('model-file-input')?.click();
    }
    function triggerAddModelImport() {
        _isAppendingModel = true;
        document.getElementById('model-file-input')?.click();
    }

    function initFileImportListeners() {
        const modelInput = document.getElementById('model-file-input');
        if (modelInput) {
            modelInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                if (file.size > PRINT_LIMITS.maxFileSizeMB * 1024 * 1024) {
                    showToast(`Файл слишком большой (>${PRINT_LIMITS.maxFileSizeMB} МБ)`); return;
                }
                const ext = file.name.split('.').pop().toLowerCase();
                try {
                    if (ext === 'gcode' || ext === 'gco') {
                        const txt = await file.text();
                        const parsed = parseGCodeText(txt);
                        if (!parsed.layers.length) {
                            showToast("В файле G-кода нет траекторий");
                            modelInput.value = '';
                            return;
                        }
                        bedModels.forEach(m => { scene.remove(m); if (m.geometry) m.geometry.dispose(); if (m.material) m.material.dispose(); });
                        bedModels = [];
                        activeMesh = null;

                        state.modelName = file.name;
                        state.generatedGcode = parsed.rawGcode;
                        state.gcodeChunks = [parsed.rawGcode];
                        state.slicedLayers = parsed.layers;

await buildGcodePreview(parsed.layers);
                        setViewportMode('gcode');
                        updateInlineGcodeViewer();
                        updateDimensionsUI();
                        if (controls && typeof controls.focusOnModel === 'function') controls.focusOnModel();
                        const gs = computeGcodeStats(txt, parsed.layers.length);
                        state.lastSliceStats = null;
                        state.safetyReport = null;
                        document.getElementById('safety-report')?.remove();
                        const statRows = document.getElementById('slice-stats-rows');
                        if (statRows) statRows.innerHTML = '';
                        updateSliceSummaryUI(Math.max(15, Math.round(gs.secs)), gs.grams, gs.meters, parsed.layers.length);
                        showToast(`G-код загружен: ${parsed.layers.length} слоёв • ${gs.grams.toFixed(1)} г`);
                        modelInput.value = '';
                        return;
                    }

                    if (state.generatedGcode || (state.slicedLayers && state.slicedLayers.length > 0)) {
                        const delOldGcode = await new Promise(resolve => {
                            showConfirmDialog({
                                title: "Старый G-код",
                                message: "На экране есть нарезанный G-код. Удалить его и загрузить новую модель?",
                                confirmText: "Да, удалить",
                                cancelText: "Нет",
                                type: "amber",
                                icon: "fa-trash-can"
                            }, () => resolve(true), () => resolve(false));
                        });
                        if (!delOldGcode) { modelInput.value = ''; return; }
                        clearSlicedGcodeState();
                    }
                    let geo;
                    if (['stl', '3mf', 'obj', 'ply'].includes(ext)) await SalimLoader.begin(file.name, file.size);
                    if (ext === 'stl') {
                        showToast("Чтение STL в фоновом потоке...");
                        geo = await parseSTLInWorker(await file.arrayBuffer(), PRINT_LIMITS.maxTriangles);
                        if (!geo) geo = parseSTLBuffer(await file.arrayBuffer());
                    }
                    else if (ext === '3mf') { const buf = await file.arrayBuffer(); geo = await parse3MFBuffer(buf); }
                    else if (ext === 'obj') { const txt = await file.text(); geo = parseOBJText(txt); }
                    else if (ext === 'ply') { const buf = await file.arrayBuffer(); geo = parsePLYBuffer(buf); }
                    else { showToast("Форматы: .STL, .3MF, .OBJ, .PLY, .GCODE"); modelInput.value = ''; return; }
                    await SalimLoader.stage(80, 'Подготовка модели...');
                    const result = setModelGeometry(geo, file.name, _isAppendingModel);
                    SalimLoader.end(file.size, geo, result);
                    if (_isAppendingModel && bedModels.length > 1) autoArrangeBedModels('tetris', true);
                    _isAppendingModel = false;
                    if (!result || result.success === false) showToast((result && result.error) || 'Ошибка загрузки');
                    else if (result.fitInfo && result.fitInfo.wasScaled) showToast(`Уменьшено до ${result.fitInfo.scalePct}%`);
                    else showToast(`Загружено: ${file.name}`);
                                } catch (err) {
                    console.error(err);
                    const errorMsg = err && err.message ? err.message : "Неизвестная ошибка";
                    SalimLoader.fail();
                    showToast("Ошибка: " + errorMsg);
                }
modelInput.value = '';
            });
        }
        const profInput = document.getElementById('profile-file-input');
        if (profInput) {
            profInput.addEventListener('change', async (e) => {
                const file = e.target.files[0];
                if (!file) return;
                try {
                    const data = JSON.parse(await file.text());
                    if (data.PROFILES && typeof data.PROFILES === 'object') {
                        for (const mat of Object.keys(DEFAULT_PROFILES)) {
                            for (const mode of Object.keys(DEFAULT_PROFILES[mat])) {
                                const incoming = data.PROFILES[mat] && data.PROFILES[mat][mode];
                                PROFILES[mat][mode] = Object.assign({}, DEFAULT_PROFILES[mat][mode], (incoming && typeof incoming === 'object') ? incoming : {});
                            }
                        }
                    }
                    if (data.expert) Object.assign(state.expert, data.expert);
                    syncProfileSummaryUI(false);
                    openProfileDetailsModal();
                    showToast(`Профиль загружен: ${file.name}`);
                } catch (err) {
                    showToast("Ошибка чтения файла профиля");
                }
                profInput.value = '';
            });
        }
    }
