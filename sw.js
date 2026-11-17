"use strict";

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

const CACHE_NAME = "oro-connect-shell-v4";

const SHELL_FILES = [
    "/",
    "/index.html",
    "/manifest.json"
];

const STATIC_EXTENSIONS =
    /\.(?:js|css|png|jpg|jpeg|webp|svg|ico|woff2?|ttf)$/i;


/* ==========================================
   INSTALL
========================================== */

self.addEventListener("install", event => {

    event.waitUntil(
        (async () => {

            const cache = await caches.open(CACHE_NAME);

            await Promise.all(
                SHELL_FILES.map(async file => {

                    try {
                        await cache.add(file);
                    } catch (error) {
                        console.warn(
                            "[ORO-SW] Cache skipped:",
                            file,
                            error
                        );
                    }

                })
            );

            await self.skipWaiting();

            console.info("[ORO-SW] Installed.");

        })()
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
                    .filter(key =>
                        key.startsWith("oro-connect-shell-") &&
                        key !== CACHE_NAME
                    )
                    .map(key => caches.delete(key))
            );

            await self.clients.claim();

            console.info("[ORO-SW] Activated.");

        })()
    );

});


/* ==========================================
   FETCH — NAVIGATION NETWORK FIRST
========================================== */

self.addEventListener("fetch", event => {

    const request = event.request;

    if (request.method !== "GET") return;

    const url = new URL(request.url);

    if (url.origin !== self.location.origin) return;

    if (url.pathname.startsWith("/__/")) return;

    if (
        url.pathname.startsWith("/api/") ||
        url.pathname.startsWith("/auth/") ||
        url.pathname.startsWith("/firestore/") ||
        url.pathname.startsWith("/storage/")
    ) {
        return;
    }

    /* HTML navigation */

    if (request.mode === "navigate") {

        event.respondWith(
            (async () => {

                try {

                    const response = await fetch(request);

                    if (response.ok) {

                        const cache = await caches.open(CACHE_NAME);

                        await cache.put(
                            "/index.html",
                            response.clone()
                        );

                    }

                    return response;

                } catch (error) {

                    const cached =
                        await caches.match("/index.html");

                    return cached || Response.error();

                }

            })()
        );

        return;
    }


    /* Static assets only */

    if (!STATIC_EXTENSIONS.test(url.pathname)) return;

    event.respondWith(
        (async () => {

            try {

                const response = await fetch(request);

                if (
                    response.ok &&
                    response.type === "basic" &&
                    !response.headers.get("Cache-Control")?.includes("no-store") &&
                    !response.headers.get("Cache-Control")?.includes("private")
                ) {

                    const cache = await caches.open(CACHE_NAME);

                    await cache.put(
                        request,
                        response.clone()
                    );

                }

                return response;

            } catch (error) {

                const cached = await caches.match(request);

                return cached || Response.error();

            }

        })()
    );

});


/* ==========================================
   BACKGROUND NOTIFICATIONS
========================================== */

messaging.onBackgroundMessage(async payload => {

    try {

        const data = payload.data || {};

        /*
         * Notification payload:
         * Firebase notification display irratti hirkanna.
         */

        if (payload.notification) {
            return;
        }

        const title =
            data.title || "ORO-CONNECT";

        const body =
            data.body || "Beeksisa haaraa qabda.";

        const requestedUrl =
            data.url || data.link || "/";

        let safeUrl = self.location.origin + "/";

        try {

            const parsed = new URL(
                requestedUrl,
                self.location.origin
            );

            if (parsed.origin === self.location.origin) {
                safeUrl = parsed.href;
            }

        } catch (error) {

            console.warn(
                "[ORO-FCM] Invalid notification URL:",
                error
            );

        }

        const notificationId =
            data.notificationId ||
            data.tag ||
            `oro-${Date.now()}-${Math.random()
                .toString(36).slice(2)}`;

        await self.registration.showNotification(title, {

            body,

            icon: "/assets/img/icon.png",

            badge: "/assets/img/icon.png",

            tag: notificationId,

            renotify: false,

            data: {
                url: safeUrl,
                notificationId
            }

        });

        console.info(
            "[ORO-FCM] Background notification displayed."
        );

    } catch (error) {

        console.error(
            "[ORO-FCM] Background notification failed:",
            error
        );

    }

});


/* ==========================================
   NOTIFICATION CLICK
========================================== */

self.addEventListener("notificationclick", event => {

    event.notification.close();

    let targetUrl = self.location.origin + "/";

    try {

        const requestedUrl =
            event.notification.data?.url || "/";

        const parsed = new URL(
            requestedUrl,
            self.location.origin
        );

        if (parsed.origin === self.location.origin) {
            targetUrl = parsed.href;
        }

    } catch (error) {

        console.warn(
            "[ORO-FCM] Invalid click URL:",
            error
        );

    }

    event.waitUntil(
        (async () => {

            const clients = await self.clients.matchAll({
                type: "window",
                includeUncontrolled: true
            });

            for (const client of clients) {

                if (
                    new URL(client.url).origin ===
                    self.location.origin
                ) {

                    if (typeof client.navigate === "function") {
                        await client.navigate(targetUrl);
                    }

                    return client.focus();

                }

            }

            return self.clients.openWindow(targetUrl);

        })()
    );

});


console.info("[ORO-SW] ORO-CONNECT Service Worker ready.");