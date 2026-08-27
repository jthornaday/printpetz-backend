import Zod from "zod";

const modelTrainingSchema = Zod.object({
  name: Zod.string({ required_error: "name is required" }),
  images: Zod.array(Zod.string().url("Each image must be a valid URL")).min(
    3,
    "At least 3 images are required",
  ),
});

export { modelTrainingSchema };
