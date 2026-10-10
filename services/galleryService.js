const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const { Pool } = require('pg');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'gallery.json');
const TMP_DATA_FILE = path.join('/tmp', 'gallery.json');

// In-memory cache to guarantee ultra-fast responses and zero downtime
let inMemoryPhotos = null;

// ==============================================
// DATABASE CONNECTIVITY (MongoDB Atlas & Postgres)
// ==============================================
let isMongoConnecting = false;
let mongoConnected = false;

/**
 * Connect to MongoDB Atlas with connection reuse for serverless (Vercel)
 */
async function getMongoConnection() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) return null;

    if (mongoose.connection && mongoose.connection.readyState === 1) {
        mongoConnected = true;
        return mongoose.connection;
    }

    if (isMongoConnecting) {
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 150));
            if (mongoose.connection && mongoose.connection.readyState === 1) {
                return mongoose.connection;
            }
        }
    }

    try {
        isMongoConnecting = true;
        console.log('[GalleryService] Connecting to MongoDB Atlas...');
        await mongoose.connect(mongoUri, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 20000
        });
        mongoConnected = true;
        isMongoConnecting = false;
        console.log('[GalleryService] Successfully connected to MongoDB Atlas persistent storage.');
        return mongoose.connection;
    } catch (err) {
        isMongoConnecting = false;
        console.warn('[GalleryService] Notice: MongoDB Atlas connection attempt failed:', err.message);
        return null;
    }
}

// Mongoose Photo Schema
const PhotoSchema = new mongoose.Schema({
    id: { type: String, required: true, unique: true, index: true },
    title: { type: String, default: 'Euphoria Photo' },
    originalFilename: { type: String, default: '' },
    caption: { type: String, default: '' },
    category: { type: String, default: 'Stage & Performance', index: true },
    house: { type: String, default: 'General' },
    imageUrl: { type: String, required: true },
    url: { type: String },
    secure_url: { type: String },
    filePath: { type: String },
    size: { type: String, default: 'Optimized' },
    compressedSize: { type: String, default: 'Optimized' },
    uploadedAt: { type: String, default: () => new Date().toISOString() }
}, {
    timestamps: true,
    collection: 'gallery_photos'
});

const PhotoModel = mongoose.models.GalleryPhoto || mongoose.model('GalleryPhoto', PhotoSchema);

// PostgreSQL Pool Connection (Vercel Postgres fallback)
let pgPool = null;
let pgTableInitialized = false;

function getPgPool() {
    const pgUrl = process.env.POSTGRES_URL || process.env.DATABASE_URL;
    if (!pgUrl) return null;
    if (!pgPool) {
        pgPool = new Pool({
            connectionString: pgUrl,
            ssl: pgUrl.includes('localhost') ? false : { rejectUnauthorized: false },
            connectionTimeoutMillis: 5000
        });
        pgPool.on('error', (err) => {
            console.error('[GalleryService PostgreSQL Error]:', err.message);
        });
    }
    return pgPool;
}

