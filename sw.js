/* ==========================================
   ORO-CONNECT SERVICE WORKER
   PWA CACHE + FIREBASE CLOUD MESSAGING
========================================== */

"use strict";


/* ==========================================
   FIREBASE CLOUD MESSAGING
========================================== */

importScripts(
    "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js"
);

importScripts(
    "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js"
);

if (!firebase.apps.length) {
    firebase.initializeApp({
        apiKey: "AIzaSyDoL_0OP9FdvAo8NrD2YeAp-jnj1nOs85g",
        authDomain: "oro-connect-1f468.firebaseapp.com",
        projectId: "oro-connect-1f468",
        storageBucket: "oro-connect-1f468.firebasestorage.app",
        messagingSenderId: "1085900037613",
        appId: "1:1085900037613:web:5798235383672dd7da9be4"
    });
}

const messaging = firebase.messaging();


/* ==========================================
   CACHE CONFIGURATION
========================================== */

// Version haaraa: cache duraanii irraa adda baasa.
const SHELL_CACHE = "oro-connect-shell-v5";
const RUNTIME_CACHE = "oro-connect-runtime-v2";

const SHELL = [
    "/",
    "/index.html"
];

const MAX_RUNTIME_CACHE_ITEMS = 150;


/* ==========================================
   URL VALIDATION
========================================== */

function isSafeRoomID(roomID) {
    return (
        typeof roomID === "string" &&
        /^[A-Za-z0-9_-]{1,150}$/.test(roomID)
    );
}


function getSafeSameOriginURL(value) {
    try {
        const parsed = new URL(
            typeof value === "string" ? value : "/",
            self.location.origin
        );

        if (parsed.origin !== self.location.origin) {
            return null;
        }

        return parsed;
    } catch {
        return null;
    }
}


/* ==========================================
   STATIC ASSET FILTER
========================================== */

function isStaticAsset(url) {
    return /\.(?:css|js|mjs|png|jpg|jpeg|webp|gif|svg|ico|woff2?|ttf|otf)$/i
        .test(url.pathname);
}


/* ==========================================
   CACHE RESPONSE VALIDATION
========================================== */

function isCacheableResponse(request, response) {

    if (!response || !response.ok) return false;

    if (response.type !== "basic") return false;

    if (request.method !== "GET") return false;

    if (request.headers.has("Authorization")) return false;

    const cacheControl = (
        response.headers.get("Cache-Control") || ""
    ).toLowerCase();

    if (
        cacheControl.includes("no-store") ||
        cacheControl.includes("private")
    ) {
        return false;
    }

    if (response.headers.get("Vary") === "*") {
        return false;
    }

    if (response.headers.has("Set-Cookie")) {
        return false;
    }

    return true;
}


/* ==========================================
   RUNTIME CACHE CLEANUP
========================================== */

async function trimRuntimeCache() {

    try {

        const cache = await caches.open(RUNTIME_CACHE);
        const keys = await cache.keys();

        if (keys.length <= MAX_RUNTIME_CACHE_ITEMS) {
            return;
        }

        const excess = keys.length - MAX_RUNTIME_CACHE_ITEMS;

        for (const request of keys.slice(0, excess)) {
            await cache.delete(request);
        }

    } catch (error) {

        console.error(
            "[ORO-SW] Runtime cache cleanup failed:",
            error
        );
    }
}


/* ==========================================
   INSTALL
========================================== */

self.addEventListener("install", event => {

    event.waitUntil(

        (async () => {

            const cache = await caches.open(SHELL_CACHE);

            // Core app files.
            await cache.addAll(SHELL);

            // Manifest optional dha.
            try {

                await cache.add("/manifest.json");

            } catch (error) {

                console.warn(
                    "[ORO-SW] Manifest unavailable:",
                    error
                );
            }

            await self.skipWaiting();

            console.info("[ORO-SW] Installation completed.");

        })().catch(error => {

            console.error(
                "[ORO-SW] Installation failed:",
                error
            );

            throw error;
        })
    );

});


