"use strict";

const { onCall, HttpsError } =
    require("firebase-functions/v2/https");

const { onDocumentCreated } =
    require("firebase-functions/v2/firestore");

const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();
const rtdb = admin.database();

const REGION = "us-central1";
const DELETE_TIMEOUT = 540;


/* =====================================================
   1. DELETE HELPERS
===================================================== */

async function deleteQuery(queryRef) {
    let deleted = 0;

    while (true) {
        const snapshot = await queryRef.limit(200).get();

        if (snapshot.empty) break;

        for (const document of snapshot.docs) {
            await db.recursiveDelete(document.ref);
            deleted++;
        }
    }

    return deleted;
}


/**
 * Storage files prefix jalatti argaman haqa.
 */
async function deleteStoragePrefix(prefix) {
    const [files] = await bucket.getFiles({ prefix });

    for (const file of files) {
        try {
            await file.delete();
        } catch (error) {
            if (error.code !== 404) {
                throw error;
            }
        }
    }
}


/* =====================================================
   2. DELETE MY ACCOUNT
===================================================== */

exports.deleteMyAccount = onCall(
    {
        region: REGION,
        enforceAppCheck: true,
        timeoutSeconds: DELETE_TIMEOUT,
        memory: "1GiB"
    },

    async (request) => {

        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "Dura account keessan seenaa."
            );
        }

        const uid = request.auth.uid;

        // Recent login mirkaneessi.
        const authTime = Number(
            request.auth.token.auth_time || 0
        );

        const now = Math.floor(Date.now() / 1000);

        if (!authTime || now - authTime > 5 * 60) {
            throw new HttpsError(
                "failed-precondition",
                "Nageenyaaf irra deebi'anii seenuun barbaachisa."
            );
        }

        const userRef = db.collection("users").doc(uid);

        try {

            // Posts fayyadamaa haqi.
            await deleteQuery(
                db.collection("posts")
                    .where("userId", "==", uid)
            );

            // Stories haqi.
            await deleteQuery(
                db.collection("stories")
                    .where("userId", "==", uid)
            );

            // Videos haqi.
            await deleteQuery(
                db.collection("videos")
                    .where("userId", "==", uid)
            );

            // Calls caller ta'ee galmaa'e haqi.
            await deleteQuery(
                db.collection("calls")
                    .where("callerID", "==", uid)
            );

            // Calls receiver ta'ee galmaa'e haqi.
            await deleteQuery(
                db.collection("calls")
                    .where("receiverID", "==", uid)
            );

            // Call history haqi.
            await deleteQuery(
                db.collection("callLogs")
                    .where("participantIDs", "array-contains", uid)
            );

            // Notifications erge fi fudhate haqi.
            await deleteQuery(
                db.collection("notifications")
                    .where("fromUserId", "==", uid)
            );

            await deleteQuery(
                db.collection("notifications")
                    .where("toUserId", "==", uid)
            );

            // Storage files.
            await deleteStoragePrefix(`users/${uid}/`);
            await deleteStoragePrefix(`profiles/${uid}/`);

            // Realtime Database presence.
            await rtdb.ref(`status/${uid}`).remove();

            // User document fi subcollections.
            await db.recursiveDelete(userRef);

            // Firebase Authentication account.
            await admin.auth().deleteUser(uid);

            console.log(
                "[ORO-DELETE] Account deleted:",
                uid
            );

            return {
                success: true,
                message: "Account fi ragaan isaa haqameera."
            };

        } catch (error) {

            console.error(
                "[ORO-DELETE] Failed:",
                uid,
                error
            );

            throw new HttpsError(
                "internal",
                "Account haquun guutuu hin milkoofne. Deeggarsa qunnamaa."
            );
        }
    }
);


/* =====================================================
   3. NOTIFICATION HELPERS
===================================================== */

/**
 * Notification title.
 */
