import { loadConfig, resolvePath } from "./config.js";
import { VisitStore } from "./store/visits.js";
import { buildServer } from "./server.js";
import { preflight } from "./preflight.js";
import { logger } from "./log.js";

const log = logger("server");

async function main() {
  const config = await loadConfig();
  preflight(config);

  const store = new VisitStore(resolvePath("var"), resolvePath(config.recorder.clipDir), config.retainCount);
  const { app, engine } = await buildServer({ config, store });

  engine.start();

  let closing = false;
  const close = async () => {
    if (closing) return;
    closing = true;
    log.info("shutting down…");
    engine.stop();
    try {
      await app.close();
    } catch (err) {
      log.error("error during shutdown:", err);
    }
    process.exit(0);
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);

  await app.listen({ host: "0.0.0.0", port: config.server.port });
  log.info(`listening on http://0.0.0.0:${config.server.port}`);
  log.info(`board: http://${config.board.host}:${config.board.port}  webcam: ${config.webcam.device}`);
}

main().catch((err) => {
  logger("server").error(err);
  process.exit(1);
});
