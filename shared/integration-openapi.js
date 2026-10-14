const id = { type: "string", format: "uuid" };
const response = (schema) => ({
  description: "Success",
  content: { "application/json": { schema } },
});
const ref = (name) => ({ $ref: `#/components/schemas/${name}` });
const body = (schema) => ({
  required: true,
  content: { "application/json": { schema } },
});
const errors = {
  400: { description: "Invalid input" },
  401: { description: "Missing, invalid, expired or revoked token" },
  403: {
    description:
      "Token scope or current membership does not permit this action",
  },
  404: { description: "Resource not found" },
  409: {
    description:
      "Conflict: reload the board/card and retry with the latest revision/version",
  },
  429: { description: "Rate limit exceeded" },
};
const pathId = (name) => ({ name, in: "path", required: true, schema: id });
const operation = (operationId, summary, schema, request, params = []) => ({
  operationId,
  summary,
  parameters: params,
  ...(request ? { requestBody: body(request) } : {}),
  responses: { 200: response(schema), ...errors },
});
const cardProperties = {
  title: { type: "string", minLength: 1, maxLength: 200 },
  description: { type: "string", maxLength: 20000 },
  columnId: id,
  priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
  progress: { type: "integer", enum: [0, 25, 50, 75, 100] },
  dueDate: { type: "string", format: "date", nullable: true },
  assigneeId: { ...id, nullable: true },
  labels: {
    type: "array",
    maxItems: 8,
    items: { type: "string", minLength: 1, maxLength: 30 },
  },
  checklist: {
    type: "array",
    maxItems: 50,
    items: {
      type: "object",
      required: ["id", "text", "done"],
      properties: {
        id,
        text: { type: "string", minLength: 1, maxLength: 300 },
        done: { type: "boolean" },
      },
    },
  },
  templateId: { ...id, nullable: true },
  customValues: {
    type: "object",
    additionalProperties: {
      oneOf: [
        { type: "string", maxLength: 5000, nullable: true },
        { type: "number" },
      ],
    },
    description:
      "Keys are custom field UUIDs. Dropdown values are option UUIDs. Use null to clear a value. Submit the entire values object; preserve other values.",
  },
};
const boardParam = [pathId("boardId")],
  cardParam = [pathId("cardId")];
export const integrationOpenApi = {
  openapi: "3.0.3",
  info: {
    title: "Projektwerk Board API",
    version: "1.0.0",
    description:
      "Board-scoped bearer tokens created in Profile settings. Effective permissions are always limited by current user membership. No session cookie or Origin header is required. Write operations require a write token. Maximum 300 requests per minute per source IP. No cross-origin browser access is enabled.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ bearerAuth: [] }],
  paths: {
    "/boards": {
      get: operation(
        "listBoards",
        "List permitted, currently accessible boards",
        { type: "array", items: ref("BoardSummary") },
      ),
    },
    "/boards/{boardId}": {
      get: operation(
        "getBoard",
        "Read board, buckets, templates and tasks",
        ref("Board"),
        null,
        boardParam,
      ),
    },
    "/boards/{boardId}/members": {
      get: operation(
        "getBoardMembers",
        "List project members for assigning tasks",
        {
          type: "array",
          items: {
            type: "object",
            properties: {
              id,
              name: { type: "string" },
              email: { type: "string" },
              projectRole: { type: "string" },
              disabled: { type: "boolean" },
            },
          },
        },
        null,
        boardParam,
      ),
    },
    "/boards/{boardId}/templates": {
      get: operation(
        "getTemplates",
        "Read current task templates and custom field definitions",
        {
          type: "object",
          properties: {
            templates: {
              type: "array",
              items: { type: "object", additionalProperties: true },
            },
            defaultTemplateId: { ...id, nullable: true },
            revision: { type: "integer" },
          },
        },
        null,
        boardParam,
      ),
    },
    "/boards/{boardId}/cards": {
      post: {
        ...operation(
          "createCard",
          "Create a task (write token)",
          ref("Card"),
          ref("CardCreate"),
          boardParam,
        ),
        responses: { 201: response(ref("Card")), ...errors },
      },
    },
    "/boards/{boardId}/move": {
      post: operation(
        "moveCard",
        "Move or reorder a task (write token)",
        ref("Ok"),
        {
          type: "object",
          required: ["cardId", "columnId", "index", "revision"],
          properties: {
            cardId: id,
            columnId: id,
            index: { type: "integer", minimum: 0 },
            revision: { type: "integer", minimum: 0 },
          },
        },
        boardParam,
      ),
    },
    "/cards/{cardId}": {
      get: operation(
        "getCard",
        "Read a task and its latest version",
        ref("Card"),
        null,
        cardParam,
      ),
      patch: operation(
        "updateCard",
        "Edit a task (write token; version required)",
        {
          type: "object",
          properties: {
            ok: { type: "boolean" },
            version: { type: "integer" },
            templateId: { ...id, nullable: true },
            customFieldDefinitions: {
              type: "array",
              items: { type: "object" },
            },
          },
        },
        ref("CardPatch"),
        cardParam,
      ),
      delete: operation(
        "deleteCard",
        "Delete a task (write token; version required)",
        ref("Ok"),
        {
          type: "object",
          required: ["version"],
          properties: { version: { type: "integer", minimum: 0 } },
        },
        cardParam,
      ),
    },
    "/cards/{cardId}/comments": {
      get: operation(
        "listComments",
        "Read task comments",
        {
          type: "array",
          items: {
            type: "object",
            properties: {
              id,
              body: { type: "string" },
              createdAt: { type: "string", format: "date-time" },
              User: {
                type: "object",
                properties: { id, name: { type: "string" } },
              },
            },
          },
        },
        null,
        cardParam,
      ),
      post: {
        ...operation(
          "createComment",
          "Add a task comment (write token)",
          { type: "object", additionalProperties: true },
          {
            type: "object",
            required: ["body"],
            properties: {
              body: { type: "string", minLength: 1, maxLength: 5000 },
            },
          },
          cardParam,
        ),
        responses: {
          201: response({ type: "object", additionalProperties: true }),
          ...errors,
        },
      },
    },
    "/openapi.json": {
      get: operation("getOpenApi", "Download this API specification", {
        type: "object",
        additionalProperties: true,
      }),
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "API token" },
    },
    schemas: {
      Ok: { type: "object", properties: { ok: { type: "boolean" } } },
      BoardSummary: {
        type: "object",
        properties: {
          id,
          name: { type: "string" },
          canEdit: { type: "boolean" },
          project: {
            type: "object",
            properties: { id, name: { type: "string" } },
          },
        },
      },
      Board: {
        type: "object",
        properties: {
          id,
          name: { type: "string" },
          revision: { type: "integer" },
          columns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id,
                name: { type: "string" },
                color: { type: "string" },
                isDone: { type: "boolean" },
              },
            },
          },
          templates: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
          cards: { type: "array", items: ref("Card") },
        },
      },
      Card: {
        type: "object",
        properties: {
          id,
          BoardId: id,
          version: { type: "integer" },
          position: { type: "integer" },
          ...cardProperties,
          customFieldDefinitions: {
            type: "array",
            items: { type: "object", additionalProperties: true },
          },
        },
      },
      CardCreate: {
        type: "object",
        required: ["title", "columnId"],
        properties: cardProperties,
      },
      CardPatch: {
        type: "object",
        required: ["version"],
        properties: {
          version: { type: "integer", minimum: 0 },
          ...cardProperties,
        },
      },
    },
  },
};
