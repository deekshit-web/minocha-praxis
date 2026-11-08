import { listenWorkbench } from "./workbench.ts";

const port = Number(process.env.PORT ?? 4173);
const running = await listenWorkbench(port);
console.log(`Northwind workbench http://127.0.0.1:${running.port}`);
