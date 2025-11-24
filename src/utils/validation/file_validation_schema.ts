import Zod from "zod";

import { EUploadPath } from "@/types/aws";

const uploadFileSchema = Zod.object({
  type: Zod.enum([...Object.keys(EUploadPath)] as [string, ...string[]], {
    required_error: "type is required",
  }),
});

export { uploadFileSchema };
