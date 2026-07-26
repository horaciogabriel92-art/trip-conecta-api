import { supabase } from '../config/supabase';

interface AirportTranslation {
  iata_code: string;
  language_code: string;
  airport_name: string | null;
  city_name: string | null;
  country_name: string | null;
}

let cache: Record<string, AirportTranslation> | null = null;
let cacheLang: string | null = null;

export async function loadAirportTranslations(languageCode: string = 'es'): Promise<Record<string, AirportTranslation>> {
  if (cache && cacheLang === languageCode) return cache;

  const { data, error } = await supabase
    .from('airport_translations')
    .select('iata_code, language_code, airport_name, city_name, country_name')
    .eq('language_code', languageCode);

  if (error) {
    console.error('[airports] Error loading translations:', error);
    return {};
  }

  const map: Record<string, AirportTranslation> = {};
  (data || []).forEach((t: any) => {
    map[t.iata_code.toUpperCase()] = t as AirportTranslation;
  });

  cache = map;
  cacheLang = languageCode;
  return map;
}

export function translateFlightAirports(
  vuelos: any[],
  translations: Record<string, AirportTranslation>
): any[] {
  if (!vuelos || !Array.isArray(vuelos)) return vuelos;

  return vuelos.map((v: any) => {
    const origenCode = (v.origen_codigo || '').toUpperCase();
    const destinoCode = (v.destino_codigo || '').toUpperCase();
    const origenT = translations[origenCode];
    const destinoT = translations[destinoCode];

    return {
      ...v,
      origen_nombre: origenT?.airport_name || v.origen_nombre || v.origen_ciudad || origenCode,
      origen_ciudad: origenT?.city_name || v.origen_ciudad || v.origen_nombre || origenCode,
      destino_nombre: destinoT?.airport_name || v.destino_nombre || v.destino_ciudad || destinoCode,
      destino_ciudad: destinoT?.city_name || v.destino_ciudad || v.destino_nombre || destinoCode,
    };
  });
}

export function translateAirportName(
  iataCode: string,
  translations: Record<string, AirportTranslation>,
  fallback?: string
): string {
  const t = translations[(iataCode || '').toUpperCase()];
  return t?.airport_name || fallback || iataCode;
}

export function translateCityName(
  iataCode: string,
  translations: Record<string, AirportTranslation>,
  fallback?: string
): string {
  const t = translations[(iataCode || '').toUpperCase()];
  return t?.city_name || fallback || iataCode;
}
