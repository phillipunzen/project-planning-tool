import "dotenv/config";
import express from "express";
import helmet from "helmet";
import session from "express-session";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { Op, UniqueConstraintError } from "sequelize";
import { randomBytes, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs/promises";
import multer from "multer";
import {
  db,
  User,
  Project,
  Membership,
  Board,
  Card,
  Comment,
  Invitation,
  Setting,
  SessionRow,
  DatabaseSessionStore,
  publicUser,
  initializeDatabase,
  Attachment,
  Activity,
} from "./db.js";
import {
  hashToken,
  getAuth,
  saveAuth,
  sanitizeAuth,
  getOidcConfig,
  ldapIdentity,
  resolveExternalUser,
  loginSession,
  requireUser,
  requireAdmin,
  member,
  bcrypt,
  oidc,
} from "./security.js";
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32)
  throw new Error("SESSION_SECRET mit mindestens 32 Zeichen erforderlich.");
export const app = express();
const origin = new URL(process.env.APP_URL || "http://localhost:8110").origin;
// Preview proxies can expose a different browser port than the canonical URL.
// Only explicit origins are trusted; never infer trust from forwarded headers.
const allowedOrigins = new Set([origin]);
for (const value of (process.env.ALLOWED_ORIGINS || "").split(",")) {
  if (!value.trim()) continue;
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) throw new Error("ALLOWED_ORIGINS muss vollständige HTTP(S)-Origins ohne Pfad enthalten.");
  allowedOrigins.add(url.origin);
}
if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy:
      process.env.NODE_ENV === "production"
        ? {
            directives: {
              "default-src": ["'self'"],
              "script-src": ["'self'"],
              "style-src": ["'self'", "'unsafe-inline'"],
              "img-src": ["'self'", "data:"],
              "connect-src": ["'self'"],
              "upgrade-insecure-requests": origin.startsWith("https:")
                ? []
                : null,
            },
          }
        : false,
    hsts: origin.startsWith("https:") ? undefined : false,
  }),
);
app.use(express.json({ limit: "128kb" }));
app.use(
  session({
    name: "projektwerk.sid",
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: new DatabaseSessionStore(),
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https:"),
      maxAge: 86400000,
    },
  }),
);
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (
    !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
    !allowedOrigins.has(req.get("origin"))
  )
    return res.status(403).json({ error: "Ungültiger Anfrageursprung." });
  next();
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: {
    error: "Zu viele Anmeldeversuche. Bitte später erneut versuchen.",
  },
});
app.use("/api/auth", loginLimiter);
app.use("/api/setup", loginLimiter);
const api = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
const email = z
  .email()
  .max(190)
  .transform((v) => v.toLowerCase());
const password = z
  .string()
  .min(10, "Das Passwort muss mindestens 10 Zeichen haben.")
  .max(72);