function getNotificationTitle(type) {

    const titles = {
        like: "ORO-CONNECT ❤️",
        comment: "ORO-CONNECT 💬",
        reply: "ORO-CONNECT 💬",
        follow: "ORO-CONNECT 👤",
        message: "ORO-CONNECT ✉️",
        call: "ORO-CONNECT 📞",
        incoming_call: "ORO-CONNECT 📞",
        general: "ORO-CONNECT"
    };

    return titles[String(type || "general").toLowerCase()]
        || titles.general;
}


/**
 * Notification body.
 * Dheerina isaa daangessa.
 */
function getNotificationBody(data) {

    const text = String(
        data.text ||
        data.body ||
        "Beeksisa haaraa qabda."
    );

    return text.slice(0, 250);
}


/**
 * Internal URL qofa hayyama.
 * External URL hin fudhatu.
 */
function getSafeNotificationUrl(value) {

    const fallback = "/";

    if (typeof value !== "string") {
        return fallback;
    }

    const url = value.trim();

    if (!url || url.length > 500) {
        return fallback;
    }

    if (
        !url.startsWith("/") ||
        url.startsWith("//") ||
        url.includes("\\")
    ) {
        return fallback;
    }

    return url;
}


/* =====================================================
   4. SEND PUSH NOTIFICATION
===================================================== */

async function sendORONotification(
    notificationId,
    data
) {

    // Client app keessatti toUserId fayyadama.
    const recipientUid =
        data.toUserId ||
        data.userId ||
        data.recipientId ||
        data.receiverId ||
        data.toUid;

    if (
        typeof recipientUid !== "string" ||
        !recipientUid.trim()
    ) {
        console.warn(
            "[ORO-FCM] Recipient UID hin jiru:",
            notificationId
        );

        return;
    }

    // Nama ergaa ergeef ofii isaatti hin ergin.
    const senderId =
        data.fromUserId ||
        data.senderId ||
        data.fromUid;

    if (senderId && senderId === recipientUid) {
        return;
    }

    // FCM token private document irraa dubbisi.
    const tokenRef = db
        .collection("users")
        .doc(recipientUid)
        .collection("private")
        .doc("fcm");

    const tokenSnapshot = await tokenRef.get();

    if (!tokenSnapshot.exists) {
        console.info(
            "[ORO-FCM] User FCM token hin qabu:",
            recipientUid
        );

        return;
    }

    const token = tokenSnapshot.get("fcmToken");

    if (
        typeof token !== "string" ||
        token.length < 20
    ) {
        console.warn(
            "[ORO-FCM] FCM token sirrii miti:",
            recipientUid
        );

        return;
    }

    const type = String(data.type || "general");

    const title = getNotificationTitle(type);
    const body = getNotificationBody(data);

    const url = getSafeNotificationUrl(
        data.url || data.link
    );

    // FCM data values hundi string ta'uu qabu.
    const message = {

        token: token,

        notification: {
            title: title,
            body: body
        },

        data: {
            title: title,
            body: body,
            type: type,
            notificationId: String(notificationId),
            url: url,
            senderId: String(senderId || ""),
            recipientUid: String(recipientUid)
        },

        android: {
            priority: "high",

            notification: {
                channelId: "oro_notifications",
                sound: "default",
                defaultVibrateTimings: true
            }
        },

        webpush: {

            headers: {
                Urgency: "high",
                TTL: "86400"
            },

            notification: {
                title: title,
                body: body,
                icon: "/icon(1).png",
                badge: "/icon(1).png",
                tag: String(notificationId),
                renotify: true
            },

            fcmOptions: {
                link:
                    "https://oro-connect-1f468.web.app" +
                    url
            }
        }
    };

    try {

        const response =
            await admin.messaging().send(message);

        console.log(
            "[ORO-FCM] Notification sent:",
            {
                notificationId,
                recipientUid,
                messageId: response
            }
        );

        return response;

    } catch (error) {

        console.error(
            "[ORO-FCM] Sending failed:",
            {
                notificationId,
                recipientUid,
                code: error.code,
                message: error.message
            }
        );

        // Token hojii irra hin jirre haqi.
        const invalidTokenErrors = [
            "messaging/invalid-registration-token",
            "messaging/registration-token-not-registered"
        ];

        if (invalidTokenErrors.includes(error.code)) {

            await tokenRef.update({

                fcmToken:
                    admin.firestore.FieldValue.delete(),

                lastTokenUpdate:
                    admin.firestore.FieldValue.serverTimestamp()

            }).catch(cleanupError => {

                console.warn(
                    "[ORO-FCM] Invalid token cleanup failed:",
                    cleanupError
                );

            });
        }

        throw error;
    }
}


