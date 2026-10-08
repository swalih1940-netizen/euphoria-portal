// Dedicated Service Worker for Euphoria TV Display
const CACHE_NAME = 'euphoria-tv-v1.0';

const PRECACHE_ASSETS = [
    '/tv',
    '/manifest-tv.json',
    '/images/logo-192.png',
    '/images/logo.png',
    '/images/favicon.ico'
];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[Euphoria TV SW] Pre-caching TV core assets');
            return cache.addAll(PRECACHE_ASSETS).catch((err) => {
                console.warn('[Euphoria TV SW] Precache non-critical warning:', err);
            });
        })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
            );
        }).then(() => self.clients.claim())
    );
    console.log('[Euphoria TV SW] Activated and claimed clients');
});

self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Dynamic Live APIs: Always Network-First (bypass cache to ensure real-time accuracy)
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(
            fetch(request).catch(() => {
                // If offline, return a structured 503 so client-side poll retry handles it smoothly
                return new Response(JSON.stringify({ offline: true, error: 'Network temporarily unavailable' }), {
                    headers: { 'Content-Type': 'application/json' },
                    status: 503
                });
            })
        );
        return;
    }

    // Static Assets & Navigation: Network-First with Cache Fallback for maximum freshness
    event.respondWith(
        fetch(request)
            .then((networkResponse) => {
                if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
                    const responseClone = networkResponse.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        // Only cache same-origin GET requests
                        if (url.origin === self.location.origin) {
                            cache.put(request, responseClone);
                        }
                    });
                }
                return networkResponse;
            })
            .catch(() => {
                return caches.match(request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    if (request.mode === 'navigate') {
                        return caches.match('/tv');
                    }
                    return new Response('Network error occurred on TV feed.', { status: 408 });
                });
            })
    );
});
