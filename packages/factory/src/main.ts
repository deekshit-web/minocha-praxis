import { listen } from "./server.ts";

const port = Number(process.env.PORT ?? 4317);
const running = await listen(port);
console.log(`Northwind factory http://127.0.0.1:${running.port}`);
