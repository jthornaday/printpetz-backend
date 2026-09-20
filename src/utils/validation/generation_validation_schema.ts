import Zod from "zod";

const generateImageSchema = Zod.object({
  styleId: Zod.number({ required_error: "styleId is required" }),
  modelId: Zod.number({ required_error: "modelId is required" }),
  numberOfImages: Zod.number({
    required_error: "numberOfImages is required",
  })
    .min(1)
    .max(4),
  cutenessLevel: Zod.number().int().min(1).max(5).default(1),
  seed: Zod.number().int().min(0).max(4294967295).optional(),
});

const generateCustomImageSchema = Zod.object({
  description: Zod.string({ required_error: "description is required" })
    .trim()
    .min(3)
    .max(300),
  referencePhotoUrl: Zod.string().url().optional(),
  modelId: Zod.number({ required_error: "modelId is required" }),
  numberOfImages: Zod.number({
    required_error: "numberOfImages is required",
  })
    .min(1)
    .max(4),
  cutenessLevel: Zod.number().int().min(1).max(5).default(1),
  seed: Zod.number().int().min(0).max(4294967295).optional(),
});

export { generateCustomImageSchema, generateImageSchema };
