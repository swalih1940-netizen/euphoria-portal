const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gallery.json');
const UPLOADS_DIR = path.join(__dirname, '..', 'public', 'uploads', 'gallery');

// In-memory cache to guarantee zero downtime in serverless/read-only environments
let inMemoryPhotos = null;

// Ensure storage directories exist safely without throwing errors
function ensureDirs() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {
        // Read-only filesystem or serverless execution; suppress
    }
    try {
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
    } catch (e) {
        // Read-only filesystem or serverless execution; suppress
    }
}

// Initial curated festival photos from existing assets
const INITIAL_PHOTOS = [];

// Read photos from storage file (guaranteeing persistent state without resurrecting deleted demo photos)
function readPhotos() {
    ensureDirs();
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                inMemoryPhotos = parsed;
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        console.warn('[GalleryService] Notice: reading data file:', e.message);
    }

    if (inMemoryPhotos !== null && Array.isArray(inMemoryPhotos)) {
        return inMemoryPhotos;
    }

    // Only if file has never been created at all on a completely fresh initialization
    inMemoryPhotos = [...INITIAL_PHOTOS];
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
    } catch (e) {
        // Read-only filesystem / serverless, memory fallback is set
    }
    return inMemoryPhotos;
}

// Write photos to storage file
function writePhotos(photos) {
    inMemoryPhotos = Array.isArray(photos) ? [...photos] : [];
    ensureDirs();
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
        console.log(`[GalleryService] Successfully updated ${DATA_FILE} (${inMemoryPhotos.length} photos remaining)`);
        return true;
    } catch (e) {
        console.error('[GalleryService] Notice: writing data file (persisted in-memory):', e.message);
        return false;
    }
}

/**
 * Fetch all gallery photos sorted newest first
 */
function getAllPhotos() {
    const photos = readPhotos();
    return [...photos].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
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
 * Save new photo with image compression / storage handling
 */
function savePhoto({ title, caption, category, house, imageUrl, imageData, originalSize, compressedSize, originalFilename }) {
    ensureDirs();
    const photos = readPhotos();
    let finalImageUrl = imageUrl;

    // Retain clean original file name (strip extension if present for title)
    let cleanBaseName = '';
    if (originalFilename) {
        cleanBaseName = path.basename(originalFilename).replace(/\.[^/.]+$/, '').trim();
    } else if (title) {
        cleanBaseName = title.trim();
    }
    const safeBaseName = (cleanBaseName || 'Euphoria_Photo').replace(/[^a-zA-Z0-9_\-\s]/g, '').trim().replace(/\s+/g, '_') || 'Euphoria_Photo';

    // Handle base64 image data if provided (saved to public/uploads/gallery/)
    if (imageData && imageData.startsWith('data:image')) {
        const matches = imageData.match(/^data:image\/([a-zA-Z0-9+]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            const rawExt = matches[1].toLowerCase();
            const ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
            const buffer = Buffer.from(matches[2], 'base64');
            
            let filename = `${safeBaseName}.${ext}`;
            try {
                if (fs.existsSync(path.join(UPLOADS_DIR, filename))) {
                    filename = `${safeBaseName}_${Date.now()}.${ext}`;
                }
                const filepath = path.join(UPLOADS_DIR, filename);
                fs.writeFileSync(filepath, buffer);
                finalImageUrl = `/uploads/gallery/${filename}`;
            } catch (diskErr) {
                console.warn('[GalleryService] Local upload write failed (serverless fallback to data URI):', diskErr.message);
                finalImageUrl = imageData;
            }
        }
    }

    if (!finalImageUrl) {
        throw new Error('No valid image URL or image data provided');
    }

    const newPhoto = {
        id: 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        title: originalFilename || cleanBaseName || title || 'Euphoria Photo',
        originalFilename: originalFilename || '',
        caption: (caption || '').trim(),
        category: category || 'Stage & Performance',
        house: house || 'General',
        imageUrl: finalImageUrl,
        size: originalSize || 'Optimized',
        compressedSize: compressedSize || 'Optimized',
        uploadedAt: new Date().toISOString()
    };

    photos.unshift(newPhoto);
    writePhotos(photos);
    return newPhoto;
}

/**
 * Save multiple photos at once
 */
function savePhotos(photosArray) {
    if (!Array.isArray(photosArray) || photosArray.length === 0) return [];
    return photosArray.map(p => savePhoto(p));
}

/**
 * Delete a photo by ID, imageUrl, originalFilename or title, and permanently remove physical file from storage
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

    // Attempt to remove physical file if stored on server disk
    let fileDeleted = false;
    let deletedFilePath = null;
    let fileError = null;

    if (photo.imageUrl) {
        const publicDir = path.resolve(__dirname, '..', 'public');
        const candidatePaths = [];

        let imgUrlClean = String(photo.imageUrl).split('?')[0].split('#')[0].trim();
        if (imgUrlClean.startsWith('http://') || imgUrlClean.startsWith('https://')) {
            try {
                imgUrlClean = new URL(imgUrlClean).pathname;
            } catch (e) {}
        }
        try {
            imgUrlClean = decodeURIComponent(imgUrlClean);
        } catch (e) {}
        imgUrlClean = imgUrlClean.replace(/\\/g, '/');

        // 1. Direct path relative to public/
        const relPath = imgUrlClean.startsWith('/') ? imgUrlClean.slice(1) : imgUrlClean;
        candidatePaths.push(path.resolve(publicDir, relPath));

        // 2. Direct inside uploads/gallery/
        const fileName = path.basename(imgUrlClean);
        candidatePaths.push(path.resolve(UPLOADS_DIR, fileName));
        candidatePaths.push(path.resolve(publicDir, 'uploads', fileName));
        candidatePaths.push(path.resolve(publicDir, 'images', fileName));

        // Deduplicate paths
        const uniquePaths = Array.from(new Set(candidatePaths));

        for (const targetPath of uniquePaths) {
            // Guard against directory traversal outside public directory
            if (!targetPath.startsWith(publicDir)) continue;

            try {
                if (fs.existsSync(targetPath)) {
                    const stat = fs.statSync(targetPath);
                    if (stat.isFile()) {
                        fs.unlinkSync(targetPath);
                        fileDeleted = true;
                        deletedFilePath = targetPath;
                        console.log(`[GalleryService] Permanently deleted physical image file: ${targetPath}`);
                        break;
                    }
                }
            } catch (err) {
                fileError = err.message;
                console.error(`[GalleryService] Failed to unlink file ${targetPath}:`, err.message);
            }
        }

        if (!fileDeleted && !deletedFilePath) {
            console.log(`[GalleryService] Note: No physical file found on disk for "${photo.imageUrl}" (may be external or already deleted).`);
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
        deletedFilePath,
        fileError,
        remainingCount: photos.length
    };
}

module.exports = {
    getAllPhotos,
    getPhotosByCategory,
    savePhoto,
    savePhotos,
    deletePhoto,
    INITIAL_PHOTOS
};

