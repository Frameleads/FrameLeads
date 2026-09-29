export const MARKET_OPTIONS = {
  formality: ['LOW','MEDIUM','HIGH'], directness: ['LOW','MEDIUM','HIGH'], warmth: ['LOW','MEDIUM','HIGH'],
  openerStyle: ['TRIGGER_FIRST','CONTEXT_FIRST','INTRODUCTION_FIRST','RELATIONSHIP_FIRST'],
  ctaStyle: ['DIRECT','EXPLORATORY','PERMISSION_BASED','RESOURCE_FIRST'],
  lengthStyle: ['VERY_SHORT','SHORT','CONTEXTUAL'],
  salutationStyle: ['FIRST_NAME','PROFESSIONAL','TITLE_IF_KNOWN','MINIMAL'],
} as const;
