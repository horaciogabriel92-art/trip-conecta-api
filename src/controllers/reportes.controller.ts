import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

// Helper para formatear mes
const formatMonth = (dateStr: string) => {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Helper para aplicar filtros base
const getBaseQuery = (table: string, fechaField: string, fechaDesde: string, fechaHasta: string, vendedorId?: string) => {
  let query = supabase.from(table).select('*');
  const hastaInclusive = fechaHasta.includes('T') ? fechaHasta : `${fechaHasta}T23:59:59.999Z`;
  query = query.gte(fechaField, fechaDesde).lte(fechaField, hastaInclusive);
  if (vendedorId) {
    query = query.eq('vendedor_id', vendedorId);
  }
  return query;
};

export const getPipelineReport = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { fecha_desde, fecha_hasta, vendedor_id } = req.query;
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' });
  }

  try {
    const { data: cotizaciones, error } = await getBaseQuery(
      'cotizaciones', 'fecha_creacion', fecha_desde as string, fecha_hasta as string, vendedor_id as string | undefined
    );
    if (error) throw error;

    const cotizacionesArr = cotizaciones || [];
    const total = cotizacionesArr.length;
    const enviadas = cotizacionesArr.filter((c: any) => c.estado === 'enviada').length;
    const vendidas = cotizacionesArr.filter((c: any) => c.estado === 'vendida').length;
    const perdidas = cotizacionesArr.filter((c: any) => c.estado === 'perdida').length;
    const nuevas = cotizacionesArr.filter((c: any) => c.estado === 'nueva' || !c.estado || c.estado === 'pendiente').length;
    const tasaConversion = total > 0 ? Number(((vendidas / total) * 100).toFixed(2)) : 0;
    const ticketPromedioCotizado = total > 0 ? Number((cotizacionesArr.reduce((sum: number, c: any) => sum + (Number(c.precio_total) || 0), 0) / total).toFixed(2)) : 0;

    const { data: ventasData } = await getBaseQuery(
      'ventas', 'fecha_creacion', fecha_desde as string, fecha_hasta as string, vendedor_id as string | undefined
    );
    const ventasArr = ventasData || [];
    const ticketPromedioVendido = ventasArr.length > 0 ? Number((ventasArr.reduce((sum: number, v: any) => sum + (Number(v.precio_total) || 0), 0) / ventasArr.length).toFixed(2)) : 0;

    const porMes: Record<string, any> = {};
    cotizacionesArr.forEach((c: any) => {
      const mes = formatMonth(c.fecha_creacion);
      if (!porMes[mes]) porMes[mes] = { mes, total: 0, enviadas: 0, vendidas: 0, perdidas: 0, nuevas: 0, monto: 0 };
      porMes[mes].total++;
      porMes[mes].monto += Number(c.precio_total) || 0;
      if (c.estado === 'enviada') porMes[mes].enviadas++;
      else if (c.estado === 'vendida') porMes[mes].vendidas++;
      else if (c.estado === 'perdida') porMes[mes].perdidas++;
      else porMes[mes].nuevas++;
    });

    const vendedorIds = [...new Set(cotizacionesArr.map((c: any) => c.vendedor_id).filter(Boolean))];
    let vendedoresMap: Record<string, string> = {};
    if (vendedorIds.length > 0) {
      const { data: usersData } = await supabase.from('users').select('id, nombre, apellido').in('id', vendedorIds);
      (usersData || []).forEach((u: any) => {
        vendedoresMap[u.id] = `${u.nombre || ''} ${u.apellido || ''}`.trim();
      });
    }

    const porVendedor: Record<string, any> = {};
    cotizacionesArr.forEach((c: any) => {
      const vid = c.vendedor_id || 'sin_vendedor';
      if (!porVendedor[vid]) {
        porVendedor[vid] = { vendedor_id: vid, vendedor_nombre: vendedoresMap[vid] || 'Sin vendedor', total: 0, enviadas: 0, vendidas: 0, perdidas: 0, nuevas: 0, monto: 0 };
      }
      porVendedor[vid].total++;
      porVendedor[vid].monto += Number(c.precio_total) || 0;
      if (c.estado === 'enviada') porVendedor[vid].enviadas++;
      else if (c.estado === 'vendida') porVendedor[vid].vendidas++;
      else if (c.estado === 'perdida') porVendedor[vid].perdidas++;
      else porVendedor[vid].nuevas++;
    });

    res.json({
      resumen: {
        total_cotizaciones: total,
        enviadas,
        vendidas,
        perdidas,
        nuevas,
        tasa_conversion: tasaConversion,
        ticket_promedio_cotizado: ticketPromedioCotizado,
        ticket_promedio_vendido: ticketPromedioVendido,
      },
      por_mes: Object.values(porMes).sort((a: any, b: any) => b.mes.localeCompare(a.mes)),
      por_vendedor: Object.values(porVendedor).sort((a: any, b: any) => b.vendidas - a.vendidas),
    });
  } catch (error: any) {
    console.error('Error getPipelineReport:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

export const getCobranzaReport = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { fecha_desde, fecha_hasta, vendedor_id } = req.query;
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' });
  }

  try {
    const { data: ventasData, error: ventasError } = await getBaseQuery(
      'ventas', 'fecha_creacion', fecha_desde as string, fecha_hasta as string, vendedor_id as string | undefined
    );
    if (ventasError) throw ventasError;
    const ventasArr = ventasData || [];

    const ventaIds = ventasArr.map((v: any) => v.id);
    let pagosArr: any[] = [];
    if (ventaIds.length > 0) {
      const { data: pagosData } = await supabase.from('pagos_venta').select('*').in('venta_id', ventaIds);
      pagosArr = pagosData || [];
    }

    const totalVendido = ventasArr.reduce((sum: number, v: any) => sum + (Number(v.precio_total) || 0), 0);
    const totalCobrado = pagosArr.reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0);
    const saldoPendiente = Math.max(0, totalVendido - totalCobrado);
    const pagosIniciales = pagosArr.filter((p: any) => p.tipo === 'inicial').reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0);
    const pagosAdicionales = pagosArr.filter((p: any) => p.tipo === 'adicional').reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0);

    const mediosPago: Record<string, number> = {};
    pagosArr.forEach((p: any) => {
      const medio = p.medio_pago || 'Desconocido';
      mediosPago[medio] = (mediosPago[medio] || 0) + (Number(p.monto) || 0);
    });

    const ventasConSaldo = ventasArr.map((v: any) => {
      const pagosVenta = pagosArr.filter((p: any) => p.venta_id === v.id);
      const pagado = pagosVenta.reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0);
      const pendiente = Math.max(0, (Number(v.precio_total) || 0) - pagado);
      const dias = Math.floor((Date.now() - new Date(v.fecha_creacion).getTime()) / (1000 * 60 * 60 * 24));
      return { id: v.id, codigo: v.codigo, cliente_nombre: v.cliente_nombre, precio_total: Number(v.precio_total) || 0, pagado, pendiente, dias_atraso: dias, fecha_creacion: v.fecha_creacion };
    }).filter((v: any) => v.pendiente > 0).sort((a: any, b: any) => b.pendiente - a.pendiente);

    const porMes: Record<string, any> = {};
    ventasArr.forEach((v: any) => {
      const mes = formatMonth(v.fecha_creacion);
      if (!porMes[mes]) porMes[mes] = { mes, vendido: 0, cobrado: 0 };
      porMes[mes].vendido += Number(v.precio_total) || 0;
    });
    pagosArr.forEach((p: any) => {
      const mes = formatMonth(p.fecha_pago || p.creado_en);
      if (!porMes[mes]) porMes[mes] = { mes, vendido: 0, cobrado: 0 };
      porMes[mes].cobrado += Number(p.monto) || 0;
    });

    res.json({
      resumen: { total_vendido: totalVendido, total_cobrado: totalCobrado, saldo_pendiente: saldoPendiente, pagos_iniciales: pagosIniciales, pagos_adicionales: pagosAdicionales },
      medios_pago: Object.entries(mediosPago).map(([medio, monto]) => ({ medio, monto })).sort((a, b) => b.monto - a.monto),
      ventas_pendientes: ventasConSaldo,
      evolucion_mensual: Object.values(porMes).sort((a: any, b: any) => b.mes.localeCompare(a.mes)),
    });
  } catch (error: any) {
    console.error('Error getCobranzaReport:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

export const getVendedoresReport = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { fecha_desde, fecha_hasta } = req.query;
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' });
  }

  try {
    const { data: vendedoresData, error: vendedoresError } = await supabase
      .from('users')
      .select('id, nombre, apellido, email, activo')
      .eq('rol', 'vendedor');
    if (vendedoresError) throw vendedoresError;

    const hastaInclusive = (fecha_hasta as string).includes('T') ? fecha_hasta as string : `${fecha_hasta}T23:59:59.999Z`;

    const { data: cotizacionesData } = await supabase
      .from('cotizaciones')
      .select('id, vendedor_id, precio_total, estado, fecha_creacion')
      .gte('fecha_creacion', fecha_desde as string)
      .lte('fecha_creacion', hastaInclusive);
    const cotizacionesArr = cotizacionesData || [];

    const { data: ventasData } = await supabase
      .from('ventas')
      .select('id, vendedor_id, precio_total, comision_monto, fecha_creacion')
      .gte('fecha_creacion', fecha_desde as string)
      .lte('fecha_creacion', hastaInclusive);
    const ventasArr = ventasData || [];

    const { data: pagosComData } = await supabase
      .from('pagos_comisiones')
      .select('id, vendedor_id, monto, fecha_pago')
      .gte('fecha_pago', fecha_desde as string)
      .lte('fecha_pago', hastaInclusive);
    const pagosComArr = pagosComData || [];

    const resultado = (vendedoresData || []).map((v: any) => {
      const cotizacionesVendedor = cotizacionesArr.filter((c: any) => c.vendedor_id === v.id);
      const ventasVendedor = ventasArr.filter((ve: any) => ve.vendedor_id === v.id);
      const comisionesPagadas = pagosComArr.filter((pc: any) => pc.vendedor_id === v.id).reduce((sum: number, p: any) => sum + (Number(p.monto) || 0), 0);
      const comisionesGeneradas = ventasVendedor.reduce((sum: number, ve: any) => sum + (Number(ve.comision_monto) || 0), 0);

      return {
        vendedor_id: v.id,
        vendedor_nombre: `${v.nombre || ''} ${v.apellido || ''}`.trim(),
        vendedor_email: v.email,
        activo: v.activo,
        cotizaciones: cotizacionesVendedor.length,
        ventas: ventasVendedor.length,
        conversion_pct: cotizacionesVendedor.length > 0 ? Number(((ventasVendedor.length / cotizacionesVendedor.length) * 100).toFixed(2)) : 0,
        total_vendido: ventasVendedor.reduce((sum: number, ve: any) => sum + (Number(ve.precio_total) || 0), 0),
        comisiones_generadas: comisionesGeneradas,
        comisiones_pagadas: comisionesPagadas,
        comisiones_pendientes: Math.max(0, comisionesGeneradas - comisionesPagadas),
      };
    }).sort((a: any, b: any) => b.total_vendido - a.total_vendido);

    res.json({
      vendedores: resultado,
      totales: {
        total_cotizaciones: cotizacionesArr.length,
        total_ventas: ventasArr.length,
        total_vendido: ventasArr.reduce((sum: number, v: any) => sum + (Number(v.precio_total) || 0), 0),
        total_comisiones_generadas: resultado.reduce((sum: number, v: any) => sum + v.comisiones_generadas, 0),
        total_comisiones_pagadas: resultado.reduce((sum: number, v: any) => sum + v.comisiones_pagadas, 0),
      }
    });
  } catch (error: any) {
    console.error('Error getVendedoresReport:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

export const getProductosReport = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { fecha_desde, fecha_hasta, vendedor_id } = req.query;
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' });
  }

  try {
    const { data: ventasData } = await getBaseQuery(
      'ventas', 'fecha_creacion', fecha_desde as string, fecha_hasta as string, vendedor_id as string | undefined
    );
    const ventasArr = ventasData || [];
    const cotizacionIds = ventasArr.map((v: any) => v.cotizacion_id).filter(Boolean);

    let cotizacionesArr: any[] = [];
    if (cotizacionIds.length > 0) {
      const { data: cotData } = await supabase.from('cotizaciones').select('id, destino_principal, paquete_id, paquete_data').in('id', cotizacionIds);
      cotizacionesArr = cotData || [];
    }

    const destinos: Record<string, any> = {};
    cotizacionesArr.forEach((c: any) => {
      const dest = c.destino_principal || 'Desconocido';
      if (!destinos[dest]) destinos[dest] = { destino: dest, cantidad: 0, monto: 0 };
      destinos[dest].cantidad++;
      const venta = ventasArr.find((v: any) => v.cotizacion_id === c.id);
      destinos[dest].monto += Number(venta?.precio_total) || 0;
    });

    const paquetes: Record<string, any> = {};
    ventasArr.forEach((v: any) => {
      const nombre = v.paquete_nombre || 'Cotización Manual';
      if (!paquetes[nombre]) paquetes[nombre] = { paquete: nombre, cantidad: 0, monto: 0 };
      paquetes[nombre].cantidad++;
      paquetes[nombre].monto += Number(v.precio_total) || 0;
    });

    let vuelosArr: any[] = [];
    if (cotizacionIds.length > 0) {
      const { data: vuelosData } = await supabase.from('vuelos').select('cotizacion_id, aerolinea_codigo, aerolinea_nombre').in('cotizacion_id', cotizacionIds);
      vuelosArr = vuelosData || [];
    }

    const aerolineas: Record<string, any> = {};
    vuelosArr.forEach((vu: any) => {
      const codigo = vu.aerolinea_codigo || 'UNK';
      const nombre = vu.aerolinea_nombre || 'Desconocida';
      if (!aerolineas[codigo]) aerolineas[codigo] = { codigo, nombre, cantidad: 0, monto: 0 };
      aerolineas[codigo].cantidad++;
      const venta = ventasArr.find((v: any) => v.cotizacion_id === vu.cotizacion_id);
      aerolineas[codigo].monto += Number(venta?.precio_total) || 0;
    });

    let hospedajesArr: any[] = [];
    if (cotizacionIds.length > 0) {
      const { data: hospData } = await supabase.from('hospedajes').select('cotizacion_id, ciudad, noches, precio_total').in('cotizacion_id', cotizacionIds);
      hospedajesArr = hospData || [];
    }

    const ciudades: Record<string, any> = {};
    hospedajesArr.forEach((h: any) => {
      const ciudad = h.ciudad || 'Desconocida';
      if (!ciudades[ciudad]) ciudades[ciudad] = { ciudad, noches: 0, monto: 0, cantidad: 0 };
      ciudades[ciudad].noches += Number(h.noches) || 0;
      ciudades[ciudad].monto += Number(h.precio_total) || 0;
      ciudades[ciudad].cantidad++;
    });

    res.json({
      destinos: Object.values(destinos).sort((a: any, b: any) => b.cantidad - a.cantidad).slice(0, 10),
      paquetes: Object.values(paquetes).sort((a: any, b: any) => b.monto - a.monto).slice(0, 10),
      aerolineas: Object.values(aerolineas).sort((a: any, b: any) => b.cantidad - a.cantidad).slice(0, 10),
      hospedajes_ciudad: Object.values(ciudades).sort((a: any, b: any) => b.noches - a.noches).slice(0, 10),
    });
  } catch (error: any) {
    console.error('Error getProductosReport:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};

export const getCRMReport = async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (user.role !== 'admin') {
    return res.status(403).json({ error: 'No autorizado' });
  }

  const { fecha_desde, fecha_hasta } = req.query;
  if (!fecha_desde || !fecha_hasta) {
    return res.status(400).json({ error: 'fecha_desde y fecha_hasta son requeridos' });
  }

  try {
    const hastaInclusive = (fecha_hasta as string).includes('T') ? fecha_hasta as string : `${fecha_hasta}T23:59:59.999Z`;

    const { data: clientesData } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, fuente_lead, estado, fecha_registro, fecha_ultima_interaccion')
      .gte('fecha_registro', fecha_desde as string)
      .lte('fecha_registro', hastaInclusive);
    const clientesArr = clientesData || [];

    const { data: todosClientesData } = await supabase
      .from('clientes')
      .select('id, nombre, apellido, fuente_lead, estado, fecha_registro, fecha_ultima_interaccion');
    const todosClientesArr = todosClientesData || [];

    const clienteIds = todosClientesArr.map((c: any) => c.id);
    let cotizacionesClientes: any[] = [];
    if (clienteIds.length > 0) {
      const batchSize = 200;
      for (let i = 0; i < clienteIds.length; i += batchSize) {
        const batch = clienteIds.slice(i, i + batchSize);
        const { data: cotBatch } = await supabase.from('cotizaciones').select('cliente_id, fecha_creacion').in('cliente_id', batch);
        cotizacionesClientes = cotizacionesClientes.concat(cotBatch || []);
      }
    }

    const { data: ventasData } = await supabase
      .from('ventas')
      .select('id, cotizacion_id, fecha_creacion')
      .gte('fecha_creacion', fecha_desde as string)
      .lte('fecha_creacion', hastaInclusive);
    const ventasArr = ventasData || [];
    const ventasCotizacionIds = ventasArr.map((v: any) => v.cotizacion_id).filter(Boolean);

    let cotizacionesVentas: any[] = [];
    if (ventasCotizacionIds.length > 0) {
      const { data: cotV } = await supabase.from('cotizaciones').select('id, cliente_id').in('id', ventasCotizacionIds);
      cotizacionesVentas = cotV || [];
    }
    const clientesConVentaIds = new Set(cotizacionesVentas.map((c: any) => c.cliente_id));

    const porMes: Record<string, any> = {};
    clientesArr.forEach((c: any) => {
      const mes = formatMonth(c.fecha_registro);
      if (!porMes[mes]) porMes[mes] = { mes, cantidad: 0 };
      porMes[mes].cantidad++;
    });

    const fuentes: Record<string, any> = {};
    clientesArr.forEach((c: any) => {
      const fuente = c.fuente_lead || 'Desconocida';
      if (!fuentes[fuente]) fuentes[fuente] = { fuente, total: 0, con_venta: 0 };
      fuentes[fuente].total++;
      if (clientesConVentaIds.has(c.id)) fuentes[fuente].con_venta++;
    });
    const fuentesArr = Object.values(fuentes).map((f: any) => ({
      ...f,
      conversion_pct: f.total > 0 ? Number(((f.con_venta / f.total) * 100).toFixed(2)) : 0,
    })).sort((a: any, b: any) => b.total - a.total);

    const ahora = new Date();
    const sesentaDiasAtras = new Date(ahora.getTime() - 60 * 24 * 60 * 60 * 1000);
    const dormidos = todosClientesArr
      .filter((c: any) => {
        if (!c.fecha_ultima_interaccion) return true;
        return new Date(c.fecha_ultima_interaccion) < sesentaDiasAtras;
      })
      .map((c: any) => {
        const ultimaCot = cotizacionesClientes
          .filter((co: any) => co.cliente_id === c.id)
          .sort((a: any, b: any) => new Date(b.fecha_creacion).getTime() - new Date(a.fecha_creacion).getTime())[0];
        const diasInactivo = c.fecha_ultima_interaccion
          ? Math.floor((ahora.getTime() - new Date(c.fecha_ultima_interaccion).getTime()) / (1000 * 60 * 60 * 24))
          : Math.floor((ahora.getTime() - new Date(c.fecha_registro).getTime()) / (1000 * 60 * 60 * 24));
        return {
          id: c.id,
          nombre: `${c.nombre || ''} ${c.apellido || ''}`.trim(),
          fecha_ultima_interaccion: c.fecha_ultima_interaccion,
          dias_inactivo: diasInactivo,
          ultima_cotizacion: ultimaCot?.fecha_creacion || null,
          estado: c.estado,
        };
      })
      .sort((a: any, b: any) => b.dias_inactivo - a.dias_inactivo)
      .slice(0, 50);

    const estados: Record<string, number> = {};
    todosClientesArr.forEach((c: any) => {
      const estado = c.estado || 'desconocido';
      estados[estado] = (estados[estado] || 0) + 1;
    });
    const estadosArr = Object.entries(estados).map(([estado, cantidad]) => ({ estado, cantidad }));

    res.json({
      nuevos_clientes_mes: Object.values(porMes).sort((a: any, b: any) => b.mes.localeCompare(a.mes)),
      fuentes_lead: fuentesArr,
      clientes_dormidos: dormidos,
      distribucion_estados: estadosArr,
      resumen: {
        nuevos_clientes_periodo: clientesArr.length,
        total_clientes: todosClientesArr.length,
        clientes_dormidos_count: dormidos.length,
      }
    });
  } catch (error: any) {
    console.error('Error getCRMReport:', error);
    res.status(500).json({ error: 'Internal server error', details: error.message });
  }
};
