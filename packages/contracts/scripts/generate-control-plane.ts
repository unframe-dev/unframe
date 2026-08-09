import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import openapiTS, { astToString } from "openapi-typescript";
import { createOpenAPIDocument } from "../../../app/server/control-plane/src/openapi";

const root = resolve(import.meta.dirname, ".."); const specPath = resolve(root, "openapi/control-plane.openapi.json"); const typePath = resolve(root, "src/control-plane.openapi.ts");
const document = `${JSON.stringify(createOpenAPIDocument(), null, 2)}\n`; const types = `// Generated from openapi/control-plane.openapi.json. Do not edit.\n${astToString(await openapiTS(JSON.parse(document)))}`;
if (process.argv.includes("--check")) { if (await readFile(specPath, "utf8") !== document || await readFile(typePath, "utf8") !== types) process.exitCode = 1; } else { await mkdir(resolve(root, "openapi"), { recursive: true }); await mkdir(resolve(root, "src"), { recursive: true }); await writeFile(specPath, document); await writeFile(typePath, types); }
