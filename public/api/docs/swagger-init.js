window.ui = SwaggerUIBundle({
  url: '/openapi.json',
  dom_id: '#swagger-ui',
  deepLinking: true,
  displayRequestDuration: true,
  filter: true,
  persistAuthorization: true,
  defaultModelsExpandDepth: 1,
  defaultModelExpandDepth: 2,
  docExpansion: 'list',
  presets: [
    SwaggerUIBundle.presets.apis,
    SwaggerUIStandalonePreset,
  ],
  layout: 'BaseLayout',
});
