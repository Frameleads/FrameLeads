/**
 * The policy GET endpoint returns database metadata in addition to editable settings.
 * The PATCH endpoint intentionally rejects unknown fields. Only send the eight
 * allowlisted settings when updating the policy.
 */
export type EditableResponseSLAPolicy = {
  enabled: boolean;
  criticalMinutes: number;
  highMinutes: number;
  mediumMinutes: number;
  lowMinutes: number;
  unknownMinutes: number;
  dueSoonPercent: number;
  breachEscalationEnabled: boolean;
};

export function responseSLASavePayload(policy: EditableResponseSLAPolicy): EditableResponseSLAPolicy {
  return {
    enabled: policy.enabled,
    criticalMinutes: policy.criticalMinutes,
    highMinutes: policy.highMinutes,
    mediumMinutes: policy.mediumMinutes,
    lowMinutes: policy.lowMinutes,
    unknownMinutes: policy.unknownMinutes,
    dueSoonPercent: policy.dueSoonPercent,
    breachEscalationEnabled: policy.breachEscalationEnabled,
  };
}
