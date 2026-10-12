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

// Mongoose Photo Schema (Flexible schema supporting both camelCase and snake_case fields)
const PhotoSchema = new mongoose.Schema({
    id: { type: String, index: true },
    title: { type: String, default: 'Euphoria Photo' },
    name: { type: String },
    originalFilename: { type: String, default: '' },
    original_filename: { type: String, default: '' },
    caption: { type: String, default: '' },
    description: { type: String, default: '' },
    category: { type: String, default: 'Stage & Performance', index: true },
    house: { type: String, default: 'General' },
    team: { type: String, default: 'General' },
    imageUrl: { type: String },
    image_url: { type: String },
    url: { type: String },
    secure_url: { type: String },
    secureUrl: { type: String },
    filePath: { type: String },
    file_path: { type: String },
    fileUrl: { type: String },
    image: { type: String },
    photo: { type: String },
    src: { type: String },
    size: { type: String, default: 'Optimized' },
    originalSize: { type: String, default: 'Optimized' },
    original_size: { type: String, default: 'Optimized' },
    compressedSize: { type: String, default: 'Optimized' },
    compressed_size: { type: String, default: 'Optimized' },
    uploadedAt: { type: String, default: () => new Date().toISOString() },
    uploaded_at: { type: String }
}, {
    timestamps: true,
    strict: false,
    collection: 'gallery_photos'
});

// Provide PhotoModel and register aliases so model lookups across code remain 100% consistent
const PhotoModel = mongoose.models.GalleryPhoto || mongoose.model('GalleryPhoto', PhotoSchema);
if (!mongoose.models.Photo) {
    try { mongoose.model('Photo', PhotoSchema); } catch (e) {}
}
if (!mongoose.models.Gallery) {
    try { mongoose.model('Gallery', PhotoSchema); } catch (e) {}
}
if (!mongoose.models.GalleryPhotos) {
    try { mongoose.model('GalleryPhotos', PhotoSchema); } catch (e) {}
}

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
    // If it's a Cloudinary public ID or filename, construct the full Cloudinary HTTPS URL
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.CLOUD_NAME || (cloudinary.config && cloudinary.config().cloud_name);
    if (cloudName && !trimmed.startsWith('http') && !trimmed.startsWith('data:') && !trimmed.startsWith('/')) {
        const cleanPublicId = trimmed.replace(/^euphoria_festival_gallery\//, '');
        return `https://res.cloudinary.com/${cloudName}/image/upload/euphoria_festival_gallery/${cleanPublicId}`;
    }
    return trimmed;
}

// Normalize photo objects so all common fields (camelCase and snake_case) are uniformly accessible
function normalizePhoto(photo) {
    if (!photo || typeof photo !== 'object') return photo;
    const rawUrl = (
        photo.imageUrl ||
        photo.image_url ||
        photo.secure_url ||
        photo.secureUrl ||
        photo.url ||
        photo.filePath ||
        photo.file_path ||
        photo.fileUrl ||
        photo.image ||
        photo.photo ||
        photo.src ||
        photo.path ||
        ''
    ).toString().trim();
    const resolvedUrl = normalizePhotoUrl(rawUrl);
    const photoId = String(photo.id || photo._id || 'photo_' + Date.now());
    const originalFile = photo.originalFilename || photo.original_filename || photo.filename || photo.name || '';
    const photoTitle = (photo.title && String(photo.title).trim())
        ? String(photo.title).trim()
        : (originalFile ? path.basename(originalFile).replace(/\.[^/.]+$/, '').trim() : 'Euphoria Photo');
    const compSize = photo.compressedSize || photo.compressed_size || photo.size || 'Optimized';
    const uploadTime = photo.uploadedAt || photo.uploaded_at || photo.createdAt || photo.created_at || new Date().toISOString();
    const category = (photo.category && String(photo.category).trim()) ? String(photo.category).trim() : 'Stage & Performance';
    const house = (photo.house && String(photo.house).trim()) ? String(photo.house).trim() : 'General';

    return {
        id: photoId,
        _id: photoId,
        title: photoTitle,
        name: photoTitle,
        originalFilename: originalFile,
        original_filename: originalFile,
        caption: photo.caption || '',
        description: photo.caption || photo.description || '',
        category: category,
        house: house,
        team: photo.house || photo.team || 'General',
        imageUrl: resolvedUrl,
        image_url: resolvedUrl,
        url: resolvedUrl,
        secure_url: resolvedUrl,
        secureUrl: resolvedUrl,
        filePath: resolvedUrl,
        file_path: resolvedUrl,
        fileUrl: resolvedUrl,
        image: resolvedUrl,
        photo: resolvedUrl,
        src: resolvedUrl,
        size: photo.size || compSize,
        originalSize: photo.originalSize || photo.original_size || photo.size || compSize,
        original_size: photo.originalSize || photo.original_size || photo.size || compSize,
        compressedSize: compSize,
        compressed_size: compSize,
        uploadedAt: uploadTime,
        uploaded_at: uploadTime,
        createdAt: uploadTime,
        created_at: uploadTime
    };
}

