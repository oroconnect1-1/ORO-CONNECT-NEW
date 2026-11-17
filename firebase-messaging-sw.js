importScripts(
    "https://www.gstatic.com/firebasejs/10.8.1/firebase-app-compat.js"
);

importScripts(
    "https://www.gstatic.com/firebasejs/10.8.1/firebase-messaging-compat.js"
);


/* FIREBASE INITIALIZATION */

firebase.initializeApp({
    apiKey: "AIzaSyDoL_0OP9FdvAo8NrD2YeAp-jnj1nOs85g",
    authDomain: "oro-connect-1f468.firebaseapp.com",
    projectId: "oro-connect-1f468",
    storageBucket: "oro-connect-1f468.firebasestorage.app",
    messagingSenderId: "1085900037613",
    appId: "1:1085900037613:web:5798235383672dd7da9be4"
});


const messaging = firebase.messaging();


/* BACKGROUND NOTIFICATIONS */

messaging.onBackgroundMessage((payload) => {

    const notification = payload.notification || {};
    const data = payload.data || {};

    /*
     * Notification payload yoo jiraate,
     * Firebase SDK akka ofii agarsiisu eeyyami.
     * Data-only payload qofa asitti agarsiisi.
     */

    if (payload.notification) {
        return;
    }

    const title =
        data.title || "ORO-CONNECT";

    const body =
        data.body || "Beeksisa haaraan jira.";

    const notificationOptions = {

        body,

        icon: "/assets/img/icon.png",

        badge: "/assets/img/icon.png",

        tag: data.notificationId || data.tag || "oro-notification",

        data: {
            url: data.url || data.link || "/",
            notificationId: data.notificationId || ""
        }
    };

    return self.registration.showNotification(
        title,
        notificationOptions
    );
});


/* NOTIFICATION CLICK */

self.addEventListener("notificationclick", (event) => {

    event.notification.close();

    let targetUrl = "/";

    try {

        const requestedUrl =
            event.notification.data?.url || "/";

        const parsedUrl = new URL(
            requestedUrl,
            self.location.origin
        );

        // URL domain app kanaa qofa eeyyami.
        if (parsedUrl.origin === self.location.origin) {
            targetUrl = parsedUrl.href;
        }

    } catch (error) {

        console.warn(
            "[ORO-FCM-SW] Notification URL sirrii miti.",
            error
        );
    }

    event.waitUntil(

        self.clients.matchAll({
            type: "window",
            includeUncontrolled: true
        }).then(async (clients) => {

            for (const client of clients) {

                if (
                    client.url.startsWith(self.location.origin)
                ) {

                    if ("navigate" in client) {
                        await client.navigate(targetUrl);
                    }

                    return client.focus();
                }
            }

            return self.clients.openWindow(targetUrl);
        })
    );
});


/* SERVICE WORKER READY */

self.addEventListener("install", () => {
    console.info("[ORO-FCM-SW] Installed.");
});

self.addEventListener("activate", (event) => {

    event.waitUntil(self.clients.claim());

    console.info("[ORO-FCM-SW] Activated.");
});