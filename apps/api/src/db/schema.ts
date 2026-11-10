/**
 * Modelo de dados (briefing §6.1). Convenções:
 * - ids são UUID texto; datas são epoch em milissegundos;
 * - estados usam CHECK; FKs explícitas; índices em colunas de posse e busca.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

const id = () =>
  text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID());
const createdAt = () =>
  integer('created_at')
    .notNull()
    .$defaultFn(() => Date.now());
const updatedAt = () =>
  integer('updated_at')
    .notNull()
    .$defaultFn(() => Date.now());
const fk = (name: string) => text(name).notNull();

const ROLES_SQL = sql`('owner','admin','manager','approver','editor','viewer')`;

// ---------- identidade ----------
export const users = sqliteTable(
  'users',
  {
    id: id(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    status: text('status').notNull().default('active'),
    isPlatformAdmin: integer('is_platform_admin', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('users_email_uq').on(t.email),
    check('users_status_ck', sql`${t.status} IN ('active','suspended','deleted')`),
  ],
);

export const userProfiles = sqliteTable('user_profiles', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  locale: text('locale').notNull().default('pt'),
  theme: text('theme').notNull().default('system'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    /** SHA-256 (hex) do token; o token em claro só existe no cookie. */
    tokenHash: text('token_hash').notNull(),
    createdAt: createdAt(),
    rotatedAt: integer('rotated_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
    userAgent: text('user_agent'),
  },
  (t) => [
    uniqueIndex('sessions_token_uq').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
);

// ---------- organizações e workspaces ----------
export const organizations = sqliteTable(
  'organizations',
  {
    id: id(),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('personal'),
    ownerUserId: fk('owner_user_id').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('orgs_owner_idx').on(t.ownerUserId),
    check('orgs_kind_ck', sql`${t.kind} IN ('personal','company')`),
  ],
);

export const organizationMembers = sqliteTable(
  'organization_members',
  {
    organizationId: fk('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.userId] }),
    index('org_members_user_idx').on(t.userId),
    check('org_members_role_ck', sql`${t.role} IN ${ROLES_SQL}`),
  ],
);

export const organizationInvites = sqliteTable(
  'organization_invites',
  {
    id: id(),
    organizationId: fk('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    workspaceId: text('workspace_id'),
    tokenHash: text('token_hash').notNull(),
    role: text('role').notNull(),
    createdBy: fk('created_by').references(() => users.id),
    expiresAt: integer('expires_at').notNull(),
    usedAt: integer('used_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('org_invites_token_uq').on(t.tokenHash),
    check('org_invites_role_ck', sql`${t.role} IN ${ROLES_SQL}`),
  ],
);

export const workspaces = sqliteTable(
  'workspaces',
  {
    id: id(),
    organizationId: fk('organization_id').references(() => organizations.id, {
      onDelete: 'cascade',
    }),
    name: text('name').notNull(),
    isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
    storageBytesUsed: integer('storage_bytes_used').notNull().default(0),
    documentCount: integer('document_count').notNull().default(0),
    /** Total de caracteres de texto extraído guardados no D1 (limite por workspace). */
    textCharsUsed: integer('text_chars_used').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('workspaces_org_idx').on(t.organizationId)],
);

export const workspaceMembers = sqliteTable(
  'workspace_members',
  {
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.workspaceId, t.userId] }),
    index('ws_members_user_idx').on(t.userId),
    check('ws_members_role_ck', sql`${t.role} IN ${ROLES_SQL}`),
  ],
);

// ---------- pastas e documentos ----------
export const folders = sqliteTable(
  'folders',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    name: text('name').notNull(),
    depth: integer('depth').notNull().default(1),
    createdBy: fk('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('folders_ws_parent_idx').on(t.workspaceId, t.parentId),
    check('folders_depth_ck', sql`${t.depth} BETWEEN 1 AND 5`),
  ],
);

