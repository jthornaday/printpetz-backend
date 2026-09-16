import "module-alias/register";

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

import app from "./app";
import AppConstants from "./constants/app_constants";
import { startGenerationWorker } from "./services/generation_worker";

app.listen(AppConstants.port, async () => {
  // eslint-disable-next-line no-console
  console.log(`Server Started on port : ${AppConstants.port}`);

  // Started unconditionally, including while PRINTPETZ_IMAGE_PROVIDER is fal.
  // It claims only rows with a null request_id, which FAL never produces, so on
  // the FAL lane it finds nothing and idles. Starting it either way means a
  // rollback to fal still drains and sweeps whatever the OpenAI lane left
  // behind, rather than stranding those rows until someone flips back.
  startGenerationWorker();
});
