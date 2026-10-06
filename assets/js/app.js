import { createAlphaMaskEditor } from './alpha-mask-editor.js';
import { createTemplateEditor } from './template-editor.js';
import { removeBackgroundWithModnet } from './modnet-background-removal.js';

const video = document.getElementById('video');
const previewContainer = document.getElementById('previewContainer');
const photoPreviewFrontal = document.getElementById('photoPreviewFrontal');
const photoPreviewReverso = document.getElementById('photoPreviewReverso');
const reviewControls = document.getElementById('reviewControls');
const sizeSelect = document.getElementById('sizeSelect');
const priceSelect = document.getElementById('priceSelect');
const saveZipBtn = document.getElementById('saveZipBtn');
const actionsDiv = document.getElementById('actions');
const thumbnails = document.getElementById("thumbnails");
const singlePhotoActions = document.getElementById('singlePhotoActions');
const dualPhotoActions = document.getElementById('dualPhotoActions');
const addReversoBtn = document.getElementById('addReversoBtn');
const retakeSingleBtn = document.getElementById('retakeSingleBtn');
const saveSingleBtn = document.getElementById('saveSingleBtn');
const cancelSingleBtn = document.getElementById('cancelSingleBtn');
const retakeFrontalBtn = document.getElementById('retakeFrontalBtn');
const retakeReversoBtn = document.getElementById('retakeReversoBtn');
const deleteReversoBtn = document.getElementById('deleteReversoBtn');
const saveDualBtn = document.getElementById('saveDualBtn');
const cancelDualBtn = document.getElementById('cancelDualBtn');
const clearDataBtn = document.getElementById('clearDataBtn');
const flashBtn = document.getElementById('flashBtn');
const cameraControls = document.getElementById('cameraControls');
const captureBtn = document.getElementById('captureBtn');
const gridToggleBtn = document.getElementById('gridToggleBtn');
const compositionGrid = document.getElementById('compositionGrid');
const viewWrapper = document.getElementById('view-wrapper');
const pickerModal = document.getElementById('pickerModal');
const pickerTitle = document.getElementById('pickerTitle');
const pickerGrid = document.getElementById('pickerGrid');
const customPriceModal = document.getElementById('customPriceModal');
const customPriceInput = document.getElementById('customPriceInput');
const customPriceError = document.getElementById('customPriceError');
const sizePickerBtn = document.getElementById('sizePickerBtn');
const pricePickerBtn = document.getElementById('pricePickerBtn');
const sizePickerValue = document.getElementById('sizePickerValue');
const pricePickerValue = document.getElementById('pricePickerValue');
const countBadge = document.getElementById('countBadge');
const activePackageBadge = document.getElementById('activePackageBadge');
const captureTitle = document.getElementById('captureTitle');
const debugCamera = document.getElementById('debugCamera');
const debugWithoutCamera = matchMedia('(pointer: fine) and (hover: hover)').matches;
const homeView = document.getElementById('homeView');
const collectionWorkspace = document.getElementById('collectionWorkspace');
const collectionDashboard = document.getElementById('collectionDashboard');
const captureWorkspace = document.getElementById('captureWorkspace');
const collectionGrid = document.getElementById('collectionGrid');
const collectionNameTitle = document.getElementById('collectionNameTitle');
const createPackageModal = document.getElementById('createPackageModal');
const newPackageName = document.getElementById('newPackageName');
const createPackageTitle = document.getElementById('createPackageTitle');
const createPackageDescription = createPackageModal.querySelector('p');
const createPackageConfirmBtn = document.getElementById('createPackageConfirmBtn');
const productGrid = document.getElementById('productGrid');
const maskActions = document.getElementById('cropActions');
const editorBanner = document.getElementById('editorBanner');
const preparingOverlay = document.getElementById('preparingOverlay');
const preparingTitle = document.getElementById('preparingTitle');
const preparingStatus = document.getElementById('preparingStatus');

const DB_NAME = "MisFotosDB";
const DB_VERSION = 3;
const OBJECT_STORE_NAME = "fotos";
const PACKAGE_STORE_NAME = "paquetes";
const SETTINGS_STORE_NAME = "ajustes";
const LAST_SCREEN_KEY = 'autoindx-last-screen';
const LAST_PHOTO_KEY = 'autoindx-last-photo';

let db;
let imageCapture;
let cameraTrack;
let cameraCapabilities = {};
let flashEnabled = false;
let compositionGridEnabled = localStorage.getItem('autoindx-composition-grid') === 'true';
let fotoBlob = null;
let fotoReversoBlob = null;
let fotoOriginalBlob = null;
let fotoReversoOriginalBlob = null;
let editingPhotoId = null;
let editingProductName = null;
let isProductEditor = false;
let productMaskEditingEnabled = false;
let backgroundRemovedForCurrentProduct = false;
let skipBackgroundRemovalForCurrentProduct = false;
let currentImageIsDemo = false;
let editorReturnToDashboard = false;
let state = 'capturing';
let retakeTarget = null;
let thumbnailURLs = [];
let thumbnailRenderVersion = 0;
let packages = [];
let editingPackageId = null;
let collectionPressTimer = null;
let suppressCollectionOpen = false;
let activePackageId = localStorage.getItem('autoindx-active-package') || 'default';
let productObjectUrls = [];
let homeObjectUrls = [];
let appNavigationStack = [];
const alphaMaskEditor = createAlphaMaskEditor({
    document,
    loadImageBlob,
    getImage: target => ({
        photo: target === 'frontal' ? fotoBlob : fotoReversoBlob,
        originalPhoto: target === 'frontal' ? fotoOriginalBlob : fotoReversoOriginalBlob,
        backgroundRemoved: backgroundRemovedForCurrentProduct
    }),
    setImage: (target, image, originalPhoto) => {
        if (target === 'frontal') {
            fotoBlob = image;
            fotoOriginalBlob = originalPhoto || fotoOriginalBlob;
        } else {
            fotoReversoBlob = image;
            fotoReversoOriginalBlob = originalPhoto || fotoReversoOriginalBlob;
        }
    },
    setBackgroundRemoved: value => { backgroundRemovedForCurrentProduct = value; },
    canvasToBlob,
    navigateBack,
    pushAppNavigation,
    showReviewMode: () => showReviewMode(),
    showToast
});
const templateEditor = createTemplateEditor({
    document,
    loadImageBlob,
    storeRequest,
    getProducts: async () => (await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll'))
        .filter(item => (item.packageId || 'default') === activePackageId)
        .sort((left, right) => left.id - right.id),
    settingsStoreName: SETTINGS_STORE_NAME,
    pushAppNavigation,
    navigateBack,
    showToast,
    onExport: exportDesignedPackage
});

function rememberView(screen, photoId = null) {
    localStorage.setItem(LAST_SCREEN_KEY, screen);
    if (photoId === null) localStorage.removeItem(LAST_PHOTO_KEY);
    else localStorage.setItem(LAST_PHOTO_KEY, String(photoId));
}
function pushAppNavigation(kind, onBack) {
    appNavigationStack.push({ kind, onBack });
    history.pushState({ autoindx: true, depth: appNavigationStack.length }, '');
}
function navigateBack(fallback) {
    if (appNavigationStack.length) history.back();
    else if (fallback) fallback();
}
function navigateBackAndWait(fallback) {
    if (!appNavigationStack.length) {
        if (fallback) fallback();
        return Promise.resolve();
    }
    return new Promise(resolve => {
        window.addEventListener('popstate', resolve, { once: true });
        navigateBack();
    });
}
window.addEventListener('popstate', async () => {
    const entry = appNavigationStack.pop();
    if (!entry) return;
    if (!preparingOverlay.classList.contains('oculto')) {
        appNavigationStack.push(entry);
        history.pushState({ autoindx: true, depth: appNavigationStack.length }, '');
        return;
    }
    try {
        if (await entry.onBack() === false) {
            appNavigationStack.push(entry);
            history.pushState({ autoindx: true, depth: appNavigationStack.length }, '');
        }
    } catch (error) {
        appNavigationStack.push(entry);
        history.pushState({ autoindx: true, depth: appNavigationStack.length }, '');
        showToast(`❌ No se pudo regresar: ${error.message}`);
    }
});
document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    if (!appNavigationStack.length) return;
    event.preventDefault();
    navigateBack();
});
window.addEventListener('backbutton', event => {
    if (!appNavigationStack.length) return;
    event.preventDefault();
    navigateBack();
});
const nativeAppPlugin = window.Capacitor?.Plugins?.App;
if (typeof nativeAppPlugin?.addListener === 'function') {
    nativeAppPlugin.addListener('backButton', () => navigateBack())
        .catch(error => console.error('No se pudo registrar el botón Atrás nativo:', error));
}