export const documents = sqliteTable(
  'documents',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    mime: text('mime').notNull(),
    status: text('status').notNull().default('needs_text'),
    currentVersionId: text('current_version_id'),
    createdBy: fk('created_by').references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('documents_ws_folder_idx').on(t.workspaceId, t.folderId),
    check(
      'documents_status_ck',
      sql`${t.status} IN ('needs_text','extracted','needs_ocr','extraction_failed')`,
    ),
  ],
);

export const documentVersions = sqliteTable(
  'document_versions',
  {
    id: id(),
    documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull(),
    storageKey: text('storage_key').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    mime: text('mime').notNull(),
    sha256: text('sha256').notNull(),
    createdBy: fk('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('doc_versions_doc_num_uq').on(t.documentId, t.versionNumber),
    index('doc_versions_ws_idx').on(t.workspaceId),
  ],
);

export const documentMetadata = sqliteTable('document_metadata', {
  documentId: text('document_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  language: text('language'),
  pageCount: integer('page_count'),
  /** 'page' (PDF/OCR) ou 'section' (DOCX/TXT/MD/CSV, que não têm páginas reais). */
  pageKind: text('page_kind').notNull().default('page'),
  extractedBy: text('extracted_by'),
  textCharCount: integer('text_char_count'),
  updatedAt: updatedAt(),
});

export const documentHashes = sqliteTable(
  'document_hashes',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    documentVersionId: fk('document_version_id').references(() => documentVersions.id, {
      onDelete: 'cascade',
    }),
    sha256: text('sha256').notNull(),
    simhash: text('simhash'),
    /** true quando o armazenamento validou o checksum no PUT. */
    verifiedByStorage: integer('verified_by_storage', { mode: 'boolean' }).notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index('doc_hashes_ws_sha_idx').on(t.workspaceId, t.sha256)],
);

/** Uploads em andamento (URL assinada emitida, objeto ainda não validado). */
export const uploads = sqliteTable(
  'uploads',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    folderId: text('folder_id'),
    /** Preenchido quando o envio é uma nova versão de um documento existente. */
    documentId: text('document_id'),
    userId: fk('user_id').references(() => users.id),
    fileName: text('file_name').notNull(),
    declaredMime: text('declared_mime').notNull(),
    declaredSize: integer('declared_size').notNull(),
    sha256: text('sha256').notNull(),
    storageKey: text('storage_key').notNull(),
    status: text('status').notNull().default('pending'),
    rejectReason: text('reject_reason'),
    expiresAt: integer('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index('uploads_ws_idx').on(t.workspaceId),
    index('uploads_expires_idx').on(t.expiresAt),
    check('uploads_status_ck', sql`${t.status} IN ('pending','completed','rejected','expired')`),
  ],
);

/** Texto extraído por página/seção. `id` inteiro estável alimenta o índice FTS5 (migração 0003). */
export const documentPages = sqliteTable(
  'document_pages',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    versionId: fk('version_id').references(() => documentVersions.id, { onDelete: 'cascade' }),
    documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull(),
  },
  (t) => [
    uniqueIndex('doc_pages_version_page_uq').on(t.versionId, t.pageNumber),
    index('doc_pages_workspace_idx').on(t.workspaceId),
    index('doc_pages_document_idx').on(t.documentId),
  ],
);

// ---------- extração ----------
export const extractedFields = sqliteTable(
  'extracted_fields',
  {
    id: id(),
    documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    fieldType: text('field_type').notNull(),
    rawValue: text('raw_value').notNull(),
    normalizedValue: text('normalized_value').notNull(),
    patternId: text('pattern_id').notNull(),
    confidence: real('confidence').notNull(),
    sourceKind: text('source_kind').notNull(),
    personalProfileId: text('personal_profile_id'),
    createdAt: createdAt(),
  },
  (t) => [
    index('extracted_doc_idx').on(t.documentId),
    index('extracted_profile_idx').on(t.personalProfileId),
    check(
      'extracted_source_ck',
      sql`${t.sourceKind} IN ('deterministic','heuristic','ocr','ocr_external','ai_external')`,
    ),
  ],
);

