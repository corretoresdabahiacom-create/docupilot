import { beforeEach, describe, expect, it } from 'vitest';
import {
  Client,
  createTestEnv,
  eq,
  pdfBytes,
  registerUser,
  schema,
  type TestEnv,
} from '../test/helpers';

type U = Awaited<ReturnType<typeof registerUser>>;
let env: TestEnv;
let owner: U;
let wsId: string;
let counter = 0;

beforeEach(async () => {
  env = await createTestEnv();
  owner = await registerUser(env, 'dono@example.com', 'Dono');
  const org = await owner.client.post('/api/organizations', { name: 'Acme Ltda' });
  expect(org.status).toBe(201);
  wsId = org.json.workspace.id;
  counter = 0;
});

const W = (id = wsId) => `/api/workspaces/${id}`;

/** Cria o convite como `by` e o aceita como `user`; devolve o usuário já como membro. */
async function join(role: string, email: string, by: Client = owner.client): Promise<U> {
  const inv = await by.post(`${W()}/invites`, { role });
  expect(inv.status).toBe(201);
  const user = await registerUser(env, email, email.split('@')[0]);
  const acc = await user.client.post('/api/invites/accept', { token: inv.json.invite.token });
  expect(acc.status).toBe(200);
  return user;
}

async function upload(c: Client, folderId?: string | null, size = 300) {
  const sha256 = (++counter).toString(16).padStart(64, '0');
  const bytes = pdfBytes(size);
  const created = await c.post(`${W()}/uploads`, {
    fileName: `doc-${counter}.pdf`,
    mime: 'application/pdf',
    size: bytes.length,
    sha256,
    folderId,
  });
  if (created.status !== 201) return { created };
  env.storage!.put(`ws/${wsId}/${created.json.uploadId}`, bytes);
  const done = await c.post(`${W()}/uploads/${created.json.uploadId}/complete`);
  return { created, done };
}

async function docWithText(folderId: string | null, text: string) {
  const r = await upload(owner.client, folderId);
  expect(r.done?.status).toBe(201);
  const d = r.done!.json;
  const base = `${W()}/documents/${d.document.id}/versions/${d.versionId}`;
  const put = await owner.client.request('PUT', `${base}/pages`, {
    pages: [{ pageNumber: 1, text }],
    extractedBy: 'client',
  });
  expect(put.status).toBe(200);
  const done = await owner.client.post(`${base}/extraction/complete`, {
    status: 'extracted',
    pageCount: 1,
    extractedBy: 'client',
  });
  expect(done.status).toBe(200);
  return d.document.id as string;
}

describe('empresa e workspace', () => {
  it('cria empresa com workspace, dono como owner, e lista', async () => {
    const orgs = await owner.client.get('/api/organizations');
    expect(orgs.json.organizations.map((o: any) => o.name)).toContain('Acme Ltda');
    const me = await owner.client.get('/api/auth/me');
    const company = me.json.workspaces.find((w: any) => w.id === wsId);
    expect(company).toMatchObject({ isPersonal: false, role: 'owner' });
  });

  it('exige sessão', async () => {
    const anon = new Client(env);
    expect((await anon.post('/api/organizations', { name: 'X' })).status).toBe(401);
    expect((await anon.get(`${W()}/members`)).status).toBe(401);
  });

  it('só owner/admin da empresa criam novos workspaces nela', async () => {
    const orgId = (await owner.client.get('/api/organizations')).json.organizations.find(
      (o: any) => o.name === 'Acme Ltda',
    ).id;
    const ok = await owner.client.post(`/api/organizations/${orgId}/workspaces`, { name: 'RH' });
    expect(ok.status).toBe(201);
    const editor = await join('editor', 'ed@example.com');
    const no = await editor.client.post(`/api/organizations/${orgId}/workspaces`, { name: 'X' });
    expect(no.status).toBe(403);
    const outsider = await registerUser(env, 'fora@example.com');
    const hidden = await outsider.client.post(`/api/organizations/${orgId}/workspaces`, {
      name: 'X',
    });
    expect(hidden.status).toBe(404);
  });
});

