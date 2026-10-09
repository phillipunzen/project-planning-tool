import { Sequelize, DataTypes as D } from "sequelize";
import session from "express-session";
export const db = new Sequelize(
  process.env.DATABASE_NAME || "projektwerk",
  process.env.DATABASE_USER || "projektwerk",
  process.env.DATABASE_PASSWORD,
  {
    dialect: "mariadb",
    host: process.env.DATABASE_HOST || "127.0.0.1",
    port: Number(process.env.DATABASE_PORT || 3306),
    logging: false,
    pool: { max: 10, min: 0, idle: 10000 },
    define: { charset: "utf8mb4", collate: "utf8mb4_unicode_ci" },
    dialectOptions: { connectTimeout: 10000 },
  },
);
const id = { type: D.UUID, defaultValue: D.UUIDV4, primaryKey: true };
export const User = db.define("User", {
  id,
  name: { type: D.STRING(100), allowNull: false },
  email: { type: D.STRING(190), allowNull: false, unique: true },
  password: D.STRING(100),
  role: { type: D.STRING(20), defaultValue: "user" },
  disabled: { type: D.BOOLEAN, defaultValue: false },
  authType: { type: D.STRING(10), defaultValue: "local" },
  externalId: { type: D.STRING(64), unique: true },
  color: { type: D.STRING(20), defaultValue: "#6366f1" },
});
export const Project = db.define("Project", {
  id,
  name: { type: D.STRING(100), allowNull: false },
  description: D.TEXT,
  color: { type: D.STRING(20), defaultValue: "#6366f1" },
  icon: { type: D.STRING(20), defaultValue: "layers" },
  archived: { type: D.BOOLEAN, defaultValue: false },
});
export const Membership = db.define(
  "Membership",
  { id, role: { type: D.STRING(20), allowNull: false } },
  { indexes: [{ unique: true, fields: ["ProjectId", "UserId"] }] },
);
Project.hasMany(Membership, { onDelete: "CASCADE" });
Membership.belongsTo(Project);
User.hasMany(Membership, { onDelete: "CASCADE" });
Membership.belongsTo(User);
export const Board = db.define("Board", {
  id,
  name: { type: D.STRING(100), allowNull: false },
  columns: { type: D.JSON, allowNull: false },
  revision: { type: D.INTEGER, defaultValue: 0 },
});
Project.hasMany(Board, { onDelete: "CASCADE" });
Board.belongsTo(Project);
export const Card = db.define("Card", {
  id,
  title: { type: D.STRING(200), allowNull: false },
  description: D.TEXT,
  columnId: { type: D.STRING(36), allowNull: false },
  position: { type: D.INTEGER, allowNull: false, defaultValue: 0 },
  priority: { type: D.STRING(20), defaultValue: "medium" },
  dueDate: D.DATEONLY,
  labels: { type: D.JSON, defaultValue: [] },
  checklist: { type: D.JSON, defaultValue: [] },
  version: { type: D.INTEGER, defaultValue: 0 },
});
Board.hasMany(Card, { onDelete: "CASCADE" });
Card.belongsTo(Board);
User.hasMany(Card, { foreignKey: "assigneeId", onDelete: "SET NULL" });
Card.belongsTo(User, { foreignKey: "assigneeId", as: "assignee" });
export const Comment = db.define("Comment", {
  id,
  body: { type: D.TEXT, allowNull: false },
});
Card.hasMany(Comment, { onDelete: "CASCADE" });
Comment.belongsTo(Card);
User.hasMany(Comment, { onDelete: "CASCADE" });
Comment.belongsTo(User);
export const Invitation = db.define("Invitation", {
  id,
  email: { type: D.STRING(190), allowNull: false },
  role: { type: D.STRING(20), defaultValue: "editor" },
  tokenHash: { type: D.STRING(64), allowNull: false, unique: true },
  expiresAt: { type: D.DATE, allowNull: false },
  acceptedAt: D.DATE,
});
Project.hasMany(Invitation, { onDelete: "CASCADE" });
Invitation.belongsTo(Project);
export const Setting = db.define("Setting", {
  key: { type: D.STRING(100), primaryKey: true },
  value: { type: D.TEXT, allowNull: false },
});
export const SessionRow = db.define(
  "Session",
  {
    sid: { type: D.STRING(190), primaryKey: true },
    data: { type: D.TEXT, allowNull: false },
    expiresAt: { type: D.DATE, allowNull: false },
  },
  { indexes: [{ fields: ["expiresAt"] }] },
);
export const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  disabled: u.disabled,
  authType: u.authType,
  color: u.color,
});
export class DatabaseSessionStore extends session.Store {
  get(sid, cb) {
    SessionRow.findByPk(sid)
      .then((row) =>
        cb(
          null,
          row && row.expiresAt > new Date() ? JSON.parse(row.data) : null,
        ),
      )
      .catch(cb);
  }
  set(sid, data, cb) {
    SessionRow.upsert({
      sid,
      data: JSON.stringify(data),
      expiresAt: data.cookie.expires || new Date(Date.now() + 86400000),
    })
      .then(() => cb?.())
      .catch(cb);
  }
  destroy(sid, cb) {
    SessionRow.destroy({ where: { sid } })
      .then(() => cb?.())
      .catch(cb);
  }
  touch(sid, data, cb) {
    SessionRow.update(
      { expiresAt: data.cookie.expires || new Date(Date.now() + 86400000) },
      { where: { sid } },
    )
      .then(() => cb?.())
      .catch(cb);
  }
}
export async function initializeDatabase() {
  await db.authenticate();
  // Version 1 is an additive initial schema. Never use sync({alter:true}) on live data.
  await db.sync();
  const schema = await db.getQueryInterface().describeTable("Cards");
  if (!schema.checklist)
    await db
      .getQueryInterface()
      .addColumn("Cards", "checklist", { type: D.JSON, defaultValue: [] });
  await Setting.findOrCreate({
    where: { key: "installation" },
    defaults: { value: "{}" },
  });
}

export const Attachment = db.define("Attachment", {
  id,
  name: { type: D.STRING(255), allowNull: false },
  storageName: { type: D.STRING(100), allowNull: false },
  size: { type: D.INTEGER, allowNull: false },
  mime: { type: D.STRING(100), allowNull: false },
});
Card.hasMany(Attachment, { onDelete: "CASCADE" });
Attachment.belongsTo(Card);
User.hasMany(Attachment, { onDelete: "CASCADE" });
Attachment.belongsTo(User);
export const Activity = db.define("Activity", {
  id,
  action: { type: D.STRING(500), allowNull: false },
  cardTitle: D.STRING(200),
});
Board.hasMany(Activity, { onDelete: "CASCADE" });
Activity.belongsTo(Board);
User.hasMany(Activity, { onDelete: "CASCADE" });
Activity.belongsTo(User);