const request = indexedDB.open(DB_NAME, DB_VERSION);
request.onupgradeneeded = e => {
    db = e.target.result;
    const oldVersion = e.oldVersion;
    if (!db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        db.createObjectStore(OBJECT_STORE_NAME, { keyPath: "id", autoIncrement: true });
    }
    if (oldVersion < 2 && db.objectStoreNames.contains(OBJECT_STORE_NAME)) {
        const transaction = e.target.transaction;
        const store = transaction.objectStore(OBJECT_STORE_NAME);
        store.openCursor().onsuccess = function(event) {
            const cursor = event.target.result;
            if (cursor) {
                const data = cursor.value;
                if (data.fotoReverso === undefined) {
                    data.fotoReverso = null;
                    cursor.update(data);
                }
                cursor.continue();
            }
        };
    }
    if (!db.objectStoreNames.contains(PACKAGE_STORE_NAME)) {
        const packageStore = db.createObjectStore(PACKAGE_STORE_NAME, { keyPath: 'id' });
        packageStore.put({ id: 'default', name: 'Sin colección', createdAt: Date.now() });
    }
    if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'id' });
    if (oldVersion < 3) {
        const store = e.target.transaction.objectStore(OBJECT_STORE_NAME);
        store.openCursor().onsuccess = event => {
            const cursor = event.target.result;
            if (!cursor) return;
            const item = cursor.value;
            if (!item.packageId) { item.packageId = 'default'; cursor.update(item); }
            cursor.continue();
        };
    }
};
request.onsuccess = e => {
    db = e.target.result;
    initializeApp().catch(error => showToast(`❌ No se pudo iniciar la biblioteca: ${error.message}`));
};
request.onerror = e => showToast('❌ Error al abrir la base de datos.');

