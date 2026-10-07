export function createTemplateEditor({
    document,
    loadImageBlob,
    storeRequest,
    getProducts,
    settingsStoreName,
    pushAppNavigation,
    navigateBack,
    showToast,
    onExport
}) {
    const templateModal = document.getElementById('templateModal');
    const templatePreview = document.getElementById('templatePreview');
    const templateBackgroundInput = document.getElementById('templateBackgroundInput');
    const templateChooseBackgroundBtn = document.getElementById('templateChooseBackgroundBtn');
    const templateBackgroundStatus = document.getElementById('templateBackgroundStatus');
    const templateBackgroundThumb = document.getElementById('templateBackgroundThumb');
    const removeTemplateBackgroundBtn = document.getElementById('removeTemplateBackgroundBtn');

    let settings = {
        bgColor: '#340000',
        textColor: '#ffffff',
        fontSize: 192,
        margin: 2.5,
        background: null
    };
    let backgroundUrl = null;

    async function initialize(savedSettings) {
        if (savedSettings) {
            delete savedSettings.fontBlob;
            delete savedSettings.jeansAge;
            settings = { ...settings, ...savedSettings };
        }
        syncBackgroundControl();
    }

    function syncBackgroundControl() {
        if (backgroundUrl) URL.revokeObjectURL(backgroundUrl);
        backgroundUrl = null;
        const background = settings.background;
        const hasBackground = Boolean(background);
        templateBackgroundStatus.textContent = hasBackground ? (background.name || 'Imagen cargada') : 'Sin imagen de fondo';
        templateBackgroundThumb.style.display = 'none';
        templateBackgroundThumb.removeAttribute('src');
        removeTemplateBackgroundBtn.classList.toggle('oculto', !hasBackground);
        if (hasBackground) {
            backgroundUrl = URL.createObjectURL(background);
            templateBackgroundThumb.src = backgroundUrl;
            templateBackgroundThumb.style.display = 'block';
        }
    }

    async function persist() {
        await storeRequest(settingsStoreName, 'readwrite', 'put', { ...settings, id: 'template' });
    }

    async function drawProductTemplate(canvas, product, resolution = 1920) {
        canvas.width = resolution;
        canvas.height = resolution;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo dibujar la vista previa de la plantilla.');
        const scale = resolution / 1920;
        context.save();
        context.scale(scale, scale);
        context.fillStyle = settings.bgColor || '#340000';
        context.fillRect(0, 0, 1920, 1920);
        if (settings.background) {
            const background = await loadImageBlob(settings.background);
            context.drawImage(background, 0, 0, 1920, 1920);
        }
        const margin = 1920 * settings.margin / 100;
        const fontSize = settings.fontSize;
        const maxW = 960 - margin * 2;
        const maxH = 1920 - margin * 3 - fontSize;

        const getScaled = (image) => {
            const ratio = Math.min(maxW / image.width, maxH / image.height);
            return { w: image.width * ratio, h: image.height * ratio };
        };

        if (product) {
            const front = await loadImageBlob(product.foto);
            const fs = getScaled(front);
            if (product.fotoReverso) {
                const back = await loadImageBlob(product.fotoReverso);
                const bs = getScaled(back);
                // Frontal: derecha arriba
                const fx = 1920 - margin - fs.w;
                const fy = margin;
                // Reverso: izquierda abajo
                const bx = margin;
                const by = 1920 - margin - bs.h - fontSize - 60;
                context.drawImage(front, fx, fy, fs.w, fs.h);
                context.drawImage(back, bx, by, bs.w, bs.h);
            } else {
                // Sin reverso: centrada
                const fx = (1920 - fs.w) / 2;
                const fy = (1920 - fs.h) / 2;
                context.drawImage(front, fx, fy, fs.w, fs.h);
            }
        } else {
            context.fillStyle = 'rgba(255,255,255,.12)';
            context.fillRect(200, 220, 1520, 1120);
            context.fillStyle = '#d5dde5';
            context.font = '600 48px sans-serif';
            context.textAlign = 'center';
            context.fillText('Añade o toma una foto para verla aquí', 960, 800);
        }
        context.font = `${fontSize}px Arial, sans-serif`;
        context.textAlign = 'left';
        context.textBaseline = 'alphabetic';
        const textX = margin + 30;
        const priceY = 1920 - margin - fontSize - 100;
        const sizeY = priceY - fontSize * 1.1;
        context.lineJoin = 'round';
        context.lineWidth = 8;
        context.strokeStyle = 'rgba(20,20,20,1)';
        context.fillStyle = settings.textColor;
        if (product) {
            context.strokeText(product.talla || '', textX, sizeY);
            context.fillText(product.talla || '', textX, sizeY);
            context.strokeText(product.precio || '', textX, priceY);
            context.fillText(product.precio || '', textX, priceY);
        }
        context.restore();
        return canvas;
    }

    async function renderPreview() {
        if (!templatePreview) return;
        const products = await getProducts();
        const product = products.sort((left, right) => left.id - right.id)[0] || null;
        await drawProductTemplate(templatePreview, product, 600);
    }

    function close() {
        templateModal.classList.add('oculto');
        return true;
    }

    async function open() {
        if (templateModal.classList.contains('oculto')) {
            pushAppNavigation('template', close);
        }
        templateModal.classList.remove('oculto');
        try {
            await renderPreview();
        } catch (error) {
            showToast(`❌ No se pudo abrir la plantilla: ${error.message}`);
        }
    }

    document.getElementById('templateOpenBtn').addEventListener('click', open);
    document.getElementById('templateCloseBtn').addEventListener('click', () => navigateBack(close));
    document.getElementById('saveTemplateBtn').addEventListener('click', async () => {
        try {
            await persist();
            await renderPreview();
            showToast('Plantilla guardada en este dispositivo.');
        } catch (error) {
            showToast(`❌ No se pudo guardar el diseño: ${error.message}`);
        }
    });
    templateChooseBackgroundBtn.addEventListener('click', () => templateBackgroundInput.click());
    removeTemplateBackgroundBtn.addEventListener('click', async () => {
        settings.background = null;
        try {
            await persist();
            syncBackgroundControl();
            await renderPreview();
            showToast('Imagen de fondo eliminada.');
        } catch (error) {
            showToast(`❌ No se pudo actualizar el diseño: ${error.message}`);
        }
    });
    templateBackgroundInput.addEventListener('change', async () => {
        const file = templateBackgroundInput.files[0];
        if (!file) return;
        settings.background = file;
        try {
            await persist();
            syncBackgroundControl();
            await renderPreview();
        } catch (error) {
            showToast(`❌ No se pudo usar la imagen: ${error.message}`);
        }
    });
    document.getElementById('exportRenderedBtn').addEventListener('click', onExport);

    return {
        closeAll() { close(); },
        drawProductTemplate,
        getBackground: () => settings.background,
        initialize,
        persist,
        renderPreview
    };
}
