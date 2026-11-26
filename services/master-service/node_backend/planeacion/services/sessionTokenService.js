"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_TTL_SECONDS = void 0;
exports.signSessionToken = signSessionToken;
exports.verifySessionToken = verifySessionToken;
exports.parseCookieHeader = parseCookieHeader;
exports.extractSessionFromRequest = extractSessionFromRequest;
exports.setPersistentSessionCookie = setPersistentSessionCookie;
exports.clearPersistentSessionCookie = clearPersistentSessionCookie;
const node_crypto_1 = __importDefault(require("node:crypto"));
exports.SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 días de persistencia en dispositivo
const COOKIE_NAMES = {
    taller: 'base_taller_session',
    coordinacion: 'base_coord_session',
};
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function getSigningKey() {
    const rawSecret = process.env.SESSION_SECRET ||
        process.env.JWT_SECRET ||
        process.env.DATABASE_URL ||
        'base-planeacion-local-dev-secret-v1';
    return node_crypto_1.default.createHash('sha256').update(`base_session_v1:${rawSecret}`).digest();
}
function toBase64Url(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}
function fromBase64Url(input) {
    const padded = input.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    return Buffer.from(padded + '='.repeat(padLen), 'base64');
}
/**
 * Firma un token stateless HMAC-SHA256 para persistencia de sesión en dispositivos (O(1) CPU, 0 DB I/O).
 */
function signSessionToken(userId, rol, ttlSeconds = exports.SESSION_TTL_SECONDS) {
    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: userId.trim(),
        rol,
        iat: now,
        exp: now + ttlSeconds,
    };
    const encodedPayload = toBase64Url(JSON.stringify(payload));
    const sig = node_crypto_1.default
        .createHmac('sha256', getSigningKey())
        .update(encodedPayload)
        .digest();
    return `${encodedPayload}.${toBase64Url(sig)}`;
}
/**
 * Verifica firma HMAC-SHA256, expiración y rol esperado en tiempo constante (O(1)).
 */
function verifySessionToken(token, expectedRol) {
    if (!token || typeof token !== 'string')
        return null;
    const trimmed = token.trim();
    const dotIdx = trimmed.indexOf('.');
    if (dotIdx <= 0 || dotIdx === trimmed.length - 1)
        return null;
    const encodedPayload = trimmed.slice(0, dotIdx);
    const encodedSig = trimmed.slice(dotIdx + 1);
    try {
        const expectedSig = node_crypto_1.default
            .createHmac('sha256', getSigningKey())
            .update(encodedPayload)
            .digest();
        const providedSig = fromBase64Url(encodedSig);
        if (expectedSig.length !== providedSig.length)
            return null;
        if (!node_crypto_1.default.timingSafeEqual(expectedSig, providedSig))
            return null;
        const decoded = JSON.parse(fromBase64Url(encodedPayload).toString('utf8'));
        if (!decoded ||
            typeof decoded.sub !== 'string' ||
            !UUID_REGEX.test(decoded.sub) ||
            (decoded.rol !== 'taller' && decoded.rol !== 'coordinacion') ||
            typeof decoded.exp !== 'number' ||
            typeof decoded.iat !== 'number') {
            return null;
        }
        const now = Math.floor(Date.now() / 1000);
        if (decoded.exp <= now)
            return null;
        if (expectedRol && decoded.rol !== expectedRol)
            return null;
        return {
            sub: decoded.sub,
            rol: decoded.rol,
            iat: decoded.iat,
            exp: decoded.exp,
        };
    }
    catch {
        return null;
    }
}
function parseCookieHeader(cookieHeader) {
    const cookies = {};
    if (!cookieHeader)
        return cookies;
    const parts = cookieHeader.split(';');
    for (const part of parts) {
        const eqIdx = part.indexOf('=');
        if (eqIdx <= 0)
            continue;
        const key = part.slice(0, eqIdx).trim();
        const val = part.slice(eqIdx + 1).trim();
        if (key) {
            try {
                cookies[key] = decodeURIComponent(val);
            }
            catch {
                cookies[key] = val;
            }
        }
    }
    return cookies;
}
function extractSessionFromRequest(req, expectedRol) {
    // 1. Authorization: Bearer <token> (prioridad para cross-origin / Safari ITP / mobile WebViews)
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
        const bearerToken = authHeader.slice(7).trim();
        const verified = verifySessionToken(bearerToken, expectedRol);
        if (verified)
            return verified;
    }
    // 2. Cookie HttpOnly persistente del dispositivo
    const cookies = parseCookieHeader(req.headers.cookie);
    if (expectedRol) {
        const rawCookie = cookies[COOKIE_NAMES[expectedRol]];
        const verified = verifySessionToken(rawCookie, expectedRol);
        if (verified)
            return verified;
        return null;
    }
    // Sin rol esperado: probar primero según x-origen si viene explícito
    const rawOrigen = req.headers['x-origen'] ? String(req.headers['x-origen']).trim() : '';
    const order = rawOrigen === 'coordinacion' ? ['coordinacion', 'taller'] : ['taller', 'coordinacion'];
    for (const role of order) {
        const verified = verifySessionToken(cookies[COOKIE_NAMES[role]], role);
        if (verified)
            return verified;
    }
    return null;
}
function isSecureRequest(req) {
    if (req.secure)
        return true;
    const forwardedProto = req.headers['x-forwarded-proto'];
    if (typeof forwardedProto === 'string') {
        return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
    }
    return process.env.NODE_ENV === 'production';
}
function isCrossSiteRequest(req) {
    const origin = req.headers.origin;
    const host = req.headers.host;
    if (!origin || !host)
        return false;
    try {
        const originHost = new URL(origin).host;
        return originHost !== host;
    }
    catch {
        return false;
    }
}
function setPersistentSessionCookie(res, req, rol, token, maxAgeSeconds = exports.SESSION_TTL_SECONDS) {
    const secure = isSecureRequest(req);
    const crossSite = isCrossSiteRequest(req);
    const sameSite = secure && crossSite ? 'none' : 'lax';
    res.cookie(COOKIE_NAMES[rol], token, {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
        maxAge: maxAgeSeconds * 1000,
    });
}
function clearPersistentSessionCookie(res, req, rol) {
    const secure = isSecureRequest(req);
    const crossSite = isCrossSiteRequest(req);
    const sameSite = secure && crossSite ? 'none' : 'lax';
    res.clearCookie(COOKIE_NAMES[rol], {
        httpOnly: true,
        secure,
        sameSite,
        path: '/',
    });
}