function storeRequest(storeName, mode, method, value) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const request = value === undefined ? store[method]() : store[method](value);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Falló una operación de almacenamiento.'));
        transaction.onabort = () => reject(transaction.error || new Error('La operación de almacenamiento fue cancelada.'));
    });
}
async function initializeApp() {
    packages = await storeRequest(PACKAGE_STORE_NAME, 'readonly', 'getAll');
    if (!packages.some(item => item.id === 'default')) {
        const fallback = { id: 'default', name: 'Sin colección', createdAt: Date.now() };
        await storeRequest(PACKAGE_STORE_NAME, 'readwrite', 'put', fallback);
        packages.push(fallback);
    }
    if (!packages.some(item => item.id === activePackageId)) activePackageId = 'default';
    localStorage.setItem('autoindx-active-package', activePackageId);
    const savedTemplate = await storeRequest(SETTINGS_STORE_NAME, 'readonly', 'get', 'template');
    await templateEditor.initialize(savedTemplate);
    await renderCollectionWorkspace();
    homeView.classList.remove('oculto');
    collectionWorkspace.classList.add('oculto');
    activePackageBadge.classList.add('oculto');
    updateUI();
    await restoreLastView();
}
async function restoreLastView() {
    const lastScreen = localStorage.getItem(LAST_SCREEN_KEY);
    const savedPhotoId = Number(localStorage.getItem(LAST_PHOTO_KEY));
    if (!['collection', 'editor'].includes(lastScreen)) return;
    if (!packages.some(item => item.id === activePackageId)) {
        rememberView('home');
        return;
    }
    enterCollection(activePackageId);
    if (lastScreen !== 'editor') return;
    if (!Number.isSafeInteger(savedPhotoId) || savedPhotoId < 1) {
        rememberView('collection');
        return;
    }
    const item = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'get', savedPhotoId);
    if (!item || (item.packageId || 'default') !== activePackageId) {
        rememberView('collection');
        return;
    }
    enterProductEditor(item);
}
function activePackage() {
    return packages.find(item => item.id === activePackageId) || packages[0];
}
async function createPackageNamed(rawName) {
    const name = rawName.trim();
    if (!name) { showToast('Escribe un nombre para la colección.'); return null; }
    if (packages.some(item => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        showToast('Ya existe una colección con ese nombre.');
        return null;
    }
    const randomId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const item = { id: `package-${randomId}`, name, createdAt: Date.now() };
    try {
        await storeRequest(PACKAGE_STORE_NAME, 'readwrite', 'put', item);
        packages.push(item);
        activePackageId = item.id;
        localStorage.setItem('autoindx-active-package', activePackageId);
        await renderCollectionWorkspace();
        updateUI();
        showToast(`Colección «${name}» creada.`);
        return item;
    } catch (error) {
        showToast(`❌ No se pudo crear la colección: ${error.message}`);
        return null;
    }
}
async function renamePackageNamed(packageId, rawName) {
    const current = packages.find(item => item.id === packageId);
    const name = rawName.trim();
    if (!current) { showToast('No se encontró la colección para renombrar.'); return false; }
    if (!name) { showToast('Escribe un nombre para la colección.'); return false; }
    if (packages.some(item => item.id !== packageId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        showToast('Ya existe una colección con ese nombre.');
        return false;
    }
    try {
        const renamed = { ...current, name };
        await storeRequest(PACKAGE_STORE_NAME, 'readwrite', 'put', renamed);
        packages = packages.map(item => item.id === packageId ? renamed : item);
        await renderCollectionWorkspace();
        showToast(`Colección renombrada a «${name}».`);
        return true;
    } catch (error) {
        showToast(`❌ No se pudo renombrar la colección: ${error.message}`);
        return false;
    }
}
async function deleteCollection(packageId) {
    const current = packages.find(item => item.id === packageId);
    if (!current || current.id === 'default') {
        showToast('La colección predeterminada no se puede eliminar.');
        return;
    }
    if (!await askForConfirmation(`¿Eliminar «${current.name}»? Sus prendas se moverán a «Sin colección».`)) return;
    try {
        await new Promise((resolve, reject) => {
            const transaction = db.transaction([OBJECT_STORE_NAME, PACKAGE_STORE_NAME], 'readwrite');
            const products = transaction.objectStore(OBJECT_STORE_NAME);
            const request = products.getAll();
            request.onsuccess = () => request.result
                .filter(item => item.packageId === current.id)
                .forEach(item => { item.packageId = 'default'; products.put(item); });
            transaction.objectStore(PACKAGE_STORE_NAME).delete(current.id);
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('Falló el borrado de la colección.'));
            transaction.onabort = () => reject(transaction.error || new Error('Se canceló el borrado de la colección.'));
        });
        packages = packages.filter(item => item.id !== current.id);
        if (activePackageId === current.id) {
            activePackageId = 'default';
            localStorage.setItem('autoindx-active-package', activePackageId);
        }
        await renderCollectionWorkspace();
        updateUI();
        showToast(`Colección «${current.name}» eliminada; sus prendas se movieron a «Sin colección».`);
    } catch (error) {
        showToast(`❌ No se pudo eliminar la colección: ${error.message}`);
    }
}
function openRenameCollection(packageId) {
    const item = packages.find(entry => entry.id === packageId);
    if (!item) return;
    editingPackageId = packageId;
    createPackageTitle.textContent = 'Renombrar colección';
    createPackageDescription.textContent = 'Escribe el nuevo nombre de esta colección.';
    createPackageConfirmBtn.textContent = 'Guardar nombre';
    newPackageName.value = item.name;
    if (createPackageModal.classList.contains('oculto')) {
        pushAppNavigation('rename-package', () => { createPackageModal.classList.add('oculto'); return true; });
    }
    createPackageModal.classList.remove('oculto');
    newPackageName.focus();
    newPackageName.select();
}
function renderCollectionHome(allProducts) {
    homeObjectUrls.forEach(url => URL.revokeObjectURL(url));
    homeObjectUrls = [];
    const productsByPackage = new Map();
    allProducts.forEach(item => {
        const packageId = item.packageId || 'default';
        const list = productsByPackage.get(packageId) || [];
        list.push(item); productsByPackage.set(packageId, list);
    });
    const visiblePackages = packages
        .filter(item => item.id !== 'default' || (productsByPackage.get(item.id) || []).length > 0)
        .sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
    const createCollectionEntry = document.querySelector('.collection-create-entry');
    collectionGrid.replaceChildren();
    collectionGrid.appendChild(createCollectionEntry);
    document.getElementById('homeCollectionCount').textContent = `${visiblePackages.length} ${visiblePackages.length === 1 ? 'colección' : 'colecciones'}`;
    countBadge.textContent = `${visiblePackages.length} ${visiblePackages.length === 1 ? 'colección' : 'colecciones'}`;
    if (!visiblePackages.length) {
        const empty = document.createElement('div'); empty.className = 'home-empty';
        empty.innerHTML = 'Tu armario está vacío por ahora.<br>Empieza con <strong>＋ Crear nueva colección</strong> y guarda tus prendas favoritas.';
        collectionGrid.appendChild(empty);
        return;
    }
    visiblePackages.forEach(item => {
        const products = (productsByPackage.get(item.id) || []).sort((left, right) => left.id - right.id);
        const entry = document.createElement('div'); entry.className = 'collection-entry';
        const card = document.createElement('button'); card.type = 'button'; card.className = 'collection-card';
        const cover = document.createElement('span'); cover.className = 'collection-cover';
        if (products[0]?.foto) {
            const image = document.createElement('img'); image.alt = ''; image.src = URL.createObjectURL(products[0].foto); homeObjectUrls.push(image.src); cover.appendChild(image);
        } else {
            const placeholder = document.createElement('span'); placeholder.className = 'empty-cover'; placeholder.textContent = '▧'; cover.appendChild(placeholder);
        }
        const count = document.createElement('span'); count.className = 'collection-count'; count.textContent = `${products.length} ${products.length === 1 ? 'prenda' : 'prendas'}`;
        cover.appendChild(count);
        const copy = document.createElement('span'); copy.className = 'collection-card-copy';
        const name = document.createElement('strong'); name.className = 'collection-name'; name.textContent = item.id === 'default' ? 'Sin colección' : item.name;
        name.title = 'Mantén pulsado para renombrar';
        const ready = products.filter(product => product.fondoEliminado).length;
        const summary = document.createElement('span'); summary.textContent = products.length ? `${ready} de ${products.length} fotos listas` : 'Aún no hay prendas';
        copy.append(name, summary); card.append(cover, copy);
        card.addEventListener('click', () => {
            if (suppressCollectionOpen) { suppressCollectionOpen = false; return; }
            enterCollection(item.id);
        });
        name.addEventListener('pointerdown', event => {
            event.stopPropagation();
            if (event.button !== 0) return;
            clearTimeout(collectionPressTimer);
            collectionPressTimer = setTimeout(() => {
                suppressCollectionOpen = true;
                openRenameCollection(item.id);
            }, 550);
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(type => {
            name.addEventListener(type, () => clearTimeout(collectionPressTimer));
        });
        name.addEventListener('contextmenu', event => event.preventDefault());

        const moreButton = document.createElement('button');
        moreButton.type = 'button'; moreButton.className = 'collection-more-button';
        moreButton.textContent = '⋯';
        moreButton.setAttribute('aria-label', `Más opciones para ${item.name}`);
        moreButton.setAttribute('aria-expanded', 'false');
        const menu = document.createElement('div'); menu.className = 'collection-more-menu oculto';
        const exportZipButton = document.createElement('button'); exportZipButton.type = 'button'; exportZipButton.textContent = 'Exportar ZIP';
        exportZipButton.disabled = products.length === 0;
        exportZipButton.title = products.length ? 'Exportar las fotos y los datos de esta colección' : 'Añade prendas para exportar esta colección';
        const renameButton = document.createElement('button'); renameButton.type = 'button'; renameButton.textContent = 'Renombrar';
        const deleteButton = document.createElement('button'); deleteButton.type = 'button'; deleteButton.className = 'delete-collection-action'; deleteButton.textContent = 'Eliminar colección';
        exportZipButton.addEventListener('click', async () => {
            menu.classList.add('oculto'); moreButton.setAttribute('aria-expanded', 'false');
            await exportCollectionZip(item.id);
        });
        renameButton.addEventListener('click', () => {
            menu.classList.add('oculto'); moreButton.setAttribute('aria-expanded', 'false');
            openRenameCollection(item.id);
        });
        deleteButton.addEventListener('click', async () => {
            menu.classList.add('oculto'); moreButton.setAttribute('aria-expanded', 'false');
            await deleteCollection(item.id);
        });
        menu.append(exportZipButton, renameButton, deleteButton);
        moreButton.addEventListener('click', event => {
            event.stopPropagation();
            const opening = menu.classList.contains('oculto');
            collectionGrid.querySelectorAll('.collection-more-menu').forEach(otherMenu => otherMenu.classList.add('oculto'));
            collectionGrid.querySelectorAll('.collection-more-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
            if (opening) {
                menu.classList.remove('oculto');
                const buttonRect = moreButton.getBoundingClientRect();
                const menuRect = menu.getBoundingClientRect();
                const margin = 8;
                const left = Math.max(margin, Math.min(buttonRect.right - menuRect.width, innerWidth - menuRect.width - margin));
                const below = buttonRect.bottom + 6;
                const top = below + menuRect.height <= innerHeight - margin
                    ? below
                    : Math.max(margin, buttonRect.top - menuRect.height - 6);
                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
            } else {
                menu.classList.add('oculto');
            }
            moreButton.setAttribute('aria-expanded', String(opening));
        });
        entry.append(card, moreButton, menu);
        collectionGrid.appendChild(entry);
    });
}
collectionGrid.addEventListener('scroll', () => {
    collectionGrid.querySelectorAll('.collection-more-menu:not(.oculto)').forEach(menu => menu.classList.add('oculto'));
    collectionGrid.querySelectorAll('.collection-more-button').forEach(button => button.setAttribute('aria-expanded', 'false'));
});
async function renderCollectionLibrary() {
    const allProducts = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
    renderCollectionHome(allProducts);
}
function setCameraToolButtonLabel(label) {
    const button = document.getElementById('openCameraToolBtn');
    button.querySelector('span').textContent = label;
    button.setAttribute('aria-label', label);
    button.title = label;
}
function enterCollection(packageId) {
    activePackageId = packageId;
    localStorage.setItem('autoindx-active-package', activePackageId);
    rememberView('collection');
    collectionWorkspace.classList.remove('camera-active');
    const current = activePackage();
    collectionNameTitle.textContent = current ? current.name : 'Colección';
    homeView.classList.add('oculto');
    collectionWorkspace.classList.remove('oculto');
    collectionDashboard.classList.remove('oculto');
    captureWorkspace.classList.add('oculto');
    activePackageBadge.textContent = `📦 ${current ? current.name : 'Colección'}`;
    activePackageBadge.classList.remove('oculto');
    setCameraToolButtonLabel('Tomar fotos');
    const returnToLibrary = () => showCollectionLibrary();
    pushAppNavigation('collection', returnToLibrary);
    renderCollectionWorkspace(); updateUI();
}
async function showCollectionLibrary() {
    if (!captureWorkspace.classList.contains('oculto')) {
        if ((state === 'review' || state === 'retaking') && !await askForConfirmation('¿Salir y descartar los cambios que no has guardado?')) return false;
        exitCameraWorkspace();
    }
    templateEditor.closeAll();
    createPackageModal.classList.add('oculto');
    homeView.classList.remove('oculto');
    collectionWorkspace.classList.add('oculto');
    collectionWorkspace.classList.remove('camera-active');
    activePackageBadge.classList.add('oculto');
    rememberView('home');
    await renderCollectionWorkspace();
    return true;
}
async function showCollectionDashboard() {
    if (!captureWorkspace.classList.contains('oculto')) {
        if ((state === 'review' || state === 'retaking') && !await askForConfirmation('¿Salir y descartar los cambios que no has guardado?')) return false;
        exitCameraWorkspace();
    }
    collectionDashboard.classList.remove('oculto');
    captureWorkspace.classList.add('oculto');
    collectionWorkspace.classList.remove('camera-active');
    document.querySelector('.collection-toolbar').classList.remove('oculto');
    document.querySelector('.app-header').classList.remove('oculto');
    setCameraToolButtonLabel('Tomar fotos');
    rememberView('collection');
    renderCollectionWorkspace(); updateUI();
    return true;
}
function openCameraTool() {
    collectionDashboard.classList.add('oculto');
    captureWorkspace.classList.remove('oculto');
    collectionWorkspace.classList.add('camera-active');
    document.querySelector('.collection-toolbar').classList.add('oculto');
    document.querySelector('.app-header').classList.add('oculto');
    setCameraToolButtonLabel('Ver prendas');
    captureTitle.textContent = 'Tomar una foto';
    pushAppNavigation('capture', () => showCollectionDashboard());
    showCameraMode();
}
function exitCameraWorkspace() {
    if (video.srcObject) video.srcObject.getTracks().forEach(track => track.stop());
    video.srcObject = null; cameraTrack = null; imageCapture = null; cameraCapabilities = {};
    state = 'capturing'; retakeTarget = null;
    if (photoPreviewFrontal.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewFrontal.src);
    if (photoPreviewReverso.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewReverso.src);
    fotoBlob = null; fotoReversoBlob = null; fotoOriginalBlob = null; fotoReversoOriginalBlob = null;
    editingPhotoId = null; editingProductName = null; isProductEditor = false; productMaskEditingEnabled = false;
    backgroundRemovedForCurrentProduct = false; skipBackgroundRemovalForCurrentProduct = false; currentImageIsDemo = false;
    editorReturnToDashboard = false;
    viewWrapper.classList.remove('review-mode');
    video.classList.add('oculto'); debugCamera.classList.add('oculto'); previewContainer.classList.add('oculto');
    cameraControls.classList.add('oculto'); captureBtn.classList.add('oculto');
    reviewControls.classList.add('oculto'); alphaMaskEditor.close(); preparingOverlay.classList.add('oculto');
    compositionGrid.classList.add('oculto');
    thumbnails.classList.remove('disabled-thumbnails'); actionsDiv.classList.add('oculto');
}
document.getElementById('backToLibraryBtn').addEventListener('click', () => navigateBack(showCollectionLibrary));
document.getElementById('captureBackBtn').addEventListener('click', () => navigateBack(showCollectionDashboard));
document.getElementById('openCameraToolBtn').addEventListener('click', () => {
    if (captureWorkspace.classList.contains('oculto')) openCameraTool();
    else navigateBack(showCollectionDashboard);
});
document.getElementById('homeCreatePackageBtn').addEventListener('click', () => {
    editingPackageId = null;
    createPackageTitle.textContent = 'Crear colección';
    createPackageDescription.textContent = 'Elige un nombre para organizar este lote de prendas.';
    createPackageConfirmBtn.textContent = 'Crear colección';
    if (createPackageModal.classList.contains('oculto')) {
        pushAppNavigation('create-package', () => { createPackageModal.classList.add('oculto'); return true; });
    }
    createPackageModal.classList.remove('oculto');
    newPackageName.value = '';
    newPackageName.focus();
});
const closePackageNameModal = () => {
    createPackageModal.classList.add('oculto');
    editingPackageId = null;
    return true;
};
document.getElementById('createPackageCancelBtn').addEventListener('click', () => navigateBack(closePackageNameModal));
createPackageModal.addEventListener('click', event => { if (event.target === createPackageModal) navigateBack(closePackageNameModal); });
createPackageConfirmBtn.addEventListener('click', async () => {
    if (editingPackageId) {
        const renamed = await renamePackageNamed(editingPackageId, newPackageName.value);
        if (renamed) navigateBack(closePackageNameModal);
        return;
    }
    const createdPackage = await createPackageNamed(newPackageName.value);
    if (!createdPackage) return;
    await navigateBackAndWait(closePackageNameModal);
    const startTakingPhotos = await askForConfirmation(
        `Colección «${createdPackage.name}» creada. ¿Quieres empezar a tomar fotos ahora?`,
        { yesLabel: 'Empezar a tomar fotos', noLabel: 'Ahora no', destructive: false }
    );
    if (startTakingPhotos) {
        enterCollection(createdPackage.id);
        openCameraTool();
    }
});
newPackageName.addEventListener('keydown', event => { if (event.key === 'Enter') createPackageConfirmBtn.click(); });
document.getElementById('preparePackageBtn').addEventListener('click', preparePackageForExport);
async function renderCollectionWorkspace() {
    if (!db) return;
    try {
        productObjectUrls.forEach(url => URL.revokeObjectURL(url)); productObjectUrls = [];
        const allProducts = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
        renderCollectionHome(allProducts);
        const counts = new Map();
        allProducts.forEach(item => {
            const packageId = item.packageId || 'default';
            counts.set(packageId, (counts.get(packageId) || 0) + 1);
        });
        if (!collectionWorkspace.classList.contains('oculto')) {
            const total = counts.get(activePackageId) || 0;
            countBadge.textContent = `${total} ${total === 1 ? 'prenda' : 'prendas'}`;
        }
        const current = activePackage();
        activePackageBadge.textContent = current ? current.name : 'Sin colección';
        collectionNameTitle.textContent = current ? current.name : 'Colección';
        productGrid.replaceChildren();
        const currentProducts = allProducts.filter(item => (item.packageId || 'default') === activePackageId).sort((a, b) => b.id - a.id);
        currentProducts.forEach(item => {
            const card = document.createElement('button'); card.type = 'button'; card.className = 'managed-product';
            const image = document.createElement('img'); image.alt = ''; image.src = URL.createObjectURL(item.foto); productObjectUrls.push(image.src);
            const copy = document.createElement('span'); copy.className = 'managed-product-copy';
            const name = document.createElement('strong'); name.textContent = item.nombre || `Prenda ${item.id}`;
            const backgroundState = item.fondoEliminado ? 'Fondo quitado' : 'Fondo por quitar';
            const metadata = document.createElement('span'); metadata.textContent = `${item.talla || 'Sin talla'} · ${item.precio || 'Sin precio'} · ${backgroundState}`;
            const editHint = document.createElement('span'); editHint.textContent = 'Tocar para editar';
            copy.append(name, metadata, editHint); card.append(image, copy);
            card.addEventListener('click', () => {
                enterProductEditor(item);
            });
            productGrid.appendChild(card);
        });
        if (currentProducts.length === 0) {
            const empty = document.createElement('div'); empty.className = 'collection-product-empty';
            empty.textContent = 'Todavía no hay prendas aquí. Toca «Tomar fotos» para añadir la primera.';
            productGrid.appendChild(empty);
        }
    } catch (error) { showToast(`❌ No se pudieron cargar los productos de la colección: ${error.message}`); }
}
function enterProductEditor(item, { allowMaskEditing = true } = {}) {
    rememberView('editor', item.id);
    editorReturnToDashboard = captureWorkspace.classList.contains('oculto');
    collectionDashboard.classList.add('oculto');
    captureWorkspace.classList.remove('oculto');
    collectionWorkspace.classList.add('camera-active');
    document.querySelector('.collection-toolbar').classList.add('oculto');
    document.querySelector('.app-header').classList.add('oculto');
    setCameraToolButtonLabel('Ver prendas');
    captureTitle.textContent = 'Editar prenda';
    const returnToDashboard = () => {
        if (editorReturnToDashboard) return showCollectionDashboard();
        cancelCurrentReview();
        return true;
    };
    document.getElementById('captureBackBtn').textContent = editorReturnToDashboard ? '← Volver a prendas' : '← Volver a cámara';
    pushAppNavigation('capture', returnToDashboard);
    fotoBlob = item.foto; fotoReversoBlob = item.fotoReverso || null;
    fotoOriginalBlob = item.fotoOriginal || null; fotoReversoOriginalBlob = item.fotoReversoOriginal || null;
    sizeSelect.value = item.talla || ''; setPriceSelection(item.precio || '');
    editingPhotoId = item.id; editingProductName = item.nombre || null;
    isProductEditor = true;
    productMaskEditingEnabled = allowMaskEditing;
    backgroundRemovedForCurrentProduct = Boolean(item.fondoEliminado);
    skipBackgroundRemovalForCurrentProduct = Boolean(item.demo);
    currentImageIsDemo = Boolean(item.demo);
    showReviewMode();
}
async function removeImageBackground(blob, onProgress = () => {}) {
    return removeBackgroundWithModnet(blob, { resizeForBackgroundRemoval, onProgress });
}
async function preparePackageImages(items) {
    preparingTitle.textContent = 'Generando máscara alfa…';
    preparingStatus.textContent = 'RMBG 2.0 de Bria AI (CC BY-NC 4.0): descarga inicial de unos 366–513 MB…';
    preparingOverlay.setAttribute('aria-busy', 'true');
    preparingOverlay.classList.remove('oculto');
    await new Promise(resolve => setTimeout(resolve, 40));
    try {
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index];
            if (item.fondoEliminado || item.demo) continue;
            preparingStatus.textContent = `Generando la máscara alfa de la foto ${index + 1} de ${items.length}…`;
            const front = await removeImageBackground(item.foto, progress => {
                preparingStatus.textContent = `Foto ${index + 1} de ${items.length} · frente ${Math.round(progress * 100)}%`;
            });
            const back = item.fotoReverso
                ? await removeImageBackground(item.fotoReverso, progress => {
                    preparingStatus.textContent = `Foto ${index + 1} de ${items.length} · reverso ${Math.round(progress * 100)}%`;
                })
                : null;
            const updated = {
                ...item,
                foto: front,
                fotoOriginal: item.fotoOriginal || item.foto,
                fotoReverso: back,
                fotoReversoOriginal: item.fotoReversoOriginal || item.fotoReverso || null,
                fondoEliminado: true
            };
            await storeRequest(OBJECT_STORE_NAME, 'readwrite', 'put', updated);
            items[index] = updated;
        }
        return items;
    } finally {
        preparingOverlay.setAttribute('aria-busy', 'false');
        preparingOverlay.classList.add('oculto');
        preparingTitle.textContent = 'Generando máscara alfa…';
    }
}
function loadImageBlob(blob) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
        image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la foto.')); };
        image.src = url;
    });
}
async function resizeForBackgroundRemoval(blob, maxDimension = 2048) {
    const image = await loadImageBlob(blob);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    if (scale === 1) return blob;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No se pudo optimizar la imagen para quitar el fondo.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvasToBlob(canvas, blob.type === 'image/png' ? 'image/png' : 'image/jpeg');
}
async function canvasToBlob(canvas, type = 'image/png') {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen de salida.')), type));
}
async function preparePackageForExport() {
    try {
        const allProducts = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
        const items = allProducts.filter(item => (item.packageId || 'default') === activePackageId);
        if (!items.length) { showToast('Todavía no hay prendas en esta colección.'); return; }
        await preparePackageImages(items);
        renderCollectionWorkspace(); updateUI(); await templateEditor.renderPreview();
        document.getElementById('managerStatus').textContent = `Paquete listo: ${items.length} prenda(s) preparadas. Puedes abrir cualquiera para retocar su máscara alfa.`;
        showToast(`Paquete preparado: ${items.length} prenda(s).`);
    } catch (error) {
        document.getElementById('managerStatus').textContent = `No se pudo preparar el paquete: ${error.message}`;
        showToast(`❌ No se pudo preparar el paquete: ${error.message}`);
    }
}
async function exportDesignedPackage() {
    if (typeof JSZip !== 'function') { showToast('❌ No se pudieron preparar las fotos para descargar.'); return; }
    try {
        await templateEditor.persist();
        const allProducts = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
        const items = allProducts.filter(item => (item.packageId || 'default') === activePackageId).sort((a, b) => a.id - b.id);
        if (!items.length) { showToast('Todavía no hay prendas para descargar.'); return; }
        const zip = new JSZip(); const input = zip.folder('input'); const output = zip.folder('output');
        await preparePackageImages(items);
        renderCollectionWorkspace(); updateUI(); await templateEditor.renderPreview();
        for (let index = 0; index < items.length; index += 1) {
            const item = items[index], number = index + 1;
            const frontPng = item.foto.type === 'image/png' ? item.foto : await convertToPng(item.foto);
            input.file(`foto_${number}_frontal.png`, frontPng);
            if (item.fotoReverso) {
                const backPng = item.fotoReverso.type === 'image/png' ? item.fotoReverso : await convertToPng(item.fotoReverso);
                input.file(`foto_${number}_reverso.png`, backPng);
            }
            input.file(`foto_${number}_datos.txt`, `Talla: ${item.talla || ''}\nPrecio: ${item.precio || ''}`);
            const canvas = document.createElement('canvas');
            await templateEditor.drawProductTemplate(canvas, item);
            output.file(`foto_${number}_frontal.png`, await canvasToBlob(canvas));
        }
        if (templateEditor.getBackground()) zip.file('bk_image.png', templateEditor.getBackground());
        zip.file('README.txt', `Paquete compatible con IMGAuto.py\nProductos: ${items.length}\nPlantilla renderizada en output/.\nFuentes transparentes y datos en input/.\n`);
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content); const link = document.createElement('a');
        link.href = url; link.download = `${activePackage().name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}_IMGAuto.zip`;
        document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast(`ZIP de «${activePackage().name}» listo.`);
    } catch (error) { showToast(`❌ No se pudieron descargar las fotos: ${error.message}`); }
}
async function initCamera() {
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); video.srcObject = null; }
    if (debugWithoutCamera) {
        cameraTrack = null; imageCapture = null; cameraCapabilities = {};
        video.classList.add('oculto'); debugCamera.classList.remove('oculto');
        cameraControls.classList.add('oculto'); captureBtn.classList.remove('oculto');
        syncCameraControls();
        return;
    }
    debugCamera.classList.add('oculto'); video.classList.remove('oculto'); cameraControls.classList.remove('oculto');
    const constraintsHighRes = { video: { facingMode: 'environment', width: { ideal: 2048 }, height: { ideal: 1536 } } };
    const constraintsStandard = { video: { facingMode: 'environment' } };
    try {
        let stream;
        try { stream = await navigator.mediaDevices.getUserMedia(constraintsHighRes); }
        catch { stream = await navigator.mediaDevices.getUserMedia(constraintsStandard); }
        video.srcObject = stream;
        cameraTrack = stream.getVideoTracks()[0];
        imageCapture = typeof ImageCapture === 'function' ? new ImageCapture(cameraTrack) : null;
        cameraCapabilities = cameraTrack.getCapabilities ? cameraTrack.getCapabilities() : {};
        flashEnabled = false;
        syncCameraControls();
    } catch (error) {
        cameraTrack = null; imageCapture = null; cameraCapabilities = {};
        syncCameraControls();
        showToast("❌ No se pudo acceder a la cámara: " + error.message);
    }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state === 'capturing' && !captureWorkspace.classList.contains('oculto')) initCamera();
});
captureBtn.addEventListener('click', async () => {
    if (captureBtn.disabled) return;
    captureBtn.disabled = true;
    try {
        const isNewCapture = state === 'capturing';
        const blob = debugWithoutCamera ? await createDebugCapture() : imageCapture ? await imageCapture.takePhoto() : await captureWithCanvas();
        if (!blob) throw new Error('La cámara no devolvió una imagen.');
        if (isNewCapture) { fotoBlob = blob; currentImageIsDemo = debugWithoutCamera; }
        else if (state === 'retaking') {
            if (retakeTarget === 'frontal') { fotoBlob = blob; fotoOriginalBlob = null; }
            else if (retakeTarget === 'reverso') { fotoReversoBlob = blob; fotoReversoOriginalBlob = null; }
            backgroundRemovedForCurrentProduct = false;
            currentImageIsDemo = debugWithoutCamera;
            skipBackgroundRemovalForCurrentProduct = debugWithoutCamera;
        }
        showReviewMode();
    } catch (error) {
        showToast(`❌ No se pudo capturar la imagen: ${error.message}`);
    } finally {
        captureBtn.disabled = state !== 'capturing' && state !== 'retaking';
    }
});
function createDebugCapture() {
    return new Promise((resolve, reject) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1200; canvas.height = 900;
        const context = canvas.getContext('2d');
        const gradient = context.createLinearGradient(0, 0, 1200, 900);
        gradient.addColorStop(0, '#263f3a'); gradient.addColorStop(1, '#101820');
        context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height);
        context.strokeStyle = 'rgba(67,214,173,.35)'; context.lineWidth = 3;
        context.strokeRect(48, 48, canvas.width - 96, canvas.height - 96);
        context.textAlign = 'center'; context.fillStyle = '#43d6ad';
        context.font = '700 34px sans-serif'; context.fillText('AUTOINDX · DEMO', 600, 350);
        context.fillStyle = '#f5f7fa'; context.font = '600 62px sans-serif';
        context.fillText('Producto de prueba', 600, 450);
        context.fillStyle = '#a8b8c5'; context.font = '28px sans-serif';
        context.fillText('Imagen generada en modo depuración', 600, 510);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen demo.')), 'image/jpeg', 0.9);
    });
}
function captureWithCanvas() {
    return new Promise((resolve, reject) => {
        if (!video.videoWidth || !video.videoHeight) { reject(new Error('La cámara aún no está lista.')); return; }
        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('No se pudo crear la imagen.')), 'image/jpeg', 0.9);
    });
}
function syncCameraControls() {
    const hasTorch = Boolean(cameraCapabilities.torch);
    flashBtn.classList.toggle('oculto', !hasTorch);
    flashBtn.classList.toggle('active', flashEnabled);
    flashBtn.setAttribute('aria-pressed', String(flashEnabled));
    gridToggleBtn.classList.toggle('active', compositionGridEnabled);
    gridToggleBtn.setAttribute('aria-pressed', String(compositionGridEnabled));
}
flashBtn.addEventListener('click', async () => {
    if (!cameraTrack) return;
    try {
        await cameraTrack.applyConstraints({ advanced: [{ torch: !flashEnabled }] });
        flashEnabled = !flashEnabled;
        syncCameraControls();
    } catch (error) { showToast('❌ Este dispositivo no pudo cambiar el flash.'); }
});
gridToggleBtn.addEventListener('click', () => {
    compositionGridEnabled = !compositionGridEnabled;
    localStorage.setItem('autoindx-composition-grid', String(compositionGridEnabled));
    syncCameraControls();
    compositionGrid.classList.toggle('oculto', !compositionGridEnabled || debugWithoutCamera || (state !== 'capturing' && state !== 'retaking'));
});

