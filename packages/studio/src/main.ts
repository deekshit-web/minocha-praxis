import { listenStudio } from "./server.ts";

const port = Number(process.env.PORT ?? 4320);
// Set STUDIO_HOSTED=1 to serve on every interface for a public host such as Railway.
const hosted = process.env.STUDIO_HOSTED === "1";
const running = await listenStudio(port, { hosted });
console.log(hosted ? `Kodiflex Foundry listening on port ${running.port}` : `Kodiflex Foundry http://127.0.0.1:${running.port}`);
