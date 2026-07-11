import { Request, Response } from 'express';
import { supabase } from '../config/supabase';

const TRIP_CONECTA_TENANT_ID = '11111111-1111-1111-1111-111111111111';

interface TenantConfig {
  id: string | null;
  nombre: string;
  slug: string;
  logo_url: string;
  color_primario: string;
  color_secundario: string;
  dominio: string;
}

const QUOTIX_TRAVEL_CONFIG: TenantConfig = {
  id: null,
  nombre: 'Quotix Travel',
  slug: 'quotix-travel',
  logo_url: '/logo-quotix-travel.png',
  color_primario: '#0ea5e9',
  color_secundario: '#6366f1',
  dominio: 'travel.quotixos.com'
};

export const getTenantConfig = async (req: Request, res: Response) => {
  try {
    const domain = (req.query.domain as string) || req.headers.host || '';
    const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/:\d+$/, '').toLowerCase();

    // Dominios que siempre resuelven a Trip Conecta
    const tripConectaDomains = ['panel.tripconecta.com', 'tripconecta.com', 'localhost'];
    if (tripConectaDomains.includes(normalizedDomain) || normalizedDomain.startsWith('localhost')) {
      const { data: tenant, error } = await supabase
        .from('tenants')
        .select('id, nombre, slug, logo_url, color_primario, color_secundario, dominio')
        .eq('id', TRIP_CONECTA_TENANT_ID)
        .single();

      if (error || !tenant) {
        console.error('[config] Error fetching Trip Conecta tenant:', error);
        return res.json(QUOTIX_TRAVEL_CONFIG);
      }

      return res.json(tenant);
    }

    // Portal genérico de Quotix Travel
    if (normalizedDomain === 'travel.quotixos.com' || normalizedDomain === 'quotixos.com') {
      return res.json(QUOTIX_TRAVEL_CONFIG);
    }

    // Buscar por dominio personalizado
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id, nombre, slug, logo_url, color_primario, color_secundario, dominio')
      .eq('dominio', normalizedDomain)
      .eq('activo', true)
      .single();

    if (error || !tenant) {
      console.log(`[config] No tenant found for domain: ${normalizedDomain}, returning generic`);
      return res.json(QUOTIX_TRAVEL_CONFIG);
    }

    return res.json(tenant);
  } catch (err) {
    console.error('[config] Unexpected error:', err);
    return res.json(QUOTIX_TRAVEL_CONFIG);
  }
};
