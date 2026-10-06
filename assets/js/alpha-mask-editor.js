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
    let cropPointers = new Map();
    let cropPinch = null;
    let cropMultiTouch = false;
    let cropDrawingPointerId = null;
    let maskTool = 'restore';
    let maskStrokes = [];
    let activeMaskStroke = null;

    // Canvas internal size (set once on open, matches display pixels)
    let canvasW = 1;
    let canvasH = 1;

    function resizeCanvasToViewport() {
        const bounds = cropCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        canvasW = Math.max(1, Math.round(bounds.width * dpr));
        canvasH = Math.max(1, Math.round(bounds.height * dpr));
        cropCanvas.width = canvasW;
        cropCanvas.height = canvasH;
    }

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
            cropPointers.clear();
            cropPinch = null;
            cropMultiTouch = false;
            cropDrawingPointerId = null;
            maskTool = getImage(target).backgroundRemoved ? 'restore' : 'erase';
            document.getElementById('maskRestoreToolBtn').disabled = !original;
            maskBrushSize.value = '36';
            maskBrushSizeValue.textContent = '36 px';
            syncMaskTools();
            pushAppNavigation('crop', close);
            cropModal.classList.remove('oculto');
            // Size canvas after modal is visible so getBoundingClientRect is correct
            requestAnimationFrame(() => {
                resizeCanvasToViewport();
                drawCropEditor();
            });
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

    // Convert client coords → canvas pixel coords (accounting for DPR)
    function clientToCanvas(clientX, clientY) {
        const bounds = cropCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return {
            x: (clientX - bounds.left) * dpr,
            y: (clientY - bounds.top) * dpr
        };
    }

    // Convert canvas pixel coords → image coords (inverse of the view transform)
    function canvasToImage(cx, cy) {
        return {
            x: (cx - canvasW / 2 - cropPanX) / cropZoom + canvasW / 2,
            y: (cy - canvasH / 2 - cropPanY) / cropZoom + canvasH / 2
        };
    }

    // Convert client coords → image coords
    function clientToImage(clientX, clientY) {
        const c = clientToCanvas(clientX, clientY);
        return canvasToImage(c.x, c.y);
    }

    // The view transform: image coords → canvas pixel coords
    // canvas_px = (img - center) * zoom + center + pan
    function applyViewTransform(ctx) {
        ctx.translate(canvasW / 2 + cropPanX, canvasH / 2 + cropPanY);
        ctx.scale(cropZoom, cropZoom);
        ctx.translate(-canvasW / 2, -canvasH / 2);
    }

    // Draw a stroke in IMAGE space onto a context that already has the view transform applied
    function drawBrushPath(ctx, stroke, offsetX = 0, offsetY = 0) {
        const [first, ...rest] = stroke.points;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        // stroke.size is in image pixels; scale to canvas pixels for display
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

    // imageW/imageH: the image dimensions mapped onto the canvas
    function getImageRect() {
        // The image fills the canvas at zoom=1, pan=0
        return { x: 0, y: 0, w: canvasW, h: canvasH };
    }

    // Draw a stroke onto an off-screen canvas that works in image-pixel space
    // (used for apply() which renders at full image resolution)
    function drawMaskStrokeOnImageCanvas(ctx, stroke, imgW, imgH) {
        if (!stroke.points.length) return;
        // Scale factor from canvas coords to image coords
        const sx = imgW / canvasW;
        const sy = imgH / canvasH;
        const scaledStroke = {
            ...stroke,
            size: stroke.size * sx,
            points: stroke.points.map(p => ({ x: p.x * sx, y: p.y * sy }))
        };
        if (stroke.tool === 'erase') {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';
            ctx.strokeStyle = '#000';
            ctx.fillStyle = '#000';
            drawBrushPath(ctx, scaledStroke);
            ctx.restore();
            return;
        }
        if (!cropOriginalImage) return;
        const padding = Math.ceil(scaledStroke.size / 2) + 1;
        const left = Math.max(0, Math.floor(Math.min(...scaledStroke.points.map(p => p.x)) - padding));
        const top = Math.max(0, Math.floor(Math.min(...scaledStroke.points.map(p => p.y)) - padding));
        const right = Math.min(imgW, Math.ceil(Math.max(...scaledStroke.points.map(p => p.x)) + padding));
        const bottom = Math.min(imgH, Math.ceil(Math.max(...scaledStroke.points.map(p => p.y)) + padding));
        const w = Math.max(1, right - left);
        const h = Math.max(1, bottom - top);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w; maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) return;
        maskCtx.strokeStyle = '#fff'; maskCtx.fillStyle = '#fff';
        drawBrushPath(maskCtx, scaledStroke, left, top);
        const restoredCanvas = document.createElement('canvas');
        restoredCanvas.width = w; restoredCanvas.height = h;
        const restoredCtx = restoredCanvas.getContext('2d');
        if (!restoredCtx) return;
        restoredCtx.drawImage(cropOriginalImage, -left, -top, imgW, imgH);
        restoredCtx.globalCompositeOperation = 'destination-in';
        restoredCtx.drawImage(maskCanvas, 0, 0);
        ctx.drawImage(restoredCanvas, left, top);
    }

    // Draw a stroke in canvas/view space (for display only)
    function drawMaskStrokeOnView(ctx, stroke) {
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
        const left = Math.max(0, Math.floor(Math.min(...stroke.points.map(p => p.x)) - padding));
        const top = Math.max(0, Math.floor(Math.min(...stroke.points.map(p => p.y)) - padding));
        const right = Math.min(canvasW, Math.ceil(Math.max(...stroke.points.map(p => p.x)) + padding));
        const bottom = Math.min(canvasH, Math.ceil(Math.max(...stroke.points.map(p => p.y)) + padding));
        const w = Math.max(1, right - left);
        const h = Math.max(1, bottom - top);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = w; maskCanvas.height = h;
        const maskCtx = maskCanvas.getContext('2d');
        if (!maskCtx) return;
        maskCtx.strokeStyle = '#fff'; maskCtx.fillStyle = '#fff';
        drawBrushPath(maskCtx, stroke, left, top);
        const restoredCanvas = document.createElement('canvas');
        restoredCanvas.width = w; restoredCanvas.height = h;
        const restoredCtx = restoredCanvas.getContext('2d');
        if (!restoredCtx) return;
        restoredCtx.drawImage(cropOriginalImage, -left, -top, canvasW, canvasH);
        restoredCtx.globalCompositeOperation = 'destination-in';
        restoredCtx.drawImage(maskCanvas, 0, 0);
        ctx.drawImage(restoredCanvas, left, top);
    }

    function drawCropEditor() {
        if (!cropImage) return;
        const ctx = cropCanvas.getContext('2d');
        if (!ctx) return;
        ctx.save();
        ctx.clearRect(0, 0, canvasW, canvasH);
        applyViewTransform(ctx);
        ctx.drawImage(cropImage, 0, 0, canvasW, canvasH);
        maskStrokes.forEach(stroke => drawMaskStrokeOnView(ctx, stroke));
        ctx.restore();
        document.getElementById('cropZoomIndicator').textContent = `${Math.round(cropZoom * 100)}%`;
    }

    function midpointOfPointers() {
        const [a, b] = Array.from(cropPointers.values());
        return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }

    function distanceBetweenPointers() {
        const [a, b] = Array.from(cropPointers.values());
        return Math.hypot(b.x - a.x, b.y - a.y);
    }

    function beginCropPinch() {
        cropMultiTouch = true;
        if (activeMaskStroke && maskStrokes[maskStrokes.length - 1] === activeMaskStroke) maskStrokes.pop();
        activeMaskStroke = null;
        cropDrawingPointerId = null;
        syncMaskTools();
        const mid = midpointOfPointers();
        const anchor = clientToCanvas(mid.x, mid.y);
        cropPinch = {
            startDistance: Math.max(distanceBetweenPointers(), 1),
            startZoom: cropZoom,
            startPanX: cropPanX,
            startPanY: cropPanY,
            anchorCanvas: anchor,          // canvas px coords of pinch center at start
            anchorImage: canvasToImage(anchor.x, anchor.y) // image coords of that point
        };
        drawCropEditor();
    }

    function updateCropPinch() {
        if (!cropPinch || cropPointers.size < 2) return;
        const mid = midpointOfPointers();
        const currentAnchorCanvas = clientToCanvas(mid.x, mid.y);
        const newZoom = Math.min(5, Math.max(1, cropPinch.startZoom * distanceBetweenPointers() / cropPinch.startDistance));

        if (newZoom <= 1) {
            cropZoom = 1;
            cropPanX = 0;
            cropPanY = 0;
        } else {
            cropZoom = newZoom;
            // Keep cropPinch.anchorImage fixed under currentAnchorCanvas:
            // currentAnchorCanvas = (anchorImage - center) * zoom + center + pan
            // => pan = currentAnchorCanvas - center - (anchorImage - center) * zoom
            cropPanX = currentAnchorCanvas.x - canvasW / 2 - (cropPinch.anchorImage.x - canvasW / 2) * cropZoom;
            cropPanY = currentAnchorCanvas.y - canvasH / 2 - (cropPinch.anchorImage.y - canvasH / 2) * cropZoom;
            const maxPanX = canvasW / 2 * (cropZoom - 1);
            const maxPanY = canvasH / 2 * (cropZoom - 1);
            cropPanX = Math.max(-maxPanX, Math.min(maxPanX, cropPanX));
            cropPanY = Math.max(-maxPanY, Math.min(maxPanY, cropPanY));
        }
        drawCropEditor();
    }

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
        // Draw the single dot immediately
        const ctx = cropCanvas.getContext('2d');
        if (ctx) {
            ctx.save();
            applyViewTransform(ctx);
            drawMaskStrokeOnView(ctx, activeMaskStroke);
            ctx.restore();
        }
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
        const ctx = cropCanvas.getContext('2d');
        samples.forEach(sample => {
            const pt = clientToImage(sample.clientX, sample.clientY);
            const x = Math.max(0, Math.min(canvasW, pt.x));
            const y = Math.max(0, Math.min(canvasH, pt.y));
            if (!activeMaskStroke) return;
            const prev = activeMaskStroke.points[activeMaskStroke.points.length - 1];
            if (Math.hypot(x - prev.x, y - prev.y) < 0.5) return;
            activeMaskStroke.points.push({ x, y });
            if (ctx) {
                ctx.save();
                applyViewTransform(ctx);
                drawMaskStrokeOnView(ctx, { ...activeMaskStroke, points: [prev, { x, y }] });
                ctx.restore();
            }
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

    async function apply() {
        if (!cropImage) return;
        const imgW = cropImage.width;
        const imgH = cropImage.height;
        const canvas = document.createElement('canvas');
        canvas.width = imgW;
        canvas.height = imgH;
        const ctx = canvas.getContext('2d');
        if (!ctx) { showToast('❌ No se pudo retocar la foto.'); return; }
        ctx.drawImage(cropImage, 0, 0, imgW, imgH);
        maskStrokes.forEach(stroke => drawMaskStrokeOnImageCanvas(ctx, stroke, imgW, imgH));
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
