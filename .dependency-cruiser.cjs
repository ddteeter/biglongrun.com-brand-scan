module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      from: { pathNot: "^node_modules" },
      to: { circular: true, pathNot: "^node_modules" }
    },
    {
      name: "no-orphans",
      severity: "warn",
      from: { orphan: true, pathNot: ["src/main.ts", "scripts/", "tests/"] },
      to: {}
    },
    {
      name: "domain-cant-import-ui-or-api",
      severity: "error",
      comment: "Domain modules must not depend on public-api or admin-ui.",
      from: { path: "^src/domain" },
      to: { path: "^src/(public-api|admin-ui)" }
    },
    {
      name: "extraction-cant-import-scoring",
      severity: "error",
      comment: "Extraction does not depend on scoring; they communicate via DB.",
      from: { path: "^src/domain/extraction" },
      to: { path: "^src/domain/scoring" }
    },
    {
      name: "scoring-cant-import-catalog",
      severity: "error",
      comment: "Scoring reads cached cohort summaries + brand data only.",
      from: { path: "^src/domain/scoring" },
      to: { path: "^src/domain/catalog" }
    },
    {
      name: "public-api-only-from-server",
      severity: "error",
      from: { path: "^src/public-api", pathNot: "^src/public-api" },
      to: { path: "^src/public-api" }
    },
    {
      name: "admin-ui-only-from-server",
      severity: "error",
      from: { path: "^src/admin-ui", pathNot: "^src/admin-ui" },
      to: { path: "^src/admin-ui" }
    },
    {
      name: "infrastructure-only-from-domain-or-jobs",
      severity: "error",
      from: { path: "^src/infrastructure", pathNot: "^src/(infrastructure|main\\.ts|env\\.ts|logger\\.ts)" },
      to: { path: "^src/infrastructure" }
    },
    {
      name: "no-deep-imports-across-modules",
      severity: "error",
      comment: "Cross-module imports must go through the module's index.ts barrel. Barrel files themselves are exempt — they exist to re-export their siblings. Intra-leaf-directory imports (e.g. within schema/) are also exempt — siblings in the same folder form one cohesive unit.",
      from: {
        path: "^src/(domain|infrastructure|public-api|admin-ui)/[^/]+",
        pathNot: "/index\\.ts$"
      },
      to: {
        path: "^src/(domain|infrastructure|public-api|admin-ui)/[^/]+/.+",
        pathNot: ["/index\\.ts$", "/schema/[^/]+\\.ts$", "/queue/[^/]+\\.ts$", "/extraction/[^/]+\\.ts$"]
      }
    }
  ],
  options: {
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"]
    },
    reporterOptions: { text: { highlightFocused: true } }
  }
};
