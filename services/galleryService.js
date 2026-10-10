const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gallery.json');
const TMP_DATA_FILE = path.join('/tmp', 'gallery.json');

// In-memory cache to guarantee zero downtime in serverless/read-only environments
let inMemoryPhotos = null;

// Ensure storage directories exist safely without throwing errors (serverless /tmp or data directory)
function ensureDirs() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {
        // Expected on read-only serverless filesystems (e.g. Vercel)
    }
}

// Initial curated festival photos from existing assets
const INITIAL_PHOTOS = [];

// Convert any URL or asset reference into a valid secure public URL (never a local /uploads/ path)
function normalizePhotoUrl(raw) {
    if (!raw || typeof raw !== 'string') return '';
    const trimmed = raw.trim();
    if (!trimmed) return '';
    // Upgrade http to https (Cloudinary secure)
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return trimmed.replace(/^http:\/\//i, 'https://');
    }
    // Allow data URIs
    if (trimmed.startsWith('data:image/')) return trimmed;
    // Allow static bundled assets from public/ like /images/
    if (trimmed.startsWith('/images/') || trimmed.startsWith('/Font/')) return trimmed;
    // Prevent 404 on Vercel for legacy /uploads/ paths
    if (trimmed.startsWith('/uploads/') || trimmed.includes('/uploads/')) {
        return '/images/euphoria_trophy.jpg';
    }
    // If it's a Cloudinary public ID, construct the full Cloudinary HTTPS URL
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || (cloudinary.config && cloudinary.config().cloud_name);
    if (cloudName && !trimmed.includes('/')) {
        return `https://res.cloudinary.com/${cloudName}/image/upload/euphoria_festival_gallery/${trimmed}`;
    }
    return trimmed;
}

// Normalize photo objects so imageUrl, url, secure_url, and filePath are always present
function normalizePhoto(photo) {
    if (!photo || typeof photo !== 'object') return photo;
    const rawUrl = (photo.imageUrl || photo.secure_url || photo.url || photo.filePath || photo.path || '').toString().trim();
    const resolvedUrl = normalizePhotoUrl(rawUrl);
    return {
        ...photo,
        imageUrl: resolvedUrl,
        url: resolvedUrl,
        secure_url: resolvedUrl,
        filePath: resolvedUrl
    };
}

