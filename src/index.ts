import "module-alias/register";

import dotenv from "dotenv";

dotenv.config({ path: ".env" });

import app from "./app";
import AppConstants from "./constants/app_constants";

app.listen(AppConstants.port, async () => {
  // eslint-disable-next-line no-console
  console.log(`Server Started on port : ${AppConstants.port}`);
});
