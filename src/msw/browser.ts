import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.ts";

export const worker =
  typeof window !== "undefined"
    ? setupWorker(...handlers)
    : (undefined as unknown as ReturnType<typeof setupWorker>);