// Read photos from local storage file (fallback when database is offline or not configured)
function readLocalPhotos() {
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
        // Expected if file does not exist yet
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

// Write photos to local storage file (fallback cache)
function writeLocalPhotos(photos, updateMemory = true) {
    const normalized = Array.isArray(photos) ? photos.map(normalizePhoto) : [];
    if (updateMemory) {
        inMemoryPhotos = normalized;
    }
    ensureDirs();

    // 1. Primary storage file (local environment)
    try {
        fs.writeFileSync(DATA_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
    } catch (e) {
        // Handled on read-only serverless filesystems
    }

    // 2. Serverless /tmp cache fallback
    try {
        fs.writeFileSync(TMP_DATA_FILE, JSON.stringify(normalized, null, 2), 'utf-8');
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
        console.warn('[GalleryService] Using resilient local file storage / memory cache (data/gallery.json).');
    }
}

/**
 * Fetch all gallery photos sorted newest first directly from persistent database or storage
 */
async function getAllPhotos() {
    console.log('[GalleryService] getAllPhotos() requested - querying persistent storage...');

    // 1. Fetch from MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            console.log('[GalleryService] Querying MongoDB Atlas collection "gallery_photos"...');
            let docs = await PhotoModel.find({}).sort({ uploadedAt: -1, uploaded_at: -1, createdAt: -1, _id: -1 }).lean();

            // If primary collection is empty, check alternative collection names for legacy/mismatched collections
            if (!docs || docs.length === 0) {
                const altCollections = ['photos', 'gallery', 'galleryphotos', 'galleries'];
                for (const collName of altCollections) {
                    try {
                        const rawColl = mongoose.connection.collection(collName);
                        const altDocs = await rawColl.find({}).sort({ uploadedAt: -1, uploaded_at: -1, createdAt: -1, _id: -1 }).toArray();
                        if (altDocs && altDocs.length > 0) {
                            console.log(`[GalleryService] Found ${altDocs.length} photos in fallback collection "${collName}".`);
                            docs = altDocs;
                            break;
                        }
                    } catch (collErr) {}
                }
            }

            if (docs && docs.length > 0) {
                const normalized = docs.map(normalizePhoto).filter(p => Boolean(p.imageUrl));
                console.log(`[GalleryService] MongoDB Atlas returned ${normalized.length} photos.`);
                inMemoryPhotos = normalized;
                writeLocalPhotos(normalized, false);
                return normalized;
            } else {
                console.log('[GalleryService] MongoDB Atlas returned 0 photos. Checking secondary storage...');
            }
        } catch (e) {
            console.error('[GalleryService] Error querying MongoDB Atlas:', e.message);
        }
    }

    // 2. Fetch from PostgreSQL (Vercel Postgres)
    const pool = getPgPool();
    if (pool) {
        try {
            console.log('[GalleryService] Querying PostgreSQL table "gallery_photos"...');
            await ensurePgTable();
            const res = await pool.query('SELECT * FROM gallery_photos ORDER BY uploaded_at DESC');
            if (res && res.rows && res.rows.length > 0) {
                const normalized = res.rows.map(normalizePhoto).filter(p => Boolean(p.imageUrl));
                console.log(`[GalleryService] PostgreSQL returned ${normalized.length} photos.`);
                inMemoryPhotos = normalized;
                writeLocalPhotos(normalized, false);
                return normalized;
            } else {
                console.log('[GalleryService] PostgreSQL returned 0 photos. Checking local storage cache...');
            }
        } catch (e) {
            console.error('[GalleryService] Error querying PostgreSQL:', e.message);
        }
    }

    // 3. Fallback: local storage cache
    console.log('[GalleryService] Fetching photos from local storage cache (data/gallery.json)...');
    const local = readLocalPhotos();
    const sortedLocal = [...local]
        .map(normalizePhoto)
        .filter(p => Boolean(p.imageUrl))
        .sort((a, b) => new Date(b.uploadedAt || 0) - new Date(a.uploadedAt || 0));
    console.log(`[GalleryService] Local storage returned ${sortedLocal.length} photos.`);
    return sortedLocal;
}

