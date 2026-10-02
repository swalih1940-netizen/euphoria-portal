// Basic Service Worker for PWA installability
const CACHE_NAME = 'sisa-admin-pwa-v1';

self.addEventListener('install', (event) => {
    self.skipWaiting();
    console.log('[ServiceWorker] Install');
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
    console.log('[ServiceWorker] Activate');
});

self.addEventListener('fetch', (event) => {
    // Simple fetch listener to satisfy PWA criteria.
    // It attempts to fetch from the network.
    event.respondWith(
        fetch(event.request).catch((error) => {
            console.log('[ServiceWorker] Fetch Failed:', error);
            // In a full PWA, you would return a cached offline page here
            return new Response('You are offline. Please check your internet connection.', {
                status: 503,
                statusText: 'Service Unavailable'
            });
        })
    );
});