const name = z.string().trim().min(1).max(100);
const color = z.string().regex(/^#[0-9a-f]{6}$/i);
const uuid = z.uuid();
const inviteToken = z.string().regex(/^[a-f0-9]{64}$/);
const columns = () => [
  { id: randomUUID(), name: "Offen", color: "#94a3b8", isDone: false },
  { id: randomUUID(), name: "In Arbeit", color: "#6366f1", isDone: false },
  { id: randomUUID(), name: "Review", color: "#f59e0b", isDone: false },
  { id: randomUUID(), name: "Erledigt", color: "#10b981", isDone: true },
];
async function log(req, b, action, cardTitle, t) {
  await Activity.create(
    { BoardId: b.id, UserId: req.user.id, action, cardTitle },
    { transaction: t },
  );
}
async function createProject(userId, data, t) {
  const p = await Project.create(data, { transaction: t });
  await Membership.create(
    { ProjectId: p.id, UserId: userId, role: "owner" },
    { transaction: t },
  );
  const b = await Board.create(
    { ProjectId: p.id, name: "Projektboard", columns: columns() },
    { transaction: t },
  );
  return { project: p, board: b };
}
app.get(
  "/api/health",
  api(async (req, res) => {
    await db.authenticate();
    res.json({ status: "ok", database: "MariaDB" });
  }),
);
app.get(
  "/api/public",
  api(async (req, res) => {
    const c = await getAuth();
    res.json({
      setupRequired: !(await User.count()),
      provider: c.provider,
      providerName: c.oidc.name || "Single Sign-on",
    });
  }),
);
app.post(
  "/api/setup",
  api(async (req, res) => {
    const input = z
      .object({ name, email, password, sample: z.boolean().default(true) })
      .parse(req.body);
    const user = await db.transaction(async (t) => {
      await Setting.findByPk("installation", {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (await User.count({ transaction: t }))
        throw Object.assign(
          new Error("Die Einrichtung ist bereits abgeschlossen."),
          { status: 409 },
        );
      const u = await User.create(
        {
          ...input,
          role: "admin",
          color: "#6366f1",
          password: await bcrypt.hash(input.password, 12),
        },
        { transaction: t },
      );
      if (input.sample) {
        const { board } = await createProject(
          u.id,
          {
            name: "Unser erstes Projekt",
            description:
              "Ein Platz für Ideen, Aufgaben und alles, was wir gemeinsam bewegen.",
            color: "#6366f1",
            icon: "layers",
          },
          t,
        );
        const examples = [
          [
            "Projektziele festlegen",
            "Was wollen wir erreichen? Halte die wichtigsten Ziele und Erfolgskriterien fest.",
            0,
            "high",
            ["Planung"],
          ],
          [
            "Ideen & Anforderungen sammeln",
            "Sammelt hier eure Anforderungen. Mit einem Kommentar bleibt die Diskussion direkt an der Aufgabe.",
            0,
            "medium",
            ["Konzept"],
          ],
          [
            "Team zum Projekt einladen",
            "Über „Einladen“ kannst du einen persönlichen Link erzeugen und mit deinem Team teilen.",
            1,
            "high",
            ["Team"],
          ],
          [
            "Die erste Aufgabe gemeinsam planen",
            "Öffne die Karte und ergänze eine Beschreibung, einen Termin oder eine verantwortliche Person.",
            1,
            "medium",
            [],
          ],
          [
            "Board ausprobieren",
            "Ziehe diese Karte in eine andere Spalte. Am Handy kannst du den Griff rechts oben verwenden.",
            2,
            "low",
            ["Tipps"],
          ],
          [
            "Projektwerk eingerichtet",
            "Der erste Schritt ist geschafft. Ab jetzt habt ihr alle Aufgaben an einem Ort.",
            3,
            "medium",
            [],
          ],
        ];
        for (let i = 0; i < examples.length; i++) {
          const [title, description, col, priority, labels] = examples[i];
          await Card.create(
            {
              BoardId: board.id,
              title,
              description,
              columnId: board.columns[col].id,
              position: i,
              priority,
              labels,
              assigneeId: u.id,
            },
            { transaction: t },
          );
        }
      }
      return u;
    });
    await loginSession(req, user);
    res.status(201).json(publicUser(user));
  }),
);
app.post(
  "/api/auth/login",
  api(async (req, res) => {
    const input = z
      .object({
        email: z.string().min(1).max(190),
        password: z.string().min(1).max(200),
        method: z.enum(["local", "ldap"]).default("local"),
        invite: z.string().optional(),
      })
      .parse(req.body);
    let user;
    if (input.method === "ldap") {
      const c = await getAuth();
      if (c.provider !== "ldap")
        throw Object.assign(
          new Error("Active Directory ist nicht aktiviert."),
          { status: 400 },
        );
      try {
        user = await resolveExternalUser(
          await ldapIdentity(c, input.email, input.password),
          input.invite,
        );
      } catch (e) {
        if (e.status) throw e;
        throw Object.assign(
          new Error(
            "Anmeldung fehlgeschlagen. Prüfe Zugangsdaten und Verzeichniskonfiguration.",
          ),
          { status: 401 },
        );
      }
    } else {
      user = await User.findOne({
        where: { email: input.email.toLowerCase(), authType: "local" },
      });
      const valid = await bcrypt.compare(
        input.password,
        user?.password ||
          "$2b$12$WBPnwmpXKMxNfhWEfiDHsuOTFM1aaGT.SBFiySVoFNdxLe/q/wQ9W",
      );
      if (!user || !valid || user.disabled)
        throw Object.assign(
          new Error("E-Mail-Adresse oder Passwort ungültig."),
          { status: 401 },
        );
    }
    await loginSession(req, user);
    res.json(publicUser(user));
  }),
);
app.get(
  "/api/auth/oidc",
  api(async (req, res) => {
    const c = await getAuth();
    if (c.provider !== "oidc")
      throw Object.assign(new Error("OpenID Connect ist nicht aktiviert."), {
        status: 400,
      });
    const config = await getOidcConfig(c);
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    const token = req.query.invite
      ? inviteToken.parse(req.query.invite)
      : undefined;
    req.session.oidc = {
      verifier,
      state,
      nonce,
      invite: token,
      created: Date.now(),
      issuer: c.oidc.issuer,
      clientId: c.oidc.clientId,
    };
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${origin}/api/auth/oidc/callback`,
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
    });
    await new Promise((resolve, reject) =>
      req.session.save((e) => (e ? reject(e) : resolve())),
    );
    res.redirect(url.href);
  }),
);
app.get(
  "/api/auth/oidc/callback",
  api(async (req, res) => {
    const flow = req.session.oidc;
    delete req.session.oidc;
    try {
      const c = await getAuth();
      if (
        !flow ||
        Date.now() - flow.created > 600000 ||
        c.provider !== "oidc" ||
        c.oidc.issuer !== flow.issuer ||
        c.oidc.clientId !== flow.clientId
      )
        throw new Error("Anmeldevorgang abgelaufen.");
      const config = await getOidcConfig(c);
      const url = new URL(req.originalUrl, origin);
      const tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: flow.verifier,
        expectedState: flow.state,
        expectedNonce: flow.nonce,
        idTokenExpected: true,
      });
      const claims = tokens.claims();
      if (
        !claims?.sub ||
        typeof claims.email !== "string" ||
        !(claims.email_verified === true || c.oidc.trustEmail)
      )
        throw new Error(
          "Der Anbieter muss eine verifizierte E-Mail-Adresse liefern.",
        );
      const user = await resolveExternalUser(
        {
          email: email.parse(claims.email),
          name:
            typeof claims.name === "string"
              ? claims.name.slice(0, 100)
              : claims.email,
          externalId: hashToken(`oidc:${claims.iss}:${claims.sub}`),
          authType: "oidc",
        },
        flow.invite,
      );
      await loginSession(req, user);
      res.redirect(flow.invite ? `/?invite=${flow.invite}` : "/");
    } catch (e) {
      res.redirect(
        `/?authError=${encodeURIComponent(e.status ? e.message : "SSO-Anmeldung fehlgeschlagen. Bitte prüfe die Konfiguration oder starte die Anmeldung erneut.")}`,
      );
    }
  }),
);
app.get("/api/me", requireUser, (req, res) => res.json(publicUser(req.user)));
app.post(
  "/api/auth/logout",
  api(async (req, res) => {
    await new Promise((resolve, reject) =>
      req.session.destroy((e) => (e ? reject(e) : resolve())),
    );
    res.clearCookie("projektwerk.sid");
    res.json({ ok: true });
  }),
);
app.get(
  "/api/invitations/:token",
  api(async (req, res) => {
    const token = inviteToken.parse(req.params.token);
    const invitation = await Invitation.findOne({
      where: {
        tokenHash: hashToken(token),
        acceptedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
      include: Project,
    });
    if (!invitation)
      throw Object.assign(
        new Error(
          "Diese Einladung ist abgelaufen oder wurde bereits verwendet.",
        ),
        { status: 404 },
      );
    res.json({
      email: invitation.email,
      role: invitation.role,
      project: invitation.Project.name,
      expiresAt: invitation.expiresAt,
    });
  }),
);
app.post(
  "/api/invitations/:token/accept",
  api(async (req, res) => {
    const token = inviteToken.parse(req.params.token);
    const input = z
      .object({ name: name.optional(), password: password.optional() })
      .parse(req.body);
    const user = await db.transaction(async (t) => {
      await Setting.findByPk("installation", {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const inv = await Invitation.findOne({
        where: {
          tokenHash: hashToken(token),
          acceptedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!inv)
        throw Object.assign(new Error("Einladung nicht mehr gültig."), {
          status: 404,
        });
      let u =
        req.session.userId &&
        (await User.findByPk(req.session.userId, { transaction: t }));
      if (u) {
        if (u.disabled || u.email !== inv.email)
          throw Object.assign(
            new Error("Melde dich mit dem eingeladenen Konto an."),
            { status: 403 },
          );
      } else {
        if (await User.findOne({ where: { email: inv.email }, transaction: t }))
          throw Object.assign(
            new Error(
              "Für diese E-Mail existiert bereits ein Konto. Bitte zuerst anmelden.",
            ),
            { status: 409 },
          );
        if (!input.name || !input.password)
          throw Object.assign(new Error("Name und Passwort erforderlich."), {
            status: 400,
          });
        u = await User.create(
          {
            name: input.name,
            email: inv.email,
            password: await bcrypt.hash(input.password, 12),
          },
          { transaction: t },
        );
      }
      await Membership.findOrCreate({
        where: { ProjectId: inv.ProjectId, UserId: u.id },
        defaults: { role: inv.role },
        transaction: t,
      });
      await inv.update({ acceptedAt: new Date() }, { transaction: t });
      return u;
    });
    await loginSession(req, user);
    res.json(publicUser(user));
  }),
);
app.use("/api", (req, res, next) => {
  if (
    ["/health", "/public", "/setup"].includes(req.path) ||
    req.path.startsWith("/auth/") ||
    req.path.startsWith("/invitations/")
  )
    return next();
  requireUser(req, res, next);
});
app.get(
  "/api/projects",
  api(async (req, res) => {
    const memberships = await Membership.findAll({
      where: { UserId: req.user.id },
      include: [{ model: Project, include: Board }],
      order: [["createdAt", "ASC"]],
    });
    res.json(
      memberships.map((m) => ({ ...m.Project.toJSON(), myRole: m.role })),
    );
  }),
);
app.post(
  "/api/projects",
  api(async (req, res) => {
    const input = z
      .object({
        name,
        description: z.string().max(5000).default(""),
        color: color.default("#6366f1"),
        icon: z
          .enum(["layers", "code", "rocket", "palette", "briefcase"])
          .default("layers"),
      })
      .parse(req.body);
    const result = await db.transaction((t) =>
      createProject(req.user.id, input, t),
    );
    res.status(201).json(result.project);
  }),
);
app.patch(
  "/api/projects/:id",
  api(async (req, res) => {
    await member(req, req.params.id, false, true);
    const input = z
      .object({
        name: name.optional(),
        description: z.string().max(5000).optional(),
        color: color.optional(),
        archived: z.boolean().optional(),
      })
      .parse(req.body);
    await Project.update(input, { where: { id: req.params.id } });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/projects/:id",
  api(async (req, res) => {
    await db.transaction(async (t) => {
      const p = await Project.findByPk(req.params.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!p)
        throw Object.assign(new Error("Projekt nicht gefunden."), {
          status: 404,
        });
      await member(req, p.id, false, true, t);
      const boards = await Board.findAll({
        where: { ProjectId: p.id },
        attributes: ["id"],
        transaction: t,
      });
      const files = await Attachment.findAll({
        include: { model: Card, where: { BoardId: boards.map((b) => b.id) } },
        transaction: t,
      });
      await p.destroy({ transaction: t });
      t.afterCommit(() =>
        Promise.all(
          files.map((f) =>
            fs.unlink(path.join(uploadDir, f.storageName)).catch(() => {}),
          ),
        ),
      );
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/projects/:id/members",
  api(async (req, res) => {
    await member(req, req.params.id);
    const members = await Membership.findAll({
      where: { ProjectId: req.params.id },
      include: User,
    });
    res.json(
      members.map((m) => ({ ...publicUser(m.User), projectRole: m.role })),
    );
  }),
);
app.patch(
  "/api/projects/:id/members/:userId",
  api(async (req, res) => {
    const { role } = z
      .object({ role: z.enum(["editor", "viewer"]) })
      .parse(req.body);
    await db.transaction(async (t) => {
      await Project.findByPk(req.params.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      await member(req, req.params.id, false, true, t);
      const m = await Membership.findOne({
        where: { ProjectId: req.params.id, UserId: req.params.userId },
        transaction: t,
      });
      if (!m || m.role === "owner")
        throw Object.assign(
          new Error("Der Projekteigentümer kann nicht geändert werden."),
          { status: 400 },
        );
      await m.update({ role }, { transaction: t });
    });
    res.json({ ok: true });
  }),
);
app.delete(
  "/api/projects/:id/members/:userId",
  api(async (req, res) => {
    await db.transaction(async (t) => {
      await Project.findByPk(req.params.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      await member(req, req.params.id, false, true, t);
      const m = await Membership.findOne({
        where: { ProjectId: req.params.id, UserId: req.params.userId },
        transaction: t,
      });
      if (!m || m.role === "owner")
        throw Object.assign(
          new Error("Der Projekteigentümer kann nicht entfernt werden."),
          { status: 400 },
        );
      const boards = await Board.findAll({
        where: { ProjectId: req.params.id },
        transaction: t,
      });
      await Card.update(
        { assigneeId: null },
        {
          where: {
            BoardId: boards.map((b) => b.id),
            assigneeId: req.params.userId,
          },
          transaction: t,
        },
      );
      await m.destroy({ transaction: t });
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/projects/:id/invitations",
  api(async (req, res) => {
    await member(req, req.params.id, false, true);
    res.json(
      await Invitation.findAll({
        where: {
          ProjectId: req.params.id,
          acceptedAt: null,
          expiresAt: { [Op.gt]: new Date() },
        },
        attributes: ["id", "email", "role", "expiresAt"],
        order: [["createdAt", "DESC"]],
      }),
    );
  }),
);
app.post(
  "/api/projects/:id/invitations",
  api(async (req, res) => {
    const input = z
      .object({ email, role: z.enum(["editor", "viewer"]).default("editor") })
      .parse(req.body);
    const token = randomBytes(32).toString("hex");
    const inv = await db.transaction(async (t) => {
      await Project.findByPk(req.params.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      await member(req, req.params.id, false, true, t);
      const user = await User.findOne({
        where: { email: input.email },
        transaction: t,
      });
      if (
        user &&
        (await Membership.findOne({
          where: { ProjectId: req.params.id, UserId: user.id },
          transaction: t,
        }))
      )
        throw Object.assign(
          new Error("Diese Person ist bereits Projektmitglied."),
          { status: 409 },
        );
      await Invitation.destroy({
        where: {
          ProjectId: req.params.id,
          email: input.email,
          acceptedAt: null,
        },
        transaction: t,
      });
      return Invitation.create(
        {
          ...input,
          ProjectId: req.params.id,
          tokenHash: hashToken(token),
          expiresAt: new Date(Date.now() + 7 * 86400000),
        },
        { transaction: t },
      );
    });
    res
      .status(201)
      .json({
        id: inv.id,
        url: `${origin}/?invite=${token}`,
        expiresAt: inv.expiresAt,
      });
  }),
);
app.delete(
  "/api/projects/:id/invitations/:invId",
  api(async (req, res) => {
    await member(req, req.params.id, false, true);
    await Invitation.destroy({
      where: { id: req.params.invId, ProjectId: req.params.id },
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/projects/:id/boards",
  api(async (req, res) => {
    await member(req, req.params.id, true);
    const input = z.object({ name }).parse(req.body);
    res
      .status(201)
      .json(
        await Board.create({
          ProjectId: req.params.id,
          name: input.name,
          columns: columns(),
        }),
      );
  }),
);
app.get(
  "/api/boards/:id",
  api(async (req, res) => {
    const b = await Board.findByPk(req.params.id);
    if (!b)
      throw Object.assign(new Error("Board nicht gefunden."), { status: 404 });
    await member(req, b.ProjectId);
    const cards = await Card.findAll({
      where: { BoardId: b.id },
      include: [
        { model: User, as: "assignee", attributes: ["id", "name", "color"] },
        { model: Comment, attributes: ["id"] },
        { model: Attachment, attributes: ["id"] },
      ],
      order: [
        ["position", "ASC"],
        ["createdAt", "ASC"],
      ],
    });
    res.json({
      ...b.toJSON(),
      cards: cards.map((c) => ({
        ...c.toJSON(),
        commentCount: c.Comments.length,
        attachmentCount: c.Attachments.length,
        Comments: undefined,
        Attachments: undefined,
      })),
    });
  }),
);
async function lockedBoard(req, id, t, revision) {
  const b = await Board.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
  if (!b)
    throw Object.assign(new Error("Board nicht gefunden."), { status: 404 });
  await member(req, b.ProjectId, true, false, t);
  if (revision !== undefined && b.revision !== revision)
    throw Object.assign(
      new Error(
        "Das Board wurde zwischenzeitlich geändert. Es wurde aktualisiert; bitte wiederhole die Aktion.",
      ),
      { status: 409 },
    );
  return b;
}
app.patch(
  "/api/boards/:id",
  api(async (req, res) => {
    const input = z
      .object({
        name: name.optional(),
        revision: z.number().int(),
        columns: z
          .array(
            z.object({ id: uuid, name, color, isDone: z.boolean().optional() }),
          )
          .min(1)
          .max(12)
          .optional(),
      })
      .parse(req.body);
    if (
      input.columns &&
      new Set(input.columns.map((c) => c.id)).size !== input.columns.length
    )
      throw Object.assign(new Error("Spalten müssen eindeutige IDs haben."), {
        status: 400,
      });
    await db.transaction(async (t) => {
      const b = await lockedBoard(req, req.params.id, t, input.revision);
      if (input.columns) {
        const previous = new Map(
          b.columns.map((c, index) => [
            c.id,
            c.isDone ?? index === b.columns.length - 1,
          ]),
        );
        input.columns = input.columns.map((c) => ({
          ...c,
          isDone: c.isDone ?? previous.get(c.id) ?? false,
        }));
        const occupied = await Card.findAll({
          where: { BoardId: b.id },
          attributes: ["columnId"],
          transaction: t,
        });
        if (
          occupied.some(
            (c) => !input.columns.find((col) => col.id === c.columnId),
          )
        )
          throw Object.assign(
            new Error("Eine Spalte mit Aufgaben kann nicht entfernt werden."),
            { status: 400 },
          );
      }
      await b.update(
        { ...input, revision: b.revision + 1 },
        { transaction: t },
      );
      await log(req, b, "Board-Einstellungen aktualisiert", null, t);
    });
    res.json({ ok: true });
  }),
);
const cardProgress = z.number().int().min(0).max(100).multipleOf(25);
const cardInput = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(20000).default(""),
  columnId: uuid,
  priority: z.enum(["low", "medium", "high", "urgent"]).default("medium"),
  progress: cardProgress.default(0),
  dueDate: z.iso.date().nullable().default(null),
  assigneeId: uuid.nullable().default(null),
  labels: z.array(z.string().trim().min(1).max(30)).max(8).default([]),
  checklist: z
    .array(
      z.object({
        id: uuid,
        text: z.string().trim().min(1).max(300),
        done: z.boolean(),
      }),
    )
    .max(50)
    .refine(
      (items) => new Set(items.map((i) => i.id)).size === items.length,
      "Checklisten-IDs müssen eindeutig sein.",
    )
    .default([]),
});
const cardPatchInput = z
  .object(
    Object.fromEntries(
      Object.entries(cardInput.shape).map(([key, schema]) => [
        key,
        (schema instanceof z.ZodDefault
          ? schema.removeDefault()
          : schema
        ).optional(),
      ]),
    ),
  )
  .extend({ version: z.number().int().nonnegative() });
async function validateCardFields(b, input, t) {
  if (!b.columns.some((c) => c.id === input.columnId))
    throw Object.assign(new Error("Ungültige Spalte."), { status: 400 });
  if (input.assigneeId) {
    const m = await Membership.findOne({
      where: { ProjectId: b.ProjectId, UserId: input.assigneeId },
      include: User,
      transaction: t,
    });
    if (!m || m.User.disabled)
      throw Object.assign(
        new Error("Die Person ist kein aktives Projektmitglied."),
        { status: 400 },
      );
  }
}
app.post(
  "/api/boards/:id/cards",
  api(async (req, res) => {
    const input = cardInput.parse(req.body);
    const card = await db.transaction(async (t) => {
      const b = await lockedBoard(req, req.params.id, t);
      await validateCardFields(b, input, t);
      const max = await Card.max("position", {
        where: { BoardId: b.id, columnId: input.columnId },
        transaction: t,
      });
      const c = await Card.create(
        {
          ...input,
          BoardId: b.id,
          position: (Number.isFinite(max) ? max : -1) + 1,
        },
        { transaction: t },
      );
      await b.increment("revision", { transaction: t });
      await log(req, b, "Aufgabe erstellt", c.title, t);
      return c;
    });
    res.status(201).json(card);
  }),
);
app.patch(
  "/api/cards/:id",
  api(async (req, res) => {
    const input = cardPatchInput.parse(req.body);
    const updated = await db.transaction(async (t) => {
      const initial = await Card.findByPk(req.params.id, { transaction: t });
      if (!initial)
        throw Object.assign(new Error("Aufgabe nicht gefunden."), {
          status: 404,
        });
      const b = await lockedBoard(req, initial.BoardId, t);
      const c = await Card.findByPk(initial.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!c || c.version !== input.version)
        throw Object.assign(
          new Error(
            "Die Aufgabe wurde zwischenzeitlich geändert. Bitte erneut öffnen.",
          ),
          { status: 409 },
        );
      const merged = { ...c.toJSON(), ...input };
      await validateCardFields(b, merged, t);
      let position = c.position;
      if (c.columnId !== merged.columnId) {
        const max = await Card.max("position", {
          where: { BoardId: b.id, columnId: merged.columnId },
          transaction: t,
        });
        position = (Number.isFinite(max) ? max : -1) + 1;
      }
      const oldColumn = c.columnId;
      const oldProgress = c.progress;
      await c.update(
        { ...input, position, version: c.version + 1 },
        { transaction: t },
      );
      await b.increment("revision", { transaction: t });
      if (c.progress !== oldProgress)
        await log(
          req,
          b,
          `Fortschritt geändert: ${oldProgress} % → ${c.progress} %`,
          c.title,
          t,
        );
      await log(
        req,
        b,
        oldColumn === merged.columnId
          ? "Aufgabe aktualisiert"
          : `Status geändert: ${b.columns.find((col) => col.id === merged.columnId).name}`,
        c.title,
        t,
      );
      return { version: c.version };
    });
    res.json({ ok: true, ...updated });
  }),
);
app.delete(
  "/api/cards/:id",
  api(async (req, res) => {
    const { version } = z
      .object({ version: z.number().int().nonnegative() })
      .parse(req.body);
    await db.transaction(async (t) => {
      const initial = await Card.findByPk(req.params.id, { transaction: t });
      if (!initial)
        throw Object.assign(new Error("Aufgabe nicht gefunden."), {
          status: 404,
        });
      const b = await lockedBoard(req, initial.BoardId, t);
      const c = await Card.findByPk(initial.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!c || c.version !== version)
        throw Object.assign(
          new Error(
            "Die Aufgabe wurde zwischenzeitlich geändert. Bitte erneut öffnen.",
          ),
          { status: 409 },
        );
      const files = await Attachment.findAll({
        where: { CardId: c.id },
        transaction: t,
      });
      await c.destroy({ transaction: t });
      await b.increment("revision", { transaction: t });
      await log(req, b, "Aufgabe gelöscht", c.title, t);
      t.afterCommit(() =>
        Promise.all(
          files.map((f) =>
            fs.unlink(path.join(uploadDir, f.storageName)).catch(() => {}),
          ),
        ),
      );
    });
    res.json({ ok: true });
  }),
);
app.post(
  "/api/boards/:id/move",
  api(async (req, res) => {
    const input = z
      .object({
        cardId: uuid,
        columnId: uuid,
        index: z.number().int().min(0),
        revision: z.number().int().nonnegative(),
      })
      .parse(req.body);
    await db.transaction(async (t) => {
      const b = await lockedBoard(req, req.params.id, t, input.revision);
      if (!b.columns.some((c) => c.id === input.columnId))
        throw Object.assign(new Error("Ungültige Spalte."), { status: 400 });
      const c = await Card.findOne({
        where: { id: input.cardId, BoardId: b.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!c)
        throw Object.assign(new Error("Aufgabe nicht gefunden."), {
          status: 404,
        });
      const target = await Card.findAll({
        where: {
          BoardId: b.id,
          columnId: input.columnId,
          id: { [Op.ne]: c.id },
        },
        order: [
          ["position", "ASC"],
          ["createdAt", "ASC"],
        ],
        transaction: t,
      });
      const oldColumn = c.columnId;
      target.splice(Math.min(input.index, target.length), 0, c);
      for (let i = 0; i < target.length; i++)
        await target[i].update(
          {
            columnId: input.columnId,
            position: i,
            version: target[i].version + 1,
          },
          { transaction: t },
        );
      await b.increment("revision", { transaction: t });
      await log(
        req,
        b,
        oldColumn === input.columnId
          ? "Aufgabe umsortiert"
          : `Status geändert: ${b.columns.find((col) => col.id === input.columnId).name}`,
        c.title,
        t,
      );
    });
    res.json({ ok: true });
  }),
);
app.get(
  "/api/cards/:id/comments",
  api(async (req, res) => {
    const c = await Card.findByPk(req.params.id, { include: Board });
    if (!c)
      throw Object.assign(new Error("Aufgabe nicht gefunden."), {
        status: 404,
      });
    await member(req, c.Board.ProjectId);
    const comments = await Comment.findAll({
      where: { CardId: c.id },
      include: { model: User, attributes: ["id", "name", "color"] },
      order: [["createdAt", "ASC"]],
    });
    res.json(comments);
  }),
);
app.post(
  "/api/cards/:id/comments",
  api(async (req, res) => {
    const input = z
      .object({ body: z.string().trim().min(1).max(5000) })
      .parse(req.body);
    const c = await Card.findByPk(req.params.id, { include: Board });
    if (!c)
      throw Object.assign(new Error("Aufgabe nicht gefunden."), {
        status: 404,
      });
    await member(req, c.Board.ProjectId, true);
    const comment = await db.transaction(async (t) => {
      const b = await lockedBoard(req, c.BoardId, t);
      const comment = await Comment.create(
        { ...input, CardId: c.id, UserId: req.user.id },
        { transaction: t },
      );
      await log(req, b, "Kommentar hinzugefügt", c.title, t);
      return comment;
    });
    res.status(201).json(comment);
  }),
);
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
await fs.mkdir(uploadDir, { recursive: true });
const upload = multer({
  defParamCharset: "utf8",
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => cb(null, randomUUID()),
  }),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (
      ![
        ".pdf",
        ".txt",
        ".md",
        ".csv",
        ".json",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".gif",
        ".doc",
        ".docx",
        ".xls",
        ".xlsx",
        ".ppt",
        ".pptx",
        ".zip",
        ".odt",
        ".ods",
      ].includes(ext)
    )
      return cb(
        Object.assign(new Error("Dieser Dateityp ist nicht erlaubt."), {
          status: 400,
        }),
      );
    cb(null, true);
  },
});
app.get(
  "/api/boards/:id/activity",
  api(async (req, res) => {
    const b = await Board.findByPk(req.params.id);
    if (!b)
      throw Object.assign(new Error("Board nicht gefunden."), { status: 404 });
    await member(req, b.ProjectId);
    res.json(
      await Activity.findAll({
        where: { BoardId: b.id },
        include: { model: User, attributes: ["id", "name", "color"] },
        order: [["createdAt", "DESC"]],
        limit: 100,
      }),
    );
  }),
);
app.get(
  "/api/cards/:id/attachments",
  api(async (req, res) => {
    const c = await Card.findByPk(req.params.id, { include: Board });
    if (!c)
      throw Object.assign(new Error("Aufgabe nicht gefunden."), {
        status: 404,
      });
    await member(req, c.Board.ProjectId);
    res.json(
      await Attachment.findAll({
        where: { CardId: c.id },
        attributes: ["id", "name", "size", "createdAt", "UserId"],
        order: [["createdAt", "ASC"]],
      }),
    );
  }),
);
app.post(
  "/api/cards/:id/attachments",
  api(async (req, res, next) => {
    const c = await Card.findByPk(req.params.id, { include: Board });
    if (!c)
      throw Object.assign(new Error("Aufgabe nicht gefunden."), {
        status: 404,
      });
    await member(req, c.Board.ProjectId, true);
    req.uploadCard = c;
    next();
  }),
  upload.single("file"),
  api(async (req, res) => {
    if (!req.file)
      throw Object.assign(new Error("Datei erforderlich."), { status: 400 });
    try {
      const c = req.uploadCard;
      const attachment = await db.transaction(async (t) => {
        const b = await lockedBoard(req, c.BoardId, t);
        const a = await Attachment.create(
          {
            CardId: c.id,
            UserId: req.user.id,
            name: req.file.originalname
              .replace(/[\\/\x00-\x1f]/g, "_")
              .slice(0, 255),
            storageName: req.file.filename,
            size: req.file.size,
            mime: req.file.mimetype,
          },
          { transaction: t },
        );
        await log(req, b, "Datei angehängt", c.title, t);
        return a;
      });
      res
        .status(201)
        .json({
          id: attachment.id,
          name: attachment.name,
          size: attachment.size,
        });
    } catch (e) {
      await fs.unlink(req.file.path).catch(() => {});
      throw e;
    }
  }),
);
app.get(
  "/api/attachments/:id/download",
  api(async (req, res) => {
    const a = await Attachment.findByPk(req.params.id, {
      include: { model: Card, include: Board },
    });
    if (!a)
      throw Object.assign(new Error("Datei nicht gefunden."), { status: 404 });
    await member(req, a.Card.Board.ProjectId);
    res.set("Content-Type", "application/octet-stream");
    res.download(path.join(uploadDir, a.storageName), a.name);
  }),
);
app.delete(
  "/api/attachments/:id",
  api(async (req, res) => {
    const a = await Attachment.findByPk(req.params.id, {
      include: { model: Card, include: Board },
    });
    if (!a)
      throw Object.assign(new Error("Datei nicht gefunden."), { status: 404 });
    await db.transaction(async (t) => {
      const b = await lockedBoard(req, a.Card.BoardId, t);
      await a.destroy({ transaction: t });
      await log(req, b, "Datei entfernt", a.Card.title, t);
    });
    await fs.unlink(path.join(uploadDir, a.storageName)).catch(() => {});
    res.json({ ok: true });
  }),
);
app.use("/api/admin", requireAdmin);
app.get(
  "/api/admin/users",
  api(async (req, res) =>
    res.json(
      (await User.findAll({ order: [["createdAt", "ASC"]] })).map(publicUser),
    ),
  ),
);
app.post(
  "/api/admin/users",
  api(async (req, res) => {
    const input = z
      .object({
        name,
        email,
        password,
        role: z.enum(["admin", "user"]).default("user"),
      })
      .parse(req.body);
    const u = await User.create({
      ...input,
      password: await bcrypt.hash(input.password, 12),
    });
    res.status(201).json(publicUser(u));
  }),
);
app.patch(
  "/api/admin/users/:id",
  api(async (req, res) => {
    const input = z
      .object({
        name: name.optional(),
        role: z.enum(["admin", "user"]).optional(),
        disabled: z.boolean().optional(),
        password: password.optional(),
      })
      .parse(req.body);
    await db.transaction(async (t) => {
      await Setting.findByPk("installation", {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      const u = await User.findByPk(req.params.id, { transaction: t });
      if (!u)
        throw Object.assign(new Error("Benutzer nicht gefunden."), {
          status: 404,
        });
      if (u.id === req.user.id && (input.disabled || input.role === "user"))
        throw Object.assign(
          new Error("Du kannst deine eigenen Adminrechte nicht entfernen."),
          { status: 400 },
        );
      if (input.password && u.authType !== "local")
        throw Object.assign(
          new Error(
            "Passwörter externer Konten werden im Identitätsanbieter verwaltet.",
          ),
          { status: 400 },
        );
      if (
        u.role === "admin" &&
        !u.disabled &&
        (input.role === "user" || input.disabled) &&
        (await User.count({
          where: { role: "admin", disabled: false },
          transaction: t,
        })) <= 1
      )
        throw Object.assign(
          new Error(
            "Mindestens ein aktiver Administrator muss erhalten bleiben.",
          ),
          { status: 400 },
        );
      await u.update(
        {
          ...input,
          ...(input.password
            ? { password: await bcrypt.hash(input.password, 12) }
            : {}),
        },
        { transaction: t },
      );
    });
    res.json({ ok: true });
  }),
);
const authInput = z.object({
  provider: z.enum(["local", "oidc", "ldap"]),
  oidc: z.object({
    name: z.string().max(100).default("Single Sign-on"),
    issuer: z.string().max(1000).default(""),
    clientId: z.string().max(500).default(""),
    secret: z.string().max(2000).default(""),
    trustEmail: z.boolean().default(false),
  }),
  ldap: z.object({
    url: z.string().max(1000).default(""),
    baseDn: z.string().max(1000).default(""),
    bindDn: z.string().max(1000).default(""),
    bindPassword: z.string().max(2000).default(""),
    filter: z
      .string()
      .max(1000)
      .default("(&(objectClass=user)(sAMAccountName={username}))"),
    startTls: z.boolean().default(false),
  }),
});
async function validatedAuth(body) {
  const input = authInput.parse(body);
  const old = await getAuth();
  if (!input.oidc.secret) input.oidc.secret = old.oidc.secret || "";
  if (!input.ldap.bindPassword)
    input.ldap.bindPassword = old.ldap.bindPassword || "";
  if (input.provider === "oidc") {
    let u;
    try {
      u = new URL(input.oidc.issuer);
    } catch {}
    if (!u || u.protocol !== "https:" || !input.oidc.clientId)
      throw Object.assign(
        new Error(
          "OpenID Connect benötigt eine HTTPS-Issuer-URL und eine Client-ID.",
        ),
        { status: 400 },
      );
  }
  if (input.provider === "ldap") {
    let u;
    try {
      u = new URL(input.ldap.url);
    } catch {}
    if (
      !u ||
      !(
        u.protocol === "ldaps:" ||
        (u.protocol === "ldap:" && input.ldap.startTls)
      ) ||
      !input.ldap.baseDn ||
      !input.ldap.bindDn ||
      !input.ldap.bindPassword ||
      !input.ldap.filter.includes("{username}")
    )
      throw Object.assign(
        new Error(
          "Active Directory benötigt LDAPS oder LDAP mit StartTLS, Base-DN, Bind-DN, Bind-Passwort und einen Filter mit {username}.",
        ),
        { status: 400 },
      );
  }
  return input;
}
app.get(
  "/api/admin/auth",
  api(async (req, res) =>
    res.json({
      ...sanitizeAuth(await getAuth()),
      callbackUrl: `${origin}/api/auth/oidc/callback`,
    }),
  ),
);
app.put(
  "/api/admin/auth",
  api(async (req, res) => {
    await saveAuth(await validatedAuth(req.body));
    res.json({ ok: true });
  }),
);
app.post(
  "/api/admin/auth/test",
  api(async (req, res) => {
    const c = await validatedAuth(req.body);
    try {
      if (c.provider === "oidc") await getOidcConfig(c);
      else if (c.provider === "ldap") {
        const client = new (await import("ldapts")).Client({
          url: c.ldap.url,
          timeout: 10000,
          connectTimeout: 10000,
          tlsOptions: { rejectUnauthorized: true },
        });
        try {
          if (c.ldap.startTls)
            await client.startTLS({ rejectUnauthorized: true });
          await client.bind(c.ldap.bindDn, c.ldap.bindPassword);
          await client.search(c.ldap.baseDn, {
            scope: "base",
            filter: "(objectClass=*)",
            sizeLimit: 1,
          });
        } finally {
          await client.unbind().catch(() => {});
        }
      }
      res.json({
        ok: true,
        message:
          c.provider === "oidc"
            ? "Discovery erfolgreich. Den vollständigen Login anschließend mit dem Anbieter testen."
            : c.provider === "ldap"
              ? "TLS-Verbindung, Service-Bind und Base-DN erfolgreich geprüft."
              : "Lokale Anmeldung ist verfügbar.",
      });
    } catch (e) {
      throw Object.assign(
        new Error(
          "Verbindung fehlgeschlagen. Prüfe Serveradresse, Zertifikate und Zugangsdaten.",
        ),
        { status: 400 },
      );
    }
  }),
);
app.use("/api", (req, res) =>
  res.status(404).json({ error: "Endpunkt nicht gefunden." }),
);
const dist = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist",
);
app.use(express.static(dist, { index: false, maxAge: "1h" }));
app.get("/{*path}", (req, res) => res.sendFile(path.join(dist, "index.html")));
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError)
    return res
      .status(400)
      .json({
        error:
          err.code === "LIMIT_FILE_SIZE"
            ? "Die Datei darf maximal 20 MB groß sein."
            : "Der Upload konnte nicht verarbeitet werden.",
      });
  if (err instanceof z.ZodError)
    return res
      .status(400)
      .json({
        error: err.issues
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join("; "),
      });
  if (err instanceof UniqueConstraintError)
    return res.status(409).json({ error: "Dieser Eintrag existiert bereits." });
  const status = err.status || (err.type === "entity.parse.failed" ? 400 : 500);
  if (status >= 500) console.error("Request failed:", err.name, err.message);
  res
    .status(status)
    .json({
      error:
        status >= 500
          ? "Ein interner Fehler ist aufgetreten. Bitte erneut versuchen."
          : err.message,
    });
});
await initializeDatabase();
const cleanup = setInterval(
  () =>
    SessionRow.destroy({ where: { expiresAt: { [Op.lt]: new Date() } } }).catch(
      (e) => console.error("Session cleanup failed:", e.name),
    ),
  3600000,
);
cleanup.unref();
if (process.env.NODE_ENV !== "test") {
  const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
    console.log(`Projektwerk auf Port ${process.env.PORT || 3000}`),
  );
  async function shutdown() {
    clearInterval(cleanup);
    server.close(async () => {
      await db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
