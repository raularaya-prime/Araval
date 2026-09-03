(() => {
  const state = {
    materiales: [],
    categorias: [],
    view: 'panel',
    notifiedCriticalIds: new Set(),
  };

  // ---------- helpers ----------

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function money(n) {
    return new Intl.NumberFormat('es-CL', { style: 'currency', currency: 'CLP', maximumFractionDigits: 0 }).format(
      n || 0
    );
  }

  function num(n) {
    return new Intl.NumberFormat('es-CL', { maximumFractionDigits: 2 }).format(n);
  }

  function fecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso.replace(' ', 'T') + 'Z');
    return d.toLocaleString('es-CL', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function toast(message, type = 'default') {
    const container = $('#toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type === 'danger' ? 'toast-danger' : type === 'success' ? 'toast-success' : ''}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }

  async function api(path, options = {}) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (res.status === 401) {
      window.location.href = '/login';
      throw new Error('No autenticado');
    }
    let data = null;
    try { data = await res.json(); } catch { /* no body */ }
    if (!res.ok) {
      const message = data?.error || `Error ${res.status}`;
      throw new Error(message);
    }
    return data;
  }

  // ---------- navigation ----------

  function showView(view) {
    state.view = view;
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${view}`).classList.add('active');
    $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    refreshView(view);
  }

  function refreshView(view) {
    if (view === 'panel') loadPanel();
    if (view === 'inventario') loadInventario();
    if (view === 'movimientos') loadMovimientos();
    if (view === 'alertas') loadAlertas();
  }

  // ---------- rendering: materiales table ----------

  function materialRowHtml(m, { showActions = true } = {}) {
    const estado = m.critico
      ? `<span class="pill pill-critico">⚠ Crítico</span>`
      : `<span class="pill pill-ok">OK</span>`;
    return `
      <tr class="${m.critico ? 'row-critico' : ''}">
        <td><strong>${escapeHtml(m.codigo)}</strong></td>
        <td>${escapeHtml(m.nombre)}</td>
        <td>${escapeHtml(m.categoria || '—')}</td>
        <td>${num(m.stock_actual)} ${escapeHtml(m.unidad_medida)}</td>
        <td>${num(m.stock_minimo)} ${escapeHtml(m.unidad_medida)}</td>
        <td>${estado}</td>
        <td>${escapeHtml(m.ubicacion || '—')}</td>
        <td>${escapeHtml(m.proveedor || '—')}</td>
        ${showActions ? `
        <td>
          <button class="icon-btn" data-action="mover" data-id="${m.id}">Mover</button>
          <button class="icon-btn" data-action="editar" data-id="${m.id}">Editar</button>
          <button class="icon-btn" data-action="eliminar" data-id="${m.id}">Eliminar</button>
        </td>` : ''}
      </tr>`;
  }

  function tableOrEmpty(rows, headHtml, emptyMsg) {
    if (!rows.length) return `<div class="empty-state">${emptyMsg}</div>`;
    return `<table><thead><tr>${headHtml}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  // ---------- panel ----------

  async function loadPanel() {
    const [resumen, alertas, movimientos] = await Promise.all([
      api('/resumen'),
      api('/alertas'),
      api('/movimientos?limit=8'),
    ]);

    $('#stat-total').textContent = resumen.total_materiales;
    $('#stat-alertas').textContent = resumen.total_alertas;
    $('#stat-movimientos').textContent = resumen.movimientos_hoy;
    $('#stat-valor').textContent = money(resumen.valor_inventario);

    updateAlertBadge(alertas.length);
    notifyCriticalIfNeeded(alertas);

    const headMat = `<th>Código</th><th>Nombre</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th><th>Estado</th><th>Ubicación</th><th>Proveedor</th>`;
    $('#panel-alertas-table').innerHTML = tableOrEmpty(
      alertas.slice(0, 6).map((m) => materialRowHtml(m, { showActions: false })),
      headMat,
      'No hay materiales con stock crítico. 👍'
    );

    const headMov = `<th>Fecha</th><th>Material</th><th>Tipo</th><th>Cantidad</th><th>Responsable</th>`;
    $('#panel-movimientos-table').innerHTML = tableOrEmpty(
      movimientos.map(movRowHtml),
      headMov,
      'Aún no hay movimientos registrados.'
    );
  }

  // ---------- inventario ----------

  async function loadCategorias() {
    state.categorias = await api('/categorias');
    const select = $('#inv-categoria');
    const current = select.value;
    select.innerHTML = '<option value="">Todas las categorías</option>' +
      state.categorias.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
    select.value = current;

    $('#categorias-list').innerHTML = state.categorias.map((c) => `<option value="${escapeHtml(c)}">`).join('');
  }

  async function loadInventario() {
    await loadCategorias();
    const params = new URLSearchParams();
    const buscar = $('#inv-buscar').value.trim();
    const categoria = $('#inv-categoria').value;
    const soloCriticos = $('#inv-solo-criticos').checked;
    if (buscar) params.set('buscar', buscar);
    if (categoria) params.set('categoria', categoria);
    if (soloCriticos) params.set('criticos', 'true');

    state.materiales = await api(`/materiales?${params.toString()}`);

    const head = `<th>Código</th><th>Nombre</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th><th>Estado</th><th>Ubicación</th><th>Proveedor</th><th>Acciones</th>`;
    $('#inventario-table').innerHTML = tableOrEmpty(
      state.materiales.map((m) => materialRowHtml(m)),
      head,
      'No se encontraron materiales con esos filtros.'
    );
  }

  function openMaterialModal(material = null) {
    $('#form-material').reset();
    $('#mat-id').value = material?.id || '';
    $('#modal-material-title').textContent = material ? 'Editar material' : 'Nuevo material';
    $('#mat-codigo').value = material?.codigo || '';
    $('#mat-nombre').value = material?.nombre || '';
    $('#mat-categoria').value = material?.categoria || '';
    $('#mat-unidad').value = material?.unidad_medida || '';
    $('#mat-stock-actual').value = material?.stock_actual ?? 0;
    $('#mat-stock-minimo').value = material?.stock_minimo ?? 0;
    $('#mat-ubicacion').value = material?.ubicacion || '';
    $('#mat-proveedor').value = material?.proveedor || '';
    $('#mat-precio').value = material?.precio_unitario ?? '';

    // Stock actual is only editable at creation; adjustments go through movimientos.
    $('#mat-stock-actual-wrap').style.display = material ? 'none' : '';

    $('#modal-material').classList.remove('hidden');
  }

  function closeModal(id) {
    $(`#${id}`).classList.add('hidden');
  }

  async function submitMaterialForm(e) {
    e.preventDefault();
    const id = $('#mat-id').value;
    const payload = {
      codigo: $('#mat-codigo').value.trim(),
      nombre: $('#mat-nombre').value.trim(),
      categoria: $('#mat-categoria').value.trim(),
      unidad_medida: $('#mat-unidad').value.trim(),
      stock_minimo: $('#mat-stock-minimo').value,
      ubicacion: $('#mat-ubicacion').value.trim(),
      proveedor: $('#mat-proveedor').value.trim(),
      precio_unitario: $('#mat-precio').value || null,
    };
    if (!id) payload.stock_actual = $('#mat-stock-actual').value;

    try {
      if (id) {
        await api(`/materiales/${id}`, { method: 'PUT', body: JSON.stringify(payload) });
        toast('Material actualizado', 'success');
      } else {
        await api('/materiales', { method: 'POST', body: JSON.stringify(payload) });
        toast('Material creado', 'success');
      }
      closeModal('modal-material');
      refreshView(state.view);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  async function eliminarMaterial(id) {
    const material = state.materiales.find((m) => m.id === id);
    if (!confirm(`¿Eliminar "${material?.nombre || 'material'}"? Se perderá su historial de movimientos.`)) return;
    try {
      await api(`/materiales/${id}`, { method: 'DELETE' });
      toast('Material eliminado', 'success');
      refreshView(state.view);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  // ---------- movimientos ----------

  function movRowHtml(mv) {
    const tipoPill = mv.tipo === 'ingreso'
      ? `<span class="pill pill-ingreso">↓ Ingreso</span>`
      : `<span class="pill pill-salida">↑ Salida</span>`;
    return `
      <tr>
        <td>${fecha(mv.fecha)}</td>
        <td><strong>${escapeHtml(mv.material_codigo)}</strong> — ${escapeHtml(mv.material_nombre)}</td>
        <td>${tipoPill}</td>
        <td>${num(mv.cantidad)} ${escapeHtml(mv.unidad_medida)}</td>
        <td>${escapeHtml(mv.responsable || '—')}</td>
      </tr>`;
  }

  async function populateMaterialSelect() {
    const materiales = await api('/materiales');
    state.materiales = materiales;
    const select = $('#mov-material');
    const current = select.value;
    select.innerHTML = materiales
      .map((m) => `<option value="${m.id}" data-stock="${m.stock_actual}" data-unidad="${escapeHtml(m.unidad_medida)}">${escapeHtml(m.codigo)} — ${escapeHtml(m.nombre)}</option>`)
      .join('');
    if (current) select.value = current;
    updateMovStockInfo();
  }

  function updateMovStockInfo() {
    const select = $('#mov-material');
    const opt = select.selectedOptions[0];
    if (!opt) { $('#mov-stock-info').textContent = ''; return; }
    $('#mov-stock-info').textContent = `Stock actual: ${num(opt.dataset.stock)} ${opt.dataset.unidad}`;
  }

  async function loadMovimientos() {
    await populateMaterialSelect();
    await loadHistorialMovimientos();
  }

  async function loadHistorialMovimientos() {
    const params = new URLSearchParams();
    const tipo = $('#hist-tipo').value;
    const desde = $('#hist-desde').value;
    const hasta = $('#hist-hasta').value;
    if (tipo) params.set('tipo', tipo);
    if (desde) params.set('desde', desde);
    if (hasta) params.set('hasta', hasta);

    const movimientos = await api(`/movimientos?${params.toString()}`);
    const head = `<th>Fecha</th><th>Material</th><th>Tipo</th><th>Cantidad</th><th>Responsable</th>`;
    $('#movimientos-table').innerHTML = tableOrEmpty(movimientos.map(movRowHtml), head, 'No hay movimientos para el filtro seleccionado.');
  }

  async function submitMovimientoForm(e) {
    e.preventDefault();
    const payload = {
      material_id: Number($('#mov-material').value),
      tipo: $('#mov-tipo').value,
      cantidad: $('#mov-cantidad').value,
      documento_referencia: $('#mov-documento').value.trim(),
      responsable: $('#mov-responsable').value.trim(),
      motivo: $('#mov-motivo').value.trim(),
    };
    try {
      const { material } = await api('/movimientos', { method: 'POST', body: JSON.stringify(payload) });
      toast(`Movimiento registrado. Nuevo stock: ${num(material.stock_actual)} ${material.unidad_medida}`, 'success');
      if (material.critico) {
        toast(`⚠ "${material.nombre}" quedó con stock crítico (${num(material.stock_actual)} ${material.unidad_medida})`, 'danger');
      }
      $('#form-movimiento').reset();
      await loadMovimientos();
      updateAlertBadge((await api('/alertas')).length);
    } catch (err) {
      toast(err.message, 'danger');
    }
  }

  // ---------- alertas ----------

  async function loadAlertas() {
    const alertas = await api('/alertas');
    updateAlertBadge(alertas.length);
    const head = `<th>Código</th><th>Nombre</th><th>Categoría</th><th>Stock actual</th><th>Stock mínimo</th><th>Estado</th><th>Ubicación</th><th>Proveedor</th>`;
    $('#alertas-table').innerHTML = tableOrEmpty(
      alertas.map((m) => materialRowHtml(m, { showActions: false })),
      head,
      'No hay materiales con stock crítico en este momento. 👍'
    );
  }

  function updateAlertBadge(count) {
    const badge = $('#alertas-badge');
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  function notifyCriticalIfNeeded(alertas) {
    const nuevos = alertas.filter((m) => !state.notifiedCriticalIds.has(m.id));
    if (!nuevos.length) return;
    nuevos.forEach((m) => state.notifiedCriticalIds.add(m.id));

    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    if (nuevos.length === 1) {
      new Notification('Stock crítico en bodega', {
        body: `${nuevos[0].nombre}: quedan ${num(nuevos[0].stock_actual)} ${nuevos[0].unidad_medida} (mínimo ${num(nuevos[0].stock_minimo)})`,
      });
    } else {
      new Notification('Stock crítico en bodega', {
        body: `${nuevos.length} materiales bajo el mínimo. Revisa la pestaña de Alertas.`,
      });
    }
  }

  async function requestNotificationPermission() {
    if (typeof Notification === 'undefined') {
      toast('Este navegador no soporta notificaciones', 'danger');
      return;
    }
    const perm = await Notification.requestPermission();
    if (perm === 'granted') {
      toast('Notificaciones activadas', 'success');
      state.notifiedCriticalIds.clear();
      const alertas = await api('/alertas');
      notifyCriticalIfNeeded(alertas);
    } else {
      toast('Permiso de notificaciones no concedido', 'danger');
    }
  }

  // ---------- event wiring ----------

  function wireEvents() {
    $$('.tab-btn').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.view)));
    $$('[data-goto]').forEach((btn) => btn.addEventListener('click', () => showView(btn.dataset.goto)));

    $('#btn-nuevo-material').addEventListener('click', () => openMaterialModal());
    $$('[data-close-modal]').forEach((btn) =>
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal))
    );
    $('#modal-material').addEventListener('click', (e) => {
      if (e.target.id === 'modal-material') closeModal('modal-material');
    });

    $('#form-material').addEventListener('submit', submitMaterialForm);
    $('#form-movimiento').addEventListener('submit', submitMovimientoForm);
    $('#mov-material').addEventListener('change', updateMovStockInfo);

    $('#inv-buscar').addEventListener('input', debounce(loadInventario, 300));
    $('#inv-categoria').addEventListener('change', loadInventario);
    $('#inv-solo-criticos').addEventListener('change', loadInventario);

    $('#btn-filtrar-hist').addEventListener('click', loadHistorialMovimientos);
    $('#btn-notificaciones').addEventListener('click', requestNotificationPermission);

    $('#btn-logout').addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); } catch { /* ignore */ }
      window.location.href = '/login';
    });

    $('#btn-cambiar-password').addEventListener('click', () => {
      $('#form-password').reset();
      $('#pass-error').textContent = '';
      $('#modal-password').classList.remove('hidden');
    });
    $('#modal-password').addEventListener('click', (e) => {
      if (e.target.id === 'modal-password') closeModal('modal-password');
    });
    $('#form-password').addEventListener('submit', async (e) => {
      e.preventDefault();
      $('#pass-error').textContent = '';
      try {
        await api('/cambiar-password', {
          method: 'POST',
          body: JSON.stringify({
            password_actual: $('#pass-actual').value,
            password_nueva: $('#pass-nueva').value,
          }),
        });
        toast('Contraseña actualizada', 'success');
        closeModal('modal-password');
      } catch (err) {
        $('#pass-error').textContent = err.message;
      }
    });

    $('#inventario-table').addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const material = state.materiales.find((m) => m.id === id);
      if (btn.dataset.action === 'editar') openMaterialModal(material);
      if (btn.dataset.action === 'eliminar') eliminarMaterial(id);
      if (btn.dataset.action === 'mover') {
        showView('movimientos');
        setTimeout(() => { $('#mov-material').value = id; updateMovStockInfo(); }, 50);
      }
    });
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  // ---------- init ----------

  async function init() {
    wireEvents();
    try {
      const me = await api('/me');
      $('#user-label').textContent = `👤 ${me.username}`;
    } catch {
      return; // api() ya redirigió a /login en un 401
    }
    try {
      await loadPanel();
    } catch (err) {
      toast(`No se pudo conectar con el servidor: ${err.message}`, 'danger');
    }
    // Poll periodically so critical-stock notifications fire even if the user stays idle.
    setInterval(async () => {
      try {
        const alertas = await api('/alertas');
        updateAlertBadge(alertas.length);
        notifyCriticalIfNeeded(alertas);
      } catch { /* ignore transient errors */ }
    }, 60_000);
  }

  init();
})();