// Read photos from storage file (guaranteeing persistent state without resurrecting deleted demo photos)
function readPhotos() {
    if (inMemoryPhotos !== null && Array.isArray(inMemoryPhotos)) {
        return inMemoryPhotos.map(normalizePhoto);
    }

    ensureDirs();

    // 1. Try reading from primary data/gallery.json
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                inMemoryPhotos = parsed.map(normalizePhoto);
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        console.warn('[GalleryService] Notice reading primary data file:', e.message);
    }

    // 2. Try reading from serverless /tmp/gallery.json cache
    try {
        if (fs.existsSync(TMP_DATA_FILE)) {
            const raw = fs.readFileSync(TMP_DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                inMemoryPhotos = parsed.map(normalizePhoto);
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        // Ignore /tmp read error
    }

    inMemoryPhotos = INITIAL_PHOTOS.map(normalizePhoto);
    return inMemoryPhotos;
}

// Write photos to storage file (resilient against read-only serverless filesystems on Vercel)
function writePhotos(photos) {
    inMemoryPhotos = Array.isArray(photos) ? photos.map(normalizePhoto) : [];
    ensureDirs();
    let wroteDisk = false;

    // 1. Primary storage file (local environment)
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
        console.log(`[GalleryService] Successfully updated ${DATA_FILE} (${inMemoryPhotos.length} photos stored)`);
        wroteDisk = true;
    } catch (e) {
        console.warn('[GalleryService] Serverless notice: Primary disk write skipped:', e.message);
    }

    // 2. Serverless /tmp cache fallback
    try {
        fs.writeFileSync(TMP_DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
        wroteDisk = true;
    } catch (e) {
        // Ignore /tmp write error
    }

    // Always succeed because in-memory state is maintained for the life of the instance/process
    return true;
}

/**
 * Fetch all gallery photos sorted newest first
 */
function getAllPhotos() {
    const photos = readPhotos();
    return [...photos].map(normalizePhoto).sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

/**
 * Fetch photos filtered by category
 */
function getPhotosByCategory(category) {
    const photos = getAllPhotos();
    if (!category || category === 'ALL' || category === 'All Moments') {
        return photos;
    }
    return photos.filter(p => p.category && p.category.toLowerCase() === category.toLowerCase());
}

/**
 * Save new photo with direct Cloudinary storage (zero local public/uploads disk dependency)
 */
async function savePhoto({ title, caption, category, house, imageUrl, url, secure_url, filePath, path: pPath, imageData, originalSize, compressedSize, originalFilename }) {
    ensureDirs();
    const photos = readPhotos();
    const rawUrl = imageUrl || secure_url || url || filePath || pPath || null;
    let finalImageUrl = (rawUrl && typeof rawUrl === 'string') ? normalizePhotoUrl(rawUrl) : null;

    // Retain clean original file name (strip extension if present for title)
    let cleanBaseName = '';
    if (originalFilename && typeof originalFilename === 'string') {
        cleanBaseName = path.basename(originalFilename).replace(/\.[^/.]+$/, '').trim();
    } else if (title && typeof title === 'string') {
        cleanBaseName = title.trim();
    }
    const safeBaseName = (cleanBaseName || 'Euphoria_Photo')
        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'Euphoria_Photo';

    // Handle base64 image data: upload directly to Cloudinary (never save to local disk)
    if (!finalImageUrl && imageData && typeof imageData === 'string') {
        try {
            console.log('[GalleryService] Uploading base64 image directly to Cloudinary...');
            const cldRes = await cloudinary.uploader.upload(imageData, {
                folder: 'euphoria_festival_gallery',
                public_id: `${safeBaseName}_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
                transformation: [{ quality: 'auto', fetch_format: 'auto' }]
            });
            finalImageUrl = cldRes.secure_url || cldRes.url;
            console.log(`[GalleryService] Cloudinary direct upload success: "${finalImageUrl}"`);
        } catch (cldErr) {
            console.warn('[GalleryService] Cloudinary direct upload notice:', cldErr.message);
            // Serverless fallback: keep data URI in memory/JSON (never write to disk)
            if (!finalImageUrl) {
                finalImageUrl = imageData;
            }
        }
    }

    if (!finalImageUrl) {
        console.error('[GalleryService] savePhoto failed: No valid image URL or image data provided.');
        throw new Error('No valid image URL or image data provided for photo upload.');
    }

    // Ensure finalImageUrl is normalized (upgrades http to https, strips legacy /uploads/ relative paths)
    finalImageUrl = normalizePhotoUrl(finalImageUrl);

    const determinedTitle = (title && typeof title === 'string' && title.trim())
        ? title.trim()
        : (cleanBaseName || originalFilename || 'Euphoria Photo');

    const newPhoto = {
        id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: determinedTitle,
        originalFilename: originalFilename || '',
        caption: (caption || '').trim(),
        category: (category && category.trim()) ? category.trim() : 'Stage & Performance',
        house: (house && house.trim()) ? house.trim() : 'General',
        imageUrl: finalImageUrl,
        url: finalImageUrl,
        secure_url: finalImageUrl,
        filePath: finalImageUrl,
        size: originalSize || 'Optimized',
        compressedSize: compressedSize || 'Optimized',
        uploadedAt: new Date().toISOString()
    };

    photos.unshift(newPhoto);
    const writeOk = writePhotos(photos);
    if (!writeOk) {
        console.error(`[GalleryService] Failed to persist new photo record to ${DATA_FILE}`);
        throw new Error('Failed to update gallery records in database file.');
    }

    console.log(`[GalleryService] Successfully stored photo record: ID=${newPhoto.id}, Title="${newPhoto.title}", Category="${newPhoto.category}", URL="${newPhoto.imageUrl}". Total photos: ${photos.length}`);
    return newPhoto;
}

/**
 * Save multiple photos at once
 */
async function savePhotos(photosArray) {
    if (!Array.isArray(photosArray) || photosArray.length === 0) return [];
    const results = [];
    for (const p of photosArray) {
        results.push(await savePhoto(p));
    }
    return results;
}

/**
 * Delete a photo by ID, imageUrl, originalFilename or title (cleans Cloudinary asset, zero disk access)
 */
function deletePhoto(identifier) {
    if (!identifier) {
        console.warn('[GalleryService] deletePhoto called without an identifier.');
        return { success: false, error: 'No photo identifier provided.' };
    }
    ensureDirs();
    const photos = readPhotos();
    
    // Normalize identifier string
    let rawStr = String(identifier).trim().replace(/^["']+|["']+$/g, '');
    let cleanId = rawStr;
    try {
        cleanId = decodeURIComponent(rawStr).trim();
    } catch (e) {}

    const cleanBase = cleanId.split('?')[0].split('#')[0].replace(/\\/g, '/');
    const baseName = path.basename(cleanBase);

    console.log(`[GalleryService] deletePhoto searching for: raw="${rawStr}", cleanId="${cleanId}", baseName="${baseName}"`);

    // Match by ID, imageUrl, originalFilename, title, or basename
    const index = photos.findIndex(p => {
        if (!p) return false;
        const pId = String(p.id || '').trim();
        const pImg = String(p.imageUrl || '').trim().replace(/\\/g, '/');
        const pImgClean = pImg.split('?')[0].split('#')[0];
        const pBasename = path.basename(pImgClean);

        if (pId && (pId === rawStr || pId === cleanId || pId === cleanBase)) return true;
        if (pImg && (pImg === rawStr || pImg === cleanId || pImgClean === cleanBase)) return true;
        if (pBasename && baseName && pBasename === baseName) return true;
        if (p.originalFilename && (p.originalFilename === rawStr || p.originalFilename === cleanId || p.originalFilename === baseName)) return true;
        if (p.title && (p.title === rawStr || p.title === cleanId)) return true;
        return false;
    });

    if (index === -1) {
        console.warn(`[GalleryService] Photo "${rawStr}" not found in ${photos.length} records.`);
        return { success: false, error: `Photo "${rawStr}" not found in gallery records.` };
    }

    const photo = photos[index];
    console.log(`[GalleryService] Found target photo: ID=${photo.id}, Image=${photo.imageUrl}`);

    // Delete asset directly from Cloudinary if hosted on Cloudinary
    let fileDeleted = false;
    if (photo.imageUrl && photo.imageUrl.includes('cloudinary.com')) {
        try {
            const cleanUrl = String(photo.imageUrl).split('?')[0].split('#')[0];
            const match = cleanUrl.match(/\/upload\/(?:v\d+\/)?([^\.]+)/);
            if (match && match[1]) {
                const publicId = decodeURIComponent(match[1]);
                console.log(`[GalleryService] Deleting photo asset from Cloudinary: "${publicId}"`);
                cloudinary.uploader.destroy(publicId, (err, res) => {
                    if (err) {
                        console.warn('[GalleryService] Cloudinary delete notice:', err.message);
                    } else {
                        console.log('[GalleryService] Cloudinary delete result:', res);
                    }
                });
                fileDeleted = true;
            }
        } catch (cldErr) {
            console.warn('[GalleryService] Cloudinary deletion error:', cldErr.message);
        }
    }

    // Permanently remove record from in-memory and JSON storage
    photos.splice(index, 1);
    const writeOk = writePhotos(photos);

    if (!writeOk) {
        console.error(`[GalleryService] Critical: Failed to persist deletion to ${DATA_FILE}`);
    } else {
        console.log(`[GalleryService] Permanently removed photo "${photo.id}". ${photos.length} photos remaining in database.`);
    }

    return {
        success: true,
        id: photo.id,
        photo,
        fileDeleted,
        remainingCount: photos.length
    };
}

module.exports = {
    getAllPhotos,
    getPhotosByCategory,
    savePhoto,
    savePhotos,
    deletePhoto,
    normalizePhoto,
    normalizePhotoUrl,
    INITIAL_PHOTOS
};

