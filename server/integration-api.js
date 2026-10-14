import { randomBytes, createHash } from "node:crypto";
import { z } from "zod";
import { Op } from "sequelize";
import { ApiToken, Board, Card, Membership, Project, User } from "./db.js";
import { installSwaggerDocs } from "./swagger-docs.js";
import { integrationOpenApi } from "../shared/integration-openapi.js";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const uuid = z.uuid().transform((value) => value.toLowerCase());
const tokenMetadata = (token) => ({
  id: token.id,
  name: token.name,
  mode: token.mode,
  boardIds: token.boardIds,
  expiresAt: token.expiresAt,
  revokedAt: token.revokedAt,
  lastUsedAt: token.lastUsedAt,
  createdAt: token.createdAt,
});
const fail = (message, status = 403) =>
  Object.assign(new Error(message), { status });

export async function integrationAuth(req, res, next) {
  try {
    const route = req.path.replace(/\/$/, "");
    if (!(route === "/v1" || route.startsWith("/v1/"))) {
      if (/^Bearer\s/i.test(req.get("authorization") || ""))
        throw fail("API-Tokens sind ausschließlich unter /api/v1 erlaubt.");
      return next();
    }
    res.set("Cache-Control", "no-store");
    const authorization = req.get("authorization") || "";
    if (!/^Bearer pw_[A-Za-z0-9_-]{43}$/i.test(authorization)) {
      res.set("WWW-Authenticate", "Bearer");
      throw fail("Ungültiger oder abgelaufener API-Token.", 401);
    }
    const secret = authorization.slice(7);
    const token = await ApiToken.findOne({
      where: {
        tokenHash: hash(secret),
        revokedAt: null,
        expiresAt: { [Op.gt]: new Date() },
      },
    });
    const user = token && (await User.findByPk(token.UserId));
    if (!user || user.disabled) {
      res.set("WWW-Authenticate", "Bearer");
      throw fail("Ungültiger oder abgelaufener API-Token.", 401);
    }
    req.apiToken = token;
    req.user = user;
    if (route === "/v1/openapi.json" && req.method === "GET")
      return res.json(integrationOpenApi);
    if (route === "/v1/boards" && req.method === "GET") {
      const memberships = await Membership.findAll({
        where: { UserId: user.id },
      });
      const boards = await Board.findAll({
        where: {
          id: token.boardIds,
          ProjectId: memberships.map((entry) => entry.ProjectId),
        },
        include: [
          {
            model: Project,
            attributes: ["id", "name"],
            where: { archived: false },
          },
        ],
        order: [["name", "ASC"]],
      });
      await token.update({ lastUsedAt: new Date() }, { silent: true });
      return res.json(
        boards.map((board) => ({
          id: board.id,
          name: board.name,
          project: board.Project,
          canEdit:
            token.mode === "write" &&
            memberships.find((entry) => entry.ProjectId === board.ProjectId)
              .role !== "viewer",
        })),
      );
    }
    const match = route.match(
      /^\/v1\/(boards|cards)\/([a-f0-9-]{36})(?:\/(templates|members|cards|move|comments))?$/i,
    );
    if (!match) throw fail("API-Endpunkt nicht gefunden.", 404);
    const [, resource, rawId, action = ""] = match,
      id = uuid.parse(rawId);
    const allowed =
      resource === "boards"
        ? action === "" || action === "templates" || action === "members"
          ? ["GET"]
          : action === "cards" || action === "move"
            ? ["POST"]
            : []
        : action === ""
          ? ["GET", "PATCH", "DELETE"]
          : action === "comments"
            ? ["GET", "POST"]
            : [];
    if (!allowed.includes(req.method)) {
      res.set("Allow", allowed.join(", "));
      throw fail("Diese HTTP-Methode wird hier nicht unterstützt.", 405);
    }
    if (req.method !== "GET" && token.mode !== "write")
      throw fail("Dieser API-Token darf nur lesen.");
    const card =
      resource === "cards"
        ? await Card.findByPk(id, { attributes: ["id", "BoardId"] })
        : null;
    if (resource === "cards" && !card)
      throw fail("Aufgabe nicht gefunden.", 404);
    const boardId = card?.BoardId || id;
    if (!token.boardIds.includes(boardId))
      throw fail("Dieser API-Token hat keinen Zugriff auf dieses Board.");
    const board = await Board.findByPk(boardId, {
      include: [{ model: Project, attributes: ["id", "archived"] }],
    });
    const membership =
      board &&
      (await Membership.findOne({
        where: { ProjectId: board.ProjectId, UserId: user.id },
      }));
    if (
      !board ||
      board.Project.archived ||
      !membership ||
      (req.method !== "GET" && membership.role === "viewer")
    )
      throw fail("Du hast keine Berechtigung für diese Aktion.");
    await token.update({ lastUsedAt: new Date() }, { silent: true });
    const query = req.url.includes("?")
      ? req.url.slice(req.url.indexOf("?"))
      : "";
    req.url =
      resource === "boards" && action === "members"
        ? `/projects/${board.ProjectId}/members${query}`
        : `/${resource}/${id}${action ? `/${action}` : ""}${query}`;
    next();
  } catch (error) {
    next(error);
  }
}

