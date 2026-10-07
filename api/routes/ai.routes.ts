
import { Router, Request, Response, NextFunction } from "express";
import { callAIGateway } from "../services/ai.gateway";
import { AgentDAO } from "../services/agent.dao";
import { authMiddleware } from "../middleware/auth.middleware";
import { checkPermission } from "../middleware/rbac.middleware";
import { validate, validateQuery } from "../middleware/validate.middleware";
import { AnalyzeSchema, ReviewOutputSchema, AgentOutputQuerySchema } from "../validation/entity.schemas";
import { AGENT_CONSTITUTIONS } from "../../agents/constitutions/registry";
import { EntityDAO } from "../services/entity.dao";
import type { AgentId } from "../../types/agent.types";

export const aiRouter = Router();
aiRouter.use(authMiddleware);

// POST /api/ai/analyze — real Anthropic call
aiRouter.post("/analyze",
  checkPermission("ai:analyze"),
  validate(AnalyzeSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const { agentId, entityId, action, context } = req.body as { agentId:AgentId; entityId?:string; action:string; context:string };
    if (!AGENT_CONSTITUTIONS[agentId]) {
      res.status(400).json({ error: `Unknown agent: ${agentId}` });
      return;
    }
    let entityData = null;
    if (entityId) {
      entityData = await EntityDAO.findOne(entityId, req.user!.tenantId);
      if (!entityData) { res.status(404).json({ error: "Entity not found" }); return; }
    }
    const constitution = AGENT_CONSTITUTIONS[agentId];
    const systemPrompt = `You are ${constitution.role} (${constitution.arabicName}).
${constitution.description}
SGIP Enterprise · Tenant: ${req.user!.tenantId} · User: ${req.user!.nameAr} (${req.user!.role})
RULES:
1. Cite regulations/policies for all governance claims.
2. Append CONFIDENCE: [0-100] at the end of your response.
3. Flag items requiring human review explicitly.
4. Never issue legal opinions, certify findings, or approve financial statements unilaterally.
5. Respond in Arabic unless technical terms require English.
6. Structure: التحليل / المخاطر / التوصيات / الأدلة المطلوبة`;
    const userPrompt = entityData
      ? `البيانات:\n${JSON.stringify(entityData, null, 2)}\n\nالمطلوب:\n${context}`
      : context;
    let result;
    try {
      result = await callAIGateway({
        agentId, action, systemPrompt, userPrompt,
        tenantId: req.user!.tenantId, requestedBy: req.user!.userId, entityId,
      });
    } catch (err) {
      next(err);
      return;
    }
    res.json(result);
  },
);

// GET /api/ai/outputs
aiRouter.get("/outputs",
  checkPermission("ai:view_outputs"),
  validateQuery(AgentOutputQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const { status, agentId } = (req as any).validatedQuery as { status: string; agentId?: string };
    const outputs = await AgentDAO.findPending(req.user!.tenantId, status, agentId);
    res.json(outputs);
  },
);

// PATCH /api/ai/outputs/:id/review
aiRouter.patch("/outputs/:id/review",
  checkPermission("ai:review_output"),
  validate(ReviewOutputSchema),
  async (req: Request, res: Response): Promise<void> => {
    const { decision } = req.body as { decision: "approved"|"rejected" };
    const updated = await AgentDAO.review(
      String(req.params.id), req.user!.tenantId, decision, req.user!.userId,
    );
    res.json(updated);
  },
);

// GET /api/ai/agents
aiRouter.get("/agents", checkPermission("ai:view_outputs"), (_req, res) => {
  res.json(Object.entries(AGENT_CONSTITUTIONS).map(([id, c]) => ({
    agentId: id, role: c.role, arabicName: c.arabicName,
    scope: c.scope, allowedActions: c.allowedActions,
    forbiddenActions: c.forbiddenActions, confidenceThreshold: c.confidenceThreshold,
    costTier: c.costTier,
  })));
});
