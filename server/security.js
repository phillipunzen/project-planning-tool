import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHash,
} from "node:crypto";
import { Setting, Invitation, Membership, User, db } from "./db.js";
import bcrypt from "bcryptjs";
import { Op } from "sequelize";
import { Client } from "ldapts";
import * as oidc from "openid-client";
export const hashToken = (token) =>
  createHash("sha256").update(token).digest("hex");
// RFC 4515: escape a value, never interpolate raw input into a search filter.
export const escapeLdapFilter = (value) =>
  value.replace(
    /[\\\0()*]/g,
    (character) => `\\${character.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
const key = createHash("sha256")
  .update(`projektwerk:settings:${process.env.SESSION_SECRET}`)
  .digest();
export function encrypt(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([
    cipher.update(JSON.stringify(value)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
}
export function decrypt(value) {
  const buf = Buffer.from(value, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
  decipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(
    Buffer.concat([
      decipher.update(buf.subarray(28)),
      decipher.final(),
    ]).toString(),
  );
}
export async function getAuth() {
  const row = await Setting.findByPk("authentication");
  return row ? decrypt(row.value) : { provider: "local", oidc: {}, ldap: {} };
}
export async function saveAuth(value) {
  await Setting.upsert({ key: "authentication", value: encrypt(value) });
}
export function sanitizeAuth(config) {
  return {
    ...config,
    oidc: {
      ...config.oidc,
      secret: "",
      hasSecret: Boolean(config.oidc.secret),
    },
    ldap: {
      ...config.ldap,
      bindPassword: "",
      hasPassword: Boolean(config.ldap.bindPassword),
    },
  };
}
export async function getOidcConfig(config) {
  return oidc.discovery(
    new URL(config.oidc.issuer),
    config.oidc.clientId,
    config.oidc.secret || undefined,
  );
}
export async function ldapIdentity(config, username, password) {
  if (!password) throw new Error("Passwort erforderlich.");
  const opts = {
    url: config.ldap.url,
    timeout: 10000,
    connectTimeout: 10000,
    tlsOptions: { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  };
  const directory = new Client(opts);
  try {
    if (config.ldap.startTls) await directory.startTLS(opts.tlsOptions);
    await directory.bind(config.ldap.bindDn, config.ldap.bindPassword);
    const filter = config.ldap.filter.replaceAll(
      "{username}",
      escapeLdapFilter(username),
    );
    const { searchEntries } = await directory.search(config.ldap.baseDn, {
      scope: "sub",
      filter,
      attributes: [
        "dn",
        "mail",
        "displayName",
        "sAMAccountName",
        "objectGUID",
        "entryUUID",
        "userAccountControl",
      ],
      sizeLimit: 2,
      timeLimit: 8,
    });
    if (searchEntries.length !== 1) throw new Error("Benutzer nicht gefunden.");
    const entry = searchEntries[0];
    if (Number(entry.userAccountControl || 0) & 2)
      throw new Error("Konto deaktiviert.");
    const userClient = new Client(opts);
    try {
      if (config.ldap.startTls) await userClient.startTLS(opts.tlsOptions);
      await userClient.bind(entry.dn, password);
    } finally {
      await userClient.unbind().catch(() => {});
    }
    if (typeof entry.mail !== "string" || !entry.mail.includes("@"))
      throw new Error("Dem Verzeichniskonto fehlt eine E-Mail-Adresse.");
    const identifier =
      entry.objectGUID || entry.entryUUID || entry.dn.toLowerCase();
    return {
      email: entry.mail.toLowerCase(),
      name: String(entry.displayName || entry.sAMAccountName || username),
      externalId: hashToken(
        `ldap:${config.ldap.url}:${Buffer.isBuffer(identifier) ? identifier.toString("hex") : identifier}`,
      ),
      authType: "ldap",
    };
  } finally {
    await directory.unbind().catch(() => {});
  }
}
export async function resolveExternalUser(identity, inviteToken) {
  return db.transaction(async (t) => {
    await Setting.findByPk("installation", {
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    let user = await User.findOne({
      where: { externalId: identity.externalId },
      transaction: t,
    });
    if (user) {
      if (user.disabled)
        throw Object.assign(new Error("Dieses Konto ist deaktiviert."), {
          status: 403,
        });
      return user;
    }
    const invitation =
      inviteToken &&
      (await Invitation.findOne({
        where: {
          tokenHash: hashToken(inviteToken),
          email: identity.email,
          acceptedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      }));
    if (!invitation)
      throw Object.assign(
        new Error(
          "Für die erste Anmeldung benötigst du einen gültigen Einladungslink für deine E-Mail-Adresse.",
        ),
        { status: 403 },
      );
    if (
      await User.findOne({ where: { email: identity.email }, transaction: t })
    )
      throw Object.assign(
        new Error(
          "Diese E-Mail gehört bereits zu einem anderen Konto. Verwende dessen bisherige Anmeldung.",
        ),
        { status: 409 },
      );
    user = await User.create(identity, { transaction: t });
    return user;
  });
}
export async function loginSession(req, user) {
  await new Promise((resolve, reject) =>
    req.session.regenerate((e) => (e ? reject(e) : resolve())),
  );
  req.session.userId = user.id;
  await new Promise((resolve, reject) =>
    req.session.save((e) => (e ? reject(e) : resolve())),
  );
}
export async function requireUser(req, res, next) {
  try {
    const user =
      req.session.userId && (await User.findByPk(req.session.userId));
    if (!user || user.disabled)
      return res.status(401).json({ error: "Bitte melde dich an." });
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
}
export function requireAdmin(req, res, next) {
  if (req.user.role !== "admin")
    return res.status(403).json({ error: "Administratorrechte erforderlich." });
  next();
}
export async function member(req, projectId, write = false, owner = false, t) {
  const m = await Membership.findOne({
    where: { ProjectId: projectId, UserId: req.user.id },
    transaction: t,
  });
  if (!m || (write && m.role === "viewer") || (owner && m.role !== "owner"))
    throw Object.assign(
      new Error("Du hast keine Berechtigung für diese Aktion."),
      { status: 403 },
    );
  return m;
}
export { bcrypt, oidc };
