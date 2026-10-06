let rmbgSessionPromise = null;

const MODEL_SIZE = 1024;
const MODEL_URLS = {
    wasm: 'https://huggingface.co/yamura4/RMBG-2.0-ONNX/resolve/main/onnx/model_q4.onnx',
    webgpu: 'https://huggingface.co/yamura4/RMBG-2.0-WebGPU/resolve/main/onnx/model_fp16.onnx'
};
const ORT_BASE_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

async function createRmbgSession() {
    const adapter = await navigator.gpu?.requestAdapter();
    const backend = adapter ? 'webgpu' : 'wasm';
    const modulePath = backend === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs';
    const ort = await import(`${ORT_BASE_URL}${modulePath}`);
    if (backend === 'wasm') ort.env.wasm.wasmPaths = ORT_BASE_URL;
    const session = await ort.InferenceSession.create(MODEL_URLS[backend], {
        executionProviders: [backend]
    });
    return { ort, session };
}

function loadRmbgSession() {
    if (!rmbgSessionPromise) {
        rmbgSessionPromise = createRmbgSession().catch(error => {
            rmbgSessionPromise = null;
            throw error;
        });
    }
    return rmbgSessionPromise;
}

function createModelInput(image, Tensor) {
    const canvas = document.createElement('canvas');
    canvas.width = MODEL_SIZE;
    canvas.height = MODEL_SIZE;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('No se pudo preparar la imagen para RMBG 2.0.');
    context.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);

    const { data } = context.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
    const pixelCount = MODEL_SIZE * MODEL_SIZE;
    const values = new Float32Array(pixelCount * 3);
    const means = [0.485, 0.456, 0.406];
    const standardDeviations = [0.229, 0.224, 0.225];
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const sourceIndex = pixel * 4;
        values[pixel] = (data[sourceIndex] / 255 - means[0]) / standardDeviations[0];
        values[pixelCount + pixel] = (data[sourceIndex + 1] / 255 - means[1]) / standardDeviations[1];
        values[pixelCount * 2 + pixel] = (data[sourceIndex + 2] / 255 - means[2]) / standardDeviations[2];
    }
    return new Tensor('float32', values, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

function createAlphaCanvas(alphaTensor) {
    const pixelCount = MODEL_SIZE * MODEL_SIZE;
    if (!alphaTensor?.data || alphaTensor.data.length !== pixelCount) {
        throw new Error('RMBG 2.0 devolvió una máscara con dimensiones inesperadas.');
    }

    const canvas = document.createElement('canvas');
    canvas.width = MODEL_SIZE;
    canvas.height = MODEL_SIZE;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo crear la máscara alfa.');

    const imageData = context.createImageData(MODEL_SIZE, MODEL_SIZE);
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = pixel * 4;
        imageData.data[offset] = 255;
        imageData.data[offset + 1] = 255;
        imageData.data[offset + 2] = 255;
        imageData.data[offset + 3] = Math.round(Math.min(1, Math.max(0, alphaTensor.data[pixel])) * 255);
    }
    context.putImageData(imageData, 0, 0);
    return canvas;
}

function canvasToPng(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob(blob => {
            if (blob) resolve(blob);
            else reject(new Error('No se pudo crear la imagen PNG con fondo transparente.'));
        }, 'image/png');
    });
}

export async function removeBackgroundWithRmbg(blob, { resizeForBackgroundRemoval, onProgress = () => {} }) {
    let image;
    try {
        const optimizedBlob = await resizeForBackgroundRemoval(blob);
        image = await createImageBitmap(optimizedBlob);
        onProgress(0.02);
        const { ort, session } = await loadRmbgSession();
        const input = createModelInput(image, ort.Tensor);
        onProgress(0.1);
        const output = await session.run({ [session.inputNames[0]]: input });
        const alphaCanvas = createAlphaCanvas(output[session.outputNames[0]]);

        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('No se pudo crear la imagen procesada.');
        context.drawImage(image, 0, 0);
        context.globalCompositeOperation = 'destination-in';
        context.drawImage(alphaCanvas, 0, 0, image.width, image.height);

        const result = await canvasToPng(canvas);
        onProgress(1);
        return result;
    } catch (error) {
        const detail = error instanceof Error ? error.message : `Error interno del motor de inferencia (${String(error)}).`;
        throw new Error(`No se pudo generar la máscara alfa con RMBG 2.0. Revisa tu conexión e inténtalo otra vez. ${detail}`);
    } finally {
        image?.close();
    }
}
