import rateLimit from 'express-rate-limit';

// Rate limiter para login (5 intentos cada 15 minutos)
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5, // 5 intentos
  message: { 
    error: 'Demasiados intentos de login. Por favor intente nuevamente en 15 minutos.' 
  },
  standardHeaders: true,
  legacyHeaders: false,
  // Skip successful requests
  skipSuccessfulRequests: true,
});

// Rate limiter general para API (60 requests por minuto)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 60, // 60 requests
  message: {
    error: 'Demasiadas peticiones. Por favor intente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para reportes y endpoints pesados (10 req/min)
export const reportesLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: {
    error: 'Demasiadas peticiones a reportes. Por favor intente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para jobs/cron (5 req/min)
export const jobsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: {
    error: 'Demasiadas ejecuciones de jobs. Por favor intente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter para registro público (5 por hora por IP)
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: {
    error: 'Demasiados registros desde esta IP. Por favor intente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
