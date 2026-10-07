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
    const templateTextColor = document.getElementById('templateTextColor');
    const templateFontSize = document.getElementById('templateFontSize');
    const templateFontSizeValue = document.getElementById('templateFontSizeValue');
    const templateProductScale = document.getElementById('templateProductScale');
    const templateProductScaleValue = document.getElementById('templateProductScaleValue');
    const templateMargin = document.getElementById('templateMargin');
    const templateMarginValue = document.getElementById('templateMarginValue');
    const templateSelectProductBtn = document.getElementById('templateSelectProductBtn');
    const templateSelectTextBtn = document.getElementById('templateSelectTextBtn');
    const templateSettingsModal = document.getElementById('templateSettingsModal');
    const templateSettingsTitle = document.getElementById('templateSettingsTitle');
    const templateSettingSections = {
        background: document.getElementById('templateBackgroundSettings'),
        product: document.getElementById('templateProductSettings'),
        text: document.getElementById('templateTextSettings')
    };

    let settings = {
        bgColor: '#340000',
        textColor: '#ffffff',
        fontSize: 192,
        margin: 2.5,
        background: null,
        productOffsetX: 0,
        productOffsetY: 0,
        productScale: 1,
        textOffsetX: 0,
        textOffsetY: 0
    };
    let backgroundUrl = null;
    let selectedLayer = 'product';
    let renderScheduled = false;

    async function initialize(savedSettings) {
        if (savedSettings) {
            delete savedSettings.fontBlob;
            delete savedSettings.jeansAge;
            settings = { ...settings, ...savedSettings };
        }
        templateTextColor.value = settings.textColor;
        templateFontSize.value = settings.fontSize;
        templateProductScale.value = Math.round((settings.productScale || 1) * 100);
        templateMargin.value = settings.margin;
        syncBackgroundControl();
        syncLabels();
    }

    function syncLabels() {
        templateFontSizeValue.textContent = `${templateFontSize.value} px`;
        templateProductScaleValue.textContent = `${templateProductScale.value}%`;
        templateMarginValue.textContent = `${templateMargin.value}%`;
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
        settings = {
            ...settings,
            textColor: templateTextColor.value,
            fontSize: Number(templateFontSize.value),
            productScale: Number(templateProductScale.value) / 100,
            margin: Number(templateMargin.value)
        };
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
        const margin = 1920 * Number(templateMargin.value) / 100;
        const fontSize = Number(templateFontSize.value);
        const maxWidth = 960 - margin * 2;
        const maxHeight = 1920 - margin * 3 - fontSize;
        const productScale = Number(templateProductScale.value) / 100;
        const productOffsetX = Number(settings.productOffsetX) || 0;
        const productOffsetY = Number(settings.productOffsetY) || 0;
        const drawContained = (image, x, y, width, height) => {
            const ratio = Math.min(width / image.width, height / image.height);
            const scaledWidth = image.width * ratio * productScale;
            const scaledHeight = image.height * ratio * productScale;
            context.drawImage(
                image,
                x + (width - scaledWidth) / 2 + productOffsetX,
                y + (height - scaledHeight) / 2 + productOffsetY,
                scaledWidth,
                scaledHeight
            );
        };
        if (product) {
            const front = await loadImageBlob(product.foto);
            if (product.fotoReverso) {
                const back = await loadImageBlob(product.fotoReverso);
                drawContained(front, 1920 - margin - maxWidth, margin, maxWidth, maxHeight);
                drawContained(back, margin, 1920 - margin - maxHeight - fontSize - 60, maxWidth, maxHeight);
            } else {
                const imageWidth = Math.min(maxWidth, 1920 - margin * 2);
                const imageHeight = Math.min(maxHeight, 1920 - margin * 2 - fontSize - 120);
                drawContained(front, margin, margin, imageWidth, imageHeight);
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
        const textX = margin + 30 + (Number(settings.textOffsetX) || 0);
        const priceY = 1920 - margin - fontSize - 100 + (Number(settings.textOffsetY) || 0);
        const sizeY = priceY - fontSize * 1.1;
        context.lineJoin = 'round';
        context.lineWidth = 8;
        context.strokeStyle = 'rgba(20,20,20,1)';
        context.fillStyle = templateTextColor.value;
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

    function selectLayer(layer) {
        selectedLayer = layer;
        templateSelectProductBtn.setAttribute('aria-pressed', String(layer === 'product'));
        templateSelectTextBtn.setAttribute('aria-pressed', String(layer === 'text'));
    }

    function closeSettings() {
        templateSettingsModal.classList.add('oculto');
        Object.values(templateSettingSections).forEach(section => section.classList.add('oculto'));
        return true;
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
    document.querySelectorAll('[data-template-settings]').forEach(button => {
        button.addEventListener('click', () => {
            const setting = button.dataset.templateSettings;
            const section = templateSettingSections[setting];
            if (!section) return;
            const titles = { background: 'Fondo', product: 'Prenda', text: 'Talla y precio' };
            templateSettingsTitle.textContent = titles[setting];
            Object.values(templateSettingSections).forEach(item => item.classList.add('oculto'));
            section.classList.remove('oculto');
            if (templateSettingsModal.classList.contains('oculto')) {
                pushAppNavigation('template-settings', closeSettings);
            }
            templateSettingsModal.classList.remove('oculto');
        });
    });
    document.getElementById('templateSettingsCloseBtn').addEventListener('click', () => navigateBack(closeSettings));
    templateSettingsModal.addEventListener('click', event => {
        if (event.target === templateSettingsModal) navigateBack(closeSettings);
    });
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
    for (const input of [templateTextColor, templateFontSize, templateProductScale, templateMargin]) {
        input.addEventListener('input', () => {
            syncLabels();
            renderPreview().catch(error => showToast(`❌ No se pudo actualizar el lienzo: ${error.message}`));
        });
        input.addEventListener('change', async () => {
            try {
                await persist();
                await renderPreview();
            } catch (error) {
                showToast(`❌ No se pudo guardar el diseño: ${error.message}`);
            }
        });
    }
    document.getElementById('exportRenderedBtn').addEventListener('click', onExport);

    return {
        closeAll() {
            close();
            closeSettings();
        },
        drawProductTemplate,
        getBackground: () => settings.background,
        initialize,
        persist,
        renderPreview
    };
}
