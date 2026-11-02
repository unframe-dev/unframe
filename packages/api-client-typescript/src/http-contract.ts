import type { Hono } from "hono";
import type { StatusCode } from "hono/utils/http-status";
import type { paths } from "@unframe/contracts/control-plane";

type RpcPath<Path extends string> = Path extends `${infer Head}{${infer Param}}${infer Tail}`
  ? `${Head}:${Param}${RpcPath<Tail>}`
  : Path;
type JsonBody<Operation> = Operation extends {
  requestBody: { content: { "application/json": infer Body } };
}
  ? { json: Body }
  : {};
type Parameters<Operation> = Operation extends { parameters: infer Params }
  ? (Params extends { path: infer Path } ? { param: Path } : {}) &
      (Params extends { query?: infer Query }
        ? [NonNullable<Query>] extends [never]
          ? {}
          : { query?: NonNullable<Query> }
        : {})
  : {};
type Input<Operation> = {
  [Key in keyof (JsonBody<Operation> & Parameters<Operation>)]: (JsonBody<Operation> &
    Parameters<Operation>)[Key];
};
type Endpoint<Operation> = Operation extends { responses: infer Responses }
  ? {
      [Status in keyof Responses & StatusCode]: {
        input: Input<Operation>;
        output: Responses[Status] extends { content: { "application/json": infer Body } }
          ? Body
          : {};
        outputFormat: Responses[Status] extends { content: { "application/json": unknown } }
          ? "json"
          : "body";
        status: Status;
      };
    }[keyof Responses & StatusCode]
  : never;
type HttpSchema = {
  [Path in keyof paths as RpcPath<Path>]: {
    [
      Method in keyof paths[Path] &
        ("get" | "post" | "put" | "patch" | "delete") as paths[Path][Method] extends undefined
        ? never
        : `$${Method}`
    ]: Endpoint<paths[Path][Method]>;
  };
};

export type ControlPlaneHttpContract = Hono<{}, HttpSchema>;
