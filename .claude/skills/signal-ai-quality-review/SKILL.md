---
name: signal-ai-quality-review
description: Review Signal AI behavior for grounding, retrieval quality, citation integrity, prompt safety, structured-output validity, model routing, evaluation rigor, cost, and graceful refusal.
---

# Signal AI Quality Review

Review both semantic quality and the code-enforced guardrails. Do not approve AI behavior from a few
plausible examples.

Check:

- retrieved evidence is competitor-scoped, relevant, recent where required, correctly hydrated, and
  passed through hybrid retrieval, reranking, then citation enforcement;
- every material claim maps to cited evidence and unsupported-claim thresholds produce typed refusal;
- prompts include company context, clearly delimit untrusted evidence, constrain the requested task,
  and use active versioning rather than hard-coded production drift;
- structured outputs are runtime-validated and malformed model responses fail safely;
- data scarcity is represented honestly through confidence/refusal, not fabricated precision;
- model selection matches the intended alias/capability, downgrade rules preserve quality, and token/
  cost budgets are enforced and observable;
- branch-agent partial failures cannot create confident synthesis from missing state;
- evaluation covers adversarial injection, unsupported answers, cross-competitor leakage, empty/weak
  evidence, temporal questions, and regression against curated examples.

Do not alter the golden dataset, faithfulness threshold, or active prompt as a shortcut to make an
evaluation pass. Report quality risks separately from deterministic code defects and state what
evidence would validate uncertain concerns.
