// Models trained on or after the FLUX migration are stored under a `/flux/`
// path segment; anything older was trained on qwen-image.
export const isFluxModelPath = (modelPath: string) =>
  modelPath.includes("/flux/");

// FLUX training passes `trigger_word: "TOK"`, while pre-migration qwen training
// passed `trigger_phrase: "TOK ${name}"`. Generation must use whichever the
// model was actually trained on — appending an untrained name to a FLUX
// trigger dilutes the identity token and leaks the model name into the prompt.
export const getModelTriggerWord = (modelPath: string, modelName: string) =>
  isFluxModelPath(modelPath) ? "TOK" : `TOK ${modelName}`;