/**
 * Fetch photos filtered by category directly from persistent database
 */
async function getPhotosByCategory(category) {
    if (!category || category === 'ALL' || category === 'All Moments' || category.toUpperCase() === 'ALL') {
        return getAllPhotos();
    }

    console.log(`[GalleryService] getPhotosByCategory("${category}") requested.`);
    const photos = await getAllPhotos();
    const targetCat = category.trim().toLowerCase();
    const filtered = photos.filter(p => {
        if (!p.category) return false;
        const cat = p.category.trim().toLowerCase();
        return cat === targetCat || cat.includes(targetCat) || targetCat.includes(cat);
    });
    console.log(`[GalleryService] Filtered ${filtered.length} photos for category: "${category}".`);
    return filtered;
}

/**
 * Save new photo with direct Cloudinary storage and persistent database write
 */
async function savePhoto({
    title,
    caption,
    description,
    category,
    house,
    team,
    imageUrl,
    image_url,
    url,
    secure_url,
    secureUrl,
    filePath,
    file_path,
    fileUrl,
    path: pPath,
    imageData,
    image,
    photo: pPhoto,
    file,
    originalSize,
    original_size,
    size,
    compressedSize,
    compressed_size,
    originalFilename,
    original_filename,
    filename,
    name
}) {
    ensureDirs();
    const rawUrl = imageUrl || image_url || secure_url || secureUrl || url || filePath || file_path || fileUrl || pPath || null;
    let finalImageUrl = (rawUrl && typeof rawUrl === 'string') ? normalizePhotoUrl(rawUrl) : null;
    const rawImageData = imageData || image || pPhoto || file || null;

    // Retain clean original file name (strip extension if present for title)
    const effectiveFilename = originalFilename || original_filename || filename || name || '';
    let cleanBaseName = '';
    if (effectiveFilename && typeof effectiveFilename === 'string') {
        cleanBaseName = path.basename(effectiveFilename).replace(/\.[^/.]+$/, '').trim();
    } else if (title && typeof title === 'string') {
        cleanBaseName = title.trim();
    }
    const safeBaseName = (cleanBaseName || 'Euphoria_Photo')
        .replace(/[^a-zA-Z0-9_\-\s]/g, '')
        .trim()
        .replace(/\s+/g, '_') || 'Euphoria_Photo';

    // Handle base64 image data: upload directly to Cloudinary (never save to local disk)
    if (!finalImageUrl && rawImageData && typeof rawImageData === 'string') {
        try {
            console.log('[GalleryService] Uploading base64 image directly to Cloudinary...');
            const cldRes = await cloudinary.uploader.upload(rawImageData, {
                folder: 'euphoria_festival_gallery',
                public_id: `${safeBaseName}_${Date.now()}_${Math.round(Math.random() * 1e6)}`,
                transformation: [{ quality: 'auto', fetch_format: 'auto' }]
            });
            finalImageUrl = cldRes.secure_url || cldRes.url;
            console.log(`[GalleryService] Cloudinary direct upload success: "${finalImageUrl}"`);
        } catch (cldErr) {
            console.warn('[GalleryService] Cloudinary direct upload notice:', cldErr.message);
            if (!finalImageUrl) {
                finalImageUrl = rawImageData;
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
        : (cleanBaseName || effectiveFilename || 'Euphoria Photo');

    const determinedId = 'photo_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
    const uploadTimestamp = new Date().toISOString();
    const effectiveCategory = (category && category.trim()) ? category.trim() : 'Stage & Performance';
    const effectiveHouse = (house && house.trim()) ? house.trim() : (team || 'General');
    const effectiveCaption = (caption || description || '').trim();
    const effectiveSize = originalSize || original_size || size || 'Optimized';
    const effectiveCompressedSize = compressedSize || compressed_size || effectiveSize;

    const newPhoto = normalizePhoto({
        id: determinedId,
        _id: determinedId,
        title: determinedTitle,
        name: determinedTitle,
        originalFilename: effectiveFilename,
        original_filename: effectiveFilename,
        caption: effectiveCaption,
        description: effectiveCaption,
        category: effectiveCategory,
        house: effectiveHouse,
        team: effectiveHouse,
        imageUrl: finalImageUrl,
        image_url: finalImageUrl,
        url: finalImageUrl,
        secure_url: finalImageUrl,
        secureUrl: finalImageUrl,
        filePath: finalImageUrl,
        file_path: finalImageUrl,
        fileUrl: finalImageUrl,
        image: finalImageUrl,
        photo: finalImageUrl,
        src: finalImageUrl,
        size: effectiveSize,
        originalSize: effectiveSize,
        original_size: effectiveSize,
        compressedSize: effectiveCompressedSize,
        compressed_size: effectiveCompressedSize,
        uploadedAt: uploadTimestamp,
        uploaded_at: uploadTimestamp,
        createdAt: uploadTimestamp,
        created_at: uploadTimestamp
    });

    let persistedToDb = false;

    // 1. Persist directly to MongoDB Atlas
    const mongo = await getMongoConnection();
    if (mongo) {
        try {
            await PhotoModel.findOneAndUpdate(
                { id: newPhoto.id },
                newPhoto,
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );
            // Dual-persist to fallback collection 'photos' for synchronization across any legacy model
            try {
                await mongoose.connection.collection('photos').updateOne(
                    { id: newPhoto.id },
                    { $set: newPhoto },
                    { upsert: true }
                );
            } catch (collErr) {}
            persistedToDb = true;
            console.log(`[GalleryService] Successfully saved photo to MongoDB Atlas: ID="${newPhoto.id}", Title="${newPhoto.title}", URL="${newPhoto.imageUrl}"`);
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
                    image_url = EXCLUDED.image_url,
                    url = EXCLUDED.url,
                    secure_url = EXCLUDED.secure_url;
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
    writeLocalPhotos(localPhotos, true);

    console.log(`[GalleryService] Stored photo record: ID=${newPhoto.id}, Title="${newPhoto.title}", Category="${newPhoto.category}", URL="${newPhoto.imageUrl}". DB persisted: ${persistedToDb}. Total in cache: ${localPhotos.length}`);
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
        if (p._id && String(p._id).trim().toLowerCase() === cleanId) return true;
        if (p.imageUrl && String(p.imageUrl).trim() === rawStr) return true;
        if (p.url && String(p.url).trim() === rawStr) return true;
        if (p.originalFilename && p.originalFilename.toLowerCase() === baseName) return true;
        if (p.original_filename && p.original_filename.toLowerCase() === baseName) return true;
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
            await PhotoModel.deleteOne({ $or: [{ id: photo.id }, { _id: photo.id }] });
            try {
                await mongoose.connection.collection('photos').deleteOne({ $or: [{ id: photo.id }, { _id: photo.id }] });
            } catch (cErr) {}
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
    writeLocalPhotos(photos, true);

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
