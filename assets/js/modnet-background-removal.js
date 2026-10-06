let modnetSessionPromise = null;

const MODEL_SIZE = 512;
const MODEL_URL = 'https://huggingface.co/Xenova/modnet/resolve/main/onnx/model.onnx';
const ORT_BASE_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';

async function createModnetSession() {
    const adapter = await navigator.gpu?.requestAdapter();
    const backend = adapter ? 'webgpu' : 'wasm';
    const modulePath = backend === 'webgpu' ? 'ort.webgpu.min.mjs' : 'ort.wasm.min.mjs';
    const ort = await import(`${ORT_BASE_URL}${modulePath}`);
    if (backend === 'wasm') ort.env.wasm.wasmPaths = ORT_BASE_URL;
    const session = await ort.InferenceSession.create(MODEL_URL, { executionProviders: [backend] });
    return { ort, session };
}

function loadModnetSession() {
    if (!modnetSessionPromise) {
        modnetSessionPromise = createModnetSession().catch(error => {
            modnetSessionPromise = null;
            throw error;
        });
    }
    return modnetSessionPromise;
}

function createModelInput(image, Tensor) {
    const canvas = document.createElement('canvas');
    canvas.width = MODEL_SIZE;
    canvas.height = MODEL_SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('No se pudo preparar la imagen para MODNet.');
    ctx.drawImage(image, 0, 0, MODEL_SIZE, MODEL_SIZE);

    const { data } = ctx.getImageData(0, 0, MODEL_SIZE, MODEL_SIZE);
    const pixelCount = MODEL_SIZE * MODEL_SIZE;
    const values = new Float32Array(pixelCount * 3);
    const means = [0.485, 0.456, 0.406];
    const stds = [0.229, 0.224, 0.225];
    for (let i = 0; i < pixelCount; i++) {
        const s = i * 4;
        values[i] = (data[s] / 255 - means[0]) / stds[0];
        values[pixelCount + i] = (data[s + 1] / 255 - means[1]) / stds[1];
        values[pixelCount * 2 + i] = (data[s + 2] / 255 - means[2]) / stds[2];
    }
    return new Tensor('float32', values, [1, 3, MODEL_SIZE, MODEL_SIZE]);
}

function createAlphaCanvas(matteTensor) {
    const pixelCount = MODEL_SIZE * MODEL_SIZE;
    if (!matteTensor?.data || matteTensor.data.length !== pixelCount) {
        throw new Error('MODNet devolvió una máscara con dimensiones inesperadas.');
    }
    const canvas = document.createElement('canvas');
    canvas.width = MODEL_SIZE;
    canvas.height = MODEL_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear la máscara alfa.');
    const imageData = ctx.createImageData(MODEL_SIZE, MODEL_SIZE);
    for (let i = 0; i < pixelCount; i++) {
        const o = i * 4;
        imageData.data[o] = 255;
        imageData.data[o + 1] = 255;
        imageData.data[o + 2] = 255;
        imageData.data[o + 3] = Math.round(Math.min(1, Math.max(0, matteTensor.data[i])) * 255);
    }
    ctx.putImageData(imageData, 0, 0);
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

export async function removeBackgroundWithModnet(blob, { resizeForBackgroundRemoval, onProgress = () => {} }) {
    let image;
    try {
        const optimizedBlob = await resizeForBackgroundRemoval(blob);
        image = await createImageBitmap(optimizedBlob);
        onProgress(0.02);
        const { ort, session } = await loadModnetSession();
        const input = createModelInput(image, ort.Tensor);
        onProgress(0.1);
        const output = await session.run({ [session.inputNames[0]]: input });
        const alphaCanvas = createAlphaCanvas(output[session.outputNames[0]]);

        const canvas = document.createElement('canvas');
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('No se pudo crear la imagen procesada.');
        ctx.drawImage(image, 0, 0);
        ctx.globalCompositeOperation = 'destination-in';
        ctx.drawImage(alphaCanvas, 0, 0, image.width, image.height);

        const result = await canvasToPng(canvas);
        onProgress(1);
        return result;
    } catch (error) {
        const detail = error instanceof Error ? error.message : `Error interno del motor de inferencia (${String(error)}).`;
        throw new Error(`No se pudo generar la máscara alfa con MODNet. Revisa tu conexión e inténtalo otra vez. ${detail}`);
    } finally {
        image?.close();
    }
}
