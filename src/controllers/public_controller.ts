import AsyncHandler from "@/context/async_handler";

const test = AsyncHandler.handle(async (req, res) => {
  res.dataFetchSuccess({ data: { success: true } });
});

export { test };
