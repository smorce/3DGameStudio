import { createApp } from "./app";
const port = Number(process.env.PORT ?? 8787);
const app = await createApp();
app.listen(port, "127.0.0.1", () =>
  console.log(`Machine Studio server listening on port ${port}`),
);
