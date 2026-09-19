"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const security = require("../lib/security");
const validation = require("../lib/validation");
const documents = require("../lib/documents");
const whatsapp = require("../lib/whatsapp");
const backups = require("../lib/backups");

test("security: password policy is 12-128 characters", () => {
  assert.equal(security.PASSWORD_MIN, 12);
  assert.equal(security.validatePassword("12345678901"), "La contraseña debe tener entre 12 y 128 caracteres.");
  assert.equal(security.validatePassword("123456789012"), null);
  assert.equal(security.validatePassword("a".repeat(129)), "La contraseña debe tener entre 12 y 128 caracteres.");
});

test("security: TOTP generation and verification", () => {
  const secret = security.generateTotpSecret();
  assert.match(secret, /^[A-Z2-7]+$/);
  assert.equal(secret.length >= 20, true);
  const code = require("crypto").createHmac ? (() => {
    const crypto = require("crypto");
    const counter = Math.floor(Date.now() / 1000 / 30);
    const data = Buffer.alloc(8);
    data.writeBigUInt64BE(BigInt(counter));
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits=0,value=0,bytes=[];
    for(const ch of secret){
      const idx=alphabet.indexOf(ch);
      value=(value<<5)|idx; bits+=5;
      if(bits>=8){bytes.push((value >>> (bits-8))&255);bits-=8;}
    }
    const h=crypto.createHmac("sha1",Buffer.from(bytes)).update(data).digest();
    const o=h[h.length-1]&15;
    const n=((h[o]&127)<<24)|((h[o+1]&255)<<16)|((h[o+2]&255)<<8)|(h[o+3]&255);
    return String(n%1000000).padStart(6,"0");
  })() : "";
  assert.equal(security.verifyTotp(secret, code), true);
  assert.equal(security.verifyTotp(secret, "000000"), code === "000000");
});

test("security: encrypted secrets round-trip", () => {
  const payload = security.encryptSecret("secreto-prueba", "material-seguro");
  assert.equal(security.decryptSecret(payload, "material-seguro"), "secreto-prueba");
  assert.throws(() => security.decryptSecret(payload, "material-incorrecto"));
});

test("validation: email and positive IDs", () => {
  assert.equal(validation.email("  TEST@Example.COM "), "test@example.com");
  assert.throws(() => validation.email("correo-invalido"));
  assert.equal(validation.positiveId("42"), 42);
  assert.throws(() => validation.positiveId("0"));
});

test("documents: names, types and signatures", () => {
  assert.equal(documents.normalizeDocumentType("quote_pdf"), "quote_pdf");
  assert.equal(documents.normalizeDocumentType("unknown"), null);
  assert.equal(documents.safeDocumentName("../../factura?.pdf"), "factura_.pdf");
  assert.equal(documents.validateDocumentSignature(Buffer.from("%PDF-1.7"), "application/pdf"), true);
  assert.equal(documents.validateDocumentSignature(Buffer.from("NOPE"), "application/pdf"), false);
});

test("whatsapp: normalize Argentine numbers and build links", () => {
  assert.equal(whatsapp.normalizeWhatsAppNumber("3385-684660"), "543385684660");
  assert.equal(whatsapp.normalizeWhatsAppNumber("+54 3385 684660"), "543385684660");
  assert.equal(whatsapp.normalizeWhatsAppNumber("0054 3385 684660"), "543385684660");
  assert.equal(whatsapp.normalizeWhatsAppNumber("not-a-number"), "");
  assert.match(whatsapp.buildWhatsAppLink("3385684660", "Hola JR"), /^https:\/\/wa\.me\/543385684660\?text=/);
});

test("backups: retention and filename safety", () => {
  assert.equal(backups.normalizeRetention("30"), 30);
  assert.equal(backups.normalizeRetention("-10"), 1);
  assert.equal(backups.normalizeRetention("99999"), 3650);
  assert.match(backups.safeBackupFilename(), /^jr-electricidad-/);
});
