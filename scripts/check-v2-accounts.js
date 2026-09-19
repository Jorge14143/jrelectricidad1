"use strict";

const fs = require("fs");
const vm = require("vm");

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) throw new Error("FAIL: " + message);
  console.log("PASS:", message);
}

const server = read("server.js");
const migration = read("migrations/003_accounts.sql");
const accountJs = read("public/js/account.js");
const accountHtml = read("public/cuenta.html");

new Function(server);
new Function(accountJs);

assert(migration.includes("email_verified_at"), "email verification column");
assert(migration.includes("pending_email"), "pending email column");
assert(migration.includes("avatar_url"), "avatar column");
assert(migration.includes("account_email_tokens"), "email token table");
assert(server.includes("/api/account/email/verify/request"), "verification request endpoint");
assert(server.includes("/api/account/email/verify"), "verification endpoint");
assert(server.includes("/api/account/email/confirm-change"), "email change confirmation endpoint");
assert(server.includes("pending_email"), "email changes stay pending");
assert(server.includes("email_verified_at=NOW()"), "email confirmation marks verified");
assert(server.includes("/api/account/activity"), "personal activity endpoint");
assert(server.includes("/api/account/avatar"), "avatar endpoint");
assert(server.includes('newPassword.length < 12') || server.includes("PASSWORD_MIN"), "frontend/backend strong password policy");
assert(accountJs.includes("/api/account/email/status"), "account UI reads email status");
assert(accountJs.includes("/api/account/activity"), "account UI loads activity");
assert(accountJs.includes("/api/account/avatar"), "account UI supports avatar");
assert(accountHtml.includes("verify-email-button"), "account UI has verification action");
assert(accountHtml.includes("activity-list"), "account UI has activity list");

console.log("V2 ACCOUNTS CHECK: OK");