export const extractionSources = sqliteTable(
  'extraction_sources',
  {
    id: id(),
    extractedFieldId: fk('extracted_field_id').references(() => extractedFields.id, {
      onDelete: 'cascade',
    }),
    documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    pageNumber: integer('page_number').notNull(),
    bbox: text('bbox'),
    textSpanStart: integer('text_span_start').notNull(),
    textSpanEnd: integer('text_span_end').notNull(),
    patternId: text('pattern_id').notNull(),
    confidence: real('confidence').notNull(),
  },
  (t) => [index('extraction_sources_field_idx').on(t.extractedFieldId)],
);

export const documentTasks = sqliteTable('document_tasks', {
  id: id(),
  documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  status: text('status').notNull().default('open'),
  payload: text('payload'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const documentComparisons = sqliteTable('document_comparisons', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  leftVersionId: fk('left_version_id').references(() => documentVersions.id),
  rightVersionId: fk('right_version_id').references(() => documentVersions.id),
  createdBy: fk('created_by').references(() => users.id),
  createdAt: createdAt(),
});

export const comparisonResults = sqliteTable('comparison_results', {
  id: id(),
  comparisonId: fk('comparison_id').references(() => documentComparisons.id, {
    onDelete: 'cascade',
  }),
  kind: text('kind').notNull(),
  payload: text('payload').notNull(),
  createdAt: createdAt(),
});

// ---------- geração e formulários ----------
export const documentTemplates = sqliteTable('document_templates', {
  id: id(),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  kind: text('kind').notNull(),
  content: text('content').notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const generatedDocuments = sqliteTable('generated_documents', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  templateId: text('template_id').references(() => documentTemplates.id),
  title: text('title').notNull(),
  content: text('content').notNull(),
  version: integer('version').notNull().default(1),
  createdBy: fk('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const formTemplates = sqliteTable('form_templates', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: createdAt(),
});

export const formFields = sqliteTable('form_fields', {
  id: id(),
  formTemplateId: fk('form_template_id').references(() => formTemplates.id, {
    onDelete: 'cascade',
  }),
  fieldName: text('field_name').notNull(),
  fieldKind: text('field_kind').notNull(),
  required: integer('required', { mode: 'boolean' }).notNull().default(false),
  mappedTo: text('mapped_to'),
});

export const formSubmissions = sqliteTable('form_submissions', {
  id: id(),
  formTemplateId: fk('form_template_id').references(() => formTemplates.id, {
    onDelete: 'cascade',
  }),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  state: text('state').notNull().default('draft'),
  payload: text('payload').notNull(),
  createdBy: fk('created_by').references(() => users.id),
  createdAt: createdAt(),
});

/** Campos sensíveis ficam criptografados (AES-GCM) antes de chegar ao D1. */
export const personalDataProfiles = sqliteTable(
  'personal_data_profiles',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    encryptedPayload: text('encrypted_payload').notNull(),
    iv: text('iv').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('pdp_user_idx').on(t.userId)],
);

// ---------- workflows ----------
export const workflowDefinitions = sqliteTable('workflow_definitions', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdBy: fk('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const workflowSteps = sqliteTable(
  'workflow_steps',
  {
    id: id(),
    workflowId: fk('workflow_id').references(() => workflowDefinitions.id, {
      onDelete: 'cascade',
    }),
    position: integer('position').notNull(),
    kind: text('kind').notNull(),
    config: text('config'),
  },
  (t) => [
    check(
      'workflow_steps_kind_ck',
      sql`${t.kind} IN ('input_extract','validate','compare','generate','approval','output')`,
    ),
    check('workflow_steps_pos_ck', sql`${t.position} BETWEEN 1 AND 10`),
  ],
);

export const workflowExecutions = sqliteTable('workflow_executions', {
  id: id(),
  workflowId: fk('workflow_id').references(() => workflowDefinitions.id, {
    onDelete: 'cascade',
  }),
  status: text('status').notNull().default('running'),
  stepLog: text('step_log'),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
});

// ---------- colaboração ----------
export const approvals = sqliteTable('approvals', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(),
  subjectId: fk('subject_id'),
  decidedBy: fk('decided_by').references(() => users.id),
  decision: text('decision').notNull(),
  note: text('note'),
  decidedAt: integer('decided_at').notNull(),
});

export const comments = sqliteTable('comments', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  authorId: fk('author_id').references(() => users.id),
  body: text('body').notNull(),
  createdAt: createdAt(),
});

export const documentAnnotations = sqliteTable('document_annotations', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  pageNumber: integer('page_number'),
  body: text('body').notNull(),
  version: integer('version').notNull().default(1),
  createdBy: fk('created_by').references(() => users.id),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const documentShares = sqliteTable('document_shares', {
  id: id(),
  workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
  documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
  sharedWithUserId: fk('shared_with_user_id').references(() => users.id),
  role: text('role').notNull(),
  createdAt: createdAt(),
});

export const sharedLinks = sqliteTable(
  'shared_links',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    documentId: fk('document_id').references(() => documents.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: integer('expires_at').notNull(),
    revokedAt: integer('revoked_at'),
    createdBy: fk('created_by').references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('shared_links_token_uq').on(t.tokenHash)],
);

export const sharedLinkAccessLogs = sqliteTable('shared_link_access_logs', {
  id: id(),
  sharedLinkId: fk('shared_link_id').references(() => sharedLinks.id, { onDelete: 'cascade' }),
  accessedAt: integer('accessed_at').notNull(),
  ipHash: text('ip_hash'),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    body: text('body').notNull(),
    readAt: integer('read_at'),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user_idx').on(t.userId, t.readAt)],
);

export const reports = sqliteTable('reports', {
  id: id(),
  targetType: text('target_type').notNull(),
  targetRef: text('target_ref').notNull(),
  reason: text('reason').notNull(),
  status: text('status').notNull().default('open'),
  resolvedAt: integer('resolved_at'),
  createdAt: createdAt(),
});

// ---------- uso, quotas e segurança ----------
export const usageRecords = sqliteTable(
  'usage_records',
  {
    id: id(),
    workspaceId: fk('workspace_id').references(() => workspaces.id, { onDelete: 'cascade' }),
    metric: text('metric').notNull(),
    period: text('period').notNull(),
    amount: integer('amount').notNull().default(0),
  },
  (t) => [uniqueIndex('usage_ws_metric_period_uq').on(t.workspaceId, t.metric, t.period)],
);

export const usageQuotas = sqliteTable('usage_quotas', {
  workspaceId: text('workspace_id')
    .primaryKey()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  overrides: text('overrides'),
  updatedAt: updatedAt(),
});

/** Contador de falhas de login (decisão D3); não usado para limitar tráfego geral. */
export const rateLimitCounters = sqliteTable(
  'rate_limit_counters',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull().default(0),
    windowStart: integer('window_start').notNull(),
    lockedUntil: integer('locked_until'),
  },
  (t) => [index('rate_limit_window_idx').on(t.windowStart)],
);

export const auditLogs = sqliteTable(
  'audit_logs',
  {
    id: id(),
    userId: text('user_id'),
    workspaceId: text('workspace_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    /** Somente metadados; nunca conteúdo de documento. */
    meta: text('meta'),
    createdAt: createdAt(),
  },
  (t) => [index('audit_created_idx').on(t.createdAt), index('audit_user_idx').on(t.userId)],
);

export const userConsents = sqliteTable(
  'user_consents',
  {
    id: id(),
    userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
    purpose: text('purpose').notNull(),
    provider: text('provider'),
    grantedAt: integer('granted_at').notNull(),
    revokedAt: integer('revoked_at'),
  },
  (t) => [index('consents_user_purpose_idx').on(t.userId, t.purpose)],
);

export const featureFlags = sqliteTable('feature_flags', {
  key: text('key').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  updatedAt: updatedAt(),
});

export const syncState = sqliteTable('sync_state', {
  id: id(),
  userId: fk('user_id').references(() => users.id, { onDelete: 'cascade' }),
  deviceId: fk('device_id'),
  cursor: text('cursor'),
  updatedAt: updatedAt(),
});

export const systemSettings = sqliteTable('system_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: updatedAt(),
});
