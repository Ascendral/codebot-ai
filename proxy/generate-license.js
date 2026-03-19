#!/usr/bin/env node
/**
 * Generate a CodeBot license key for a user.
 *
 * Usage: node generate-license.js <userId> <secret>
 *
 * Example: node generate-license.js user123 my-secret-key
 * Output:  cb_user123_AbCdEfGhIjKlMnOp
 */

const crypto = require('crypto');

const userId = process.argv[2];
const secret = process.argv[3];

if (!userId || !secret) {
  console.error('Usage: node generate-license.js <userId> <secret>');
  process.exit(1);
}

const hmac = crypto.createHmac('sha256', secret).update(userId).digest('base64');
const key = hmac.replace(/[+/=]/g, '').substring(0, 16);
console.log(`cb_${userId}_${key}`);