function openPicker(type) {
    const select = type === 'size' ? sizeSelect : priceSelect;
    pickerGrid.dataset.type = type;
    pickerTitle.textContent = type === 'size' ? 'Seleccionar talla' : 'Seleccionar precio';
    pickerGrid.innerHTML = '';
    Array.from(select.options).filter(option => option.value && option.dataset.customPrice !== 'true').forEach(option => {
        const choice = document.createElement('button');
        choice.type = 'button';
        choice.textContent = option.textContent;
        const sizeGroup = option.parentElement?.dataset.sizeGroup;
        if (sizeGroup) choice.dataset.sizeGroup = sizeGroup;
        choice.classList.toggle('selected', option.value === select.value);
        choice.setAttribute('aria-pressed', String(option.value === select.value));
        choice.addEventListener('click', () => {
            if (type === 'price') setPriceSelection(option.value);
            else select.value = option.value;
            syncPickerButtons();
            navigateBack(closePicker);
        });
        pickerGrid.appendChild(choice);
    });
    if (type === 'price') {
        const customChoice = document.createElement('button');
        customChoice.type = 'button';
        customChoice.className = 'custom-price-choice';
        customChoice.setAttribute('aria-label', 'Escribir un precio personalizado');
        const plus = document.createElement('span');
        plus.className = 'custom-price-plus';
        plus.textContent = '$ +';
        const label = document.createElement('span');
        label.textContent = 'Precio personalizado';
        customChoice.append(plus, label);
        customChoice.addEventListener('click', openCustomPriceModal);
        pickerGrid.appendChild(customChoice);
    }
    pushAppNavigation('picker', () => { closePicker(); return true; });
    pickerModal.classList.remove('oculto');
    const selected = pickerGrid.querySelector('.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
}
function closePicker() {
    pickerModal.classList.add('oculto');
}
function openCustomPriceModal() {
    const selectedOption = priceSelect.options[priceSelect.selectedIndex];
    const selectedValue = selectedOption?.dataset.customPrice === 'true'
        ? selectedOption.value.replace(/^\$/, '').replace(/,/g, '')
        : '';
    customPriceInput.value = selectedValue;
    customPriceError.classList.add('oculto');
    customPriceModal.classList.remove('oculto');
    pushAppNavigation('custom-price', closeCustomPriceModal);
    customPriceInput.focus();
}
function closeCustomPriceModal() {
    customPriceModal.classList.add('oculto');
    customPriceError.classList.add('oculto');
    return true;
}
function setPriceSelection(value) {
    priceSelect.querySelectorAll('option[data-custom-price="true"]').forEach(option => option.remove());
    const normalized = String(value || '');
    if (normalized && !Array.from(priceSelect.options).some(option => option.value === normalized)) {
        const option = document.createElement('option');
        option.value = normalized;
        option.textContent = normalized;
        option.dataset.customPrice = 'true';
        priceSelect.appendChild(option);
    }
    priceSelect.value = normalized;
}
async function saveCustomPrice() {
    const amount = Number(customPriceInput.value);
    const validAmount = Number.isFinite(amount) && amount > 0;
    const roundedAmount = validAmount ? Number(amount.toFixed(2)) : 0;
    if (!validAmount || roundedAmount <= 0) {
        customPriceError.textContent = 'Escribe un precio mayor que cero.';
        customPriceError.classList.remove('oculto');
        customPriceInput.focus();
        return;
    }
    const formattedPrice = `$${new Intl.NumberFormat('es-MX', { maximumFractionDigits: 2 }).format(roundedAmount)}`;
    setPriceSelection(formattedPrice);
    syncPickerButtons();
    await navigateBackAndWait(closeCustomPriceModal);
    navigateBack(closePicker);
}
function syncPickerButtons() {
    sizePickerValue.textContent = sizeSelect.value || 'Selecciona talla';
    pricePickerValue.textContent = priceSelect.value || 'Selecciona precio';
}
sizePickerBtn.addEventListener('click', () => openPicker('size'));
pricePickerBtn.addEventListener('click', () => openPicker('price'));
document.getElementById('pickerCloseBtn').addEventListener('click', () => navigateBack(closePicker));
pickerModal.addEventListener('click', event => { if (event.target === pickerModal) navigateBack(closePicker); });
document.getElementById('customPriceCancelBtn').addEventListener('click', () => navigateBack(closeCustomPriceModal));
document.getElementById('customPriceSaveBtn').addEventListener('click', saveCustomPrice);
customPriceInput.addEventListener('keydown', event => { if (event.key === 'Enter') saveCustomPrice(); });
customPriceModal.addEventListener('click', event => { if (event.target === customPriceModal) navigateBack(closeCustomPriceModal); });

function setReviewControlsDisabled(disabled) {
    reviewControls.querySelectorAll('button, select').forEach(control => { control.disabled = disabled; });
    reviewControls.classList.toggle('is-disabled', disabled);
}
function showCameraMode() {
    state = 'capturing'; retakeTarget = null;
    captureTitle.textContent = 'Tomar una foto';
    if (photoPreviewFrontal.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewFrontal.src);
    if (photoPreviewReverso.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewReverso.src);
    fotoBlob = null; fotoReversoBlob = null; fotoOriginalBlob = null; fotoReversoOriginalBlob = null;
    editingPhotoId = null; editingProductName = null;
    isProductEditor = false;
    productMaskEditingEnabled = false;
    backgroundRemovedForCurrentProduct = false; skipBackgroundRemovalForCurrentProduct = false; currentImageIsDemo = false;
    editorReturnToDashboard = false;
    preparingOverlay.classList.add('oculto'); alphaMaskEditor.close();
    sizeSelect.value = ""; setPriceSelection('');
    viewWrapper.classList.remove('review-mode');
    video.classList.toggle('oculto', debugWithoutCamera); debugCamera.classList.toggle('oculto', !debugWithoutCamera); previewContainer.classList.add('oculto');
    cameraControls.classList.toggle('oculto', debugWithoutCamera); captureBtn.classList.remove('oculto');
    captureBtn.disabled = false;
    compositionGrid.classList.toggle('oculto', !compositionGridEnabled || debugWithoutCamera);
    reviewControls.classList.remove('oculto');
    editorBanner.classList.add('oculto'); maskActions.classList.add('oculto');
    singlePhotoActions.classList.remove('oculto'); dualPhotoActions.classList.add('oculto');
    setReviewControlsDisabled(true);
    thumbnails.classList.remove('disabled-thumbnails');
    if (!video.srcObject || !video.srcObject.active || video.srcObject.getTracks().length === 0 || video.srcObject.getTracks()[0].readyState !== 'live') initCamera();
    syncPickerButtons();
    updateUI();
}
function showRetakeMode(target) {
    state = 'retaking'; retakeTarget = target;
    viewWrapper.classList.remove('review-mode');
    video.classList.toggle('oculto', debugWithoutCamera); debugCamera.classList.toggle('oculto', !debugWithoutCamera); previewContainer.classList.add('oculto');
    cameraControls.classList.toggle('oculto', debugWithoutCamera); captureBtn.classList.remove('oculto');
    captureBtn.disabled = false;
    compositionGrid.classList.add('oculto', !compositionGridEnabled || debugWithoutCamera);
    reviewControls.classList.remove('oculto'); setReviewControlsDisabled(true);
    thumbnails.classList.add('disabled-thumbnails');
    actionsDiv.classList.add('oculto');
    initCamera().then(() => {
        if (!debugWithoutCamera && !video.srcObject) { showToast('❌ No se pudo acceder a la cámara para retomar. Volviendo a la previsualización.'); showReviewMode(); }
    });
}
function showReviewMode() {
    state = 'review';
    if (video.srcObject) { video.srcObject.getTracks().forEach(track => track.stop()); video.srcObject = null; }
    cameraTrack = null; imageCapture = null; cameraCapabilities = {};
    cameraControls.classList.add('oculto'); captureBtn.classList.add('oculto'); debugCamera.classList.add('oculto');
    compositionGrid.classList.add('oculto');
    viewWrapper.classList.add('review-mode');
    syncCameraControls();
    previewContainer.classList.remove('oculto');
    reviewControls.classList.remove('oculto'); setReviewControlsDisabled(false); thumbnails.classList.add('disabled-thumbnails');
    maskActions.classList.toggle('oculto', !productMaskEditingEnabled);
    editorBanner.classList.toggle('oculto', !productMaskEditingEnabled);
    actionsDiv.classList.add('oculto');
    syncPickerButtons();
    if (fotoBlob) { if (photoPreviewFrontal.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewFrontal.src); photoPreviewFrontal.src = URL.createObjectURL(fotoBlob); } else { photoPreviewFrontal.src = ''; }
    if (fotoReversoBlob) {
        if (photoPreviewReverso.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewReverso.src); photoPreviewReverso.src = URL.createObjectURL(fotoReversoBlob);
        previewContainer.classList.add('dual-view'); photoPreviewReverso.classList.remove('oculto');
        singlePhotoActions.classList.add('oculto'); dualPhotoActions.classList.remove('oculto');
    } else {
        previewContainer.classList.remove('dual-view'); photoPreviewReverso.classList.add('oculto');
        if (photoPreviewReverso.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewReverso.src);
        singlePhotoActions.classList.remove('oculto'); dualPhotoActions.classList.add('oculto');
    }
    const cropBackBtn = document.getElementById('cropBackBtn');
    cropBackBtn.disabled = !fotoReversoBlob;
    cropBackBtn.title = fotoReversoBlob ? 'Retocar máscara alfa del reverso' : 'Añade una foto de reverso para retocar su máscara';
    updateUI();
}

addReversoBtn.onclick = () => showRetakeMode('reverso');
retakeSingleBtn.onclick = () => showRetakeMode('frontal');
cancelSingleBtn.onclick = cancelCurrentReview;
retakeFrontalBtn.onclick = () => showRetakeMode('frontal');
retakeReversoBtn.onclick = () => showRetakeMode('reverso');
deleteReversoBtn.onclick = async () => {
    if (await askForConfirmation("¿Eliminar solo la foto de reverso?")) {
        if (photoPreviewReverso.src.startsWith('blob:')) URL.revokeObjectURL(photoPreviewReverso.src);
        fotoReversoBlob = null; showToast("Reverso eliminado."); showReviewMode();
    }
};
cancelDualBtn.onclick = cancelCurrentReview;
saveSingleBtn.onclick = handleSave;
saveDualBtn.onclick = handleSave;

function cancelCurrentReview() {
    if (editorReturnToDashboard) {
        state = 'capturing';
        navigateBack(() => showCollectionDashboard());
    } else {
        showCameraMode();
    }
}
async function handleSave() {
    if (!fotoBlob) { showToast("⚠️ No hay foto frontal para guardar."); return; }
    if (!sizeSelect.value || !priceSelect.value) { showToast("⚠️ Selecciona talla y precio antes de guardar."); return; }
    const tx = db.transaction(OBJECT_STORE_NAME, "readwrite");
    const store = tx.objectStore(OBJECT_STORE_NAME);
    const record = {
        foto: fotoBlob,
        fotoOriginal: fotoOriginalBlob,
        talla: sizeSelect.value,
        precio: priceSelect.value,
        fotoReverso: fotoReversoBlob,
        fotoReversoOriginal: fotoReversoOriginalBlob,
        packageId: activePackageId,
        nombre: editingProductName || `Prenda ${Date.now()}`,
        fondoEliminado: backgroundRemovedForCurrentProduct,
        demo: currentImageIsDemo
    };
    if (editingPhotoId !== null) { record.id = editingPhotoId; store.put(record); }
    else { store.add(record); }
    tx.oncomplete = () => {
        showToast(editingPhotoId ? "✅ Producto actualizado" : "✅ Producto guardado");
        const returnToDashboard = editorReturnToDashboard;
        if (returnToDashboard) {
            state = 'capturing';
            navigateBack(() => showCollectionDashboard());
        } else {
            showCameraMode();
        }
        renderCollectionWorkspace();
        templateEditor.renderPreview().catch(error => showToast(`❌ No se pudo actualizar la vista previa: ${error.message}`));
    };
    tx.onerror = () => { showToast("❌ Error al guardar el producto."); };
}
function convertToPng(blob) {
    return new Promise((resolve, reject) => {
        const img = document.createElement('img');
        const url = URL.createObjectURL(blob);
        img.onload = () => {
            const canvas = document.createElement('canvas'); canvas.width = img.width; canvas.height = img.height;
            const context = canvas.getContext('2d');
            if (!context) { URL.revokeObjectURL(url); reject(new Error('No se pudo preparar la imagen.')); return; }
            context.drawImage(img, 0, 0);
            canvas.toBlob(result => {
                URL.revokeObjectURL(url);
                if (result) resolve(result); else reject(new Error('No se pudo guardar la imagen PNG.'));
            }, 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo abrir la imagen.')); };
        img.src = url;
    });
}
function convertToJpg(blob) {
    return new Promise(resolve => {
        const img = document.createElement('img');
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width; canvas.height = img.height;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob(resolve, 'image/jpeg', 0.85); URL.revokeObjectURL(img.src);
        };
        img.src = URL.createObjectURL(blob);
    });
}

clearDataBtn.onclick = async () => {
    try {
        const records = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
        const recordsToDelete = records.filter(item => (item.packageId || 'default') === activePackageId);
        if (!recordsToDelete.length) return;
        const current = activePackage();
        const message = `¿Vaciar «${current ? current.name : 'esta colección'}»? Se eliminarán ${recordsToDelete.length} prendas. Las demás colecciones no cambiarán.`;
        if (!await askForConfirmation(message)) return;
        await new Promise((resolve, reject) => {
            const transaction = db.transaction(OBJECT_STORE_NAME, 'readwrite');
            const store = transaction.objectStore(OBJECT_STORE_NAME);
            recordsToDelete.forEach(item => store.delete(item.id));
            transaction.oncomplete = resolve;
            transaction.onerror = () => reject(transaction.error || new Error('No se pudieron eliminar los productos.'));
            transaction.onabort = () => reject(transaction.error || new Error('Se canceló la eliminación.'));
        });
        showToast(`Se vació «${current ? current.name : 'la colección'}».`);
        thumbnailURLs.forEach(url => URL.revokeObjectURL(url)); thumbnailURLs = [];
        updateUI(); renderCollectionWorkspace();
    } catch (error) {
        showToast(`❌ No se pudo vaciar la colección: ${error.message}`);
    }
};
async function exportCollectionZip(packageId) {
    try {
        if (typeof JSZip !== 'function') throw new Error('No está disponible la herramienta para crear archivos ZIP.');
        const packageInfo = packages.find(item => item.id === packageId);
        if (!packageInfo) throw new Error('No se encontró la colección para exportar.');
        const allProducts = await storeRequest(OBJECT_STORE_NAME, 'readonly', 'getAll');
        const photos = allProducts
            .filter(item => (item.packageId || 'default') === packageId)
            .sort((left, right) => left.id - right.id);
        if (photos.length === 0) { showToast('No hay fotos para exportar.'); return; }
        const zip = new JSZip();
        photos.forEach((item, index) => {
            const photoIndex = index + 1;
            if (item.foto) zip.file(`foto_${photoIndex}_frontal.${item.foto.type === 'image/png' ? 'png' : 'jpg'}`, item.foto);
            if (item.fotoReverso) zip.file(`foto_${photoIndex}_reverso.${item.fotoReverso.type === 'image/png' ? 'png' : 'jpg'}`, item.fotoReverso);
            zip.file(`foto_${photoIndex}_datos.txt`, `Talla: ${item.talla || ''}\nPrecio: ${item.precio || ''}`);
        });
        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const link = document.createElement('a');
        link.href = url;
        link.download = `${packageInfo.name.replace(/[^\p{L}\p{N}_-]+/gu, '_')}.zip`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        showToast('Descarga ZIP iniciada.');
    } catch (error) {
        showToast(`❌ No se pudo exportar la colección: ${error.message}`);
    }
}
saveZipBtn.addEventListener('click', () => exportCollectionZip(activePackageId));

function executeDelete(photoId, frontalUrl, reversoUrl) {
    if (!db) return;
    const transaction = db.transaction(OBJECT_STORE_NAME, "readwrite");
    transaction.objectStore(OBJECT_STORE_NAME).delete(photoId);
    transaction.oncomplete = () => {
        showToast("Foto eliminada.");
        if (frontalUrl) URL.revokeObjectURL(frontalUrl);
        if (reversoUrl) URL.revokeObjectURL(reversoUrl);
        updateUI(); renderCollectionWorkspace();
    };
    transaction.onerror = () => { showToast("❌ Error al eliminar la foto."); };
}
function askForConfirmation(message, { yesLabel = 'Sí', noLabel = 'No', destructive = true } = {}) {
    return new Promise(resolve => {
        const modal = document.getElementById('custom-confirm');
        document.getElementById('modal-message').textContent = message;
        modal.classList.remove('oculto');
        const yesBtn = document.getElementById('confirm-yes');
        const noBtn = document.getElementById('confirm-no');
        yesBtn.textContent = yesLabel; noBtn.textContent = noLabel;
        yesBtn.classList.toggle('modal-button-yes', destructive);
        yesBtn.classList.toggle('modal-button-primary', !destructive);
        let answer = false;
        let settled = false;
        const cleanup = result => {
            if (settled) return;
            settled = true;
            modal.classList.add('oculto');
            yesBtn.onclick = null; noBtn.onclick = null;
            yesBtn.textContent = 'Sí'; noBtn.textContent = 'No';
            yesBtn.classList.toggle('modal-button-yes', true);
            yesBtn.classList.toggle('modal-button-primary', false);
            resolve(result);
        };
        pushAppNavigation('confirmation', () => { cleanup(answer); return true; });
        yesBtn.onclick = () => { answer = true; navigateBack(() => cleanup(true)); };
        noBtn.onclick = () => navigateBack(() => cleanup(false));
    });
}
function showToast(message) {
    const toast = document.getElementById('toast-notification');
    toast.textContent = message; toast.classList.remove('oculto'); void toast.offsetWidth; toast.classList.add('show');
    setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.classList.add('oculto'), 500); }, 2500);
}
function updateUI() {
    if (!db) return;
    const renderVersion = ++thumbnailRenderVersion;
    const packageId = activePackageId;
    const request = db.transaction(OBJECT_STORE_NAME, "readonly").objectStore(OBJECT_STORE_NAME).getAll();
    request.onsuccess = () => {
        if (renderVersion !== thumbnailRenderVersion || packageId !== activePackageId) return;
        const photos = request.result;
        const packagePhotos = photos.filter(item => (item.packageId || 'default') === packageId);
        const count = packagePhotos.length;
        actionsDiv.classList.toggle('oculto', count === 0 || collectionDashboard.classList.contains('oculto'));
        if (!collectionWorkspace.classList.contains('oculto')) countBadge.textContent = `${count} ${count === 1 ? 'prenda' : 'prendas'}`;
        const fragment = document.createDocumentFragment();
        const nextThumbnailURLs = [];
        packagePhotos.sort((a, b) => b.id - a.id);
        packagePhotos.forEach(photoData => {
            const container = document.createElement('div'); container.className = 'thumbnail-container';
            const editButton = document.createElement('button'); editButton.type = 'button'; editButton.className = 'thumbnail-edit';
            editButton.setAttribute('aria-label', `Editar ${photoData.nombre || `prenda ${photoData.id}`}`);
            const img = document.createElement('img');
            img.alt = photoData.nombre || `Prenda ${photoData.id}`;
            const url = URL.createObjectURL(photoData.foto); img.src = url; nextThumbnailURLs.push(url);
            editButton.appendChild(img);
            editButton.addEventListener('click', () => enterProductEditor(photoData, { allowMaskEditing: false }));
            container.appendChild(editButton);
            if (photoData.fotoReverso) { const indicator = document.createElement('span'); indicator.className = 'thumbnail-indicator'; indicator.textContent = '2'; container.appendChild(indicator); }
            const deleteButton = document.createElement('button');
            deleteButton.type = 'button'; deleteButton.className = 'thumbnail-delete';
            deleteButton.textContent = '×';
            deleteButton.setAttribute('aria-label', `Eliminar ${photoData.nombre || `prenda ${photoData.id}`}`);
            deleteButton.addEventListener('click', async () => {
                if (await askForConfirmation("¿Deseas eliminar esta foto?")) {
                    const reversoUrlToRevoke = photoData.fotoReverso ? URL.createObjectURL(photoData.fotoReverso) : null;
                    executeDelete(photoData.id, img.src, reversoUrlToRevoke);
                }
            });
            container.appendChild(deleteButton);
            fragment.appendChild(container);
        });
        thumbnails.replaceChildren(fragment);
        thumbnailURLs.forEach(url => URL.revokeObjectURL(url));
        thumbnailURLs = nextThumbnailURLs;
    };
    request.onerror = () => {
        if (renderVersion === thumbnailRenderVersion) showToast("❌ Error al cargar las miniaturas.");
    };
}
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const serviceWorkerUrl = new URL('./sw.js', document.baseURI);
    const serviceWorkerScope = new URL('./', document.baseURI).pathname;
    navigator.serviceWorker.register(serviceWorkerUrl, { scope: serviceWorkerScope })
        .catch(error => console.error('No se pudo habilitar el modo instalable sin conexión:', error));
}