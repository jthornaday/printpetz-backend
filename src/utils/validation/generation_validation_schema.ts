import Zod from "zod";

const generateImageSchema = Zod.object({
  styleId: Zod.number({ required_error: "styleId is required" }),
  modelId: Zod.number({ required_error: "modelId is required" }),
  numberOfImages: Zod.number({
    required_error: "numberOfImages is required",
  })
    .min(1)
    .max(4),
});

export { generateImageSchema };
