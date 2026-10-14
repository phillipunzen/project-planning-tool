window.addEventListener("load", () => {
  window.ui = SwaggerUIBundle({
    url: "/api/integration/openapi.json",
    dom_id: "#swagger-ui",
    presets: [SwaggerUIBundle.presets.apis],
    layout: "BaseLayout",
    deepLinking: true,
    filter: true,
    displayRequestDuration: true,
    validatorUrl: null,
    persistAuthorization: false,
    queryConfigEnabled: false,
    requestInterceptor(request) {
      const url = new URL(request.url, location.href);
      const spec = url.pathname === "/api/integration/openapi.json";
      if (
        url.origin !== location.origin ||
        (!spec &&
          !(url.pathname === "/api/v1" || url.pathname.startsWith("/api/v1/")))
      ) {
        throw new Error("Swagger requests must use this application's API.");
      }
      request.credentials = "same-origin";
      if (spec) {
        delete request.headers.Authorization;
        delete request.headers.authorization;
      }
      return request;
    },
  });
});
