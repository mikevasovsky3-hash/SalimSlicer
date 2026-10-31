/* ====================================================================
 * 8. THEMES (цветовые темы оформления)
 * Подключается в <head> сразу после tailwind.js
 * ==================================================================== */
(function (root) {
    'use strict';

    const KEY = 'salim_theme_v1';
    const THEMES = [
        { id: 'cyan',     name: 'Циан',    accent: 190, bg: 217, sat: 33 },
        { id: 'emerald',  name: 'Изумруд', accent: 152, bg: 165, sat: 26 },
        { id: 'violet',   name: 'Фиолет',  accent: 262, bg: 256, sat: 30 },
        { id: 'amber',    name: 'Янтарь',  accent: 38,  bg: 28,  sat: 22 },
        { id: 'rose',     name: 'Роза',    accent: 340, bg: 335, sat: 24 },
        { id: 'ocean',    name: 'Океан',   accent: 212, bg: 222, sat: 42 },
        { id: 'graphite', name: 'Графит',  accent: 200, bg: 220, sat: 7 }
    ];
    const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
    const L_BG = { 50: 98, 100: 95, 200: 91, 300: 84, 400: 65, 500: 47, 600: 35, 700: 25, 800: 17, 900: 11, 950: 6 };
    const L_AC = { 50: 96, 100: 91, 200: 83, 300: 73, 400: 61, 500: 51, 600: 43, 700: 35, 800: 28, 900: 22, 950: 12 };

    /* ---------- Tailwind: палитры берут цвет из CSS-переменных (с поддержкой прозрачности) ---------- */
    const pal = (name) => {
        const o = {};
        SHADES.forEach(s => { o[s] = `rgb(var(--${name}-${s}) / <alpha-value>)`; });
        return o;
    };
    root.tailwind = root.tailwind || {};
    root.tailwind.config = {
        theme: { extend: { colors: { slate: pal('slate'), cyan: pal('cyan'), sky: pal('sky'), blue: pal('blue') } } }
    };

    /* ---------- Цвет ---------- */
    function hsl(h, s, l) {
        h = ((h % 360) + 360) % 360; s /= 100; l /= 100;
        const k = (n) => (n + h / 30) % 12;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
        return [Math.round(255 * f(0)), Math.round(255 * f(8)), Math.round(255 * f(4))];
    }
    const hex = (rgb) => '#' + rgb.map(v => v.toString(16).padStart(2, '0')).join('');

    let currentId = 'cyan';
    try {
        const saved = root.localStorage.getItem(KEY);
        if (saved && THEMES.some(t => t.id === saved)) currentId = saved;
    } catch (e) { /* localStorage недоступен */ }

    /* ---------- Дополнительные стили (то, что задано в styles.css жёстко) ---------- */
    const styleEl = document.createElement('style');
    styleEl.id = 'salim-theme-style';
    styleEl.textContent = `
        body { background-color: rgb(var(--slate-950)); }
        #viewport-section { background-color: rgb(var(--view-bg)) !important; }
        .glass-panel { background-color: rgb(var(--slate-950) / 0.78) !important; }
        .tab-active { background-color: rgb(var(--cyan-500)) !important; color: rgb(var(--slate-950)) !important; }
        .mode-active { border-color: rgb(var(--cyan-400)) !important; }
    `;
    document.head.appendChild(styleEl);

    function applyTheme(id) {
        const t = THEMES.find(x => x.id === id) || THEMES[0];
        currentId = t.id;
        const st = document.documentElement.style;
        const setVar = (name, rgb) => st.setProperty(name, rgb.join(' '));

        SHADES.forEach(s => {
            const bgSat = s >= 300 ? t.sat * 0.55 : t.sat;
            setVar(`--slate-${s}`, hsl(t.bg, bgSat, L_BG[s]));
            setVar(`--cyan-${s}`, hsl(t.accent, 88, L_AC[s]));
            setVar(`--sky-${s}`, hsl(t.accent + 10, 86, L_AC[s]));
            setVar(`--blue-${s}`, hsl(t.accent + 25, 84, L_AC[s]));
        });
        const viewRgb = hsl(t.bg, Math.min(55, t.sat + 12), 7);
        setVar('--view-bg', viewRgb);

        try { root.localStorage.setItem(KEY, t.id); } catch (e) { /* ignore */ }

        try {
            if (typeof scene !== 'undefined' && scene && scene.background) {
                scene.background.set(hex(viewRgb));
                if (typeof buildBed === 'function') buildBed();
                if (typeof triggerSceneRender === 'function') triggerSceneRender();
            }
        } catch (e) { /* сцена ещё не создана */ }

        renderMenu();
    }

    /* ---------- Кнопка и меню выбора темы ---------- */
    function renderMenu() {
        const grid = document.getElementById('theme-menu-grid');
        if (!grid) return;
        grid.innerHTML = THEMES.map(t => {
            const bgHex = hex(hsl(t.bg, t.sat, 11));
            const acHex = hex(hsl(t.accent, 88, 55));
            const active = t.id === currentId;
            return `<button type="button" data-theme="${t.id}" class="flex flex-col items-center gap-1 p-1.5 rounded-xl border ${active ? 'border-cyan-400 bg-cyan-500/15' : 'border-slate-700 bg-slate-950'} transition active:scale-95">
                <span class="w-9 h-9 rounded-full border-2 ${active ? 'border-white' : 'border-slate-600'}" style="background: linear-gradient(135deg, ${bgHex} 50%, ${acHex} 50%)"></span>
                <span class="text-[9px] font-bold text-slate-200">${t.name}</span>
            </button>`;
        }).join('');
    }

    function buildUI() {
        const helpBtn = document.querySelector('header button[onclick="openHelpModal()"]');
        if (!helpBtn || document.getElementById('btn-theme')) return;

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'btn-theme';
        btn.title = 'Тема оформления';
        btn.className = 'p-1.5 sm:px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1 transition active:scale-95';
        btn.innerHTML = '<i class="fa-solid fa-palette text-cyan-400 text-sm sm:text-xs"></i><span class="hidden xl:inline">Тема</span>';
        helpBtn.parentNode.insertBefore(btn, helpBtn);

        const menu = document.createElement('div');
        menu.id = 'theme-menu';
        menu.className = 'hidden fixed top-14 right-2 z-[80] w-64 p-3 rounded-2xl bg-slate-900 border border-slate-700 shadow-2xl space-y-2';
        menu.innerHTML = `
            <div class="flex items-center justify-between">
                <span class="text-xs font-black text-white flex items-center gap-1.5"><i class="fa-solid fa-palette text-cyan-400"></i> Цветовая тема</span>
                <button type="button" id="theme-menu-close" class="text-slate-400 hover:text-white"><i class="fa-solid fa-xmark"></i></button>
            </div>
            <div id="theme-menu-grid" class="grid grid-cols-4 gap-1.5"></div>`;
        document.body.appendChild(menu);

        btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
        document.getElementById('theme-menu-close').addEventListener('click', () => menu.classList.add('hidden'));
        menu.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-theme]');
            if (b) applyTheme(b.getAttribute('data-theme'));
        });
        document.addEventListener('pointerdown', (e) => {
            if (!menu.classList.contains('hidden') && !menu.contains(e.target) && !btn.contains(e.target)) menu.classList.add('hidden');
        });

        renderMenu();
        // 3D-сцена создаётся в ui.js позже, поэтому применяем тему ещё раз уже после неё
        setTimeout(() => applyTheme(currentId), 60);
    }

    applyTheme(currentId);
    root.SalimThemes = { THEMES, applyTheme };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', buildUI);
    else buildUI();
})(window);