async function ensurePgTable() {
    const pool = getPgPool();
    if (!pool || pgTableInitialized) return;
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gallery_photos (
                id VARCHAR(255) PRIMARY KEY,
                title VARCHAR(255),
                original_filename VARCHAR(255),
                caption TEXT,
                category VARCHAR(255),
                house VARCHAR(255),
                image_url TEXT NOT NULL,
                url TEXT,
                secure_url TEXT,
                file_path TEXT,
                size VARCHAR(100),
                compressed_size VARCHAR(100),
                uploaded_at VARCHAR(100)
            );
        `);
        pgTableInitialized = true;
        console.log('[GalleryService] Verified PostgreSQL gallery_photos table schema.');
    } catch (e) {
        console.warn('[GalleryService] PostgreSQL table verification notice:', e.message);
    }
}

// Ensure local storage directories exist safely without throwing errors
function ensureDirs() {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (e) {
        // Expected on read-only serverless filesystems (e.g. Vercel)
    }
}

// Initial curated festival photos
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
        id: String(photo.id || 'photo_' + Date.now()),
        title: photo.title || 'Euphoria Photo',
        originalFilename: photo.originalFilename || photo.original_filename || '',
        caption: photo.caption || '',
        category: photo.category || 'Stage & Performance',
        house: photo.house || 'General',
        imageUrl: resolvedUrl,
        url: resolvedUrl,
        secure_url: resolvedUrl,
        filePath: resolvedUrl,
        size: photo.size || 'Optimized',
        compressedSize: photo.compressedSize || photo.compressed_size || 'Optimized',
        uploadedAt: photo.uploadedAt || photo.uploaded_at || new Date().toISOString()
    };
}

// Read photos from local storage file (fallback when database is offline)
function readLocalPhotos() {
    if (inMemoryPhotos !== null && Array.isArray(inMemoryPhotos) && inMemoryPhotos.length > 0) {
        return inMemoryPhotos.map(normalizePhoto);
    }

    ensureDirs();

    // 1. Try reading from primary data/gallery.json
    try {
        if (fs.existsSync(DATA_FILE)) {
            const raw = fs.readFileSync(DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
                inMemoryPhotos = parsed.map(normalizePhoto);
                return inMemoryPhotos;
            }
        }
    } catch (e) {
        // Expected if file does not exist yet
    }

    // 2. Try reading from serverless /tmp/gallery.json cache
    try {
        if (fs.existsSync(TMP_DATA_FILE)) {
            const raw = fs.readFileSync(TMP_DATA_FILE, 'utf-8');
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed) && parsed.length > 0) {
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

// Write photos to local storage file (fallback cache)
function writeLocalPhotos(photos) {
    inMemoryPhotos = Array.isArray(photos) ? photos.map(normalizePhoto) : [];
    ensureDirs();

    // 1. Primary storage file (local environment)
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
    } catch (e) {
        // Handled on read-only serverless filesystems
    }

    // 2. Serverless /tmp cache fallback
    try {
        fs.writeFileSync(TMP_DATA_FILE, JSON.stringify(inMemoryPhotos, null, 2), 'utf-8');
    } catch (e) {
        // Ignore /tmp write error
    }

    return true;
}

/**
 * Initialize database and log status
 */
async function initDb() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    const pgUri = process.env.POSTGRES_URL || process.env.DATABASE_URL;

    if (mongoUri) {
        console.log('[GalleryService] Initializing MongoDB Atlas connection...');
        await getMongoConnection();
    } else if (pgUri) {
        console.log('[GalleryService] Initializing PostgreSQL connection...');
        await ensurePgTable();
    } else {
        console.warn('[GalleryService] Notice: Neither MONGODB_URI nor POSTGRES_URL found in environment variables.');
        console.warn('[GalleryService] For permanent persistence on Vercel across redeploys, set MONGODB_URI in your Vercel Dashboard project settings.');
    }
}

/**
 * Fetch all gallery photos sorted newest first directly from persistent database
 */
async function getAllPhotos() {
    // 1. Fetch from MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            const docs = await PhotoModel.find({}).sort({ uploadedAt: -1 }).lean();
            const normalized = docs.map(normalizePhoto);
            inMemoryPhotos = normalized;
            return normalized;
        } catch (e) {
            console.error('[GalleryService] Error querying MongoDB Atlas:', e.message);
        }
    }

    // 2. Fetch from PostgreSQL (Vercel Postgres)
    const pool = getPgPool();
    if (pool) {
        try {
            await ensurePgTable();
            const res = await pool.query('SELECT * FROM gallery_photos ORDER BY uploaded_at DESC');
            const normalized = res.rows.map(row => normalizePhoto({
                id: row.id,
                title: row.title,
                originalFilename: row.original_filename,
                caption: row.caption,
                category: row.category,
                house: row.house,
                imageUrl: row.image_url,
                url: row.url,
                secure_url: row.secure_url,
                filePath: row.file_path,
                size: row.size,
                compressedSize: row.compressed_size,
                uploadedAt: row.uploaded_at
            }));
            inMemoryPhotos = normalized;
            return normalized;
        } catch (e) {
            console.error('[GalleryService] Error querying PostgreSQL:', e.message);
        }
    }

    // 3. Fallback: local storage cache
    const local = readLocalPhotos();
    return [...local].sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
}

/**
 * Fetch photos filtered by category directly from persistent database
 */
async function getPhotosByCategory(category) {
    if (!category || category === 'ALL' || category === 'All Moments') {
        return getAllPhotos();
    }

    // 1. Query MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            const regex = new RegExp(`^${category.trim()}$`, 'i');
            const docs = await PhotoModel.find({ category: regex }).sort({ uploadedAt: -1 }).lean();
            return docs.map(normalizePhoto);
        } catch (e) {
            console.error('[GalleryService] Error querying MongoDB Atlas by category:', e.message);
        }
    }

    // 2. Query PostgreSQL
    const pool = getPgPool();
    if (pool) {
        try {
            await ensurePgTable();
            const res = await pool.query(
                'SELECT * FROM gallery_photos WHERE LOWER(category) = LOWER($1) ORDER BY uploaded_at DESC',
                [category.trim()]
            );
            return res.rows.map(row => normalizePhoto({
                id: row.id,
                title: row.title,
                originalFilename: row.original_filename,
                caption: row.caption,
                category: row.category,
                house: row.house,
                imageUrl: row.image_url,
                url: row.url,
                secure_url: row.secure_url,
                filePath: row.file_path,
                size: row.size,
                compressedSize: row.compressed_size,
                uploadedAt: row.uploaded_at
            }));
        } catch (e) {
            console.error('[GalleryService] Error querying PostgreSQL by category:', e.message);
        }
    }

    // 3. Fallback
    const photos = await getAllPhotos();
    return photos.filter(p => p.category && p.category.toLowerCase() === category.toLowerCase());
}

/**
 * Save new photo with direct Cloudinary storage and persistent database write
 */
async function savePhoto({ title, caption, category, house, imageUrl, url, secure_url, filePath, path: pPath, imageData, originalSize, compressedSize, originalFilename }) {
    ensureDirs();
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

    let persistedToDb = false;

    // 1. Persist directly to MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            await PhotoModel.findOneAndUpdate(
                { id: newPhoto.id },
                newPhoto,
                { upsert: true, new: true }
            );
            persistedToDb = true;
            console.log(`[GalleryService] Successfully saved photo to MongoDB Atlas: ID="${newPhoto.id}", Title="${newPhoto.title}"`);
        } catch (mongoErr) {
            console.error('[GalleryService] Failed to persist photo to MongoDB Atlas:', mongoErr.message);
        }
    }

    // 2. Persist directly to PostgreSQL
    const pool = getPgPool();
    if (pool) {
        try {
            await ensurePgTable();
            await pool.query(`
                INSERT INTO gallery_photos (id, title, original_filename, caption, category, house, image_url, url, secure_url, file_path, size, compressed_size, uploaded_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    image_url = EXCLUDED.image_url;
            `, [
                newPhoto.id,
                newPhoto.title,
                newPhoto.originalFilename,
                newPhoto.caption,
                newPhoto.category,
                newPhoto.house,
                newPhoto.imageUrl,
                newPhoto.url,
                newPhoto.secure_url,
                newPhoto.filePath,
                newPhoto.size,
                newPhoto.compressedSize,
                newPhoto.uploadedAt
            ]);
            persistedToDb = true;
            console.log(`[GalleryService] Successfully saved photo to PostgreSQL: ID="${newPhoto.id}", Title="${newPhoto.title}"`);
        } catch (pgErr) {
            console.error('[GalleryService] Failed to persist photo to PostgreSQL:', pgErr.message);
        }
    }

    // 3. Always update in-memory cache and write local file fallback
    const localPhotos = readLocalPhotos();
    localPhotos.unshift(newPhoto);
    writeLocalPhotos(localPhotos);

    console.log(`[GalleryService] Stored photo record: ID=${newPhoto.id}, Title="${newPhoto.title}", Category="${newPhoto.category}", URL="${newPhoto.imageUrl}". DB persisted: ${persistedToDb}`);
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
 * Delete a photo by ID, imageUrl, originalFilename or title (cleans Cloudinary asset and persistent database record)
 */
async function deletePhoto(identifier) {
    if (!identifier) {
        console.warn('[GalleryService] deletePhoto called without an identifier.');
        return { success: false, error: 'No photo identifier provided.' };
    }

    const photos = await getAllPhotos();
    const rawStr = String(identifier).trim();
    const cleanId = rawStr.toLowerCase();
    const baseName = path.basename(rawStr).toLowerCase();

    console.log(`[GalleryService] deletePhoto searching for: raw="${rawStr}", cleanId="${cleanId}", baseName="${baseName}"`);

    const index = photos.findIndex(p => {
        if (!p) return false;
        if (p.id && String(p.id).trim().toLowerCase() === cleanId) return true;
        if (p.imageUrl && String(p.imageUrl).trim() === rawStr) return true;
        if (p.url && String(p.url).trim() === rawStr) return true;
        if (p.originalFilename && p.originalFilename.toLowerCase() === baseName) return true;
        if (p.title && p.title.trim().toLowerCase() === cleanId) return true;
        return false;
    });

    if (index === -1) {
        console.warn(`[GalleryService] Photo "${rawStr}" not found in ${photos.length} records.`);
        return {
            success: false,
            error: `Photo with ID, filename, or URL "${rawStr}" was not found.`
        };
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
                const publicId = match[1];
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

    // 1. Delete from MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            await PhotoModel.deleteOne({ id: photo.id });
            console.log(`[GalleryService] Deleted photo from MongoDB Atlas: ID=${photo.id}`);
        } catch (mongoErr) {
            console.error('[GalleryService] Error deleting from MongoDB Atlas:', mongoErr.message);
        }
    }

    // 2. Delete from PostgreSQL
    const pool = getPgPool();
    if (pool) {
        try {
            await pool.query('DELETE FROM gallery_photos WHERE id = $1', [photo.id]);
            console.log(`[GalleryService] Deleted photo from PostgreSQL: ID=${photo.id}`);
        } catch (pgErr) {
            console.error('[GalleryService] Error deleting from PostgreSQL:', pgErr.message);
        }
    }

    // 3. Remove from in-memory cache and local file
    photos.splice(index, 1);
    writeLocalPhotos(photos);

    console.log(`[GalleryService] Permanently removed photo "${photo.id}". ${photos.length} photos remaining.`);

    return {
        success: true,
        id: photo.id,
        photo,
        fileDeleted,
        remainingCount: photos.length
    };
}

module.exports = {
    initDb,
    getAllPhotos,
    getPhotosByCategory,
    savePhoto,
    savePhotos,
    deletePhoto,
    normalizePhoto,
    normalizePhotoUrl,
    PhotoModel,
    INITIAL_PHOTOS
};