/* ==========================================
   ACTIVATE
========================================== */

self.addEventListener("activate", event => {

    event.waitUntil(

        (async () => {

            const keys = await caches.keys();

            await Promise.all(

                keys
                    .filter(key => {

                        return (
                            (
                                key.startsWith("oro-connect-shell-") &&
                                key !== SHELL_CACHE
                            ) ||
                            (
                                key.startsWith("oro-connect-runtime-") &&
                                key !== RUNTIME_CACHE
                            )
                        );

                    })
                    .map(key => caches.delete(key))

            );

            await self.clients.claim();

            console.info("[ORO-SW] Activation completed.");

        })()

    );

});


/* ==========================================
   FETCH HANDLER — PRODUCTION SAFE
========================================== */

self.addEventListener("fetch", event => {
    
    const request = event.request;
    
    if (request.method !== "GET") return;
    
    const url = new URL(request.url);
    
    if (url.origin !== self.location.origin) return;
    
    if (url.pathname.startsWith("/__/")) return;
    
    // Dynamic endpoints hin cache godhin.
    if (
        url.pathname.startsWith("/api/") ||
        url.pathname.includes("/firestore/") ||
        url.pathname.includes("/storage/")
    ) {
        return;
    }
    
    /* HTML NAVIGATION */
    
    if (request.mode === "navigate") {
        
        event.respondWith((async () => {
            
            try {
                
                const response = await fetch(request);
                
                const contentType = (
                    response.headers.get("Content-Type") || ""
                ).toLowerCase();
                
                if (
                    response.ok &&
                    response.type === "basic" &&
                    contentType.includes("text/html")
                ) {
                    const cache = await caches.open(SHELL_CACHE);
                    
                    await cache.put(
                        "/index.html",
                        response.clone()
                    );
                }
                
                return response;
                
            } catch (error) {
                
                const cached = await caches.match(request);
                
                if (cached) return cached;
                
                const shell = await caches.match("/index.html");
                
                if (shell) return shell;
                
                return new Response(
                    "ORO-CONNECT offline. Please reconnect.",
                    {
                        status: 503,
                        headers: {
                            "Content-Type": "text/plain; charset=utf-8"
                        }
                    }
                );
            }
            
        })());
        
        return;
    }
    
    /* STATIC ASSETS */
    
    if (!isStaticAsset(url)) return;
    
    const cachePromise = caches.open(RUNTIME_CACHE);
    
    const cachedPromise = cachePromise.then(
        cache => cache.match(request)
    );
    
    const networkPromise = cachePromise.then(async cache => {
        
        const response = await fetch(request);
        
        if (isCacheableResponse(request, response)) {
            
            await cache.put(
                request,
                response.clone()
            );
            
            await trimRuntimeCache();
        }
        
        return response;
    });
    
    // Background update event keessatti yeroo isaa eeggate.
    event.waitUntil(
        Promise.all([
            cachedPromise,
            networkPromise.catch(error => {
                console.warn(
                    "[ORO-SW] Background asset update failed:",
                    error
                );
            })
        ])
    );
    
    event.respondWith((async () => {
        
        const cached = await cachedPromise;
        
        if (cached) return cached;
        
        try {
            
            return await networkPromise;
            
        } catch (error) {
            
            return new Response(
                "This resource is unavailable offline.",
                {
                    status: 503,
                    headers: {
                        "Content-Type": "text/plain; charset=utf-8"
                    }
                }
            );
        }
        
    })());
    
});

/* ==========================================
   NOTIFICATION CLICK
========================================== */

