import { defineRailway, project, service } from "railway/iac";
// This repository manages only its own resources in the environment. Other
// repositories export their own partial name.
// See https://docs.railway.com/infrastructure-as-code#multi-repo-projects
export const partial = "kodiflex-foundry";
export default defineRailway(() => {
  const kodiflexFoundry = service("kodiflex-foundry", {
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/api/catalog",
    replicas: { "sfo": 1 },
  });

  return project("kodiflex-foundry", {
    variables: { managed: false },
    resources: [kodiflexFoundry],
  });
});
