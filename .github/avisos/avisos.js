// Manda os avisos do Contas da Casa para os celulares (Web Push).
// Roda no GitHub Actions a cada 15 min. Lê o Firestore sem chave guardada (vínculo GitHub ↔ Google).
// Não imprime valores nem dados no log.
const admin = require('firebase-admin');
const webpush = require('web-push');

// Acesso sem chave: o GitHub prova quem é para o Google (Workload Identity Federation).
if (!process.env.GCP_TOKEN) { console.log('Sem acesso ao Google: nada a fazer.'); process.exit(0); }
admin.initializeApp({ projectId: 'contas-da-casa-48988', credential: { getAccessToken: () => Promise.resolve({ access_token: process.env.GCP_TOKEN, expires_in: 600 }) } });
const db = admin.firestore();

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const brl = v => 'R$ ' + (Math.round((+v || 0) * 100) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const agoraSP = () => new Date(Date.now() - 3 * 3600e3);              // horário de Brasília (sem horário de verão)
const iso = d => d.toISOString().slice(0, 10);
const ymAdd = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7); };
const ehCartao = f => !!f && !/boleto|pix/i.test(f);

(async () => {
  const pushRef = db.doc('contas/push'), estRef = db.doc('contas/pushEstado');
  const [pushS, cfgS, estS] = await Promise.all([pushRef.get(), db.doc('contas/config').get(), estRef.get()]);
  const push = pushS.exists ? pushS.data() : {}, cfg = cfgS.exists ? cfgS.data() : {}, est = estS.exists ? estS.data() : {};
  const subs = push.subs || {};
  if (!push.vapid || !Object.keys(subs).length) { console.log('Nenhum celular inscrito.'); return; }
  webpush.setVapidDetails('https://alexandrevazvaladao-sketch.github.io/contas-da-casa/', push.vapid.pub, push.vapid.priv);

  const agora = agoraSP(), hoje = iso(agora), amanha = iso(new Date(agora.getTime() + 864e5)), hora = agora.getUTCHours();
  const ymHoje = hoje.slice(0, 7), meses = [ymAdd(ymHoje, -1), ymHoje, ymAdd(ymHoje, 1), ymAdd(ymHoje, 2)];
  const docs = {};
  await Promise.all(meses.map(async ym => { const s = await db.doc('contasMeses/' + ym).get(); if (s.exists) docs[ym] = s.data(); }));

  const fila = []; // {para: 'todos' | {exceto:nome}, title, body, tag}

  // 1) O que o outro lançou (compara com a última vez)
  const vistos = est.ids || {}, novosVistos = {};
  for (const ym of Object.keys(docs)) {
    const L = docs[ym].lanc || [], ids = L.map(x => x.id);
    novosVistos[ym] = ids;
    if (!vistos[ym]) continue;                                  // primeira vez: só registra
    const antes = new Set(vistos[ym]);
    const novos = L.filter(x => !antes.has(x.id) && !x.prev);
    if (!novos.length) continue;
    const quem = docs[ym].por || '';
    const fat = novos.filter(x => x.orig === 'fatura'), soltos = novos.filter(x => x.orig !== 'fatura');
    if (soltos.length) {
      const txt = soltos.slice(0, 3).map(x => (x.desc || x.cat || 'lançamento') + ' ' + brl(x.valor)).join(' · ') + (soltos.length > 3 ? ` e mais ${soltos.length - 3}` : '');
      fila.push({ para: { exceto: quem }, title: (quem || 'Alguém') + ' lançou em ' + MESES[+ym.slice(5) - 1], body: txt, tag: 'lanc-' + ym });
    }
    if (fat.length) fila.push({ para: { exceto: quem }, title: (quem || 'Alguém') + ' importou fatura', body: fat.length + ' compras em ' + MESES[+ym.slice(5) - 1], tag: 'fat-' + ym });
  }

  // 2) Resumo do dia (uma vez por dia, a partir das 8h)
  const enviados = est.enviados || {};
  if (hora >= 8 && est.diario !== hoje) {
    const vencem = [];
    for (const ym of [ymHoje, ymAdd(ymHoje, 1)]) {
      const L = (docs[ym] && docs[ym].lanc) || [];
      L.filter(x => x.tipo === 'despesa' && !x.pago && !ehCartao(x.fonte) && (x.venc === hoje || x.venc === amanha))
        .forEach(x => vencem.push({ nome: x.desc || x.cat, v: x.valor, quando: x.venc === hoje ? 'hoje' : 'amanhã' }));
      // faturas de cartão
      const vd = cfg.vencDia || {}, pagas = cfg.faturasPagas || {};
      Object.keys(vd).filter(k => k.indexOf('fatura:') === 0).forEach(k => {
        const fo = k.slice(7), V = +vd[k]; if (!V) return;
        const venc = ym + '-' + String(V).padStart(2, '0');
        if (pagas[ym + '|' + fo]) return;
        if (venc !== hoje && venc !== amanha) return;
        const tot = L.filter(x => x.fonte === fo && x.tipo === 'despesa' && !x.prev).reduce((a, x) => a + (+x.valor || 0), 0);
        vencem.push({ nome: 'Fatura ' + fo, v: tot, quando: venc === hoje ? 'hoje' : 'amanhã' });
      });
    }
    if (vencem.length) {
      const hojeV = vencem.filter(x => x.quando === 'hoje'), amV = vencem.filter(x => x.quando === 'amanhã');
      const partes = [];
      if (hojeV.length) partes.push('Hoje: ' + hojeV.map(x => x.nome + (x.v ? ' ' + brl(x.v) : '')).join(', '));
      if (amV.length) partes.push('Amanhã: ' + amV.map(x => x.nome + (x.v ? ' ' + brl(x.v) : '')).join(', '));
      fila.push({ para: 'todos', title: hojeV.length ? 'Conta vencendo hoje' : 'Conta vence amanhã', body: partes.join(' · '), tag: 'venc-' + hoje });
    }
    // fatura fechando (fechamento = vencimento − 7 dias)
    const vd = cfg.vencDia || {};
    Object.keys(vd).filter(k => k.indexOf('fatura:') === 0).forEach(k => {
      const fo = k.slice(7), V = +vd[k]; if (!V) return;
      for (const ym of [ymHoje, ymAdd(ymHoje, 1)]) {
        const venc = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1, V));
        const fecha = iso(new Date(venc.getTime() - 7 * 864e5)), em2 = iso(new Date(new Date(fecha + 'T00:00:00Z').getTime() - 2 * 864e5));
        if (hoje === em2) fila.push({ para: 'todos', title: 'Fatura ' + fo + ' fecha em 2 dias', body: 'Compras a partir de ' + fecha.slice(8) + '/' + fecha.slice(5, 7) + ' já caem na fatura seguinte.', tag: 'fecha-' + fo });
        if (hoje === fecha) fila.push({ para: 'todos', title: 'Fatura ' + fo + ' fechou', body: 'Hoje é o melhor dia de compra: o que comprar agora só vence no mês seguinte.', tag: 'fecha-' + fo });
      }
    });
    est.diario = hoje;
  }

  // 3) Envia
  let ok = 0, erro = 0; const remover = [];
  for (const n of fila) {
    for (const [id, s] of Object.entries(subs)) {
      if (n.para !== 'todos' && n.para.exceto && s.nome && s.nome === n.para.exceto) continue;
      try { await webpush.sendNotification(s.sub, JSON.stringify({ title: n.title, body: n.body, tag: n.tag }), { TTL: 6 * 3600 }); ok++; }
      catch (e) { erro++; if (e.statusCode === 404 || e.statusCode === 410) remover.push(id); }
    }
  }
  if (remover.length) { const up = {}; remover.forEach(id => { up['subs.' + id] = admin.firestore.FieldValue.delete(); }); await pushRef.update(up); }
  await estRef.set({ ids: Object.assign({}, vistos, novosVistos), diario: est.diario || null, enviados, rodou: Date.now() });
  console.log(`Avisos: ${fila.length} · enviados ${ok} · falhas ${erro} · inscritos ${Object.keys(subs).length}`);
})().catch(e => { console.error('Falhou:', e.message); process.exit(1); });
