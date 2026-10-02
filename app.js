const express = require('express');
const path = require('path');
const hbs = require('hbs');
require('dotenv').config();

const festflowService = require('./services/festflowService');

const app = express();
const PORT = process.env.PORT || 3001;

// Base Configuration
const SUBDOMAIN_URL = (process.env.SUBDOMAIN_URL || 'https://euphoria.sirajulirfan.com').replace(/\/+$/, '');
const MAIN_SITE_URL = (process.env.MAIN_SITE_URL || 'https://sirajulirfan.com').replace(/\/+$/, '');
const FESTIVAL_NAME = process.env.FESTIVAL_NAME || "Event Euphoria '26";
const FESTIVAL_DATE_RAW = process.env.FESTIVAL_DATE || '2026-10-10T06:00:00+05:30';

// Setup View Engine
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// Static Files with caching
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0
}));

// Body Parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

if (hbs.handlebars) {
    hbs.handlebars.registerHelper('json', function (context) {
        const jsonStr = JSON.stringify(context !== undefined ? context : []);
        return hbs.handlebars.SafeString ? new hbs.handlebars.SafeString(jsonStr) : jsonStr;
    });
    hbs.handlebars.registerHelper('padTwo', padTwoFn);
    hbs.handlebars.registerHelper('eq', function (a, b) { return a === b; });
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

        res.render('eventeuphoria', {
            title: `EVENT EUPHORIA '26 | Annual Fest | SIRAJUL IRFAN`,
            houses: houses,
            competitions: competitions,
            isLandingPage: true
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering festival home:', err);
        res.render('eventeuphoria', {
            title: `EVENT EUPHORIA '26 | Annual Fest | SIRAJUL IRFAN`,
            houses: festflowService.FALLBACK_HOUSES,
            competitions: [],
            isLandingPage: true
        });
    }
});

// 2. Official Results Controller & Route
const renderResultsPage = async (req, res) => {
    try {
        const competitions = await festflowService.fetchCompetitions();
        res.render('results', {
            title: `OFFICIAL RESULTS | Event Euphoria '26 | SIRAJUL IRFAN`,
            competitions: Array.isArray(competitions) ? competitions : [],
            isLandingPage: true
        });
    } catch (err) {
        console.error('[Euphoria Portal] Error rendering results:', err);
        res.render('results', {
            title: `OFFICIAL RESULTS | Event Euphoria '26 | SIRAJUL IRFAN`,
            competitions: festflowService.FALLBACK_COMPETITIONS,
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

// 4. Quick SPA Deep-Link Anchors
app.get('/team-points', (req, res) => res.redirect('/result'));
app.get('/gallery', (req, res) => res.redirect('/#gallery'));
app.get('/schedule', (req, res) => res.redirect('/#schedule'));
app.get('/news', (req, res) => res.redirect('/#schedule'));

// 5. SEO: Sitemap XML
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
</urlset>`;
    res.header('Content-Type', 'application/xml');
    res.send(xml);
});

// 6. SEO: Robots.txt
app.get('/robots.txt', (req, res) => {
    res.type('text/plain');
    res.send(`User-agent: *
Allow: /
Allow: /result

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
    app.listen(PORT, () => {
        console.log(`====================================================`);
        console.log(`🎉 EVENT EUPHORIA PORTAL STANDALONE SERVER`);
        console.log(`🌐 Local URL:     http://localhost:${PORT}`);
        console.log(`🌐 Subdomain:     ${SUBDOMAIN_URL}`);
        console.log(`🔗 FestFlow API:  ${festflowService.getBaseUrl()}`);
        console.log(`====================================================`);
    });
}

// Export for Vercel Serverless Function Deployment
module.exports = app;