describe('convites por link (E2E)', () => {
  it('fluxo completo: criar, prévia pública, aceitar, uso único', async () => {
    const inv = await owner.client.post(`${W()}/invites`, { role: 'editor', expiresInHours: 24 });
    expect(inv.status).toBe(201);
    const { token, path } = inv.json.invite;
    expect(path).toBe(`/convite/${token}`);

    // No banco só existe o hash do token.
    const rows = await env.db.select().from(schema.organizationInvites);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);

    // A listagem nunca devolve o token.
    const list = await owner.client.get(`${W()}/invites`);
    expect(JSON.stringify(list.json)).not.toContain(token);
    expect(list.json.invites[0]).toMatchObject({ role: 'editor', status: 'pending' });

    // Prévia sem login: só nomes, papel e validade.
    const anon = new Client(env);
    const preview = await anon.get(`/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect(preview.json.invite).toMatchObject({
      organizationName: 'Acme Ltda',
      role: 'editor',
    });
    expect(Object.keys(preview.json.invite).sort()).toEqual(
      ['expiresAt', 'organizationName', 'role', 'workspaceName'].sort(),
    );

    // Aceitar exige sessão.
    expect((await anon.post('/api/invites/accept', { token })).status).toBe(401);

    const guest = await registerUser(env, 'convidado@example.com', 'Convidado');
    const acc = await guest.client.post('/api/invites/accept', { token });
    expect(acc.status).toBe(200);
    expect(acc.json.workspace).toMatchObject({ id: wsId, role: 'editor' });

    const me = await guest.client.get('/api/auth/me');
    expect(me.json.workspaces.find((w: any) => w.id === wsId)?.role).toBe('editor');
    const orgMember = await env.db
      .select()
      .from(schema.organizationMembers)
      .where(eq(schema.organizationMembers.userId, guest.userId));
    expect(orgMember.some((m) => m.role === 'editor')).toBe(true);

    // Link usado: não vale mais (prévia e novo aceite dão 404).
    expect((await anon.get(`/api/invites/${token}`)).status).toBe(404);
    const other = await registerUser(env, 'outro@example.com');
    expect((await other.client.post('/api/invites/accept', { token })).status).toBe(404);
    const after = await owner.client.get(`${W()}/invites`);
    expect(after.json.invites[0].status).toBe('used');
  });

  it('convite expirado ou revogado responde 404 igual ao token inexistente', async () => {
    const a = await owner.client.post(`${W()}/invites`, { role: 'viewer' });
    await env.db
      .update(schema.organizationInvites)
      .set({ expiresAt: Date.now() - 1000 })
      .where(eq(schema.organizationInvites.id, a.json.invite.id));
    const guest = await registerUser(env, 'g1@example.com');
    const expired = await guest.client.post('/api/invites/accept', { token: a.json.invite.token });
    expect(expired.status).toBe(404);

    const b = await owner.client.post(`${W()}/invites`, { role: 'viewer' });
    const del = await owner.client.request('DELETE', `${W()}/invites/${b.json.invite.id}`);
    expect(del.status).toBe(200);
    const revoked = await guest.client.post('/api/invites/accept', { token: b.json.invite.token });
    expect(revoked.status).toBe(404);

    const bogus = await guest.client.post('/api/invites/accept', { token: 'x'.repeat(43) });
    expect(bogus.status).toBe(404);
    expect(bogus.json).toEqual(revoked.json);
  });

  it('já ser membro não consome o link', async () => {
    const inv = await owner.client.post(`${W()}/invites`, { role: 'viewer' });
    const again = await owner.client.post('/api/invites/accept', { token: inv.json.invite.token });
    expect(again.status).toBe(409);
    const guest = await registerUser(env, 'g2@example.com');
    expect(
      (await guest.client.post('/api/invites/accept', { token: inv.json.invite.token })).status,
    ).toBe(200);
  });

  it('dois aceites simultâneos: só um vence', async () => {
    const inv = await owner.client.post(`${W()}/invites`, { role: 'viewer' });
    const g1 = await registerUser(env, 'r1@example.com');
    const g2 = await registerUser(env, 'r2@example.com');
    const [r1, r2] = await Promise.all([
      g1.client.post('/api/invites/accept', { token: inv.json.invite.token }),
      g2.client.post('/api/invites/accept', { token: inv.json.invite.token }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 404]);
  });

  it('respeita o limite de membros e de convites pendentes', async () => {
    await env.db
      .insert(schema.systemSettings)
      .values({ key: 'quota.membersPerWorkspace', value: '2' });
    await join('viewer', 'm1@example.com');
    const inv = await owner.client.post(`${W()}/invites`, { role: 'viewer' });
    const g = await registerUser(env, 'm2@example.com');
    const full = await g.client.post('/api/invites/accept', { token: inv.json.invite.token });
    expect(full.status).toBe(429);

    await env.db
      .insert(schema.systemSettings)
      .values({ key: 'quota.invitesPendingPerWorkspace', value: '1' });
    expect((await owner.client.post(`${W()}/invites`, { role: 'viewer' })).status).toBe(429);
  });

  it('workspace pessoal não aceita convites', async () => {
    const res = await owner.client.post(`${W(owner.workspaceId)}/invites`, { role: 'viewer' });
    expect(res.status).toBe(409);
  });
});

describe('papéis e gestão de membros', () => {
  it('não se concede owner; só owner concede admin; admin concede de manager para baixo', async () => {
    expect((await owner.client.post(`${W()}/invites`, { role: 'owner' })).status).toBe(400);
    const admin = await join('admin', 'adm@example.com');
    expect((await admin.client.post(`${W()}/invites`, { role: 'admin' })).status).toBe(403);
    expect((await admin.client.post(`${W()}/invites`, { role: 'manager' })).status).toBe(201);
    expect((await owner.client.post(`${W()}/invites`, { role: 'admin' })).status).toBe(201);
  });

  it('papéis sem manage_members não veem nem criam convites e membros', async () => {
    for (const role of ['manager', 'approver', 'editor', 'viewer']) {
      const u = await join(role, `${role}@example.com`);
      expect((await u.client.post(`${W()}/invites`, { role: 'viewer' })).status).toBe(403);
      expect((await u.client.get(`${W()}/invites`)).status).toBe(403);
      const patch = await u.client.request('PATCH', `${W()}/members/${owner.userId}`, {
        quotaBytes: 1,
      });
      expect(patch.status).toBe(403);
    }
  });

  it('lista de membros: e-mail e cota só para quem gerencia', async () => {
    const viewer = await join('viewer', 'v@example.com');
    const asOwner = await owner.client.get(`${W()}/members`);
    expect(asOwner.json.members.every((m: any) => typeof m.email === 'string')).toBe(true);
    const asViewer = await viewer.client.get(`${W()}/members`);
    const others = asViewer.json.members.filter((m: any) => !m.isMe);
    expect(others.length).toBeGreaterThan(0);
    for (const m of others) {
      expect(m.email).toBeUndefined();
      expect(m.usedBytes).toBeUndefined();
    }
    const mine = asViewer.json.members.find((m: any) => m.isMe);
    expect(mine.usedBytes).toBe(0);
    expect(mine.email).toBeUndefined();
  });

  it('altera papéis com as regras de hierarquia', async () => {
    const admin = await join('admin', 'a1@example.com');
    const editor = await join('editor', 'e1@example.com');
    const admin2 = await join('admin', 'a2@example.com');
    // admin promove editor a manager, mas não a admin, e não toca em owner/outro admin.
    expect(
      (await admin.client.request('PATCH', `${W()}/members/${editor.userId}`, { role: 'manager' }))
        .status,
    ).toBe(200);
    expect(
      (await admin.client.request('PATCH', `${W()}/members/${editor.userId}`, { role: 'admin' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.client.request('PATCH', `${W()}/members/${owner.userId}`, { role: 'viewer' }))
        .status,
    ).toBe(403);
    expect(
      (await admin.client.request('PATCH', `${W()}/members/${admin2.userId}`, { role: 'viewer' }))
        .status,
    ).toBe(403);
    // ninguém altera o próprio papel; owner rebaixa admin.
    expect(
      (await admin.client.request('PATCH', `${W()}/members/${admin.userId}`, { role: 'viewer' }))
        .status,
    ).toBe(403);
    expect(
      (await owner.client.request('PATCH', `${W()}/members/${admin2.userId}`, { role: 'viewer' }))
        .status,
    ).toBe(200);
    // owner nunca vira outro papel nem recebe owner.
    expect(
      (await owner.client.request('PATCH', `${W()}/members/${editor.userId}`, { role: 'owner' }))
        .status,
    ).toBe(400);
  });

  it('remove membro, permite sair, e o owner não sai', async () => {
    const editor = await join('editor', 'saida@example.com');
    const viewer = await join('viewer', 'fora2@example.com');
    // editor não remove ninguém
    expect((await editor.client.request('DELETE', `${W()}/members/${viewer.userId}`)).status).toBe(
      403,
    );
    // viewer sai sozinho e perde o acesso
    expect((await viewer.client.request('DELETE', `${W()}/members/${viewer.userId}`)).status).toBe(
      200,
    );
    expect((await viewer.client.get(`${W()}/members`)).status).toBe(404);
    // owner remove editor
    expect((await owner.client.request('DELETE', `${W()}/members/${editor.userId}`)).status).toBe(
      200,
    );
    expect((await editor.client.get(`${W()}/documents`)).status).toBe(404);
    // owner não sai
    expect((await owner.client.request('DELETE', `${W()}/members/${owner.userId}`)).status).toBe(
      409,
    );
  });
});

describe('isolamento entre workspaces', () => {
  it('membro de A não enxerga nada de B; convite de A não abre B', async () => {
    const ownerB = await registerUser(env, 'dono-b@example.com', 'Dono B');
    const orgB = await ownerB.client.post('/api/organizations', { name: 'Beta SA' });
    const wsB = orgB.json.workspace.id as string;

    const editorA = await join('editor', 'ea@example.com');
    for (const path of ['members', 'invites', 'activity', 'documents', 'folders']) {
      expect((await editorA.client.get(`${W(wsB)}/${path}`)).status).toBe(404);
    }
    // dono de A não gere B
    expect((await owner.client.post(`${W(wsB)}/invites`, { role: 'viewer' })).status).toBe(404);
    expect(
      (await owner.client.request('PATCH', `${W(wsB)}/members/${ownerB.userId}`, { quotaBytes: 0 }))
        .status,
    ).toBe(404);

    // convite de A dá acesso a A, e só a A
    const guest = await join('viewer', 'gv@example.com');
    const me = await guest.client.get('/api/auth/me');
    expect(me.json.workspaces.map((w: any) => w.id)).not.toContain(wsB);
    expect((await guest.client.get(`${W(wsB)}/documents`)).status).toBe(404);

    // revogar convite de B por id vindo de A: 404
    const invB = await ownerB.client.post(`${W(wsB)}/invites`, { role: 'viewer' });
    expect(
      (await owner.client.request('DELETE', `${W()}/invites/${invB.json.invite.id}`)).status,
    ).toBe(404);
  });

  it('concessão de pasta só vale para membro do mesmo workspace', async () => {
    const folder = await owner.client.post(`${W()}/folders`, { name: 'Diretoria' });
    const stranger = await registerUser(env, 'estranho@example.com');
    const res = await owner.client.request(
      'PUT',
      `${W()}/folders/${folder.json.folder.id}/access/${stranger.userId}`,
      { access: 'view' },
    );
    expect(res.status).toBe(404);
  });
});

describe('pastas compartilhadas e permissões por membro', () => {
  async function setup() {
    const folder = (await owner.client.post(`${W()}/folders`, { name: 'Financeiro' })).json.folder;
    const sub = (
      await owner.client.post(`${W()}/folders`, { name: 'Balanços', parentId: folder.id })
    ).json.folder;
    const open = (await owner.client.post(`${W()}/folders`, { name: 'Público' })).json.folder;
    const secret = await docWithText(folder.id, 'balanço confidencial do trimestre');
    const inSub = await docWithText(sub.id, 'balanço anual confidencial');
    const visible = await docWithText(open.id, 'balanço público de exemplo');
    const editor = await join('editor', 'ed2@example.com');
    const manager = await join('manager', 'mg@example.com');
    const restrict = await owner.client.request('PUT', `${W()}/folders/${folder.id}/access`, {
      restricted: true,
    });
    expect(restrict.status).toBe(200);
    return { folder, sub, open, secret, inSub, visible, editor, manager };
  }

  it('pasta restrita some para quem não tem concessão (pastas, documentos, busca, detalhe)', async () => {
    const s = await setup();
    const folders = await s.editor.client.get(`${W()}/folders`);
    const names = folders.json.folders.map((f: any) => f.name);
    expect(names).toContain('Público');
    expect(names).not.toContain('Financeiro');
    expect(names).not.toContain('Balanços'); // subpasta herda a restrição

    const docs = await s.editor.client.get(`${W()}/documents?folderId=all`);
    const ids = docs.json.documents.map((d: any) => d.id);
    expect(ids).toEqual([s.visible]);

    expect((await s.editor.client.get(`${W()}/documents/${s.secret}`)).status).toBe(404);
    expect((await s.editor.client.get(`${W()}/documents/${s.inSub}`)).status).toBe(404);
    expect((await s.editor.client.get(`${W()}/documents?folderId=${s.folder.id}`)).status).toBe(
      404,
    );

    const search = await s.editor.client.get(`${W()}/search?q=balan%C3%A7o`);
    expect(search.json.results.map((r: any) => r.documentId)).toEqual([s.visible]);

    // O dono e o manager continuam vendo tudo.
    for (const c of [owner.client, s.manager.client]) {
      const all = await c.get(`${W()}/search?q=balan%C3%A7o`);
      expect(all.json.results).toHaveLength(3);
      expect((await c.get(`${W()}/documents/${s.secret}`)).status).toBe(200);
    }
  });

  it('não envia para dentro, não cria subpasta, não move para pasta oculta', async () => {
    const s = await setup();
    expect((await upload(s.editor.client, s.folder.id)).created.status).toBe(404);
    expect(
      (await s.editor.client.post(`${W()}/folders`, { name: 'x', parentId: s.folder.id })).status,
    ).toBe(404);
    const mv = await s.editor.client.request('PATCH', `${W()}/documents/${s.visible}`, {
      folderId: s.folder.id,
    });
    expect(mv.status).toBe(404);
    // duplicado em pasta oculta não revela o nome do documento
    const pre = await s.editor.client.post(`${W()}/uploads/precheck`, {
      fileName: 'a.pdf',
      sha256: 'f'.repeat(64),
    });
    expect(pre.json.duplicate).toBeNull();
  });

  it('concessão view lê mas não altera; edit altera conforme o papel; revogar oculta', async () => {
    const s = await setup();
    const grant = (access: string, who = s.editor) =>
      owner.client.request('PUT', `${W()}/folders/${s.folder.id}/access/${who.userId}`, { access });

    expect((await grant('view')).status).toBe(200);
    // vê a pasta, a subpasta (herda) e os documentos
    expect((await s.editor.client.get(`${W()}/documents/${s.secret}`)).status).toBe(200);
    expect((await s.editor.client.get(`${W()}/documents/${s.inSub}`)).status).toBe(200);
    const search = await s.editor.client.get(`${W()}/search?q=confidencial`);
    expect(search.json.results).toHaveLength(2);
    // mas não altera: renomear, enviar, criar subpasta
    expect(
      (await s.editor.client.request('PATCH', `${W()}/documents/${s.secret}`, { name: 'x.pdf' }))
        .status,
    ).toBe(403);
    expect((await upload(s.editor.client, s.folder.id)).created.status).toBe(403);
    expect(
      (await s.editor.client.post(`${W()}/folders`, { name: 'n', parentId: s.folder.id })).status,
    ).toBe(403);

    expect((await grant('edit')).status).toBe(200);
    expect(
      (await s.editor.client.request('PATCH', `${W()}/documents/${s.secret}`, { name: 'x.pdf' }))
        .status,
    ).toBe(200);
    expect((await upload(s.editor.client, s.folder.id)).done?.status).toBe(201);

    // `edit` não eleva o papel: um viewer com concessão edit continua sem editar.
    const viewer = await join('viewer', 'vv@example.com');
    expect((await grant('edit', viewer)).status).toBe(200);
    expect((await viewer.client.get(`${W()}/documents/${s.secret}`)).status).toBe(200);
    expect(
      (await viewer.client.request('PATCH', `${W()}/documents/${s.secret}`, { name: 'y.pdf' }))
        .status,
    ).toBe(403);

    // revogar: some de novo
    expect(
      (
        await owner.client.request(
          'DELETE',
          `${W()}/folders/${s.folder.id}/access/${s.editor.userId}`,
        )
      ).status,
    ).toBe(200);
    expect((await s.editor.client.get(`${W()}/documents/${s.secret}`)).status).toBe(404);
  });

  it('só quem pode compartilhar gere a restrição; sair do workspace apaga as concessões', async () => {
    const s = await setup();
    expect(
      (
        await s.editor.client.request('PUT', `${W()}/folders/${s.folder.id}/access`, {
          restricted: false,
        })
      ).status,
    ).toBe(403);
    expect((await s.editor.client.get(`${W()}/folders/${s.folder.id}/access`)).status).toBe(403);
    // manager (tem `share`) gere a lista
    expect(
      (
        await s.manager.client.request(
          'PUT',
          `${W()}/folders/${s.folder.id}/access/${s.editor.userId}`,
          { access: 'view' },
        )
      ).status,
    ).toBe(200);
    const list = await s.manager.client.get(`${W()}/folders/${s.folder.id}/access`);
    expect(list.json).toMatchObject({ restricted: true });
    expect(list.json.grants).toHaveLength(1);

    await owner.client.request('DELETE', `${W()}/members/${s.editor.userId}`);
    const left = await env.db.select().from(schema.folderMembers);
    expect(left).toHaveLength(0);
  });

  it('desrestringir devolve a visibilidade; fluxo de análise respeita a pasta', async () => {
    const s = await setup();
    expect((await s.editor.client.get(`${W()}/documents/${s.secret}/analysis`)).status).toBe(404);
    await owner.client.request('PUT', `${W()}/folders/${s.folder.id}/access`, {
      restricted: false,
    });
    expect((await s.editor.client.get(`${W()}/documents/${s.secret}`)).status).toBe(200);
    // a rota de análise existe (200 para quem vê) — o 404 de antes era mesmo a pasta
    expect((await s.editor.client.get(`${W()}/documents/${s.secret}/analysis`)).status).toBe(200);
  });
});

describe('cota por membro', () => {
  it('bloqueia o envio de quem estourou a própria cota, sem afetar os outros', async () => {
    const editor = await join('editor', 'cota@example.com');
    const other = await join('editor', 'cota2@example.com');
    const set = await owner.client.request('PATCH', `${W()}/members/${editor.userId}`, {
      quotaBytes: 500,
    });
    expect(set.status).toBe(200);

    expect((await upload(editor.client, null, 300)).done?.status).toBe(201);
    const over = await upload(editor.client, null, 300);
    expect(over.created.status).toBe(429);
    expect(over.created.json.error.code).toBe('QUOTA_EXCEEDED');
    expect(over.created.json.error.details).toMatchObject({ scope: 'member' });

    // outro membro (cota padrão) segue enviando
    expect((await upload(other.client, null, 300)).done?.status).toBe(201);

    // o dono vê o uso de cada um e o padrão
    const members = await owner.client.get(`${W()}/members`);
    const e = members.json.members.find((m: any) => m.userId === editor.userId);
    expect(e).toMatchObject({ quotaBytes: 500, quotaIsDefault: false });
    expect(e.usedBytes).toBeGreaterThan(0);

    // voltar ao padrão
    await owner.client.request('PATCH', `${W()}/members/${editor.userId}`, { quotaBytes: null });
    expect((await upload(editor.client, null, 300)).done?.status).toBe(201);
  });

  it('não vale no workspace pessoal', async () => {
    const sha256 = 'b'.repeat(64);
    const bytes = pdfBytes(300);
    const res = await owner.client.post(`${W(owner.workspaceId)}/uploads`, {
      fileName: 'p.pdf',
      mime: 'application/pdf',
      size: bytes.length,
      sha256,
    });
    expect(res.status).toBe(201);
  });
});

describe('histórico por workspace', () => {
  it('registra ações do workspace, só metadados, e restringe a quem compartilha', async () => {
    const editor = await join('editor', 'hist@example.com');
    await docWithText(null, 'conteúdo secreto do contrato');
    const log = await owner.client.get(`${W()}/activity`);
    expect(log.status).toBe(200);
    const actions = log.json.events.map((e: any) => e.action);
    expect(actions).toContain('invite.created');
    expect(actions).toContain('invite.accepted');
    expect(actions).toContain('organization.created');
    // nada de conteúdo de documento no histórico
    expect(JSON.stringify(log.json)).not.toContain('conteúdo secreto');
    expect(log.json.events[0].displayName).toBeTruthy();

    expect((await editor.client.get(`${W()}/activity`)).status).toBe(403);
    const outsider = await registerUser(env, 'x-hist@example.com');
    expect((await outsider.client.get(`${W()}/activity`)).status).toBe(404);

    // paginação por cursor
    const page1 = await owner.client.get(`${W()}/activity?limit=2`);
    expect(page1.json.events).toHaveLength(2);
    expect(page1.json.next).toBeTruthy();
    const page2 = await owner.client.get(`${W()}/activity?limit=2&before=${page1.json.next}`);
    const ids1 = new Set(page1.json.events.map((e: any) => e.id));
    expect(page2.json.events.every((e: any) => !ids1.has(e.id))).toBe(true);
  });
});