self.addEventListener("notificationclick", event => {

    event.stopImmediatePropagation();

    const notification = event.notification;
    const data = notification.data || {};

    notification.close();

    event.waitUntil(

        (async () => {

            try {

                let targetUrl = new URL("/", self.location.origin);

                /* CALL NOTIFICATION */

                const callLink = (
                    typeof data.link === "string" &&
                    data.link.startsWith("call:")
                );

                if (callLink) {

                    const roomID = data.link.slice(5);

                    if (!isSafeRoomID(roomID)) {

                        console.warn(
                            "[ORO-SW] Invalid call roomID."
                        );

                        return;
                    }

                    targetUrl.searchParams.set(
                        "oroCall",
                        roomID
                    );

                } else {

                    /* NORMAL NOTIFICATION */

                    const requestedUrl =
                        data.url || data.link || "/";

                    const parsed = getSafeSameOriginURL(
                        requestedUrl
                    );

                    if (!parsed) {

                        console.warn(
                            "[ORO-SW] Unsafe notification URL rejected."
                        );

                        return;
                    }

                    targetUrl = parsed;
                }


                /* FIND OPEN APP WINDOW */

                const windowClients = await self.clients.matchAll({
                    type: "window",
                    includeUncontrolled: true
                });

                for (const client of windowClients) {

                    try {

                        const clientURL = new URL(client.url);

                        if (clientURL.origin !== self.location.origin) {
                            continue;
                        }

                        const navigatedClient = await client.navigate(
                            targetUrl.href
                        );

                        if (navigatedClient) {

                            await navigatedClient.focus();
                            return;
                        }

                        await client.focus();
                        return;

                    } catch (error) {

                        console.warn(
                            "[ORO-SW] Existing window navigation failed:",
                            error
                        );
                    }
                }


                /* OPEN NEW WINDOW */

                await self.clients.openWindow(targetUrl.href);

            } catch (error) {

                console.error(
                    "[ORO-SW] Notification click failed:",
                    error
                );
            }

        })()

    );

});


/* ==========================================
   BACKGROUND NOTIFICATIONS
========================================== */

messaging.onBackgroundMessage(async payload => {

    try {

        const data = payload?.data || {};
        const notification = payload?.notification || {};


        /* TITLE AND BODY */

        const title = String(
            data.title ||
            notification.title ||
            "ORO-CONNECT"
        ).slice(0, 100);

        const body = String(
            data.body ||
            notification.body ||
            "Beeksisa haaraa qabda."
        ).slice(0, 300);


        /* NOTIFICATION ID */

        const notificationId = String(
            data.notificationId ||
            data.roomID ||
            `oro-${Date.now()}`
        ).slice(0, 150);


        /* URL AND CALL VALIDATION */

        let safeUrl = "/";
        let safeRoomID = "";

        const callLink = (
            typeof data.link === "string" &&
            data.link.startsWith("call:")
        );

        if (callLink) {

            safeRoomID = data.link.slice(5);

            if (!isSafeRoomID(safeRoomID)) {

                console.warn(
                    "[ORO-SW] Invalid background call roomID."
                );

                return;
            }

        } else {

            const requestedUrl =
                data.url || data.link || "/";

            const target = getSafeSameOriginURL(
                requestedUrl
            );

            if (!target) {

                console.warn(
                    "[ORO-SW] External notification URL rejected."
                );

                return;
            }

            safeUrl =
                target.pathname +
                target.search +
                target.hash;
        }


        /* DISPLAY NOTIFICATION */

        await self.registration.showNotification(title, {

            body,

            icon: "/icon(1).png",
            badge: "/icon(1).png",

            tag: notificationId,
            renotify: true,

            data: {
                url: safeUrl,
                link: callLink ? `call:${safeRoomID}` : "",
                roomID: safeRoomID,
                notificationId
            }

        });

        console.info(
            "[ORO-FCM-SW] Background notification displayed."
        );

    } catch (error) {

        console.error(
            "[ORO-FCM-SW] Background notification failed:",
            error
        );
    }

});


/* ==========================================
   SERVICE WORKER READY
========================================== */

console.info(
    "[ORO-SW] ORO-CONNECT Service Worker loaded."
);
