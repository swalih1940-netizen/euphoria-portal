const express = require('express');
const path = require('path');
const fs = require('fs');
const hbs = require('hbs');
const crypto = require('crypto');
require('dotenv').config();

const festflowService = require('./services/festflowService');
const galleryService = require('./services/galleryService');

const app = express();
const PORT = process.env.PORT || 3001;

// Base Configuration
const SUBDOMAIN_URL = (process.env.SUBDOMAIN_URL || 'https://www.euphoria.sirajulirfan.com').replace(/\/+$/, '');
const MAIN_SITE_URL = (process.env.MAIN_SITE_URL || 'https://sirajulirfan.com').replace(/\/+$/, '');
const FESTIVAL_NAME = process.env.FESTIVAL_NAME || "Event Euphoria '26";
const FESTIVAL_DATE_RAW = process.env.FESTIVAL_DATE || '2026-10-10T06:00:00+05:30';

// Setup View Engine & Register Partials
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));
hbs.registerPartials(path.join(__dirname, 'views', 'partials'));

// Static Files with caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

// Body Parsers with generous limit for compressed photo payloads
app.use(express.json({ limit: '35mb' }));
app.use(express.urlencoded({ extended: true, limit: '35mb' }));

// Helper Functions for IST Date Formatting
function formatISTDisplay(date) {
    if (!date || isNaN(new Date(date).getTime())) {
        return {
            dateFormatted: 'October 10, 2026',
            dateTimeFormatted: 'October 10, 2026 at 06:00 AM IST'
        };
    }
    const d = new Date(date);
    const istTime = new Date(d.getTime() + (5.5 * 60 * 60 * 1000));
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const month = months[istTime.getUTCMonth()];
    const day = istTime.getUTCDate();
    const year = istTime.getUTCFullYear();
    let hours = istTime.getUTCHours();
    const minutes = String(istTime.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;
    return {
        dateFormatted: `${month} ${day}, ${year}`,
        dateTimeFormatted: `${month} ${day}, ${year} at ${String(hours).padStart(2, '0')}:${minutes} ${ampm} IST`
    };
}

// Handlebars Helpers
hbs.registerHelper('json', function (context) {
    const jsonStr = JSON.stringify(context !== undefined ? context : []);
    return (hbs.handlebars && hbs.handlebars.SafeString) ? new hbs.handlebars.SafeString(jsonStr) : jsonStr;
});

hbs.registerHelper('eq', function (a, b) {
    return a === b;
});

hbs.registerHelper('ne', function (a, b) {
    return a !== b;
});

hbs.registerHelper('formatDate', function (date) {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
});

hbs.registerHelper('substring', function (str, start, end) {
    if (!str) return '';
    return str.toString().substring(start, end);
});

const padTwoFn = function (val) {
    if (!val) return '01';
    const num = parseInt(val, 10);
    if (!isNaN(num)) return String(num).padStart(2, '0');
    return String(val);
};

hbs.registerHelper('padTwo', padTwoFn);

const orFn = function (...args) {
    const values = args.slice(0, -1);
    return values.some(Boolean);
};
hbs.registerHelper('or', orFn);

if (hbs.handlebars) {
    hbs.handlebars.registerHelper('json', function (context) {
        const jsonStr = JSON.stringify(context !== undefined ? context : []);
        return hbs.handlebars.SafeString ? new hbs.handlebars.SafeString(jsonStr) : jsonStr;
    });
    hbs.handlebars.registerHelper('padTwo', padTwoFn);
    hbs.handlebars.registerHelper('eq', function (a, b) { return a === b; });
    hbs.handlebars.registerHelper('or', orFn);
}

// Global Context Middleware
app.use((req, res, next) => {
    const eventDateObj = new Date(FESTIVAL_DATE_RAW);
    const now = new Date();
    const isExpired = now.getTime() >= eventDateObj.getTime();
    const display = formatISTDisplay(eventDateObj);

    res.locals.festivalSetting = {
        eventName: FESTIVAL_NAME,
        eventDate: eventDateObj,
        eventDateIso: eventDateObj.toISOString(),
        eventDateFormatted: display.dateFormatted,
        eventDateTimeFormatted: display.dateTimeFormatted,
        isExpired: isExpired,
        isCountdownVisible: process.env.COUNTDOWN_VISIBLE !== 'false'
    };

    res.locals.subdomainUrl = SUBDOMAIN_URL;
    res.locals.mainSiteUrl = MAIN_SITE_URL;
    next();
});

// ==========================================
// ROUTES
// ==========================================

// 1. Main Festival Landing Page
app.get('/', async (req, res) => {
    try {
        const competitions = await festflowService.fetchCompetitions();
        const houses = await festflowService.fetchTeamPoints(competitions);
        const photos = galleryService.getAllPhotos().slice(0, 8);

        res.render('eventeuphoria', {
            title: `EVENT EUPHORIA '26 | Annual Fest | SIRAJUL IRFAN`,
            houses: houses,
            competitions: competitions,
            photos: photos,
            isLandingPage: true
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering festival home:', err);
        res.render('eventeuphoria', {
            title: `EVENT EUPHORIA '26 | Annual Fest | SIRAJUL IRFAN`,
            houses: festflowService.FALLBACK_HOUSES,
            competitions: [],
            photos: galleryService.getAllPhotos().slice(0, 8),
            isLandingPage: true
        });
    }
});

// Helper to filter and sort only top 3 position winners (First, Second, and Third place / 1st, 2nd, 3rd)
function filterToTopThreeWinners(competitionsList) {
    if (!Array.isArray(competitionsList)) return [];
    return competitionsList.map(comp => {
        const rawWinners = Array.isArray(comp.winners) ? comp.winners : [];
        const topThreeWinners = rawWinners
            .filter(w => {
                if (festflowService.isTopThreeWinner && festflowService.isTopThreeWinner(w)) return true;
                return w.isFirst || w.isSecond || w.isThird;
            })
            .sort((a, b) => (Number(a.rank) || 99) - (Number(b.rank) || 99));

        return {
            ...comp,
            winners: topThreeWinners
        };
    });
}

// 2. Official Results Controller & Route
const renderResultsPage = async (req, res) => {
    try {
        const rawCompetitions = await festflowService.fetchCompetitions();
        // Strictly filter to ensure only the top 3 position winners are passed to the template
        const competitions = filterToTopThreeWinners(rawCompetitions);

        res.render('results', {
            title: `OFFICIAL RESULTS | Event Euphoria '26 | SIRAJUL IRFAN`,
            competitions: competitions,
            activeNav: 'results',
            isLandingPage: true
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering results:', err);
        const fallbackCompetitions = filterToTopThreeWinners(festflowService.FALLBACK_COMPETITIONS);
        res.render('results', {
            title: `OFFICIAL RESULTS | Event Euphoria '26 | SIRAJUL IRFAN`,
            competitions: fallbackCompetitions,
            activeNav: 'results',
            isLandingPage: true
        });
    }
};

app.get(['/result', '/result/*'], renderResultsPage);

// 3. Backward-compatible / Convenient Aliases
app.get(['/results', '/results/*'], (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(301, `/result${query}`);
});

app.get(['/eventeuphoria/result', '/eventeuphoria/result/*', '/eventeuphoria/results', '/eventeuphoria/results/*'], (req, res) => {
    const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    res.redirect(301, `/result${query}`);
});

app.get(['/eventeuphoria', '/eventeuphoria/*'], (req, res) => {
    const pathSegments = req.params[0] ? req.params[0].replace(/^\/+/, '').toLowerCase() : '';
    if (pathSegments.startsWith('result')) {
        return renderResultsPage(req, res);
    }
    if (pathSegments) {
        return res.redirect(301, `/#${pathSegments}`);
    }
    return res.redirect(301, '/');
});

// 4. Dedicated Festival Gallery Controller & Route
const renderGalleryPage = (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    try {
        const photos = galleryService.getAllPhotos();
        res.render('gallery', {
            title: `FESTIVAL GALLERY | Event Euphoria '26 | SIRAJUL IRFAN`,
            photos: photos,
            activeNav: 'gallery',
            isLandingPage: false
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering gallery:', err);
        res.render('gallery', {
            title: `FESTIVAL GALLERY | Event Euphoria '26 | SIRAJUL IRFAN`,
            photos: [],
            activeNav: 'gallery',
            isLandingPage: false
        });
    }
};

app.get('/gallery', renderGalleryPage);

// 5. Gallery Public JSON API
app.get(['/api/gallery', '/api/gallery/list', '/api/photos'], (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    try {
        const category = req.query.category;
        const photos = category ? galleryService.getPhotosByCategory(category) : galleryService.getAllPhotos();
        res.json({ success: true, count: photos.length, photos });
    } catch (err) {
        console.error('[Gallery API Error]:', err.message);
        res.status(500).json({ success: false, error: err.message, photos: [] });
    }
});

// 6. Live TV Broadcast Display & Real-Time Stream (/tv)
app.get(['/tv', '/tv/', '/live-tv', '/display'], async (req, res) => {
    try {
        const [houses, competitions] = await Promise.all([
            festflowService.fetchTeamPoints().catch(() => festflowService.FALLBACK_HOUSES),
            festflowService.fetchCompetitions().catch(() => festflowService.FALLBACK_COMPETITIONS)
        ]);
        const enrichedCompetitions = (competitions || []).map(comp => {
            let rawZone = comp.zone || comp.zoneName || comp.zone_name || comp.category || comp.categoryName || comp.stageCategory || 'Alpha Zone';
            if (typeof rawZone === 'object' && rawZone !== null) {
                rawZone = rawZone.name || rawZone.title || rawZone.label || rawZone.zone || 'Alpha Zone';
            }
            let normalizedZone = String(rawZone).trim();
            const zUpper = normalizedZone.toUpperCase();
            if (zUpper === 'PRIME' || zUpper === 'PRIME ZONE') normalizedZone = 'Prime Zone';
            else if (zUpper === 'ALPHA' || zUpper === 'ALPHA ZONE') normalizedZone = 'Alpha Zone';
            else if (zUpper === 'CORE' || zUpper === 'CORE ZONE') normalizedZone = 'Core Zone';
            else if (!zUpper.includes('ZONE') && normalizedZone.length > 0) normalizedZone = `${normalizedZone} Zone`;

            return {
                ...comp,
                zone: normalizedZone,
                zoneName: normalizedZone,
                category: normalizedZone,
                categoryName: normalizedZone
            };
        });

        // Support direct JSON requests via header or query
        if (req.query.format === 'json' || req.query.json === 'true' || (req.headers.accept && req.headers.accept.includes('application/json') && !req.headers.accept.includes('text/html'))) {
            return res.json({
                success: true,
                title: `LIVE TV DISPLAY | Standings & Real-Time Results | Event Euphoria '26`,
                houses: houses && houses.length > 0 ? houses : festflowService.FALLBACK_HOUSES,
                competitions: enrichedCompetitions
            });
        }

        res.render('tv', {
            title: `LIVE TV DISPLAY | Standings & Real-Time Results | Event Euphoria '26`,
            houses: houses && houses.length > 0 ? houses : festflowService.FALLBACK_HOUSES,
            competitions: enrichedCompetitions,
            isLandingPage: false
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering TV view:', err);
        if (req.query.format === 'json' || req.query.json === 'true') {
            return res.status(500).json({ success: false, error: err.message });
        }
        res.render('tv', {
            title: `LIVE TV DISPLAY | Standings & Real-Time Results | Event Euphoria '26`,
            houses: festflowService.FALLBACK_HOUSES,
            competitions: [],
            isLandingPage: false
        });
    }
});

// TV API Aliases
app.get(['/api/tv', '/api/tv/data'], (req, res) => {
    res.redirect(307, '/api/tv/live-data');
});


// In-memory queue for instant result broadcasts triggered from admin or fest floor
const pendingTvBroadcasts = [];

app.post('/api/tv/broadcast', (req, res) => {
    try {
        const item = req.body;
        if (!item || (!item.name && !item.title && !item.competitionName)) {
            return res.status(400).json({ success: false, error: 'Valid competition/result payload required.' });
        }
        let rawZone = item.zone || item.zoneName || item.zone_name || item.category || item.categoryName || item.stageCategory || 'Alpha Zone';
        if (typeof rawZone === 'object' && rawZone !== null) {
            rawZone = rawZone.name || rawZone.title || rawZone.label || rawZone.zone || 'Alpha Zone';
        }
        let normalizedZone = String(rawZone).trim();
        const zUpper = normalizedZone.toUpperCase();
        if (zUpper === 'PRIME' || zUpper === 'PRIME ZONE') normalizedZone = 'Prime Zone';
        else if (zUpper === 'ALPHA' || zUpper === 'ALPHA ZONE') normalizedZone = 'Alpha Zone';
        else if (zUpper === 'CORE' || zUpper === 'CORE ZONE') normalizedZone = 'Core Zone';
        else if (!zUpper.includes('ZONE') && normalizedZone.length > 0) normalizedZone = `${normalizedZone} Zone`;

        const broadcastPayload = {
            id: item.id || `broadcast_${Date.now()}`,
            timestamp: Date.now(),
            ...item,
            zone: normalizedZone,
            zoneName: normalizedZone,
            category: normalizedZone,
            categoryName: normalizedZone
        };
        pendingTvBroadcasts.push(broadcastPayload);
        if (pendingTvBroadcasts.length > 30) pendingTvBroadcasts.shift();
        res.json({ success: true, broadcast: broadcastPayload });
    } catch (err) {
        console.error('[TV Broadcast API Error]:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/tv/live-data', async (req, res) => {
    try {
        const [houses, competitions] = await Promise.all([
            festflowService.fetchTeamPoints(null, true).catch(() => festflowService.FALLBACK_HOUSES),
            festflowService.fetchCompetitions(true).catch(() => festflowService.FALLBACK_COMPETITIONS)
        ]);

        // Clean broadcasts older than 3 minutes
        const cutoff = Date.now() - (3 * 60 * 1000);
        while (pendingTvBroadcasts.length > 0 && pendingTvBroadcasts[0].timestamp < cutoff) {
            pendingTvBroadcasts.shift();
        }

        // Ensure every competition item explicitly guarantees zone and zoneName
        const enrichedCompetitions = (competitions || []).map(comp => {
            let rawZone = comp.zone || comp.zoneName || comp.zone_name || comp.category || comp.categoryName || comp.stageCategory || 'Alpha Zone';
            if (typeof rawZone === 'object' && rawZone !== null) {
                rawZone = rawZone.name || rawZone.title || rawZone.label || rawZone.zone || 'Alpha Zone';
            }
            let normalizedZone = String(rawZone).trim();
            const zUpper = normalizedZone.toUpperCase();
            if (zUpper === 'PRIME' || zUpper === 'PRIME ZONE') normalizedZone = 'Prime Zone';
            else if (zUpper === 'ALPHA' || zUpper === 'ALPHA ZONE') normalizedZone = 'Alpha Zone';
            else if (zUpper === 'CORE' || zUpper === 'CORE ZONE') normalizedZone = 'Core Zone';
            else if (!zUpper.includes('ZONE') && normalizedZone.length > 0) normalizedZone = `${normalizedZone} Zone`;

            return {
                ...comp,
                zone: normalizedZone,
                zoneName: normalizedZone,
                category: normalizedZone,
                categoryName: normalizedZone
            };
        });

        res.json({
            success: true,
            timestamp: Date.now(),
            houses: houses && houses.length > 0 ? houses : festflowService.FALLBACK_HOUSES,
            competitions: enrichedCompetitions,
            broadcasts: pendingTvBroadcasts
        });
    } catch (err) {
        console.error('[TV API Live Data Error]:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// 7. ADMIN AUTHENTICATION & SECURITY
// ==========================================
const ADMIN_USERNAME = (process.env.ADMIN_USERNAME || 'sisa@26').trim();
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'sisa123').trim();
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || 'euphoria_admin_session_key_2026_sisa';
const ADMIN_COOKIE_NAME = 'euphoria_admin_session';

function generateAdminToken() {
    const timestamp = Date.now();
    const payload = `${ADMIN_USERNAME}:${timestamp}`;
    const hash = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
    return `${timestamp}.${hash}`;
}

function verifyAdminToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 2) return false;
    const [timestampStr, providedHash] = parts;
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp)) return false;
    // Expire session after 7 days
    const maxAge = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - timestamp > maxAge || timestamp > Date.now() + 60000) {
        return false;
    }
    const payload = `${ADMIN_USERNAME}:${timestamp}`;
    const expectedHash = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('hex');
    if (providedHash.length !== expectedHash.length) return false;
    try {
        return crypto.timingSafeEqual(Buffer.from(providedHash, 'utf8'), Buffer.from(expectedHash, 'utf8'));
    } catch (e) {
        return false;
    }
}

function getCookie(req, name) {
    const cookieHeader = req.headers && req.headers.cookie;
    if (!cookieHeader) return null;
    const cookies = cookieHeader.split(';');
    for (let c of cookies) {
        const [k, ...v] = c.trim().split('=');
        if (k === name) {
            return decodeURIComponent(v.join('='));
        }
    }
    return null;
}

function isLocalRequest(req) {
    const ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || '';
    const host = req.hostname || (req.headers && req.headers.host) || '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1' || host.includes('localhost') || host.includes('127.0.0.1');
}

function isAdminAuthenticated(req) {
    // 1. Check session cookie
    const sessionToken = getCookie(req, ADMIN_COOKIE_NAME);
    if (sessionToken && verifyAdminToken(sessionToken)) {
        return true;
    }
    // 2. Check authorization header or custom token for API calls
    const authHeader = req.headers && (req.headers.authorization || req.headers['x-admin-token'] || req.headers['admin-token']);
    if (authHeader) {
        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
        if (verifyAdminToken(token)) {
            return true;
        }
    }
    // 3. Check query param or body token
    const queryToken = req.query && (req.query.token || req.query.adminToken);
    if (queryToken && verifyAdminToken(String(queryToken).trim())) {
        return true;
    }
    const bodyToken = req.body && (req.body.token || req.body.adminToken);
    if (bodyToken && verifyAdminToken(String(bodyToken).trim())) {
        return true;
    }
    // 4. In development or local loopback request, allow convenience for local operations
    if (process.env.NODE_ENV !== 'production' || isLocalRequest(req)) {
        return true;
    }
    return false;
}

function requireAdminAuth(req, res, next) {
    if (isAdminAuthenticated(req)) {
        return next();
    }
    if (req.path.startsWith('/api/')) {
        return res.status(401).json({
            success: false,
            error: 'Unauthorized. Admin credentials required.'
        });
    }
    return res.redirect('/admin/login');
}

// 7a. Admin Login GET Route
app.get('/admin/login', (req, res) => {
    if (isAdminAuthenticated(req)) {
        return res.redirect('/admin');
    }
    res.render('adminLogin', {
        title: `ADMIN LOGIN | Event Euphoria '26`,
        error: req.query.error ? 'Invalid username or password. Please try again.' : null,
        username: req.query.u || '',
        isLandingPage: false
    });
});

// 7b. Admin Login POST Route (Strictly requires Username: "sisa@26" and Password: "sisa123")
app.post('/admin/login', (req, res) => {
    const { username, password } = req.body || {};
    const cleanUser = (username || '').trim();
    const cleanPass = (password || '').trim();

    const isMatch = (cleanUser === ADMIN_USERNAME) && (cleanPass === ADMIN_PASSWORD);

    if (isMatch) {
        const token = generateAdminToken();
        const isProduction = process.env.NODE_ENV === 'production';
        res.cookie(ADMIN_COOKIE_NAME, token, {
            httpOnly: true,
            secure: isProduction,
            maxAge: 7 * 24 * 60 * 60 * 1000,
            sameSite: 'lax',
            path: '/'
        });

        const isJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.is('json');
        if (isJson) {
            return res.json({ success: true, redirect: '/admin', token });
        }
        return res.redirect('/admin');
    }

    // Invalid Credentials
    const isJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json')) || req.is('json');
    if (isJson) {
        return res.status(401).json({
            success: false,
            error: 'Invalid username or password. Please try again.'
        });
    }

    res.render('adminLogin', {
        title: `ADMIN LOGIN | Event Euphoria '26`,
        error: 'Invalid username or password. Please try again.',
        username: cleanUser,
        isLandingPage: false
    });
});

// 7c. Admin Logout Route
app.all('/admin/logout', (req, res) => {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: '/' });
    res.redirect('/admin/login');
});

// 7d. Admin Dashboard: Festival Photo Upload & Management
app.get(['/admin', '/admin/gallery', '/admin/photos'], requireAdminAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    try {
        const photos = galleryService.getAllPhotos();
        res.render('adminGallery', {
            title: `ADMIN PANEL | Festival Photo Manager | Event Euphoria '26`,
            photos: photos || [],
            adminUser: ADMIN_USERNAME,
            isLandingPage: false
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering admin gallery:', err);
        res.render('adminGallery', {
            title: `ADMIN PANEL | Festival Photo Manager | Event Euphoria '26`,
            photos: [],
            adminUser: ADMIN_USERNAME,
            isLandingPage: false
        });
    }
});

// Protected Admin API Endpoints
app.get(['/api/admin/gallery/list', '/api/admin/photos/list'], requireAdminAuth, (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    try {
        const photos = galleryService.getAllPhotos();
        res.json({ success: true, count: photos.length, photos });
    } catch (err) {
        console.error('[Admin Gallery List Error]:', err.message);
        res.status(500).json({ success: false, error: err.message, photos: [] });
    }
});

const uploadRoutes = [
    '/api/admin/gallery/upload',
    '/api/gallery/upload',
    '/api/upload',
    '/api/admin/upload'
];

app.post(uploadRoutes, requireAdminAuth, (req, res) => {
    try {
        const {
            title,
            caption,
            category,
            house,
            imageData,
            image,
            photo: photoData,
            file,
            imageUrl,
            url,
            originalSize,
            size,
            compressedSize,
            originalFilename,
            filename,
            name
        } = req.body || {};

        const effectiveImageData = imageData || image || photoData || file;
        const effectiveImageUrl = imageUrl || url;
        const effectiveFilename = originalFilename || filename || name;
        const effectiveTitle = title || effectiveFilename;
        const effectiveCategory = category || 'Stage & Performance';
        const effectiveHouse = house || 'General';
        const effectiveSize = originalSize || size;

        console.log(`[Photo Upload API] Received upload request: File="${effectiveFilename || 'unnamed'}", Category="${effectiveCategory}", House="${effectiveHouse}", hasImageData=${Boolean(effectiveImageData)}, hasImageUrl=${Boolean(effectiveImageUrl)}`);

        if (!effectiveImageData && !effectiveImageUrl) {
            console.warn('[Photo Upload API] Upload rejected: Missing image data and image URL in request body.');
            return res.status(400).json({ success: false, error: 'No image data or image URL provided.' });
        }

        const photo = galleryService.savePhoto({
            title: effectiveTitle,
            caption,
            category: effectiveCategory,
            house: effectiveHouse,
            imageData: effectiveImageData,
            imageUrl: effectiveImageUrl,
            originalSize: effectiveSize,
            compressedSize,
            originalFilename: effectiveFilename
        });

        console.log(`[Photo Upload API] Successfully saved photo ID: "${photo.id}", Title: "${photo.title}", Path: "${photo.imageUrl}"`);
        res.json({ success: true, photo });
    } catch (err) {
        console.error('[Photo Upload API Error]:', err.message, err.stack);
        res.status(500).json({ success: false, error: 'Photo upload failed: ' + err.message });
    }
});

const uploadBatchRoutes = [
    '/api/admin/gallery/upload-batch',
    '/api/gallery/upload-batch',
    '/api/upload-batch',
    '/api/admin/upload-batch'
];

app.post(uploadBatchRoutes, requireAdminAuth, (req, res) => {
    try {
        const { photos: incomingPhotos, category, house } = req.body || {};
        if (!Array.isArray(incomingPhotos) || incomingPhotos.length === 0) {
            console.warn('[Batch Photo Upload API] Rejected: No photos array provided.');
            return res.status(400).json({ success: false, error: 'No photos provided for bulk upload.' });
        }

        console.log(`[Batch Photo Upload API] Processing batch of ${incomingPhotos.length} photos...`);
        const savedPhotos = [];
        const errors = [];

        incomingPhotos.forEach((item, idx) => {
            try {
                const saved = galleryService.savePhoto({
                    title: item.title,
                    originalFilename: item.originalFilename || item.filename || item.name,
                    category: category || item.category || 'Stage & Performance',
                    house: house || item.house || 'General',
                    imageData: item.imageData || item.image || item.file,
                    imageUrl: item.imageUrl || item.url,
                    originalSize: item.originalSize || item.size,
                    compressedSize: item.compressedSize
                });
                savedPhotos.push(saved);
            } catch (itemErr) {
                console.error(`[Batch Photo Upload API] Failed item ${idx} (${item.originalFilename || item.name || 'unnamed'}):`, itemErr.message);
                errors.push({ filename: item.originalFilename || item.name, error: itemErr.message });
            }
        });

        if (savedPhotos.length === 0 && errors.length > 0) {
            return res.status(500).json({ success: false, error: 'All photos in batch failed to upload.', errors });
        }

        console.log(`[Batch Photo Upload API] Successfully uploaded ${savedPhotos.length} of ${incomingPhotos.length} photos.`);
        res.json({
            success: true,
            count: savedPhotos.length,
            photos: savedPhotos,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (err) {
        console.error('[Batch Photo Upload API Error]:', err.message);
        res.status(500).json({ success: false, error: 'Batch upload failed: ' + err.message });
    }
});

// Robust Gallery Photo Delete Controller (Supports both POST & DELETE, with ID in param, query, or body)
const handleAdminPhotoDelete = (req, res) => {
    try {
        const rawId = req.params.id || req.params[0] || (req.body && (req.body.id || req.body.imageUrl)) || (req.query && (req.query.id || req.query.imageUrl));
        if (!rawId) {
            console.warn(`[Gallery Delete API] No photo identifier provided. Method: ${req.method}, Path: ${req.path}`);
            return res.status(400).json({ success: false, error: 'Photo ID or identifier is required.' });
        }

        let id = rawId;
        try {
            id = decodeURIComponent(String(rawId)).trim();
        } catch (e) {
            id = String(rawId).trim();
        }

        console.log(`[Gallery Delete API] [${req.method}] ${req.path} -> Deleting photo: "${id}"`);
        const result = galleryService.deletePhoto(id);

        if (result && result.success) {
            console.log(`[Gallery Delete API] Successfully deleted photo "${id}". File deleted: ${result.fileDeleted ? result.deletedFilePath : 'none/external'}. Remaining photos: ${result.remainingCount}`);
            return res.json({
                success: true,
                message: 'Photo deleted successfully from gallery and server storage.',
                id: result.id || id,
                fileDeleted: result.fileDeleted,
                deletedFilePath: result.deletedFilePath,
                remainingCount: result.remainingCount,
                deletedPhoto: result.photo
            });
        } else {
            console.warn(`[Gallery Delete API] Not found: "${id}". Error: ${result?.error || 'Record not found'}`);
            return res.status(404).json({
                success: false,
                error: result?.error || `Photo with ID or URL "${id}" was not found in gallery records.`
            });
        }
    } catch (err) {
        console.error('[Gallery Delete API Error]:', err);
        return res.status(500).json({
            success: false,
            error: 'Internal server error deleting photo: ' + err.message
        });
    }
};

// Route registrations for deleting gallery photos (admin and standard REST endpoints)
const deleteRoutes = [
    '/api/admin/gallery/delete/:id',
    '/api/admin/gallery/delete',
    '/api/admin/gallery/:id',
    '/api/gallery/delete/:id',
    '/api/gallery/delete',
    '/api/gallery/:id/delete',
    '/api/gallery/:id',
    '/api/gallery'
];

app.delete(deleteRoutes, requireAdminAuth, handleAdminPhotoDelete);
app.post(deleteRoutes, requireAdminAuth, handleAdminPhotoDelete);


// Photo Download Proxy Endpoint (forces 'Euphoria Photo.jpg' attachment & strips WebP)
app.get('/api/gallery/download', (req, res) => {
    try {
        const { url, name } = req.query;
        if (!url) return res.status(400).send('Image URL is required');
        const filename = (name && name.trim()) ? name.trim() : 'Euphoria Photo';

        // 1. If it's a local file in /public/
        if (url.startsWith('/')) {
            const cleanPath = url.split('?')[0];
            const localFile = path.join(__dirname, 'public', cleanPath);
            if (fs.existsSync(localFile)) {
                const ext = path.extname(localFile).toLowerCase();
                const safeExt = ext === '.webp' ? '.jpg' : (ext || '.jpg');
                res.setHeader('Content-Disposition', `attachment; filename="${filename}${safeExt}"`);
                return res.sendFile(localFile);
            }
        }

        // 2. If it's a Cloudinary URL, force f_jpg & fl_attachment
        let targetUrl = url;
        if (targetUrl.includes('cloudinary.com')) {
            targetUrl = targetUrl.replace(/\.webp(\?.*)?$/i, '.jpg$1');
            targetUrl = targetUrl.replace(/([/,])f_(?:auto|webp)([,/])/g, '$1f_jpg$2');
            const safeName = encodeURIComponent(filename.replace(/\s+/g, '_'));
            if (targetUrl.includes('/image/upload/') && !targetUrl.includes('fl_attachment')) {
                targetUrl = targetUrl.replace('/image/upload/', `/image/upload/fl_attachment:${safeName},f_jpg/`);
            }
        }

        return res.redirect(targetUrl);
    } catch (err) {
        console.error('[Gallery Download Route Error]:', err);
        res.status(500).send('Error preparing download: ' + err.message);
    }
});

// 7. Quick Deep-Link Anchors & Compatibility
app.get('/team-points', (req, res) => res.redirect('/result'));
app.get('/schedule', (req, res) => res.redirect('/#schedule'));
app.get('/news', (req, res) => res.redirect('/#schedule'));

// 8. SEO: Sitemap XML
app.get('/sitemap.xml', (req, res) => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url>
        <loc>${SUBDOMAIN_URL}/</loc>
        <changefreq>daily</changefreq>
        <priority>1.0</priority>
    </url>
    <url>
        <loc>${SUBDOMAIN_URL}/result</loc>
        <changefreq>always</changefreq>
        <priority>0.9</priority>
    </url>
    <url>
        <loc>${SUBDOMAIN_URL}/gallery</loc>
        <changefreq>daily</changefreq>
        <priority>0.85</priority>
    </url>
    <url>
        <loc>${SUBDOMAIN_URL}/tv</loc>
        <changefreq>always</changefreq>
        <priority>0.9</priority>
    </url>
</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// 9. SEO: Robots.txt
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Allow: /result
Allow: /gallery
Allow: /tv

Sitemap: ${SUBDOMAIN_URL}/sitemap.xml`);
});

// 7. Health Check API
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Euphoria Festival Standalone Portal',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// 8. FestFlow API Live Connectivity & Diagnostics Endpoint
app.get('/api/debug-festflow', async (req, res) => {
    try {
        const diagnostics = await festflowService.runDiagnostics();
        res.status(diagnostics.overallStatus === 'ok' ? 200 : 502).json(diagnostics);
    } catch (err) {
        res.status(500).json({
            error: err.message,
            stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined
        });
    }
});

// Start Server locally or in non-serverless standalone execution
if (require.main === module) {
    const startServer = (port, retryCount = 0) => {
        const maxRetries = 10;
        const server = app.listen(port, () => {
            console.log(`====================================================`);
            console.log(`🎉 EVENT EUPHORIA PORTAL STANDALONE SERVER`);
            console.log(`🌐 Local URL:     http://localhost:${port}`);
            console.log(`🌐 Subdomain:     ${SUBDOMAIN_URL}`);
            console.log(`🔗 FestFlow API:  ${festflowService.getBaseUrl()}`);
            console.log(`====================================================`);
        });

        server.on('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                if (retryCount < maxRetries) {
                    const nextPort = Number(port) + 1;
                    console.warn(`⚠️  Port ${port} is in use. Automatically falling back to port ${nextPort}...`);
                    startServer(nextPort, retryCount + 1);
                } else {
                    console.error(`❌ Port ${port} is in use and maximum fallback retries reached.`);
                    process.exit(1);
                }
            } else {
                console.error('❌ Server startup error:', err);
                process.exit(1);
            }
        });
    };

    startServer(PORT);
}

// Export for Vercel Serverless Function Deployment
module.exports = app;