export function installTokenRoutes(app, api) {
  installSwaggerDocs(app, api);
  app.get(
    "/api/integration/openapi.json",
    api(async (req, res) => res.json(integrationOpenApi)),
  );
  app.get(
    "/api/me/api-tokens",
    api(async (req, res) =>
      res.json(
        (
          await ApiToken.findAll({
            where: { UserId: req.user.id },
            order: [["createdAt", "DESC"]],
          })
        ).map(tokenMetadata),
      ),
    ),
  );
  app.get(
    "/api/me/api-token-boards",
    api(async (req, res) => {
      const memberships = await Membership.findAll({
        where: { UserId: req.user.id },
      });
      const boards = await Board.findAll({
        where: { ProjectId: memberships.map((entry) => entry.ProjectId) },
        include: [
          {
            model: Project,
            attributes: ["id", "name"],
            where: { archived: false },
          },
        ],
        order: [["name", "ASC"]],
      });
      res.json(
        boards.map((board) => ({
          id: board.id,
          name: board.name,
          project: board.Project.name,
          canEdit:
            memberships.find((entry) => entry.ProjectId === board.ProjectId)
              .role !== "viewer",
        })),
      );
    }),
  );
  app.post(
    "/api/me/api-tokens",
    api(async (req, res) => {
      const input = z
        .object({
          name: z.string().trim().min(1).max(100),
          mode: z.enum(["read", "write"]),
          boardIds: z
            .array(uuid)
            .min(1)
            .max(50)
            .refine((ids) => new Set(ids).size === ids.length),
          expiresInDays: z.number().int().min(1).max(365).default(90),
        })
        .strict()
        .parse(req.body);
      const secret = `pw_${randomBytes(32).toString("base64url")}`;
      const created = await ApiToken.sequelize.transaction(
        async (transaction) => {
          await User.findByPk(req.user.id, {
            transaction,
            lock: transaction.LOCK.UPDATE,
          });
          const boards = await Board.findAll({
            where: { id: input.boardIds },
            include: [{ model: Project, attributes: ["id", "archived"] }],
            transaction,
          });
          if (boards.length !== input.boardIds.length)
            throw fail("Wähle ausschließlich verfügbare Boards aus.");
          for (const board of boards) {
            const membership = await Membership.findOne({
              where: { ProjectId: board.ProjectId, UserId: req.user.id },
              transaction,
            });
            if (
              !membership ||
              board.Project.archived ||
              (input.mode === "write" && membership.role === "viewer")
            )
              throw fail("Du hast keine Berechtigung für diese Aktion.");
          }
          if (
            (await ApiToken.count({
              where: {
                UserId: req.user.id,
                revokedAt: null,
                expiresAt: { [Op.gt]: new Date() },
              },
              transaction,
            })) >= 20
          )
            throw fail("Maximal 20 aktive API-Tokens pro Benutzer.", 400);
          return ApiToken.create(
            {
              name: input.name,
              mode: input.mode,
              boardIds: input.boardIds,
              UserId: req.user.id,
              tokenHash: hash(secret),
              expiresAt: new Date(Date.now() + input.expiresInDays * 86400000),
            },
            { transaction },
          );
        },
      );
      res.status(201).json({ ...tokenMetadata(created), token: secret });
    }),
  );
  app.delete(
    "/api/me/api-tokens/:id",
    api(async (req, res) => {
      const token = await ApiToken.findOne({
        where: { id: uuid.parse(req.params.id), UserId: req.user.id },
      });
      if (!token) throw fail("API-Token nicht gefunden.", 404);
      await token.update({ revokedAt: token.revokedAt || new Date() });
      res.json({ ok: true });
    }),
  );
}
