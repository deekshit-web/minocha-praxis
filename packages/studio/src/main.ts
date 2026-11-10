import { listenStudio } from "./server.ts";

const port = Number(process.env.PORT ?? 4320);
const running = await listenStudio(port);
console.log(`Workflow studio http://127.0.0.1:${running.port}`);
