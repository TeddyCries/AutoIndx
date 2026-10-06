export function createAlphaMaskEditor({
    document,
    loadImageBlob,
    getImage,
    setImage,
    setBackgroundRemoved,
    canvasToBlob,
    navigateBack,
    pushAppNavigation,
    showReviewMode,
    showToast
}) {
    const cropModal = document.getElementById('cropModal');
    const cropCanvas = document.getElementById('cropCanvas');
    const maskBrushSize = document.getElementById('maskBrushSize');
    const maskBrushSizeValue = document.getElementById('maskBrushSizeValue');
    const maskUndoBtn = document.getElementById('maskUndoBtn');

    let cropTarget = null;
    let cropImage = null;
    let cropOriginalImage = null;
    let cropZoom = 1;
    let cropPanX = 0;
    let cropPanY = 0;
    let cropRotation = 0;
    let cropPointers = new Map();
    let cropPinch = null;
    let cropMultiTouch = false;
    let cropDrawingPointerId = null;
    let maskTool = 'restore';
    let maskStrokes = [];
    let activeMaskStroke = null;

    // ── Coordinate helpers ────────────────────────────────────────────────────
    // The canvas internal size always equals the image size.
    // CSS makes it fit inside the viewport with object-fit:contain.
    // We need to find the actual rendered rect of the image inside the canvas element.

    function getContainRect() {
        // Returns the sub-rect (in client coords) where the image is actually drawn
        // inside the canvas element, respecting object-fit:contain.
        const b = cropCanvas.getBoundingClientRect();
        const imgW = cropCanvas.width;
        const imgH = cropCanvas.height;
        const scale = Math.min(b.width / imgW, b.height / imgH);
        const renderedW = imgW * scale;
        const renderedH = imgH * scale;
        return {
            left: b.left + (b.width - renderedW) / 2,
            top: b.top + (b.height - renderedH) / 2,
            width: renderedW,
            height: renderedH,
            scale // client px per image px
        };
    }

    function clientToImage(clientX, clientY) {
        const r = getContainRect();
        const rawX = (clientX - r.left) / r.scale;
        const rawY = (clientY - r.top) / r.scale;
        const cx = cropCanvas.width / 2;
        const cy = cropCanvas.height / 2;
        // Invert: translate(-cx,-cy) -> scale(zoom) -> rotate -> translate(cx+panX, cy+panY)
        const dx = (rawX - cx - cropPanX) / cropZoom;
        const dy = (rawY - cy - cropPanY) / cropZoom;
        const cos = Math.cos(-cropRotation);
        const sin = Math.sin(-cropRotation);
        return {
            x: cx + dx * cos - dy * sin,
            y: cy + dx * sin + dy * cos
        };
    }

    // ── Drawing ───────────────────────────────────────────────────────────────

    function applyViewTransform(ctx) {
        const cx = cropCanvas.width / 2;
        const cy = cropCanvas.height / 2;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.translate(cx + cropPanX, cy + cropPanY);
        ctx.rotate(cropRotation);
        ctx.scale(cropZoom, cropZoom);
        ctx.translate(-cx, -cy);
    }

    function drawBrushPath(ctx, stroke, offsetX = 0, offsetY = 0) {
        const [first, ...rest] = stroke.points;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.lineWidth = stroke.size;
        ctx.beginPath();
        if (!rest.length) {
            ctx.arc(first.x - offsetX, first.y - offsetY, stroke.size / 2, 0, Math.PI * 2);
            ctx.fill();
            return;
        }
        ctx.moveTo(first.x - offsetX, first.y - offsetY);
        rest.forEach(p => ctx.lineTo(p.x - offsetX, p.y - offsetY));
        ctx.stroke();
    }

    function drawMaskStroke(ctx, stroke) {
        if (!stroke.points.length) return;
        if (stroke.tool === 'erase') {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#000';
            drawBrushPath(ctx, stroke);
            ctx.restore();
            return;
        }
        if (!cropOriginalImage) return;
        const padding = Math.ceil(stroke.size / 2) + 1;
        const left   = Math.max(0, Math.floor(Math.min(...stroke.points.map(p => p.x)) - padding));
        const top    = Math.max(0, Math.floor(Math.min(...stroke.points.map(p => p.y)) - padding));
        const right  = Math.min(ctx.canvas.width,  Math.ceil(Math.max(...stroke.points.map(p => p.x)) + padding));
        const bottom = Math.min(ctx.canvas.height, Math.ceil(Math.max(...stroke.points.map(p => p.y)) + padding));
        const w = Math.max(1, right - left);
        const h = Math.max(1, bottom - top);

        const maskC = document.createElement('canvas');
        maskC.width = w; maskC.height = h;
        const maskCtx = maskC.getContext('2d');
        if (!maskCtx) return;
        maskCtx.strokeStyle = '#fff'; maskCtx.fillStyle = '#fff';
        drawBrushPath(maskCtx, stroke, left, top);

        const restC = document.createElement('canvas');
        restC.width = w; restC.height = h;
        const restCtx = restC.getContext('2d');
        if (!restCtx) return;
        restCtx.drawImage(cropOriginalImage, -left, -top, ctx.canvas.width, ctx.canvas.height);
        restCtx.globalCompositeOperation = 'destination-in';
        restCtx.drawImage(maskC, 0, 0);
        ctx.drawImage(restC, left, top);
    }

    function drawCropEditor() {
        if (!cropImage) return;
        const ctx = cropCanvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        applyViewTransform(ctx);
        ctx.drawImage(cropImage, 0, 0, cropCanvas.width, cropCanvas.height);
        maskStrokes.forEach(stroke => drawMaskStroke(ctx, stroke));
        ctx.restore();
        document.getElementById('cropZoomIndicator').textContent =
            `${Math.round(cropZoom * 100)}%${cropRotation !== 0 ? ' ' + Math.round(cropRotation * 180 / Math.PI) + '°' : ''}`;
    }

    // ── Pinch ─────────────────────────────────────────────────────────────────

    function midpointOfPointers() {
        const [a, b] = Array.from(cropPointers.values());
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function distanceBetweenPointers() {
        const [a, b] = Array.from(cropPointers.values());
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function angleOfPointers() {
        const [a, b] = Array.from(cropPointers.values());
        return Math.atan2(b.y - a.y, b.x - a.x);
    }

    function beginCropPinch() {
        cropMultiTouch = true;
        if (activeMaskStroke && maskStrokes[maskStrokes.length - 1] === activeMaskStroke) maskStrokes.pop();
        activeMaskStroke = null;
        cropDrawingPointerId = null;
        syncMaskTools();
        const mid = midpointOfPointers();
        cropPinch = {
            startDistance: Math.max(distanceBetweenPointers(), 1),
            startAngle: angleOfPointers(),
            startZoom: cropZoom,
            startRotation: cropRotation,
            startPanX: cropPanX,
            startPanY: cropPanY,
            anchorImage: clientToImage(mid.x, mid.y)
        };
        drawCropEditor();
    }

    function updateCropPinch() {
        if (!cropPinch || cropPointers.size < 2) return;
        const mid = midpointOfPointers();
        cropZoom = Math.min(5, Math.max(1, cropPinch.startZoom * distanceBetweenPointers() / cropPinch.startDistance));
        cropRotation = cropPinch.startRotation + (angleOfPointers() - cropPinch.startAngle);

        if (cropZoom <= 1) { cropZoom = 1; cropPanX = 0; cropPanY = 0; cropRotation = 0; drawCropEditor(); return; }

        // Keep anchorImage fixed under mid after applying new zoom+rotation:
        // rawMid = rotate(rotation) * scale(zoom) * (anchor - center) + center + pan
        const r = getContainRect();
        const rawMidX = (mid.x - r.left) / r.scale;
        const rawMidY = (mid.y - r.top) / r.scale;
        const cx = cropCanvas.width / 2;
        const cy = cropCanvas.height / 2;
        const adx = cropPinch.anchorImage.x - cx;
        const ady = cropPinch.anchorImage.y - cy;
        const cos = Math.cos(cropRotation);
        const sin = Math.sin(cropRotation);
        cropPanX = rawMidX - cx - cropZoom * (adx * cos - ady * sin);
        cropPanY = rawMidY - cy - cropZoom * (adx * sin + ady * cos);
        drawCropEditor();
    }

    // ── Pointer events ────────────────────────────────────────────────────────

    function beginCropPointer(event) {
        if (!cropImage) return;
        event.preventDefault();
        cropCanvas.setPointerCapture(event.pointerId);
        cropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (cropPointers.size >= 2) { beginCropPinch(); return; }
        cropDrawingPointerId = event.pointerId;
        const pt = clientToImage(event.clientX, event.clientY);
        activeMaskStroke = { tool: maskTool, size: Number(maskBrushSize.value), points: [pt] };
        maskStrokes.push(activeMaskStroke);
        drawCropEditor();
        syncMaskTools();
    }

    function updateCropPointer(event) {
        if (!cropImage || !cropPointers.has(event.pointerId)) return;
        cropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (cropPinch && cropPointers.size >= 2) {
            event.preventDefault();
            updateCropPinch();
            return;
        }
        if (cropMultiTouch || event.pointerId !== cropDrawingPointerId) return;
        const samples = (typeof event.getCoalescedEvents === 'function' && event.getCoalescedEvents().length)
            ? event.getCoalescedEvents() : [event];
        samples.forEach(sample => {
            const pt = clientToImage(sample.clientX, sample.clientY);
            const x = Math.max(0, Math.min(cropCanvas.width, pt.x));
            const y = Math.max(0, Math.min(cropCanvas.height, pt.y));
            if (!activeMaskStroke) return;
            const prev = activeMaskStroke.points[activeMaskStroke.points.length - 1];
            if (Math.hypot(x - prev.x, y - prev.y) < 0.5) return;
            activeMaskStroke.points.push({ x, y });
            drawCropEditor();
        });
    }

    function finishCropPointer(event) {
        if (cropPointers.has(event.pointerId) && !cropMultiTouch && event.pointerId === cropDrawingPointerId) {
            updateCropPointer(event);
        }
        cropPointers.delete(event.pointerId);
        if (cropPointers.size < 2) cropPinch = null;
        if (event.pointerId === cropDrawingPointerId) cropDrawingPointerId = null;
        if (cropPointers.size > 0) return;
        const cancelGesture = cropMultiTouch || event.type === 'pointercancel';
        if (cancelGesture && activeMaskStroke && maskStrokes[maskStrokes.length - 1] === activeMaskStroke) {
            maskStrokes.pop();
            drawCropEditor();
        }
        cropMultiTouch = false;
        activeMaskStroke = null;
    }

    // ── Open / close ──────────────────────────────────────────────────────────

    function open(target) {
        cropTarget = target;
        const { photo, originalPhoto } = getImage(target);
        if (!photo) { showToast('No hay imagen para retocar.'); return; }
        Promise.all([
            loadImageBlob(photo),
            originalPhoto ? loadImageBlob(originalPhoto) : Promise.resolve(null)
        ]).then(([image, original]) => {
            cropImage = image;
            cropOriginalImage = original;
            maskStrokes = [];
            activeMaskStroke = null;
            cropZoom = 1;
            cropPanX = 0;
            cropPanY = 0;
            cropRotation = 0;
            cropPointers.clear();
            cropPinch = null;
            cropMultiTouch = false;
            cropDrawingPointerId = null;
            // Canvas internal size = image size (so apply() is trivial)
            cropCanvas.width = image.width;
            cropCanvas.height = image.height;
            document.getElementById('cropZoomIndicator').textContent = '100%';
            maskTool = getImage(target).backgroundRemoved ? 'restore' : 'erase';
            document.getElementById('maskRestoreToolBtn').disabled = !original;
            maskBrushSize.value = '36';
            maskBrushSizeValue.textContent = '36 px';
            syncMaskTools();
            pushAppNavigation('crop', close);
            cropModal.classList.remove('oculto');
            drawCropEditor();
        }).catch(error => showToast(`❌ ${error.message}`));
    }

    function syncMaskTools() {
        document.getElementById('maskRestoreToolBtn').setAttribute('aria-pressed', String(maskTool === 'restore'));
        document.getElementById('maskEraseToolBtn').setAttribute('aria-pressed', String(maskTool === 'erase'));
        document.getElementById('maskBrushControl').classList.remove('oculto');
        maskUndoBtn.disabled = maskStrokes.length === 0;
        document.getElementById('maskEditorHint').textContent = maskTool === 'restore'
            ? 'Pinta para recuperar partes de la prenda.'
            : 'Pinta para hacer transparente el fondo.';
    }

    function setMaskTool(tool) {
        maskTool = tool;
        syncMaskTools();
        drawCropEditor();
    }

    // ── Apply / restore ───────────────────────────────────────────────────────

    async function apply() {
        if (!cropImage) return;
        const canvas = document.createElement('canvas');
        canvas.width = cropImage.width;
        canvas.height = cropImage.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { showToast('❌ No se pudo retocar la foto.'); return; }
        // Strokes are already in image-pixel coords, no transform needed
        ctx.drawImage(cropImage, 0, 0);
        maskStrokes.forEach(stroke => drawMaskStroke(ctx, stroke));
        try {
            const { photo, originalPhoto } = getImage(cropTarget);
            setImage(cropTarget, await canvasToBlob(canvas), originalPhoto || photo);
            if (maskStrokes.some(s => s.tool === 'erase')) setBackgroundRemoved(true);
            navigateBack(close);
            showReviewMode();
            showToast('Máscara alfa aplicada.');
        } catch (error) {
            showToast(`❌ No se pudo aplicar la máscara alfa: ${error.message}`);
        }
    }

    function restoreOriginal() {
        const { originalPhoto } = getImage(cropTarget);
        if (!originalPhoto) { showToast('No hay una copia original disponible para esta imagen.'); return; }
        setImage(cropTarget, originalPhoto);
        setBackgroundRemoved(false);
        navigateBack(close);
        showReviewMode();
        showToast('Foto original restaurada. Vuelve a quitar el fondo cuando quieras.');
    }

    function close() {
        cropModal.classList.add('oculto');
        cropImage = null;
        cropOriginalImage = null;
        activeMaskStroke = null;
        maskStrokes = [];
        cropPointers.clear();
        cropPinch = null;
        cropMultiTouch = false;
        cropDrawingPointerId = null;
        return true;
    }

    // ── Event listeners ───────────────────────────────────────────────────────

    document.getElementById('cropCloseBtn').addEventListener('click', () => navigateBack(close));
    document.getElementById('cropFrontBtn').addEventListener('click', () => open('frontal'));
    document.getElementById('cropBackBtn').addEventListener('click', () => open('reverso'));
    document.getElementById('applyCropBtn').addEventListener('click', apply);
    document.getElementById('restoreImageBtn').addEventListener('click', restoreOriginal);
    document.getElementById('maskRestoreToolBtn').addEventListener('click', () => setMaskTool('restore'));
    document.getElementById('maskEraseToolBtn').addEventListener('click', () => setMaskTool('erase'));
    maskBrushSize.addEventListener('input', () => { maskBrushSizeValue.textContent = `${maskBrushSize.value} px`; });
    maskUndoBtn.addEventListener('click', () => {
        if (!maskStrokes.length) return;
        maskStrokes.pop();
        syncMaskTools();
        drawCropEditor();
    });
    document.getElementById('maskResetBtn').addEventListener('click', () => {
        if (!cropImage) return;
        maskStrokes = [];
        cropZoom = 1;
        cropPanX = 0;
        cropPanY = 0;
        cropRotation = 0;
        syncMaskTools();
        drawCropEditor();
    });
    cropCanvas.addEventListener('pointerdown', beginCropPointer);
    cropCanvas.addEventListener('pointermove', updateCropPointer);
    cropCanvas.addEventListener('pointerup', finishCropPointer);
    cropCanvas.addEventListener('pointercancel', finishCropPointer);
    cropCanvas.addEventListener('lostpointercapture', finishCropPointer);

    return { open, close };
}
