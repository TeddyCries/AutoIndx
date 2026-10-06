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

    function open(target) {
        cropTarget = target;
        const { photo, originalPhoto } = getImage(target);
        if (!photo) {
            showToast('No hay imagen para retocar.');
            return;
        }
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

    function drawBrushPath(context, stroke, offsetX = 0, offsetY = 0) {
        const [first, ...points] = stroke.points;
        context.lineCap = 'round';
        context.lineJoin = 'round';
        context.lineWidth = stroke.size;
        context.beginPath();
        if (!points.length) {
            context.arc(first.x - offsetX, first.y - offsetY, stroke.size / 2, 0, Math.PI * 2);
            context.fill();
            return;
        }
        context.moveTo(first.x - offsetX, first.y - offsetY);
        points.forEach(point => context.lineTo(point.x - offsetX, point.y - offsetY));
        context.stroke();
    }

    function drawMaskStroke(context, stroke) {
        if (!stroke.points.length) return;
        if (stroke.tool === 'erase') {
            context.save();
            context.globalCompositeOperation = 'destination-out';
            context.strokeStyle = '#000';
            context.fillStyle = '#000';
            drawBrushPath(context, stroke);
            context.restore();
            return;
        }
        if (!cropOriginalImage) return;

        const padding = Math.ceil(stroke.size / 2) + 1;
        const left = Math.max(0, Math.floor(Math.min(...stroke.points.map(point => point.x)) - padding));
        const top = Math.max(0, Math.floor(Math.min(...stroke.points.map(point => point.y)) - padding));
        const right = Math.min(context.canvas.width, Math.ceil(Math.max(...stroke.points.map(point => point.x)) + padding));
        const bottom = Math.min(context.canvas.height, Math.ceil(Math.max(...stroke.points.map(point => point.y)) + padding));
        const width = Math.max(1, right - left);
        const height = Math.max(1, bottom - top);
        const maskCanvas = document.createElement('canvas');
        maskCanvas.width = width;
        maskCanvas.height = height;
        const maskContext = maskCanvas.getContext('2d');
        if (!maskContext) return;
        maskContext.strokeStyle = '#fff';
        maskContext.fillStyle = '#fff';
        drawBrushPath(maskContext, stroke, left, top);

        const restoredCanvas = document.createElement('canvas');
        restoredCanvas.width = width;
        restoredCanvas.height = height;
        const restoredContext = restoredCanvas.getContext('2d');
        if (!restoredContext) return;
        restoredContext.drawImage(cropOriginalImage, -left, -top, context.canvas.width, context.canvas.height);
        restoredContext.globalCompositeOperation = 'destination-in';
        restoredContext.drawImage(maskCanvas, 0, 0);
        context.drawImage(restoredCanvas, left, top);
    }

    function applyCropViewTransform(context) {
        const centerX = cropCanvas.width / 2;
        const centerY = cropCanvas.height / 2;
        context.translate(centerX + cropPanX, centerY + cropPanY);
        context.scale(cropZoom, cropZoom);
        context.translate(-centerX, -centerY);
    }

    function renderMaskBase(context) {
        context.clearRect(0, 0, cropCanvas.width, cropCanvas.height);
        applyCropViewTransform(context);
        context.drawImage(cropImage, 0, 0, cropCanvas.width, cropCanvas.height);
        maskStrokes.forEach(stroke => drawMaskStroke(context, stroke));
    }

    function drawCropEditor() {
        if (!cropImage) return;
        cropCanvas.width = cropImage.width;
        cropCanvas.height = cropImage.height;
        const context = cropCanvas.getContext('2d');
        if (!context) return;
        renderMaskBase(context);
        document.getElementById('cropZoomIndicator').textContent = `${Math.round(cropZoom * 100)}%`;
    }

    function cropCanvasViewPoint(clientX, clientY) {
        const bounds = cropCanvas.getBoundingClientRect();
        return {
            x: (clientX - bounds.left) * cropCanvas.width / Math.max(bounds.width, 1),
            y: (clientY - bounds.top) * cropCanvas.height / Math.max(bounds.height, 1)
        };
    }

    function cropCanvasImagePoint(clientX, clientY) {
        const viewPoint = cropCanvasViewPoint(clientX, clientY);
        return {
            x: cropCanvas.width / 2 + (viewPoint.x - cropCanvas.width / 2 - cropPanX) / cropZoom,
            y: cropCanvas.height / 2 + (viewPoint.y - cropCanvas.height / 2 - cropPanY) / cropZoom
        };
    }

    function drawActiveMaskStroke(stroke) {
        const context = cropCanvas.getContext('2d');
        if (!context) return;
        context.save();
        applyCropViewTransform(context);
        drawMaskStroke(context, stroke);
        context.restore();
    }

    function midpointOfCropPointers() {
        const [first, second] = Array.from(cropPointers.values());
        return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
    }

    function distanceBetweenCropPointers() {
        const [first, second] = Array.from(cropPointers.values());
        return Math.hypot(second.x - first.x, second.y - first.y);
    }

    function beginCropPinch() {
        cropMultiTouch = true;
        if (activeMaskStroke && maskStrokes[maskStrokes.length - 1] === activeMaskStroke) maskStrokes.pop();
        activeMaskStroke = null;
        cropDrawingPointerId = null;
        syncMaskTools();
        const midpoint = midpointOfCropPointers();
        cropPinch = {
            startDistance: Math.max(distanceBetweenCropPointers(), 1),
            startZoom: cropZoom,
            anchor: cropCanvasImagePoint(midpoint.x, midpoint.y)
        };
        drawCropEditor();
    }

    function updateCropPinch() {
        if (!cropPinch || cropPointers.size < 2) return;
        const pointerMidpoint = midpointOfCropPointers();
        const midpoint = cropCanvasViewPoint(pointerMidpoint.x, pointerMidpoint.y);
        const centerX = cropCanvas.width / 2;
        const centerY = cropCanvas.height / 2;
        cropZoom = Math.min(5, Math.max(1, cropPinch.startZoom * distanceBetweenCropPointers() / cropPinch.startDistance));
        if (cropZoom === 1) {
            cropPanX = 0;
            cropPanY = 0;
        } else {
            cropPanX = midpoint.x - centerX - (cropPinch.anchor.x - centerX) * cropZoom;
            cropPanY = midpoint.y - centerY - (cropPinch.anchor.y - centerY) * cropZoom;
            cropPanX = Math.max(-centerX * (cropZoom - 1), Math.min(centerX * (cropZoom - 1), cropPanX));
            cropPanY = Math.max(-centerY * (cropZoom - 1), Math.min(centerY * (cropZoom - 1), cropPanY));
        }
        drawCropEditor();
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
        const coalescedEvents = typeof event.getCoalescedEvents === 'function' ? event.getCoalescedEvents() : [];
        const samples = coalescedEvents.length ? coalescedEvents : [event];
        samples.forEach(sample => {
            const point = cropCanvasImagePoint(sample.clientX, sample.clientY);
            const x = Math.max(0, Math.min(cropCanvas.width, point.x));
            const y = Math.max(0, Math.min(cropCanvas.height, point.y));
            if (activeMaskStroke) {
                const previous = activeMaskStroke.points[activeMaskStroke.points.length - 1];
                const nextPoint = { x, y };
                if (Math.hypot(nextPoint.x - previous.x, nextPoint.y - previous.y) < .5) return;
                activeMaskStroke.points.push(nextPoint);
                drawActiveMaskStroke({ ...activeMaskStroke, points: [previous, nextPoint] });
            }
        });
    }

    function beginCropPointer(event) {
        if (!cropImage) return;
        event.preventDefault();
        cropCanvas.setPointerCapture(event.pointerId);
        cropPointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (cropPointers.size >= 2) {
            beginCropPinch();
            return;
        }
        cropDrawingPointerId = event.pointerId;
        const point = cropCanvasImagePoint(event.clientX, event.clientY);
        activeMaskStroke = { tool: maskTool, size: Number(maskBrushSize.value), points: [point] };
        maskStrokes.push(activeMaskStroke);
        drawActiveMaskStroke(activeMaskStroke);
        syncMaskTools();
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
        const canvas = document.createElement('canvas');
        canvas.width = cropImage.width;
        canvas.height = cropImage.height;
        const context = canvas.getContext('2d');
        if (!context) {
            showToast('❌ No se pudo retocar la foto.');
            return;
        }
        context.drawImage(cropImage, 0, 0, canvas.width, canvas.height);
        maskStrokes.forEach(stroke => drawMaskStroke(context, stroke));
        try {
            const { photo, originalPhoto } = getImage(cropTarget);
            setImage(cropTarget, await canvasToBlob(canvas), originalPhoto || photo);
            if (maskStrokes.some(stroke => stroke.tool === 'erase')) setBackgroundRemoved(true);
            navigateBack(close);
            showReviewMode();
            showToast('Máscara alfa aplicada.');
        } catch (error) {
            showToast(`❌ No se pudo aplicar la máscara alfa: ${error.message}`);
        }
    }

    function restoreOriginal() {
        const { originalPhoto } = getImage(cropTarget);
        if (!originalPhoto) {
            showToast('No hay una copia original disponible para esta imagen.');
            return;
        }
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
