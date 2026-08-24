import { run } from "../../src/check.ts";
import app from "./alchemy.run.ts";
import { policies } from "./policies.ts";

await run(app, policies);