/* =====================================================
   5. FIRESTORE NOTIFICATION TRIGGER
===================================================== */

exports.sendORONotification = onDocumentCreated(
    {
        document: "notifications/{notificationId}",
        region: REGION
    },

    async (event) => {

        const snapshot = event.data;

        if (!snapshot) {
            return;
        }

        const notificationId =
            event.params.notificationId;

        const data = snapshot.data();

        if (!data) {
            return;
        }

        try {

            await sendORONotification(
                notificationId,
                data
            );

        } catch (error) {

            console.error(
                "[ORO-FCM] Trigger failed:",
                notificationId,
                error
            );

            throw error;
        }
    }
);


/* =====================================================
   6. INCOMING CALL FCM PUSH NOTIFICATION
===================================================== */

exports.sendIncomingCallNotification = onDocumentCreated(
    {
        document: "calls/{roomID}",
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60
    },

    async (event) => {

        const snapshot = event.data;

        if (!snapshot) return;

        const call = snapshot.data();
        const roomID = event.params.roomID;

        // Call data mirkaneessi.
        if (
            !call ||
            call.status !== "calling" ||
            !roomID ||
            typeof call.callerID !== "string" ||
            typeof call.receiverID !== "string" ||
            call.callerID === call.receiverID ||
            !["voice", "video"].includes(call.type)
        ) {
            console.warn(
                "[ORO-CALL] Invalid call document:",
                roomID
            );

            return;
"use strict";

const { onCall, HttpsError } =
    require("firebase-functions/v2/https");

const { onDocumentCreated } =
    require("firebase-functions/v2/firestore");

const admin = require("firebase-admin");

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();
const rtdb = admin.database();

const REGION = "us-central1";
const DELETE_TIMEOUT = 540;

/* =====================================================
   SUPABASE FIREBASE AUTH ROLE
===================================================== */

exports.ensureSupabaseRole = onCall(
    {
        region: REGION
    },

    async (request) => {

        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "Dura account keessan seenaa."
            );
        }

        const uid = request.auth.uid;

        try {

            // Claims duraan jiran eegi.
            const userRecord =
                await admin.auth().getUser(uid);

            const existingClaims =
                userRecord.customClaims || {};

            // Role sirreessi; claims biroo hin haqin.
            if (
                existingClaims.role !== "authenticated"
            ) {

                await admin.auth().setCustomUserClaims(
                    uid,
                    {
                        ...existingClaims,
                        role: "authenticated"
                    }
                );
            }

            return {
                success: true,
                role: "authenticated"
            };

        } catch (error) {

            console.error(
                "[ORO-SUPABASE] Role assignment failed:",
                uid,
                error
            );

            throw new HttpsError(
                "internal",
                "Supabase authentication sirreessuun hin milkoofne."
            );
        }
    }
);
/* =====================================================
   1. DELETE HELPERS
===================================================== */

async function deleteQuery(queryRef) {
    let deleted = 0;

    while (true) {
        const snapshot = await queryRef.limit(200).get();

        if (snapshot.empty) break;

        for (const document of snapshot.docs) {
            await db.recursiveDelete(document.ref);
            deleted++;
        }
    }

    return deleted;
}


/**
 * Storage files prefix jalatti argaman haqa.
 */
async function deleteStoragePrefix(prefix) {
    const [files] = await bucket.getFiles({ prefix });

    for (const file of files) {
        try {
            await file.delete();
        } catch (error) {
            if (error.code !== 404) {
                throw error;
            }
        }
    }
}


/* =====================================================
   2. DELETE MY ACCOUNT
===================================================== */

exports.deleteMyAccount = onCall(
    {
        region: REGION,
        enforceAppCheck: true,
        timeoutSeconds: DELETE_TIMEOUT,
        memory: "1GiB"
    },

    async (request) => {

        if (!request.auth) {
            throw new HttpsError(
                "unauthenticated",
                "Dura account keessan seenaa."
            );
        }

        const uid = request.auth.uid;

        // Recent login mirkaneessi.
        const authTime = Number(
            request.auth.token.auth_time || 0
        );

        const now = Math.floor(Date.now() / 1000);

        if (!authTime || now - authTime > 5 * 60) {
            throw new HttpsError(
                "failed-precondition",
                "Nageenyaaf irra deebi'anii seenuun barbaachisa."
            );
        }

        const userRef = db.collection("users").doc(uid);

        try {

            // Posts fayyadamaa haqi.
            await deleteQuery(
                db.collection("posts")
                    .where("userId", "==", uid)
            );

            // Stories haqi.
            await deleteQuery(
                db.collection("stories")
                    .where("userId", "==", uid)
            );

            // Videos haqi.
            await deleteQuery(
                db.collection("videos")
                    .where("userId", "==", uid)
            );

            // Calls caller ta'ee galmaa'e haqi.
            await deleteQuery(
                db.collection("calls")
                    .where("callerID", "==", uid)
            );

            // Calls receiver ta'ee galmaa'e haqi.
            await deleteQuery(
                db.collection("calls")
                    .where("receiverID", "==", uid)
            );

            // Call history haqi.
            await deleteQuery(
                db.collection("callLogs")
                    .where("participantIDs", "array-contains", uid)
            );

            // Notifications erge fi fudhate haqi.
            await deleteQuery(
                db.collection("notifications")
                    .where("fromUserId", "==", uid)
            );

            await deleteQuery(
                db.collection("notifications")
                    .where("toUserId", "==", uid)
            );

            // Storage files.
            await deleteStoragePrefix(`users/${uid}/`);
            await deleteStoragePrefix(`profiles/${uid}/`);

            // Realtime Database presence.
            await rtdb.ref(`status/${uid}`).remove();

            // User document fi subcollections.
            await db.recursiveDelete(userRef);

            // Firebase Authentication account.
            await admin.auth().deleteUser(uid);

            console.log(
                "[ORO-DELETE] Account deleted:",
                uid
            );

            return {
                success: true,
                message: "Account fi ragaan isaa haqameera."
            };

        } catch (error) {

            console.error(
                "[ORO-DELETE] Failed:",
                uid,
                error
            );

            throw new HttpsError(
                "internal",
                "Account haquun guutuu hin milkoofne. Deeggarsa qunnamaa."
            );
        }
    }
);


/* =====================================================
   3. NOTIFICATION HELPERS
===================================================== */

/**
 * Notification title.
 */
function getNotificationTitle(type) {

    const titles = {
        like: "ORO-CONNECT ❤️",
        comment: "ORO-CONNECT 💬",
        reply: "ORO-CONNECT 💬",
        follow: "ORO-CONNECT 👤",
        message: "ORO-CONNECT ✉️",
        call: "ORO-CONNECT 📞",
        incoming_call: "ORO-CONNECT 📞",
        general: "ORO-CONNECT"
    };

    return titles[String(type || "general").toLowerCase()]
        || titles.general;
}


/**
 * Notification body.
 * Dheerina isaa daangessa.
 */
function getNotificationBody(data) {

    const text = String(
        data.text ||
        data.body ||
        "Beeksisa haaraa qabda."
    );

    return text.slice(0, 250);
}


/**
 * Internal URL qofa hayyama.
 * External URL hin fudhatu.
 */
function getSafeNotificationUrl(value) {

    const fallback = "/";

    if (typeof value !== "string") {
        return fallback;
    }

    const url = value.trim();

    if (!url || url.length > 500) {
        return fallback;
    }

    if (
        !url.startsWith("/") ||
        url.startsWith("//") ||
        url.includes("\\")
    ) {
        return fallback;
    }

    return url;
}


/* =====================================================
   4. SEND PUSH NOTIFICATION
===================================================== */

async function sendORONotification(
    notificationId,
    data
) {

    // Client app keessatti toUserId fayyadama.
    const recipientUid =
        data.toUserId ||
        data.userId ||
        data.recipientId ||
        data.receiverId ||
        data.toUid;

    if (
        typeof recipientUid !== "string" ||
        !recipientUid.trim()
    ) {
        console.warn(
            "[ORO-FCM] Recipient UID hin jiru:",
            notificationId
        );

        return;
    }

    // Nama ergaa ergeef ofii isaatti hin ergin.
    const senderId =
        data.fromUserId ||
        data.senderId ||
        data.fromUid;

    if (senderId && senderId === recipientUid) {
        return;
    }

    // FCM token private document irraa dubbisi.
    const tokenRef = db
        .collection("users")
        .doc(recipientUid)
        .collection("private")
        .doc("fcm");

    const tokenSnapshot = await tokenRef.get();

    if (!tokenSnapshot.exists) {
        console.info(
            "[ORO-FCM] User FCM token hin qabu:",
            recipientUid
        );

        return;
    }

    const token = tokenSnapshot.get("fcmToken");

    if (
        typeof token !== "string" ||
        token.length < 20
    ) {
        console.warn(
            "[ORO-FCM] FCM token sirrii miti:",
            recipientUid
        );

        return;
    }

    const type = String(data.type || "general");

    const title = getNotificationTitle(type);
    const body = getNotificationBody(data);

    const url = getSafeNotificationUrl(
        data.url || data.link
    );

    // FCM data values hundi string ta'uu qabu.
    const message = {

        token: token,

        notification: {
            title: title,
            body: body
        },

        data: {
            title: title,
            body: body,
            type: type,
            notificationId: String(notificationId),
            url: url,
            senderId: String(senderId || ""),
            recipientUid: String(recipientUid)
        },

        android: {
            priority: "high",

            notification: {
                channelId: "oro_notifications",
                sound: "default",
                defaultVibrateTimings: true
            }
        },

        webpush: {

            headers: {
                Urgency: "high",
                TTL: "86400"
            },

            notification: {
                title: title,
                body: body,
                icon: "/icon(1).png",
                badge: "/icon(1).png",
                tag: String(notificationId),
                renotify: true
            },

            fcmOptions: {
                link:
                    "https://oro-connect-1f468.web.app" +
                    url
            }
        }
    };

    try {

        const response =
            await admin.messaging().send(message);

        console.log(
            "[ORO-FCM] Notification sent:",
            {
                notificationId,
                recipientUid,
                messageId: response
            }
        );

        return response;

    } catch (error) {

        console.error(
            "[ORO-FCM] Sending failed:",
            {
                notificationId,
                recipientUid,
                code: error.code,
                message: error.message
            }
        );

        // Token hojii irra hin jirre haqi.
        const invalidTokenErrors = [
            "messaging/invalid-registration-token",
            "messaging/registration-token-not-registered"
        ];

        if (invalidTokenErrors.includes(error.code)) {

            await tokenRef.update({

                fcmToken:
                    admin.firestore.FieldValue.delete(),

                lastTokenUpdate:
                    admin.firestore.FieldValue.serverTimestamp()

            }).catch(cleanupError => {

                console.warn(
                    "[ORO-FCM] Invalid token cleanup failed:",
                    cleanupError
                );

            });
        }

        throw error;
    }
}


/* =====================================================
   5. FIRESTORE NOTIFICATION TRIGGER
===================================================== */

exports.sendORONotification = onDocumentCreated(
    {
        document: "notifications/{notificationId}",
        region: REGION
    },

    async (event) => {

        const snapshot = event.data;

        if (!snapshot) {
            return;
        }

        const notificationId =
            event.params.notificationId;

        const data = snapshot.data();

        if (!data) {
            return;
        }

        try {

            await sendORONotification(
                notificationId,
                data
            );

        } catch (error) {

            console.error(
                "[ORO-FCM] Trigger failed:",
                notificationId,
                error
            );

            throw error;
        }
    }
);


/* =====================================================
   6. INCOMING CALL FCM PUSH NOTIFICATION
===================================================== */

exports.sendIncomingCallNotification = onDocumentCreated(
    {
        document: "calls/{roomID}",
        region: REGION,
        memory: "256MiB",
        timeoutSeconds: 60
    },

    async (event) => {

        const snapshot = event.data;

        if (!snapshot) return;

        const call = snapshot.data();
        const roomID = event.params.roomID;

        // Call data mirkaneessi.
        if (
            !call ||
            call.status !== "calling" ||
            !roomID ||
            typeof call.callerID !== "string" ||
            typeof call.receiverID !== "string" ||
            call.callerID === call.receiverID ||
            !["voice", "video"].includes(call.type)
        ) {
            console.warn(
                "[ORO-CALL] Invalid call document:",
                roomID
            );

            return;
        }

        // Participants mirkaneessi.
        if (
            !Array.isArray(call.participantIDs) ||
            !call.participantIDs.includes(call.callerID) ||
            !call.participantIDs.includes(call.receiverID)
        ) {
            console.warn(
                "[ORO-CALL] Invalid participants:",
                roomID
            );

            return;
        }

        const receiverUID = call.receiverID;

        // Receiver FCM token dubbisi.
        const tokenRef = db
            .collection("users")
            .doc(receiverUID)
            .collection("private")
            .doc("fcm");

        const tokenSnapshot = await tokenRef.get();

        if (!tokenSnapshot.exists) {
            console.info(
                "[ORO-CALL] Receiver has no FCM token:",
                receiverUID
            );

            return;
        }

        const token = tokenSnapshot.get("fcmToken");

        if (
            typeof token !== "string" ||
            token.length < 20
        ) {
            console.warn(
                "[ORO-CALL] Invalid FCM token:",
                receiverUID
            );

            return;
        }

        const isVideo = call.type === "video";

        const title = isVideo
            ? "ORO-CONNECT 📹"
            : "ORO-CONNECT 📞";

        const body = isVideo
            ? "Bilbila viidiyoo siif bilbileera."
            : "Bilbila sagalee siif bilbileera.";

        try {

            // Data-only message:
            // Service worker notification agarsiisa.
            const message = {

                token: token,

                data: {
                    title: title,
                    body: body,
                    type: "incoming_call",
                    roomID: String(roomID),
                    callType: isVideo ? "video" : "voice",
                    link: `call:${roomID}`,
                    senderId: String(call.callerID),
                    recipientUid: String(receiverUID)
                },

                android: {
                    priority: "high",
                    ttl: 60000
                },

                webpush: {
                    headers: {
                        Urgency: "high",
                        TTL: "60"
                    }
                }
            };

            const response =
                await admin.messaging().send(message);

            console.log(
                "[ORO-CALL] Incoming call push sent:",
                {
                    roomID,
                    receiverUID,
                    messageId: response
                }
            );

        } catch (error) {

            console.error(
                "[ORO-CALL] FCM failed:",
                {
                    roomID,
                    receiverUID,
                    code: error.code,
                    message: error.message
                }
            );

            const invalidTokenErrors = [
                "messaging/invalid-registration-token",
                "messaging/registration-token-not-registered"
            ];

            if (invalidTokenErrors.includes(error.code)) {

                await tokenRef.update({

                    fcmToken:
                        admin.firestore.FieldValue.delete(),

                    lastTokenUpdate:
                        admin.firestore.FieldValue.serverTimestamp()

                }).catch(cleanupError => {

                    console.warn(
                        "[ORO-CALL] Token cleanup failed:",
                        cleanupError
                    );

                });

                return;
            }

            throw error;
        }
    }
);


/* =====================================================
   7. INITIALIZATION LOG
===================================================== */

console.log(
    "[ORO-CONNECT] Cloud Functions initialized."
);
