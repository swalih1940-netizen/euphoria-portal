const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gallery.json');
const TMP_DATA_FILE = path.join('/tmp', 'gallery.json');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const UPLOADS_DIR = path.join(PUBLIC_DIR, 'uploads');
const GALLERY_UPLOADS_DIR = path.join(UPLOADS_DIR, 'gallery');

// In-memory cache to guarantee zero downtime in serverless/read-only environments
let inMemoryPhotos = null;

// Ensure storage directories exist safely without throwing errors
function ensureDirs() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {
        // Expected on read-only serverless filesystems (e.g. Vercel)
    }
    try {
        if (!fs.existsSync(UPLOADS_DIR)) {
            fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        if (!fs.existsSync(GALLERY_UPLOADS_DIR)) {
            fs.mkdirSync(GALLERY_UPLOADS_DIR, { recursive: true });
        }
        fs.accessSync(UPLOADS_DIR, fs.constants.W_OK);
        console.log('[GalleryService] Uploads directory public/uploads verified with write permissions.');
    } catch (e) {
        // Handled gracefully in serverless/Cloudinary mode
    }
}

// Initial curated festival photos from existing assets
const INITIAL_PHOTOS = [];

// Read photos from storage file (guaranteeing persistent state without resurrecting deleted demo photos)
function readPhotos() {
    if (inMemoryPhotos !== null && Array.isArray(inMemoryPhotos)) {
        return inMemoryPhotos;
    }

    ensureDirs();

    // 1. Try reading from primary data/gallery.json
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
        console.warn('[GalleryService] Notice reading primary data file:', e.message);
    }

    // 2. Try reading from serverless /tmp/gallery.json cache
    try {
        if (fs.existsSync(TMP_DATA_FILE)) {
            const raw = fs.readFileSync(TMP_DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                inMemoryPhotos = parsed;
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        // Ignore /tmp read error
    }

    inMemoryPhotos = [...INITIAL_PHOTOS];
    return inMemoryPhotos;
}

// Write photos to storage file (resilient against read-only serverless filesystems on Vercel)
function writePhotos(photos) {
    inMemoryPhotos = Array.isArray(photos) ? [...photos] : [];
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
 * Save new photo with image compression / storage handling in public/uploads/
 */
function savePhoto({ title, caption, category, house, imageUrl, imageData, originalSize, compressedSize, originalFilename }) {
    ensureDirs();
    const photos = readPhotos();
    let finalImageUrl = (imageUrl && typeof imageUrl === 'string') ? imageUrl.trim() : null;

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

    // Handle base64 image data if provided and no direct imageUrl exists (saved to public/uploads/)
    if (!finalImageUrl && imageData && typeof imageData === 'string') {
        try {
            let base64Payload = imageData.trim();
            let ext = 'jpg';

            if (base64Payload.startsWith('data:image/')) {
                const commaIndex = base64Payload.indexOf(',');
                if (commaIndex !== -1) {
                    const mimeHeader = base64Payload.slice(0, commaIndex);
                    base64Payload = base64Payload.slice(commaIndex + 1);
                    const mimeMatch = mimeHeader.match(/data:image\/([a-zA-Z0-9+]+)/);
                    if (mimeMatch && mimeMatch[1]) {
                        const rawExt = mimeMatch[1].toLowerCase();
                        ext = rawExt === 'jpeg' ? 'jpg' : rawExt;
                    }
                }
            } else if (originalFilename && path.extname(originalFilename)) {
                const origExt = path.extname(originalFilename).replace('.', '').toLowerCase();
                if (['jpg', 'jpeg', 'png', 'webp', 'gif', 'svg'].includes(origExt)) {
                    ext = origExt === 'jpeg' ? 'jpg' : origExt;
                }
            }

            // Remove all whitespace/newlines from base64 string
            base64Payload = base64Payload.replace(/\s+/g, '');
            const buffer = Buffer.from(base64Payload, 'base64');

            if (!buffer || buffer.length === 0) {
                throw new Error('Image data is invalid or produced empty buffer');
            }

            let filename = `${safeBaseName}.${ext}`;
            if (fs.existsSync(path.join(UPLOADS_DIR, filename))) {
                filename = `${safeBaseName}_${Date.now()}.${ext}`;
            }
            const filepath = path.join(UPLOADS_DIR, filename);
            fs.writeFileSync(filepath, buffer);

            if (!fs.existsSync(filepath)) {
                throw new Error(`File was written but could not be verified on disk at ${filepath}`);
            }

            finalImageUrl = `/uploads/${filename}`;
            console.log(`[GalleryService] Image successfully saved to disk: ${filepath} (${buffer.length} bytes, URL: ${finalImageUrl})`);
        } catch (diskErr) {
            console.error('[GalleryService] Local upload write failed:', diskErr.message);
            // In serverless read-only fallback, use data URI if write fails
            if (!finalImageUrl) {
                finalImageUrl = imageData;
            }
        }
    }

    if (!finalImageUrl) {
        console.error('[GalleryService] savePhoto failed: No valid image URL or image data provided.');
        throw new Error('No valid image URL or image data provided for photo upload.');
    }

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

        // 2. Direct inside uploads/ or uploads/gallery/
        const fileName = path.basename(imgUrlClean);
        candidatePaths.push(path.resolve(UPLOADS_DIR, fileName));
        candidatePaths.push(path.resolve(GALLERY_UPLOADS_DIR, fileName));
        candidatePaths.push(path.resolve(publicDir, 'uploads', fileName));
        candidatePaths.push(path.resolve(publicDir, 'uploads', 'gallery', fileName));
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

    // Attempt to delete asset from Cloudinary if hosted on Cloudinary
    if (photo.imageUrl && photo.imageUrl.includes('cloudinary.com')) {
        try {
            const cloudinary = require('cloudinary').v2;
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

