/**
 * Zod Validation Middleware
 * Wrap any route with validate(schema) to get typed, validated req.body.
 * Returns 422 with structured errors — no silent failures.
 */
import { Request, Response, NextFunction } from "express";
import { ZodSchema, ZodError } from "zod";

export function validate<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(422).json({
        error:  "Validation failed",
        issues: result.error.flatten().fieldErrors,
      });
      return;
    }
    req.body = result.data;  // replace with parsed+coerced data
    next();
  };
}

export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(422).json({
        error:  "Query validation failed",
        issues: result.error.flatten().fieldErrors,
      });
      return;
    }
    (req as Request & { validatedQuery: T }).validatedQuery = result.data;
    next();
  };
}
