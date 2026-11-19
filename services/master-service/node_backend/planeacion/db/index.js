"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = exports.pool = void 0;
exports.checkDbHealth = checkDbHealth;

const { drizzle } = require("drizzle-orm/node-postgres");
const sharedDb = require("../../utils/db");
const schema = require("./schema.js");

exports.pool = sharedDb.pool;
exports.db = sharedDb.pool ? drizzle(sharedDb.pool, { schema }) : null;

async function checkDbHealth() {
    return await sharedDb.checkHealth();
}
