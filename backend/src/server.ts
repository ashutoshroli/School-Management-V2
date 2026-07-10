import app from "./app";
import { config } from "./config";

const PORT = config.port;

app.listen(PORT, () => {
  console.log(`
  =============================================
    School ERP Backend Server
    Environment: ${config.nodeEnv}
    Port: ${PORT}
    API: http://localhost:${PORT}/api
    Health: http://localhost:${PORT}/api/health
  =============================================
  `);
});
