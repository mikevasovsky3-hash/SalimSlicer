/* ====================================================================
 * VIEW-FIT (Адаптивная центровка стола и камеры для экранов смартфонов)
 * ==================================================================== */
(function (root) {
    'use strict';

    function fitCameraToBed() {
        if (!root.controls || !root.camera) return;

        const isMobile = window.innerWidth < 768;
        const isLandscape = window.innerWidth > window.innerHeight;

        // Если открыт смартфон в портретной ориентации — приподнимаем фокус target выше центра,
        // чтобы сам стол визуально сместился в верхнюю треть вьюпорта и не перекрывался плавающими кнопками
        const targetY = (isMobile && !isLandscape) ? 35 : 20;
        const distMult = isMobile ? (isLandscape ? 1.15 : 1.35) : 1.0;

        root.controls.target.set(0, targetY, 0);

        // Фиксированная удобная изометрия
        root.camera.position.set(165 * distMult, (180 + targetY) * distMult, 235 * distMult);
        root.camera.lookAt(root.controls.target);

        if (typeof root.triggerSceneRender === 'function') {
            root.triggerSceneRender();
        }
    }

    // Перехват встроенного focusOnModel в controls
    function hookControls() {
        if (!root.controls) return;
        const origFocus = root.controls.focusOnModel;
        root.controls.focusOnModel = function (mesh) {
            origFocus.call(this, mesh);
            const isMobile = window.innerWidth < 768;
            if (isMobile && !window.matchMedia('(orientation: landscape)').matches) {
                // Корректируем смещение по Y для мобильного экрана
                this.target.y += 15;
                this.camera.position.y += 20;
                this.camera.lookAt(this.target);
                if (typeof root.triggerSceneRender === 'function') root.triggerSceneRender();
            }
        };
    }

    root.SalimViewFit = { fitCameraToBed };

    window.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            hookControls();
            fitCameraToBed();
        }, 150);
    });

    window.addEventListener('orientationchange', () => {
        setTimeout(fitCameraToBed, 200);
    });
})(typeof window !== 'undefined' ? window : globalThis);