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
const INITIAL_PHOTOS = [
    {
        id: 'photo_init_01',
        title: "Championship Gold Trophy & Grand Unveiling",
        caption: "The official championship glory of Event Euphoria '26 waiting for the victors.",
        category: "Awards & Glory",
        house: "General",
        imageUrl: "/images/euphoria_trophy.jpg",
        size: "838 KB",
        compressedSize: "838 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 24 * 3).toISOString()
    },
    {
        id: 'photo_init_02',
        title: "Live Euphoria Cultural Stage & Crowd Energy",
        caption: "Breathtaking stage performance under the festival canopy with roaring audience.",
        category: "Stage & Performance",
        house: "General",
        imageUrl: "/images/euphoria_stage_live.jpg",
        size: "1.2 MB",
        compressedSize: "1.2 MB",
        uploadedAt: new Date(Date.now() - 3600000 * 24 * 2.5).toISOString()
    },
    {
        id: 'photo_init_03',
        title: "Euphoria Mega Inauguration & Delegation",
        caption: "Massive participation of student delegates celebrating the spirit of festivity.",
        category: "Crowd & Vibes",
        house: "General",
        imageUrl: "/images/euphoria_story.jpg",
        size: "920 KB",
        compressedSize: "920 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 24 * 2).toISOString()
    },
    {
        id: 'photo_init_04',
        title: "Stage Moments & Grand Cultural Performance",
        caption: "Captivating stage events illuminated with vibrant Sahithyolsav lighting.",
        category: "Stage & Performance",
        house: "Team fanora",
        imageUrl: "/images/Fest Photo.jpeg",
        size: "100 KB",
        compressedSize: "100 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 24 * 1.5).toISOString()
    },
    {
        id: 'photo_init_05',
        title: "Official Festival Delegation & Poster Launch",
        caption: "The second official campaign launch poster of Event Euphoria.",
        category: "Behind The Scenes",
        house: "Team zahora",
        imageUrl: "/images/2nd-Poster-Mian.jpg",
        size: "986 KB",
        compressedSize: "986 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 24 * 1).toISOString()
    },
    {
        id: 'photo_init_06',
        title: "Live Competition Heat & Evaluation",
        caption: "Official stage announcements and judging in the main auditorium.",
        category: "Stage & Performance",
        house: "General",
        imageUrl: "/images/Result-Main.jpg",
        size: "504 KB",
        compressedSize: "504 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 16).toISOString()
    },
    {
        id: 'photo_init_07',
        title: "Campaign Artwork & Creative Reveal",
        caption: "Official artistic campaign visual for Sirajul Irfan Da'wa Dars fest.",
        category: "Behind The Scenes",
        house: "Team mazora",
        imageUrl: "/images/2nd-Poster.jpg",
        size: "986 KB",
        compressedSize: "986 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 8).toISOString()
    },
    {
        id: 'photo_init_08',
        title: "Championship Points Board & Victory Celebrations",
        caption: "Real-time updates and house victory moments from the scoreboard.",
        category: "Awards & Glory",
        house: "General",
        imageUrl: "/images/Result.jpg",
        size: "422 KB",
        compressedSize: "422 KB",
        uploadedAt: new Date(Date.now() - 3600000 * 2).toISOString()
    }
];

// Read photos from storage file (with in-memory fallback for read-only serverless environments)
function readPhotos() {
    if (inMemoryPhotos && Array.isArray(inMemoryPhotos) && inMemoryPhotos.length > 0) {
        return inMemoryPhotos;
    }
    ensureDirs();
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                inMemoryPhotos = parsed;
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        console.warn('[GalleryService] Notice: reading data file:', e.message);
    }

    inMemoryPhotos = [...INITIAL_PHOTOS];
    try {
        if (!fs.existsSync(DATA_FILE)) {
            fs.writeFileSync(DATA_FILE, JSON.stringify(INITIAL_PHOTOS, null, 2), 'utf-8');
        }
    } catch (e) {
        // Read-only filesystem / serverless, memory fallback is already set
    }
    return inMemoryPhotos;
}

// Write photos to storage file
function writePhotos(photos) {
    inMemoryPhotos = photos;
    ensureDirs();
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(photos, null, 2), 'utf-8');
        return true;
    } catch (e) {
        console.warn('[GalleryService] Notice: writing data file (persisted in-memory):', e.message);
        return true;
    }
}

/**
 * Fetch all gallery photos sorted newest first
 */
function getAllPhotos() {
    const photos = readPhotos();
    return photos.sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
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
 * Delete a photo by ID or path and remove physical file if stored locally
 */
function deletePhoto(identifier) {
    if (!identifier) return false;
    ensureDirs();
    const photos = readPhotos();
    const cleanId = decodeURIComponent(String(identifier)).trim();

    // Match by ID, imageUrl, or filename
    const index = photos.findIndex(p => {
        if (!p) return false;
        if (p.id && String(p.id).trim() === cleanId) return true;
        if (p.imageUrl && String(p.imageUrl).trim() === cleanId) return true;
        if (p.imageUrl && path.basename(p.imageUrl) === path.basename(cleanId)) return true;
        return false;
    });

    if (index === -1) {
        return false;
    }

    const photo = photos[index];

    // Attempt to remove physical file if stored locally without crashing
    if (photo.imageUrl) {
        let localPath = null;
        if (photo.imageUrl.startsWith('/uploads/gallery/')) {
            const filename = path.basename(photo.imageUrl);
            localPath = path.join(UPLOADS_DIR, filename);
        } else if (photo.imageUrl.startsWith('/uploads/')) {
            const filename = path.basename(photo.imageUrl);
            localPath = path.join(__dirname, '..', 'public', 'uploads', filename);
        }

        if (localPath) {
            try {
                if (fs.existsSync(localPath)) {
                    fs.unlinkSync(localPath);
                    console.log('[GalleryService] Successfully removed physical image file:', localPath);
                }
            } catch (err) {
                // Gracefully ignore permission or lock errors; data removal should still succeed
                console.warn('[GalleryService] Note: Could not unlink local image file (permission or locked):', err.message);
            }
        }
    }

    // Remove from in-memory and persistent storage
    photos.splice(index, 1);
    writePhotos(photos);
    return true;
}

module.exports = {
    getAllPhotos,
    getPhotosByCategory,
    savePhoto,
    savePhotos,
    deletePhoto,
    INITIAL_PHOTOS
};
