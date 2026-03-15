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

// Rate limiter general para API (100 requests por minuto)
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minuto
  max: 100, // 100 requests
  message: {
    error: 'Demasiadas peticiones. Por favor intente más tarde.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});
